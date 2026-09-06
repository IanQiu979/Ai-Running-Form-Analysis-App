/**
 * Regression locks for `lib/frames.ts` (issue #34, and the #199 stride-burst migration).
 *
 * `expo-image-manipulator` and `expo-video` are native modules with no host implementation under
 * Jest, so both are manually mocked below (same pattern as `consent.test.ts`'s
 * `jest.mock('../supabase', ...)`) rather than exercised for real — `ImageManipulator.manipulate`
 * and `expo-video`'s `createVideoPlayer` (and the fake `VideoPlayer` it returns) are the only
 * surface this file ever touches, so mocking those is enough to drive every branch in
 * `lib/frames.ts`.
 *
 * The load-bearing cases here are:
 *   1. A video gets exactly the frame count it was handed — `extractFrames` takes a resolved
 *      `videoFrameCap`, and no longer maps a tier to a number itself. Where that number comes
 *      from (the server's authoritative `frameCap`, via `quota-status`) and how a failed lookup
 *      degrades is `lib/extraction-frame-cap.ts`'s job, covered by its own suite; the per-tier
 *      values are still pinned against `reserve_analysis` by the last describe block below.
 *   2. A photo is always exactly one frame, timestamped 0, regardless of the cap passed.
 *   3. `sampleTimestamps` now returns ONE centered ~700ms burst, not a spread across the whole
 *      clip — see its own describe block for the exact pinned values, and the file header of
 *      `lib/frames.ts` for why the old 5%-95% spacing was a structural ceiling on Cadence and
 *      Elasticity (`v23-core-purpose-audit-r1`).
 *   4. Video frames are decoded in ONE batch `generateThumbnailsAsync` call (not N sequential
 *      native calls), and `timestampMs` is the DECODER-REPORTED `actualTime`, not the requested
 *      time — see case group "decoder-reported timestamps" below.
 *   5. A burst that cannot be trusted as real motion evidence fails closed rather than silently
 *      degrading, in the two tiers `lib/frames.ts` distinguishes — see "fail-closed on
 *      untrustworthy bursts". A DECODER DEFECT (wrong thumbnail count, non-finite/out-of-range
 *      reported time) is a hard `FrameExtractionError`. A COLLISION (two requests rounding onto
 *      the same reported instant, or two frames re-encoding to identical bytes) is the expected
 *      shape of low-frame-rate footage: the offending frame is SKIPPED and the rest of the burst
 *      still produces an analysis, and only a burst that collapses below the 3-distinct-frame
 *      floor rejects, as `InsufficientFramesError`.
 *   6. The budget check never truncates: case group "budget check" asserts every frame was fully
 *      extracted (every thumbnail decoded and re-encoded) even when the result is over budget and
 *      gets thrown away.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { createVideoPlayer } from 'expo-video';

import { PACE_FRAME_CAP } from '@shared/pace';

import {
  extractFrames,
  FrameBudgetExceededError,
  FrameExtractionError,
  InsufficientFramesError,
  sampleTimestamps,
} from '../frames';

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

jest.mock('expo-video', () => ({
  createVideoPlayer: jest.fn(),
}));

const mockManipulate = ImageManipulator.manipulate as jest.Mock;
const mockCreateVideoPlayer = createVideoPlayer as jest.Mock;

/**
 * Queues one `ImageManipulator.manipulate(...)` call's worth of chainable mock behavior — one
 * queued result per frame `lib/frames.ts` downscales, consumed in call order via
 * `mockImplementationOnce`. `resize`/`renderAsync` return the same context object, matching the
 * real API's `resize(): ImageManipulatorContext` chaining. Both the manipulator context and the
 * rendered image expose a `release` mock so tests can assert the video path's cleanup contract.
 */
function queueManipulateResult(
  base64: string | undefined,
  opts?: { width?: number; height?: number; renderError?: Error },
) {
  const width = opts?.width ?? 100;
  const height = opts?.height ?? 100;
  const saveAsync = jest.fn().mockResolvedValue({ uri: 'file://out.jpg', width, height, base64 });
  const renderedRelease = jest.fn();
  const contextRelease = jest.fn();
  const context: { resize: jest.Mock; renderAsync: jest.Mock; release: jest.Mock } = {
    resize: jest.fn(),
    renderAsync: opts?.renderError
      ? jest.fn().mockRejectedValue(opts.renderError)
      : jest.fn().mockResolvedValue({ width, height, saveAsync, release: renderedRelease }),
    release: contextRelease,
  };
  context.resize.mockReturnValue(context);
  mockManipulate.mockImplementationOnce(() => context);
  return { resize: context.resize, renderAsync: context.renderAsync, saveAsync, contextRelease, renderedRelease };
}

