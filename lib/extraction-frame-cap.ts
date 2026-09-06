/**
 * How many frames `app/capture/extracting.tsx` extracts from a VIDEO — resolved from the server's
 * own `frameCap`, never from a client-side per-tier table.
 *
 * WHY THIS MODULE EXISTS. `extracting.tsx` used to hardcode `const EXTRACTION_TIER: PaceTier =
 * 'free'`, with a comment justifying it as "there is no wired, authoritative way to read the
 * caller's tier on the client yet." That was true when written and is no longer: `lib/quota.ts`'s
 * `quotaStatusClient` calls the deployed `GET /functions/v1/quota-status` (issue #50 — live since
 * 2026-07-26, see `docs/status.md` M5), and its `QuotaStatus` already carries an authoritative
 * `frameCap` alongside `tier`. Until this module landed, every Pro/Elite user's video was
 * extracted down to Free's 1 frame — Cadence and Elasticity are derived from motion over time and
 * cannot score off a single still, so a paying user silently received the free product.
 *
 * WE READ `frameCap`, NOT `tier`. There is deliberately no `PACE_FRAME_CAP[quota.tier]` lookup
 * anywhere below. CLAUDE.md: "Tier, quota, frame cap, and analysis are server-only (edge
 * functions); the client may display tier/quota state but is never the authority for it." Reading
 * the server's number keeps that true; re-deriving it from `tier` through a client table would
 * make `PACE_FRAME_CAP` the client's source of truth for what a paying user is owed, which is the
 * rule this project exists under. `PACE_FRAME_CAP` is still imported here for exactly two
 * non-authoritative purposes, both documented at their use sites: the free-tier FLOOR we fall back
 * to, and a sanity ceiling mirroring one the server already enforces.
 *
 * SPLIT OUT OF THE SCREEN ON PURPOSE, for the reason `lib/quota.ts`'s own header gives for
 * hoisting Home's caption mapping out of `app/(tabs)/index.tsx`: this is exactly the kind of logic
 * CLAUDE.md wants proven with a real test ("New logic added to `lib/` ... should get a test
 * alongside it"). `resolveVideoFrameCap` is pure, so every failure branch below is directly
 * testable without a live function to call — see `lib/__tests__/extraction-frame-cap.test.ts`.
 */
import { PACE_FRAME_CAP } from '@shared/pace';

import { quotaStatusClient, type QuotaStatusClient, type QuotaStatusResult } from './quota';

/**
 * THE DELIBERATE FALLBACK, and the whole reason it is a named constant rather than a bare `1`:
 * every path below that cannot obtain a trustworthy server number lands here on purpose, not by
 * accident. Free's cap is the smallest of the three, so falling back to it can only ever
 * UNDER-request frames — never over-request them against a tier the caller does not have.
 *
 * Sourced from `@shared/pace` rather than written as a literal so it cannot drift from the value
 * `reserve_analysis` enforces for free (locked by `lib/__tests__/frames.test.ts`'s
 * "matches reserve_analysis's hardcoded per-tier frame caps exactly" case). Note what this is NOT:
 * it is not "the client's copy of a paying user's cap" — it is the floor we degrade to when the
 * server did not tell us anything better, which is the one number the client is always safe to
 * assume.
 */
export const FALLBACK_VIDEO_FRAME_CAP = PACE_FRAME_CAP.free;

/**
 * A defensive sanity ceiling, NOT a tier cap and NOT an authority. `analyze-form` already refuses
 * any submission over this same number regardless of tier — one GLOBAL frame-count ceiling, the
 * most permissive tier's cap (`supabase/functions/analyze-form/flow.ts`: `if (frames.length >
 * PACE_FRAME_CAP.elite)`). This mirrors that server-side rule locally for one reason only: a
 * `frameCap` of, say, 10_000 arriving from a misbehaving/rolled-forward server would otherwise
 * mean decoding and downscaling 10_000 frames on the device (one `expo-video`
 * `generateThumbnailsAsync` batch, then one manipulator pass per thumbnail) before `analyze-form`
 * got the chance to reject the result. Clamping here fails toward a submission the server will
 * actually accept. For every honest value (1..8) this is a no-op, so it never lowers a cap the
 * user paid for.
 */
const GLOBAL_FRAME_CEILING = PACE_FRAME_CAP.elite;

