/**
 * Screen-level regression locks for `app/capture/extracting.tsx`. Two separate bug classes, both
 * of which shipped to users:
 *
 * 1. ISSUE #147 — the infinite render loop ("Maximum update depth exceeded") that crashed every
 *    photo/video submission. See the "render-loop" describe block at the bottom.
 *
 * 2. THE PRE-FLIGHT GATE — a capped or cooling-down runner used to extract frames, submit, wait
 *    20-60s, and only then be refused: the cooldown under copy that claimed their analysis had
 *    FAILED, beside a Retry that resubmitted into the identical refusal. The gate now runs on ONE
 *    bounded `quota-status` read before any thumbnail work, on the photo path as well as video.
 *    See the "pre-flight gate" describe block. Only a refusal the SERVER stated is honoured —
 *    every lookup failure proceeds, because a blip must not fabricate a claim about someone's
 *    account.
 *
 * 3. THE FRAME-CAP BUG — this screen hardcoded `const EXTRACTION_TIER: PaceTier = 'free'`, so
 *    every Pro and Elite user's video was extracted down to Free's single frame. Cadence and
 *    Elasticity are the two PACE pillars derived from motion over time and cannot be scored from
 *    one still, so a paying user silently received a degraded version of the free product. The
 *    cap now comes from the server's own `frameCap` (`lib/extraction-frame-cap.ts` ->
 *    `GET /functions/v1/quota-status`).
 *
 * WHY THE FRAME-CAP CASES LIVE HERE AND NOT ONLY IN `lib/__tests__/extraction-frame-cap.test.ts`.
 * That suite proves the pure resolver maps a quota response to the right number. It cannot prove
 * the number reaches `extractFrames`, because the bug was never in a mapping — it was a screen
 * that never consulted a mapping at all. So these cases assert the two things the resolver suite
 * structurally cannot: the count `extractFrames` is actually CALLED with, and that the progress
 * caption's total agrees with it. Only the real `quotaStatusClient` is faked; `fetchVideoFrameCap`
 * and `resolveVideoFrameCap` run for real, so this exercises the whole chain end to end.
 *
 * `extractFrames` never resolves by default here (deliberately) — for #147 the render count must
 * stay bounded indefinitely while the screen sits in its "extracting" state, and for the frame-cap
 * cases the screen parks in "extracting" with the resolved total on display, which is exactly the
 * state under test. The error-routing block overrides that with a one-shot rejection per case,
 * since which ERROR KIND a thrown extraction failure maps to — and therefore whether a Retry
 * control is offered at all — is also wiring only a screen-level render can prove.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';

import { Copy } from '@/constants/copy';
import { takePendingAnalyzeFormRequest } from '@/lib/analyze-form';
import {
  extractFrames,
  FrameExtractionError,
  InsufficientFramesError,
  type PaceFrameSet,
} from '@/lib/frames';
import { MAX_CLIP_DURATION_MS } from '@/lib/media-caps';
import { quotaStatusClient, type QuotaStatus, type QuotaStatusResult } from '@/lib/quota';

import { PACE_FRAME_CAP } from '@shared/pace';

import ExtractingScreen from '../extracting';

// react-native-safe-area-context wraps a native module; the package's own jest mock (used the
// same way its own README documents, and the same way components/__tests__/offline-banner.test.tsx
// already does) resolves useSafeAreaInsets()/SafeAreaView without requiring a real
// <SafeAreaProvider> ancestor under test.
jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

// Issue #128 made `lib/analyze-form.ts` a REAL edge-function client, so this screen's existing
// import of it now transitively pulls in `lib/functions-client.ts` -> `lib/supabase.ts`, which
// builds a client from `EXPO_PUBLIC_*` at import time and throws when they are unset (as they are
// under Jest). This screen never touches Supabase itself — it only mints an idempotency key and
// stages the request — so the module boundary is mocked rather than the env faked, matching
// `lib/__tests__/delete-account.test.ts` and `lib/__tests__/consent.test.ts`. Faking the env in
// `jest.setup.js` instead would hand every suite in the repo a real, half-configured client.
jest.mock('../../../lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

// The ONLY thing faked on the frame-cap path: the network call itself. `lib/extraction-frame-cap.ts`
// reads this exact binding (its `client` parameter defaults to it), so mocking here leaves the real
// timeout race and the real `frameCap` validation in play.
jest.mock('@/lib/quota', () => ({
  quotaStatusClient: { fetch: jest.fn() },
}));

const mockAnnounce = AccessibilityInfo.announceForAccessibility as jest.Mock;

let renderCount = 0;

/** Route params the mocked `useLocalSearchParams` will serve. Mutable so each test can pick a
 *  photo or a video without re-mocking the module. */
