/**
 * Regression locks for `lib/recorded-clip-duration.ts`.
 *
 * THE BUG THIS FILE EXISTS FOR. `app/capture/record.tsx` reported the clip's duration as a plain
 * wall-clock span from the record tap to `recordAsync`'s promise resolving. That span brackets the
 * recorded media on both sides (camera start-up at the head, file finalization at the tail), so it
 * always OVERSTATED the clip — and a full-length recording, which the recorder itself hard-caps at
 * exactly `MAX_CLIP_DURATION_MS` via `maxDuration`, therefore measured over the cap and was
 * rejected by `app/capture/extracting.tsx`'s pre-flight `checkMediaCaps` as `clipTooLong`. The
 * same overstatement pushed `lib/frames.ts`'s `sampleTimestamps` window past the real last frame,
 * so the late samples came back as duplicates of the final still. See the module header.
 */
import { MAX_CLIP_DURATION_MS, checkMediaCaps } from '../media-caps';
import { measureRecordedClipDurationMs } from '../recorded-clip-duration';

describe('measureRecordedClipDurationMs', () => {
  it('reports the elapsed span for an ordinary hand-stopped clip', () => {
    expect(measureRecordedClipDurationMs(1_000, 6_200)).toBe(5_200);
  });

  // THE headline lock. The recorder auto-stops at exactly MAX_CLIP_DURATION_MS of media, but the
  // wall clock around it always reads longer — start-up latency plus the finalization the promise
  // waits on. Before the fix that number went straight into checkMediaCaps and came back
  // 'clipTooLong': the app refusing the longest clip its own camera had just produced.
  it('never exceeds the recorder\'s own maxDuration guarantee, so a full-length clip is not rejected', () => {
    const startedAtMs = 1_000;
    // 15.000s of media + ~0.4s of camera start-up and file finalization around it.
    const wallClockStopMs = startedAtMs + MAX_CLIP_DURATION_MS + 400;

    // What the screen used to hand on, and what that did:
    expect(checkMediaCaps({ durationMs: wallClockStopMs - startedAtMs })).toBe('clipTooLong');

    const measured = measureRecordedClipDurationMs(startedAtMs, wallClockStopMs);
    expect(measured).toBe(MAX_CLIP_DURATION_MS);
    expect(checkMediaCaps({ durationMs: measured })).toBeNull();
  });

  it('leaves a clip exactly on the cap alone', () => {
    expect(measureRecordedClipDurationMs(0, MAX_CLIP_DURATION_MS)).toBe(MAX_CLIP_DURATION_MS);
  });

  // 0 is the screen's "nothing usable was recorded" value — it declines to navigate rather than
  // handing sampleTimestamps a non-positive duration, which throws a RangeError and would surface
  // as a dead-end extractionFailed screen.
  it.each([
    ['a stop that precedes the start', 5_000, 4_000],
    ['identical stamps', 5_000, 5_000],
    ['a NaN start', Number.NaN, 5_000],
    ['a NaN stop', 5_000, Number.NaN],
    ['an infinite stop', 5_000, Number.POSITIVE_INFINITY],
  ])('returns 0 for %s', (_label, startedAtMs, stoppedAtMs) => {
    expect(measureRecordedClipDurationMs(startedAtMs, stoppedAtMs)).toBe(0);
  });
});
