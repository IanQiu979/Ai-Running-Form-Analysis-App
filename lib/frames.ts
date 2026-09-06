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
 * A real consequence of trusting the Android estimate is deliberate FAIL-CLOSED behavior, in two
 * tiers that must not be confused:
 *   - A DECODER DEFECT is fatal. `extractVideoFrames` rejects a batch whose thumbnail count does
 *     not match the requested times, or whose reported `actualTime` is non-finite or lands outside
 *     the clip's own duration (`FrameExtractionError`). None of those is a property a legitimate
 *     source clip can have.
 *   - A COLLISION IS SKIPPED. On a very-low-frame-rate source the average-frame-duration estimate
 *     can round two genuinely different, closely-spaced requests onto the same computed instant
 *     even though the underlying decode was frame-accurate, and a near-static pair can re-encode
 *     to byte-identical output. Rather than hand the model two frames falsely labeled with the
 *     same "time" — and rather than dead-ending a clip whose every retry would collide the same
 *     way — the offending thumbnail is dropped and the rest of the burst is kept. The burst span
 *     is NEVER widened to chase a frame quota: 5-6 honest frames from one stride window beat 8
 *     spread across unrelated strides, which is the exact ceiling this migration removed.
 * Only if fewer than `MIN_USABLE_VIDEO_FRAMES` distinct frames survive (and more than that were
 * requested) does extraction fail, as `InsufficientFramesError` — a `FrameExtractionError`
 * subclass the capture screen routes to its own non-retryable copy, because re-running the same
 * deterministic pipeline over the same clip collides identically. Ordinary phone-camera footage
 * (24fps+) is far above the ~10-14fps floor where the 700ms/(N-1) burst spacing could plausibly
 * collide at all.
 *
 * WHAT THIS FILE DOES:
 *   - `photo` input: exactly one frame, always (`docs/architecture.md`: "a photo submission is
 *     always exactly 1 frame regardless of tier"), timestamped 0 (there is no clip to place it in).
 *   - `video` input: up to `videoFrameCap` frames (the caller's server-resolved cap — fewer only
 *     when low-frame-rate footage collides two requests onto one instant, see above), sampled as
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
 * trustworthy stride burst: the wrong number of thumbnails came back, or a reported `actualTime`
 * is non-finite or falls outside the clip's own duration. Both indicate a decoder defect, not an
 * ordinary property of the source clip, so they fail closed — see the file header's "TIMESTAMP
 * ACCURACY" section for why a mislabeled frame is worse than an extraction the runner has to
 * retry. Colliding timestamps and duplicate re-encoded frames are NOT this error: they are the
 * expected shape of low-frame-rate footage and are skipped, then bounded by
 * `InsufficientFramesError` below.
 */
export class FrameExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameExtractionError';
  }
}

/**
 * The fewest DISTINCT frames a video's burst may collapse to and still be analyzed as motion.
 *
 * Three, not two, and the number comes from `knowledge/pace_framework.md` rather than from taste:
 * Elasticity is scored off "vertical bounce ... frame to frame" (plural transitions) and Cadence
 * off a "steps-per-second across frames" RANGE, not a point value. Two frames yield exactly one
 * interval — a single delta, which can be reported as a number but not as a trend or a range.
 * Three frames yield two consecutive intervals, the minimum that lets the analyzer honestly say
 * anything about how a quantity is MOVING. Below three, a video is no better evidenced than a
 * photo for those two pillars, so it must not be presented as one.
 *
 * Applied as `min(this, timestamps.length)`, so the floor can never demand more frames than were
 * requested: it exists to catch a burst that DEGRADED below usefulness, never to reject a cap that
 * was small to begin with. That exemption is total only for a genuinely SINGLE-frame request —
 * Free's video cap (`PACE_FRAME_CAP.free === 1`), where the floor bottoms out at 1 and no
 * collision can lose anything. A hypothetical 2-frame request would floor at 2, so one collision
 * there would still reject; no shipped tier ever asks for exactly two
 * (`PACE_FRAME_CAP` is free 1 / pro 5 / elite 8, `supabase/functions/_shared/pace.ts`).
 */
const MIN_USABLE_VIDEO_FRAMES = 3;

/**
 * Thrown by `extractFrames` (video only) when too few DISTINCT frames survived the burst — the
 * decoder reported the same instant for several requested points, or re-encoded several of them
 * to byte-identical output, and fewer than `MIN_USABLE_VIDEO_FRAMES` were left.
 *
 * A subclass of `FrameExtractionError` on purpose: every existing generic catch site keeps
 * working, while `app/capture/extracting.tsx` can single this case out. It is deterministic per
 * clip — the same source re-run through the same pipeline collides identically — so the screen
 * routes it to copy that offers a different clip rather than a Retry button that cannot succeed.
 */
