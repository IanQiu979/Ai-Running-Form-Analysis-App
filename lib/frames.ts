/**
 * Frame extraction, downscaling, and pre-flight budget check (issue #34) — the client-side half
 * of the media pipeline (`docs/architecture.md` "Current — media pipeline").
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
 * THIS FILE HOLDS NO CAP OF ITS OWN, AND DOES NOT MAP A TIER TO ONE. `extractFrames` is handed the
 * number of video frames to extract; it never looks a tier up in a table. That is deliberate:
 * the authoritative per-caller `frameCap` comes from the server (`GET /functions/v1/quota-status`,
 * resolved by `lib/extraction-frame-cap.ts`), and CLAUDE.md is explicit that "Tier, quota, frame
 * cap, and analysis are server-only (edge functions); the client may display tier/quota state but
 * is never the authority for it." This module used to take a `PaceTier` and index `PACE_FRAME_CAP`
 * itself, which is what let `app/capture/extracting.tsx` quietly pin every caller — including
 * paying ones — to Free's 1 frame by passing a hardcoded `'free'`. Whatever count arrives here,
 * `reserve_analysis` still re-checks the tier's real cap server-side, so a client that asked for
 * more than its tier allows is rejected there, not here.
 *
 * TIMESTAMP ACCURACY — ISSUE #112 AND THE #199 STRIDE-BURST MIGRATION, READ BEFORE TRUSTING
 * `timestampMs`.
 * `docs/architecture.md` used to promise that this file records the frame extractor's *actual*
 * sampled timestamp rather than the requested one, on the correct reasoning that a frame-seek can
 * land meaningfully away from the time asked for. That promise was undeliverable on the original
 * extractor, `expo-video-thumbnails@~10.0.8`: neither platform's native module reported a decoded
 * time back at all (Android snapped to the nearest sync/key frame via `OPTION_CLOSEST_SYNC` and
 * returned only a `Bitmap`; iOS discarded `AVAssetImageGenerator`'s `actualTime` out-parameter).
 * `timestampMs` used to be the REQUESTED time only, and the core-purpose audit
 * (`v23-core-purpose-audit-r1`) found the second, larger problem this caused: frames were sampled
 * evenly across 5%-95% of the WHOLE clip, 1.3-2.2s apart against a ~0.7s recreational stride
 * cycle — so no two frames of a "video" analysis ever belonged to the same stride, and Cadence and
 * Elasticity were single-frame guesses dressed up as motion evidence.
 *
 * This file now uses `expo-video`'s batch `generateThumbnailsAsync` (SDK 57), which decodes
 * non-keyframe frames (`OPTION_CLOSEST` on Android, `AVAssetImageGenerator` with zero time
 * tolerance on iOS — both a real decode at the requested instant, not a snap to the nearest
 * keyframe) AND reports back a `VideoThumbnail.actualTime`, and `sampleTimestamps` now asks for a
 * single ~700ms burst centered on the clip's midpoint (`spanMs = min(700, durationMs * 0.9)`)
 * instead of spreading requests across the whole clip — one stride-length window, not four
 * unrelated instants. Two platforms, two honesty levels for `actualTime`, and BOTH still only
 * approximate:
 *   - iOS (`VideoThumbnailGenerator.swift`): `AVAssetImageGenerator.copyCGImage`/`.images(for:)`
 *     with `requestedTimeToleranceBefore/After = .zero`, so the returned `actualTime` is the real
 *     decoded frame's presentation time — frame-accurate, this is the closest thing to a
 *     measurement this file has ever had.
 *   - Android (`MediaMetadataRetriever.kt`'s `calculateActualFrameTime`): NOT a decoded PTS. It
 *     estimates one average frame duration as `clip duration / METADATA_KEY_VIDEO_FRAME_COUNT`,
 *     then rounds the requested time to the nearest multiple of that average — i.e. assumed
 *     constant frame rate, not the real variable spacing a phone encoder actually produces. On
 *     API < 28 or a source with no frame-count metadata, this silently falls back to returning the
 *     REQUESTED time unchanged (which is still honest, just not new information).
 * Neither is independently verified against what the decoder truly saw, so `timestampMs` below is
 * still flagged as approximate everywhere it is consumed exactly as before: the prompt builder
 * receives it as `requestedTimestampMs`, hedges every rendered time, forbids a precise SPM/GCT/VO
 * figure at every tier, and treats the certified "only if frame timestamps are known" clauses as
 * "known approximately" (`supabase/functions/_shared/analyze-form-prompt.ts`). What changed is
 * that these frames can now honestly be called a BURST — close enough together (see
 * `MAX_STRIDE_BURST_SPAN_MS` in that file) to plausibly share a stride — so the prompt distinguishes
 * a real burst from any pre-migration/legacy sparse manifest and only lets Cadence/Elasticity read
 * motion evidence from the former.
 *
 * A real consequence of trusting the Android estimate is new, deliberate FAIL-CLOSED behavior:
 * `extractVideoFrames` now REJECTS a video whose reported timestamps are not strictly increasing,
 * out of the clip's own duration, or non-finite (`FrameExtractionError`), and separately rejects a
 * batch containing two byte-for-byte identical re-encoded frames. On a very-low-frame-rate source
 * the average-frame-duration estimate can round two genuinely different, closely-spaced requests
 * onto the same computed instant even though the underlying decode was frame-accurate; rather than
 * hand the model two frames falsely labeled with the same "time", extraction fails outright and
 * the runner is asked to retry (`app/capture/extracting.tsx`'s existing generic `extractionFailed`
 * path — this file does not special-case the new error there). This trades a rare extraction
 * failure on unusually low-frame-rate footage for never presenting mislabeled evidence to the
 * model; ordinary phone-camera footage (24fps+) is far above the ~10-14fps floor where the
 * 700ms/(N-1) burst spacing could plausibly collide.
 *
 * WHAT THIS FILE DOES:
 *   - `photo` input: exactly one frame, always (`docs/architecture.md`: "a photo submission is
 *     always exactly 1 frame regardless of tier"), timestamped 0 (there is no clip to place it in).
 *   - `video` input: exactly `videoFrameCap` frames (the caller's server-resolved cap), sampled as
 *     one centered ~700ms burst via `sampleTimestamps`, decoded in ONE batch
 *     `generateThumbnailsAsync` call (not `videoFrameCap` sequential native calls), with
 *     `onProgress` reported per frame as each is re-encoded afterward.
 *   - Every frame is downscaled to ≤1568px long edge (Anthropic's optimum; never upscaled) and
 *     re-encoded at JPEG q≈0.7 via `expo-image-manipulator`, targeting ~150-350KB/frame. For video,
 *     `generateThumbnailsAsync` is already asked to bound its output to that same 1568px box, so
 *     the resize step usually has nothing left to do — it still runs defensively in case a decoder
 *     ever returns something larger.
 *   - The full set is summed against `PACE_MAX_REQUEST_BODY_BYTES` (5MB) BEFORE returning
 *     anything. Over budget throws `FrameBudgetExceededError` — a typed error carrying the real
 *     totals so the caller can build a real message ("try a shorter clip") — never a silent
 *     truncation of the frame list to make it fit.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { createVideoPlayer, type VideoPlayer, type VideoThumbnail } from 'expo-video';

import { PACE_MAX_REQUEST_BODY_BYTES } from '@shared/pace';

/** Anthropic's documented optimum long-edge size for a full-resolution vision encode; a larger
 * image is resized down before analysis anyway, so sending more pixels than this only inflates
 * the request body for no quality gain (`docs/architecture.md` "Current — media pipeline"). */
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
      /** The clip's duration, used to center `sampleTimestamps`' stride burst. */
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

