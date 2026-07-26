/**
 * Regression locks for `_shared/quota-status.ts` — the read-only orchestration behind
 * `GET /functions/v1/quota-status` (issue #50). Two kinds of tests live here, deliberately:
 *
 *   1. RPC-response-shaping tests: an injected `FakeRpcClient` stands in for a real Postgres
 *      round trip (same technique `ai-guard.test.ts`/`delete-analysis.deno.test.ts` use for their
 *      own subjects), proving `getQuotaStatus`/`parseQuotaStatusRow` shape a `pace_quota_status`
 *      JSON row correctly — including the state issue #6 requires this endpoint be able to
 *      represent honestly: a user with quota remaining who is ALSO currently anti-farm-blocked.
 *
 *   2. Migration-text invariant tests: `pace_quota_status` (the DB function this module calls) is
 *      now applied to the live project (confirmed 2026-07-26, issue #128; see
 *      `supabase/migrations/20260712233000_quota_status_function.sql`'s header), but at the time
 *      these tests were written issue #50's hard constraint forbade applying it, even locally, so
 *      there was no live Postgres this suite could run an integration test against. Instead, these
 *      tests read the migration file's own SQL text and assert the specific properties issue #50
 *      calls out by name — that it never filters on `deleted_at` (so a soft-deleted analysis
 *      keeps counting, matching `reserve_analysis`'s own behavior) and that its tier -> limit
 *      table matches the literal values captured from the LIVE `reserve_analysis` via
 *      `pg_get_functiondef` in the same session this migration was written (quoted verbatim in
 *      the constants below). This is a weaker guarantee than a real integration test, but it is
 *      the honest ceiling available without either applying the migration (forbidden) or standing
 *      up a local Postgres from this worktree (out of scope) — and it does catch the exact
 *      regression class this issue exists to prevent: `quota-status` silently drifting from
 *      `reserve_analysis`'s counting rules.
 *
 * DENO-ONLY, DELIBERATELY (issue #90 convention, same as `delete-analysis.deno.test.ts`'s header):
 * named `.deno.test.ts` so `jest.config.js`'s `testPathIgnorePatterns` skips it and only
 * `deno test` (`npm run test:edge`) runs it, even though `quota-status.ts` itself has no
 * Deno-only syntax and could run under Jest.
 */
import {
  getQuotaStatus,
  httpStatusForQuotaStatus,
  parseQuotaStatusRow,
  responseBodyForQuotaStatus,
  type RpcClient,
} from '../quota-status.ts';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

