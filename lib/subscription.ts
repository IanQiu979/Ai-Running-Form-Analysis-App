/**
 * The dummy-subscription client (issue #52) — a read of the caller's tier/quota, and a dummy
 * purchase, for `app/paywall.tsx`.
 *
 * ⚠️ THE NON-NEGOTIABLE RULE THIS FILE EXISTS UNDER (CLAUDE.md; issue #52 names this by name as
 * the trap to avoid): tier and quota are NEVER authoritative on the client. `reserve_analysis` (a
 * Postgres RPC invoked only from inside `analyze-form`) is the SOLE enforcement point for the
 * per-tier limits (free 1 / pro 10 / elite 30) and frame caps (1 / 5 / 8), and this file does not
 * — and must never — hardcode any of those numbers. Every count/limit this file or its caller
 * ever shows the user is read fresh off the `quota-status` response below, never invented here.
 * Echo V1's own docs once claimed enforcement lived in a file exactly like this one; it did not —
 * it lived in the edge function. Repeating that confusion is the one thing issue #52 calls out by
 * name as forbidden. If you are tempted to add a `FREE_LIMIT = 1` (or similar) constant here:
 * don't — read it from `QuotaStatus.limit` instead.
 *
 * Two responsibilities, each a thin call through issue #46's shared `invokeFunction` wrapper
 * (`lib/functions-client.ts`) — never `supabase.functions.invoke` directly, per that file's own
 * "every edge-function caller should go through this" rule:
 *   - `getQuotaStatus()` — `GET /functions/v1/quota-status` (issue #50). Read-only, display data.
 *   - `purchaseTier(tier)` — `POST /functions/v1/purchase-tier` (issue #51). The dummy purchase —
 *     no real money moves; `source: "dummy"` is the only value the server accepts today, and
 *     `tier` is restricted to `'pro' | 'elite'` at the type level (matching the server: "free" is
 *     the absence of a `subscriptions` row, never a purchasable tier — see
 *     `_shared/purchase-tier.ts`'s `parsePurchaseRequest` for why).
 *
 * WHY THE TYPES BELOW ARE A HAND-MAINTAINED MIRROR OF THE WIRE CONTRACT, NOT AN IMPORT FROM
 * `@shared/*`: both server modules already exist
 * (`supabase/functions/_shared/quota-status.ts`, `.../purchase-tier.ts`) and already export types
 * with these exact shapes, and `@shared/*` is a real, working tsconfig alias (`@shared/pace` is
 * used elsewhere in this codebase, e.g. `lib/analyze-form.ts`). This file deliberately does NOT
 * import them anyway, for the same reason `lib/delete-account.ts` hand-mirrors
 * `DeleteAccountErrorCode` instead of importing from a not-yet-landed `@shared/delete-account`:
 * this worktree's file lane forbids editing anything under `supabase/functions/**`, and other
 * agents are concurrently working there right now — importing from it would silently couple this
 * file's typecheck to a directory this change cannot see change in real time. What's mirrored
 * below is each endpoint's *documented, versioned wire contract* (the HTTP JSON shape each
 * `index.ts`/`_shared/*.ts` pair actually sends), which is the stable thing to depend on anyway —
 * not their internals.
 */
import { invokeFunction } from './functions-client';

// -------------------------------------------------------------------------------------------
// GET /functions/v1/quota-status (issue #50) — read-only, display data.
// -------------------------------------------------------------------------------------------

export type SubscriptionTier = 'free' | 'pro' | 'elite';

/** The one anti-farm block reason `pace_quota_status` currently reports. */
export type QuotaBlockedReason = 'too_many_failed_attempts';

/**
 * Mirrors `_shared/quota-status.ts`'s `QuotaStatus` — and, field-for-field, the JSON
 * `responseBodyForQuotaStatus` actually serializes (it spreads that same object verbatim, so the
 * wire shape is already camelCase — no snake_case translation happens here).
 */
export interface QuotaStatus {
  tier: SubscriptionTier;
  used: number;
  limit: number;
  remaining: number;
  frameCap: number;
  /** True only for free — never render "this month"/"this period" copy when this is true. */
  isLifetime: boolean;
  /** ISO 8601, null for free. */
  periodStart: string | null;
  /** ISO 8601, null for free. */
  periodEnd: string | null;
  /** True when the issue #6 anti-farm cap is currently refusing further reserves for this user,
   * independent of `remaining` — a user can have `remaining > 0` and `blocked: true` at once. */
  blocked: boolean;
  blockedReason: QuotaBlockedReason | null;
  /** ISO 8601 — null unless `blocked`. */
  blockedUntil: string | null;
}

/**
 * Every documented non-2xx `quota-status` code (`supabase/functions/quota-status/index.ts`):
 * `unauthorized` (401, missing/expired session) or `quota_status_unavailable` (500, a DB-side
 * failure — never the caller's fault). `method_not_allowed` is omitted: this client always sends
 * GET, so that branch is unreachable from here. `'unknown'` is this client's own bucket for
 * everything the server doesn't name — a network/relay failure, a malformed body, or a code this
 * client doesn't recognize — see `lib/delete-account.ts`'s identical `'unknown'` convention.
 */