let mockRouteParams: Record<string, string> = {};

const PHOTO_PARAMS = {
  mediaType: 'photo',
  uri: 'file:///fake/photo.jpg',
  width: '1080',
  height: '1920',
} as const;

// 10s is comfortably inside `lib/media-caps.ts`'s MAX_CLIP_DURATION_MS (15s), so the screen's
// pre-flight cap re-check passes and execution reaches the cap resolution under test.
const VIDEO_PARAMS = {
  mediaType: 'video',
  uri: 'file:///fake/clip.mp4',
  durationMs: '10000',
} as const;

// THE load-bearing mock for #147: a fresh object literal every call, exactly like the real
// `useLocalSearchParams()` (node_modules/expo-router/build/hooks.js). Returning the same cached
// object here would make the old, buggy `useMemo(..., [params])` dependency look correct.
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => {
    renderCount += 1;
    return { ...mockRouteParams };
  },
  // Stable across renders, unlike `useLocalSearchParams` above: the real `useRouter()` is not
  // contractually a fresh object per call, and a stable mock is what lets the `exhausted` gate's
  // `replace('/paywall')` be asserted at all. (`extracting.tsx` still holds it in a ref rather
  // than depending on it — see that file's comment.)
  useRouter: () => mockRouter,
}));

const mockRouter = { replace: jest.fn(), push: jest.fn() };

// `jest.requireActual('@/lib/frames')` below re-executes the real module, whose top-level
// `import ... from 'expo-video'` otherwise crashes at import time under Jest (no native module,
// and jest-expo ships no built-in mock for it, unlike several other expo-* packages). This suite
// never exercises real video decoding — `extractFrames` itself is fully mocked out below — so an
// empty stub is enough to let the import resolve.
jest.mock('expo-video', () => ({
  createVideoPlayer: jest.fn(),
}));

// Never resolves: the screen must stay in its "extracting" state — and, critically, stay
// RENDER-BOUNDED while it does — for as long as extraction is in flight.
jest.mock('@/lib/frames', () => {
  const actual = jest.requireActual('@/lib/frames');
  return {
    ...actual,
    extractFrames: jest.fn(() => new Promise(() => {})),
  };
});

// This suite renders a screen whose module graph is large (expo-router, safe-area, the frames and
// quota clients), and the FIRST render in the file pays a one-off transform/import cost that has
// measured close to `waitFor`'s 1s default — a flake that has nothing to do with the behavior under
// test. Both budgets below are deliberately generous: they exist to outlast module init, not to
// paper over a slow assertion.
jest.setTimeout(30_000);
const WAIT = { timeout: 15_000 } as const;

const mockExtractFrames = extractFrames as jest.MockedFunction<typeof extractFrames>;
const mockQuotaFetch = quotaStatusClient.fetch as jest.MockedFunction<typeof quotaStatusClient.fetch>;

/** A complete, well-formed `QuotaStatus` — every field present, so a regression that reads some
 *  field other than `frameCap` cannot pass on a partial fixture. */
function quotaResult(
  tier: QuotaStatus['tier'],
  frameCap: number,
  overrides: Partial<QuotaStatus> = {}
): QuotaStatusResult {
  return {
    ok: true,
    data: {
      tier,
      used: 0,
      limit: tier === 'free' ? 1 : 10,
      remaining: tier === 'free' ? 1 : 10,
      frameCap,
      isLifetime: tier === 'free',
      periodStart: tier === 'free' ? null : '2026-07-01T00:00:00.000Z',
      periodEnd: tier === 'free' ? null : '2026-08-01T00:00:00.000Z',
      blocked: false,
      blockedReason: null,
      blockedUntil: null,
      ...overrides,
    },
  };
}

/** The frame count `extractFrames` was actually invoked with — the number that decides what the
 *  user really gets, as opposed to anything merely displayed. */
