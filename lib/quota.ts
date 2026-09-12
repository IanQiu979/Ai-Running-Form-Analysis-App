/**
 * The `quota-status` client (issues #54/#15) — replaces `app/(tabs)/index.tsx`'s former
 * hand-rolled `subscriptions` + `analyses` count query with a single call through
 * `GET /functions/v1/quota-status` (issue #50). CLAUDE.md: "Tier, quota, frame cap, and
 * analysis are server-only (edge functions); the client may display tier/quota state but is
 * never the authority for it." This file holds no counting logic of its own — it only calls the
 * endpoint (via `lib/functions-client.ts`'s shared `invokeFunction` wrapper, same pattern as
 * `lib/delete-account.ts`) and structurally validates the response shape.
 *
 * `quota-status` and its `pace_quota_status` migration
 * (`supabase/migrations/20260712233000_quota_status_function.sql`) have both been deployed/applied
 * to the live project since 2026-07-26 (`docs/architecture.md`'s "Current —
 * `GET /functions/v1/quota-status`" section; `docs/status.md` Known Issue #33). Any non-2xx/relay
 * failure still folds into the same honest, retryable `{ ok: false, error: { code: 'unknown' } }`
 * result every other unrecognized failure gets — `app/(tabs)/index.tsx` shows this as its existing
 * error state (last-known value + Retry) — it never fabricates a quota reading to paper over a
 * failure, whatever the cause.
 *
 * THE WIRE SHAPE READ HERE is `responseBodyForQuotaStatus`'s output
 * (`supabase/functions/_shared/quota-status.ts`) — the flattened, camelCase `QuotaStatus` object
 * a 200 response body actually is. That is a DIFFERENT shape from `parseQuotaStatusRow` in that
 * same file, which parses the raw, snake_case `pace_quota_status` DB row — this client only ever
 * sees the former, and parses it independently below rather than importing that function, so
 * this file never accidentally depends on the DB-row shape. The `QuotaStatus`/`BlockedReason`
 * TYPES themselves are imported from `@shared/quota-status` (the same `@shared/*` tsconfig alias
 * `@shared/pace` already uses) so the two sides of the contract can't silently drift on field
 * names — `quota-status.ts` is deliberately free of any Deno-only import (see its own header),
 * so this type-only import is exactly as portable as `@shared/pace`'s.
 *
 * ALSO HOLDS Home's pure quota -> copy/CTA mapping (the bottom section, "Display logic"), kept
 * here rather than inlined in `app/(tabs)/index.tsx` for the same reason `lib/pace-readout.ts`
 * gives for its own split from `components/pace-readout.tsx`: this is exactly the kind of logic
 * CLAUDE.md wants proven with a real test ("New logic added to `lib/` ... should get a test
 * alongside it. Screens are not unit-tested for now."), and every branch is a pure mapping from
 * a `QuotaStatus` reading to a copy-deck string — nothing here counts, decides tier, or computes
 * a period; that's still entirely `pace_quota_status`'s job (CLAUDE.md: "the client ... is never
 * the authority").
 */
import { Copy } from '@/constants/copy';

import { cooldownEndsAt } from './cooldown';
import { describeCooldownRemaining } from './cooldown-remaining';
import { invokeFunction } from './functions-client';
import { isBlockedReason } from '@shared/quota-status';
import type { BlockedReason, QuotaStatus, SubscriptionTier } from '@shared/quota-status';

export type { BlockedReason, QuotaStatus, SubscriptionTier };

const EDGE_FUNCTION_NAME = 'quota-status';

/**
 * Every documented `quota-status` non-2xx code (`supabase/functions/quota-status/index.ts`):
 * `'unauthorized'` (missing/expired session) and `'quota_status_unavailable'` (a DB-side
 * failure — including "the migration isn't applied yet," see this file's header). `'unknown'`
 * is this client's own bucket for everything the server didn't name: a relay/network error, a
 * malformed body, or a 404 because the function isn't deployed/routed at all — same convention
 * `lib/delete-account.ts`'s `DeleteAccountErrorCode` established for its own endpoint.
 */
export type QuotaStatusErrorCode = 'unauthorized' | 'quota_status_unavailable' | 'unknown';

function isServerQuotaStatusErrorCode(
  value: unknown
): value is Exclude<QuotaStatusErrorCode, 'unknown'> {
  return value === 'unauthorized' || value === 'quota_status_unavailable';
}

