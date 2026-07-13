/**
 * Regression locks for `lib/frames.ts` (issue #34).
 *
 * `expo-image-manipulator` and `expo-video-thumbnails` are native modules with no host
 * implementation under Jest, so both are manually mocked below (same pattern as
 * `consent.test.ts`'s `jest.mock('../supabase', ...)`) rather than exercised for real —
 * `ImageManipulator.manipulate` and `VideoThumbnails.getThumbnailAsync` are the only two calls
 * this file ever makes into either module, so mocking those two functions is enough to drive
 * every branch in `lib/frames.ts`.
 *
 * The load-bearing cases here are:
 *   1. Frame count per tier comes from `PACE_FRAME_CAP` (`@shared/pace`), not a locally
 *      redeclared cap — a regression that hardcoded `5` here would still pass every other test.
 *   2. A photo is always exactly one frame, timestamped 0, regardless of tier.
 *   3. `sampleTimestamps` never touches t=0 or t=duration, and the SAME values it returns are
 *      what `extractFrames` records as `timestampMs` for a video (see `lib/frames.ts`'s "Timestamp
 *      accuracy" header note for why this is "requested", not independently-verified-actual).
 *   4. The budget check never truncates: case group 5 asserts every frame was fully extracted
 *      (all N native calls happened) even when the result is over budget and gets thrown away.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';

import { PACE_FRAME_CAP, type PaceTier } from '@shared/pace';

import { extractFrames, FrameBudgetExceededError, sampleTimestamps } from '../frames';

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: jest.fn(),
}));

const mockManipulate = ImageManipulator.manipulate as jest.Mock;
const mockGetThumbnailAsync = VideoThumbnails.getThumbnailAsync as jest.Mock;

/**
 * Queues one `ImageManipulator.manipulate(...)` call's worth of chainable mock behavior — one
 * queued result per frame `lib/frames.ts` downscales, consumed in call order via
 * `mockImplementationOnce`. `resize`/`renderAsync` return the same context object, matching the
 * real API's `resize(): ImageManipulatorContext` chaining.
 */
function queueManipulateResult(base64: string | undefined, opts?: { width?: number; height?: number }) {
  const width = opts?.width ?? 100;
  const height = opts?.height ?? 100;
  const saveAsync = jest.fn().mockResolvedValue({ uri: 'file://out.jpg', width, height, base64 });
  const context: { resize: jest.Mock; renderAsync: jest.Mock } = {
    resize: jest.fn(),
    renderAsync: jest.fn().mockResolvedValue({ width, height, saveAsync }),
  };
  context.resize.mockReturnValue(context);
  mockManipulate.mockImplementationOnce(() => context);
  return { resize: context.resize, renderAsync: context.renderAsync, saveAsync };
}

/** Queues one `VideoThumbnails.getThumbnailAsync(...)` call's worth of result. */
function queueThumbnail(uri: string, width = 100, height = 100) {
  mockGetThumbnailAsync.mockImplementationOnce(async () => ({ uri, width, height }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sampleTimestamps', () => {
  // Case 1: no pair of points to space for a single sample — takes the window's midpoint rather
  // than dividing by zero.
  it('returns the 5%-95% window midpoint for count = 1', () => {
    expect(sampleTimestamps(10_000, 1)).toEqual([5_000]);
  });

  // Case 2: two points land exactly on the window's own two ends (5% and 95% of duration) —
  // NOT on t=0 or t=duration, which is the thing this function exists to avoid.
  it('places count = 2 exactly on the 5% and 95% marks, never on t=0 or t=duration', () => {
    const timestamps = sampleTimestamps(10_000, 2);
    expect(timestamps).toEqual([500, 9_500]);
    expect(timestamps[0]).toBeGreaterThan(0);
    expect(timestamps[timestamps.length - 1]).toBeLessThan(10_000);
  });

  // Case 3: evenly spaced, inclusive of the window's own ends, for a tier's real cap (Elite: 8).
  it('spaces count = 8 evenly across the window, ascending, never repeating', () => {
    const timestamps = sampleTimestamps(20_000, 8);
    expect(timestamps).toEqual([1_000, 3_571, 6_143, 8_714, 11_286, 13_857, 16_429, 19_000]);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1]);
    }
  });

  it('throws for a non-positive duration', () => {
    expect(() => sampleTimestamps(0, 5)).toThrow(RangeError);
    expect(() => sampleTimestamps(-1, 5)).toThrow(RangeError);
  });

  it('throws for a non-positive count', () => {
    expect(() => sampleTimestamps(10_000, 0)).toThrow(RangeError);
  });

  // Case 3b (Pro tier, PACE_FRAME_CAP.pro === 5): an independent, hand-computed pin for the one
  // real per-tier count cases 1-3 don't already cover directly (they lock 1, 2, and 8). Uses the
  // same duration as the count=8 case above so the two are easy to cross-check by eye.
  it('spaces count = 5 (Pro tier) evenly across the window, ascending', () => {
    expect(sampleTimestamps(20_000, 5)).toEqual([1_000, 5_500, 10_000, 14_500, 19_000]);
  });

  // Case: the OTHER failure mode a bad `count` can take, distinct from "throws for a non-positive
  // count" above. `PACE_FRAME_CAP[tier]` (`@shared/pace`) is a plain object index, not a
  // exhaustively-checked switch — an unrecognized tier reaching it at runtime (impossible through
  // `extractFrames`'s own `PaceTier`-typed signature, but not impossible for a caller that
  // bypasses TypeScript) yields `undefined`, not `0`. `undefined <= 0` is `false`, so the
  // non-positive guard above does NOT catch it, and this is the path it actually falls through to
  // instead: zero timestamps, never a NaN-laced or fallback-sized array. This is the client-side
  // half of the "disagreement fails safe" property the "tier-cap agreement" suite below tests
  // end-to-end.
  it('returns zero timestamps — never a fallback count — when count is not a usable number', () => {
    expect(sampleTimestamps(10_000, undefined as unknown as number)).toEqual([]);
  });
});