function extractedFrameCount(): number {
  expect(mockExtractFrames).toHaveBeenCalledTimes(1);
  return mockExtractFrames.mock.calls[0][1];
}

beforeEach(() => {
  jest.clearAllMocks();
  renderCount = 0;
  mockRouteParams = { ...PHOTO_PARAMS };
  // A permissive default, so every case that is not ABOUT the gate passes through it. Cases that
  // are about it override this. `jest.clearAllMocks()` clears calls, not implementations, so this
  // has to be re-set per test rather than once at module scope.
  mockQuotaFetch.mockResolvedValue(quotaResult('free', PACE_FRAME_CAP.free));
});

describe('ExtractingScreen — video frame cap comes from the server (the paid-tier bug)', () => {
  beforeEach(() => {
    mockRouteParams = { ...VIDEO_PARAMS };
  });

  // THE headline regression lock. Before the fix both of these extracted 1 frame.
  it.each([
    ['pro', PACE_FRAME_CAP.pro],
    ['elite', PACE_FRAME_CAP.elite],
  ] as const)('extracts a %s caller\'s full %i frames, and shows that same total', async (tier, cap) => {
    mockQuotaFetch.mockResolvedValue(quotaResult(tier, cap));

    // `render` (this installed `@testing-library/react-native`, v14) is ASYNC — it returns a
    // Promise, not the result object. An un-awaited call here raced the `act()` flush inside
    // `render` against the `waitFor` below: usually `waitFor`'s polling outlasted it, but under
    // CI's slower/loaded runners the race occasionally lost, leaving the module-level `screen`
    // singleton unset (`node_modules/@testing-library/react-native/dist/screen.js`) when this
    // test went on to query it — "`render` function has not been called". Awaiting it removes the
    // race outright.
    const { getByText } = await render(<ExtractingScreen />);

    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);

    // What the user actually gets.
    expect(extractedFrameCount()).toBe(cap);
    // The bug, named: this number used to collapse to ONE frame (Free's cap at the time; Free is
    // Pro's 5-frame burst since #89) for every paying tier.
    expect(extractedFrameCount()).not.toBe(1);
    // ...and what the caption promises, which must be the same number. These were two independent
    // reads of one hardcoded constant before the fix; now they are one value used twice.
    expect(getByText(Copy.upload.step.extracting(0, cap))).toBeTruthy();
  });

  // Issue #89 (2026-09-19): Free video extracts Pro's 5-frame stride burst, so Cadence and
  // Elasticity can be scored on the free trial. The screen still reads the number off the server.
  it('extracts a free caller\'s full stride burst (5 frames), not a single frame', async () => {
    mockQuotaFetch.mockResolvedValue(quotaResult('free', PACE_FRAME_CAP.free));

    const { getByText } = await render(<ExtractingScreen />);

    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);

    expect(extractedFrameCount()).toBe(5);
    expect(extractedFrameCount()).toBe(PACE_FRAME_CAP.pro);
    expect(getByText(Copy.upload.step.extracting(0, 5))).toBeTruthy();
  });

  it('still extracts exactly one frame from a PHOTO, on the free tier, with no dependence on the cap', async () => {
    mockRouteParams = { ...PHOTO_PARAMS };
    mockQuotaFetch.mockResolvedValue(quotaResult('free', PACE_FRAME_CAP.free));

    const { getByText } = await render(<ExtractingScreen />);

    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);

    expect(extractedFrameCount()).toBe(1);
    expect(getByText(Copy.upload.step.extracting(0, 1))).toBeTruthy();
  });

  // The deliberate, visible fallback. Falling back to free on failure is the accepted behavior —
  // what must never happen is falling back to something HIGHER than free on an error that tells us
  // nothing about the caller's entitlement.
  it.each(['unauthorized', 'quota_status_unavailable', 'unknown'] as const)(
    'falls back to the free cap when the quota lookup fails with %s',
    async (code) => {
      mockQuotaFetch.mockResolvedValue({ ok: false, error: { error: `simulated ${code}`, code } });

      const { getByText } = await render(<ExtractingScreen />);

      await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);

      expect(extractedFrameCount()).toBe(PACE_FRAME_CAP.free);
      expect(getByText(Copy.upload.step.extracting(0, PACE_FRAME_CAP.free))).toBeTruthy();
    }
  );

  // Until the cap is known there is no honest total to display, so the screen must not invent one.
  // A caption reading "0 / 1" here would be the old bug's exact lie, just briefer.
  it('shows no frame-count caption while the cap is still being resolved', async () => {
    let releaseQuota: (result: QuotaStatusResult) => void = () => {};
    mockQuotaFetch.mockReturnValue(
      new Promise<QuotaStatusResult>((resolve) => {
        releaseQuota = resolve;
      })
    );

    await render(<ExtractingScreen />);

    // Nothing has been extracted, and no total is claimed for any tier.
    expect(mockExtractFrames).not.toHaveBeenCalled();
    for (const cap of [PACE_FRAME_CAP.free, PACE_FRAME_CAP.pro, PACE_FRAME_CAP.elite]) {
      expect(screen.queryByText(Copy.upload.step.extracting(0, cap))).toBeNull();
    }

    releaseQuota(quotaResult('elite', PACE_FRAME_CAP.elite));

    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);
    expect(extractedFrameCount()).toBe(PACE_FRAME_CAP.elite);
  });
});