export interface QuotaStatusError {
  error: string;
  code: QuotaStatusErrorCode;
}

export type QuotaStatusResult =
  | { ok: true; data: QuotaStatus }
  | { ok: false; error: QuotaStatusError };

/**
 * A conforming implementation resolves — NEVER REJECTS — one of the two shapes above for every
 * call. Takes no arguments: the caller is identified from their session's JWT alone, same
 * reasoning `lib/delete-account.ts`'s `DeleteAccountClient.submit()` documents for its own
 * no-argument shape — naming a user id from the client would be a vulnerability, not a
 * convenience, and this endpoint's contract (`quota-status/index.ts`) never accepts one.
 */
export interface QuotaStatusClient {
  fetch(): Promise<QuotaStatusResult>;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Defensive, narrow parse of a 200 body — never trusts the shape blindly, the same structural
 * discipline `lib/delete-account.ts`'s `parseSuccessBody` and `_shared/quota-status.ts`'s own
 * `parseQuotaStatusRow` both apply to their respective wire shapes (CLAUDE.md: "AI output
 * validation is structural, not strict-content" — the same idiom applies just as well to a
 * server response whose shape a contract drift could silently break). A 200 that doesn't parse
 * as documented is NOT treated as a usable quota reading; the caller folds it into the same
 * error path as an HTTP failure rather than guessing at partial data — reporting a fabricated or
 * partially-guessed quota would be exactly what CLAUDE.md's "the client is never the authority"
 * rule forbids. Exported so a test can exercise malformed-payload handling directly.
 */
export function parseQuotaStatusResponse(body: unknown): QuotaStatus | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;

  const tier = record.tier;
  if (tier !== 'free' && tier !== 'pro' && tier !== 'elite') return null;

  const { used, limit, remaining, frameCap } = record;
  const unlimited = record.unlimited === true;
  if (
    typeof used !== 'number' ||
    typeof frameCap !== 'number' ||
    (unlimited
      ? limit !== null || remaining !== null
      : typeof limit !== 'number' || typeof remaining !== 'number')
  ) {
    return null;
  }

  const blocked = unlimited ? false : Boolean(record.blocked);
  const blockedReason: BlockedReason | null =
    blocked && isBlockedReason(record.blockedReason) ? record.blockedReason : null;

  return {
    tier,
    used,
    limit: unlimited ? null : (limit as number),
    remaining: unlimited ? null : (remaining as number),
    frameCap,
    unlimited,
    isLifetime: unlimited ? false : Boolean(record.isLifetime),
    periodStart: nullableString(record.periodStart),
    periodEnd: nullableString(record.periodEnd),
    blocked,
    blockedReason,
    blockedUntil: blocked ? nullableString(record.blockedUntil) : null,
  };
}

const GENERIC_UNKNOWN_ERROR: QuotaStatusError = {
  error: 'Could not determine your current quota.',
  code: 'unknown',
};

/**
 * Calls the real `quota-status` edge function through issue #46's shared `invokeFunction`
 * wrapper (`lib/functions-client.ts`) — see that file's header for the
 * `FunctionsHttpError`/`FunctionsRelayError`/`FunctionsFetchError` unwrap it already does. This
 * function only adds what's specific to THIS endpoint: a GET method (the function refuses any
 * other verb — see `quota-status/index.ts`), parsing the 200 body, and narrowing the wrapper's
 * generic `code: string` down to the two codes `quota-status` actually emits.
 */
async function fetchFromEdgeFunction(): Promise<QuotaStatusResult> {
  const result = await invokeFunction(EDGE_FUNCTION_NAME, { method: 'GET' });

  if (result.ok) {
    const parsed = parseQuotaStatusResponse(result.data);
    if (parsed) return { ok: true, data: parsed };
    // A 200 whose body we don't recognize is not a reading we can act on.
    return { ok: false, error: GENERIC_UNKNOWN_ERROR };
  }

  // `kind: 'http'` is the only branch with a real, server-authored `code` to read — `'network'`
  // (a relay/fetch failure) and `'malformed'` (a non-2xx response whose body wasn't the
  // documented shape, e.g. a gateway error page rather than this endpoint's JSON) both carry
  // no such code, and collapse into the same generic, honestly-unknown failure below, as does an
  // HTTP code this endpoint doesn't recognize as one of its own.
  if (result.error.kind === 'http' && isServerQuotaStatusErrorCode(result.error.code)) {
    return { ok: false, error: { error: result.error.error, code: result.error.code } };
  }

  return { ok: false, error: GENERIC_UNKNOWN_ERROR };
}