/** Called after each frame finishes re-encoding, e.g. to drive a progress bar while the single
 * batch `generateThumbnailsAsync` result is downscaled and saved one frame at a time. */
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
 * Thrown by `extractFrames` (video only) when `expo-video`'s batch decode did not produce a
 * trustworthy stride burst: the wrong number of thumbnails came back, a reported `actualTime` is
 * non-finite or falls outside the clip's own duration, two reported times are not strictly
 * increasing, or two re-encoded frames are byte-for-byte identical. See the file header's
 * "TIMESTAMP ACCURACY" section for why this fails closed instead of silently degrading — a
 * mislabeled or duplicated frame is worse than an extraction the runner has to retry.
 */
export class FrameExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameExtractionError';
  }
}

/** How long `extractVideoFrames` waits for `expo-video` to report the source loaded (via the
 * player's `statusChange` event) before giving up. Local-file metadata loads are fast — this
 * exists only so a malformed/corrupt clip fails as a clear `FrameExtractionError` instead of
 * hanging the capture screen forever. */
const PLAYER_READY_TIMEOUT_MS = 10_000;

/** The widest a video frame's requested-time span may be for the manifest to call it a genuine
 * stride burst — see `sampleTimestamps` and `supabase/functions/_shared/analyze-form-prompt.ts`'s
 * `MAX_STRIDE_BURST_SPAN_MS`, which this constant must stay comfortably under. */