describe('ExtractingScreen — the in-app recording path (app/capture/record.tsx)', () => {
  beforeEach(() => {
    mockQuotaFetch.mockResolvedValue(quotaResult('elite', PACE_FRAME_CAP.elite));
  });

  // THE record-path regression lock. `record.tsx` gives `recordAsync` a `maxDuration` of exactly
  // MAX_CLIP_DURATION_MS, so a full-length recording is exactly that many milliseconds of media —
  // and it used to report a plain wall-clock span from the record tap to `recordAsync` resolving,
  // which brackets the clip with camera start-up at the head and file finalization at the tail and
  // so always read OVER the cap. This screen's pre-flight `checkMediaCaps` then rejected it as
  // `clipTooLong`: the app refusing the longest clip its own recorder had just produced, and
  // refusing it precisely on the recordings with the most motion to analyze. `record.tsx` now
  // measures through `lib/recorded-clip-duration.ts`, which clamps to that same guarantee.
  it('extracts a full-length recording instead of rejecting it as too long', async () => {
    mockRouteParams = { ...VIDEO_PARAMS, durationMs: String(MAX_CLIP_DURATION_MS) };

    await render(<ExtractingScreen />);

    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);
    expect(extractedFrameCount()).toBe(PACE_FRAME_CAP.elite);
    expect(screen.queryByText(Copy.sourcePicker.error.clipTooLong.title)).toBeNull();
  });

  // The value `record.tsx` used to hand over for that same clip. Kept as a companion to the case
  // above so the lock names the bug rather than just asserting the happy path: the cap check here
  // is real and correct, which is exactly why the measurement upstream has to be.
  it('still rejects a clip genuinely longer than the cap', async () => {
    mockRouteParams = { ...VIDEO_PARAMS, durationMs: String(MAX_CLIP_DURATION_MS + 400) };

    await render(<ExtractingScreen />);

    await waitFor(() => expect(screen.getByText(Copy.sourcePicker.error.clipTooLong.title)).toBeTruthy(), WAIT);
    expect(mockExtractFrames).not.toHaveBeenCalled();
  });
});