/** The real client. Bound below as `quotaStatusClient` — the binding Home actually calls. */
export function createQuotaStatusClient(): QuotaStatusClient {
  return { fetch: fetchFromEdgeFunction };
}

/** The seam's binding. `app/(tabs)/index.tsx` calls through this, never `supabase.functions.invoke`
 *  directly, so its own tests (and any future ones) can swap in a fake `QuotaStatusClient`
 *  without a live function to call. */
export const quotaStatusClient: QuotaStatusClient = createQuotaStatusClient();

// -------------------------------------------------------------------------------------------
// Display logic — pure `QuotaStatus` -> copy-deck-string mapping. See this file's header for
// why it lives here rather than inlined in the screen.
// -------------------------------------------------------------------------------------------

export interface QuotaCaption {
  primary: string;
  /** A quieter secondary line under `primary` — Pro/Elite's "Renews {date}" when quota remains,
   * or issue #6's anti-farm `blocked` notice (which takes priority: it explains why the CTA is
   * disabled even on a reading that otherwise looks like quota is available). `null` when
   * neither applies (Free, or Pro/Elite exhausted — that branch's `primary` already states its
   * own renewal date inline). */
  secondary: string | null;
}

/** `home.quota.pro.remaining` / `home.quota.elite.remaining` are identical strings by design
 *  (see `constants/copy.ts`) — this only exists so each tier still reads its own deck key rather
 *  than one tier silently borrowing the other's. */
function remainingTemplateFor(tier: 'pro' | 'elite'): string {
  return tier === 'pro' ? Copy.home.quota.pro.remaining : Copy.home.quota.elite.remaining;
}

function exhaustedTemplateFor(tier: 'pro' | 'elite'): string {
  return tier === 'pro' ? Copy.home.quota.exhausted.pro : Copy.home.quota.exhausted.elite;
}

/** `null` for an unparsable/missing date rather than throwing — a malformed `periodEnd` should
 *  degrade the caption (drop the date clause), never crash the screen. */
function formatPeriodEndDate(periodEnd: string | null): string | null {
  if (!periodEnd) return null;
  const date = new Date(periodEnd);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(
    date
  );
}

function describePrimaryCaption(quota: QuotaStatus): string {
  if (quota.unlimited) return Copy.home.quota.unlimited;

  if (quota.tier === 'free') {
    return (quota.remaining ?? 0) > 0
      ? Copy.home.quota.free.available
      : Copy.home.quota.exhausted.free;
  }

  if ((quota.remaining ?? 0) > 0) {
    return remainingTemplateFor(quota.tier)
      .replace('{remaining}', String(quota.remaining ?? 0))
      .replace('{limit}', String(quota.limit ?? 0));
  }

  // Defensive fallback only — `periodEnd` is documented non-null for Pro/Elite
  // (`supabase/functions/_shared/quota-status.ts`), so this should never actually render blank.
  const renewsOn = formatPeriodEndDate(quota.periodEnd) ?? '';
  return exhaustedTemplateFor(quota.tier)
    .replace('{limit}', String(quota.limit ?? 0))
    .replace('{date}', renewsOn);
}

/**
 * Maps a `QuotaStatus` reading to Home's caption copy — every branch lifted verbatim, by key,
 * from `docs/design/copy-deck.md` §Screen 2 (see `constants/copy.ts`'s `home.quota.*`). Pure
 * mapping only: `remaining`/`limit`/`periodEnd`/`blocked` all come straight from the server.
 */
export function describeQuota(quota: QuotaStatus, now: number = Date.now()): QuotaCaption {
  const primary = describePrimaryCaption(quota);

  if (quota.blocked) {
    if (quota.blockedReason === 'zero_pillar_cooldown') {
      const time = cooldownEndsAt(quota.blockedUntil, new Date(now));
      return {
        primary,
        secondary: time
          ? Copy.home.quota.zeroPillarCooldown.replace('{time}', time)
          : Copy.home.quota.blocked,
      };
    }
    // The same `blocked_until` the analysis pre-flight reads (`lib/analysis-preflight.ts`), used
    // here so Home is the EARLIEST surface that says how long is left rather than an open-ended
    // "later". `describeCooldownRemaining` returns null for a missing, unparsable, or already-past
    // expiry, and that null is what selects the honest no-time-known wording — this never prints a
    // guessed or zeroed countdown.
    const remaining = describeCooldownRemaining(quota.blockedUntil, now);
    return {
      primary,
      secondary: remaining
        ? Copy.home.quota.blockedFor.replace('{remaining}', remaining)
        : Copy.home.quota.blocked,
    };
  }

  if (!quota.unlimited && quota.tier !== 'free' && (quota.remaining ?? 0) > 0) {
    const renewsOn = formatPeriodEndDate(quota.periodEnd);
    return { primary, secondary: renewsOn ? Copy.home.quota.renewsOn.replace('{date}', renewsOn) : null };
  }

  return { primary, secondary: null };
}

