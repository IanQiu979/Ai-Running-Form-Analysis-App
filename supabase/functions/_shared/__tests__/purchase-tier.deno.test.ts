/**
 * Regression locks for `_shared/purchase-tier.ts` and its migration — `POST /functions/v1/
 * purchase-tier` (issue #51), the dummy purchase and the ONLY legitimate writer to
 * `public.subscriptions`.
 *
 * Three kinds of test live here, deliberately:
 *
 *   1. REQUEST-VALIDATION AND RESPONSE-SHAPING tests over the real exported functions, with an
 *      injected `FakeRpcClient` standing in for a Postgres round trip (the same technique
 *      `quota-status.deno.test.ts` / `delete-analysis.deno.test.ts` use for their subjects).
 *
 *   2. A SEMANTIC MODEL of `pace_purchase_tier` (`ModelSubscriptionsTable` below) — a TypeScript
 *      re-statement of what the SQL function promises, driven through the real `purchaseTier()`
 *      so the repurchase/upgrade/downgrade/reactivate SEQUENCES can be exercised. This is a model,
 *      not the SQL: it proves the semantics this endpoint is specified to have, and it is only
 *      worth anything because section 5 ties the model back to the actual migration text. Said
 *      plainly rather than dressed up as an integration test — the migration is WRITTEN, NOT
 *      APPLIED (issue #51's hard constraint forbids `db push` from this worktree), so there is no
 *      live Postgres to test against and this is the honest ceiling.
 *
 *   3. MIGRATION-TEXT INVARIANTS — the bridge. These read
 *      `supabase/migrations/20260713120000_purchase_tier_function.sql` and assert the properties
 *      the whole issue turns on, directly against the SQL that will actually run:
 *        (a) it never adds a client-writable policy or grant on `subscriptions`, and it revokes
 *            the default INSERT/UPDATE/DELETE/TRUNCATE grant on both `subscriptions` and
 *            `profiles` from `authenticated`/`anon` (2026-07-13 security audit, PR #123);
 *        (b) `purchased_at` is written ONLY by the INSERT and never appears in the UPDATE's SET
 *            list — the property that makes a repurchase unable to reset a user's quota period;
 *        (c) `p_as_of` does not exist anywhere in the function (removed in the same audit — a
 *            caller-suppliable period anchor is exactly the re-anchoring exploit (b) forbids);
 *        (d) the per-user rate limit is a genuine early return — no mutation happens on that path.
 *      A model test can be fooled by a wrong model. These cannot: they read the shipping SQL.
 *
 * DENO-ONLY, DELIBERATELY (issue #90 convention, same as `quota-status.deno.test.ts`'s header):
 * named `.deno.test.ts` so `jest.config.js`'s `testPathIgnorePatterns` skips it and only
 * `deno test` (`npm run test:edge`) runs it.
 */
import {
  checkDeploymentGate,
  httpStatusForPurchase,
  parsePurchaseRequest,
  parsePurchaseTierRow,
  purchaseTier,
  responseBodyForPurchase,
  type DeploymentGateConfig,
  type PurchasableTier,
  type RpcClient,
} from '../purchase-tier.ts';

// ---------------------------------------------------------------------------
// Test doubles & helpers
// ---------------------------------------------------------------------------

