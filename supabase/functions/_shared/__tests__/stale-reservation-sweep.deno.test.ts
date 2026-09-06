/**
 * Regression locks for issue #47's stale-`reserved`-row sweep
 * (`supabase/migrations/20260713130000_stale_reservation_sweep.sql`).
 *
 * There is no `_shared/stale-sweep.ts` production module for this issue, unlike most other
 * `_shared/<name>.ts` + `.deno.test.ts` pairs in this directory — and that is a deliberate,
 * explained choice, not an oversight:
 *
 *   The sweep is PURE DATABASE bookkeeping (read stale rows, flip a status, stamp a reason) with
 *   no external I/O, so it runs as `pg_cron` calling `public.sweep_stale_reservations()` DIRECTLY
 *   — no edge function, no `pg_net` HTTP hop, no Vault-stored credential (see the migration's own
 *   header, "DESIGN DECISION 3", for the full reasoning, including why a scheduled-edge-function
 *   design would need a secret this repo cannot safely provision from a migration file). Because
 *   nothing in the Deno runtime ever calls this RPC, there is no orchestration code to wrap in a
 *   `_shared/` module — a file that existed only to be imported by its own test would be dead
 *   weight. `supabase/functions/_shared/__tests__/purchase-tier.deno.test.ts` already sets the
 *   precedent this file follows for exactly this situation (also same-day, also a
 *   written-but-relying-entirely-on-a-migration RPC): a TypeScript MODEL of the SQL function's
 *   contract lives directly in the test file, and a second block of tests reads the actual
 *   migration text to prove the model is not lying about what will really run.
 *
 * Two kinds of test live here, deliberately (same split as quota-status.deno.test.ts /
 * purchase-tier.deno.test.ts):
 *
 *   1. THE MODEL — `ModelAnalysesTable` below is a TypeScript re-statement of
 *      `sweep_stale_reservations`'s contract: sweep only rows where `status = 'reserved' and
 *      created_at < now() - stale_after`, oldest first, capped at a batch limit, and NEVER touch
 *      a row whose status has already moved (settled or already released) by the time the sweep
 *      would reach it — modeling the same "atomic conditional UPDATE, no advisory lock needed"
 *      guarantee the migration's header spells out under "DESIGN DECISION 4". This is what lets
 *      the race-with-a-concurrent-settle scenario be exercised at all: there is no live Postgres
 *      here to actually race two transactions against (this repo has none available — see
 *      `supabase/migrations/__tests__/anti_farm_release_reason_fix.test.ts`'s header for why),
 *      so the model simulates the OUTCOME of that race (whichever write "commits" first wins, the
 *      other is a no-op) rather than the concurrency mechanism itself.
 *
 *   2. MIGRATION-TEXT INVARIANTS — read
 *      `supabase/migrations/20260713130000_stale_reservation_sweep.sql` directly and assert the
 *      specific properties issue #47 turns on: the 15-minute default threshold, the
 *      `release_reason = 'stale_sweep'` literal, the `status = 'reserved'` guard present on BOTH
 *      the row-selection subquery and the outer UPDATE, `'stale_sweep'` added to the CHECK
 *      constraint's vocabulary but NOT to `pace_is_farming_signal`'s (the farming-exemption is
 *      "not present in one function's literal list", so its absence has to be proven directly
 *      against the SQL, not inferred), the service_role-only grant, and the cron schedule. A model
 *      test can be fooled by a wrong model; these read the SQL that will actually run.
 *
 * DENO-ONLY, DELIBERATELY (issue #90 convention): named `.deno.test.ts` so `jest.config.js`'s
 * `testPathIgnorePatterns` skips it and only `deno test` (`npm run test:edge`) runs it.
 */

// ---------------------------------------------------------------------------
// Test helpers (same minimal, dependency-free shape as this directory's other .deno.test.ts files)
// ---------------------------------------------------------------------------

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
// 1. THE MODEL — a TypeScript re-statement of sweep_stale_reservations()'s contract.
// ---------------------------------------------------------------------------

type AnalysisStatus = 'reserved' | 'delivered' | 'released';

interface ModelRow {
  id: string;
  status: AnalysisStatus;
  createdAtMs: number;
  releaseReason: string | null;
  releasedAtMs: number | null;
}

const STALE_AFTER_MS_DEFAULT = 15 * 60 * 1000; // mirrors the migration's `interval '15 minutes'` default
const RELEASE_REASON = 'stale_sweep'; // mirrors the migration's literal

