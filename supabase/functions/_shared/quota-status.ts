/**
 * The read-only orchestration behind `GET /functions/v1/quota-status` (issue #50) — the function
 * that makes Home's quota display (#54) server-authoritative instead of the client's current
 * hand-rolled `subscriptions` + `analyses` count query (`app/(tabs)/index.tsx:82`), which
 * CLAUDE.md's "no business rules in the client" rule forbids and which cannot even be completed
 * for Pro/Elite (`pace_current_period`'s EXECUTE is revoked from `authenticated`).
 *
 * Deliberately free of any `npm:`/Deno-only import — same portability discipline as
 * `ai-guard.ts`/`delete-analysis.ts` — so this orchestration is unit-testable with an injected
 * fake `RpcClient` (see `__tests__/quota-status.deno.test.ts`) rather than a real Postgres
 * connection. The real Deno/`npm:@supabase/supabase-js` client wiring lives in
 * `quota-status-client.ts`, imported only by `supabase/functions/quota-status/index.ts`.
 *
 * AGREEMENT WITH `reserve_analysis`, NOT A SECOND COPY OF IT: this module calls one RPC,
 * `pace_quota_status` (new function, `supabase/migrations/20260712233000_quota_status_function.sql`
 * — WRITTEN, NOT APPLIED to the live project as of issue #50; see that migration's header for
 * why). That function shares `reserve_analysis`'s own `pace_current_period`/
 * `pace_is_farming_signal` calls and mirrors its counting queries field-for-field (verified
 * against the live `reserve_analysis` body via `pg_get_functiondef` before writing either file).
 * This module's job is purely to shape that RPC's JSON into a typed response and map failures to
 * HTTP — it makes no counting decision of its own.
 *
 * REPRESENTING THE ANTI-FARM STATE HONESTLY (issue #6): `blocked` and `remaining` are
 * independent fields. A user can have `remaining > 0` (quota available) AND `blocked: true` (the
 * rolling-window/period anti-farm cap is refusing further reserves right now) at the same time —
 * that combination is a real state `reserve_analysis` can return (`too_many_failed_attempts`)
 * even when quota alone would allow another analysis, and this shape lets a caller (e.g. #54)
 * render both facts rather than collapsing them into a single "can analyze" boolean that would
 * hide the reason.
 */

export type SubscriptionTier = 'free' | 'pro' | 'elite';

export type BlockedReason = 'too_many_failed_attempts';

export interface QuotaStatus {
  tier: SubscriptionTier;
  used: number;
  limit: number;
  remaining: number;
  frameCap: number;
  /** True only for free — the copy deck is emphatic this must never read "this month". */
  isLifetime: boolean;
  /** ISO 8601, null for free (lifetime has no period). */
  periodStart: string | null;
  /** ISO 8601, null for free. */
  periodEnd: string | null;
  /** True when the issue #6 anti-farm cap is currently refusing further reserves for this user,
   * independent of `remaining` — see this file's header comment. */
  blocked: boolean;
  blockedReason: BlockedReason | null;
  /** ISO 8601 — when the block is expected to clear on its own. Null unless `blocked`. */
  blockedUntil: string | null;
}

/**
 * Minimal shape of a Supabase client's `.rpc()` — matches `@supabase/supabase-js`'s own return
 * shape closely enough that a real client satisfies this with no adapter, same interface shape
 * as `ai-guard.ts`'s `RpcClient`.
 */
export interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Calls `pace_quota_status` for `userId` and returns the parsed, typed result. Throws (never
 * returns a fabricated/default quota) on an RPC error or a malformed response — a caller that
 * cannot get a truthful answer must not guess one, same fail-closed idiom `lib/consent.ts`
 * already uses on the client side of this codebase.
 */
export async function getQuotaStatus(client: RpcClient, userId: string): Promise<QuotaStatus> {
  const { data, error } = await client.rpc('pace_quota_status', { p_user_id: userId });
  if (error) {
    throw new Error(`pace_quota_status failed: ${error.message}`);
  }
  return parseQuotaStatusRow(data);
}

/**
 * Structural validation of `pace_quota_status`'s JSONB return — shape only, never content
 * judgment (this codebase's "AI output validation is structural, not strict-content" convention
 * applies just as well to a DB response whose shape a schema drift could silently break).
 * Exported so tests can exercise malformed-payload handling without a fake RPC round trip.
 */
export function parseQuotaStatusRow(raw: unknown): QuotaStatus {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`pace_quota_status returned a malformed row: ${JSON.stringify(raw)}`);
  }
  const row = raw as Record<string, unknown>;

  const tier = row.tier;
  if (tier !== 'free' && tier !== 'pro' && tier !== 'elite') {
    throw new Error(`pace_quota_status returned an unrecognized tier: ${JSON.stringify(row.tier)}`);
  }

  const used = row.used;
  const limit = row.limit;
  const frameCap = row.frame_cap;
  if (typeof used !== 'number' || typeof limit !== 'number' || typeof frameCap !== 'number') {
    throw new Error(`pace_quota_status returned non-numeric used/limit/frame_cap: ${JSON.stringify(row)}`);
  }

  const blocked = Boolean(row.blocked);
  const blockedReason: BlockedReason | null =
    blocked && row.blocked_reason === 'too_many_failed_attempts' ? 'too_many_failed_attempts' : null;

  return {
    tier,
    used,
    limit,
    // Never negative — a defensive floor, not a claim this can happen under correct counting.
    remaining: Math.max(limit - used, 0),
    frameCap,
    isLifetime: Boolean(row.is_lifetime),
    periodStart: nullableString(row.period_start),
    periodEnd: nullableString(row.period_end),
    blocked,
    blockedReason,
    blockedUntil: blocked ? nullableString(row.blocked_until) : null,
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** This endpoint has exactly one success shape — always 200 on a resolved `QuotaStatus`. Kept as
 * a named export (rather than inlined in index.ts) for symmetry with `delete-analysis.ts`'s
 * `httpStatusForOutcome` / `ai-guard.ts`'s `httpStatusForGateDeny`. */
export function httpStatusForQuotaStatus(): number {
  return 200;
}

/** The JSON body for a successful quota-status response. */
export function responseBodyForQuotaStatus(status: QuotaStatus): Record<string, unknown> {
  return { ...status };
}