class FakeRpcClient implements RpcClient {
  readonly calls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  constructor(private response: { data: unknown; error: { message: string } | null }) {}

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
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';

// ---------------------------------------------------------------------------
// 1. Request validation — tier, source, body shape
// ---------------------------------------------------------------------------

Deno.test('parsePurchaseRequest: accepts the documented V2.2 contract for both purchasable tiers', () => {
  for (const tier of ['pro', 'elite'] as const) {
    const parsed = parsePurchaseRequest({ tier, source: 'dummy' });
    assertTrue(parsed.ok, `{ tier: "${tier}", source: "dummy" } must be accepted`);
    if (parsed.ok) {
      assertEquals(parsed.request, { tier, source: 'dummy' });
    }
  }
});

Deno.test('parsePurchaseRequest: rejects tier "free" — free is the ABSENCE of a subscriptions row, never a purchasable tier', () => {
  const parsed = parsePurchaseRequest({ tier: 'free', source: 'dummy' });
  assertTrue(!parsed.ok, '"free" must be rejected: the subscription_tier enum has no such member');
  if (!parsed.ok) {
    assertEquals(parsed.code, 'invalid_tier');
  }
});

Deno.test('parsePurchaseRequest: rejects an unknown/garbage tier rather than passing it to the enum and 500ing', () => {
  for (const tier of ['ultra', 'ELITE', 'admin', '', 'pro; drop table subscriptions', 42, null, undefined, { tier: 'pro' }]) {
    const parsed = parsePurchaseRequest({ tier, source: 'dummy' });
    assertTrue(!parsed.ok, `tier ${JSON.stringify(tier)} must be rejected`);
    if (!parsed.ok) {
      assertEquals(parsed.code, 'invalid_tier', `tier ${JSON.stringify(tier)} must fail as invalid_tier`);
    }
  }
});

Deno.test('parsePurchaseRequest: rejects a non-dummy source — v1 verifies no receipts, so honoring one would grant a paid tier on an unverified claim', () => {
  for (const source of ['apple', 'apple_iap', 'stripe', 'google_play', '', null, undefined, true]) {
    const parsed = parsePurchaseRequest({ tier: 'pro', source });
    assertTrue(!parsed.ok, `source ${JSON.stringify(source)} must be rejected`);
    if (!parsed.ok) {
      assertEquals(parsed.code, 'invalid_source', `source ${JSON.stringify(source)} must fail as invalid_source`);
    }
  }
});

Deno.test('parsePurchaseRequest: rejects a missing source outright rather than defaulting it to "dummy"', () => {
  const parsed = parsePurchaseRequest({ tier: 'elite' });
  assertTrue(!parsed.ok, 'an absent source must be a hard failure — defaulting it would silently honor a future real-IAP client');
  if (!parsed.ok) {
    assertEquals(parsed.code, 'invalid_source');
  }
});

Deno.test('parsePurchaseRequest: rejects a null/array/scalar body', () => {
  for (const body of [null, ['pro'], 'pro', 42]) {
    const parsed = parsePurchaseRequest(body);
    assertTrue(!parsed.ok, `body ${JSON.stringify(body)} must be rejected`);
    if (!parsed.ok) {
      assertEquals(parsed.code, 'invalid_body');
    }
  }
});

// ---------------------------------------------------------------------------
// 2. The user id comes from the verified JWT — never the request body
// ---------------------------------------------------------------------------

Deno.test('parsePurchaseRequest: a user_id in the body is never read — the parsed request carries only tier and source', () => {
  const parsed = parsePurchaseRequest({
    tier: 'elite',
    source: 'dummy',
    user_id: OTHER_USER_ID,
    userId: OTHER_USER_ID,
    sub: OTHER_USER_ID,
  });

  assertTrue(parsed.ok, 'extra body fields are ignored, not fatal');
  if (parsed.ok) {
    // The whole point: there is no channel through which a body-supplied id can reach the RPC.
    assertEquals(
      parsed.request,
      { tier: 'elite', source: 'dummy' },
      'the parsed request must contain ONLY tier and source — never any caller-supplied identity'
    );
  }
});

Deno.test('purchaseTier: calls pace_purchase_tier with the caller id it was given (the JWT-derived one), not anything from the body', async () => {
  const client = new FakeRpcClient({
    data: {
      tier: 'pro',
      purchased_at: '2026-07-13T10:00:00+00:00',
      period_start: '2026-07-13T10:00:00+00:00',
      period_end: '2026-08-13T10:00:00+00:00',
      outcome: 'created',
    },
    error: null,
  });

  await purchaseTier(client, USER_ID, 'pro');

  assertEquals(
    client.calls,
    [{ fn: 'pace_purchase_tier', args: { p_user_id: USER_ID, p_tier: 'pro' } }],
    'the RPC must receive exactly the userId passed in by index.ts (resolved via auth.getUser()) and the validated tier'
  );
  // Belt and braces: the id an attacker would try to smuggle must appear nowhere in the RPC args.
  assertTrue(
    !JSON.stringify(client.calls).includes(OTHER_USER_ID),
    'no other user id may ever reach the RPC'
  );
});

// ---------------------------------------------------------------------------
// 3. Response shaping — the contract is exactly three fields
// ---------------------------------------------------------------------------

Deno.test('responseBodyForPurchase: returns EXACTLY { tier, periodStart, periodEnd } — the V2.2 contract, byte-compatible', () => {
  const result = parsePurchaseTierRow({
    tier: 'elite',
    purchased_at: '2026-07-13T10:00:00+00:00',
    period_start: '2026-07-13T10:00:00+00:00',
    period_end: '2026-08-13T10:00:00+00:00',
    outcome: 'created',
  });

  const body = responseBodyForPurchase(result);

  assertEquals(body, {
    tier: 'elite',
    periodStart: '2026-07-13T10:00:00+00:00',
    periodEnd: '2026-08-13T10:00:00+00:00',
  });
  assertEquals(Object.keys(body).sort(), ['periodEnd', 'periodStart', 'tier']);
  // `purchasedAt` and `outcome` are diagnostic — logged, never returned. A fourth field is how a
  // contract stops being identical to the one v2 must be able to swap `source` inside of.
  assertTrue(!('purchasedAt' in body), 'purchasedAt must not leak into the response body');
  assertTrue(!('outcome' in body), 'outcome must not leak into the response body');
});

Deno.test('httpStatusForPurchase: 200 for every non-rate-limited outcome — a repurchase is a successful no-op, not a 409', () => {
  for (const outcome of ['created', 'unchanged', 'tier_changed', 'reactivated'] as const) {
    const result = parsePurchaseTierRow({
      tier: 'pro',
      purchased_at: '2026-07-13T10:00:00+00:00',
      period_start: '2026-07-13T10:00:00+00:00',
      period_end: '2026-08-13T10:00:00+00:00',
      outcome,
    });
    assertEquals(httpStatusForPurchase(result), 200, `outcome ${outcome} must map to 200`);
  }
});

Deno.test('httpStatusForPurchase: 429 for rate_limited — a refusal, not a state assertion that held', () => {
  const result = parsePurchaseTierRow({
    tier: 'pro',
    purchased_at: '2026-07-13T10:00:00+00:00',
    period_start: '2026-07-13T10:00:00+00:00',
    period_end: '2026-08-13T10:00:00+00:00',
    outcome: 'rate_limited',
  });
  assertEquals(httpStatusForPurchase(result), 429);
});

Deno.test('responseBodyForPurchase: rate_limited returns an error-shaped body, never the success shape — a caller checking only the body must not mistake a refusal for a granted tier', () => {
  const result = parsePurchaseTierRow({
    tier: 'elite',
    purchased_at: '2026-07-13T10:00:00+00:00',
    period_start: '2026-07-13T10:00:00+00:00',
    period_end: '2026-08-13T10:00:00+00:00',
    outcome: 'rate_limited',
  });

  const body = responseBodyForPurchase(result);

  assertEquals(body.code, 'rate_limited');
  assertTrue(typeof body.error === 'string' && body.error.length > 0, 'must carry a human-readable error message');
  assertTrue(!('tier' in body), 'tier must not leak into a rate-limited response body');
  assertTrue(!('periodStart' in body), 'periodStart must not leak into a rate-limited response body');
  assertTrue(!('periodEnd' in body), 'periodEnd must not leak into a rate-limited response body');
});

Deno.test('purchaseTier: propagates an RPC error rather than returning a fabricated period', async () => {
  const client = new FakeRpcClient({ data: null, error: { message: 'connection refused' } });
  await assertThrows(
    () => purchaseTier(client, USER_ID, 'pro'),
    'purchaseTier must throw on an RPC error, never silently claim a tier was granted'
  );
});

Deno.test('parsePurchaseTierRow: rejects a malformed/null/array payload', () => {
  for (const bad of [null, 'not an object', 42, ['array']]) {
    let threw = false;
    try {
      parsePurchaseTierRow(bad);
    } catch {
      threw = true;
    }
    assertTrue(threw, `expected parsePurchaseTierRow to reject ${JSON.stringify(bad)}`);
  }
});

Deno.test('parsePurchaseTierRow: rejects a "free" or unrecognized tier coming back from the DB', () => {
  for (const tier of ['free', 'ultra', null]) {
    let threw = false;
    try {
      parsePurchaseTierRow({
        tier,
        purchased_at: '2026-07-13T10:00:00+00:00',
        period_start: '2026-07-13T10:00:00+00:00',
        period_end: '2026-08-13T10:00:00+00:00',
        outcome: 'created',
      });
    } catch {
      threw = true;
    }
    assertTrue(threw, `a ${JSON.stringify(tier)} tier from pace_purchase_tier must be a hard failure`);
  }
});

Deno.test('parsePurchaseTierRow: rejects a missing period — a paid tier ALWAYS has one (only free is period-less, and free can never be a row here)', () => {
  for (const patch of [{ period_start: null }, { period_end: null }, { purchased_at: null }]) {
    let threw = false;
    try {
      parsePurchaseTierRow({
        tier: 'pro',
        purchased_at: '2026-07-13T10:00:00+00:00',
        period_start: '2026-07-13T10:00:00+00:00',
        period_end: '2026-08-13T10:00:00+00:00',
        outcome: 'created',
        ...patch,
      });
    } catch {
      threw = true;
    }
    assertTrue(threw, `expected a null ${Object.keys(patch)[0]} to be rejected, not coerced`);
  }
});

Deno.test('parsePurchaseTierRow: rejects an unrecognized outcome rather than guessing', () => {
  let threw = false;
  try {
    parsePurchaseTierRow({
      tier: 'pro',
      purchased_at: '2026-07-13T10:00:00+00:00',
      period_start: '2026-07-13T10:00:00+00:00',
      period_end: '2026-08-13T10:00:00+00:00',
      outcome: 'renewed',
    });
  } catch {
    threw = true;
  }
  assertTrue(threw, 'an unknown outcome means the SQL and this module have drifted — fail, do not guess');
});

// ---------------------------------------------------------------------------
// 3b. DEPLOYMENT GATE — checkDeploymentGate's decision logic (2026-07-13 security audit, PR #123).
//     Deno-env reading itself lives in index.ts and is untested here by design (Deno.env is not
//     portable) — this is the pure decision function index.ts calls after reading it.
// ---------------------------------------------------------------------------

Deno.test('checkDeploymentGate: refuses with not_found when the master flag is disabled, regardless of allowlist', () => {
  const configs: DeploymentGateConfig[] = [
    { enabled: false, allowedUserIds: null },
    { enabled: false, allowedUserIds: [USER_ID] },
  ];
  for (const config of configs) {
    const decision = checkDeploymentGate(config, USER_ID);
    assertEquals(decision, { allowed: false, code: 'not_found' });
  }
});

Deno.test('checkDeploymentGate: allows any caller when enabled with no allowlist configured', () => {
  const config: DeploymentGateConfig = { enabled: true, allowedUserIds: null };
  assertEquals(checkDeploymentGate(config, USER_ID), { allowed: true });
  assertEquals(checkDeploymentGate(config, OTHER_USER_ID), { allowed: true });
});

Deno.test('checkDeploymentGate: enabled + allowlist — only listed ids pass, everyone else gets the SAME not_found as a disabled flag', () => {
  const config: DeploymentGateConfig = { enabled: true, allowedUserIds: [USER_ID] };

  assertEquals(checkDeploymentGate(config, USER_ID), { allowed: true });

  const denied = checkDeploymentGate(config, OTHER_USER_ID);
  assertEquals(
    denied,
    { allowed: false, code: 'not_found' },
    'a non-allowlisted caller must get the identical refusal shape a disabled flag would — ' +
      'distinguishable responses would leak that an allowlist exists and let someone probe it'
  );
});

Deno.test('checkDeploymentGate: the allowlist is checked against the id the caller supplies to this function, never anything else — index.ts is responsible for that id being JWT-verified', () => {
  // This function only proves the comparison itself is correct; it has no way to know where
  // callerUserId came from. The "never from the request body" guarantee is index.ts's job (it
  // only ever calls this with the id resolveCallerUserId() returned) and purchaseTier's own test
  // above already locks that no body-derived id reaches the RPC either.
  const config: DeploymentGateConfig = { enabled: true, allowedUserIds: [USER_ID] };
  assertEquals(checkDeploymentGate(config, USER_ID).allowed, true);
  assertEquals(checkDeploymentGate(config, `${USER_ID}x`).allowed, false, 'must be an exact match, not a prefix');
});

// ---------------------------------------------------------------------------
// 4. THE ANCHOR RULE — repurchase / upgrade / downgrade / reactivate
//
//    `ModelSubscriptionsTable` is a TypeScript re-statement of what `pace_purchase_tier` promises
//    (see this file's header, kind 2). It exists so the SEQUENCES below can be driven through the
//    real `purchaseTier()`. Section 5 is what ties this model to the SQL that will actually run.
// ---------------------------------------------------------------------------

interface ModelRow {
  tier: PurchasableTier;
  purchasedAt: string;
  status: 'active' | 'canceled';
}

/**
 * Models `pace_purchase_tier`'s contract: an upsert on `user_id` whose UPDATE path sets `tier` and
 * `status` but NEVER `purchased_at`. Mirrors the migration's four outcomes.
 */
class ModelSubscriptionsTable implements RpcClient {
  private rows = new Map<string, ModelRow>();

