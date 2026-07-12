/**
 * The orchestration behind `POST /functions/v1/purchase-tier` (issue #51) — the dummy purchase
 * that is the ONLY legitimate writer to `public.subscriptions`.
 *
 * Contract (deliberately identical to V2.2's, so v2 can swap `source` to real receipt
 * verification without changing the shape — do not "improve" it):
 *
 *     POST /functions/v1/purchase-tier   { tier, source: "dummy" }
 *     -> 200 { tier, periodStart, periodEnd }
 *
 * Deliberately free of any `npm:`/Deno-only import — same portability discipline as
 * `quota-status.ts`/`ai-guard.ts`/`delete-analysis.ts` — so this orchestration is unit-testable
 * with an injected fake `RpcClient` (see `__tests__/purchase-tier.deno.test.ts`) rather than a
 * real Postgres connection. The real Deno/`npm:@supabase/supabase-js` wiring lives in
 * `purchase-tier-client.ts`, imported only by `supabase/functions/purchase-tier/index.ts`.
 *
 * WHERE THE DECISIONS ACTUALLY LIVE: almost nowhere in this file. This module validates the
 * request shape and maps outcomes to HTTP; the tier write, the period anchoring, and the
 * idempotency semantics are all in ONE atomic SQL function, `pace_purchase_tier`
 * (`supabase/migrations/20260713120000_purchase_tier_function.sql` — WRITTEN, NOT APPLIED as of
 * issue #51; see its header). That is on purpose: `purchased_at` is the period anchor that
 * `pace_current_period` derives every quota window from, and a read-then-write split across the
 * network could re-anchor it under a race. Read that migration's header before touching this.
 *
 * TWO RULES THIS MODULE EXISTS TO KEEP:
 *
 *   1. NO TIER LIMITS OR FRAME CAPS HERE. `reserve_analysis` is the sole enforcement point for
 *      free 1 / pro 10 / elite 30 and frame caps 1 / 5 / 8. Duplicating those numbers into a
 *      second place is Echo V1's documented duplication mistake, and `pace_quota_status`'s
 *      migration already carries the one grudging copy that could not be avoided. This endpoint
 *      grants a TIER; it never says what a tier is worth. Prices (Pro $6.99 / Elite $14.99) are
 *      display-only and live in `docs/design/copy-deck.md` — not here either.
 *
 *   2. THE USER ID COMES FROM THE VERIFIED JWT, NEVER THE BODY. `parsePurchaseRequest` reads
 *      exactly two fields — `tier` and `source` — and there is no code path in this module or in
 *      `index.ts` that reads a user id from the request body. A body carrying `user_id` is not
 *      rejected, it is simply never consulted; `index.ts` resolves the caller via
 *      `auth.getUser()` (a real round trip to Supabase Auth) and passes that id in. Same rule the
 *      reserve/settle/release RPCs live under.
 */

export type PurchasableTier = 'pro' | 'elite';

/**
 * v1 accepts exactly one source: the dummy purchase. This is the forward-compat seam the issue
 * calls out — when real IAP lands, `source: "apple"` grows a receipt-verification branch and the
 * wire contract does not change. Until then a non-dummy source is REFUSED rather than honored:
 * granting a paid tier on an unverified receipt claim is precisely the bug this seam exists to
 * make impossible to write by accident.
 */
export type PurchaseSource = 'dummy';

/**
 * What `pace_purchase_tier` did. Diagnostic only — deliberately NOT part of the response body
 * (see `responseBodyForPurchase`), since the V2.2 contract has three fields and adding a fourth
 * is how a contract stops being identical. Logged structurally by `index.ts` instead.
 */
export type PurchaseOutcome = 'created' | 'unchanged' | 'tier_changed' | 'reactivated';

export interface PurchaseRequest {
  tier: PurchasableTier;
  source: PurchaseSource;
}

export interface PurchaseResult {
  tier: PurchasableTier;
  /** The period anchor. ISO 8601. Set on first purchase and never moved — see the migration. */
  purchasedAt: string;
  /** ISO 8601. Derived from `purchasedAt` by `pace_current_period`, never stored. */
  periodStart: string;
  /** ISO 8601. Derived from `purchasedAt` by `pace_current_period`, never stored. */
  periodEnd: string;
  outcome: PurchaseOutcome;
}

export type RequestValidation =
  | { ok: true; request: PurchaseRequest }
  | { ok: false; code: 'invalid_body' | 'invalid_tier' | 'invalid_source'; error: string };

/**
 * Minimal shape of a Supabase client's `.rpc()` — matches `@supabase/supabase-js`'s own return
 * shape closely enough that a real client satisfies this with no adapter. Same interface shape as
 * `quota-status.ts`'s / `ai-guard.ts`'s `RpcClient` (kept as a separate declaration rather than a
 * cross-import, same "limit this file's blast radius" reasoning those files state — other agents
 * are editing `_shared/` concurrently).
 */
export interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

const PURCHASABLE_TIERS: readonly string[] = ['pro', 'elite'];

/**
 * Structural validation of the request body. Returns a discriminated result rather than throwing,
 * so `index.ts` can map each refusal to a precise 400 code without a try/catch ladder.
 *
 * Note what is NOT read here: any user id. See this module's header, rule 2.
 */
