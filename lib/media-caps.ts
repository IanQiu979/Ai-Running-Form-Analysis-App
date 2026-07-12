/**
 * Client-side capture caps (issue #36) — "15s clip cap / 50 MB pre-compress cap surfaced
 * honestly before the user records something unusable" (`docs/mvp-build-prompt.md` gate #5,
 * decided 2026-07-10: "max clip length (rec: 15s, V1's precedent)... max upload size (rec:
 * 50MB pre-compress gate)").
 *
 * These are UX guardrails, not the enforcement point and not tier logic (CLAUDE.md: "No
 * business rules in the client") — they apply identically to every tier, unlike
 * `PACE_FRAME_CAP`/`PACE_MAX_REQUEST_BODY_BYTES` (`@shared/pace`), which ARE tier/budget
 * enforcement inputs the server re-checks regardless. This file exists only so the capture
 * screens (`app/capture/record.tsx`, `app/capture/index.tsx`'s library pick, and
 * `app/capture/extracting.tsx`'s pre-flight check) share one pair of numbers instead of each
 * hand-typing its own, and so the check itself — order matters when a clip is both too long and
 * too large — has one tested implementation rather than three duplicated guesses.
 *
 * Distinct from `lib/frames.ts`'s `PACE_MAX_REQUEST_BODY_BYTES` budget: that caps the
 * downscaled, JPEG-encoded base64 the `analyze-form` request body actually carries, checked
 * AFTER extraction. This file caps the SOURCE video before extraction ever runs, so a clip that
 * would take a long time to process (or that the recorder should never have produced) is
 * rejected honestly and immediately instead of after N slow `expo-video-thumbnails` calls.
 */

/** Max recorded/picked clip duration, in milliseconds. Also passed to `CameraView.recordAsync`'s
 * `maxDuration` (in seconds) so an in-app recording can never exceed this — a library-picked
 * video has no such enforcement at capture time, which is what `checkMediaCaps` below is for. */
export const MAX_CLIP_DURATION_MS = 15_000;

/** Max source file size, in bytes, BEFORE frame extraction/downscaling — "pre-compress" per the
 * build prompt's own wording. A library pick can be arbitrarily large; an in-app recording is
 * bounded in duration but not in bitrate, so both paths check this. */
export const MAX_PRE_COMPRESS_BYTES = 50 * 1024 * 1024;

export type MediaCapViolation = 'clipTooLong' | 'fileTooLarge';

/**
 * Checks a candidate photo/video against the two caps above. Duration is checked first —
 * matching the build prompt's own ordering ("15s clip cap / 50 MB pre-compress cap") — so a clip
 * that fails both gets the more fundamental, easier-to-act-on reason ("too long") rather than
 * "too large", which a runner can't fix by trimming alone if the bitrate is also the problem.
 *
 * Either field may be omitted/`null` (a photo has no duration; a size that couldn't be read
 * yet) — an absent field never trips its own check.
 */
export function checkMediaCaps(input: {
  durationMs?: number | null;
  fileSizeBytes?: number | null;
}): MediaCapViolation | null {
  if (typeof input.durationMs === 'number' && input.durationMs > MAX_CLIP_DURATION_MS) {
    return 'clipTooLong';
  }
  if (typeof input.fileSizeBytes === 'number' && input.fileSizeBytes > MAX_PRE_COMPRESS_BYTES) {
    return 'fileTooLarge';
  }
  return null;
}