describe('extractFrames — photo input', () => {
  // Case 4: a photo is exactly one frame, timestamped 0, regardless of tier — 'elite' here is
  // deliberately chosen to prove PACE_FRAME_CAP.elite (8) is NOT consulted for a photo.
  it('produces exactly one frame timestamped 0, ignoring the tier frame cap', async () => {
    const onProgress = jest.fn();
    queueManipulateResult('cGhvdG8=', { width: 800, height: 600 });

    const result = await extractFrames({ mediaType: 'photo', uri: 'file://photo.jpg', width: 800, height: 600 }, 'elite', onProgress);

    expect(result.frames).toEqual([{ base64: 'cGhvdG8=', timestampMs: 0 }]);
    expect(mockManipulate).toHaveBeenCalledTimes(1);
    expect(mockManipulate).toHaveBeenCalledWith('file://photo.jpg');
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(1, 1);
  });

  // Case 5: never upscaled — a photo already under the 1568px cap is re-encoded as-is.
  it('does not resize a photo already at or under the 1568px long edge', async () => {
    const { resize } = queueManipulateResult('c21hbGw=', { width: 1200, height: 800 });

    await extractFrames({ mediaType: 'photo', uri: 'file://photo.jpg', width: 1200, height: 800 }, 'free');

    expect(resize).not.toHaveBeenCalled();
  });

  // Case 6: landscape long edge is width — only width is passed to resize(), letting
  // expo-image-manipulator compute height itself and keep the exact aspect ratio.
  it('resizes a landscape photo over 1568px by width only, preserving aspect ratio', async () => {
    const { resize } = queueManipulateResult('bGFuZHNjYXBl', { width: 3136, height: 1568 });

    await extractFrames({ mediaType: 'photo', uri: 'file://photo.jpg', width: 3136, height: 1568 }, 'free');

    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenCalledWith({ width: 1568 });
  });

  // Case 7: portrait long edge is height — mirrors case 6 for the other orientation, the common
  // case for a phone-recorded running clip.
  it('resizes a portrait photo over 1568px by height only, preserving aspect ratio', async () => {
    const { resize } = queueManipulateResult('cG9ydHJhaXQ=', { width: 1080, height: 2400 });

    await extractFrames({ mediaType: 'photo', uri: 'file://photo.jpg', width: 1080, height: 2400 }, 'free');

    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenCalledWith({ height: 1568 });
  });

  // Case 8: every frame is re-encoded at the documented JPEG q≈0.7, requesting base64 back.
  it('saves every frame as JPEG at q0.7 with base64 requested', async () => {
    const { saveAsync } = queueManipulateResult('cQ==');

    await extractFrames({ mediaType: 'photo', uri: 'file://photo.jpg', width: 100, height: 100 }, 'free');

    expect(saveAsync).toHaveBeenCalledWith({ compress: 0.7, format: SaveFormat.JPEG, base64: true });
  });

  it('throws when expo-image-manipulator returns no base64 data', async () => {
    queueManipulateResult(undefined);

    await expect(extractFrames({ mediaType: 'photo', uri: 'file://photo.jpg', width: 100, height: 100 }, 'free')).rejects.toThrow(
      'did not return base64 data',
    );
  });
});