class FakeRpcClient implements RpcClient {
  readonly calls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  constructor(
    private response: { data: unknown; error: { message: string } | null }
  ) {}

  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> {
    this.calls.push({ fn, args });
    return Promise.resolve(this.response);
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

async function assertThrows(fn: () => unknown, message: string): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(message);
}

const USER_ID = '11111111-1111-1111-1111-111111111111';

// ---------------------------------------------------------------------------
// 1. Free tier — lifetime exhaustion
// ---------------------------------------------------------------------------

Deno.test('getQuotaStatus: free tier, lifetime quota exhausted — remaining 0, no period fields, copy-safe isLifetime', async () => {
  const client = new FakeRpcClient({
    data: {
      tier: 'free',
      used: 1,
      limit: 1,
      frame_cap: 1,
      is_lifetime: true,
      period_start: null,
      period_end: null,
      blocked: false,
      blocked_reason: null,
      blocked_until: null,
    },
    error: null,
  });

  const status = await getQuotaStatus(client, USER_ID);

  assertEquals(status, {
    tier: 'free',
    used: 1,
    limit: 1,
    remaining: 0,
    frameCap: 1,
    isLifetime: true,
    periodStart: null,
    periodEnd: null,
    blocked: false,
    blockedReason: null,
    blockedUntil: null,
  });
  assertEquals(client.calls, [{ fn: 'pace_quota_status', args: { p_user_id: USER_ID } }]);
});

Deno.test('getQuotaStatus: free tier, quota not yet used — remaining 1, never "this month" copy signal', async () => {
  const client = new FakeRpcClient({
    data: {
      tier: 'free',
      used: 0,
      limit: 1,
      frame_cap: 1,
      is_lifetime: true,
      period_start: null,
      period_end: null,
      blocked: false,
      blocked_reason: null,
      blocked_until: null,
    },
    error: null,
  });

  const status = await getQuotaStatus(client, USER_ID);
  assertEquals(status.remaining, 1);
  assertTrue(status.isLifetime, 'free must always report isLifetime: true');
  assertEquals(status.periodStart, null);
  assertEquals(status.periodEnd, null);
});

// ---------------------------------------------------------------------------
// 2. Paid tiers — period windowing
// ---------------------------------------------------------------------------

Deno.test('getQuotaStatus: pro tier, period windowing — periodStart/periodEnd pass through, remaining computed against the period limit', async () => {
  const client = new FakeRpcClient({
    data: {
      tier: 'pro',
      used: 7,
      limit: 10,
      frame_cap: 5,
      is_lifetime: false,
      period_start: '2026-07-01T00:00:00+00:00',
      period_end: '2026-08-01T00:00:00+00:00',
      blocked: false,
      blocked_reason: null,
      blocked_until: null,
    },
    error: null,
  });

  const status = await getQuotaStatus(client, USER_ID);

  assertEquals(status.tier, 'pro');
  assertEquals(status.remaining, 3);
  assertEquals(status.isLifetime, false);
  assertEquals(status.periodStart, '2026-07-01T00:00:00+00:00');
  assertEquals(status.periodEnd, '2026-08-01T00:00:00+00:00');
});

Deno.test('getQuotaStatus: elite tier, period limit is 30 (not free/pro limits) and frameCap 8', async () => {
  const client = new FakeRpcClient({
    data: {
      tier: 'elite',
      used: 0,
      limit: 30,
      frame_cap: 8,
      is_lifetime: false,
      period_start: '2026-07-05T12:00:00+00:00',
      period_end: '2026-08-05T12:00:00+00:00',
      blocked: false,
      blocked_reason: null,
      blocked_until: null,
    },
    error: null,
  });

  const status = await getQuotaStatus(client, USER_ID);
  assertEquals(status.limit, 30);
  assertEquals(status.frameCap, 8);
  assertEquals(status.remaining, 30);
});

// ---------------------------------------------------------------------------
// 3. The anti-farm-blocked-but-has-quota case (issue #6) — the state this endpoint exists to be
//    able to represent honestly, per issue #50's own framing: "you have quota but are
//    rate-limited right now" must not collapse into "1 analysis left" with no caveat.
// ---------------------------------------------------------------------------

Deno.test('getQuotaStatus: blocked while quota remains — remaining > 0 AND blocked: true are both represented, not collapsed', async () => {
  const client = new FakeRpcClient({
    data: {
      tier: 'elite',
      used: 2,
      limit: 30,
      frame_cap: 8,
      is_lifetime: false,
      period_start: '2026-07-05T12:00:00+00:00',
      period_end: '2026-08-05T12:00:00+00:00',
      blocked: true,
      blocked_reason: 'too_many_failed_attempts',
      blocked_until: '2026-08-05T12:00:00+00:00',
    },
    error: null,
  });

  const status = await getQuotaStatus(client, USER_ID);

  assertTrue(status.remaining > 0, 'quota must still show as available — the block is a separate refusal');
  assertEquals(status.remaining, 28);
  assertTrue(status.blocked, 'the anti-farm block must be represented');
  assertEquals(status.blockedReason, 'too_many_failed_attempts');
  assertEquals(status.blockedUntil, '2026-08-05T12:00:00+00:00');
});

Deno.test('getQuotaStatus: free tier blocked with quota unused — the exact scenario issue #6 fixed (3 confusing failures, 0 successful analyses)', async () => {
  const client = new FakeRpcClient({
    data: {
      tier: 'free',
      used: 0,
      limit: 1,
      frame_cap: 1,
      is_lifetime: true,
      period_start: null,
      period_end: null,
      blocked: true,
      blocked_reason: 'too_many_failed_attempts',
      blocked_until: '2026-07-13T09:00:00+00:00',
    },
    error: null,
  });

  const status = await getQuotaStatus(client, USER_ID);
  assertEquals(status.remaining, 1);
  assertTrue(status.blocked, 'a free user who has never received an analysis can still be anti-farm blocked');
  assertEquals(status.blockedUntil, '2026-07-13T09:00:00+00:00');
});

Deno.test('parseQuotaStatusRow: blocked_reason/blocked_until are ignored when blocked is false (defensive against an inconsistent payload)', () => {
  const status = parseQuotaStatusRow({
    tier: 'free',
    used: 0,
    limit: 1,
    frame_cap: 1,
    is_lifetime: true,
    period_start: null,
    period_end: null,
    blocked: false,
    blocked_reason: 'too_many_failed_attempts', // inconsistent — should never leak through
    blocked_until: '2026-07-13T09:00:00+00:00', // inconsistent — should never leak through
  });

  assertEquals(status.blocked, false);
  assertEquals(status.blockedReason, null);
  assertEquals(status.blockedUntil, null);
});

// ---------------------------------------------------------------------------
// 4. Fail-closed behavior — never fabricate a quota answer
// ---------------------------------------------------------------------------

Deno.test('getQuotaStatus: propagates an RPC error rather than returning a fabricated quota', async () => {
  const client = new FakeRpcClient({ data: null, error: { message: 'connection refused' } });
  await assertThrows(
    () => getQuotaStatus(client, USER_ID),
    'getQuotaStatus must throw on an RPC error, never silently return a default quota'
  );
});

Deno.test('parseQuotaStatusRow: rejects a null/non-object/array payload', () => {
  for (const bad of [null, 'not an object', 42, ['array']]) {
    let threw = false;
    try {
      parseQuotaStatusRow(bad);
    } catch {
      threw = true;
    }
    assertTrue(threw, `expected parseQuotaStatusRow to reject ${JSON.stringify(bad)}`);
  }
});

Deno.test('parseQuotaStatusRow: rejects an unrecognized tier rather than guessing "free"', () => {
  let threw = false;
  try {
    parseQuotaStatusRow({ tier: 'ultra', used: 0, limit: 1, frame_cap: 1 });
  } catch {
    threw = true;
  }
  assertTrue(threw, 'an unrecognized tier must be a hard failure, not silently downgraded to free');
});

Deno.test('parseQuotaStatusRow: rejects non-numeric used/limit/frame_cap', () => {
  let threw = false;
  try {
    parseQuotaStatusRow({ tier: 'free', used: '1', limit: 1, frame_cap: 1 });
  } catch {
    threw = true;
  }
  assertTrue(threw, 'a non-numeric used field must be rejected, not coerced');
});

// ---------------------------------------------------------------------------
// 5. HTTP mapping
// ---------------------------------------------------------------------------

Deno.test('httpStatusForQuotaStatus: always 200 — this endpoint has exactly one success shape', () => {
  assertEquals(httpStatusForQuotaStatus(), 200);
});

Deno.test('responseBodyForQuotaStatus: the full QuotaStatus shape, unchanged', () => {
  const status = parseQuotaStatusRow({
    tier: 'pro',
    used: 4,
    limit: 10,
    frame_cap: 5,
    is_lifetime: false,
    period_start: '2026-07-01T00:00:00+00:00',
    period_end: '2026-08-01T00:00:00+00:00',
    blocked: false,
    blocked_reason: null,
    blocked_until: null,
  });
  assertEquals(responseBodyForQuotaStatus(status), status);
});

// ---------------------------------------------------------------------------
// 6. Migration-text invariants — proving `pace_quota_status` agrees with the LIVE
//    `reserve_analysis` it cannot be integration-tested against (see this file's header).
// ---------------------------------------------------------------------------

const MIGRATION_URL = new URL(
  '../../../migrations/20260712233000_quota_status_function.sql',
  import.meta.url
);

function readMigration(): string {
  return Deno.readTextFileSync(MIGRATION_URL);
}

/**
 * Strips `--` line comments before scanning for SQL constructs — the migration's own header
 * comment legitimately explains, in prose, that the counting queries deliberately do NOT filter
 * on `deleted_at` (see its "COUNTING RULES" section), so a naive substring search over the raw
 * file would false-positive on that documentation. This function is what lets the test below
 * assert the actual executable SQL never filters on it, not just that the word never appears.
 */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

Deno.test('pace_quota_status migration: the executable SQL never filters on deleted_at — a soft-deleted analysis must keep counting toward quota, matching reserve_analysis', () => {
  const code = stripSqlComments(readMigration());
  assertTrue(
    !code.includes('deleted_at'),
    'pace_quota_status\'s executable SQL must not reference deleted_at anywhere — reserve_analysis\'s ' +
      'own counting query never filters on it either (issue #2: soft-deleting an analysis does not ' +
      'refund quota), so this function must not either. (Prose explaining this in comments is fine ' +
      'and expected — this check strips comments before scanning.)'
  );
  // Sanity check the invariant test itself isn't vacuous — the counting queries must actually be
  // present for "no deleted_at filter" to mean anything.
  assertTrue(
    (code.match(/status in \('reserved', 'delivered'\)/g) ?? []).length === 2,
    'expected exactly two active-count queries (free branch + paid branch), same shape as reserve_analysis'
  );
});

Deno.test('pace_quota_status migration: tier -> limit/frame_cap table matches the LIVE reserve_analysis literal case, captured via pg_get_functiondef 2026-07-12', () => {
  const sql = readMigration();
  // Captured verbatim from the live `reserve_analysis` body (project vputdomdlknvthnzritt) in the
  // same session this migration was written — see the migration file's own header for the full
  // provenance note. If reserve_analysis's case expression is ever edited, this literal string
  // (and the migration's copy of it) must be updated together.
  const LIVE_LIMIT_CASE = "case v_tier when 'free' then 1 when 'pro' then 10 when 'elite' then 30 end";
  const LIVE_FRAME_CAP_CASE = "case v_tier when 'free' then 1 when 'pro' then 5 when 'elite' then 8 end";

  assertTrue(
    sql.includes(LIVE_LIMIT_CASE),
    'pace_quota_status\'s quota-limit table must match reserve_analysis\'s literal case expression exactly'
  );
  assertTrue(
    sql.includes(LIVE_FRAME_CAP_CASE),
    'pace_quota_status\'s frame-cap table must match reserve_analysis\'s literal case expression exactly'
  );
});

Deno.test('pace_quota_status migration: shares pace_current_period and pace_is_farming_signal — calls them, does not reimplement their logic', () => {
  const sql = readMigration();
  assertTrue(sql.includes('public.pace_current_period('), 'must call the same period function reserve_analysis calls');
  assertTrue(sql.includes('public.pace_is_farming_signal('), 'must call the same farming classifier reserve_analysis calls');
  // The rolling-window and period-window filters must mirror reserve_analysis's own shape:
  // free keyed on released_at against a 24h threshold, paid keyed on created_at against the
  // period range via the containment operator.
  assertTrue(sql.includes("released_at > p_as_of - interval '24 hours'"), 'free branch must use the same rolling 24h window as reserve_analysis');
  assertTrue(sql.includes('created_at <@ v_window'), 'paid branch must use the same period-containment filter as reserve_analysis');
});

Deno.test('pace_quota_status migration: privilege shape matches the rest of the quota RPC family — service_role only', () => {
  const sql = readMigration();
  assertTrue(
    sql.includes('revoke execute on function public.pace_quota_status(uuid, timestamptz) from public, anon, authenticated;'),
    'EXECUTE must be revoked from public/anon/authenticated, same as reserve_analysis/settle_analysis/release_analysis'
  );
  assertTrue(
    sql.includes('grant execute on function public.pace_quota_status(uuid, timestamptz) to service_role;'),
    'EXECUTE must be granted to service_role only'
  );
  assertTrue(sql.includes('security definer'), 'must be SECURITY DEFINER, same as the rest of the quota RPC family');
  assertTrue(sql.includes("set search_path = public"), 'must pin search_path, same as the rest of the quota RPC family');
});

Deno.test('pace_quota_status migration: does not create or replace reserve_analysis, settle_analysis, or release_analysis', () => {
  const sql = readMigration();
  for (const forbidden of ['reserve_analysis', 'settle_analysis', 'release_analysis']) {
    assertTrue(
      !new RegExp(`create or replace function public\\.${forbidden}`).test(sql),
      `pace_quota_status's migration must never redefine ${forbidden} — issue #50's hard constraint`
    );
  }
});
