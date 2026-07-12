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
  batchedRemove,
  deleteAccount,
  httpStatusForAccountOutcome,
  REMOVE_BATCH_SIZE,
  type AccountRows,
  type AuthAdmin,
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

  list(prefix: string, options: { limit: number; offset: number }): Promise<StorageEntry[]> {
    this.listCalls.push({ prefix, limit: options.limit, offset: options.offset });
    if (this.failListWith) {
      return Promise.reject(new Error(this.failListWith));
    }
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
    return Promise.resolve(page);
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

    assertEquals(
      ops,
      ['storage.remove', 'rows.deleteConsents', 'rows.deleteProfile', 'auth.deleteUser'],
      'storage must be purged BEFORE any row is deleted, and the auth user LAST — the cascade from ' +
        'auth.users would otherwise take the rows (and media_paths) with it, leaving storage.objects ' +
        'unreachable, un-enumerable, and orphaned forever (storage.objects has no FK to auth.users)'
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
    assertEquals(ops, ['storage.remove'], 'the function must stop at the failed purge and touch nothing else');
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
  assertEquals(ops, ['storage.remove', 'rows.deleteConsents'], 'it must stop at the failed step');
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
  'deleteAccount: if the post-delete sweep cannot clear a late-landing frame, it reports orphans_remaining (loudly) rather than a clean delete',
  async () => {
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
    assertEquals(httpStatusForAccountOutcome('orphans_remaining'), 500, 'not a 503 — a retry cannot help, the account is already gone');
    assertTrue(
      events.some((e) => e.event === 'delete_account.orphans_remaining' && e.level === 'error'),
      'this MUST be logged at error level: it is unrecoverable without a human, and a silent orphan is the exact failure this whole function exists to prevent'
    );
    assertTrue(
      events.some((e) => e.event === 'delete_account.orphans_remaining' && typeof e.prefix === 'string'),
      'the log must name the prefix a human has to go clean up'
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
// Pure HTTP-mapping helpers.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

Deno.test('httpStatusForAccountOutcome maps every outcome to the documented status', () => {
  const cases: Array<[DeleteAccountResult['outcome'], number]> = [
    ['deleted', 200],
    ['purge_failed', 503],
    ['rows_failed', 503],
    ['auth_delete_failed', 503],
    ['orphans_remaining', 500],
  ];
  for (const [outcome, status] of cases) {
    assertEquals(httpStatusForAccountOutcome(outcome), status, `outcome "${outcome}" should map to ${status}`);
  }
});

Deno.test('accountResponseBodyForOutcome returns { deleted: true } on success and a structured { error, code } otherwise', () => {
  assertEquals(
    accountResponseBodyForOutcome({ outcome: 'deleted', purgedObjectCount: 6, consentEventsPurged: 2, profileExisted: true }),
    { deleted: true, purgedObjectCount: 6, consentEventsPurged: 2 }
  );

  for (const result of [
    { outcome: 'purge_failed', reason: 'boom' },
    { outcome: 'rows_failed', reason: 'boom', purgedObjectCount: 1 },
    { outcome: 'auth_delete_failed', reason: 'boom', purgedObjectCount: 1 },
  ] as const) {
    const body = accountResponseBodyForOutcome(result);
    assertEquals(body.code, result.outcome);
    assertTrue(typeof body.error === 'string' && (body.error as string).length > 0, `${result.outcome} needs a human-readable error`);
    assertTrue(body.deleted === undefined, `${result.outcome} must never claim the account was deleted`);
    assertTrue(!JSON.stringify(body).includes('boom'), 'the raw internal reason must never leak to the caller');
  }

  // The one failure that DOES report deleted: the account really is gone, and saying otherwise
  // would send the user back to retry a delete that already happened (and would only 401).
  const orphaned = accountResponseBodyForOutcome({ outcome: 'orphans_remaining', reason: 'boom', purgedObjectCount: 6 });
  assertEquals(orphaned.deleted, true);
  assertEquals(orphaned.code, 'orphans_remaining');
});