export type QuotaStatusErrorCode = 'unauthorized' | 'quota_status_unavailable' | 'unknown';

export interface QuotaStatusError {
  code: QuotaStatusErrorCode;
  /** Carried for logging only — never render a raw server string; map `code` through vetted,
   * static in-app copy instead (same convention `lib/delete-account.ts` documents). */
  message: string;
}

export type QuotaStatusResult = { ok: true; data: QuotaStatus } | { ok: false; error: QuotaStatusError };

const QUOTA_STATUS_FN = 'quota-status';

const UNKNOWN_QUOTA_STATUS_ERROR: QuotaStatusError = {
  code: 'unknown',
  message: 'Could not load quota status.',
};

function isServerQuotaStatusErrorCode(value: unknown): value is Exclude<QuotaStatusErrorCode, 'unknown'> {
  return value === 'unauthorized' || value === 'quota_status_unavailable';
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Structural validation only (this codebase's "AI output validation is structural, not
 * strict-content" convention applies just as well to a cross-service HTTP response whose shape a
 * server-side drift could silently break — same reasoning `_shared/quota-status.ts`'s own
 * `parseQuotaStatusRow` and `lib/delete-account.ts`'s `parseSuccessBody` give). Exported so tests
 * can exercise malformed-payload handling without a fake network round trip.
 */
export function parseQuotaStatus(raw: unknown): QuotaStatus | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;

  const tier = row.tier;
  if (tier !== 'free' && tier !== 'pro' && tier !== 'elite') return null;

  const { used, limit, remaining, frameCap } = row;
  if (
    typeof used !== 'number' ||
    typeof limit !== 'number' ||
    typeof remaining !== 'number' ||
    typeof frameCap !== 'number'
  ) {
    return null;
  }

  if (typeof row.blocked !== 'boolean') return null;
  const blocked = row.blocked;

  const blockedReason = row.blockedReason;
  if (blockedReason !== null && blockedReason !== undefined && blockedReason !== 'too_many_failed_attempts') {
    return null;
  }

  return {
    tier,
    used,
    limit,
    remaining,
    frameCap,
    isLifetime: Boolean(row.isLifetime),
    periodStart: nullableString(row.periodStart),
    periodEnd: nullableString(row.periodEnd),
    blocked,
    blockedReason: blocked && blockedReason === 'too_many_failed_attempts' ? 'too_many_failed_attempts' : null,
    blockedUntil: blocked ? nullableString(row.blockedUntil) : null,
  };
}

/**
 * Reads the caller's current tier/quota for display. COSMETIC ONLY — see this file's header.
 * Never throws; every failure resolves `{ ok: false, error }` so a caller never has to wrap this
 * in a try/catch, same convention `invokeFunction` itself guarantees.
 */
export async function getQuotaStatus(): Promise<QuotaStatusResult> {
  const result = await invokeFunction(QUOTA_STATUS_FN, { method: 'GET' });

  if (result.ok) {
    const status = parseQuotaStatus(result.data);
    if (status) return { ok: true, data: status };
    // A 200 whose body we don't recognize is not a status we can act on or display.
    return { ok: false, error: UNKNOWN_QUOTA_STATUS_ERROR };
  }

  if (result.error.kind === 'http' && isServerQuotaStatusErrorCode(result.error.code)) {
    return { ok: false, error: { code: result.error.code, message: result.error.error } };
  }

  return { ok: false, error: UNKNOWN_QUOTA_STATUS_ERROR };
}

// -------------------------------------------------------------------------------------------
// POST /functions/v1/purchase-tier (issue #51) — the dummy purchase.
// -------------------------------------------------------------------------------------------

/** `'free'` is deliberately excluded — see this file's header and `_shared/purchase-tier.ts`'s
 *  `parsePurchaseRequest`: free is the absence of a `subscriptions` row, never a purchasable
 *  tier. */
export type PurchasableTier = 'pro' | 'elite';

export interface PurchaseSuccess {
  tier: PurchasableTier;
  /** ISO 8601. */
  periodStart: string;
  /** ISO 8601. */
  periodEnd: string;
}

/**
 * Every documented non-2xx `purchase-tier` code
 * (`supabase/functions/purchase-tier/index.ts` + `_shared/purchase-tier.ts`):
 *   - `not_found` (404) — the deployment gate refused the request. This is the SAME response
 *     whether `PURCHASE_TIER_DUMMY_ENABLED` is off, the caller isn't on the optional allowlist,
 *     or the function isn't deployed to a given project at all — which of these is live for a
 *     given project can change with the flag/allowlist config, so this client never assumes one
 *     over another (`docs/status.md`'s M5 row has the current flag state for this project). All
 *     three read identically to a caller by design (the deployment gate's own point — see that
 *     file's header) and must read identically to a USER too: "not available right now", never
 *     "something broke."
 *   - `invalid_body` / `invalid_tier` / `invalid_source` (400) — this client always sends a
 *     well-formed `{ tier, source: 'dummy' }`, so these indicate a client bug, not a user-facing
 *     state; folded into `'unknown'` below rather than given their own copy (nothing in
 *     `app/paywall.tsx` has anything more specific to say about them).
 *   - `unauthorized` (401) — missing/expired session.
 *   - `rate_limited` (429) — the same account called this endpoint again within 3s of its own
 *     last write. Not a failure the user caused maliciously; just needs a beat.
 *   - `purchase_unavailable` (500) — a DB-side failure, never the caller's fault.
 * `'unknown'` is this client's own bucket, same convention as `QuotaStatusErrorCode` above.
 */
export type PurchaseErrorCode = 'not_found' | 'unauthorized' | 'rate_limited' | 'purchase_unavailable' | 'unknown';

export interface PurchaseError {
  code: PurchaseErrorCode;
  /** Carried for logging only — see `QuotaStatusError.message`'s identical note. */
  message: string;
}

export type PurchaseResult = { ok: true; data: PurchaseSuccess } | { ok: false; error: PurchaseError };

const PURCHASE_TIER_FN = 'purchase-tier';

const UNKNOWN_PURCHASE_ERROR: PurchaseError = {
  code: 'unknown',
  message: 'Could not complete the purchase.',
};

const NOT_FOUND_PURCHASE_ERROR: PurchaseError = {
  code: 'not_found',
  message: 'purchase-tier is not available (deployment gate off, caller not allowlisted, or not deployed).',
};

function parsePurchaseSuccess(raw: unknown): PurchaseSuccess | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;

  const tier = row.tier;
  if (tier !== 'pro' && tier !== 'elite') return null;

  const { periodStart, periodEnd } = row;
  if (typeof periodStart !== 'string' || typeof periodEnd !== 'string') return null;

  return { tier, periodStart, periodEnd };
}