/** One fake `expo-video` `VideoThumbnail` — a `SharedRef<'image'>` in production, a plain object
 * with a `release` mock here. `requestedTime`/`actualTime` are in SECONDS on the real API;
 * callers pass milliseconds for readability and this converts. */
function fakeThumbnail(
  requestedTimeMs: number,
  actualTimeMs: number,
  opts?: { width?: number; height?: number },
) {
  return {
    width: opts?.width ?? 100,
    height: opts?.height ?? 100,
    requestedTime: requestedTimeMs / 1000,
    actualTime: actualTimeMs / 1000,
    release: jest.fn(),
  };
}

type FakeThumbnail = ReturnType<typeof fakeThumbnail>;
type FakePlayerStatus = 'idle' | 'loading' | 'readyToPlay' | 'error';

/**
 * A fake `expo-video` `VideoPlayer`. `__emitStatus` is a TEST-ONLY escape hatch (not part of the
 * real API) for exercising `waitUntilPlayerReady`'s async wait for a `statusChange` event.
 */
function createFakePlayer(options?: {
  initialStatus?: FakePlayerStatus;
  thumbnailsResult?: FakeThumbnail[] | Error;
}) {
  const initialStatus = options?.initialStatus ?? 'readyToPlay';
  const thumbnailsResult = options?.thumbnailsResult ?? [];
  const listeners: Array<(payload: { status: FakePlayerStatus; error?: { message: string } }) => void> = [];

  const player = {
    status: initialStatus as FakePlayerStatus,
    addListener: jest.fn((_event: string, callback: (typeof listeners)[number]) => {
      listeners.push(callback);
      return {
        remove: jest.fn(() => {
          const index = listeners.indexOf(callback);
          if (index >= 0) listeners.splice(index, 1);
        }),
      };
    }),
    generateThumbnailsAsync: jest.fn(async () => {
      if (thumbnailsResult instanceof Error) {
        throw thumbnailsResult;
      }
      return thumbnailsResult;
    }),
    release: jest.fn(),
    __emitStatus(status: FakePlayerStatus, error?: { message: string }) {
      player.status = status;
      listeners.slice().forEach((callback) => callback({ status, error }));
    },
  };

  return player;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sampleTimestamps', () => {
  // A single sample has no pair of points to burst around — it takes the clip's own midpoint.
  it('returns the clip midpoint for count = 1', () => {
    expect(sampleTimestamps(10_000, 1)).toEqual([5_000]);
  });

  // The two ends of a 700ms burst centered on a 10s clip's midpoint (5000ms): [4650, 5350].
  it('places count = 2 at the two ends of a 700ms burst centered on the midpoint', () => {
    expect(sampleTimestamps(10_000, 2)).toEqual([4_650, 5_350]);
  });

  // Pro tier (PACE_FRAME_CAP.pro === 5): five points spanning the same 700ms burst.
  it('spaces count = 5 (Pro tier) evenly across a 700ms burst centered on the midpoint', () => {
    expect(sampleTimestamps(10_000, 5)).toEqual([4_650, 4_825, 5_000, 5_175, 5_350]);
  });

  // Elite tier (PACE_FRAME_CAP.elite === 8): eight points, same burst, tighter spacing.
  it('spaces count = 8 (Elite tier) evenly across a 700ms burst centered on the midpoint', () => {
    expect(sampleTimestamps(10_000, 8)).toEqual([4_650, 4_750, 4_850, 4_950, 5_050, 5_150, 5_250, 5_350]);
  });

  // A clip shorter than ~778ms cannot fit a full 700ms burst with 5% margin on each side — the
  // span is capped at 90% of the clip's own duration instead of touching t=0 or t=duration.
  it('caps the burst span at 90% of duration for a clip shorter than ~778ms', () => {
    expect(sampleTimestamps(500, 5)).toEqual([25, 138, 250, 363, 475]);
  });

  it('every timestamp lands strictly inside the clip, never at t=0 or t=duration', () => {
    const timestamps = sampleTimestamps(10_000, 8);
    expect(timestamps[0]).toBeGreaterThan(0);
    expect(timestamps[timestamps.length - 1]).toBeLessThan(10_000);
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

  // The OTHER failure mode a bad `count` can take, distinct from "throws for a non-positive
  // count" above. `PACE_FRAME_CAP[tier]` (`@shared/pace`) is a plain object index, not an
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
  // Case: a photo is exactly one frame, timestamped 0, regardless of the cap passed — Elite's 8
  // is deliberately chosen here to prove the video cap is NOT consulted for a photo. This is the
  // "Photos are unaffected" property: `app/capture/extracting.tsx` never even calls `quota-status`
  // on the photo path, and `extractFrames` ignores the cap for it regardless.
  it('produces exactly one frame timestamped 0, ignoring the video frame cap', async () => {
    const onProgress = jest.fn();
    queueManipulateResult('cGhvdG8=', { width: 800, height: 600 });

    const result = await extractFrames(
      { mediaType: 'photo', uri: 'file://photo.jpg', width: 800, height: 600 },
      PACE_FRAME_CAP.elite,
      onProgress,
    );

    expect(result.frames).toEqual([{ base64: 'cGhvdG8=', timestampMs: 0 }]);
    expect(mockManipulate).toHaveBeenCalledTimes(1);
    expect(mockManipulate).toHaveBeenCalledWith('file://photo.jpg');
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(1, 1);
  });

  // Case: never upscaled — a photo already under the 1568px cap is re-encoded as-is.
  it('does not resize a photo already at or under the 1568px long edge', async () => {
    const { resize } = queueManipulateResult('c21hbGw=', { width: 1200, height: 800 });

    await extractFrames({ mediaType: 'photo', uri: 'file://photo.jpg', width: 1200, height: 800 }, PACE_FRAME_CAP.free);

    expect(resize).not.toHaveBeenCalled();
  });

  // Case: landscape long edge is width — only width is passed to resize(), letting
  // expo-image-manipulator compute height itself and keep the exact aspect ratio.
  it('resizes a landscape photo over 1568px by width only, preserving aspect ratio', async () => {
    const { resize } = queueManipulateResult('bGFuZHNjYXBl', { width: 3136, height: 1568 });

    await extractFrames({ mediaType: 'photo', uri: 'file://photo.jpg', width: 3136, height: 1568 }, PACE_FRAME_CAP.free);

    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenCalledWith({ width: 1568 });
  });

  // Case: portrait long edge is height — mirrors the case above for the other orientation, the
  // common case for a phone-recorded running clip.
  it('resizes a portrait photo over 1568px by height only, preserving aspect ratio', async () => {
    const { resize } = queueManipulateResult('cG9ydHJhaXQ=', { width: 1080, height: 2400 });

    await extractFrames({ mediaType: 'photo', uri: 'file://photo.jpg', width: 1080, height: 2400 }, PACE_FRAME_CAP.free);

    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenCalledWith({ height: 1568 });
  });

  // Case: every frame is re-encoded at the documented JPEG q≈0.7, requesting base64 back.
  it('saves every frame as JPEG at q0.7 with base64 requested', async () => {
    const { saveAsync } = queueManipulateResult('cQ==');

    await extractFrames({ mediaType: 'photo', uri: 'file://photo.jpg', width: 100, height: 100 }, PACE_FRAME_CAP.free);

    expect(saveAsync).toHaveBeenCalledWith({ compress: 0.7, format: SaveFormat.JPEG, base64: true });
  });

  it('throws when expo-image-manipulator returns no base64 data', async () => {
    queueManipulateResult(undefined);

    await expect(
      extractFrames({ mediaType: 'photo', uri: 'file://photo.jpg', width: 100, height: 100 }, PACE_FRAME_CAP.free),
    ).rejects.toThrow('did not return base64 data');
  });
});

describe('extractFrames — video input', () => {
  // THE frame-count lock, and the batch-call lock. Whatever cap arrives is exactly how many
  // frames get extracted — no rounding, no ceiling of its own, no substitution — and ALL of them
  // come from ONE `generateThumbnailsAsync` call, not `cap` sequential native calls. Parameterized
  // over all three real tier caps so a regression that pinned this function to any single one
  // (the shipped bug pinned the SCREEN to Free's 1) fails here for the other two.
  it.each([
    ['free', PACE_FRAME_CAP.free],
    ['pro', PACE_FRAME_CAP.pro],
    ['elite', PACE_FRAME_CAP.elite],
  ] as const)('requests exactly the given cap (%s = %i) frames for a video, in one batch call', async (tier, cap) => {
    const durationMs = 10_000;
    const expectedTimestamps = sampleTimestamps(durationMs, cap);
    const thumbnails = expectedTimestamps.map((ms) => fakeThumbnail(ms, ms));
    const player = createFakePlayer({ thumbnailsResult: thumbnails });
    mockCreateVideoPlayer.mockReturnValueOnce(player);
    for (let i = 0; i < cap; i++) {
      queueManipulateResult(`ZnJhbWU${i}`);
    }

    // Ties the number under test back to the tier it is meant to represent, so this suite still
    // fails if `@shared/pace` and this table ever disagree about what a tier's cap is.
    expect(PACE_FRAME_CAP[tier]).toBe(cap);

    const result = await extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, cap);

    expect(mockCreateVideoPlayer).toHaveBeenCalledWith('file://clip.mp4');
    expect(player.generateThumbnailsAsync).toHaveBeenCalledTimes(1);
    expect(player.generateThumbnailsAsync).toHaveBeenCalledWith(
      expectedTimestamps.map((ms) => ms / 1000),
      { maxWidth: 1568, maxHeight: 1568 },
    );
    expect(result.frames).toHaveLength(cap);
    expectedTimestamps.forEach((timestampMs, i) => {
      expect(result.frames[i].timestampMs).toBe(timestampMs);
    });
  });

  it('reports progress once per frame as each is re-encoded, even though decode happens in one batch call', async () => {
    const durationMs = 10_000;
    const cap = PACE_FRAME_CAP.pro;
    const timestamps = sampleTimestamps(durationMs, cap);
    const thumbnails = timestamps.map((ms) => fakeThumbnail(ms, ms));
    mockCreateVideoPlayer.mockReturnValueOnce(createFakePlayer({ thumbnailsResult: thumbnails }));
    for (let i = 0; i < cap; i++) queueManipulateResult(`ZnJhbWU${i}`);
    const onProgress = jest.fn();

    await extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, cap, onProgress);

    expect(onProgress).toHaveBeenCalledTimes(cap);
    for (let i = 0; i < cap; i++) {
      expect(onProgress).toHaveBeenNthCalledWith(i + 1, i + 1, cap);
    }
  });

  // THE decoder-reported-timestamp lock: `timestampMs` is `VideoThumbnail.actualTime`, not the
  // requested time `lib/frames.ts` asked for — the whole point of moving off
  // `expo-video-thumbnails`, which had no way to report this at all (see the file header).
  it('records the decoder-reported actualTime, not the requested time, when they differ', async () => {
    const durationMs = 10_000;
    const timestamps = sampleTimestamps(durationMs, 2); // [4650, 5350]
    const thumbnails = [
      fakeThumbnail(timestamps[0], timestamps[0] + 10),
      fakeThumbnail(timestamps[1], timestamps[1] + 10),
    ];
    mockCreateVideoPlayer.mockReturnValueOnce(createFakePlayer({ thumbnailsResult: thumbnails }));
    queueManipulateResult('QQ==');
    queueManipulateResult('Qg==');

    const result = await extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, 2);

    expect(result.frames.map((f) => f.timestampMs)).toEqual([timestamps[0] + 10, timestamps[1] + 10]);
  });

  // Case: each extracted video frame is downscaled using ITS OWN reported dimensions
  // (the `VideoThumbnail`'s own width/height), not any dimension the caller supplied for the
  // source video.
  it("downscales each extracted frame using that frame's own reported width/height", async () => {
    const durationMs = 10_000;
    const timestamps = sampleTimestamps(durationMs, 1);
    const thumbnail = fakeThumbnail(timestamps[0], timestamps[0], { width: 3200, height: 1600 });
    mockCreateVideoPlayer.mockReturnValueOnce(createFakePlayer({ thumbnailsResult: [thumbnail] }));
    const { resize } = queueManipulateResult('ZnJhbWUw');

    await extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, 1);

    expect(resize).toHaveBeenCalledWith({ width: 1568 });
  });

  // Case: the `VideoThumbnail` (a `SharedRef<'image'>`) is handed to `ImageManipulator.manipulate`
  // directly — no intermediate file URI, unlike the old `expo-video-thumbnails` path.
  it('passes the thumbnail SharedRef directly to ImageManipulator.manipulate, with no intermediate URI', async () => {
    const durationMs = 10_000;
    const timestamps = sampleTimestamps(durationMs, 1);
    const thumbnail = fakeThumbnail(timestamps[0], timestamps[0]);
    mockCreateVideoPlayer.mockReturnValueOnce(createFakePlayer({ thumbnailsResult: [thumbnail] }));
    queueManipulateResult('ZnJhbWUw');

    await extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, 1);

    expect(mockManipulate).toHaveBeenCalledWith(thumbnail);
  });

  // Case: cleanup contract. Every native reference this path creates — the player, each decoded
  // thumbnail, and each manipulator context/rendered image — is released exactly once on success.
  it('releases the player, every thumbnail, and every manipulator/rendered reference on success', async () => {
    const durationMs = 10_000;
    const cap = 2;
    const timestamps = sampleTimestamps(durationMs, cap);
    const thumbnails = timestamps.map((ms) => fakeThumbnail(ms, ms));
    const player = createFakePlayer({ thumbnailsResult: thumbnails });
    mockCreateVideoPlayer.mockReturnValueOnce(player);
    const results = timestamps.map((_, i) => queueManipulateResult(`ZnJhbWU${i}`));

    await extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, cap);

    thumbnails.forEach((thumbnail) => expect(thumbnail.release).toHaveBeenCalledTimes(1));
    results.forEach((result) => {
      expect(result.contextRelease).toHaveBeenCalledTimes(1);
      expect(result.renderedRelease).toHaveBeenCalledTimes(1);
    });
    expect(player.release).toHaveBeenCalledTimes(1);
  });
});