describe('ExtractingScreen — every extracted frame reaches the analysis step', () => {
  /** A resolved multi-frame set, as `extractFrames` returns for a paying caller's video. */
  function frameSetOf(count: number): PaceFrameSet {
    const frames = Array.from({ length: count }, (_, i) => ({
      base64: `frame-${i}-base64`,
      timestampMs: 500 + i * 1_000,
    }));
    return { frames, totalBytes: frames.length * 16 };
  }

  afterEach(() => {
    // Restore the file-wide never-resolving implementation every other case here depends on —
    // `jest.clearAllMocks()` clears calls, not implementations.
    mockExtractFrames.mockImplementation(() => new Promise(() => {}));
    takePendingAnalyzeFormRequest();
  });

  // The complement to the frame-cap cases above, which prove how many frames are ASKED for. This
  // proves how many survive the handoff: the screen stages an `AnalyzeFormRequest` on
  // `lib/analyze-form.ts`'s one-shot mailbox for `/analyzing` to send, and nothing else covers
  // that seam. A truncation there — sending `frames[0]`, dropping the timestamps, capping the
  // arrays — would look exactly like the extraction bug it isn't: the user is told N frames were
  // extracted and the model is shown one, so Cadence and Elasticity silently lose their evidence.
  it('stages every frame and timestamp, not just the first', async () => {
    const frameSet = frameSetOf(PACE_FRAME_CAP.elite);
    mockRouteParams = { ...VIDEO_PARAMS };
    mockQuotaFetch.mockResolvedValue(quotaResult('elite', PACE_FRAME_CAP.elite));
    mockExtractFrames.mockImplementation(async () => frameSet);

    const { getByText } = await render(<ExtractingScreen />);

    await waitFor(() => expect(getByText(Copy.upload.ready.cta)).toBeTruthy(), WAIT);
    expect(getByText(Copy.upload.ready.body(PACE_FRAME_CAP.elite))).toBeTruthy();

    fireEvent.press(getByText(Copy.upload.ready.cta));

    const staged = takePendingAnalyzeFormRequest();
    expect(staged).not.toBeNull();
    expect(staged?.mediaType).toBe('video');
    expect(staged?.frames).toEqual(frameSet.frames.map((frame) => frame.base64));
    expect(staged?.timestamps).toEqual(frameSet.frames.map((frame) => frame.timestampMs));
  });
});

describe('ExtractingScreen — a photo is always one frame, whatever quota says', () => {
  // The photo path now DOES take the pre-flight read (its eligibility depends on it — see the
  // gate block below), but its frame COUNT still must not: a photo is exactly one frame at every
  // tier, so an Elite reading must not turn it into eight, and a failed reading must not change
  // it either. That independence is the property this case exists to hold.
  it('extracts one frame even on an Elite reading', async () => {
    mockQuotaFetch.mockResolvedValue(quotaResult('elite', PACE_FRAME_CAP.elite));

    const { getByText } = await render(<ExtractingScreen />);

    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);

    expect(extractedFrameCount()).toBe(1);
    expect(getByText(Copy.upload.step.extracting(0, 1))).toBeTruthy();
  });

  it('extracts one frame when the quota lookup fails outright', async () => {
    mockQuotaFetch.mockResolvedValue({ ok: false, error: { error: 'simulated', code: 'unknown' } });

    await render(<ExtractingScreen />);

    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);
    expect(extractedFrameCount()).toBe(1);
  });
});

describe('ExtractingScreen — a clip that can never be analyzed says so, instead of offering a dead Retry', () => {
  beforeEach(() => {
    mockRouteParams = { ...VIDEO_PARAMS };
    mockQuotaFetch.mockResolvedValue(quotaResult('elite', PACE_FRAME_CAP.elite));
  });

  // `lib/frames.ts` rejects low-frame-rate footage with `InsufficientFramesError` only after
  // skipping every colliding frame — meaning the pipeline is deterministic for that clip and a
  // second run collides identically. Offering "Retry" there is a lie, so this state gets its own
  // copy and only a way back, the same shape as the budgetExceeded case.
  it('routes InsufficientFramesError to its own copy with no Retry control', async () => {
    mockExtractFrames.mockRejectedValueOnce(new InsufficientFramesError(2, PACE_FRAME_CAP.elite));

    const { getByText, queryByText } = await render(<ExtractingScreen />);

    await waitFor(() => expect(getByText(Copy.upload.error.unsupportedFootage.title)).toBeTruthy(), WAIT);
    expect(getByText(Copy.upload.error.unsupportedFootage.body)).toBeTruthy();
    expect(queryByText('Retry')).toBeNull();
    expect(getByText('Back')).toBeTruthy();
  });

  // The contrast case, and the reason the InsufficientFramesError check has to come FIRST: it IS
  // a FrameExtractionError, so a plain `instanceof FrameExtractionError` branch would swallow it.
  // A genuine one-off extraction failure keeps the retryable copy AND the Retry control.
  it('still offers Retry for a generic extraction failure', async () => {
    mockExtractFrames.mockRejectedValueOnce(new FrameExtractionError('a corrupt file'));

    const { getByText } = await render(<ExtractingScreen />);

    await waitFor(() => expect(getByText(Copy.upload.error.extractionFailed.title)).toBeTruthy(), WAIT);
    expect(getByText('Retry')).toBeTruthy();
  });
});