/**
 * Models `public.analyses` restricted to exactly the columns `sweep_stale_reservations` reads or
 * writes, plus the two RPCs it must coexist safely with (`settle`/`release`, standing in for
 * `settle_analysis`/`release_analysis`). Every mutating method here reproduces the SAME guard the
 * real SQL uses — "only touch a row that is STILL `status = 'reserved'` at the moment of the
 * write" — so racing two of these methods against the same row is a faithful model of what two
 * concurrent Postgres transactions racing the same UPDATE guard actually resolve to: whichever
 * call this test makes first wins, and the loser's own guard turns it into a safe no-op, exactly
 * as `settle_analysis`/`release_analysis`'s own header comments already document.
 */
class ModelAnalysesTable {
  private rows = new Map<string, ModelRow>();

  seed(id: string, status: AnalysisStatus, createdAtMs: number, releaseReason: string | null = null): void {
    this.rows.set(id, { id, status, createdAtMs, releaseReason, releasedAtMs: null });
  }

  peek(id: string): ModelRow | undefined {
    const row = this.rows.get(id);
    return row ? { ...row } : undefined;
  }

  /** Models `settle_analysis`: only affects a row that is STILL 'reserved'. Returns whether it
   * actually settled anything, mirroring `{ ok: boolean }`. */
  settle(id: string): boolean {
    const row = this.rows.get(id);
    if (!row || row.status !== 'reserved') return false;
    row.status = 'delivered';
    return true;
  }

  /** Models `release_analysis`: only affects a row that is STILL 'reserved'. */
  release(id: string, reason: string): boolean {
    const row = this.rows.get(id);
    if (!row || row.status !== 'reserved') return false;
    row.status = 'released';
    row.releaseReason = reason;
    return true;
  }

  /**
   * Models `sweep_stale_reservations(p_stale_after, p_batch_limit)`. Selects rows that are
   * STILL 'reserved' AND older than the threshold, oldest first, capped at the batch limit — the
   * exact `where status = 'reserved' and created_at < now() - p_stale_after order by created_at
   * limit p_batch_limit` shape the migration's CTE uses — then flips each to 'released' with
   * `release_reason = 'stale_sweep'`. Returns the ids it actually swept, mirroring
   * `get diagnostics v_swept_count = row_count`.
   */
  sweep(nowMs: number, staleAfterMs: number = STALE_AFTER_MS_DEFAULT, batchLimit = 500): string[] {
    const candidates = [...this.rows.values()]
      .filter((row) => row.status === 'reserved' && nowMs - row.createdAtMs > staleAfterMs)
      .sort((a, b) => a.createdAtMs - b.createdAtMs)
      .slice(0, Math.max(batchLimit, 0));

    const swept: string[] = [];
    for (const candidate of candidates) {
      const row = this.rows.get(candidate.id)!;
      // The re-check every real conditional UPDATE in this schema performs — see this file's
      // header on why this is what makes the race scenario safe without an advisory lock.
      if (row.status !== 'reserved') continue;
      row.status = 'released';
      row.releaseReason = RELEASE_REASON;
      row.releasedAtMs = nowMs;
      swept.push(row.id);
    }
    return swept;
  }
}

const NOW = Date.parse('2026-07-13T12:00:00.000Z');

// ---------------------------------------------------------------------------
// 2. The four required scenarios
// ---------------------------------------------------------------------------

Deno.test('a FRESH reserved row (well under the threshold) is NOT swept', () => {
  const db = new ModelAnalysesTable();
  db.seed('fresh', 'reserved', NOW - 30_000); // 30s old — analyze-form's own worst case is ~120s

  const swept = db.sweep(NOW);

  assertEquals(swept, []);
  assertEquals(db.peek('fresh')?.status, 'reserved', 'a fresh reservation must be left completely alone');
});

Deno.test('a reserved row right at the 105s self-imposed deadline is NOT swept — the margin is real, not theoretical', () => {
  const db = new ModelAnalysesTable();
  // ANALYZE_FORM_REQUEST_DEADLINE_MS (analyze-form/flow.ts) — a request finishing at its own self-imposed
  // ceiling must never be mistaken for stale.
  db.seed('at-deadline', 'reserved', NOW - 105_000);

  const swept = db.sweep(NOW);

  assertEquals(swept, []);
});

