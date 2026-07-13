/**
 * Regression locks for `_shared/delete-account.ts` — the purge-and-delete core behind
 * `POST /functions/v1/delete-account` (issue #58), and the evidence issue #59 asks for.
 *
 * These are not decoration. `docs/privacy-policy.md` says "Deleting your account removes
 * everything: your account, every analysis, and every stored frame", and its publication is gated
 * on that sentence being TRUE (`docs/status.md` Known Issue #15). An untested purge is an
 * unverified privacy claim, so the assertions below are written from the STORAGE side — "list the
 * bucket after the delete and prove it is empty" — never from the row side. Issue #59 spells out
 * why: the tempting test ("delete the account, confirm the rows are gone") passes while every frame
 * is still sitting in the bucket, which is the exact bug (#3, and V1's flat `delete-user`) that
 * these tests exist to make impossible.
 *
 * The four properties this file is required to prove:
 *   (a) ZERO orphaned storage objects after a full account delete — #59's core assertion.
 *   (b) Nested-prefix recursion: `{user_id}/{analysis_id}/frame.jpg` is NOT reachable by a flat
 *       `list(user_id)`, which returns pseudo-directories and removes nothing while reporting
 *       success (`docs/privacy-checklist-m7.md`).
 *   (c) A failure mid-purge does NOT delete the auth user (Echo V1's best-effort pattern could).
 *   (d) The consent-trail decision — purge, explicitly, not by inherited FK cascade.
 *
 * Fakes, not a live Postgres/Storage: these prove the CONTRACT (ordering, authorization,
 * idempotency, recursion, failure atomicity). Issue #59 also wants the same properties exercised
 * against a real local Supabase, where two different systems must agree — see this branch's PR for
 * why that half is deliberately still open.
 *
 * DENO-ONLY, DELIBERATELY (issue #90 convention): named `.deno.test.ts` so `jest.config.js`'s
 * `testPathIgnorePatterns` skips it and only `deno test` (`npm run test:edge`) runs it.
 */
import {
  accountResponseBodyForOutcome,
  ACCOUNT_PURGE_CONCURRENCY,
  batchedRemove,
  deleteAccount,
  httpStatusForAccountOutcome,
  mapWithConcurrency,
  REMOVE_BATCH_SIZE,
  type AccountRows,
  type AuthAdmin,
  type DeleteAccountErrorCode,
  type DeleteAccountResult,
} from '../delete-account.ts';
import type { StorageBucket, StorageEntry } from '../delete-analysis.ts';

// ---------------------------------------------------------------------------
// Test doubles. All three share one `ops` log, so a test can assert the ORDER in which the three
// systems were touched — which is this function's whole design, and is not observable from any
// single fake on its own.
// ---------------------------------------------------------------------------

type Op = 'storage.remove' | 'rows.deleteConsents' | 'rows.deleteProfile' | 'auth.deleteUser';

/** A tiny in-memory "bucket": a flat set of full object paths, with folders inferred from `/`. */
class FakeStorage implements StorageBucket {
  private objects: Set<string>;
  readonly listCalls: Array<{ prefix: string; limit: number; offset: number }> = [];
  readonly removeCalls: string[][] = [];
  /** When set, remove() reports this as an error instead of removing anything. */
  failRemoveWith: string | null = null;
  /** When set, list() throws — simulating a Storage outage at the very first step. */
  failListWith: string | null = null;
  /** Paths that "appear" the moment `onResurrect` fires — simulates a concurrent analyze-form upload. */
  resurrectPaths: string[] = [];
  /**
   * When set (ms), every list() call yields to a real timer before resolving — issue #125's
   * concurrency tests need calls to genuinely overlap in time to observe a max-in-flight count;
   * a synchronously-resolved fake never overlaps, so a concurrency bug would be invisible to it.
   */
  artificialListDelayMs = 0;
  /** Tracks how many list() calls are simultaneously in flight — proves bounded concurrency. */
  readonly listConcurrency = { current: 0, max: 0 };

  constructor(initialPaths: string[], private ops: Op[] = []) {
    this.objects = new Set(initialPaths);
  }

  remainingPaths(): string[] {
    return Array.from(this.objects).sort();
  }

  /** Simulates frames landing in the bucket mid-delete (an `analyze-form` call already in flight). */
  resurrect(): void {
    for (const path of this.resurrectPaths) {
      this.objects.add(path);
    }
    this.resurrectPaths = [];
  }

  async list(prefix: string, options: { limit: number; offset: number }): Promise<StorageEntry[]> {
    this.listCalls.push({ prefix, limit: options.limit, offset: options.offset });
    if (this.failListWith) {
      throw new Error(this.failListWith);
    }
    this.listConcurrency.current += 1;
    this.listConcurrency.max = Math.max(this.listConcurrency.max, this.listConcurrency.current);
    if (this.artificialListDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.artificialListDelayMs));
    } else {
      await Promise.resolve(); // still yield a tick, so genuinely concurrent callers can overlap
    }
    this.listConcurrency.current -= 1;

    const directChildren = new Map<string, boolean>(); // name -> isFolder
    for (const path of this.objects) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest.length === 0) continue;
      const slash = rest.indexOf('/');
      if (slash === -1) {
        directChildren.set(rest, false);
      } else {
        directChildren.set(rest.slice(0, slash), true);
      }
    }
    const names = Array.from(directChildren.keys()).sort();
    const page = names
      .slice(options.offset, options.offset + options.limit)
      .map((name): StorageEntry => ({ name, isFolder: directChildren.get(name) ?? false }));
    return page;
  }

  remove(paths: string[]): Promise<{ error: string | null }> {
    this.ops.push('storage.remove');
    this.removeCalls.push(paths);
    if (this.failRemoveWith) {
      return Promise.resolve({ error: this.failRemoveWith });
    }
    for (const path of paths) {
      this.objects.delete(path);
    }
    return Promise.resolve({ error: null });
  }
}

class FakeRows implements AccountRows {
  consentsByUser: Map<string, number>;
  profiles: Set<string>;
  failConsentsWith: string | null = null;
  failProfileWith: string | null = null;

  constructor(
    consents: Record<string, number>,
    profiles: string[],
    private ops: Op[] = []
  ) {
    this.consentsByUser = new Map(Object.entries(consents));
    this.profiles = new Set(profiles);
  }