/**
 * Requests the dummy purchase of `tier`. COSMETIC ONLY — this grants nothing by itself; it asks
 * the server's `pace_purchase_tier` RPC (the only legitimate writer to `subscriptions`) to grant
 * it, and reports back exactly what the server confirmed. Never throws — see `getQuotaStatus`'s
 * identical note.
 */
export async function purchaseTier(tier: PurchasableTier): Promise<PurchaseResult> {
  const result = await invokeFunction(PURCHASE_TIER_FN, {
    method: 'POST',
    body: { tier, source: 'dummy' },
  });

  if (result.ok) {
    const success = parsePurchaseSuccess(result.data);
    if (success) return { ok: true, data: success };
    return { ok: false, error: UNKNOWN_PURCHASE_ERROR };
  }

  // A non-JSON / unrecognized-shape 404 (kind: 'malformed') is this endpoint's OTHER "not
  // available" shape, not a distinct failure — see `PurchaseErrorCode`'s `not_found` doc above.
  // `purchase-tier` is either deployed-but-gated (a real `{ error, code: 'not_found' }` JSON
  // body, kind: 'http' — this project's actual state since `purchase-tier` deployed 2026-07-26,
  // see `docs/architecture.md`'s "Current — `POST /functions/v1/purchase-tier`" section) or not
  // deployed to a given project at all (a bare/HTML 404, kind: 'malformed'). Both must read
  // identically to the user, which is exactly what collapsing them here buys `app/paywall.tsx`:
  // it never has to know the difference.
  if (result.error.kind === 'malformed') {
    return { ok: false, error: NOT_FOUND_PURCHASE_ERROR };
  }

  if (result.error.kind === 'http') {
    if (result.error.code === 'not_found') {
      return { ok: false, error: NOT_FOUND_PURCHASE_ERROR };
    }
    if (
      result.error.code === 'unauthorized' ||
      result.error.code === 'rate_limited' ||
      result.error.code === 'purchase_unavailable'
    ) {
      return { ok: false, error: { code: result.error.code, message: result.error.error } };
    }
  }

  return { ok: false, error: UNKNOWN_PURCHASE_ERROR };
}

// -------------------------------------------------------------------------------------------
// Display helper — pure formatting, not a business rule (the number/date it formats always comes
// from a live `QuotaStatus.periodEnd`, never invented here).
// -------------------------------------------------------------------------------------------

/**
 * Formats an ISO 8601 date (e.g. `QuotaStatus.periodEnd`) for the copy deck's "renews {date}" /
 * "It renews {date}" placeholders. Uses `Intl.DateTimeFormat` — a platform primitive already
 * available in Hermes, not a new dependency. Returns the raw ISO string unchanged if it fails to
 * parse, so a malformed value degrades to "renews 2026-08-01T00:00:00Z" rather than throwing or
 * silently vanishing.
 */
export function formatRenewalDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