export class InsufficientFramesError extends FrameExtractionError {
  constructor(
    public readonly framesExtracted: number,
    public readonly framesRequested: number,
  ) {
    super(
      `Only ${framesExtracted} distinct frame(s) survived extraction from ${framesRequested} requested — below the ${MIN_USABLE_VIDEO_FRAMES}-frame floor a motion-based analysis needs. This looks like low-frame-rate source footage (e.g. re-encoded/screen-recorded); retrying the same clip will fail identically.`,
    );
    this.name = 'InsufficientFramesError';
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
 * ONE function for both inputs. `source` is a local file URI for a picked/captured photo, or an
 * already-decoded `VideoThumbnail` (a `SharedRef<'image'>`, handed to `ImageManipulator.manipulate`
 * directly — no intermediate file). `width`/`height` are the source's own reported dimensions;
 * for video that is the thumbnail's own size, not anything the caller supplied for the clip. The
 * video path already asks `generateThumbnailsAsync` to bound its output to `MAX_LONG_EDGE_PX`
 * (see `extractVideoFrames`), so the resize below is usually a defensive no-op there.
 *
 * Only one of `resize`'s `width`/`height` is ever passed — whichever matches the long edge — so
 * `expo-image-manipulator` computes the other dimension itself and the result stays exactly on
 * the source's aspect ratio, rather than this function rounding both independently and drifting
 * off-ratio.
 *
 * Releases the manipulator context and rendered image it creates, on EVERY exit including the
 * no-base64 throw; the caller releases the `thumbnail` itself once this returns. The photo path
 * used to leak both of those native references on every extraction — same manipulator API, same
 * obligation, so it is discharged in one place rather than duplicated.
 */
async function downscaleToJpegBase64(
  source: string | VideoThumbnail,
  width: number,
  height: number,
): Promise<string> {
  const longEdge = Math.max(width, height);
  let context = ImageManipulator.manipulate(source);

  if (longEdge > MAX_LONG_EDGE_PX) {
    const scale = MAX_LONG_EDGE_PX / longEdge;
    context =
      width >= height
        ? context.resize({ width: Math.round(width * scale) })
        : context.resize({ height: Math.round(height * scale) });
  }

  try {
    const rendered = await context.renderAsync();
    try {
      const saved = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG, base64: true });

      if (!saved.base64) {
        throw new Error('expo-image-manipulator did not return base64 data for a frame');
      }

      return saved.base64;
    } finally {
      rendered.release();
    }
  } finally {
    context.release();
  }
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

    const frames: PaceFrame[] = [];
    const seenBase64 = new Set<string>();
    let previousTimestampMs = -Infinity;
    // Tracks the next thumbnail whose release has not been attempted, so the `finally` below can
    // release exactly the remaining thumbnails. It advances immediately before the current
    // thumbnail's release call, preventing either that call or `onProgress` throwing afterward
    // from making `finally` release the same native reference twice.
    let settledCount = 0;

    try {
      if (thumbnails.length !== timestamps.length) {
        throw new FrameExtractionError(
          `expo-video returned ${thumbnails.length} thumbnail(s) for ${timestamps.length} requested time(s)`,
        );
      }

      for (; settledCount < thumbnails.length; ) {
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
        // A COLLISION IS SKIPPED, NOT FATAL. On low-frame-rate footage Android's
        // average-frame-duration estimate rounds two genuinely different requests inside the fixed
        // ~700ms window onto one instant, and a static-ish pair can re-encode to identical bytes.
        // Neither is a decoder defect — both simply mean this window holds fewer distinct frames
        // than were asked for. Dropping the offender keeps the surviving frames honestly labeled
        // and lets a 5-or-6-of-8 burst still produce a real analysis; the floor check after the
        // loop is what decides whether enough survived. `previousTimestampMs` and `seenBase64`
        // are only advanced for a frame that was actually accepted.
        let accepted: PaceFrame | null = null;
        if (timestampMs > previousTimestampMs) {
          const base64 = await downscaleToJpegBase64(thumbnail, thumbnail.width, thumbnail.height);
          if (!seenBase64.has(base64)) {
            accepted = { base64, timestampMs };
          }
        }

        if (accepted) {
          previousTimestampMs = accepted.timestampMs;
          seenBase64.add(accepted.base64);
          frames.push(accepted);
        }

        settledCount++;
        thumbnail.release();
        onProgress?.(settledCount, thumbnails.length);
      }
    } finally {
      for (let j = settledCount; j < thumbnails.length; j++) {
        thumbnails[j].release();
      }
    }

    if (frames.length < Math.min(MIN_USABLE_VIDEO_FRAMES, timestamps.length)) {
      throw new InsufficientFramesError(frames.length, timestamps.length);
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