/**
 * One quota round-trip's worth of patience before the extraction screen stops waiting and
 * proceeds at `FALLBACK_VIDEO_FRAME_CAP`. Same order of magnitude, and the same reasoning, as
 * `app/(auth)/update-password.tsx`'s `RECOVERY_WAIT_TIMEOUT_MS` and `lib/hibp.ts`'s
 * `TOTAL_TIMEOUT_MS` — this project's established bound for a single network call, not an
 * arbitrary guess. It exists so a hung or very slow `quota-status` degrades the frame count
 * instead of leaving the user staring at a spinner that never advances.
 */
export const QUOTA_WAIT_TIMEOUT_MS = 4000;

/** Unique sentinel for the timeout leg of the race below — a symbol so it can never be confused
 *  with a real `QuotaStatusResult` the way a string or `null` could be. */
const TIMED_OUT: unique symbol = Symbol('quotaWaitTimedOut');

/**
 * The pure decision: how many frames a video gets, given whatever `quota-status` came back with.
 *
 * Every non-success branch resolves to `FALLBACK_VIDEO_FRAME_CAP` — deliberately, and never to
 * anything larger:
 *   - `{ ok: false }` in any of its three documented flavours (`unauthorized`,
 *     `quota_status_unavailable`, `unknown` — see `lib/quota.ts`'s `QuotaStatusErrorCode`). An
 *     unauthenticated or failed lookup tells us nothing about the caller's entitlement, so
 *     assuming the paid cap would hand a free (or signed-out) user Elite's frame count on a
 *     network blip.
 *   - a structurally-valid response whose `frameCap` is not a usable count. `lib/quota.ts`'s
 *     `parseQuotaStatusResponse` already rejects a non-number, so this catches what typing alone
 *     cannot: `0`, a negative, `NaN`, `Infinity`, or a fractional value. `sampleTimestamps` would
 *     throw a `RangeError` on a non-positive count and blow up the whole extraction, so degrading
 *     to the free floor here is both safer and honest about what we actually know.
 *
 * A trustworthy number is returned as-is, clamped only by `GLOBAL_FRAME_CEILING` (see its own doc
 * — a no-op for every real tier value).
 */
export function resolveVideoFrameCap(result: QuotaStatusResult): number {
  if (!result.ok) return FALLBACK_VIDEO_FRAME_CAP;

  const { frameCap } = result.data;
  if (!Number.isInteger(frameCap) || frameCap < 1) return FALLBACK_VIDEO_FRAME_CAP;

  return Math.min(frameCap, GLOBAL_FRAME_CEILING);
}

/**
 * Asks the server how many frames this caller's video may contain, bounded by
 * `QUOTA_WAIT_TIMEOUT_MS`, and resolving to `FALLBACK_VIDEO_FRAME_CAP` rather than rejecting on
 * any failure — so a caller can `await` this exactly once and always get a usable count back.
 *
 * `client` is injectable for the same reason `lib/quota.ts` exposes `createQuotaStatusClient()`
 * separately from its `quotaStatusClient` binding: a test can hand in a fake without a live edge
 * function to call. Production callers pass nothing.
 *
 * The `.catch` is defence in depth, not a live path: `QuotaStatusClient`'s contract is that it
 * "resolves — NEVER REJECTS", and `lib/quota.ts`'s real implementation folds every transport
 * failure into `{ ok: false }` itself. But a rejection escaping to the extraction screen's own
 * `.catch` would surface as `extractionFailed` — a dead-end error screen — when the honest
 * response to "we could not read your quota" is to extract at the free cap and let the analysis
 * proceed. Fail toward a working submission, never toward a hard stop.
 */
export async function fetchVideoFrameCap(
  client: QuotaStatusClient = quotaStatusClient
): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), QUOTA_WAIT_TIMEOUT_MS);
  });

  try {
    const outcome = await Promise.race([
      client.fetch().catch((): QuotaStatusResult => ({
        ok: false,
        error: { error: 'The quota lookup failed unexpectedly.', code: 'unknown' },
      })),
      timeout,
    ]);

    return outcome === TIMED_OUT ? FALLBACK_VIDEO_FRAME_CAP : resolveVideoFrameCap(outcome);
  } finally {
    // Always cleared, including on the fetch-won leg — a stray 4s timer would otherwise keep a
    // React Native timer handle (and this closure) alive after the screen has moved on.
    clearTimeout(timer);
  }
}