describe('extractFrames — video input — fail-closed on untrustworthy bursts (issue #199)', () => {
  it('releases every returned thumbnail before rejecting a partial batch', async () => {
    const durationMs = 10_000;
    const cap = 3;
    const timestamps = sampleTimestamps(durationMs, cap);
    const thumbnails = timestamps.slice(0, 2).map((ms) => fakeThumbnail(ms, ms));
    const player = createFakePlayer({ thumbnailsResult: thumbnails });
    mockCreateVideoPlayer.mockReturnValueOnce(player);

    await expect(extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, cap)).rejects.toThrow(
      FrameExtractionError,
    );

    thumbnails.forEach((thumbnail) => expect(thumbnail.release).toHaveBeenCalledTimes(1));
    expect(player.release).toHaveBeenCalledTimes(1);
    expect(mockManipulate).not.toHaveBeenCalled();
  });

  // A two-frame request whose second decoded time collides with the first: the collision itself
  // is skipped, not fatal, but that leaves ONE distinct frame out of the two requested — below
  // `min(MIN_USABLE_VIDEO_FRAMES, requested)` — so the burst rejects at the floor check.
  it('rejects with InsufficientFramesError when a collision leaves fewer distinct frames than requested', async () => {
    const durationMs = 10_000;
    const timestamps = sampleTimestamps(durationMs, 2);
    const thumbnails = [fakeThumbnail(timestamps[0], 5_000), fakeThumbnail(timestamps[1], 5_000)];
    mockCreateVideoPlayer.mockReturnValueOnce(createFakePlayer({ thumbnailsResult: thumbnails }));
    queueManipulateResult('QQ==');

    await expect(
      extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, 2),
    ).rejects.toThrow(InsufficientFramesError);
  });

  it('throws FrameExtractionError when a decoder-reported timestamp falls outside the clip', async () => {
    const durationMs = 10_000;
    const timestamps = sampleTimestamps(durationMs, 1);
    mockCreateVideoPlayer.mockReturnValueOnce(
      createFakePlayer({ thumbnailsResult: [fakeThumbnail(timestamps[0], durationMs + 500)] }),
    );

    await expect(extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, 1)).rejects.toThrow(
      FrameExtractionError,
    );
  });

  // Same skip-then-floor semantics for the OTHER collision kind: the duplicate re-encode is
  // dropped, and the single survivor is below the two frames this request asked for.
  it('rejects with InsufficientFramesError when a byte-identical duplicate leaves too few frames', async () => {
    const durationMs = 10_000;
    const timestamps = sampleTimestamps(durationMs, 2);
    const thumbnails = timestamps.map((ms) => fakeThumbnail(ms, ms));
    mockCreateVideoPlayer.mockReturnValueOnce(createFakePlayer({ thumbnailsResult: thumbnails }));
    queueManipulateResult('U0FNRQ==');
    queueManipulateResult('U0FNRQ==');

    await expect(
      extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, 2),
    ).rejects.toThrow(InsufficientFramesError);
  });

  it('releases every thumbnail and the player even when the burst is rejected partway through', async () => {
    const durationMs = 10_000;
    const timestamps = sampleTimestamps(durationMs, 2);
    // Non-increasing: the second thumbnail's actualTime does not advance past the first's.
    const thumbnails = [fakeThumbnail(timestamps[0], timestamps[0]), fakeThumbnail(timestamps[1], timestamps[0])];
    const player = createFakePlayer({ thumbnailsResult: thumbnails });
    mockCreateVideoPlayer.mockReturnValueOnce(player);
    queueManipulateResult('QQ==');

    await expect(extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, 2)).rejects.toThrow(
      FrameExtractionError,
    );

    thumbnails.forEach((thumbnail) => expect(thumbnail.release).toHaveBeenCalledTimes(1));
    expect(player.release).toHaveBeenCalledTimes(1);
  });

  it('releases the manipulator context, every thumbnail, and the player when renderAsync rejects', async () => {
    const durationMs = 10_000;
    const timestamps = sampleTimestamps(durationMs, 2);
    const thumbnails = timestamps.map((ms) => fakeThumbnail(ms, ms));
    const player = createFakePlayer({ thumbnailsResult: thumbnails });
    mockCreateVideoPlayer.mockReturnValueOnce(player);
    const manipulation = queueManipulateResult(undefined, { renderError: new Error('render failed') });

    await expect(extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, 2)).rejects.toThrow(
      'render failed',
    );

    expect(manipulation.contextRelease).toHaveBeenCalledTimes(1);
    expect(manipulation.renderedRelease).not.toHaveBeenCalled();
    thumbnails.forEach((thumbnail) => expect(thumbnail.release).toHaveBeenCalledTimes(1));
    expect(player.release).toHaveBeenCalledTimes(1);
  });

  it('releases each thumbnail and the player exactly once when onProgress throws', async () => {
    const durationMs = 10_000;
    const timestamps = sampleTimestamps(durationMs, 2);
    const thumbnails = timestamps.map((ms) => fakeThumbnail(ms, ms));
    const player = createFakePlayer({ thumbnailsResult: thumbnails });
    mockCreateVideoPlayer.mockReturnValueOnce(player);
    const manipulation = queueManipulateResult('QQ==');
    const onProgress = jest.fn(() => {
      throw new Error('progress failed');
    });

    await expect(
      extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, 2, onProgress),
    ).rejects.toThrow('progress failed');

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(manipulation.contextRelease).toHaveBeenCalledTimes(1);
    expect(manipulation.renderedRelease).toHaveBeenCalledTimes(1);
    thumbnails.forEach((thumbnail) => expect(thumbnail.release).toHaveBeenCalledTimes(1));
    expect(player.release).toHaveBeenCalledTimes(1);
  });
});

