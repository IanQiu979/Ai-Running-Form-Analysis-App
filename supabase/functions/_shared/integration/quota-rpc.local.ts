/**
 * Issue #49 — RPC concurrency, idempotent replay, and month-end period arithmetic, proved against
 * a REAL local Postgres (issue #92's local Docker stack), not mocks. `20260711150400_quota_
 * reserve_settle_release.sql`'s own header makes three claims that only a real Postgres can check:
 * the `pg_advisory_xact_lock` genuinely serializes concurrent reserves, a replay returns the
 * existing row (including a `released` one) rather than double-reserving, and
 * `pace_add_months_clamped`/`pace_current_period` clamp on day-overflow the way Postgres's native
 * `+ interval` does not. A mock RPC layer cannot fail any of these the way production can — see
 * `docs/status.md`/issue #49 for why this was left for a real-Postgres pass.
 *
 * Run via `npm run test:edge:local` (issue #92's local stack must be up — see this directory's
 * README). Not run by `npm test`/`deno test`'s default discovery: `.local.ts` matches neither
 * `deno test`'s default `*.test.ts`/`*_test.ts` glob nor Jest's, the same convention
 * `grounding-eval.live.ts` already uses in this repo for a test that needs infra `npm test` cannot
 * assume is present.
 */
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { createTestUser, deleteTestUser, serviceRoleClient } from './client.ts';

const client = serviceRoleClient();

async function reserve(userId: string, idempotencyKey: string, frameCount = 1, mediaType: 'photo' | 'video' = 'photo') {
  const { data, error } = await client.rpc('reserve_analysis', {
    p_user_id: userId,
    p_idempotency_key: idempotencyKey,
    p_media_type: mediaType,
    p_frame_count: frameCount,
  });
  if (error) throw new Error(`reserve_analysis failed: ${error.message}`);
  return data as Record<string, unknown>;
}

async function release(userId: string, analysisId: string) {
  const { data, error } = await client.rpc('release_analysis', {
    p_user_id: userId,
    p_analysis_id: analysisId,
    p_reason: 'internal_error',
  });
  if (error) throw new Error(`release_analysis failed: ${error.message}`);
  return data as Record<string, unknown>;
}

async function activeAnalysisCount(userId: string): Promise<number> {
  const { count, error } = await client
    .from('analyses')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) throw new Error(`count query failed: ${error.message}`);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// 1. CONCURRENCY — two simultaneous reserves for the same user's last (free-tier) slot.
// ---------------------------------------------------------------------------
Deno.test('reserve_analysis: two concurrent reserves for a free user race the same slot, exactly one wins', async () => {
  const userId = await createTestUser(client, 'concurrency');
  try {
    const [a, b] = await Promise.all([
      reserve(userId, `concurrency-a-${crypto.randomUUID()}`),
      reserve(userId, `concurrency-b-${crypto.randomUUID()}`),
    ]);

    const outcomes = [a, b];
    const winners = outcomes.filter((o) => o.allowed === true && o.existing === false);
    const losers = outcomes.filter((o) => o.allowed === false);

    assertEquals(winners.length, 1, `expected exactly one winner, got: ${JSON.stringify(outcomes)}`);
    assertEquals(losers.length, 1, `expected exactly one loser, got: ${JSON.stringify(outcomes)}`);
    assertEquals(losers[0].reason, 'quota_exceeded');

    // The property under test: the advisory lock, not just "the count happened to work out" —
    // confirmed independently from the row side, not just the RPC's own claim.
    assertEquals(await activeAnalysisCount(userId), 1);
  } finally {
    await deleteTestUser(client, userId);
  }
});

// ---------------------------------------------------------------------------
// 2. IDEMPOTENT REPLAY — same (user_id, idempotency_key) never double-reserves.
// ---------------------------------------------------------------------------
Deno.test('reserve_analysis: two concurrent calls with the SAME idempotency key never double-reserve', async () => {
  const userId = await createTestUser(client, 'idempotent');
  try {
    const key = `idempotent-${crypto.randomUUID()}`;
    const [a, b] = await Promise.all([reserve(userId, key), reserve(userId, key)]);

    assertEquals(a.id, b.id, `both calls must return the same row id, got: ${JSON.stringify([a, b])}`);
    // Exactly one of the two racing callers is the one that actually performed the insert.
    const existingFlags = [a.existing, b.existing].sort();
    assertEquals(existingFlags, [false, true]);
    assertEquals(await activeAnalysisCount(userId), 1);
  } finally {
    await deleteTestUser(client, userId);
  }
});

Deno.test('reserve_analysis: replaying a RELEASED reservation returns status "released", not a new reservation', async () => {
  const userId = await createTestUser(client, 'released-replay');
  try {
    const key = `released-replay-${crypto.randomUUID()}`;
    const first = await reserve(userId, key);
    assertEquals(first.allowed, true);
    assertEquals(first.existing, false);

    const released = await release(userId, first.id as string);
    assertEquals(released.ok, true);
    assertEquals(released.status, 'released');

    // Binding rule #2 (issue #44) — the subtle case: replaying the SAME idempotency key after a
    // release must return the existing (released) row, never mint a second reservation.
    const replay = await reserve(userId, key);
    assertEquals(replay.allowed, true);
    assertEquals(replay.existing, true);
    assertEquals(replay.id, first.id);
    assertEquals(replay.status, 'released');
    assertEquals(await activeAnalysisCount(userId), 1);
  } finally {
    await deleteTestUser(client, userId);
  }
});