const STRIDE_BURST_SPAN_MS = 700;

/**
 * A single, centered ~700ms burst of sample points around a clip's midpoint — never a spread
 * across the whole clip. `count === 1` (Free tier's video cap) has no pair of points to space, so
 * it takes the clip's own midpoint. For `count > 1`, `spanMs` is `STRIDE_BURST_SPAN_MS` (a
 * recreational stride cycle runs ~700ms) capped at 90% of the clip's duration so a very short clip
 * still leaves a 5% margin on each side rather than touching t=0 or t=duration, where decoders are
 * most likely to fail.
 *
 * This replaced the pre-#199 "evenly across 5%-95% of the whole clip" spacing, which put 1.3-2.2s
 * between Pro/Elite frames against a ~0.7s stride — no two frames ever belonged to the same
 * stride, so Cadence and Elasticity were single-frame guesses (`v23-core-purpose-audit-r1`).
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

  if (count === 1) {
    return [Math.round(durationMs / 2)];
  }

  const spanMs = Math.min(STRIDE_BURST_SPAN_MS, durationMs * 0.9);
  const startMs = (durationMs - spanMs) / 2;
  const step = spanMs / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(startMs + step * i));
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

/**
 * Resolves once `player`'s source has finished loading (`status === 'readyToPlay'`), or rejects on
 * a load error or `PLAYER_READY_TIMEOUT_MS`. `generateThumbnailsAsync` needs this on iOS: before
 * the player has attached an `AVPlayerItem`, the native module has no asset to decode from and
 * silently returns an empty array rather than throwing (`VideoModule.swift`) — waiting here turns
 * that silent empty result into either a real burst or a clear, named failure.
 */
function waitUntilPlayerReady(player: VideoPlayer): Promise<void> {
  if (player.status === 'readyToPlay') {
    return Promise.resolve();
  }
  if (player.status === 'error') {
    return Promise.reject(new FrameExtractionError('expo-video failed to load the video source'));
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      subscription.remove();
      reject(new FrameExtractionError('Timed out waiting for the video to load before extracting frames'));
    }, PLAYER_READY_TIMEOUT_MS);

    const subscription = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'readyToPlay') {
        clearTimeout(timeout);
        subscription.remove();
        resolve();
      } else if (status === 'error') {
        clearTimeout(timeout);
        subscription.remove();
        reject(new FrameExtractionError(`expo-video failed to load the video source: ${error?.message ?? 'unknown error'}`));
      }
    });
  });
}

/**
 * Downscales one already-decoded video thumbnail (a `SharedRef<'image'>`, passed directly to
 * `ImageManipulator.manipulate` — no intermediate file URI needed) to ≤`MAX_LONG_EDGE_PX` and
 * re-encodes it as JPEG at `JPEG_QUALITY`. `generateThumbnailsAsync` was already asked to bound
 * its output to `MAX_LONG_EDGE_PX` (see `extractVideoFrames`), so the resize below is a defensive
 * no-op in the common case, not the primary downscale path.
 *
 * Releases the manipulator context and rendered image it creates; the caller releases the
 * `thumbnail` itself once this returns.
 */
async function downscaleThumbnailToJpegBase64(thumbnail: VideoThumbnail): Promise<string> {
  const longEdge = Math.max(thumbnail.width, thumbnail.height);
  let context = ImageManipulator.manipulate(thumbnail);

  if (longEdge > MAX_LONG_EDGE_PX) {
    const scale = MAX_LONG_EDGE_PX / longEdge;
    context =
      thumbnail.width >= thumbnail.height
        ? context.resize({ width: Math.round(thumbnail.width * scale) })
        : context.resize({ height: Math.round(thumbnail.height * scale) });
  }

  const rendered = await context.renderAsync();
  try {
    const saved = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG, base64: true });

    if (!saved.base64) {
      throw new Error('expo-image-manipulator did not return base64 data for a frame');
    }

    return saved.base64;
  } finally {
    rendered.release();
    context.release();
  }
}