describe('extractFrames — video input — low-frame-rate footage still produces an analysis (issue #199 follow-up)', () => {
  // THE headline case this block exists for. An ~8fps clip (re-encoded or screen-recorded) rounds
  // several of the eight requested points inside the fixed ~700ms window onto the same decoded
  // instant. Before this change the first such collision threw, and because the whole pipeline is
  // deterministic per clip the offered "Retry" could never succeed. Now the colliding frames are
  // dropped and the distinct survivors — four here — are returned as an ordinary success, with the
  // burst span itself never widened to chase the missing four.
  it('skips colliding frames and resolves with the distinct survivors instead of throwing', async () => {
    const durationMs = 10_000;
    const cap = 8;
    const requested = sampleTimestamps(durationMs, cap);
    // Four distinct decoded instants for eight requests — adjacent pairs land on the same frame.
    const decoded = [4_650, 4_650, 4_850, 4_850, 5_050, 5_050, 5_250, 5_250];
    const thumbnails = requested.map((ms, i) => fakeThumbnail(ms, decoded[i]));
    const player = createFakePlayer({ thumbnailsResult: thumbnails });
    mockCreateVideoPlayer.mockReturnValueOnce(player);
    // Only the four accepted frames are ever re-encoded — a skipped frame is dropped before the
    // downscale, so it costs nothing.
    const manipulations = [0, 1, 2, 3].map((i) => queueManipulateResult(`ZnJhbWU${i}`));

    const result = await extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, cap);

    expect(result.frames.map((frame) => frame.timestampMs)).toEqual([4_650, 4_850, 5_050, 5_250]);
    expect(mockManipulate).toHaveBeenCalledTimes(4);
    // Cleanup is unchanged by the skip: every thumbnail, accepted or skipped, is released exactly
    // once, and so is the player.
    thumbnails.forEach((thumbnail) => expect(thumbnail.release).toHaveBeenCalledTimes(1));
    manipulations.forEach((manipulation) => {
      expect(manipulation.contextRelease).toHaveBeenCalledTimes(1);
      expect(manipulation.renderedRelease).toHaveBeenCalledTimes(1);
    });
    expect(player.release).toHaveBeenCalledTimes(1);
  });

  // The same skip treatment for the duplicate-bytes collision kind, above the floor this time.
  it('skips a byte-identical duplicate and resolves with the remaining distinct frames', async () => {
    const durationMs = 10_000;
    const cap = 5;
    const requested = sampleTimestamps(durationMs, cap);
    const thumbnails = requested.map((ms) => fakeThumbnail(ms, ms));
    const player = createFakePlayer({ thumbnailsResult: thumbnails });
    mockCreateVideoPlayer.mockReturnValueOnce(player);
    // The third re-encode duplicates the first's bytes; the other four are distinct.
    ['QQ==', 'Qg==', 'QQ==', 'Qw==', 'RA=='].forEach((base64) => queueManipulateResult(base64));

    const result = await extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, cap);

    expect(result.frames.map((frame) => frame.base64)).toEqual(['QQ==', 'Qg==', 'Qw==', 'RA==']);
    expect(result.frames.map((frame) => frame.timestampMs)).toEqual([
      requested[0],
      requested[1],
      requested[3],
      requested[4],
    ]);
    thumbnails.forEach((thumbnail) => expect(thumbnail.release).toHaveBeenCalledTimes(1));
    expect(player.release).toHaveBeenCalledTimes(1);
  });

  // The floor itself: too few distinct frames survive to read a cadence RANGE or a bounce TREND
  // (two consecutive intervals need three frames), so this rejects rather than presenting a
  // near-still as motion evidence.
  it('rejects with InsufficientFramesError when collisions leave fewer than three distinct frames', async () => {
    const durationMs = 10_000;
    const cap = 8;
    const requested = sampleTimestamps(durationMs, cap);
    // Only two distinct decoded instants survive out of eight requests.
    const decoded = [4_650, 4_650, 4_650, 4_650, 5_050, 5_050, 5_050, 5_050];
    const thumbnails = requested.map((ms, i) => fakeThumbnail(ms, decoded[i]));
    const player = createFakePlayer({ thumbnailsResult: thumbnails });
    mockCreateVideoPlayer.mockReturnValueOnce(player);
    queueManipulateResult('QQ==');
    queueManipulateResult('Qg==');

    const error = await extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, cap).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(InsufficientFramesError);
    // Subclassing matters: every pre-existing generic catch site keeps working.
    expect(error).toBeInstanceOf(FrameExtractionError);
    expect((error as InsufficientFramesError).framesExtracted).toBe(2);
    expect((error as InsufficientFramesError).framesRequested).toBe(cap);
    // Cleanup holds on the rejecting path too.
    thumbnails.forEach((thumbnail) => expect(thumbnail.release).toHaveBeenCalledTimes(1));
    expect(player.release).toHaveBeenCalledTimes(1);
  });

  // The floor is `min(3, requested)`, not a flat 3: Free's video cap is a single frame
  // (`PACE_FRAME_CAP.free === 1`), and a caller that only asked for one has lost nothing to
  // collisions. A flat floor would have made every free-tier video permanently unanalyzable.
  it('still accepts a free-tier single-frame video, which can never reach three frames', async () => {
    const durationMs = 10_000;
    const timestamps = sampleTimestamps(durationMs, PACE_FRAME_CAP.free);
    mockCreateVideoPlayer.mockReturnValueOnce(
      createFakePlayer({ thumbnailsResult: [fakeThumbnail(timestamps[0], timestamps[0])] }),
    );
    queueManipulateResult('ZnJlZQ==');

    const result = await extractFrames(
      { mediaType: 'video', uri: 'file://clip.mp4', durationMs },
      PACE_FRAME_CAP.free,
    );

    expect(result.frames).toHaveLength(1);
  });
});

