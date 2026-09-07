/**
 * How many frames `app/capture/extracting.tsx` extracts from a VIDEO — resolved from the server's
 * own `frameCap`, never from a client-side per-tier table.
 *
 * PURE DECISION ONLY. The `quota-status` round trip that feeds it lives in
 * `lib/analysis-preflight.ts`, which takes ONE read and derives both answers the extraction screen
 * needs: this frame cap, and whether the caller may start an analysis at all. Split that way so a
 * capped or cooling-down runner is refused BEFORE any extraction work, without a second call.
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

import type { QuotaStatusResult } from './quota';

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
