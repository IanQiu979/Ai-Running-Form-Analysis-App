/**
 * Frame extraction, downscaling, and pre-flight budget check (issue #34) — the client-side half
 * of the media pipeline (`docs/architecture.md` "Planned — media pipeline").
 *
 * THIS FILE DOES NOT UPLOAD ANYTHING. Since issue #88 (merged, applied to the live database),
 * the client never writes to Storage — `storage.objects` has no INSERT policy for `authenticated`
 * at all. Frames ride as base64 in the `analyze-form` request body instead, and the edge function
 * writes them to the bucket itself, with the service-role key, only after the model call
 * succeeds. So this module's whole job is: given a photo or a recorded video, produce the exact
 * `{ frames: string[], timestamps: number[] }` pair `analyze-form` expects, and refuse — never
 * silently degrade — if that payload would blow the shared request-body budget. No network call,
 * no Supabase client, no Storage SDK anywhere in this file.
 *
 * FRAME COUNT IS DISPLAY-ONLY HERE (CLAUDE.md: "No business rules in the client"). `PACE_FRAME_CAP`
 * (`supabase/functions/_shared/pace.ts`, imported via the `@shared/*` alias, issue #90) is read to
 * decide how many frames to *extract* for a video so the request looks reasonable, but
 * `reserve_analysis` re-checks the tier's real cap server-side regardless of what this file sends
 * — a build that sent more frames than its tier allows would still be rejected there, not here.
 *
 * TIMESTAMP ACCURACY — A KNOWN GAP AGAINST THE PLAN, READ BEFORE TRUSTING `timestampMs`.
 * `docs/architecture.md` requires recording the frame extractor's *actual* sampled timestamp,
 * not the one requested, because Android's frame-seek snaps to the nearest keyframe and can land
 * meaningfully away from the requested time. That is correct, but `expo-video-thumbnails@~10.0.8`
 * (the only frame extractor this repo has — `expo-video` is deliberately not installed) has no
 * way to report it back, on EITHER platform:
 *   - Android's native module (`VideoThumbnailsModule.kt`) calls
 *     `MediaMetadataRetriever.getFrameAtTime(time, OPTION_CLOSEST_SYNC)`, which snaps to the
 *     nearest sync (key) frame — and returns only a `Bitmap`. There is no public Android API that
 *     hands back the PTS of the frame `OPTION_CLOSEST_SYNC` actually decoded, so the native module
 *     has nothing to plumb through even if its JS bridge wanted to.
 *   - iOS's native module (`VideoThumbnailsModule.swift`) calls
 *     `AVAssetImageGenerator.copyCGImage(at: time, actualTime: nil)` — `actualTime` is exactly the
 *     out-parameter that WOULD carry this, and the module passes `nil` and discards it.
 *   - Either way, `VideoThumbnailsResult` (the JS-facing return type) is `{ uri, width, height }`
 *     — no timestamp field exists to read, requested or actual.
 * So `timestampMs` below is the REQUESTED time only, faithfully recorded (not re-derived from an
 * independent "assume even spacing" formula — see `sampleTimestamps`), but not independently
 * confirmed against what the extractor actually decoded. This satisfies the letter of "don't
 * assume perfect spacing after the fact" but not the full "record the actual timestamp" ask —
 * flagged here rather than silently presented as fully meeting it. Closing the gap for real needs
 * either a native module patch (out of this issue's scope: it only installs
 * `expo-image-manipulator` and writes this file) or a different extractor; tracked as a follow-up,
 * not resolved here.
 *
 * WHAT THIS FILE DOES:
 *   - `photo` input: exactly one frame, always (`docs/architecture.md`: "a photo submission is
 *     always exactly 1 frame regardless of tier"), timestamped 0 (there is no clip to place it in).
 *   - `video` input: `PACE_FRAME_CAP[tier]` frames, sampled evenly across the 5%-95% duration
 *     window (never t=0 or t=duration — extractor edge failures) via `sampleTimestamps`, one
 *     sequential `expo-video-thumbnails` call per frame (it has no batch API) reported through
 *     `onProgress`.
 *   - Every frame is downscaled to ≤1568px long edge (Anthropic's optimum; never upscaled) and
 *     re-encoded at JPEG q≈0.7 via `expo-image-manipulator`, targeting ~150-350KB/frame.
 *   - The full set is summed against `PACE_MAX_REQUEST_BODY_BYTES` (5MB) BEFORE returning
 *     anything. Over budget throws `FrameBudgetExceededError` — a typed error carrying the real
 *     totals so the caller can build a real message ("try a shorter clip") — never a silent
 *     truncation of the frame list to make it fit.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';

import { PACE_FRAME_CAP, PACE_MAX_REQUEST_BODY_BYTES, type PaceTier } from '@shared/pace';

/** Anthropic's documented optimum long-edge size for a full-resolution vision encode; a larger
 * image is resized down before analysis anyway, so sending more pixels than this only inflates
 * the request body for no quality gain (`docs/architecture.md` "Planned — media pipeline"). */