  constructor(private now: string) {}

  /** Seeds a pre-existing row, e.g. a subscription that was later canceled. */
  seed(userId: string, row: ModelRow): void {
    this.rows.set(userId, { ...row });
  }

  peek(userId: string): ModelRow | undefined {
    const row = this.rows.get(userId);
    return row ? { ...row } : undefined;
  }

  /** Advances wall-clock time, so a later purchase would re-anchor IF the SQL wrongly allowed it. */
  setNow(now: string): void {
    this.now = now;
  }

  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> {
    if (fn !== 'pace_purchase_tier') {
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } });
    }
    const userId = args.p_user_id as string;
    const tier = args.p_tier as PurchasableTier;

    const existing = this.rows.get(userId);
    let outcome: string;

    if (!existing) {
      // The ONLY path that ever writes purchased_at.
      this.rows.set(userId, { tier, purchasedAt: this.now, status: 'active' });
      outcome = 'created';
    } else {
      outcome =
        existing.tier !== tier ? 'tier_changed' : existing.status !== 'active' ? 'reactivated' : 'unchanged';
      // tier and status change; purchasedAt is deliberately carried over untouched.
      this.rows.set(userId, { tier, purchasedAt: existing.purchasedAt, status: 'active' });
    }

    const row = this.rows.get(userId)!;
    const period = modelCurrentPeriod(row.purchasedAt, this.now);
    return Promise.resolve({
      data: {
        tier: row.tier,
        purchased_at: row.purchasedAt,
        period_start: period.start,
        period_end: period.end,
        outcome,
      },
      error: null,
    });
  }
}

