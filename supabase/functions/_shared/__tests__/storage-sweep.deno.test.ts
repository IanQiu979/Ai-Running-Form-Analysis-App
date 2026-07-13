/**
 * Regression locks for `_shared/storage-sweep.ts` — the orphan-purge orchestration for issue #7's
 * residual "sweep prefixes whose analysis row never settled or was never created" ask.
 *
 * These tests mock `RpcClient`/`StorageBucket` rather than a real Postgres/Storage connection, so
 * they prove the CONTRACT: the RPC is called with the right defaults, each returned prefix is
 * purged independently (one failure never stops the batch), and the list→remove→verify idiom
 * matches `delete-analysis.ts`'s own (reimplemented independently — see `storage-sweep.ts`'s
 * header for why it isn't imported). A second block reads
 * `20260713152000_storage_user_budget.sql` directly and cross-checks that the RPC name/params
 * this module calls actually match what the migration defines — same "the model can be fooled by
 * a wrong model; read the SQL that will actually run" discipline
 * `stale-reservation-sweep.deno.test.ts` uses.
 *
 * DENO-ONLY, DELIBERATELY (issue #90 convention): named `.deno.test.ts` so `jest.config.js`'s
 * `testPathIgnorePatterns` skips it and only `deno test` (`npm run test:edge`) runs it.
 */
import {
  DEFAULT_PAGE_SIZE,
  sweepOrphanedMediaPrefixes,
  type RpcClient,
  type StorageBucket,
  type StorageEntry,
} from '../storage-sweep.ts';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

type RpcCall = { fn: string; args?: Record<string, unknown> };

/** A fake `.rpc()` that returns a fixed row set (or error) and records every call it received. */
class FakeRpcClient implements RpcClient {
  readonly calls: RpcCall[] = [];

  constructor(
    private response: { data: unknown; error: { message: string } | null } = { data: [], error: null }
  ) {}

  rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> {
    this.calls.push({ fn, args });
    return Promise.resolve(this.response);
  }
}

/** Identical in spirit to `delete-analysis.deno.test.ts`'s own `FakeStorage` — a flat in-memory
 * object set with folders inferred from `/`, reimplemented here independently per this issue's
 * file lane (see `storage-sweep.ts`'s header). */
class FakeStorage implements StorageBucket {
  private objects: Set<string>;
  readonly listCalls: Array<{ prefix: string; limit: number; offset: number }> = [];
  readonly removeCalls: string[][] = [];
  failRemoveWith: string | null = null;

  constructor(initialPaths: string[]) {
    this.objects = new Set(initialPaths);
  }

  remainingPaths(): string[] {
    return Array.from(this.objects).sort();
  }