const MAX_LONG_EDGE_PX = 1568;

/** JPEG compression level for every re-encoded frame (`docs/architecture.md`: "JPEG q≈0.7"). */
const JPEG_QUALITY = 0.7;

export type PaceMediaInput =
  | {
      mediaType: 'photo';
      /** Local file URI of the already-captured/picked photo. */
      uri: string;
      /** The photo's true pixel dimensions, as reported by the picker/camera that produced it —
       * needed to compute the downscale target without an extra decode pass this file would
       * otherwise have to do just to read them back off the file itself. */
      width: number;
      height: number;
    }
  | {
      mediaType: 'video';
      /** Local file URI of the recorded/picked video. */
      uri: string;
      /** The clip's duration, used to place `sampleTimestamps`' 5%-95% window. */
      durationMs: number;
    };

/** One frame ready to ride in the `analyze-form` request body. */
export interface PaceFrame {
  /** Raw base64 JPEG bytes — no `data:image/...;base64,` prefix (that prefix is a display-only
   * convention for `<Image source={{ uri }}>`, not part of the wire format `analyze-form`
   * expects). */
  base64: string;
  /** Milliseconds from the start of the clip. 0 for a photo. See the file header's "Timestamp
   * accuracy" note for exactly what this value does and does not guarantee for video frames. */
  timestampMs: number;
}

export interface PaceFrameSet {
  frames: PaceFrame[];
  /** Combined byte length of every frame's `base64` string — exactly the quantity
   * `PACE_MAX_REQUEST_BODY_BYTES` budgets against (see `assertWithinBudget`). */
  totalBytes: number;
}

/** Called after each frame finishes extracting + downscaling, e.g. to drive a progress bar
 * during the N sequential `expo-video-thumbnails` calls a multi-frame video requires. */
export type FrameExtractionProgress = (framesDone: number, framesTotal: number) => void;

/**
 * Thrown by `extractFrames` when the fully-extracted frame set would exceed
 * `PACE_MAX_REQUEST_BODY_BYTES`. Deliberately thrown only AFTER every frame has been extracted
 * and downscaled — never used to stop early and hand back a truncated, silently-smaller frame
 * set. Carries the real numbers so the caller can build an honest message instead of a generic
 * failure string.
 */
export class FrameBudgetExceededError extends Error {
  constructor(
    public readonly totalBytes: number,
    public readonly limitBytes: number,
    public readonly frameCount: number,
  ) {
    super(
      `${frameCount} frame(s) totalled ${totalBytes} bytes, over the ${limitBytes}-byte analyze-form request budget`,
    );
    this.name = 'FrameBudgetExceededError';
  }
}

/**
 * Evenly-spaced sample points across the 5%-95% window of a clip's duration — never t=0 or
 * t=duration, where extractors are most likely to fail (`docs/architecture.md`). `count === 1`
 * (Free tier's video cap) has no pair of points to space "evenly," so it takes the window's
 * midpoint instead; `count > 1` spaces points inclusively across the window's own two ends,
 * which are themselves already well clear of the clip's true start/end.
 *
 * Exported so its spacing math can be tested directly, without mocking the native frame
 * extractor.
 */
export function sampleTimestamps(durationMs: number, count: number): number[] {
  if (durationMs <= 0) {
    throw new RangeError(`durationMs must be positive, got ${durationMs}`);
  }
  if (count <= 0) {
    throw new RangeError(`count must be positive, got ${count}`);
  }

  const windowStart = durationMs * 0.05;
  const windowEnd = durationMs * 0.95;

  if (count === 1) {
    return [Math.round((windowStart + windowEnd) / 2)];
  }

  const step = (windowEnd - windowStart) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(windowStart + step * i));
}