Deno.test('a STALE reserved row (older than the threshold) IS swept: status -> released, reason -> stale_sweep, released_at stamped', () => {
  const db = new ModelAnalysesTable();
  db.seed('stale', 'reserved', NOW - (16 * 60 * 1000)); // 16 minutes old, past the 15-minute default

  const swept = db.sweep(NOW);

  assertEquals(swept, ['stale']);
  const row = db.peek('stale')!;
  assertEquals(row.status, 'released');
  assertEquals(row.releaseReason, 'stale_sweep');
  assertEquals(row.releasedAtMs, NOW);
});

Deno.test('a row exactly AT the threshold boundary is not yet swept — the SQL uses strict "<", not "<="', () => {
  const db = new ModelAnalysesTable();
  db.seed('boundary', 'reserved', NOW - STALE_AFTER_MS_DEFAULT); // age === threshold, not > threshold

  const swept = db.sweep(NOW);

  assertEquals(swept, [], 'age must be strictly GREATER than the threshold, matching `created_at < now() - p_stale_after`');
});

Deno.test('a SETTLED (delivered) row is untouched by the sweep, however old it is', () => {
  const db = new ModelAnalysesTable();
  db.seed('delivered', 'delivered', NOW - 60 * 60 * 1000); // 1 hour old, but already delivered

  const swept = db.sweep(NOW);

  assertEquals(swept, []);
  assertEquals(db.peek('delivered')?.status, 'delivered', 'a delivered row must never be reclassified as released');
});

Deno.test('an already-RELEASED row is untouched — idempotent, and its original release_reason is never overwritten', () => {
  const db = new ModelAnalysesTable();
  db.seed('already-released', 'released', NOW - 60 * 60 * 1000, 'validation_failed');

  const swept = db.sweep(NOW);

  assertEquals(swept, []);
  const row = db.peek('already-released')!;
  assertEquals(row.status, 'released');
  assertEquals(
    row.releaseReason,
    'validation_failed',
    "a genuine validation_failed release must never be relabeled 'stale_sweep' by a later sweep run — " +
      'that would erase the real farming-relevant signal and is exactly the kind of double-processing ' +
      'the status re-check exists to prevent'
  );
});

Deno.test('THE RACE: a concurrent settle that lands first wins — the sweep never overwrites it', () => {
  const db = new ModelAnalysesTable();
  db.seed('racer', 'reserved', NOW - (20 * 60 * 1000)); // well past stale — would be swept if untouched

  // A live analyze-form invocation's settle_analysis call reaches the row microseconds before the
  // sweep's own UPDATE would have. Modeled as: settle() runs first.
  const settled = db.settle('racer');
  const swept = db.sweep(NOW);

  assertTrue(settled, 'the settle must have succeeded — the row was still reserved when it ran');
  assertEquals(swept, [], 'the sweep must find nothing left to sweep — the row is no longer status=\'reserved\'');
  assertEquals(db.peek('racer')?.status, 'delivered', 'the settle result must stand; the sweep must not clobber it');
});

Deno.test('THE RACE, the other direction: the sweep landing first wins — a late settle_analysis becomes the documented safe no-op', () => {
  const db = new ModelAnalysesTable();
  db.seed('racer2', 'reserved', NOW - (20 * 60 * 1000));

  // The sweep's UPDATE commits first this time.
  const swept = db.sweep(NOW);
  // The still-running analyze-form invocation (which was actually dead, or merely very slow)
  // reaches its own settle_analysis call after the sweep already released the row.
  const settledLate = db.settle('racer2');

  assertEquals(swept, ['racer2']);
  assertTrue(
    !settledLate,
    "settle_analysis's own status='reserved' guard must reject this — the exact " +
      "'{ ok: false, reason: not_reserved_or_not_found }' no-op flow.ts's safeRelease/!settled.ok " +
      'branches already treat as non-fatal, per the migration header\'s Design Decision 4'
  );
  assertEquals(db.peek('racer2')?.status, 'released', 'the sweep\'s release must stand');
  assertEquals(db.peek('racer2')?.releaseReason, 'stale_sweep');
});