/**
 * A minimal stand-in for `pace_current_period(anchor, as_of)` — the month-end-clamped,
 * purchase-day anchored window. The REAL arithmetic (and its Jan 31 -> Feb 28 clamping) lives in
 * `20260711150300_quota_period_helpers.sql`; this model only needs to be faithful enough to show
 * that the window is a pure function of the ANCHOR — which is the property section 4 is about.
 */
function modelCurrentPeriod(anchorIso: string, asOfIso: string): { start: string; end: string } {
  const anchor = new Date(anchorIso);
  const asOf = new Date(asOfIso);

  const addMonthsClamped = (base: Date, n: number): Date => {
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth();
    const d = base.getUTCDate();
    const target = new Date(Date.UTC(y, m + n, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    return new Date(
      Date.UTC(
        target.getUTCFullYear(),
        target.getUTCMonth(),
        Math.min(d, lastDay),
        base.getUTCHours(),
        base.getUTCMinutes(),
        base.getUTCSeconds()
      )
    );
  };

  let n =
    (asOf.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (asOf.getUTCMonth() - anchor.getUTCMonth());
  let start = addMonthsClamped(anchor, n);
  if (start > asOf) {
    n -= 1;
    start = addMonthsClamped(anchor, n);
  }
  const end = addMonthsClamped(anchor, n + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

Deno.test('first purchase: anchors purchased_at to now, and the period is derived from that anchor', async () => {
  const db = new ModelSubscriptionsTable('2026-07-13T10:00:00.000Z');

  const result = await purchaseTier(db, USER_ID, 'pro');

  assertEquals(result.outcome, 'created');
  assertEquals(result.tier, 'pro');
  assertEquals(result.purchasedAt, '2026-07-13T10:00:00.000Z', 'the anchor is set to the purchase moment');
  assertEquals(result.periodStart, '2026-07-13T10:00:00.000Z');
  assertEquals(result.periodEnd, '2026-08-13T10:00:00.000Z', 'one purchase-day-anchored month');
});

Deno.test('REPURCHASE IS IDEMPOTENT: buying the same tier again 20 days later does NOT move the anchor, so the period (and the used-count window) is unchanged', async () => {
  const db = new ModelSubscriptionsTable('2026-07-13T10:00:00.000Z');
  const first = await purchaseTier(db, USER_ID, 'pro');

  // 20 days later, mid-period — the user (or a double-tapped button, or a retried request) buys
  // Pro again. If this re-anchored purchased_at, the quota window would slide to [Aug 2, Sep 2)
  // and every analysis they had already run this period would fall OUTSIDE it — resetting `used`
  // to 0 and handing them a free extra 10 analyses, repeatable at will, for free, because this is
  // a dummy payment. That is the exploit this test exists to prevent.
  db.setNow('2026-08-02T09:30:00.000Z');
  const second = await purchaseTier(db, USER_ID, 'pro');

  assertEquals(second.outcome, 'unchanged', 'a same-tier repurchase is a no-op');
  assertEquals(second.purchasedAt, first.purchasedAt, 'THE ANCHOR MUST NOT MOVE ON A REPURCHASE');
  assertEquals(
    responseBodyForPurchase(second),
    responseBodyForPurchase(first),
    'a repurchase mid-period must return the identical period — same anchor, same window'
  );
  assertEquals(db.peek(USER_ID)?.purchasedAt, '2026-07-13T10:00:00.000Z');
});

Deno.test('repurchase in a LATER period returns that later period — the anchor still has not moved, the window simply rolled', async () => {
  const db = new ModelSubscriptionsTable('2026-07-13T10:00:00.000Z');
  const first = await purchaseTier(db, USER_ID, 'pro');

  // Two months on. The period rolls because pace_current_period derives the window CONTAINING
  // now() from the anchor — not because anything was written.
  db.setNow('2026-09-20T00:00:00.000Z');
  const later = await purchaseTier(db, USER_ID, 'pro');

  assertEquals(later.purchasedAt, first.purchasedAt, 'the anchor is still the original purchase moment');
  assertEquals(later.periodStart, '2026-09-13T10:00:00.000Z', 'the window rolled to the one containing now()');
  assertEquals(later.periodEnd, '2026-10-13T10:00:00.000Z');
});

Deno.test('UPGRADE pro -> elite mid-period: tier changes, anchor does NOT — the higher limit applies within the SAME window', async () => {
  const db = new ModelSubscriptionsTable('2026-07-13T10:00:00.000Z');
  const pro = await purchaseTier(db, USER_ID, 'pro');

  db.setNow('2026-07-25T12:00:00.000Z');
  const elite = await purchaseTier(db, USER_ID, 'elite');

  assertEquals(elite.outcome, 'tier_changed');
  assertEquals(elite.tier, 'elite');
  assertEquals(elite.purchasedAt, pro.purchasedAt, 'an upgrade must not re-anchor the period');
  assertEquals(elite.periodStart, pro.periodStart, 'the window is unchanged — only the limit it is measured against');
  assertEquals(elite.periodEnd, pro.periodEnd);
});

Deno.test('TIER FLAPPING IS WORTHLESS: pro -> elite -> pro never moves the anchor, so `used` can never be reset by cycling tiers', async () => {
  const db = new ModelSubscriptionsTable('2026-07-13T10:00:00.000Z');
  const original = await purchaseTier(db, USER_ID, 'pro');

  db.setNow('2026-07-20T00:00:00.000Z');
  await purchaseTier(db, USER_ID, 'elite');
  db.setNow('2026-07-28T00:00:00.000Z');
  const back = await purchaseTier(db, USER_ID, 'pro');

  assertEquals(back.tier, 'pro');
  assertEquals(back.purchasedAt, original.purchasedAt, 'cycling tiers must never re-anchor');
  assertEquals(
    responseBodyForPurchase(back),
    responseBodyForPurchase(original),
    'after a full pro -> elite -> pro cycle the user is exactly where they started'
  );
});

Deno.test('REACTIVATE: repurchasing a canceled subscription flips status back to active and preserves the original anchor', async () => {
  const db = new ModelSubscriptionsTable('2026-11-05T00:00:00.000Z');
  // Nothing in v1 writes 'canceled' (there is no cancel endpoint yet), but the column exists and
  // both reserve_analysis and pace_quota_status key off `status = 'active'` — so the path is
  // pinned down here rather than left for whoever adds one to discover.
  db.seed(USER_ID, { tier: 'pro', purchasedAt: '2026-01-31T08:00:00.000Z', status: 'canceled' });

  const result = await purchaseTier(db, USER_ID, 'pro');

  assertEquals(result.outcome, 'reactivated');
  assertEquals(db.peek(USER_ID)?.status, 'active');
  assertEquals(result.purchasedAt, '2026-01-31T08:00:00.000Z', 'reactivation preserves the original anchor');
  // Harmless, and the reason preserving it is safe: pace_current_period derives the window
  // CONTAINING now() from any anchor however old. A long-lapsed user lands in a current period with
  // a correctly-zero usage count without the anchor ever moving. The Jan-31 anchor also shows the
  // month-end clamp: November has 30 days, so the window is [Oct 31, Nov 30).
  assertEquals(result.periodStart, '2026-10-31T08:00:00.000Z');
  assertEquals(result.periodEnd, '2026-11-30T08:00:00.000Z', 'month-end clamped — a Jan 31 anchor never spills into Dec 1');
});

Deno.test('two users purchasing concurrently do not collide — the row is keyed on the JWT-derived user id', async () => {
  const db = new ModelSubscriptionsTable('2026-07-13T10:00:00.000Z');

  const [a, b] = await Promise.all([
    purchaseTier(db, USER_ID, 'pro'),
    purchaseTier(db, OTHER_USER_ID, 'elite'),
  ]);

  assertEquals(a.tier, 'pro');
  assertEquals(b.tier, 'elite');
  assertEquals(db.peek(USER_ID)?.tier, 'pro');
  assertEquals(db.peek(OTHER_USER_ID)?.tier, 'elite');
});

// ---------------------------------------------------------------------------
// 5. MIGRATION-TEXT INVARIANTS — the bridge from the model above to the SQL that will actually run.
//    These are the tests that would catch a wrong model, and they guard the two properties the
//    entire issue turns on. (`pace_purchase_tier` is WRITTEN, NOT APPLIED — see the file header.)
// ---------------------------------------------------------------------------

const MIGRATION_URL = new URL('../../../migrations/20260713120000_purchase_tier_function.sql', import.meta.url);

function readMigration(): string {
  return Deno.readTextFileSync(MIGRATION_URL);
}

/**
 * Strips `--` line comments before scanning for SQL constructs. The migration's header legitimately
 * discusses, in prose, the client-writable policy it must NEVER create and the `purchased_at =`
 * assignment it must NEVER make — so a naive substring search over the raw file would
 * false-positive on its own documentation. Same technique `quota-status.deno.test.ts` uses.
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

Deno.test('MIGRATION: adds NO client-writable policy or grant on subscriptions — the Echo V1 mistake this whole endpoint exists to avoid', () => {
  const code = stripSqlComments(readMigration());

  assertTrue(
    !/create\s+policy/i.test(code),
    'this migration must not create ANY policy. `subscriptions` has a SELECT policy and no ' +
      'INSERT/UPDATE policy for authenticated, deliberately — one would let any user self-grant ' +
      'elite for free with a single REST call (Echo V1 shipped exactly that and had to remove it). ' +
      'The tier write goes through pace_purchase_tier as service_role instead. Do not add one.'
  );
  assertTrue(
    !/grant[\s\S]*?\bto\s+(authenticated|anon)\b/i.test(code),
    'this migration must not grant anything to authenticated or anon — the client gets SELECT on ' +
      'subscriptions and nothing else'
  );
  assertTrue(
    !/alter\s+table[\s\S]*?subscriptions[\s\S]*?disable\s+row\s+level\s+security/i.test(code),
    'RLS on subscriptions must never be disabled'
  );
});

Deno.test('MIGRATION: revokes the default INSERT/UPDATE/DELETE/TRUNCATE grant on subscriptions AND profiles from authenticated/anon (2026-07-13 audit) — the grant-layer defense-in-depth beneath the RLS/policy checks above', () => {
  const code = stripSqlComments(readMigration());

  const revokeSubscriptions =
    /revoke\s+insert\s*,\s*update\s*,\s*delete\s*,\s*truncate\s+on\s+public\.subscriptions\s+from\s+authenticated\s*,\s*anon\s*;/i;
  const revokeProfiles =
    /revoke\s+insert\s*,\s*update\s*,\s*delete\s*,\s*truncate\s+on\s+public\.profiles\s+from\s+authenticated\s*,\s*anon\s*;/i;

  assertTrue(
    revokeSubscriptions.test(code),
    'must revoke insert/update/delete/truncate on public.subscriptions from authenticated and anon — ' +
      'mirrors the consents/storage.objects hardening pattern (issue #100); TRUNCATE in particular is ' +
      'not subject to RLS at all, so a policy-only defense leaves it open on the grant alone'
  );
  assertTrue(
    revokeProfiles.test(code),
    'must revoke insert/update/delete/truncate on public.profiles from authenticated and anon — the ' +
      'FK target of subscriptions.user_id, same exposure, same fix'
  );
});

Deno.test('MIGRATION: p_as_of does not exist anywhere in the executable SQL — removed in the 2026-07-13 audit as a caller-suppliable period-anchor footgun', () => {
  const code = stripSqlComments(readMigration());

  assertTrue(
    !/p_as_of/i.test(code),
    'p_as_of must not appear anywhere in the function signature or body. It used to default to ' +
      'now() and was never passed by purchaseTier() (so unreachable), but a future edge-function ' +
      'change threading a client timestamp through to it would hand an attacker exactly the ' +
      're-anchoring exploit this file\'s header spends forty lines forbidding. Removed rather than ' +
      'merely guarded, so it cannot be reintroduced by accident the way a guard could be loosened ' +
      'by accident.'
  );
  assertTrue(
    /public\.pace_current_period\(v_(purchased_at|prev_purchased_at),\s*now\(\)\)/i.test(code),
    'the period must be derived against the real wall-clock now(), not a parameter'
  );
});

Deno.test('MIGRATION: purchased_at is written ONLY by the INSERT — it never appears in the UPDATE SET list, which is what makes a repurchase unable to reset the quota period', () => {
  const code = stripSqlComments(readMigration());

  // The UPDATE statement's SET list: everything between `update public.subscriptions` and its
  // terminating `where`. This is the exact text a well-meaning future edit would add
  // `purchased_at = p_as_of` to, and the exact edit that would reopen the exploit.
  const updateMatch = code.match(/update\s+public\.subscriptions\b([\s\S]*?)\bwhere\b/i);
  assertTrue(updateMatch !== null, 'expected an `update public.subscriptions ... where` statement');
  const setList = updateMatch![1];

  assertTrue(
    !/purchased_at/i.test(setList),
    'purchased_at MUST NOT appear in the UPDATE SET list. It is the period anchor: ' +
      'reserve_analysis and pace_quota_status both count a paid user\'s usage as ' +
      '`created_at <@ pace_current_period(purchased_at, now())`, so moving it slides the window ' +
      'and silently resets `used` to 0. Because this is a free, unlimited dummy purchase, that is ' +
      'an unlimited-free-analysis exploit reachable by replaying one request — not a billing quirk.'
  );
  assertTrue(
    /\btier\s*=/.test(setList) && /\bstatus\s*=/.test(setList),
    'the UPDATE must still set tier and status (upgrade/downgrade/reactivate)'
  );

  // ...and the INSERT must be the one place it IS written, otherwise the anchor is never set at all.
  const insertMatch = code.match(/insert\s+into\s+public\.subscriptions\b([\s\S]*?);/i);
  assertTrue(insertMatch !== null, 'expected an `insert into public.subscriptions` statement');
  assertTrue(
    /purchased_at/i.test(insertMatch![1]),
    'the INSERT must set purchased_at — it is the only statement that ever writes the anchor'
  );
});

Deno.test('MIGRATION: derives the period via the shared pace_current_period — never reimplements month arithmetic', () => {
  const code = stripSqlComments(readMigration());

  assertTrue(
    code.includes('public.pace_current_period('),
    'must call the SAME period function reserve_analysis and pace_quota_status call, so the ' +
      'boundaries this endpoint reports can never drift from the ones enforcement uses'
  );
  assertTrue(
    !/interval\s+'1 month'/i.test(code),
    'must not hand-roll month arithmetic — pace_add_months_clamped already handles the month-end ' +
      'clamping (Jan 31 -> Feb 28), and a second copy would drift'
  );
  assertTrue(
    !/period_start\s+timestamptz|add\s+column\s+period_/i.test(code),
    'must not add stored period columns — periods are derived at read time, by design (no rollover cron)'
  );
});

Deno.test('MIGRATION: contains no tier limits or frame caps — reserve_analysis is the sole enforcement point for those', () => {
  const code = stripSqlComments(readMigration());

  // Echo V1's documented duplication mistake: the same numbers living in two places and drifting.
  // This endpoint grants a TIER; it never says what a tier is worth.
  assertTrue(
    !/frame_cap/i.test(code),
    'frame caps (1/5/8) belong to reserve_analysis, not to the purchase path'
  );
  assertTrue(
    !/\bwhen\s+'pro'\s+then\s+\d+/i.test(code),
    'a tier -> limit case expression must not be duplicated here — reserve_analysis owns it'
  );
  // Prices (Pro $6.99 / Elite $14.99) are display-only and live in docs/design/copy-deck.md.
  assertTrue(
    !/6\.99|14\.99|price|amount_cents/i.test(code),
    'prices are display-only — they do not belong in the schema'
  );
});

Deno.test('MIGRATION: privilege shape matches the rest of the quota RPC family — service_role only, SECURITY DEFINER, pinned search_path, per-user advisory lock', () => {
  const sql = readMigration();

  assertTrue(
    sql.includes(
      'revoke execute on function public.pace_purchase_tier(uuid, public.subscription_tier) from public, anon, authenticated;'
    ),
    'EXECUTE must be revoked from public/anon/authenticated — otherwise the client could call the ' +
      'tier-granting RPC directly and the missing INSERT policy would be moot. Two-arg signature ' +
      '(uuid, subscription_tier) — p_as_of was removed in the 2026-07-13 audit.'
  );
  assertTrue(
    sql.includes(
      'grant execute on function public.pace_purchase_tier(uuid, public.subscription_tier) to service_role;'
    ),
    'EXECUTE must be granted to service_role only'
  );
  assertTrue(sql.includes('security definer'), 'must be SECURITY DEFINER, same as the rest of the quota RPC family');
  assertTrue(sql.includes('set search_path = public'), 'must pin search_path (function_search_path_mutable advisor)');
  assertTrue(
    sql.includes("pg_advisory_xact_lock(hashtext(p_user_id::text || ':tier_purchase'))"),
    'must take a per-user advisory lock, so two racing first-time purchases serialize instead of ' +
      'one taking a PK unique violation — same idiom as reserve_analysis'
  );
});

Deno.test('MIGRATION: the rate-limit branch is a genuine early return — no INSERT or UPDATE happens on the rate_limited path', () => {
  const code = stripSqlComments(readMigration());

  // Extract the rate-limit `if ... then ... end if;` block specifically (the one guarded by the
  // 3-second interval check), so this test can prove it neither inserts nor updates before
  // returning — the property that makes 'rate_limited' a true no-op rather than a mutation with a
  // misleading name.
  const rateLimitMatch = code.match(
    /if\s+found\s+and\s+\(now\(\)\s*-\s*v_prev_updated_at\)\s*<\s*interval\s+'3 seconds'\s+then([\s\S]*?)\bend if;/i
  );
  assertTrue(rateLimitMatch !== null, 'expected a rate-limit `if found and (now() - v_prev_updated_at) < interval ... then ... end if;` block');
  const rateLimitBlock = rateLimitMatch![1];

  assertTrue(
    /'rate_limited'/i.test(rateLimitBlock),
    'the rate-limit block must return outcome \'rate_limited\''
  );
  assertTrue(
    /return\s+jsonb_build_object/i.test(rateLimitBlock),
    'the rate-limit block must return directly (a normal typed return, never an exception — same ' +
      'house style gate_ai_call uses for its own denies)'
  );
  assertTrue(
    !/insert\s+into/i.test(rateLimitBlock),
    'the rate-limit block must never INSERT — a denied request must not create a row'
  );
  assertTrue(
    !/update\s+public\.subscriptions/i.test(rateLimitBlock),
    'the rate-limit block must never UPDATE subscriptions — a denied request must leave the ' +
      'existing tier/anchor/status completely untouched'
  );

  // And the inverse: the rate-limit check must run BEFORE the insert/update branch, not after —
  // otherwise it would be throttling nothing (the mutation would already have happened).
  const ifNotFoundIdx = code.search(/if\s+not\s+found\s+then/i);
  const rateLimitIdx = code.search(/if\s+found\s+and\s+\(now\(\)\s*-\s*v_prev_updated_at\)/i);
  assertTrue(rateLimitIdx >= 0 && ifNotFoundIdx >= 0 && rateLimitIdx < ifNotFoundIdx, 'the rate-limit check must precede the insert/update branch');
});

Deno.test('MIGRATION: does not redefine the quota RPC family it shares functions with', () => {
  const sql = readMigration();
  for (const forbidden of [
    'reserve_analysis',
    'settle_analysis',
    'release_analysis',
    'pace_quota_status',
    'pace_current_period',
  ]) {
    assertTrue(
      !new RegExp(`create or replace function public\\.${forbidden}`).test(sql),
      `this migration must never redefine ${forbidden} — other agents are working in parallel worktrees`
    );
  }
});