describe('ExtractingScreen — the pre-flight gate (no wait burned to be told you were never eligible)', () => {
  /** An expiry a fixed distance ahead of a pinned clock, so the phrase under test is exact. */
  const NOW = Date.parse('2026-09-07T12:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout'] }).setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function cooldownResult(blockedUntil: string | null): QuotaStatusResult {
    return quotaResult('free', PACE_FRAME_CAP.free, {
      blocked: true,
      blockedReason: 'too_many_failed_attempts',
      blockedUntil,
    });
  }

  // THE headline lock for this bug class, on BOTH media paths. Before the gate, a cooling-down
  // runner extracted every frame, submitted, waited, and was then told their analysis had FAILED.
  it.each([
    ['a video', VIDEO_PARAMS],
    ['a photo', PHOTO_PARAMS],
  ] as const)('refuses %s BEFORE any frame is extracted when the server reports a cooldown', async (_label, params) => {
    mockRouteParams = { ...params };
    mockQuotaFetch.mockResolvedValue(cooldownResult(new Date(NOW + 3 * 60 * 60 * 1000).toISOString()));

    const { getByText } = await render(<ExtractingScreen />);

    await waitFor(() => expect(getByText(Copy.analysisPause.title)).toBeTruthy(), WAIT);
    // The whole point: nothing was extracted, so nothing was waited through.
    expect(mockExtractFrames).not.toHaveBeenCalled();
  });

  // Piece 2 of the fix: the copy must name the real reason and the time left, and must not claim
  // anything failed. "failed" appearing anywhere in this panel is the exact regression.
  it('states the time remaining and never says the analysis failed', async () => {
    mockRouteParams = { ...VIDEO_PARAMS };
    mockQuotaFetch.mockResolvedValue(cooldownResult(new Date(NOW + 3 * 60 * 60 * 1000).toISOString()));

    const { getByText, getByTestId } = await render(<ExtractingScreen />);

    await waitFor(() => expect(getByText(Copy.analysisPause.title)).toBeTruthy(), WAIT);
    expect(getByTestId('analysis-paused-body').props.children).toBe(
      Copy.analysisPause.bodyFor('about 3 hours')
    );
    expect(getByText(Copy.analysisPause.title)).toBeTruthy();
    expect(screen.queryByText(Copy.analyzing.error.failed.title)).toBeNull();
    expect(screen.queryByText(Copy.upload.error.extractionFailed.title)).toBeNull();
  });

  // We only ever state a time the server actually gave us. A missing expiry degrades to the
  // no-time-known wording rather than a guess or a zeroed countdown.
  it('falls back to the timeless wording when the server sent no expiry', async () => {
    mockRouteParams = { ...VIDEO_PARAMS };
    mockQuotaFetch.mockResolvedValue(cooldownResult(null));

    const { getByTestId } = await render(<ExtractingScreen />);

    await waitFor(() => expect(getByTestId('analysis-paused-body')).toBeTruthy(), WAIT);
    expect(getByTestId('analysis-paused-body').props.children).toBe(Copy.analysisPause.body);
  });

  // Piece 3: no Retry on a path where retrying cannot succeed. The exit exists and goes Home —
  // picking different footage cannot lift a cooldown.
  it('offers no Retry, only a way home', async () => {
    mockRouteParams = { ...VIDEO_PARAMS };
    mockQuotaFetch.mockResolvedValue(cooldownResult(new Date(NOW + 20 * 60 * 1000).toISOString()));

    const { getByText, queryByText } = await render(<ExtractingScreen />);

    await waitFor(() => expect(getByText(Copy.analysisPause.title)).toBeTruthy(), WAIT);
    expect(queryByText('Retry')).toBeNull();

    fireEvent.press(getByText(Copy.analysisPause.cta));
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });

  // An exhausted allowance is a different refusal with a different honest next step: the paywall,
  // which re-reads live quota and states the real allowance. Still before any extraction.
  it('sends an exhausted caller to the paywall before extracting anything', async () => {
    mockRouteParams = { ...VIDEO_PARAMS };
    mockQuotaFetch.mockResolvedValue(quotaResult('free', PACE_FRAME_CAP.free, { used: 1, remaining: 0 }));

    await render(<ExtractingScreen />);

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/paywall'), WAIT);
    expect(mockExtractFrames).not.toHaveBeenCalled();
  });

  // The pause panel is a TERMINAL refusal, so the screen must stop claiming work is under way.
  // Before this lock the "Preparing your analysis" eyebrow still rendered above it — the runner
  // was told their analysis was being prepared and that analyses were paused at the same time —
  // and it left the screen with two `accessibilityRole="header"` nodes instead of one.
  it('drops the "preparing" heading so the pause is the screen\'s only heading', async () => {
    mockRouteParams = { ...VIDEO_PARAMS };
    mockQuotaFetch.mockResolvedValue(cooldownResult(new Date(NOW + 45 * 60 * 1000).toISOString()));

    const { getByText } = await render(<ExtractingScreen />);

    await waitFor(() => expect(getByText(Copy.analysisPause.title)).toBeTruthy(), WAIT);
    expect(screen.queryByText(Copy.upload.title)).toBeNull();
    expect(screen.getAllByRole('header')).toHaveLength(1);
    expect(getByText(Copy.analysisPause.title).props.accessibilityRole).toBe('header');
  });

  // `accessibilityLiveRegion="polite"` on the panel title is Android-only; `lib/use-announce.ts`
  // is the iOS complement. Without this arm a VoiceOver user heard the wait and then silence
  // while the screen had already become a refusal with a different set of controls.
  it('announces the pause on iOS with the same countdown the panel shows', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'ios';
    try {
      mockRouteParams = { ...VIDEO_PARAMS };
      mockQuotaFetch.mockResolvedValue(cooldownResult(new Date(NOW + 3 * 60 * 60 * 1000).toISOString()));

      const { getByTestId } = await render(<ExtractingScreen />);

      await waitFor(() => expect(getByTestId('analysis-paused-body')).toBeTruthy(), WAIT);
      // The announcement must carry the body actually on screen, not a second, quieter sentence.
      expect(mockAnnounce).toHaveBeenCalledWith(
        `${Copy.analysisPause.title} ${getByTestId('analysis-paused-body').props.children}`
      );
    } finally {
      Platform.OS = originalOS;
    }
  });

  // THE FAIL-OPEN RULE, at the screen. Telling someone they are in a cooldown is a claim about
  // their account; a lookup that failed tells us nothing, so the request must proceed to
  // `reserve_analysis` — the only authority — rather than be refused here on a guess.
  it.each(['unauthorized', 'quota_status_unavailable', 'unknown'] as const)(
    'never fabricates a refusal from a %s lookup failure',
    async (code) => {
      mockRouteParams = { ...VIDEO_PARAMS };
      mockQuotaFetch.mockResolvedValue({ ok: false, error: { error: `simulated ${code}`, code } });

      await render(<ExtractingScreen />);

      await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);
      expect(screen.queryByText(Copy.analysisPause.title)).toBeNull();
      expect(mockRouter.replace).not.toHaveBeenCalledWith('/paywall');
    }
  );
});