describe('extractFrames — video input', () => {
  // Case 9: THE frame-cap-authority lock. Free/Pro/Elite must each request exactly
  // PACE_FRAME_CAP[tier] frames, sourced from @shared/pace — not a locally redeclared number.
  it.each([
    ['free', PACE_FRAME_CAP.free],
    ['pro', PACE_FRAME_CAP.pro],
    ['elite', PACE_FRAME_CAP.elite],
  ] as const)('requests PACE_FRAME_CAP.%s (%i) frames for a video at that tier', async (tier, cap) => {
    const durationMs = 10_000;
    const expectedTimestamps = sampleTimestamps(durationMs, cap);
    for (let i = 0; i < cap; i++) {
      queueThumbnail(`file://thumb-${i}.jpg`);
      queueManipulateResult(`ZnJhbWU${i}`);
    }

    const result = await extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, tier);

    expect(mockGetThumbnailAsync).toHaveBeenCalledTimes(cap);
    expect(result.frames).toHaveLength(cap);
    expectedTimestamps.forEach((timestampMs, i) => {
      expect(mockGetThumbnailAsync).toHaveBeenNthCalledWith(i + 1, 'file://clip.mp4', { time: timestampMs, quality: 1 });
      // Case 3 in the file header: the REQUESTED timestamp is what's recorded — see
      // lib/frames.ts's "Timestamp accuracy" note for why this is not independently verified.
      expect(result.frames[i].timestampMs).toBe(timestampMs);
    });
  });

  // Case 10: calls are sequential (expo-video-thumbnails has no batch API), one at a time, so
  // onProgress reports real incremental progress rather than firing once at the end.
  it('extracts frames sequentially and reports progress after each one', async () => {
    const onProgress = jest.fn();
    const durationMs = 10_000;
    const cap = PACE_FRAME_CAP.pro;
    for (let i = 0; i < cap; i++) {
      queueThumbnail(`file://thumb-${i}.jpg`);
      queueManipulateResult(`ZnJhbWU${i}`);
    }

    await extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, 'pro', onProgress);

    expect(onProgress).toHaveBeenCalledTimes(cap);
    for (let i = 0; i < cap; i++) {
      expect(onProgress).toHaveBeenNthCalledWith(i + 1, i + 1, cap);
    }
  });

  // Case 11: each extracted video frame is downscaled using ITS OWN reported dimensions
  // (expo-video-thumbnails' result), not any dimension the caller supplied for the source video.
  it('downscales each extracted frame using that frame\'s own reported width/height', async () => {
    queueThumbnail('file://thumb-0.jpg', 3200, 1600);
    const { resize } = queueManipulateResult('ZnJhbWUw', { width: 3200, height: 1600 });

    await extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs: 10_000 }, 'free');

    expect(resize).toHaveBeenCalledWith({ width: 1568 });
  });
});