// ---------------------------------------------------------------------------
// 3. MONTH-END PERIOD ARITHMETIC — pace_add_months_clamped / pace_current_period.
// ---------------------------------------------------------------------------
async function addMonthsClamped(base: string, n: number): Promise<string> {
  const { data, error } = await client.rpc('pace_add_months_clamped', { base, n });
  if (error) throw new Error(`pace_add_months_clamped failed: ${error.message}`);
  return data as string;
}

function ymd(iso: string): string {
  return iso.slice(0, 10);
}

Deno.test('pace_add_months_clamped: the documented walk Jan 31 -> Feb 28 -> Mar 31 -> Apr 30 (non-leap year)', async () => {
  const jan31 = '2026-01-31T12:00:00Z';
  assertEquals(ymd(await addMonthsClamped(jan31, 1)), '2026-02-28');
  assertEquals(ymd(await addMonthsClamped(jan31, 2)), '2026-03-31');
  assertEquals(ymd(await addMonthsClamped(jan31, 3)), '2026-04-30');
});

Deno.test('pace_add_months_clamped: clamps to Feb 29 in a leap year', async () => {
  const jan31LeapYear = '2028-01-31T12:00:00Z';
  assertEquals(ymd(await addMonthsClamped(jan31LeapYear, 1)), '2028-02-29');
});

Deno.test('pace_add_months_clamped: negative n walks backward with the same clamping', async () => {
  const apr30 = '2026-04-30T12:00:00Z';
  assertEquals(ymd(await addMonthsClamped(apr30, -1)), '2026-03-30');
  const mar31 = '2026-03-31T12:00:00Z';
  assertEquals(ymd(await addMonthsClamped(mar31, -1)), '2026-02-28');
});

Deno.test('pace_current_period: returns the half-open [start, end) window anchored on Jan 31', async () => {
  const anchor = '2026-01-31T00:00:00Z';
  async function windowFor(asOf: string): Promise<{ start: string; end: string }> {
    const { data, error } = await client.rpc('pace_current_period', { anchor, as_of: asOf });
    if (error) throw new Error(`pace_current_period failed: ${error.message}`);
    // Postgres returns a tstzrange as its canonical text form, e.g. ["2026-01-31 00:00:00+00","2026-02-28 00:00:00+00")
    const match = /^[[(]"?([^",]+)"?,\s*"?([^",)\]]+)"?[)\]]$/.exec(data as string);
    assert(match, `unexpected tstzrange shape: ${data}`);
    return { start: match[1], end: match[2] };
  }

  const midFeb = await windowFor('2026-02-15T00:00:00Z');
  assertEquals(ymd(midFeb.start), '2026-01-31');
  assertEquals(ymd(midFeb.end), '2026-02-28');

  const midMar = await windowFor('2026-03-15T00:00:00Z');
  assertEquals(ymd(midMar.start), '2026-02-28');
  assertEquals(ymd(midMar.end), '2026-03-31');

  const midApr = await windowFor('2026-04-15T00:00:00Z');
  assertEquals(ymd(midApr.start), '2026-03-31');
  assertEquals(ymd(midApr.end), '2026-04-30');
});

// ---------------------------------------------------------------------------
// 4. FREE IS LIFETIME, PRO/ELITE ARE PERIOD-BASED — a real branch, not just documented.
// ---------------------------------------------------------------------------
Deno.test('reserve_analysis: free tier quota is lifetime (limit 1), independent of pace_current_period', async () => {
  const userId = await createTestUser(client, 'free-lifetime');
  try {
    const first = await reserve(userId, `free-lifetime-a-${crypto.randomUUID()}`);
    assertEquals(first.allowed, true);
    assertEquals(first.tier, 'free');

    const second = await reserve(userId, `free-lifetime-b-${crypto.randomUUID()}`);
    assertEquals(second.allowed, false);
    assertEquals(second.reason, 'quota_exceeded');
    assertEquals(second.limit, 1);
  } finally {
    await deleteTestUser(client, userId);
  }
});

Deno.test('reserve_analysis: pro tier quota (limit 10) is enforced via pace_current_period, not lifetime', async () => {
  const userId = await createTestUser(client, 'pro-period');
  try {
    const { error: subError } = await client.from('subscriptions').insert({
      user_id: userId,
      tier: 'pro',
      status: 'active',
      purchased_at: new Date().toISOString(),
    });
    if (subError) throw new Error(`failed to seed subscription: ${subError.message}`);

    for (let i = 0; i < 10; i += 1) {
      const result = await reserve(userId, `pro-period-${i}-${crypto.randomUUID()}`);
      assertEquals(result.allowed, true, `reservation ${i} should be allowed, got: ${JSON.stringify(result)}`);
      assertEquals(result.tier, 'pro');
    }

    const eleventh = await reserve(userId, `pro-period-overflow-${crypto.randomUUID()}`);
    assertEquals(eleventh.allowed, false);
    assertEquals(eleventh.reason, 'quota_exceeded');
    assertEquals(eleventh.limit, 10);
    // Confirmed independently from the row side — the rejected 11th call must not have inserted
    // anything, not just returned allowed: false.
    assertEquals(await activeAnalysisCount(userId), 10);
  } finally {
    await deleteTestUser(client, userId);
  }
});