  list(prefix: string, options: { limit: number; offset: number }): Promise<StorageEntry[]> {
    this.listCalls.push({ prefix, limit: options.limit, offset: options.offset });
    const directChildren = new Map<string, boolean>();
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

// ---------------------------------------------------------------------------
// 1. Behavior
// ---------------------------------------------------------------------------

Deno.test('calls list_orphaned_media_prefixes with the documented defaults when none are passed', async () => {
  const rpc = new FakeRpcClient({ data: [], error: null });
  const storage = new FakeStorage([]);

  await sweepOrphanedMediaPrefixes(rpc, storage);

  assertEquals(rpc.calls.length, 1);
  assertEquals(rpc.calls[0].fn, 'list_orphaned_media_prefixes');
  assertEquals(rpc.calls[0].args, { p_older_than: '15 minutes', p_limit: 500 });
});

Deno.test('threads custom olderThan/limit through to the RPC call', async () => {
  const rpc = new FakeRpcClient({ data: [], error: null });
  const storage = new FakeStorage([]);

  await sweepOrphanedMediaPrefixes(rpc, storage, { olderThan: '1 hour', limit: 10 });

  assertEquals(rpc.calls[0].args, { p_older_than: '1 hour', p_limit: 10 });
});

Deno.test('throws when the RPC itself errors — never silently reports zero candidates', async () => {
  const rpc = new FakeRpcClient({ data: null, error: { message: 'permission denied' } });
  const storage = new FakeStorage([]);

  let threw = false;
  try {
    await sweepOrphanedMediaPrefixes(rpc, storage);
  } catch (err) {
    threw = true;
    assertTrue(String(err).includes('permission denied'), 'the underlying RPC error must surface');
  }
  assertTrue(threw, 'an RPC error must throw, not resolve as an empty sweep');
});

Deno.test('purges every object under a returned prefix and reports it purged', async () => {
  const rpc = new FakeRpcClient({
    data: [
      {
        user_id: 'user-a',
        analysis_id: 'analysis-1',
        prefix: 'user-a/analysis-1/',
        object_count: 2,
        oldest_object_at: '2026-07-01T00:00:00Z',
      },
    ],
    error: null,
  });
  const storage = new FakeStorage(['user-a/analysis-1/frame-01.jpg', 'user-a/analysis-1/frame-02.jpg']);

  const result = await sweepOrphanedMediaPrefixes(rpc, storage);

  assertEquals(result.candidateCount, 1);
  assertEquals(result.outcomes, [{ prefix: 'user-a/analysis-1/', outcome: 'purged', objectCount: 2 }]);
  assertEquals(storage.remainingPaths(), []);
});

Deno.test('normalizes snake_case RPC rows into camelCase before reporting, and translates prefix exactly', async () => {
  const rpc = new FakeRpcClient({
    data: [
      {
        user_id: 'user-b',
        analysis_id: 'analysis-2',
        prefix: 'user-b/analysis-2/',
        object_count: 1,
        oldest_object_at: '2026-07-01T00:00:00Z',
      },
    ],
    error: null,
  });
  const storage = new FakeStorage(['user-b/analysis-2/frame-01.jpg']);

  const result = await sweepOrphanedMediaPrefixes(rpc, storage);

  assertEquals(result.outcomes[0].prefix, 'user-b/analysis-2/');
});

Deno.test('a prefix with zero remaining objects (already-empty) still reports purged with objectCount 0', async () => {
  const rpc = new FakeRpcClient({
    data: [
      {
        user_id: 'user-c',
        analysis_id: 'analysis-3',
        prefix: 'user-c/analysis-3/',
        object_count: 0,
        oldest_object_at: '2026-07-01T00:00:00Z',
      },
    ],
    error: null,
  });
  const storage = new FakeStorage([]);

  const result = await sweepOrphanedMediaPrefixes(rpc, storage);

  assertEquals(result.outcomes, [{ prefix: 'user-c/analysis-3/', outcome: 'purged', objectCount: 0 }]);
});

Deno.test('ONE prefix failing to purge does not stop the rest of the batch', async () => {
  const rpc = new FakeRpcClient({
    data: [
      { user_id: 'a', analysis_id: '1', prefix: 'a/1/', object_count: 1, oldest_object_at: 't' },
      { user_id: 'b', analysis_id: '2', prefix: 'b/2/', object_count: 1, oldest_object_at: 't' },
    ],
    error: null,
  });
  const storage = new FakeStorage(['a/1/frame-01.jpg', 'b/2/frame-01.jpg']);
  storage.failRemoveWith = 'simulated storage outage';

  const result = await sweepOrphanedMediaPrefixes(rpc, storage);

  assertEquals(result.candidateCount, 2);
  assertEquals(result.outcomes.length, 2);
  for (const outcome of result.outcomes) {
    assertEquals(outcome.outcome, 'purge_failed');
  }
  // Both prefixes were still attempted — the first failure did not short-circuit the loop.
  assertTrue(
    result.outcomes.some((o) => o.prefix === 'a/1/') && result.outcomes.some((o) => o.prefix === 'b/2/'),
    'both candidate prefixes must appear in the outcome list, regardless of the shared storage failure'
  );
});

Deno.test('a leftover object surviving the post-remove verification pass is reported as purge_failed, not a false purged', async () => {
  const rpc = new FakeRpcClient({
    data: [{ user_id: 'a', analysis_id: '1', prefix: 'a/1/', object_count: 1, oldest_object_at: 't' }],
    error: null,
  });
  const storage = new FakeStorage(['a/1/frame-01.jpg']);
  // remove() reports success but does not actually delete anything — simulates a silently
  // incomplete remove, the exact case delete-analysis.ts's own verification pass exists for.
  storage.remove = (paths: string[]) => {
    storage.removeCalls.push(paths);
    return Promise.resolve({ error: null }); // lies: nothing actually removed
  };

  const result = await sweepOrphanedMediaPrefixes(rpc, storage);

  assertEquals(result.outcomes[0].outcome, 'purge_failed');
});

Deno.test('an empty candidate list from the RPC is a clean no-op', async () => {
  const rpc = new FakeRpcClient({ data: [], error: null });
  const storage = new FakeStorage([]);

  const result = await sweepOrphanedMediaPrefixes(rpc, storage);

  assertEquals(result, { candidateCount: 0, outcomes: [] });
});

Deno.test('DEFAULT_PAGE_SIZE matches Supabase Storage list()\'s real page cap of 1000', () => {
  assertEquals(DEFAULT_PAGE_SIZE, 1000);
});

// ---------------------------------------------------------------------------
// 2. MIGRATION-TEXT CROSS-CHECK — this module's RPC name/params must match what the migration
//    actually defines, not just what this file's own comments claim.
// ---------------------------------------------------------------------------

const MIGRATION_URL = new URL('../../../migrations/20260713152000_storage_user_budget.sql', import.meta.url);

function readMigration(): string {
  return Deno.readTextFileSync(MIGRATION_URL);
}

function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

Deno.test('MIGRATION CROSS-CHECK: the RPC this module calls is actually defined, with matching parameter names', () => {
  const code = stripSqlComments(readMigration());
  assertTrue(
    /create or replace function public\.list_orphaned_media_prefixes\(/i.test(code),
    'expected public.list_orphaned_media_prefixes to be defined in the migration'
  );
  assertTrue(/p_older_than\s+interval\s+default\s+interval\s+'15 minutes'/i.test(code), 'expected p_older_than to default to 15 minutes, matching this module\'s DEFAULT_OLDER_THAN');
  assertTrue(/p_limit\s+integer\s+default\s+500/i.test(code), 'expected p_limit to default to 500, matching this module\'s DEFAULT_RPC_LIMIT');
});

Deno.test('MIGRATION CROSS-CHECK: the RPC returns exactly the columns this module\'s normalizeRows() reads', () => {
  const code = stripSqlComments(readMigration());
  const start = code.indexOf('create or replace function public.list_orphaned_media_prefixes');
  const end = code.indexOf('$$;', start);
  const body = code.slice(start, end);

  for (const column of ['user_id', 'analysis_id', 'prefix', 'object_count', 'oldest_object_at']) {
    assertTrue(new RegExp(`\\b${column}\\b`).test(body), `expected the RPC's returns table to include ${column}`);
  }
});

Deno.test('MIGRATION CROSS-CHECK: EXECUTE is service_role-only, matching what this module assumes about who may call it', () => {
  const sql = readMigration();
  assertTrue(
    sql.includes(
      'revoke execute on function public.list_orphaned_media_prefixes(interval, integer) from public, anon, authenticated;'
    ),
    'expected EXECUTE revoked from public/anon/authenticated'
  );
  assertTrue(
    sql.includes('grant execute on function public.list_orphaned_media_prefixes(interval, integer) to service_role;'),
    'expected EXECUTE granted to service_role'
  );
});
