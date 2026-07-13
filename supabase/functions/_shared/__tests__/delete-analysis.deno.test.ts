/**
 * Regression locks for `_shared/delete-analysis.ts` — the purge-and-delete core behind
 * `DELETE /functions/v1/analysis/:id` (issue #57, closing issue #3's Storage-orphan privacy
 * defect). These tests mock `AnalysesTable`/`StorageBucket` rather than a real Postgres/Storage
 * connection, so they prove the CONTRACT: ordering, authorization, idempotency, and the
 * nested-prefix recursion `docs/privacy-checklist-m7.md` calls out by name. The real Deno/`npm:`
 * client wiring (`delete-analysis-client.ts`) is untested for the same reason
 * `ai-guard-client.ts` is untested — a thin factory over runtime globals with nothing pure in it.
 *
 * DENO-ONLY, DELIBERATELY (issue #90 convention — see `knowledge-guard.deno.test.ts`'s header
 * for the fuller rationale): named `.deno.test.ts` so `jest.config.js`'s
 * `testPathIgnorePatterns` skips it and only `deno test` (`npm run test:edge`) runs it, even
 * though `delete-analysis.ts` itself has no Deno-only syntax and *could* run under Jest — kept
 * consistent with this issue's own instruction to prove these properties "under the #90
 * harness."
 */
import {
  DEFAULT_PAGE_SIZE,
  deleteAnalysis,
  httpStatusForOutcome,
  isValidUuid,
  parseAnalysisIdFromUrl,
  responseBodyForOutcome,
  type AnalysesTable,
  type AnalysisOwnershipRow,
  type DeleteAnalysisResult,
  type LogEvent,
  type StorageBucket,
  type StorageEntry,
} from '../delete-analysis.ts';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

class FakeAnalysesTable implements AnalysesTable {
  readonly findByIdCalls: string[] = [];
  readonly markDeletedCalls: Array<{ id: string; userId: string }> = [];

  constructor(
    private row: AnalysisOwnershipRow | null,
    private markDeletedResult: { updated: boolean } = { updated: true }
  ) {}

  findById(id: string): Promise<AnalysisOwnershipRow | null> {
    this.findByIdCalls.push(id);
    return Promise.resolve(this.row);
  }

  markDeleted(id: string, userId: string): Promise<{ updated: boolean }> {
    this.markDeletedCalls.push({ id, userId });
    return Promise.resolve(this.markDeletedResult);
  }
}

/** A tiny in-memory "bucket": a flat set of full object paths, with folders inferred from `/`. */
class FakeStorage implements StorageBucket {
  private objects: Set<string>;
  readonly listCalls: Array<{ prefix: string; limit: number; offset: number }> = [];
  readonly removeCalls: string[][] = [];
  /** When set, remove() reports this as an error instead of removing anything. */
  failRemoveWith: string | null = null;
  /** When true, remove() silently keeps the first path of each batch — simulates a partial, unreported failure. */
  corruptRemove = false;

  constructor(initialPaths: string[]) {
    this.objects = new Set(initialPaths);
  }

  remainingPaths(): string[] {
    return Array.from(this.objects).sort();
  }

  /**
   * Test-only seam for simulating the #132 race: adds an object directly, bypassing `remove()`
   * bookkeeping, so a `markDeleted` fake can simulate an `attach_media_paths` commit landing in
   * the gap between the first purge (A) and the row's `deleted_at` transition (B).
   */
  injectObject(path: string): void {
    this.objects.add(path);
  }

