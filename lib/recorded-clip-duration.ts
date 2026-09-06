/**
 * How long the clip `app/capture/record.tsx` just recorded actually is, in milliseconds.
 *
 * WHY THIS ISN'T JUST `Date.now() - startedAt`. `CameraView.recordAsync()` resolves with only
 * `{ uri }` — it reports no duration, on either platform — so the record screen has to measure the
 * clip itself. It used to do that with a single wall-clock span: stamp `Date.now()` on the record
 * tap, subtract it from `Date.now()` at the moment `recordAsync`'s promise resolved. That span is
 * NOT the clip's duration. It brackets the recorded media on both sides:
 *   - at the head, the camera session's start-up latency — the gap between the JS call and the
 *     first frame actually written to the file;
 *   - at the tail, file finalization — `recordAsync` resolves from iOS's
 *     `fileOutput(_:didFinishRecordingTo:)` / Android's finalize callback, which fire once the
 *     movie file has been written and closed, well after the last recorded frame.
 * So the reported duration was systematically LONGER than the clip, and two things broke:
 *
 *   1. A FULL-LENGTH RECORDING WAS ALWAYS REJECTED. `recordAsync` is given
 *      `maxDuration: MAX_CLIP_DURATION_MS / 1000`, so the camera hard-stops at exactly 15.000s of
 *      media. The wall-clock span around that is strictly greater than 15000, and
 *      `app/capture/extracting.tsx`'s pre-flight `checkMediaCaps` rejects `durationMs > 15000` as
 *      `clipTooLong` — the app refusing a clip its own recorder had just capped. The longest, most
 *      analyzable recordings were exactly the ones that dead-ended.
 *   2. FRAMES WERE SAMPLED PAST THE END OF THE CLIP. `lib/frames.ts`'s `sampleTimestamps` then
 *      spread its samples across the 5%-95% window of whatever duration it was handed, so an
 *      inflated duration pushed the late samples at or beyond the real last frame. iOS's
 *      `AVAssetImageGenerator` leaves `requestedTimeToleranceBefore` at `.positiveInfinity` for a
 *      requested time past the asset's duration (see `expo-video-thumbnails`'s
 *      `VideoThumbnailsModule.swift`), so those samples came back as the SAME final still —
 *      duplicate frames where the analysis was supposed to see motion. Since #199 the sampler
 *      takes one centered ~700ms burst instead, so an over-reported duration shifts that burst's
 *      center rather than running off the end of the clip — but the duration it is handed still
 *      has to be an honest measurement for the burst to land where it is meant to.
 *
 * WHAT THIS FIXES, AND WHAT IT HONESTLY DOES NOT. The caller stamps the stop time when it calls
 * `stopRecording()` rather than when `recordAsync` resolves, which removes the tail (finalization)
 * error, and the clamp below removes the `clipTooLong` false rejection outright — `maxDuration` is
 * a hard guarantee from the native recorder that the media cannot be longer than
 * `MAX_CLIP_DURATION_MS`, so clamping the MEASUREMENT to it is strictly more accurate than
 * trusting a wall clock that provably overshoots. The head (camera start-up) error remains: no
 * expo-camera SDK 54 API reports when recording actually began — `CameraView` has
 * `onCameraReady`/`onMountError` and nothing for recording start (`Camera.types.d.ts`), and
 * `recordAsync` resolves with `{ uri }` alone. Closing that gap needs a duration read off the
 * finished file. Nothing in this repo reads one today, and `expo-av` is still not a dependency —
 * but `expo-video` IS one as of issue #199 (installed for batch frame decoding, see
 * `lib/frames.ts`'s header), so the dependency list no longer rules that route out by itself.
 * Whatever you do here, do NOT paper over the remaining head error by subtracting a guessed
 * constant: an invented number is not a measurement.
 */
import { MAX_CLIP_DURATION_MS } from './media-caps';

/**
 * The recorded clip's duration, from the two wall-clock stamps the record screen can actually
 * take, clamped to the recorder's own `maxDuration` guarantee.
 *
 * Returns `0` — which `app/capture/record.tsx` treats as "nothing usable was recorded", the same
 * as a missing uri — for a non-finite stamp or a stop that precedes the start, rather than
 * propagating a `NaN`/negative into `sampleTimestamps`, which throws a `RangeError` on any
 * non-positive duration and would surface as a dead-end `extractionFailed` screen.
 */
export function measureRecordedClipDurationMs(startedAtMs: number, stoppedAtMs: number): number {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(stoppedAtMs)) return 0;

  const elapsed = stoppedAtMs - startedAtMs;
  if (elapsed <= 0) return 0;

  return Math.min(elapsed, MAX_CLIP_DURATION_MS);
}