Deno.test('a mixed batch: only the stale, still-reserved rows are swept — fresh and already-final rows in the same run are left exactly as they were', () => {
  const db = new ModelAnalysesTable();
  db.seed('a-fresh', 'reserved', NOW - 5_000);
  db.seed('b-stale', 'reserved', NOW - (30 * 60 * 1000));
  db.seed('c-delivered-old', 'delivered', NOW - (2 * 60 * 60 * 1000));
  db.seed('d-released-old', 'released', NOW - (2 * 60 * 60 * 1000), 'model_error');
  db.seed('e-stale-2', 'reserved', NOW - (16 * 60 * 1000));

  const swept = db.sweep(NOW).sort();

  assertEquals(swept, ['b-stale', 'e-stale-2']);
  assertEquals(db.peek('a-fresh')?.status, 'reserved');
  assertEquals(db.peek('c-delivered-old')?.status, 'delivered');
  assertEquals(db.peek('d-released-old')?.releaseReason, 'model_error', 'must not relabel an existing server-fault reason either');
});

Deno.test('batch limit bounds the work: oldest-first, capped — the rest waits for the next cron tick rather than one run rewriting everything', () => {
  const db = new ModelAnalysesTable();
  // Three stale rows, seeded oldest-to-newest by id suffix.
  db.seed('oldest', 'reserved', NOW - (60 * 60 * 1000));
  db.seed('middle', 'reserved', NOW - (45 * 60 * 1000));
  db.seed('newest-stale', 'reserved', NOW - (16 * 60 * 1000));

  const swept = db.sweep(NOW, STALE_AFTER_MS_DEFAULT, /* batchLimit */ 2);

  assertEquals(swept, ['oldest', 'middle'], 'must sweep the OLDEST stale rows first when capped, matching `order by created_at`');
  assertEquals(db.peek('newest-stale')?.status, 'reserved', 'the row past the batch cap must be left for the next run, not skipped forever');
});

// ---------------------------------------------------------------------------
// 3. MIGRATION-TEXT INVARIANTS — the bridge from the model above to the SQL that will actually run.
// ---------------------------------------------------------------------------

const MIGRATION_URL = new URL('../../../migrations/20260713130000_stale_reservation_sweep.sql', import.meta.url);
const ANTI_FARM_MIGRATION_URL = new URL(
  '../../../migrations/20260712220000_anti_farm_release_reason_fix.sql',
  import.meta.url
);

function readMigration(): string {
  return Deno.readTextFileSync(MIGRATION_URL);
}

/** Strips `--` line comments before scanning — this migration's header legitimately discusses,
 * in prose, several of the exact strings/constructs the tests below look for (e.g. it names
 * `pace_is_farming_signal` at length while explaining why this migration must NOT touch it), so a
 * naive substring search over the raw file would false-positive on its own documentation. Same
 * technique `purchase-tier.deno.test.ts`/`quota-status.deno.test.ts` use. */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

Deno.test('MIGRATION: sorts after 20260713120000_purchase_tier_function.sql (filename ordering)', () => {
  const name = MIGRATION_URL.pathname.split('/').pop()!;
  assertTrue(
    name > '20260713120000_purchase_tier_function.sql',
    'the filename timestamp prefix must sort after every migration that predates it'
  );
});

Deno.test('MIGRATION: the default staleness threshold is 15 minutes', () => {
  const code = stripSqlComments(readMigration());
  assertTrue(
    /p_stale_after\s+interval\s+default\s+interval\s+'15 minutes'/i.test(code),
    "expected sweep_stale_reservations' p_stale_after to default to interval '15 minutes' — " +
      'the model above (STALE_AFTER_MS_DEFAULT) must be updated in the SAME commit as any change here'
  );
});

Deno.test('MIGRATION: enables pg_cron and grants the schema to postgres (Supabase\'s documented install recipe)', () => {
  const code = stripSqlComments(readMigration());
  assertTrue(/create extension if not exists pg_cron/i.test(code), 'expected pg_cron to be enabled');
  assertTrue(/grant usage on schema cron to postgres/i.test(code), 'expected USAGE on schema cron granted to postgres');
  assertTrue(
    /grant all privileges on all tables in schema cron to postgres/i.test(code),
    'expected privileges on schema cron\'s tables granted to postgres'
  );
});