  deleteConsents(userId: string): Promise<{ deletedCount: number }> {
    this.ops.push('rows.deleteConsents');
    if (this.failConsentsWith) return Promise.reject(new Error(this.failConsentsWith));
    const count = this.consentsByUser.get(userId) ?? 0;
    this.consentsByUser.set(userId, 0);
    return Promise.resolve({ deletedCount: count });
  }

  deleteProfile(userId: string): Promise<{ deleted: boolean }> {
    this.ops.push('rows.deleteProfile');
    if (this.failProfileWith) return Promise.reject(new Error(this.failProfileWith));
    const existed = this.profiles.delete(userId);
    return Promise.resolve({ deleted: existed });
  }
}

class FakeAuthAdmin implements AuthAdmin {
  readonly deletedUsers: string[] = [];
  failWith: string | null = null;
  /** Fires right after the auth user is deleted — the hook the concurrency-race test uses. */
  onDeleted: (() => void) | null = null;

  constructor(private ops: Op[] = []) {}

  deleteUser(userId: string): Promise<void> {
    this.ops.push('auth.deleteUser');
    if (this.failWith) return Promise.reject(new Error(this.failWith));
    this.deletedUsers.push(userId);
    this.onDeleted?.();
    return Promise.resolve();
  }
}

function assertEquals(actual: unknown, expected: unknown, message?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(message ?? `Expected ${e}, got ${a}`);
  }
}

function assertTrue(value: boolean, message: string): void {
  if (!value) throw new Error(message);
}

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const ANALYSIS_1 = '33333333-3333-3333-3333-333333333333';
const ANALYSIS_2 = '44444444-4444-4444-4444-444444444444';
const ANALYSIS_3 = '55555555-5555-5555-5555-555555555555';