export function parsePurchaseRequest(raw: unknown): RequestValidation {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      code: 'invalid_body',
      error: 'Request body must be a JSON object of the form { tier, source: "dummy" }.',
    };
  }
  const body = raw as Record<string, unknown>;

  const tier = body.tier;
  if (typeof tier !== 'string' || !PURCHASABLE_TIERS.includes(tier)) {
    // 'free' lands here too, and must: free is the ABSENCE of a subscriptions row, never a row
    // with tier='free' (the `subscription_tier` enum has no such member). "Purchasing free" is
    // not a downgrade path — deleting the row would destroy the period anchor, which is the exact
    // quota reset `pace_purchase_tier` is built to prevent.
    return {
      ok: false,
      code: 'invalid_tier',
      error: 'tier must be one of: pro, elite.',
    };
  }

  const source = body.source;
  if (source !== 'dummy') {
    // Fail closed on anything else, including a missing source. v1 verifies no receipts, so
    // honoring e.g. `source: "apple"` would be granting a paid tier on an unverified claim. When
    // real IAP lands, THIS is the branch that grows receipt verification.
    return {
      ok: false,
      code: 'invalid_source',
      error: 'source must be "dummy" — this build does not process real payments.',
    };
  }

  return { ok: true, request: { tier: tier as PurchasableTier, source } };
}

/**
 * Grants `tier` to `userId` via the `pace_purchase_tier` RPC and returns the resulting tier and
 * derived period. Throws (never returns a fabricated period) on an RPC error or a malformed
 * response — a caller that cannot get a truthful answer must not invent one, same fail-closed
 * idiom `getQuotaStatus` and `lib/consent.ts` already use.
 *
 * IDEMPOTENT BY CONSTRUCTION: `pace_purchase_tier` never moves `purchased_at` after the first
 * insert, so calling this twice with the same tier is a no-op that returns the same period both
 * times. There is no idempotency key and none is needed — the natural key is the user's single
 * `subscriptions` row (PK on `user_id`), and the operation is a state assertion ("this user's
 * tier is now X"), not an accumulating one. A cron retry, a double-tapped button, or a replayed
 * request all converge on the same state. See the migration header for why the alternative —
 * re-anchoring on each call — is an unlimited-free-analysis exploit rather than a mere quirk.
 */
export async function purchaseTier(
  client: RpcClient,
  userId: string,
  tier: PurchasableTier
): Promise<PurchaseResult> {
  const { data, error } = await client.rpc('pace_purchase_tier', {
    p_user_id: userId,
    p_tier: tier,
  });
  if (error) {
    throw new Error(`pace_purchase_tier failed: ${error.message}`);
  }
  return parsePurchaseTierRow(data);
}

/**
 * Structural validation of `pace_purchase_tier`'s JSONB return — shape only, never content
 * judgment (this codebase's "validation is structural, not strict-content" convention applies to
 * a DB response whose shape a schema drift could silently break, not just to model output).
 * Exported so tests can exercise malformed-payload handling without a fake RPC round trip.
 */
export function parsePurchaseTierRow(raw: unknown): PurchaseResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`pace_purchase_tier returned a malformed row: ${JSON.stringify(raw)}`);
  }
  const row = raw as Record<string, unknown>;

  const tier = row.tier;
  if (tier !== 'pro' && tier !== 'elite') {
    throw new Error(`pace_purchase_tier returned an unrecognized tier: ${JSON.stringify(row.tier)}`);
  }

  const purchasedAt = row.purchased_at;
  const periodStart = row.period_start;
  const periodEnd = row.period_end;
  if (typeof purchasedAt !== 'string' || typeof periodStart !== 'string' || typeof periodEnd !== 'string') {
    // A paid tier ALWAYS has a period (only free is lifetime/period-less, and free can never be a
    // row here) — so a null/absent period is a broken response, not a representable state.
    throw new Error(
      `pace_purchase_tier returned a missing/non-string purchased_at or period: ${JSON.stringify(row)}`
    );
  }

  const outcome = row.outcome;
  if (
    outcome !== 'created' &&
    outcome !== 'unchanged' &&
    outcome !== 'tier_changed' &&
    outcome !== 'reactivated'
  ) {
    throw new Error(`pace_purchase_tier returned an unrecognized outcome: ${JSON.stringify(row.outcome)}`);
  }

  return { tier, purchasedAt, periodStart, periodEnd, outcome };
}

/** This endpoint has exactly one success shape — always 200. A repurchase is a successful no-op,
 * not a 409: the caller asked for a state ("my tier is pro") and that state holds. Kept as a named
 * export for symmetry with `quota-status.ts`'s `httpStatusForQuotaStatus`. */
export function httpStatusForPurchase(): number {
  return 200;
}

/**
 * The JSON body for a successful purchase — EXACTLY the three fields V2.2 returns, and no more.
 * `purchasedAt` and `outcome` are deliberately withheld: the contract is meant to stay
 * byte-compatible so v2 can swap `source` to receipt verification without touching any caller.
 */
export function responseBodyForPurchase(result: PurchaseResult): Record<string, unknown> {
  return {
    tier: result.tier,
    periodStart: result.periodStart,
    periodEnd: result.periodEnd,
  };
}