describe('ExtractingScreen (issue #147 render-loop regression)', () => {
  it('does not loop when useLocalSearchParams returns a fresh object every render', async () => {
    await render(<ExtractingScreen />);

    // A healthy mount calls useLocalSearchParams a small, bounded number of times (React may
    // render more than once — e.g. StrictMode-style double-invoke, or the initial "extracting"
    // state settling — but never runs away). The old bug called this dozens/hundreds of times
    // before "Maximum update depth exceeded" aborted the render tree; a generous fixed ceiling
    // here fails loudly on any regression of that bug class without being flaky about exactly how
    // many renders React itself performs for an unchanged input.
    expect(renderCount).toBeLessThan(10);
  });

  // The video path added an async cap resolution between mount and extraction — a second chance
  // for the same bug class to reappear, since the resolution completing is itself a state change.
  it('does not loop on the video path, where the cap is resolved asynchronously', async () => {
    mockRouteParams = { ...VIDEO_PARAMS };
    mockQuotaFetch.mockResolvedValue(quotaResult('elite', PACE_FRAME_CAP.elite));

    await render(<ExtractingScreen />);
    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);

    expect(renderCount).toBeLessThan(10);
    // One quota call per mount, not one per render — a loop here would be invisible in the render
    // count alone if the screen also re-fetched, and would hammer the edge function.
    expect(mockQuotaFetch).toHaveBeenCalledTimes(1);
  });
});