export type PrimaryCtaKind = 'analyze' | 'upgradeToAnalyze' | 'upgradeForMore' | 'analyzeDisabled';

/**
 * Which of Home's four CTA branches a given quota reading maps to — the deck's own
 * "Ambiguities and calls made" #1 (`docs/design/copy-deck.md` §Screen 2): Free-exhausted and
 * Pro-exhausted (an Elite ceiling still exists above it) get a relabeled, actionable CTA;
 * Elite-exhausted (nothing above it) keeps the plain "Start analysis" label and renders
 * disabled instead of relabeled.
 */
export function primaryCtaKind(quota: QuotaStatus): PrimaryCtaKind {
  if (quota.unlimited || (quota.remaining ?? 0) > 0) return 'analyze';
  if (quota.tier === 'free') return 'upgradeToAnalyze';
  if (quota.tier === 'pro') return 'upgradeForMore';
  return 'analyzeDisabled';
}

/**
 * Whether tapping the primary CTA should be able to start something right now. `remaining > 0`
 * alone isn't sufficient: issue #6's anti-farm cap (`blocked`) can refuse a reserve even when
 * quota is available, independent of `remaining` (`_shared/quota-status.ts`'s header names this
 * exact combination), so an available-but-blocked user gets an inert CTA and an honest hint
 * rather than a tap the server would refuse.
 *
 * The two upgrade kinds ARE enabled: `app/paywall.tsx` (issue #52) is a real route now, so they
 * navigate there. This is the whole point of issue #15 — the exhausted user must be offered a way
 * forward instead of an offer the screen cannot honour.
 */
export function isPrimaryCtaEnabled(quota: QuotaStatus): boolean {
  const kind = primaryCtaKind(quota);
  // Elite-exhausted: nothing exists above this tier, so there is genuinely nowhere to send them.
  if (kind === 'analyzeDisabled') return false;
  if (kind === 'analyze') return !quota.blocked;
  return true;
}

export function primaryCtaLabel(kind: PrimaryCtaKind): string {
  switch (kind) {
    case 'analyze':
      return Copy.home.cta.analyze;
    case 'upgradeToAnalyze':
      return Copy.home.cta.upgradeToAnalyze;
    case 'upgradeForMore':
      return Copy.home.cta.upgradeForMore;
    case 'analyzeDisabled':
      return Copy.home.cta.analyzeDisabled;
  }
}

/**
 * The reason a disabled CTA is disabled, meant for `accessibilityHint` — issue #15's fix calls
 * for exactly this ("put the reason in accessibilityHint so VoiceOver conveys more than
 * 'dimmed'"; `accessibilityState={{ disabled: true }}` alone only conveys *that* it's off, never
 * *why*). `null` when the CTA is enabled; every disabled branch gets its own honest, specific
 * reason rather than a generic "unavailable".
 */
export function primaryCtaAccessibilityHint(
  quota: QuotaStatus,
  now: number = Date.now()
): string | null {
  if (isPrimaryCtaEnabled(quota)) return null;

  const kind = primaryCtaKind(quota);
  if (kind === 'analyze') {
    // remaining > 0 but blocked — the anti-farm cap is the reason, not quota or tier. Reuses the
    // caption above verbatim so VoiceOver hears exactly what is on screen, countdown included.
    return describeQuota(quota, now).secondary;
  }
  if (kind === 'analyzeDisabled') {
    // The exhausted-Elite caption already states the reason in full ("...renews {date}").
    return describeQuota(quota, now).primary;
  }
  // upgradeToAnalyze / upgradeForMore are enabled (they open the Paywall), so isPrimaryCtaEnabled
  // returned true above and this line is unreachable for them. Kept exhaustive rather than
  // throwing: a future CTA kind should degrade to no hint, never crash Home.
  return null;
}