  list(prefix: string, options: { limit: number; offset: number }): Promise<StorageEntry[]> {
    this.listCalls.push({ prefix, limit: options.limit, offset: options.offset });
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
    this.removeCalls.push(paths);
    if (this.failRemoveWith) {
      return Promise.resolve({ error: this.failRemoveWith });
    }
    for (const path of paths) {
      if (this.corruptRemove && path === paths[0]) {
        continue; // silently "fails" to remove this one path, no error reported
      }
      this.objects.delete(path);
    }
    return Promise.resolve({ error: null });
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
const ANALYSIS_ID = '33333333-3333-3333-3333-333333333333';
const PREFIX = `${USER_A}/${ANALYSIS_ID}/`;

// ---------------------------------------------------------------------------
// 1. Happy path
// ---------------------------------------------------------------------------

Deno.test('deleteAnalysis: happy path — purges every frame under the prefix, then marks the row deleted', async () => {
  const table = new FakeAnalysesTable({ id: ANALYSIS_ID, user_id: USER_A, deleted_at: null });
  const storage = new FakeStorage([`${PREFIX}frame-01.jpg`, `${PREFIX}frame-02.jpg`]);

  const result = await deleteAnalysis(table, storage, { analysisId: ANALYSIS_ID, callerUserId: USER_A });

  assertEquals(result, { outcome: 'deleted', alreadyDeleted: false, purgedObjectCount: 2 });
  assertEquals(storage.remainingPaths(), [], 'no objects should survive under the purged prefix');
  assertTrue(storage.removeCalls.length === 1, 'remove() should be called exactly once with the batch');
  assertEquals(
    [...storage.removeCalls[0]].sort(),
    [`${PREFIX}frame-01.jpg`, `${PREFIX}frame-02.jpg`],
    'remove() should receive full paths, prefix included'
  );
  assertEquals(table.markDeletedCalls, [{ id: ANALYSIS_ID, userId: USER_A }]);
});

// ---------------------------------------------------------------------------
// 2. Not-yours is refused, explicitly, before any Storage side effect
// ---------------------------------------------------------------------------

Deno.test('deleteAnalysis: refuses to purge or delete an analysis owned by a different user', async () => {
  const table = new FakeAnalysesTable({ id: ANALYSIS_ID, user_id: USER_B, deleted_at: null });
  const storage = new FakeStorage([`${USER_B}/${ANALYSIS_ID}/frame-01.jpg`]);

  const result = await deleteAnalysis(table, storage, {
    analysisId: ANALYSIS_ID,
    callerUserId: USER_A, // not the owner
  });

  assertEquals(result, { outcome: 'not_yours' });
  assertEquals(storage.listCalls, [], "must never touch Storage for an analysis that is not the caller's");
  assertEquals(storage.removeCalls, [], "must never remove anything for an analysis that is not the caller's");
  assertEquals(table.markDeletedCalls, [], 'must never attempt to mark someone else\'s row deleted');
  assertEquals(storage.remainingPaths(), [`${USER_B}/${ANALYSIS_ID}/frame-01.jpg`], "user B's frame survives untouched");
});

Deno.test('deleteAnalysis: not_found for an id that does not exist, without touching Storage', async () => {
  const table = new FakeAnalysesTable(null);
  const storage = new FakeStorage([]);

  const result = await deleteAnalysis(table, storage, { analysisId: ANALYSIS_ID, callerUserId: USER_A });

  assertEquals(result, { outcome: 'not_found' });
  assertEquals(storage.listCalls, []);
});

// ---------------------------------------------------------------------------
// 3. A storage failure never orphans — the row is left untouched, not marked deleted
// ---------------------------------------------------------------------------

Deno.test('deleteAnalysis: a remove() error leaves the row undeleted and reports purge_failed', async () => {
  const table = new FakeAnalysesTable({ id: ANALYSIS_ID, user_id: USER_A, deleted_at: null });
  const storage = new FakeStorage([`${PREFIX}frame-01.jpg`]);
  storage.failRemoveWith = 'simulated storage outage';

  const result = await deleteAnalysis(table, storage, { analysisId: ANALYSIS_ID, callerUserId: USER_A });

  assertTrue(result.outcome === 'purge_failed', `expected purge_failed, got ${result.outcome}`);
  assertEquals(
    table.markDeletedCalls,
    [],
    'the row must never be marked deleted when the purge fails — that would orphan the frame'
  );
  assertEquals(storage.remainingPaths(), [`${PREFIX}frame-01.jpg`], 'the frame must still be present after a failed purge');
});

Deno.test('deleteAnalysis: a silently-incomplete remove() is still caught by the post-purge verification list', async () => {
  // remove() reports no error but (simulating a real-world partial failure) leaves one object
  // behind — this is exactly what the "verify" step in delete-analysis.ts's purgePrefix exists
  // to catch, per issue #57's own ordering directive ("delete the Storage objects first,
  // verify, then the row").
  const table = new FakeAnalysesTable({ id: ANALYSIS_ID, user_id: USER_A, deleted_at: null });
  const storage = new FakeStorage([`${PREFIX}frame-01.jpg`]);
  storage.corruptRemove = true;

  const result = await deleteAnalysis(table, storage, { analysisId: ANALYSIS_ID, callerUserId: USER_A });

  assertTrue(result.outcome === 'purge_failed', `expected purge_failed, got ${result.outcome}`);
  assertEquals(
    table.markDeletedCalls,
    [],
    'a leftover object after remove() must still block the row from being marked deleted'
  );
  assertEquals(storage.remainingPaths(), [`${PREFIX}frame-01.jpg`], 'the silently-unremoved frame is still there');
});

// ---------------------------------------------------------------------------
// 4. Idempotency — a repeat delete converges instead of erroring
// ---------------------------------------------------------------------------

Deno.test('deleteAnalysis: a repeat call on an already-purged, already-deleted analysis converges (idempotent)', async () => {
  const table = new FakeAnalysesTable(
    { id: ANALYSIS_ID, user_id: USER_A, deleted_at: new Date().toISOString() },
    { updated: false }
  );
  const storage = new FakeStorage([]); // already purged by the first call

  const result = await deleteAnalysis(table, storage, { analysisId: ANALYSIS_ID, callerUserId: USER_A });

  assertEquals(result, { outcome: 'deleted', alreadyDeleted: true, purgedObjectCount: 0 });
});

Deno.test(
  'deleteAnalysis: still purges Storage for a row already soft-deleted via the direct client UPDATE path (issue #2) — closing the bypass',
  async () => {
    // The client can soft-delete `deleted_at` directly (issue #2's UPDATE policy) without ever
    // calling this function, which would normally leave frames orphaned. deleteAnalysis() does
    // not gate the purge on `deleted_at` for exactly this reason: if the client DOES eventually
    // call this endpoint for that analysis, the purge still happens.
    const table = new FakeAnalysesTable(
      { id: ANALYSIS_ID, user_id: USER_A, deleted_at: new Date().toISOString() },
      { updated: false }
    );
    const storage = new FakeStorage([`${PREFIX}frame-01.jpg`]); // never purged by the direct soft-delete

    const result = await deleteAnalysis(table, storage, { analysisId: ANALYSIS_ID, callerUserId: USER_A });

    assertEquals(result, { outcome: 'deleted', alreadyDeleted: true, purgedObjectCount: 1 });
    assertEquals(storage.remainingPaths(), [], 'the previously-orphaned frame must be gone after this call');
  }
);

Deno.test('deleteAnalysis: calling it twice in a row converges both times with no error', async () => {
  let deletedAt: string | null = null;
  const markDeletedCalls: Array<{ id: string; userId: string }> = [];
  const table: AnalysesTable = {
    findById: (id) => Promise.resolve({ id, user_id: USER_A, deleted_at: deletedAt }),
    markDeleted: (id, userId) => {
      markDeletedCalls.push({ id, userId });
      if (deletedAt) return Promise.resolve({ updated: false });
      deletedAt = new Date().toISOString();
      return Promise.resolve({ updated: true });
    },
  };
  const storage = new FakeStorage([`${PREFIX}frame-01.jpg`]);

  const first = await deleteAnalysis(table, storage, { analysisId: ANALYSIS_ID, callerUserId: USER_A });
  const second = await deleteAnalysis(table, storage, { analysisId: ANALYSIS_ID, callerUserId: USER_A });

  assertEquals(first, { outcome: 'deleted', alreadyDeleted: false, purgedObjectCount: 1 });
  assertEquals(second, { outcome: 'deleted', alreadyDeleted: true, purgedObjectCount: 0 });
  assertEquals(markDeletedCalls.length, 2, 'markDeleted is called on every attempt; the second is a safe no-op');
});

// ---------------------------------------------------------------------------
// 5. The second purge (#132) — a frame landing in the gap between the first purge (A) and
//    markDeleted committing (B) must not survive as an orphan.
// ---------------------------------------------------------------------------

Deno.test(
  'deleteAnalysis: a frame that lands between the first purge and markDeleted committing is caught by the second purge (#132)',
  async () => {
    const storage = new FakeStorage([`${PREFIX}frame-01.jpg`]);
    const markDeletedCalls: Array<{ id: string; userId: string }> = [];
    // Simulates attach_media_paths committing a NEW frame in the A/B gap: this fake "writes" the
    // late frame as a side effect of markDeleted committing, exactly the race #132 describes —
    // the row still looked live (`deleted_at IS NULL`) when the write happened.
    const table: AnalysesTable = {
      findById: (id) => Promise.resolve({ id, user_id: USER_A, deleted_at: null }),
      markDeleted: (id, userId) => {
        markDeletedCalls.push({ id, userId });
        storage.injectObject(`${PREFIX}frame-late.jpg`);
        return Promise.resolve({ updated: true });
      },
    };

    const result = await deleteAnalysis(table, storage, { analysisId: ANALYSIS_ID, callerUserId: USER_A });

    assertEquals(
      result,
      { outcome: 'deleted', alreadyDeleted: false, purgedObjectCount: 2 },
      'the second purge must count toward the total — the orphan was real and was removed'
    );
    assertEquals(
      storage.remainingPaths(),
      [],
      'the late-arriving frame must not survive as an orphan under a prefix already reported purged'
    );
    assertEquals(markDeletedCalls, [{ id: ANALYSIS_ID, userId: USER_A }]);
  }
);

Deno.test(
  'deleteAnalysis: logs the caught orphan from the second purge, not just the total count',
  async () => {
    const storage = new FakeStorage([]);
    const table: AnalysesTable = {
      findById: (id) => Promise.resolve({ id, user_id: USER_A, deleted_at: null }),
      markDeleted: () => {
        storage.injectObject(`${PREFIX}frame-late.jpg`);
        return Promise.resolve({ updated: true });
      },
    };
    const events: Record<string, unknown>[] = [];
    const log: LogEvent = (event) => events.push(event);

    const result = await deleteAnalysis(table, storage, { analysisId: ANALYSIS_ID, callerUserId: USER_A, log });

    assertTrue(result.outcome === 'deleted', `expected deleted, got ${result.outcome}`);
    const orphanEvents = events.filter((e) => e.event === 'delete_analysis.second_purge_caught_orphan');
    assertEquals(orphanEvents.length, 1, 'a non-zero second purge must produce exactly one log event for it');
    assertEquals(orphanEvents[0].secondPurgeObjectCount, 1);
    assertEquals(orphanEvents[0].analysisId, ANALYSIS_ID);
  }
);

Deno.test(
  'deleteAnalysis: an empty second purge (the common case) logs nothing extra',
  async () => {
    const storage = new FakeStorage([`${PREFIX}frame-01.jpg`]);
    const table = new FakeAnalysesTable({ id: ANALYSIS_ID, user_id: USER_A, deleted_at: null });
    const events: Record<string, unknown>[] = [];
    const log: LogEvent = (event) => events.push(event);

    await deleteAnalysis(table, storage, { analysisId: ANALYSIS_ID, callerUserId: USER_A, log });

    assertEquals(events, [], 'nothing landed in the gap, so the second purge must stay silent');
  }
);

Deno.test(
  'deleteAnalysis: does NOT run a second purge when the row was already deleted (alreadyDeleted) — no fresh A/B gap to close',
  async () => {
    const storage = new FakeStorage([]);
    // The row is already soft-deleted before this call starts (e.g. issue #2's client bypass).
    // If a second purge ran here anyway, it would catch this injected object; the requirement is
    // that it must NOT run on this path at all, so the object is left exactly as markDeleted put it.
    const table: AnalysesTable = {
      findById: (id) => Promise.resolve({ id, user_id: USER_A, deleted_at: new Date().toISOString() }),
      markDeleted: () => {
        storage.injectObject(`${PREFIX}frame-injected-by-markDeleted.jpg`);
        return Promise.resolve({ updated: false }); // already deleted — no transition happened here
      },
    };

    const result = await deleteAnalysis(table, storage, { analysisId: ANALYSIS_ID, callerUserId: USER_A });

    assertEquals(
      result,
      { outcome: 'deleted', alreadyDeleted: true, purgedObjectCount: 0 },
      'purgedObjectCount must reflect only the first purge — the second purge must never have run'
    );
    assertEquals(
      storage.remainingPaths(),
      [`${PREFIX}frame-injected-by-markDeleted.jpg`],
      'proves no second purge ran: an object written after the first purge on this path survives untouched'
    );
  }
);

Deno.test(
  'deleteAnalysis: a second purge that cannot fully clear the prefix reports orphans_remaining, never a false "deleted" success',
  async () => {
    const storage = new FakeStorage([`${PREFIX}frame-01.jpg`]);
    const table: AnalysesTable = {
      findById: (id) => Promise.resolve({ id, user_id: USER_A, deleted_at: null }),
      markDeleted: () => {
        // A late frame lands, AND this time its removal genuinely fails (a real Storage-side
        // problem, not just a race) — purgePrefix's fail-closed verification must throw rather
        // than let this be reported as a clean, complete delete.
        storage.injectObject(`${PREFIX}frame-late.jpg`);
        storage.failRemoveWith = 'simulated storage outage on the second purge';
        return Promise.resolve({ updated: true });
      },
    };
    const events: Record<string, unknown>[] = [];
    const log: LogEvent = (event) => events.push(event);

    const result = await deleteAnalysis(table, storage, { analysisId: ANALYSIS_ID, callerUserId: USER_A, log });

    assertTrue(result.outcome === 'orphans_remaining', `expected orphans_remaining, got ${result.outcome}`);
    if (result.outcome === 'orphans_remaining') {
      assertEquals(result.purgedObjectCount, 1, 'the first purge still counts — only the second purge failed');
      assertTrue(result.reason.length > 0, 'a human-readable reason must be carried on the outcome');
    }
    assertEquals(
      storage.remainingPaths(),
      [`${PREFIX}frame-late.jpg`],
      'the row is already deleted; the surviving orphan is reported, not silently claimed as purged'
    );
    const failedEvents = events.filter((e) => e.event === 'delete_analysis.second_purge_failed');
    assertEquals(failedEvents.length, 1, 'a failed second purge must be logged at error level as the sole alarm');
    assertEquals(failedEvents[0].level, 'error');

    assertEquals(httpStatusForOutcome(result.outcome), 200, 'orphans_remaining is still a 200 — the row really is gone');
    assertEquals(
      responseBodyForOutcome(result),
      { deleted: true, orphansRemaining: true },
      'the response body must stay in the success shape, never mixed with an error code'
    );
  }
);

// ---------------------------------------------------------------------------
// The nested-prefix trap (docs/privacy-checklist-m7.md) — recursion + pagination
// ---------------------------------------------------------------------------

Deno.test('deleteAnalysis: recurses into a nested folder under the prefix instead of skipping it', async () => {
  // A flat, non-recursive list() at PREFIX would see one "folder" entry (`variant`) and, if
  // naively treated as a removable name, either fail to remove it or (worse) report success
  // while orphaning everything inside it. This is the exact trap the checklist names.
  const table = new FakeAnalysesTable({ id: ANALYSIS_ID, user_id: USER_A, deleted_at: null });
  const storage = new FakeStorage([`${PREFIX}frame-01.jpg`, `${PREFIX}variant/frame-01-alt.jpg`]);

  const result = await deleteAnalysis(table, storage, { analysisId: ANALYSIS_ID, callerUserId: USER_A });

  assertEquals(result, { outcome: 'deleted', alreadyDeleted: false, purgedObjectCount: 2 });
  assertEquals(storage.remainingPaths(), [], 'the nested object must be purged too, not left behind');
});

Deno.test('deleteAnalysis: paginates a prefix with more objects than one page', async () => {
  const table = new FakeAnalysesTable({ id: ANALYSIS_ID, user_id: USER_A, deleted_at: null });
  const pageSize = 3;
  const paths = Array.from({ length: 7 }, (_, i) => `${PREFIX}frame-${String(i).padStart(2, '0')}.jpg`);
  const storage = new FakeStorage(paths);

  const result = await deleteAnalysis(table, storage, {
    analysisId: ANALYSIS_ID,
    callerUserId: USER_A,
    pageSize,
  });

  assertTrue(result.outcome === 'deleted', `expected deleted, got ${result.outcome}`);
  if (result.outcome === 'deleted') {
    assertEquals(result.purgedObjectCount, 7, 'every object across every page must be collected, not just the first page');
  }
  assertEquals(storage.remainingPaths(), []);
  assertTrue(storage.listCalls.length >= 3, 'listing 7 objects at page size 3 must take at least 3 pages (3+3+1)');
});

Deno.test('deleteAnalysis: an empty prefix (nothing was ever uploaded) is a clean no-op success', async () => {
  const table = new FakeAnalysesTable({ id: ANALYSIS_ID, user_id: USER_A, deleted_at: null });
  const storage = new FakeStorage([]);

  const result = await deleteAnalysis(table, storage, { analysisId: ANALYSIS_ID, callerUserId: USER_A });

  assertEquals(result, { outcome: 'deleted', alreadyDeleted: false, purgedObjectCount: 0 });
  assertEquals(storage.removeCalls, [], 'remove() should never be called when there is nothing to remove');
});

// ---------------------------------------------------------------------------
// DEFAULT_PAGE_SIZE sanity — Supabase Storage's real list() cap
// ---------------------------------------------------------------------------

Deno.test("DEFAULT_PAGE_SIZE matches Supabase Storage list()'s real maximum page size", () => {
  assertEquals(DEFAULT_PAGE_SIZE, 1000);
});

// ---------------------------------------------------------------------------
// Pure HTTP-mapping and parsing helpers
// ---------------------------------------------------------------------------

Deno.test('httpStatusForOutcome maps every outcome to the documented status', () => {
  const cases: Array<[DeleteAnalysisResult['outcome'], number]> = [
    ['deleted', 200],
    ['orphans_remaining', 200],
    ['not_found', 404],
    ['not_yours', 403],
    ['purge_failed', 503],
  ];
  for (const [outcome, status] of cases) {
    assertEquals(httpStatusForOutcome(outcome), status, `outcome "${outcome}" should map to ${status}`);
  }
});

Deno.test('responseBodyForOutcome returns { deleted: true } on success, with alreadyDeleted surfaced', () => {
  assertEquals(responseBodyForOutcome({ outcome: 'deleted', alreadyDeleted: false, purgedObjectCount: 2 }), {
    deleted: true,
    alreadyDeleted: false,
  });
  assertEquals(responseBodyForOutcome({ outcome: 'deleted', alreadyDeleted: true, purgedObjectCount: 0 }), {
    deleted: true,
    alreadyDeleted: true,
  });
});

Deno.test('responseBodyForOutcome returns a structured { error, code } body for every non-success outcome', () => {
  const notFound = responseBodyForOutcome({ outcome: 'not_found' });
  assertEquals(notFound.code, 'not_found');
  assertTrue(
    typeof notFound.error === 'string' && (notFound.error as string).length > 0,
    'not_found needs a human-readable error string'
  );

  const notYours = responseBodyForOutcome({ outcome: 'not_yours' });
  assertEquals(notYours.code, 'not_yours');

  const purgeFailed = responseBodyForOutcome({ outcome: 'purge_failed', reason: 'boom' });
  assertEquals(purgeFailed.code, 'purge_failed');
});

Deno.test('isValidUuid accepts a well-formed UUID and rejects garbage', () => {
  assertTrue(isValidUuid('33333333-3333-3333-3333-333333333333'), 'a real UUID should be valid');
  assertTrue(!isValidUuid('not-a-uuid'), 'garbage should be rejected');
  assertTrue(!isValidUuid('33333333-3333-3333-3333-33333333333'), 'a truncated UUID should be rejected');
  assertTrue(!isValidUuid(''), 'an empty string should be rejected');
});

Deno.test('parseAnalysisIdFromUrl extracts the trailing path segment', () => {
  assertEquals(
    parseAnalysisIdFromUrl('https://project.functions.supabase.co/analysis/33333333-3333-3333-3333-333333333333'),
    '33333333-3333-3333-3333-333333333333'
  );
  assertEquals(
    parseAnalysisIdFromUrl('https://project.functions.supabase.co/functions/v1/analysis/abc-123'),
    'abc-123'
  );
});

Deno.test('parseAnalysisIdFromUrl returns null when no id segment is present', () => {
  assertEquals(parseAnalysisIdFromUrl('https://project.functions.supabase.co/analysis'), null);
  assertEquals(parseAnalysisIdFromUrl('https://project.functions.supabase.co/analysis/'), null);
});

Deno.test('parseAnalysisIdFromUrl returns null for a malformed URL rather than throwing', () => {
  assertEquals(parseAnalysisIdFromUrl('not a url at all'), null);
});