Deno.test('MIGRATION: release_reason CHECK constraint gains stale_sweep alongside all 4 pre-existing values — superset, nothing dropped', () => {
  const code = stripSqlComments(readMigration());
  const start = code.indexOf('add constraint analyses_release_reason_known_values');
  assertTrue(start !== -1, 'expected the CHECK constraint to be re-added');
  const end = code.indexOf(');', start);
  const body = code.slice(start, end);

  for (const reason of ['model_error', 'provider_timeout', 'internal_error', 'validation_failed', 'stale_sweep']) {
    assertTrue(body.includes(`'${reason}'`), `expected '${reason}' in the CHECK constraint's allowed values`);
  }
  assertTrue(/release_reason is null/i.test(body), 'NULL must remain allowed');
});

Deno.test('MIGRATION: the old constraint is DROPPED before being re-added (Postgres has no ALTER-CHECK-ADD-VALUE)', () => {
  const code = stripSqlComments(readMigration());
  assertTrue(
    /drop constraint analyses_release_reason_known_values/i.test(code),
    'a CHECK constraint cannot be widened in place — it must be dropped and re-added'
  );
  const dropIdx = code.search(/drop constraint analyses_release_reason_known_values/i);
  const addIdx = code.search(/add constraint analyses_release_reason_known_values/i);
  assertTrue(dropIdx >= 0 && addIdx > dropIdx, 'the drop must precede the re-add');
});

Deno.test("MIGRATION: this file NEVER redefines pace_is_farming_signal — 'stale_sweep' must stay excluded from the anti-farm count by OMISSION, not by an edit to the classifier", () => {
  const sql = readMigration();
  assertTrue(
    !/create\s+(or\s+replace\s+)?function\s+public\.pace_is_farming_signal/i.test(sql),
    'this migration must not touch pace_is_farming_signal at all. Its live body ' +
      "(20260712220000_anti_farm_release_reason_fix.sql) only ever returns true for " +
      "'validation_failed' — leaving it completely untouched is what makes 'stale_sweep' " +
      'automatically NOT a farming signal, with no risk of a copy-paste including it by accident.'
  );
});

Deno.test("CROSS-CHECK: the live pace_is_farming_signal classifier (read from ITS OWN migration) does not classify stale_sweep as a farming signal", () => {
  const anteFarmSql = stripSqlComments(Deno.readTextFileSync(ANTI_FARM_MIGRATION_URL));
  const start = anteFarmSql.indexOf('create or replace function public.pace_is_farming_signal');
  assertTrue(start !== -1, 'expected to find pace_is_farming_signal defined in the anti-farm fix migration');
  const end = anteFarmSql.indexOf('$$;', start);
  const body = anteFarmSql.slice(start, end);

  assertTrue(!body.includes("'stale_sweep'"), 'the classifier must not name stale_sweep at all');
  assertTrue(
    /select\s+coalesce\(p_release_reason\s+in\s+\('validation_failed'\),\s*false\)/i.test(body.replace(/\s+/g, ' ')),
    "the classifier's only true-returning case must remain exactly 'validation_failed' — unchanged by this issue"
  );
});

Deno.test('MIGRATION: the sweep UPDATE re-checks status = \'reserved\' at write time (race-safety, no advisory lock needed)', () => {
  const code = stripSqlComments(readMigration());
  const fnStart = code.indexOf('create or replace function public.sweep_stale_reservations');
  const fnEnd = code.indexOf('$$;', fnStart);
  const body = code.slice(fnStart, fnEnd);

  // The row-selection CTE's own filter.
  assertTrue(/where\s+status\s*=\s*'reserved'/i.test(body), 'the candidate subquery must filter on status = \'reserved\'');
  assertTrue(/created_at\s*<\s*now\(\)\s*-\s*p_stale_after/i.test(body), 'must filter on the age predicate');
  assertTrue(/for update skip locked/i.test(body), 'must use FOR UPDATE SKIP LOCKED for safe, non-blocking batching');

  // The outer UPDATE's own re-check — the belt-and-braces guard.
  const updateMatch = body.match(/update\s+public\.analyses\s+a[\s\S]*?where\s+a\.id\s*=\s*c\.id([\s\S]*?);/i);
  assertTrue(updateMatch !== null, 'expected an `update public.analyses a ... where a.id = c.id ...;` statement');
  assertTrue(
    /a\.status\s*=\s*'reserved'/i.test(updateMatch![1]),
    'the outer UPDATE must ALSO require a.status = \'reserved\' — this, not the SKIP LOCKED alone, ' +
      'is the property that makes a concurrent settle/release always win a genuine race, matching ' +
      'settle_analysis/release_analysis\'s own "duplicate/late call is a safe no-op" guard'
  );
});