/** Each base64 character is one ASCII byte on the wire — the exact size this string contributes
 * to the JSON `analyze-form` request body, not the (smaller) size it decodes to. */
function base64Bytes(base64: string): number {
  return base64.length;
}

/**
 * Downscales one already-extracted frame to ≤`MAX_LONG_EDGE_PX` on its long edge (never
 * upscaled) and re-encodes it as JPEG at `JPEG_QUALITY`, returning raw base64.
 *
 * Only one of `resize`'s `width`/`height` is ever passed — whichever matches the long edge — so
 * `expo-image-manipulator` computes the other dimension itself and the result stays exactly on
 * the source's aspect ratio, rather than this function rounding both independently and drifting
 * off-ratio.
 */
async function downscaleToJpegBase64(uri: string, width: number, height: number): Promise<string> {
  const longEdge = Math.max(width, height);
  let context = ImageManipulator.manipulate(uri);

  if (longEdge > MAX_LONG_EDGE_PX) {
    const scale = MAX_LONG_EDGE_PX / longEdge;
    context =
      width >= height
        ? context.resize({ width: Math.round(width * scale) })
        : context.resize({ height: Math.round(height * scale) });
  }

  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG, base64: true });

  if (!saved.base64) {
    throw new Error('expo-image-manipulator did not return base64 data for a frame');
  }

  return saved.base64;
}

async function extractPhotoFrame(
  input: Extract<PaceMediaInput, { mediaType: 'photo' }>,
  onProgress?: FrameExtractionProgress,
): Promise<PaceFrame[]> {
  const base64 = await downscaleToJpegBase64(input.uri, input.width, input.height);
  onProgress?.(1, 1);
  return [{ base64, timestampMs: 0 }];
}

async function extractVideoFrames(
  input: Extract<PaceMediaInput, { mediaType: 'video' }>,
  tier: PaceTier,
  onProgress?: FrameExtractionProgress,
): Promise<PaceFrame[]> {
  const timestamps = sampleTimestamps(input.durationMs, PACE_FRAME_CAP[tier]);
  const frames: PaceFrame[] = [];

  // expo-video-thumbnails has no batch API — N frames is N sequential calls (issue #34's scope).
  // Sequential (not Promise.all) so onProgress reports real incremental progress rather than
  // firing once at the very end.
  for (let i = 0; i < timestamps.length; i++) {
    const requestedTimeMs = timestamps[i];
    // quality: 1 (no compression here) — the frame is about to be re-encoded at JPEG_QUALITY by
    // downscaleToJpegBase64 anyway, so compressing twice would only lose extra detail for free.
    const thumbnail = await VideoThumbnails.getThumbnailAsync(input.uri, { time: requestedTimeMs, quality: 1 });
    const base64 = await downscaleToJpegBase64(thumbnail.uri, thumbnail.width, thumbnail.height);
    frames.push({ base64, timestampMs: requestedTimeMs });
    onProgress?.(i + 1, timestamps.length);
  }

  return frames;
}

function assertWithinBudget(totalBytes: number, frameCount: number): void {
  if (totalBytes > PACE_MAX_REQUEST_BODY_BYTES) {
    throw new FrameBudgetExceededError(totalBytes, PACE_MAX_REQUEST_BODY_BYTES, frameCount);
  }
}

/**
 * Extract, downscale, and budget-check a photo or video's frames for the `analyze-form` request
 * body. See the file header for what this does and does not guarantee.
 *
 * `tier` decides how many frames a VIDEO gets (`PACE_FRAME_CAP[tier]`, display-only — see the
 * file header). A photo is always exactly one frame regardless of `tier`.
 */
export async function extractFrames(
  input: PaceMediaInput,
  tier: PaceTier,
  onProgress?: FrameExtractionProgress,
): Promise<PaceFrameSet> {
  const frames =
    input.mediaType === 'photo' ? await extractPhotoFrame(input, onProgress) : await extractVideoFrames(input, tier, onProgress);

  const totalBytes = frames.reduce((sum, frame) => sum + base64Bytes(frame.base64), 0);
  assertWithinBudget(totalBytes, frames.length);

  return { frames, totalBytes };
}
