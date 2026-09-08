/**
 * THE ONE `quota-status` READ TAKEN BEFORE ANY ANALYSIS WORK STARTS, and the two answers it
 * yields: whether this caller may start an analysis at all, and how many frames their video gets.
 *
 * WHY THIS MODULE EXISTS. The entitlement checks that can refuse an analysis — the lifetime/period
 * cap (`quota_exceeded`) and the anti-farm cooldown (`too_many_failed_attempts`, issue #6) — both
 * live in `reserve_analysis`, which the server does not reach until the client has already
 * extracted frames and submitted them. So a capped or cooling-down runner used to film, wait
 * through extraction, wait again on the Analyzing screen, and only THEN be told no — and, for the
 * cooldown, be told it under copy that said their analysis had FAILED, with a Retry button that
 * resubmitted straight into the same refusal. Nobody should burn a wait to be told they were never
 * eligible, and nothing failed when a limit was correctly enforced.
 *
 * `pace_quota_status` already computes exactly these two facts (`blocked`/`blocked_reason`/
 * `blocked_until` and `remaining`), and `app/capture/extracting.tsx` already made one bounded
 * round trip to it for the frame cap. This module widens that SAME round trip to carry the gate
 * as well, so the pre-flight costs nothing extra on the video path and one bounded call on the
 * photo path.
 *
 * FAIL OPEN, ALWAYS. Only a structurally-valid `{ ok: true }` reading can produce a refusal here.
 * Every failure — unauthorized, unavailable, unknown, timed out, or a client that broke its
 * contract and rejected — resolves to `{ kind: 'allowed' }`. Two reasons, and both matter:
 *   1. HONESTY. Telling someone "you are in a cooldown" is a claim about their account. We may
 *      only make it when the server actually said so; inferring it from a network blip would be
 *      exactly the kind of fabricated state this project exists to avoid.
 *   2. THE CLIENT IS NEVER THE AUTHORITY (CLAUDE.md). `reserve_analysis` remains the only thing
 *      that decides. This gate can only ever surface a refusal EARLIER and more honestly than the
 *      server would; it can never invent one, and it can never grant an analysis the server would
 *      refuse — a failed pre-flight simply lets the request through to the real check.
 *
 * ORDER MATCHES THE SERVER. `reserve_analysis` tests the anti-farm counter BEFORE the quota cap
 * (`20260712220000_anti_farm_release_reason_fix.sql`), so `resolveAnalysisGate` reports `cooldown`
 * ahead of `exhausted` for a caller who is both. Any other order would have the pre-flight name a
 * different reason than the one the server would actually give.
 */
import {
  FALLBACK_VIDEO_FRAME_CAP,
  resolveVideoFrameCap,
} from './extraction-frame-cap';
import { quotaStatusClient, type QuotaStatusClient, type QuotaStatusResult } from './quota';
import type { SubscriptionTier } from '@shared/quota-status';

/**
 * One quota round-trip's worth of patience before the pre-flight stops waiting and proceeds as
 * `allowed` at `FALLBACK_VIDEO_FRAME_CAP`. Same order of magnitude, and the same reasoning, as
 * `app/(auth)/update-password.tsx`'s `RECOVERY_WAIT_TIMEOUT_MS` and `lib/hibp.ts`'s
 * `TOTAL_TIMEOUT_MS` — this project's established bound for a single network call, not an
 * arbitrary guess. It exists so a hung or very slow `quota-status` degrades the frame count and
 * skips the gate, instead of leaving the user staring at a spinner that never advances.
 */
export const QUOTA_WAIT_TIMEOUT_MS = 4000;

/** Unique sentinel for the timeout leg of the race below — a symbol so it can never be confused
 *  with a real `QuotaStatusResult` the way a string or `null` could be. */
const TIMED_OUT: unique symbol = Symbol('quotaWaitTimedOut');

/**
 * What the server's own reading says about starting an analysis right now.
 *
 * `cooldown` is issue #6's anti-farm throttle: it clears on its own (a rolling 24h window for
 * Free, the current purchase-anchored period for Pro/Elite), which is why it carries
 * `blockedUntil` and why it must NEVER be presented as a failure or as something an upgrade
 * fixes — `analyze-form`'s own 429-not-402 mapping makes the same call for the same reason.
 *
 * `exhausted` is the ordinary allowance cap: the runner has used what their plan gives them, and
 * the honest next step is the paywall, which states the real allowance and renewal.
 */