describe('extractFrames — budget check', () => {
  // Case 12: THE never-truncate lock. All PACE_FRAME_CAP.elite (8) frames are fully extracted —
  // every native call happens — even though the result ends up thrown away for being over
  // budget. A truncating implementation would call getThumbnailAsync fewer than 8 times here and
  // still (wrongly) pass a naive "it throws" test that didn't check the call count.
  it('extracts every frame before checking the budget, even when it will end up over it', async () => {
    const durationMs = 10_000;
    const cap = PACE_FRAME_CAP.elite;
    const oversizedBase64 = 'A'.repeat(1_000_000); // 1MB/frame * 8 frames = 8MB > the 5MB budget
    for (let i = 0; i < cap; i++) {
      queueThumbnail(`file://thumb-${i}.jpg`);
      queueManipulateResult(oversizedBase64);
    }

    await expect(extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, 'elite')).rejects.toThrow(
      FrameBudgetExceededError,
    );

    expect(mockGetThumbnailAsync).toHaveBeenCalledTimes(cap);
    expect(mockManipulate).toHaveBeenCalledTimes(cap);
  });

  // Case 13: the thrown error carries the real numbers, not just a generic message, so the
  // caller can build an honest UI string (e.g. "try a shorter clip") instead of a dead end.
  it('carries the real totalBytes/limitBytes/frameCount on the thrown error', async () => {
    const cap = PACE_FRAME_CAP.elite;
    const oversizedBase64 = 'A'.repeat(1_000_000);
    for (let i = 0; i < cap; i++) {
      queueThumbnail(`file://thumb-${i}.jpg`);
      queueManipulateResult(oversizedBase64);
    }

    let caught: unknown;
    try {
      await extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs: 10_000 }, 'elite');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(FrameBudgetExceededError);
    const budgetError = caught as FrameBudgetExceededError;
    expect(budgetError.totalBytes).toBe(oversizedBase64.length * cap);
    expect(budgetError.limitBytes).toBe(5 * 1024 * 1024);
    expect(budgetError.frameCount).toBe(cap);
  });

  // Case 14: a frame set safely under budget resolves normally, with totalBytes equal to the
  // exact sum of every frame's base64 length (what actually rides the wire, not a decoded size).
  it('resolves with the exact summed base64 length when under budget', async () => {
    queueManipulateResult('QUJD'); // 4 chars
    const result = await extractFrames({ mediaType: 'photo', uri: 'file://photo.jpg', width: 100, height: 100 }, 'free');

    expect(result.totalBytes).toBe(4);
  });
});

describe('extractFrames — client/server tier-cap agreement (reserve_analysis authority)', () => {
  // Case: THE agreement lock. `PACE_FRAME_CAP` (`@shared/pace`) is the only description this file
  // has of what each tier is allowed to send; `reserve_analysis` — the SQL `SECURITY DEFINER`
  // function that is the ACTUAL enforcement point (CLAUDE.md: "No business rules in the client";
  // this file's own header: "a build that sent more frames than its tier allows would still be
  // rejected there, not here") — hardcodes its own, independently-maintained copy of the same
  // numbers (`supabase/migrations/20260711150400_quota_reserve_settle_release.sql`: `v_frame_cap
  // := case v_tier when 'free' then 1 when 'pro' then 5 when 'elite' then 8 end;`, reasserted
  // byte-for-byte in every migration that has since replaced `reserve_analysis`'s body). Nothing
  // makes a TypeScript object literal and a Postgres CASE expression stay equal automatically —
  // this test is that guarantee for the repo's two source files. If it fails, the two have
  // drifted: either `reserve_analysis` now rejects a tier's honestly-built submission with
  // `frame_cap_exceeded`, or the client is under-using a tier the user paid for.
  it("matches reserve_analysis's hardcoded per-tier frame caps exactly (free:1 / pro:5 / elite:8)", () => {
    expect(PACE_FRAME_CAP).toEqual({ free: 1, pro: 5, elite: 8 });
  });

  // Case: THE fail-safe-DIRECTION lock. `extractVideoFrames` has no ceiling of its own — it
  // trusts `PACE_FRAME_CAP[tier]` completely (case 9's "not a locally redeclared cap"). So the one
  // place a real client-side disagreement could still show up is an unrecognized tier reaching
  // `PACE_FRAME_CAP[tier]` at runtime — impossible through `extractFrames`'s own `PaceTier`-typed
  // signature, but not impossible for a caller that bypasses TypeScript (e.g. an unvalidated tier
  // string read back from storage). `PACE_FRAME_CAP[tier]` is then `undefined`, and — per the
  // `sampleTimestamps` case of the same name above — that resolves to REQUESTING ZERO FRAMES, not
  // falling back to some other (and specifically not a LARGER) count. A zero-frame submission is
  // one `reserve_analysis` cleanly rejects too (`p_frame_count < 1` -> `invalid_frame_count`), so
  // the failure stays a clean rejection end to end. This is the property the issue asks for:
  // disagreement fails toward fewer frames, never more.
  it('requests zero frames — never a fallback or inflated count — for a tier PACE_FRAME_CAP does not recognize', async () => {
    const unknownTier = 'legacy-tier' as unknown as PaceTier;

    const result = await extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs: 10_000 }, unknownTier);

    expect(result).toEqual({ frames: [], totalBytes: 0 });
    expect(mockGetThumbnailAsync).not.toHaveBeenCalled();
    expect(mockManipulate).not.toHaveBeenCalled();
  });
});