describe('extractFrames — video input — player readiness', () => {
  // iOS's `generateThumbnailsAsync` silently returns an empty array (not an error) when the
  // player has no `AVPlayerItem` attached yet (`VideoModule.swift`) — waiting for `readyToPlay`
  // turns that into either a real burst or a clear, named failure. This proves the wait actually
  // gates the decode call.
  it('waits for the player to report readyToPlay before decoding', async () => {
    const durationMs = 10_000;
    const timestamps = sampleTimestamps(durationMs, 1);
    const player = createFakePlayer({
      initialStatus: 'loading',
      thumbnailsResult: [fakeThumbnail(timestamps[0], timestamps[0])],
    });
    mockCreateVideoPlayer.mockReturnValueOnce(player);
    queueManipulateResult('ZnJhbWUw');

    const promise = extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, 1);
    await Promise.resolve();
    await Promise.resolve();
    expect(player.generateThumbnailsAsync).not.toHaveBeenCalled();

    player.__emitStatus('readyToPlay');
    const result = await promise;

    expect(result.frames).toHaveLength(1);
    expect(player.generateThumbnailsAsync).toHaveBeenCalledTimes(1);
  });

  it('rejects with FrameExtractionError when the player reports a load error', async () => {
    const durationMs = 10_000;
    const player = createFakePlayer({ initialStatus: 'loading' });
    mockCreateVideoPlayer.mockReturnValueOnce(player);

    const promise = extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, 1);
    await Promise.resolve();
    player.__emitStatus('error', { message: 'bad file' });

    await expect(promise).rejects.toThrow(FrameExtractionError);
    expect(player.generateThumbnailsAsync).not.toHaveBeenCalled();
    expect(player.release).toHaveBeenCalledTimes(1);
  });

  it('rejects with FrameExtractionError, and releases the player, if it never becomes ready', async () => {
    jest.useFakeTimers();
    try {
      const durationMs = 10_000;
      const player = createFakePlayer({ initialStatus: 'loading' });
      mockCreateVideoPlayer.mockReturnValueOnce(player);

      const assertion = expect(
        extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, 1),
      ).rejects.toThrow(FrameExtractionError);
      await jest.advanceTimersByTimeAsync(10_000);
      await assertion;

      expect(player.generateThumbnailsAsync).not.toHaveBeenCalled();
      expect(player.release).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('extractFrames — budget check', () => {
  // THE never-truncate lock. All PACE_FRAME_CAP.elite (8) frames are fully extracted — one batch
  // decode plus all 8 re-encodes happen — even though the result ends up thrown away for being
  // over budget. Each frame's base64 is unique (a shared value would trip the NEW duplicate-frame
  // guard first and mask this assertion) but the same length, so the budget math is unaffected.
  it('extracts every frame before checking the budget, even when it will end up over it', async () => {
    const durationMs = 10_000;
    const cap = PACE_FRAME_CAP.elite;
    const timestamps = sampleTimestamps(durationMs, cap);
    const thumbnails = timestamps.map((ms) => fakeThumbnail(ms, ms));
    mockCreateVideoPlayer.mockReturnValueOnce(createFakePlayer({ thumbnailsResult: thumbnails }));
    for (let i = 0; i < cap; i++) {
      // 1MB/frame * 8 frames = 8MB > the 5MB budget; last char varies so frames are not identical.
      queueManipulateResult('A'.repeat(999_999) + String.fromCharCode(66 + i));
    }

    await expect(extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, cap)).rejects.toThrow(
      FrameBudgetExceededError,
    );

    expect(mockManipulate).toHaveBeenCalledTimes(cap);
  });

  // Case: the thrown error carries the real numbers, not just a generic message, so the
  // caller can build an honest UI string (e.g. "try a shorter clip") instead of a dead end.
  it('carries the real totalBytes/limitBytes/frameCount on the thrown error', async () => {
    const durationMs = 10_000;
    const cap = PACE_FRAME_CAP.elite;
    const timestamps = sampleTimestamps(durationMs, cap);
    const thumbnails = timestamps.map((ms) => fakeThumbnail(ms, ms));
    mockCreateVideoPlayer.mockReturnValueOnce(createFakePlayer({ thumbnailsResult: thumbnails }));
    for (let i = 0; i < cap; i++) {
      queueManipulateResult('A'.repeat(999_999) + String.fromCharCode(66 + i));
    }

    let caught: unknown;
    try {
      await extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs }, cap);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(FrameBudgetExceededError);
    const budgetError = caught as FrameBudgetExceededError;
    expect(budgetError.totalBytes).toBe(1_000_000 * cap);
    expect(budgetError.limitBytes).toBe(5 * 1024 * 1024);
    expect(budgetError.frameCount).toBe(cap);
  });

  // Case: a frame set safely under budget resolves normally, with totalBytes equal to the
  // exact sum of every frame's base64 length (what actually rides the wire, not a decoded size).
  it('resolves with the exact summed base64 length when under budget', async () => {
    queueManipulateResult('QUJD'); // 4 chars
    const result = await extractFrames({ mediaType: 'photo', uri: 'file://photo.jpg', width: 100, height: 100 }, PACE_FRAME_CAP.free);

    expect(result.totalBytes).toBe(4);
  });
});