export type AnalysisGate =
  | { kind: 'allowed' }
  | { kind: 'cooldown'; blockedUntil: string | null }
  | { kind: 'exhausted'; tier: SubscriptionTier };

export interface AnalysisPreflight {
  gate: AnalysisGate;
  /** Always a usable count, whatever the gate says — see `resolveVideoFrameCap`. */
  frameCap: number;
}

/**
 * The pure decision. See this module's header for the fail-open rule and the cooldown-before-cap
 * ordering; both are asserted directly in `lib/__tests__/analysis-preflight.test.ts`.
 *
 * `blocked` is honoured even when `blockedReason` did not survive parsing: `pace_quota_status`
 * only ever emits `too_many_failed_attempts`, and a reading that says "blocked" under some reason
 * we do not recognise is still a refusal the server will make. The message degrades to its
 * no-time-known wording rather than inventing a cause.
 */
export function resolveAnalysisGate(result: QuotaStatusResult): AnalysisGate {
  if (!result.ok) return { kind: 'allowed' };

  const quota = result.data;
  if (quota.blocked) {
    return { kind: 'cooldown', blockedUntil: quota.blockedUntil };
  }

  // `unlimited` readings carry `remaining: null` by contract (`_shared/quota-status.ts`) and can
  // never be exhausted. A non-number `remaining` on a non-unlimited reading is not something we
  // can refuse on either — leave it to the server.
  if (!quota.unlimited && typeof quota.remaining === 'number' && quota.remaining <= 0) {
    return { kind: 'exhausted', tier: quota.tier };
  }

  return { kind: 'allowed' };
}

/** One lookup, never rejecting — `QuotaStatusClient`'s contract already promises this, and the
 * `.catch` is defence in depth against a caller that breaks it. */
async function lookUpOnce(client: QuotaStatusClient): Promise<QuotaStatusResult> {
  return client.fetch().catch((): QuotaStatusResult => ({
    ok: false,
    error: { error: 'The quota lookup failed unexpectedly.', code: 'unknown' },
  }));
}

/**
 * ONE RETRY BEFORE DEGRADING. Failing open is safe (it can only hand the decision back to the
 * server, and can only under-request frames), but it is not free of consequence: a Pro user whose
 * lookup blipped gets a single-frame analysis, and the result then honestly says only one frame
 * could be analysed — a degraded product bought by one flaky request. A retryable failure gets a
 * second attempt before we accept that, still inside the SAME `QUOTA_WAIT_TIMEOUT_MS` budget the
 * caller races against, so this can never make the extraction screen wait longer than it does
 * today.
 *
 * `unauthorized` is NOT retried: it is a settled answer about the caller (no session), not a
 * transient failure, and asking again cannot change it.
 */
async function lookUpWithOneRetry(client: QuotaStatusClient): Promise<QuotaStatusResult> {
  const first = await lookUpOnce(client);
  if (first.ok || first.error.code === 'unauthorized') {
    return first;
  }
  return lookUpOnce(client);
}

/**
 * Asks the server, once, whether this caller may start an analysis and how many frames their
 * video may contain — bounded by `QUOTA_WAIT_TIMEOUT_MS`, and resolving rather than rejecting on
 * any failure, so a caller can `await` this exactly once and always get a usable answer back.
 *
 * `client` is injectable for the same reason `lib/quota.ts` exposes `createQuotaStatusClient()`
 * separately from its `quotaStatusClient` binding: a test can hand in a fake without a live edge
 * function to call. Production callers pass nothing.
 */
export async function fetchAnalysisPreflight(
  client: QuotaStatusClient = quotaStatusClient
): Promise<AnalysisPreflight> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), QUOTA_WAIT_TIMEOUT_MS);
  });

  try {
    const outcome = await Promise.race([lookUpWithOneRetry(client), timeout]);

    if (outcome === TIMED_OUT) {
      return { gate: { kind: 'allowed' }, frameCap: FALLBACK_VIDEO_FRAME_CAP };
    }
    return { gate: resolveAnalysisGate(outcome), frameCap: resolveVideoFrameCap(outcome) };
  } finally {
    // Always cleared, including on the fetch-won leg — a stray 4s timer would otherwise keep a
    // React Native timer handle (and this closure) alive after the screen has moved on.
    clearTimeout(timer);
  }
}