Deno.test('MIGRATION: the sweep writes exactly status=released, released_at=now(), release_reason=\'stale_sweep\' — no other column touched', () => {
  const code = stripSqlComments(readMigration());
  const fnStart = code.indexOf('create or replace function public.sweep_stale_reservations');
  const fnEnd = code.indexOf('$$;', fnStart);
  const body = code.slice(fnStart, fnEnd);

  const setMatch = body.match(/set\s+status\s*=\s*'released'[\s\S]*?release_reason\s*=\s*'stale_sweep'/i);
  assertTrue(setMatch !== null, "expected the UPDATE's SET list to set status, released_at, and release_reason together");
  assertTrue(/released_at\s*=\s*now\(\)/i.test(body), 'released_at must be stamped with the real wall-clock now()');
  // result/media_paths/is_fallback must never be touched — this is a release, not a settle.
  assertTrue(!/set[\s\S]*?\bresult\s*=/i.test(body), 'the sweep must never write to result — it is a release, not a delivery');
  assertTrue(!/set[\s\S]*?media_paths\s*=/i.test(body), 'the sweep must never touch media_paths');
});

Deno.test('MIGRATION: p_batch_limit bounds the query via LIMIT, defaulting to 500', () => {
  const code = stripSqlComments(readMigration());
  assertTrue(
    /p_batch_limit\s+integer\s+default\s+500/i.test(code),
    'expected p_batch_limit to default to 500 — the model above must be updated in the same commit if this changes'
  );
  assertTrue(/limit\s+greatest\(p_batch_limit,\s*0\)/i.test(code), 'the LIMIT must derive from p_batch_limit, guarded against a negative caller value');
});

Deno.test('MIGRATION: privilege shape matches the rest of the quota RPC family — service_role only, SECURITY DEFINER, pinned search_path', () => {
  const sql = readMigration();
  assertTrue(
    sql.includes(
      'revoke execute on function public.sweep_stale_reservations(interval, integer) from public, anon, authenticated;'
    ),
    'EXECUTE must be revoked from public/anon/authenticated — a client must never be able to tune ' +
      'its own staleness window or force an early release of a live reservation'
  );
  assertTrue(
    sql.includes('grant execute on function public.sweep_stale_reservations(interval, integer) to service_role;'),
    'EXECUTE must be granted to service_role'
  );
  assertTrue(sql.includes('security definer'), 'must be SECURITY DEFINER, matching every other RPC in this schema');
  assertTrue(sql.includes('set search_path = public'), 'must pin search_path (function_search_path_mutable advisor)');
});

Deno.test('MIGRATION: schedules the sweep via cron.schedule, calling the SQL function directly — no pg_net / HTTP hop, no edge function invocation', () => {
  const code = stripSqlComments(readMigration());
  assertTrue(
    /cron\.schedule\(\s*'sweep-stale-analysis-reservations'/i.test(code),
    'expected a named cron.schedule call for the sweep job'
  );
  assertTrue(
    /select\s+public\.sweep_stale_reservations\(\);/i.test(code),
    'the scheduled command must call the SQL function directly with no arguments (using its defaults)'
  );
  assertTrue(!/net\.http_post|net\.http_get/i.test(code), 'must not invoke pg_net — see Design Decision 3 in this migration\'s header for why');
  assertTrue(!/functions\/v1\//i.test(code), 'must not reference any edge function URL — there is none to schedule');
});

Deno.test('MIGRATION: a new partial index backs the sweep\'s global (cross-user) query', () => {
  const code = stripSqlComments(readMigration());
  assertTrue(
    /create index if not exists analyses_reserved_created_idx\s+on public\.analyses \(created_at\)\s+where status = 'reserved'/i.test(
      code
    ),
    "expected a partial index on (created_at) where status = 'reserved', small by construction and " +
      "distinct from the existing user_id-leading index which cannot serve this global query"
  );
});

Deno.test('MIGRATION: does not redefine the quota RPC family it shares a table with', () => {
  const sql = readMigration();
  for (const forbidden of ['reserve_analysis', 'settle_analysis', 'release_analysis', 'pace_current_period', 'pace_purchase_tier']) {
    assertTrue(
      !new RegExp(`create or replace function public\\.${forbidden}`).test(sql),
      `this migration must never redefine ${forbidden} — other agents are working in parallel worktrees`
    );
  }
});