async function extractVideoFrames(
  input: Extract<PaceMediaInput, { mediaType: 'video' }>,
  videoFrameCap: number,
  onProgress?: FrameExtractionProgress,
): Promise<PaceFrame[]> {
  const timestamps = sampleTimestamps(input.durationMs, videoFrameCap);
  if (timestamps.length === 0) {
    return [];
  }

  const player = createVideoPlayer(input.uri);
  try {
    await waitUntilPlayerReady(player);

    // ONE batch decode call, not `timestamps.length` sequential ones — the #34-era extractor
    // (`expo-video-thumbnails`) had no batch API; `expo-video`'s does, and both native
    // implementations return thumbnails in the same order as the requested `times`
    // (Android's `times.map { async {...} }.awaitAll()`; iOS's ordered `images(for:)`/legacy
    // iterator), so no re-sort against `requestedTime` is needed to trust the pairing below.
    const thumbnails = await player.generateThumbnailsAsync(
      timestamps.map((timestampMs) => timestampMs / 1000),
      { maxWidth: MAX_LONG_EDGE_PX, maxHeight: MAX_LONG_EDGE_PX },
    );

    if (thumbnails.length !== timestamps.length) {
      throw new FrameExtractionError(
        `expo-video returned ${thumbnails.length} thumbnail(s) for ${timestamps.length} requested time(s)`,
      );
    }

    const frames: PaceFrame[] = [];
    const seenBase64 = new Set<string>();
    let previousTimestampMs = -Infinity;
    // Tracks how far the loop got so the `finally` below can release exactly the thumbnails this
    // loop never got to release itself — every thumbnail up to (not including) `settledCount` is
    // released inline on success; a throw leaves the rest, from `settledCount` on, un-released.
    let settledCount = 0;

    try {
      for (; settledCount < thumbnails.length; settledCount++) {
        const thumbnail = thumbnails[settledCount];

        // See the file header's "TIMESTAMP ACCURACY" section: frame-accurate on iOS, an
        // average-frame-duration ESTIMATE on Android, and the raw requested time on either
        // platform when frame-count metadata isn't available at all.
        const timestampMs = Math.round(thumbnail.actualTime * 1000);

        if (!Number.isFinite(timestampMs) || timestampMs < 0 || timestampMs > input.durationMs) {
          throw new FrameExtractionError(
            `expo-video reported an out-of-range frame time (${timestampMs}ms) for a ${input.durationMs}ms clip`,
          );
        }
        if (timestampMs <= previousTimestampMs) {
          throw new FrameExtractionError(
            'expo-video returned frame timestamps that are not strictly increasing — this burst cannot be trusted as a motion sequence',
          );
        }
        previousTimestampMs = timestampMs;

        const base64 = await downscaleThumbnailToJpegBase64(thumbnail);
        if (seenBase64.has(base64)) {
          throw new FrameExtractionError(
            'expo-video produced two identical frames for a stride burst — the clip may be static or too short to sample',
          );
        }
        seenBase64.add(base64);

        frames.push({ base64, timestampMs });
        thumbnail.release();
        onProgress?.(settledCount + 1, thumbnails.length);
      }
    } finally {
      for (let j = settledCount; j < thumbnails.length; j++) {
        thumbnails[j].release();
      }
    }

    return frames;
  } finally {
    player.release();
  }
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
 * `videoFrameCap` is how many frames a VIDEO gets — the caller's authoritative, server-resolved
 * `frameCap` (`lib/extraction-frame-cap.ts`), NOT a tier this function maps to a number itself; see
 * the file header for why that indirection was removed. A photo is always exactly one frame
 * regardless of `videoFrameCap`, so a caller with a photo may pass any value.
 */
export async function extractFrames(
  input: PaceMediaInput,
  videoFrameCap: number,
  onProgress?: FrameExtractionProgress,
): Promise<PaceFrameSet> {
  const frames =
    input.mediaType === 'photo'
      ? await extractPhotoFrame(input, onProgress)
      : await extractVideoFrames(input, videoFrameCap, onProgress);

  const totalBytes = frames.reduce((sum, frame) => sum + base64Bytes(frame.base64), 0);
  assertWithinBudget(totalBytes, frames.length);

  return { frames, totalBytes };
}