/** A realistic account: three analyses, several frames each, in the real nested layout. */
function accountFrames(userId: string): string[] {
  return [
    `${userId}/${ANALYSIS_1}/frame-01.jpg`,
    `${userId}/${ANALYSIS_1}/frame-02.jpg`,
    `${userId}/${ANALYSIS_1}/frame-03.jpg`,
    `${userId}/${ANALYSIS_2}/frame-01.jpg`,
    `${userId}/${ANALYSIS_2}/frame-02.jpg`,
    `${userId}/${ANALYSIS_3}/frame-01.jpg`,
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (a) ZERO ORPHANED STORAGE OBJECTS — issue #59's core assertion, checked from the Storage side.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

Deno.test(
  'deleteAccount: leaves ZERO orphaned storage objects for the deleted user (issue #59 — the assertion privacy-policy publication rests on)',
  async () => {
    const ops: Op[] = [];
    const storage = new FakeStorage(accountFrames(USER_A), ops);
    const rows = new FakeRows({ [USER_A]: 2 }, [USER_A], ops);
    const auth = new FakeAuthAdmin(ops);

    const result = await deleteAccount(rows, storage, auth, { userId: USER_A });

    assertEquals(result, {
      outcome: 'deleted',
      purgedObjectCount: 6,
      consentEventsPurged: 2,
      profileExisted: true,
    });

    // THE assertion — from the Storage side, not the row side. Listing every prefix under the user
    // must come back empty. A row-side check ("the analyses rows are gone") passes even when every
    // one of these six frames is still in the bucket.
    assertEquals(storage.remainingPaths(), [], 'ZERO objects may survive anywhere under the deleted account');
    assertEquals(auth.deletedUsers, [USER_A], 'the auth user is deleted');
    assertTrue(!rows.profiles.has(USER_A), 'the profile row is gone (cascading subscriptions + analyses)');
  }
);

Deno.test('deleteAccount: never touches another user\'s objects, rows, or auth record', async () => {
  const ops: Op[] = [];
  const storage = new FakeStorage([...accountFrames(USER_A), ...accountFrames(USER_B)], ops);
  const rows = new FakeRows({ [USER_A]: 1, [USER_B]: 1 }, [USER_A, USER_B], ops);
  const auth = new FakeAuthAdmin(ops);

  await deleteAccount(rows, storage, auth, { userId: USER_A });

  assertEquals(
    storage.remainingPaths(),
    accountFrames(USER_B).sort(),
    "user B's frames survive untouched — the purge prefix is rooted at the caller's own id and can never escape it"
  );
  assertTrue(rows.profiles.has(USER_B), "user B's profile row is untouched");
  assertEquals(rows.consentsByUser.get(USER_B), 1, "user B's consent events are untouched");
  assertEquals(auth.deletedUsers, [USER_A], 'only the caller\'s auth user is deleted');
  // Every list() call must be scoped to the caller's own namespace.
  assertTrue(
    storage.listCalls.every((call) => call.prefix.startsWith(`${USER_A}/`)),
    'every Storage list must be rooted at the caller\'s own prefix'
  );
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE ORDER IS THE DESIGN: storage objects → rows → auth user.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

Deno.test(
  'deleteAccount: deletes in the order storage → rows → auth user (inverting it orphans every frame forever)',
  async () => {
    const ops: Op[] = [];
    const storage = new FakeStorage(accountFrames(USER_A), ops);
    const rows = new FakeRows({ [USER_A]: 1 }, [USER_A], ops);
    const auth = new FakeAuthAdmin(ops);

    await deleteAccount(rows, storage, auth, { userId: USER_A });

    // Issue #125 dispatches one storage.remove() PER analysis sub-prefix (purged concurrently),
    // not one combined remove() for the whole account — so the exact count is no longer a fixed
    // "1", it is "one per non-empty analysis" (3, for this fixture). What must still hold, exactly
    // as before, is the ORDERING: every storage.remove must land before the first row op, and the
    // row/auth ops must run in their own fixed sequence.
    const nonStorageOps = ops.filter((op) => op !== 'storage.remove');
    const lastStorageRemoveIndex = ops.lastIndexOf('storage.remove');
    const firstNonStorageIndex = ops.findIndex((op) => op !== 'storage.remove');
    assertTrue(
      ops.includes('storage.remove'),
      'at least one storage.remove must have happened'
    );
    assertTrue(
      firstNonStorageIndex === -1 || lastStorageRemoveIndex < firstNonStorageIndex,
      'storage must be purged BEFORE any row is deleted, and the auth user LAST — the cascade from ' +
        'auth.users would otherwise take the rows (and media_paths) with it, leaving storage.objects ' +
        'unreachable, un-enumerable, and orphaned forever (storage.objects has no FK to auth.users)'
    );
    assertEquals(
      nonStorageOps,
      ['rows.deleteConsents', 'rows.deleteProfile', 'auth.deleteUser'],
      'once every storage.remove is done, rows and the auth user must still happen in exactly this order'
    );
  }
);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (b) THE NESTED-PREFIX TRAP — a flat list(user_id) removes NOTHING while reporting success.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

Deno.test(
  'deleteAccount: recurses into every {analysis_id}/ sub-prefix — a flat list(user_id) would remove nothing and orphan every frame',
  async () => {
    const ops: Op[] = [];
    const storage = new FakeStorage(accountFrames(USER_A), ops);
    const rows = new FakeRows({ [USER_A]: 0 }, [USER_A], ops);
    const auth = new FakeAuthAdmin(ops);

    const result = await deleteAccount(rows, storage, auth, { userId: USER_A });

    assertTrue(result.outcome === 'deleted', `expected deleted, got ${result.outcome}`);
    assertEquals(storage.remainingPaths(), []);

    // The trap, stated as an assertion: a flat list of `{user}/` returns THREE pseudo-directory
    // entries (the analysis ids) and ZERO files. Handing those names to remove() deletes nothing.
    // What must actually reach remove() is six full, nested object paths.
    const removed = storage.removeCalls.flat().sort();
    assertEquals(removed, accountFrames(USER_A).sort(), 'remove() must receive full nested file paths, not the analysis-id prefixes');
    assertTrue(
      removed.every((path) => path.split('/').length === 3),
      'every removed path must be a real {user_id}/{analysis_id}/frame file, never a 2-segment pseudo-directory'
    );

    // And it must actually have descended into each analysis prefix, not just listed the root.
    for (const analysisId of [ANALYSIS_1, ANALYSIS_2, ANALYSIS_3]) {
      assertTrue(
        storage.listCalls.some((call) => call.prefix === `${USER_A}/${analysisId}/`),
        `the purge must recurse into ${analysisId}/ — listing only ${USER_A}/ is exactly V1's bug`
      );
    }
  }
);

Deno.test('deleteAccount: recurses deeper than one level (an unexpected nested folder is still purged)', async () => {
  const ops: Op[] = [];
  const storage = new FakeStorage(
    [`${USER_A}/${ANALYSIS_1}/frame-01.jpg`, `${USER_A}/${ANALYSIS_1}/variant/frame-01-alt.jpg`],
    ops
  );
  const rows = new FakeRows({ [USER_A]: 0 }, [USER_A], ops);
  const auth = new FakeAuthAdmin(ops);

  const result = await deleteAccount(rows, storage, auth, { userId: USER_A });

  assertTrue(result.outcome === 'deleted', `expected deleted, got ${result.outcome}`);
  assertEquals(storage.remainingPaths(), [], 'a deeper nested object must be purged too, not left behind');
});

Deno.test('deleteAccount: paginates each prefix level (an account with more objects than one page)', async () => {
  const ops: Op[] = [];
  // 7 analyses, 1 frame each — more than one page of sub-prefixes at pageSize 3.
  const paths = Array.from(
    { length: 7 },
    (_, i) => `${USER_A}/analysis-${String(i).padStart(2, '0')}/frame-01.jpg`
  );
  const storage = new FakeStorage(paths, ops);
  const rows = new FakeRows({ [USER_A]: 0 }, [USER_A], ops);
  const auth = new FakeAuthAdmin(ops);

  const result = await deleteAccount(rows, storage, auth, { userId: USER_A, pageSize: 3 });

  assertTrue(result.outcome === 'deleted', `expected deleted, got ${result.outcome}`);
  if (result.outcome === 'deleted') {
    assertEquals(result.purgedObjectCount, 7, 'every object across every page must be collected, not just the first page');
  }
  assertEquals(storage.remainingPaths(), [], 'nothing may survive a paginated purge');
});

Deno.test(
  'deleteAccount: purges objects under a prefix with NO surviving row — soft-deleted analyses (Known Issue #19) and crashed uploads',
  async () => {
    // The sweep is by PREFIX, never by walking `analyses` rows or their `media_paths`. That is what
    // makes it strictly stronger than any row-driven purge: it cleans up frames belonging to rows
    // soft-deleted through issue #2's client UPDATE policy (whose media_paths the redact trigger has
    // since blanked — status.md Known Issue #19) and frames from an `analyze-form` run that crashed
    // before `settle_analysis` ever recorded them. Neither is enumerable from the rows. Both are
    // here, and both must go.
    const ops: Op[] = [];
    const orphanFromSoftDelete = `${USER_A}/${ANALYSIS_2}/frame-01.jpg`; // row soft-deleted, media_paths blanked
    const orphanFromCrash = `${USER_A}/${ANALYSIS_3}/frame-01.jpg`; // settle_analysis never ran
    const storage = new FakeStorage([`${USER_A}/${ANALYSIS_1}/frame-01.jpg`, orphanFromSoftDelete, orphanFromCrash], ops);
    const rows = new FakeRows({ [USER_A]: 1 }, [USER_A], ops);
    const auth = new FakeAuthAdmin(ops);

    const result = await deleteAccount(rows, storage, auth, { userId: USER_A });

    assertTrue(result.outcome === 'deleted', `expected deleted, got ${result.outcome}`);
    if (result.outcome === 'deleted') {
      assertEquals(result.purgedObjectCount, 3, 'all three objects go, including the two no row points at');
    }
    assertEquals(
      storage.remainingPaths(),
      [],
      'objects with no live row must still be purged — a media_paths-driven or row-driven sweep would leave these orphaned forever'
    );
  }
);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// The work is BOUNDED — a heavy account must not become permanently undeletable.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

Deno.test(
  'deleteAccount: removes in bounded batches — an account with thousands of frames must not be handed to one unbounded remove()',
  async () => {
    // `purgePrefix` collects every object under the prefix and calls remove() ONCE. Bounded to a
    // handful of frames for a single analysis (#57), but an account spans every analysis the user
    // ever ran — and a single remove() with thousands of paths in its body is the call that starts
    // failing on request size. Because the purge is (correctly) blocking, that failure would make
    // the heaviest accounts UNDELETABLE, breaching Guideline 5.1.1(v) for exactly the users least
    // willing to wait. This is the "runs fine for six months, then breaks with no code change"
    // failure, so the bound is asserted, not assumed.
    const ops: Op[] = [];
    const paths = Array.from(
      { length: 1250 },
      (_, i) => `${USER_A}/${ANALYSIS_1}/frame-${String(i).padStart(4, '0')}.jpg`
    );
    const storage = new FakeStorage(paths, ops);
    const rows = new FakeRows({ [USER_A]: 0 }, [USER_A], ops);
    const auth = new FakeAuthAdmin(ops);

    const result = await deleteAccount(rows, storage, auth, { userId: USER_A, removeBatchSize: 500 });

    assertTrue(result.outcome === 'deleted', `expected deleted, got ${result.outcome}`);
    assertEquals(storage.remainingPaths(), [], 'every one of the 1250 objects must still be purged');
    assertEquals(storage.removeCalls.length, 3, '1250 paths at a batch size of 500 must be 3 remove() calls, not 1 of 1250');
    assertTrue(
      storage.removeCalls.every((batch) => batch.length <= 500),
      'no single remove() call may exceed the batch bound'
    );
    assertEquals(storage.removeCalls.flat().length, 1250, 'batching must not drop any path');
  }
);

Deno.test('REMOVE_BATCH_SIZE is at or below Supabase Storage list()\'s own 1000-per-page cap', () => {
  assertTrue(REMOVE_BATCH_SIZE > 0 && REMOVE_BATCH_SIZE <= 1000, `unreasonable batch size: ${REMOVE_BATCH_SIZE}`);
});

Deno.test('batchedRemove: reports the first failing batch and does not swallow it', async () => {
  const inner = new FakeStorage([`${USER_A}/${ANALYSIS_1}/frame-01.jpg`]);
  inner.failRemoveWith = 'batch rejected';
  const wrapped = batchedRemove(inner, 2);

  const { error } = await wrapped.remove(['a', 'b', 'c']);

  assertEquals(error, 'batch rejected', 'a failing batch must surface, not be lost in the loop');
  assertEquals(inner.removeCalls.length, 1, 'it must stop at the first failure rather than plough on');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// mapWithConcurrency — the bounded-fan-out primitive issue #125 introduces. Tested directly and in
// isolation from the Storage fakes, since its correctness (cap respected, order preserved, fails
// fast without abandoning in-flight work) is a property of the primitive, not of delete-account.ts.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

Deno.test('mapWithConcurrency: runs at most `limit` calls at once, and preserves result order regardless of completion order', async () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  let current = 0;
  let max = 0;

  const results = await mapWithConcurrency(items, 5, async (item) => {
    current += 1;
    max = Math.max(max, current);
    // Later items resolve FASTER than earlier ones, so completion order is scrambled relative to
    // input order — proving the RESULTS array is ordered by input index, not by finish time.
    await new Promise((resolve) => setTimeout(resolve, 5 - (item % 5)));
    current -= 1;
    return item * 2;
  });

  assertEquals(results, items.map((i) => i * 2), 'results must be in input order regardless of completion order');
  assertTrue(max <= 5, `observed ${max} concurrent calls in flight, limit was 5`);
  assertTrue(max > 1, 'concurrency must actually be used — a max of 1 would mean this silently serialized');
});

Deno.test('mapWithConcurrency: a limit larger than the item count still runs every item exactly once', async () => {
  const results = await mapWithConcurrency([1, 2, 3], 100, (n) => Promise.resolve(n + 1));
  assertEquals(results, [2, 3, 4]);
});

Deno.test('mapWithConcurrency: an empty item list resolves immediately with an empty array and calls fn zero times', async () => {
  const results = await mapWithConcurrency<number, number>([], 5, () => {
    throw new Error('must never be called for an empty item list');
  });
  assertEquals(results, []);
});

Deno.test(
  'mapWithConcurrency: the first rejection is thrown once every worker settles, and no NEW item starts after it — but in-flight items still finish',
  async () => {
    const started: number[] = [];
    const finished: number[] = [];
    const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    let caught: unknown;

    try {
      await mapWithConcurrency(items, 3, async (item) => {
        started.push(item);
        if (item === 1) {
          throw new Error('boom on item 1');
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
        finished.push(item);
        return item;
      });
    } catch (err) {
      caught = err;
    }

    assertTrue(
      caught instanceof Error && (caught as Error).message === 'boom on item 1',
      "the failing call's own error must propagate, not be swallowed or replaced"
    );
    assertTrue(
      started.length < items.length,
      'once a failure is observed, no NEW item may be started — this is fail-fast, not fail-eventually'
    );
    assertTrue(finished.length > 0, 'items already in flight when the failure happened must still be allowed to finish');
  }
);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE HEAVY ACCOUNT — issue #125. Bounded concurrency over analysis prefixes, a soft wall-clock
// budget that fails closed instead of risking a platform kill, and free checkpointing (a retry
// after a budget timeout resumes rather than restarting) — proved against deleteAccount() itself,
// not just the mapWithConcurrency primitive, so the ordering safety property (storage before rows
// before the auth user) is proved to still hold under the new concurrent shape.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

Deno.test(
  'deleteAccount: a heavy account (40 analyses) is purged with bounded, actually-concurrent Storage list() calls — not sequential, not unbounded',
  async () => {
    const analysisCount = 40;
    const paths = Array.from(
      { length: analysisCount },
      (_, i) => `${USER_A}/analysis-${String(i).padStart(3, '0')}/frame-01.jpg`
    );
    const storage = new FakeStorage(paths);
    storage.artificialListDelayMs = 3; // force genuine overlap between concurrent list() calls
    const rows = new FakeRows({ [USER_A]: 0 }, [USER_A]);
    const auth = new FakeAuthAdmin();
    const cap = 6;

    const result = await deleteAccount(rows, storage, auth, { userId: USER_A, listConcurrency: cap });

    assertTrue(result.outcome === 'deleted', `expected deleted, got ${result.outcome}`);
    if (result.outcome === 'deleted') {
      assertEquals(result.purgedObjectCount, analysisCount, 'every one of the 40 analyses must be purged');
    }
    assertEquals(storage.remainingPaths(), [], 'zero orphans, exactly as the un-scaled cases prove');
    assertTrue(
      storage.listConcurrency.max <= cap,
      `observed ${storage.listConcurrency.max} concurrent list() calls, cap was ${cap} — unbounded parallelism against Storage is exactly what issue #125 forbids`
    );
    assertTrue(
      storage.listConcurrency.max > 1,
      `observed only ${storage.listConcurrency.max} concurrent list() call(s) — the whole point of this fix is that these overlap, not run one at a time`
    );
  }
);

Deno.test('ACCOUNT_PURGE_CONCURRENCY is a sane, bounded, single-digit-to-low-double-digit fan-out — never unbounded, never accidentally 1', () => {
  assertTrue(
    ACCOUNT_PURGE_CONCURRENCY > 1 && ACCOUNT_PURGE_CONCURRENCY <= 32,
    `unreasonable concurrency cap: ${ACCOUNT_PURGE_CONCURRENCY}`
  );
});

Deno.test(
  'deleteAccount: a spent time budget mid-purge fails closed as purge_failed — same contract as any other purge failure, no new outcome, nothing beyond Storage touched',
  async () => {
    const analysisCount = 10;
    const paths = Array.from(
      { length: analysisCount },
      (_, i) => `${USER_A}/analysis-${String(i).padStart(2, '0')}/frame-01.jpg`
    );
    const storage = new FakeStorage(paths);
    const rows = new FakeRows({ [USER_A]: 1 }, [USER_A]);
    const auth = new FakeAuthAdmin();

    // A fake clock: reports "no time has passed" for the first several checks (letting several
    // sub-prefixes purge normally), then jumps far past any budget — simulating a slow account
    // that runs out of wall-clock partway through the sweep. listConcurrency: 1 makes this
    // deterministic (no race between concurrent workers' own now() checks).
    let calls = 0;
    const now = () => {
      calls += 1;
      return calls > 6 ? 1_000_000 : 0;
    };

    const result = await deleteAccount(rows, storage, auth, {
      userId: USER_A,
      listConcurrency: 1,
      now,
      purgeDeadlineMs: 500,
    });

    assertTrue(result.outcome === 'purge_failed', `expected purge_failed (budget spent), got ${result.outcome}`);
    if (result.outcome === 'purge_failed') {
      assertTrue(result.reason.length > 0 && !result.reason.includes('undefined'), 'the reason must be a real, informative message');
    }
    assertEquals(auth.deletedUsers, [], 'a budget timeout must not delete the auth user — same safety property as any other purge failure');
    assertTrue(rows.profiles.has(USER_A), 'the account must still exist so a retry can resume it');
    assertEquals(rows.consentsByUser.get(USER_A), 1, 'a purge failure must never touch rows at all');

    const remainingAfterFirst = storage.remainingPaths().length;
    assertTrue(
      remainingAfterFirst > 0 && remainingAfterFirst < analysisCount,
      `expected SOME but not all objects purged before the budget ran out, got ${remainingAfterFirst} of ${analysisCount} remaining`
    );
  }
);

Deno.test(
  'deleteAccount: a retry after a budget timeout RESUMES rather than restarting — already-purged prefixes are not re-listed or re-removed (free checkpointing via Storage-durable partial progress)',
  async () => {
    const analysisCount = 10;
    const paths = Array.from(
      { length: analysisCount },
      (_, i) => `${USER_A}/analysis-${String(i).padStart(2, '0')}/frame-01.jpg`
    );
    const storage = new FakeStorage(paths);
    const rows = new FakeRows({ [USER_A]: 1 }, [USER_A]);
    const auth = new FakeAuthAdmin();

    let calls = 0;
    const now = () => {
      calls += 1;
      return calls > 6 ? 1_000_000 : 0;
    };

    const first = await deleteAccount(rows, storage, auth, {
      userId: USER_A,
      listConcurrency: 1,
      now,
      purgeDeadlineMs: 500,
    });
    assertTrue(first.outcome === 'purge_failed', `expected the first attempt to fail on budget, got ${first.outcome}`);
    const remainingAfterFirst = storage.remainingPaths().length;
    assertTrue(
      remainingAfterFirst > 0 && remainingAfterFirst < analysisCount,
      `expected SOME but not all objects purged before the budget ran out, got ${remainingAfterFirst} of ${analysisCount} remaining`
    );

    // Retry with a normal, generous clock/budget: it must finish, and — this is the checkpointing
    // property — it only has to deal with what is actually left, because the emptied sub-prefixes
    // from attempt 1 no longer exist as pseudo-directories at all.
    const second = await deleteAccount(rows, storage, auth, { userId: USER_A, listConcurrency: 4 });

    assertTrue(second.outcome === 'deleted', `expected the retry to converge, got ${second.outcome}`);
    if (second.outcome === 'deleted') {
      assertEquals(
        second.purgedObjectCount,
        remainingAfterFirst,
        'the retry must purge exactly what was left, not the whole account again — proof that attempt 1\'s progress was durable, not rolled back'
      );
    }
    assertEquals(storage.remainingPaths(), [], 'the retry must finish the job completely');
    assertEquals(auth.deletedUsers, [USER_A], 'the account is only now actually deleted');
  }
);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (c) A FAILURE MID-PURGE DOES NOT DELETE THE AUTH USER. The purge is BLOCKING, not best-effort.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

Deno.test(
  'deleteAccount: a failed storage remove() does NOT delete the auth user, the profile, or the consents (Echo V1\'s best-effort bug)',
  async () => {
    const ops: Op[] = [];
    const storage = new FakeStorage(accountFrames(USER_A), ops);
    storage.failRemoveWith = 'simulated storage outage';
    const rows = new FakeRows({ [USER_A]: 2 }, [USER_A], ops);
    const auth = new FakeAuthAdmin(ops);

    const result = await deleteAccount(rows, storage, auth, { userId: USER_A });

    assertTrue(result.outcome === 'purge_failed', `expected purge_failed, got ${result.outcome}`);
    assertEquals(
      auth.deletedUsers,
      [],
      'THE bug this ordering exists to prevent: deleting the auth user while frames survive makes them un-ownable forever'
    );
    assertTrue(rows.profiles.has(USER_A), 'the profile row must be untouched — nothing is deleted when the purge fails');
    assertEquals(rows.consentsByUser.get(USER_A), 2, 'the consent events must be untouched when the purge fails');
    // Issue #125: multiple analysis sub-prefixes can each attempt their own storage.remove()
    // concurrently before any of them observes the others' failure, so the count is no longer
    // pinned to exactly 1 — what must hold is that NOTHING else (no row, no auth op) ever runs.
    assertTrue(ops.length > 0, 'at least one storage.remove attempt must have happened');
    assertTrue(
      ops.every((op) => op === 'storage.remove'),
      'the function must stop at the failed purge and touch nothing else — no row or auth op may appear'
    );
    assertEquals(storage.remainingPaths(), accountFrames(USER_A).sort(), 'the frames are still there — and still deletable, because the account still exists');
  }
);

Deno.test('deleteAccount: a storage list() outage fails closed — nothing at all is deleted', async () => {
  const ops: Op[] = [];
  const storage = new FakeStorage(accountFrames(USER_A), ops);
  storage.failListWith = 'storage API unreachable';
  const rows = new FakeRows({ [USER_A]: 1 }, [USER_A], ops);
  const auth = new FakeAuthAdmin(ops);

  const result = await deleteAccount(rows, storage, auth, { userId: USER_A });

  assertTrue(result.outcome === 'purge_failed', `expected purge_failed, got ${result.outcome}`);
  assertEquals(ops, [], 'a purge that cannot even enumerate the prefix must delete nothing, anywhere');
  assertEquals(auth.deletedUsers, []);
  assertTrue(rows.profiles.has(USER_A), 'the account survives a Storage outage, so the user can retry');
});

Deno.test('deleteAccount: a row-delete failure does NOT delete the auth user (the account remains, so a retry can converge)', async () => {
  const ops: Op[] = [];
  const storage = new FakeStorage(accountFrames(USER_A), ops);
  const rows = new FakeRows({ [USER_A]: 1 }, [USER_A], ops);
  rows.failProfileWith = 'deadlock detected';
  const auth = new FakeAuthAdmin(ops);

  const result = await deleteAccount(rows, storage, auth, { userId: USER_A });

  assertTrue(result.outcome === 'rows_failed', `expected rows_failed, got ${result.outcome}`);
  assertEquals(auth.deletedUsers, [], 'the auth user must survive a row failure — it is the retry key');
  assertEquals(
    storage.remainingPaths(),
    [],
    'the frames are already gone, which is the safe direction: a half-delete may leave rows, never media'
  );
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// (d) THE CONSENT TRAIL — purged, explicitly, by this function's own code.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

Deno.test(
  'deleteAccount: PURGES the consent trail explicitly — the decision is code, not an inherited FK cascade',
  async () => {
    // `consents.user_id references profiles(id) on delete cascade`, so the rows would vanish anyway
    // when the profile goes. That is precisely what `20260712020729_consents.sql`'s comment refuses
    // to accept as the answer ("must make a conscious purge-vs-retain-for-defence choice for this
    // table specifically, not inherit this FK's cascade by default").
    //
    // The choice is PURGE, and this test is what makes it a choice: deleteConsents() is called as
    // its own step, BEFORE the profile delete, so the consent rows are destroyed by code that says
    // so — and the count is reported. Reasoning is argued in full in delete-account.ts's header;
    // the short version is that Art. 17(3)(e) permits retaining what is NECESSARY to defend a legal
    // claim, and a consent row keyed only on a user_id we can no longer map to any person (email,
    // identity and profile all cascade out of auth.users) cannot defend anything. Retaining a
    // re-identifiable token of someone who asked to be forgotten, purely so we could find them
    // again, would be more invasive than the risk it hedges.
    //
    // If this test starts failing because someone changed the FK, that is the point: the decision
    // has exactly one home, and it is here.
    const ops: Op[] = [];
    const storage = new FakeStorage(accountFrames(USER_A), ops);
    const rows = new FakeRows({ [USER_A]: 3 }, [USER_A], ops);
    const auth = new FakeAuthAdmin(ops);

    const result = await deleteAccount(rows, storage, auth, { userId: USER_A });

    assertTrue(result.outcome === 'deleted', `expected deleted, got ${result.outcome}`);
    if (result.outcome === 'deleted') {
      assertEquals(result.consentEventsPurged, 3, 'every consent event is destroyed, and the count is reported, not silently swallowed');
    }
    assertEquals(rows.consentsByUser.get(USER_A), 0, 'no consent event survives the account delete');
    assertTrue(
      ops.indexOf('rows.deleteConsents') < ops.indexOf('rows.deleteProfile'),
      'consents must be deleted by their OWN step, before the profile cascade could do it implicitly — otherwise the decision is invisible and untested'
    );
    assertTrue(
      ops.indexOf('rows.deleteConsents') > ops.indexOf('storage.remove'),
      'even the consent purge happens after the storage purge — nothing is destroyed until the frames are provably gone'
    );
  }
);

Deno.test('deleteAccount: a consent-delete failure aborts before the profile and the auth user', async () => {
  const ops: Op[] = [];
  const storage = new FakeStorage(accountFrames(USER_A), ops);
  const rows = new FakeRows({ [USER_A]: 2 }, [USER_A], ops);
  rows.failConsentsWith = 'permission denied for table consents';
  const auth = new FakeAuthAdmin(ops);

  const result = await deleteAccount(rows, storage, auth, { userId: USER_A });

  assertTrue(result.outcome === 'rows_failed', `expected rows_failed, got ${result.outcome}`);
  // Issue #125: the account-level sweep can issue more than one storage.remove() (one per
  // analysis sub-prefix), so pin down the SHAPE rather than an exact array: some number of
  // storage.remove ops, then exactly one rows.deleteConsents, then nothing else.
  const consentsIndex = ops.indexOf('rows.deleteConsents');
  assertTrue(consentsIndex > 0, 'rows.deleteConsents must have been attempted, after at least one storage.remove');
  assertTrue(
    ops.slice(0, consentsIndex).every((op) => op === 'storage.remove'),
    'only storage.remove ops may precede rows.deleteConsents'
  );
  assertEquals(
    ops.slice(consentsIndex),
    ['rows.deleteConsents'],
    'nothing may run after the failed consents delete — no profile delete, no auth delete'
  );
  assertTrue(rows.profiles.has(USER_A), 'the profile survives');
  assertEquals(auth.deletedUsers, [], 'the auth user survives');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// The concurrency race the blocking purge alone cannot close: a frame uploaded MID-DELETE.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

Deno.test(
  'deleteAccount: a frame uploaded mid-delete (concurrent analyze-form) is caught by the post-delete sweep',
  async () => {
    // `analyze-form` reserves its row, calls the model, THEN uploads frames (#88's ordering). A call
    // that reserved before our row delete can therefore land objects in the bucket after we already
    // swept the prefix — orphaning them, since by then the account is gone. The second sweep exists
    // for exactly this.
    const ops: Op[] = [];
    const storage = new FakeStorage(accountFrames(USER_A), ops);
    const rows = new FakeRows({ [USER_A]: 1 }, [USER_A], ops);
    const auth = new FakeAuthAdmin(ops);
    const lateFrame = `${USER_A}/${ANALYSIS_2}/frame-99.jpg`;
    storage.resurrectPaths = [lateFrame];
    auth.onDeleted = () => storage.resurrect(); // the in-flight upload lands right about now

    const result = await deleteAccount(rows, storage, auth, { userId: USER_A });

    assertTrue(result.outcome === 'deleted', `expected deleted, got ${result.outcome}`);
    assertEquals(
      storage.remainingPaths(),
      [],
      'the late-landing frame must be swept too — zero orphans is the whole promise, and a race is not an excuse'
    );
    assertEquals(auth.deletedUsers, [USER_A]);
  }
);

Deno.test(
  'deleteAccount: if the post-delete sweep cannot clear a late-landing frame, it reports orphans_remaining as a SUCCESS (200), and alerts only via the log — never a non-2xx',
  async () => {
    // Fixed after PR #121 review: by the time this outcome is reached, storage, rows, AND the
    // auth.users record are ALL already deleted — the account is irreversibly gone. The original
    // implementation returned a 500 with a body carrying BOTH `deleted: true` and `error`/`code`,
    // which (a) violates docs/architecture.md's "every non-2xx body is { error, code }" contract
    // (this body was neither shape) and (b) is unconsumable by any correct client: a client that
    // sees a non-2xx reports failure and tells the user to retry, but retrying only ever 401s
    // (there is no account left to authenticate with), and "still active, try again" is false on
    // every clause. The ops response — the exact prefix a human must clean — belongs in the
    // error-level log, not in the HTTP response the end user's client has to render.
    const ops: Op[] = [];
    const storage = new FakeStorage(accountFrames(USER_A), ops);
    const rows = new FakeRows({ [USER_A]: 1 }, [USER_A], ops);
    const auth = new FakeAuthAdmin(ops);
    storage.resurrectPaths = [`${USER_A}/${ANALYSIS_2}/frame-99.jpg`];
    auth.onDeleted = () => {
      storage.resurrect();
      storage.failRemoveWith = 'storage went down right after the auth user was deleted';
    };

    const events: Array<Record<string, unknown>> = [];
    const result = await deleteAccount(rows, storage, auth, { userId: USER_A, log: (e) => events.push(e) });

    assertTrue(result.outcome === 'orphans_remaining', `expected orphans_remaining, got ${result.outcome}`);

    // The HTTP contract: 200, success body, orphansRemaining flag, no error/code anywhere.
    assertEquals(httpStatusForAccountOutcome('orphans_remaining'), 200, 'a 200 — the account is fully deleted, a retry cannot help, and telling the client otherwise is false');
    const body = accountResponseBodyForOutcome(result);
    assertEquals(body.deleted, true, 'the account really is gone, and the body must say so');
    assertEquals(body.orphansRemaining, true, 'the client needs the flag to soften its copy ("some media may take longer"), not to imply the account survived');
    assertEquals(body.error, undefined, 'no error key — this is not the error shape');
    assertEquals(body.code, undefined, 'no code key — this is not the error shape');
    assertTrue(typeof body.purgedObjectCount === 'number', 'the success body fields must still be present');
    assertTrue(typeof body.consentEventsPurged === 'number', 'consentEventsPurged must be the real count, not omitted or zeroed');

    // The ops alarm lives ONLY in the log, since the HTTP response now carries no actionable detail.
    assertTrue(
      events.some((e) => e.event === 'delete_account.orphans_remaining' && e.level === 'error'),
      'this MUST be logged at error level: it is unrecoverable without a human, and a silent orphan is the exact failure this whole function exists to prevent'
    );
    assertTrue(
      events.some((e) => e.event === 'delete_account.orphans_remaining' && typeof e.prefix === 'string'),
      'the log must name the prefix a human has to go clean up — that is now the ONLY alarm, since the response is a clean 200'
    );
  }
);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Idempotency — every step is a safe no-op the second time. Retries converge, they do not error.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

Deno.test('deleteAccount: a retry after a partial failure converges (idempotent end to end)', async () => {
  const ops: Op[] = [];
  const storage = new FakeStorage(accountFrames(USER_A), ops);
  const rows = new FakeRows({ [USER_A]: 2 }, [USER_A], ops);
  const auth = new FakeAuthAdmin(ops);

  // Attempt 1: the auth admin API is down. Storage and rows are already gone by then.
  auth.failWith = 'auth service unavailable';
  const first = await deleteAccount(rows, storage, auth, { userId: USER_A });
  assertTrue(first.outcome === 'auth_delete_failed', `expected auth_delete_failed, got ${first.outcome}`);
  assertEquals(storage.remainingPaths(), [], 'no frames survive even a partial delete');
  assertTrue(!rows.profiles.has(USER_A), 'the rows are already gone');

  // Attempt 2: the client retries with the same (still valid) JWT. Nothing errors; it finishes.
  auth.failWith = null;
  const second = await deleteAccount(rows, storage, auth, { userId: USER_A });

  assertEquals(
    second,
    { outcome: 'deleted', purgedObjectCount: 0, consentEventsPurged: 0, profileExisted: false },
    'the retry must converge: an empty prefix, zero rows, and a still-present auth user is a SUCCESS, not an error'
  );
  assertEquals(auth.deletedUsers, [USER_A]);
});

Deno.test('deleteAccount: an account with nothing in it at all deletes cleanly (never uploaded, never consented)', async () => {
  const ops: Op[] = [];
  const storage = new FakeStorage([], ops);
  const rows = new FakeRows({ [USER_A]: 0 }, [USER_A], ops);
  const auth = new FakeAuthAdmin(ops);

  const result = await deleteAccount(rows, storage, auth, { userId: USER_A });

  assertEquals(result, { outcome: 'deleted', purgedObjectCount: 0, consentEventsPurged: 0, profileExisted: true });
  assertEquals(storage.removeCalls, [], 'remove() must never be called when there is nothing to remove');
  assertEquals(auth.deletedUsers, [USER_A]);
});

Deno.test('deleteAccount: an auth user with no profile row still deletes (a half-provisioned account is not a dead end)', async () => {
  const ops: Op[] = [];
  const storage = new FakeStorage([], ops);
  const rows = new FakeRows({}, [], ops); // no profile row
  const auth = new FakeAuthAdmin(ops);

  const result = await deleteAccount(rows, storage, auth, { userId: USER_A });

  assertEquals(result, { outcome: 'deleted', purgedObjectCount: 0, consentEventsPurged: 0, profileExisted: false });
  assertEquals(auth.deletedUsers, [USER_A], 'the auth user must still be removed — otherwise the account is undeletable forever');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Structured logging at the boundaries — the only evidence when a delete half-succeeds in prod.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

Deno.test('deleteAccount: emits a structured event at every boundary, in order', async () => {
  const storage = new FakeStorage(accountFrames(USER_A));
  const rows = new FakeRows({ [USER_A]: 1 }, [USER_A]);
  const auth = new FakeAuthAdmin();
  const events: Array<Record<string, unknown>> = [];

  await deleteAccount(rows, storage, auth, { userId: USER_A, log: (e) => events.push(e) });

  assertEquals(
    events.map((e) => e.event),
    [
      'delete_account.started',
      'delete_account.storage_purged',
      'delete_account.consents_purged',
      'delete_account.rows_deleted',
      'delete_account.auth_user_deleted',
      'delete_account.completed',
    ],
    'a silent half-delete is only diagnosable if the boundary logs already exist'
  );
  const completed = events[events.length - 1];
  assertEquals(completed.purgedObjectCount, 6);
  assertTrue(typeof completed.durationMs === 'number', 'the completion event must carry a duration');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Pure HTTP-mapping helpers — the status/body matrix settled after PR #121 review. `deleted` and
// `orphans_remaining` are BOTH 200 (the account is fully gone either way); the three genuine
// failures are 503. No response body may ever carry both `deleted` and `error`/`code` at once —
// that mixed shape was the bug.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

Deno.test('httpStatusForAccountOutcome maps every outcome to the documented status — matrix from delete-account.ts', () => {
  const cases: Array<[DeleteAccountResult['outcome'], number]> = [
    ['deleted', 200],
    ['orphans_remaining', 200], // NOT 500 — fixed post-#121-review, see the doc comment on this outcome
    ['purge_failed', 503],
    ['rows_failed', 503],
    ['auth_delete_failed', 503],
  ];
  for (const [outcome, status] of cases) {
    assertEquals(httpStatusForAccountOutcome(outcome), status, `outcome "${outcome}" should map to ${status}`);
  }
});

Deno.test('accountResponseBodyForOutcome: the two success outcomes get the success shape, the three failures get { error, code } — never both on one body', () => {
  assertEquals(
    accountResponseBodyForOutcome({ outcome: 'deleted', purgedObjectCount: 6, consentEventsPurged: 2, profileExisted: true }),
    { deleted: true, purgedObjectCount: 6, consentEventsPurged: 2 }
  );

  assertEquals(
    accountResponseBodyForOutcome({ outcome: 'orphans_remaining', reason: 'boom', purgedObjectCount: 6, consentEventsPurged: 2 }),
    { deleted: true, orphansRemaining: true, purgedObjectCount: 6, consentEventsPurged: 2 },
    'orphans_remaining must return the SUCCESS shape plus the flag — not an error body'
  );

  const failureCases: DeleteAccountResult[] = [
    { outcome: 'purge_failed', reason: 'boom' },
    { outcome: 'rows_failed', reason: 'boom', purgedObjectCount: 1 },
    { outcome: 'auth_delete_failed', reason: 'boom', purgedObjectCount: 1 },
  ];
  for (const result of failureCases) {
    const body = accountResponseBodyForOutcome(result);
    assertEquals(body.code, result.outcome);
    assertTrue(typeof body.error === 'string' && (body.error as string).length > 0, `${result.outcome} needs a human-readable error`);
    assertTrue(body.deleted === undefined, `${result.outcome} must never claim the account was deleted`);
    assertTrue(!JSON.stringify(body).includes('boom'), 'the raw internal reason must never leak to the caller');
  }
});

Deno.test(
  'accountResponseBodyForOutcome: NO response body, for ANY outcome, ever carries both `deleted` and `error`/`code` — the bug PR #121 review caught',
  () => {
    const allOutcomes: DeleteAccountResult[] = [
      { outcome: 'deleted', purgedObjectCount: 0, consentEventsPurged: 0, profileExisted: true },
      { outcome: 'orphans_remaining', reason: 'boom', purgedObjectCount: 0, consentEventsPurged: 0 },
      { outcome: 'purge_failed', reason: 'boom' },
      { outcome: 'rows_failed', reason: 'boom', purgedObjectCount: 0 },
      { outcome: 'auth_delete_failed', reason: 'boom', purgedObjectCount: 0 },
    ];
    for (const result of allOutcomes) {
      const body = accountResponseBodyForOutcome(result);
      const hasDeleted = 'deleted' in body && body.deleted !== undefined;
      const hasError = ('error' in body && body.error !== undefined) || ('code' in body && body.code !== undefined);
      assertTrue(
        !(hasDeleted && hasError),
        `outcome "${result.outcome}" produced a body with BOTH deleted and error/code: ${JSON.stringify(body)}`
      );
      // And the HTTP status must agree with which shape was returned: a 2xx body must never be
      // paired with a status this project's own error contract would read as a failure, and vice
      // versa — this is the mismatch a client's generic { error, code } unwrapper would trip on.
      const status = httpStatusForAccountOutcome(result.outcome);
      if (hasDeleted) {
        assertEquals(status, 200, `"${result.outcome}" returns a success body, so its status must be 200, got ${status}`);
      } else {
        assertEquals(status, 503, `"${result.outcome}" returns an error body, so its status must be non-2xx, got ${status}`);
      }
    }
  }
);

Deno.test('DeleteAccountErrorCode: the three failure outcomes are exactly its members, matching accountResponseBodyForOutcome\'s `code` field', () => {
  // A stringly-typed `code: string` is how the original mixed-body bug survived review — nothing
  // forced a switch over it to be exhaustive. This assignment is the compiler-adjacent guarantee:
  // if a failure outcome is ever renamed or a new one added without updating
  // DeleteAccountErrorCode to match, this array literal (typed against the exported union) fails
  // to compile, not just fails at runtime.
  const codes: DeleteAccountErrorCode[] = ['purge_failed', 'rows_failed', 'auth_delete_failed'];
  assertEquals(codes.length, 3);

  const failureResults: DeleteAccountResult[] = [
    { outcome: 'purge_failed', reason: 'x' },
    { outcome: 'rows_failed', reason: 'x', purgedObjectCount: 0 },
    { outcome: 'auth_delete_failed', reason: 'x', purgedObjectCount: 0 },
  ];
  for (const result of failureResults) {
    const code: DeleteAccountErrorCode = result.outcome as DeleteAccountErrorCode;
    const body = accountResponseBodyForOutcome(result);
    assertEquals(body.code, code);
  }
});