describe('extractFrames — client/server tier-cap agreement (reserve_analysis authority)', () => {
  // THE agreement lock. `PACE_FRAME_CAP` (`@shared/pace`) is the only description this file
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

  // THE fail-safe-DIRECTION lock. `extractVideoFrames` has no ceiling of its own — it
  // extracts exactly the count it is handed (see "requests exactly the given cap" above). So the
  // one place a client-side disagreement can still show up is an unusable count reaching it at
  // runtime — impossible through `extractFrames`'s own `number`-typed signature, but not
  // impossible for a caller that bypasses TypeScript, and the reason
  // `lib/extraction-frame-cap.ts` validates the server's `frameCap` before it ever gets here (see
  // that module's own suite for the `0`/negative/NaN/fractional branches, which all degrade to
  // the free floor rather than reaching this function at all). Should one slip through anyway,
  // this is the direction it fails in: REQUESTING ZERO FRAMES — never falling back to some other,
  // and specifically never a LARGER, count. A zero-frame submission is one `reserve_analysis`
  // cleanly rejects too (`p_frame_count < 1` -> `invalid_frame_count`), so the failure stays a
  // clean rejection end to end. Disagreement fails toward fewer frames, never more — and never
  // even reaches `expo-video`, since `sampleTimestamps` returning zero timestamps short-circuits
  // before a player is created at all.
  it('requests zero frames — never a fallback or inflated count — for a cap that is not a usable number', async () => {
    const unusableCap = undefined as unknown as number;

    const result = await extractFrames({ mediaType: 'video', uri: 'file://clip.mp4', durationMs: 10_000 }, unusableCap);

    expect(result).toEqual({ frames: [], totalBytes: 0 });
    expect(mockCreateVideoPlayer).not.toHaveBeenCalled();
    expect(mockManipulate).not.toHaveBeenCalled();
  });
});
