/**
 * Screen-level locks for `app/capture/extracting.tsx` (Preparing; rebuilt 2026-10-06 to the
 * "Preparing & Analysing — V23" page). Bug classes that shipped to users, each kept from the
 * pre-redesign suite:
 *
 * 1. ISSUE #147 — the infinite render loop ("Maximum update depth exceeded") that crashed every
 *    photo/video submission. See the "render-loop" describe block at the bottom.
 *
 * 2. THE PRE-FLIGHT GATE — a capped or cooling-down runner used to extract frames, submit, wait
 *    20-60s, and only then be refused. The gate now runs on ONE bounded `quota-status` read before
 *    any thumbnail work, on the photo path as well as video. Only a refusal the SERVER stated is
 *    honoured — every lookup failure proceeds.
 *
 * 3. THE FRAME-CAP BUG — this screen once hardcoded the free tier, so every paying user's video was
 *    extracted down to one frame. The cap now comes from the server's own `frameCap`. These cases
 *    assert the count `extractFrames` is actually CALLED with, which the pure resolver suite
 *    (`lib/__tests__/extraction-frame-cap.test.ts`) structurally cannot. Only the network call
 *    (`quotaStatusClient.fetch`) is faked; `fetchAnalysisPreflight` and the cap resolver run for real.
 *
 * 4. THE HAND-OFF — every extracted frame and timestamp reaches `/analyzing`'s mailbox, bound to the
 *    signed-in user, under a freshly minted idempotency key, and a session-expired hold from an
 *    earlier analysis is dropped when a new one starts.
 *
 * Then one render per state of the redesign — the screen-driven states where the screen can reach
 * them naturally, and the stateless `PreparingView` where driving the screen there would only add
 * timing noise (an exact 3 h countdown, reduced motion side by side).
 *
 * `extractFrames` never resolves by default (deliberately): for #147 the render count must stay
 * bounded while the screen sits in "extracting", and the frame-cap cases park there with the
 * resolved total on display. Cases that need progress, a result or a failure override it.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactTestRendererJSON } from 'react-test-renderer';

import { Copy } from '@/constants/copy';
import {
  setPendingAnalyzeFormRequest,
  takePendingAnalyzeFormRequest,
  clearPendingAnalyzeFormRequest,
  type AnalyzeFormRequest,
} from '@/lib/analyze-form';
import { checkConnectivity } from '@/lib/connectivity';
import { daysUntil, formatResetDate } from '@/lib/countdown';
import {
  extractFrames,
  FrameExtractionError,
  InsufficientFramesError,
  type FrameExtractionProgress,
  type PaceFrame,
  type PaceFrameSet,
} from '@/lib/frames';
import { MAX_CLIP_DURATION_MS } from '@/lib/media-caps';
import { quotaStatusClient, type QuotaStatus, type QuotaStatusResult } from '@/lib/quota';
import {
  currentResumeGeneration,
  discardResumableAnalysis,
  holdForResume,
  takeResumableAnalysis,
} from '@/lib/resumable-analysis';

import { PACE_FRAME_CAP } from '@shared/pace';

import ExtractingScreen, { PreparingView, type ExtractState, type PreparingViewProps } from '../extracting';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

// `lib/analyze-form.ts` pulls in `lib/supabase.ts`, which builds a client from `EXPO_PUBLIC_*` at
// import time. This screen never touches Supabase itself — it mints a key and stages the request —
// so the module boundary is mocked rather than the env faked.
jest.mock('../../../lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

// The ONLY thing faked on the frame-cap path: the network call itself.
jest.mock('@/lib/quota', () => ({
  quotaStatusClient: { fetch: jest.fn() },
}));

jest.mock('@/lib/connectivity', () => ({ checkConnectivity: jest.fn() }));

let mockUserId: string | null = 'user-a';
jest.mock('@/lib/session-provider', () => ({
  useSession: () => ({ session: mockUserId ? { user: { id: mockUserId } } : null }),
}));

let mockReduceMotion = false;
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => mockReduceMotion }));

let renderCount = 0;

/** Route params the mocked `useLocalSearchParams` will serve. */
let mockRouteParams: Record<string, string> = {};

const PHOTO_PARAMS = {
  mediaType: 'photo',
  uri: 'file:///fake/photo.jpg',
  width: '1080',
  height: '1920',
} as const;

// 10s is comfortably inside `lib/media-caps.ts`'s MAX_CLIP_DURATION_MS (15s).
const VIDEO_PARAMS = {
  mediaType: 'video',
  uri: 'file:///fake/clip.mp4',
  durationMs: '10000',
} as const;

// THE load-bearing mock for #147: a fresh object literal every call, exactly like the real
// `useLocalSearchParams()`. Returning the same cached object here would make the old, buggy
// `useMemo(..., [params])` dependency look correct.
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => {
    renderCount += 1;
    return { ...mockRouteParams };
  },
  useRouter: () => mockRouter,
}));

const mockRouter = { replace: jest.fn(), push: jest.fn() };

// `jest.requireActual('@/lib/frames')` re-executes the real module, whose top-level
// `import ... from 'expo-video'` crashes at import time under Jest without this stub.
jest.mock('expo-video', () => ({
  createVideoPlayer: jest.fn(),
}));

jest.mock('@/lib/frames', () => {
  const actual = jest.requireActual('@/lib/frames');
  return {
    ...actual,
    extractFrames: jest.fn(() => new Promise(() => {})),
  };
});

// The first render in the file pays a one-off module-graph cost that has measured close to
// `waitFor`'s 1s default. These budgets outlast module init; they do not paper over slow asserts.
jest.setTimeout(30_000);
const WAIT = { timeout: 15_000 } as const;

const mockExtractFrames = extractFrames as jest.MockedFunction<typeof extractFrames>;
const mockQuotaFetch = quotaStatusClient.fetch as jest.MockedFunction<typeof quotaStatusClient.fetch>;
const mockCheckConnectivity = checkConnectivity as jest.MockedFunction<typeof checkConnectivity>;

/** A complete, well-formed `QuotaStatus` — every field present. */
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

/** The reading itself, for rendering `PreparingView` directly. */
function quotaReading(
  tier: QuotaStatus['tier'],
  frameCap: number,
  overrides: Partial<QuotaStatus> = {}
): QuotaStatus {
  const result = quotaResult(tier, frameCap, overrides);
  if (!result.ok) throw new Error('unreachable');
  return result.data;
}

function cooldownResult(blockedUntil: string | null): QuotaStatusResult {
  return quotaResult('free', PACE_FRAME_CAP.free, {
    blocked: true,
    blockedReason: 'too_many_failed_attempts',
    blockedUntil,
  });
}

const HIDDEN = { includeHiddenElements: true } as const;

/** Handlers for rendering the stateless `PreparingView` directly. */
const VIEW_HANDLERS = {
  onSourcePicker: jest.fn(),
  onHome: jest.fn(),
  onRetry: jest.fn(),
  onStart: jest.fn(),
  onSeePlans: jest.fn(),
};

/** The big "3/5" numeral. Hidden from the a11y tree (the status line says it in words), so every
 *  query for it needs `includeHiddenElements`. */
function hero() {
  return screen.getByTestId('preparing-hero', HIDDEN);
}

function heroText(current: number, total: number): string {
  return `${current}${Copy.upload.rows.heroOf(total)}`;
}

/** A checklist row's full spoken label: label, value, and its state in words. */
function rowLabel(label: string, value: string, state: 'done' | 'now' | 'todo'): string {
  const word =
    state === 'done' ? Copy.upload.rows.stateDone : state === 'now' ? Copy.upload.rows.stateNow : Copy.upload.rows.stateTodo;
  return `${label}, ${value}, ${word}`;
}

/** The frame count `extractFrames` was actually invoked with. */
function extractedFrameCount(): number {
  expect(mockExtractFrames).toHaveBeenCalledTimes(1);
  return mockExtractFrames.mock.calls[0][1];
}

/** A real-looking frame: plain base64, so `deviceFrameSource` accepts it and the tile draws it. */
function frame(i: number): PaceFrame {
  return { base64: `QUJD${i}RUY=`, timestampMs: 400 * i };
}

function frameSetOf(count: number): PaceFrameSet {
  const frames = Array.from({ length: count }, (_, i) => frame(i));
  return { frames, totalBytes: frames.length * 16 };
}

/** Every string drawn on screen, in tree order — for "nothing says X" and "same content" checks. */
function allText(): string[] {
  const out: string[] = [];
  const walk = (node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null) => {
    if (node === null) return;
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    (node.children ?? []).forEach(walk);
  };
  walk(screen.toJSON() as ReactTestRendererJSON | ReactTestRendererJSON[] | null);
  return out;
}

async function press(node: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => {
    fireEvent.press(node);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  renderCount = 0;
  mockUserId = 'user-a';
  mockReduceMotion = false;
  mockRouteParams = { ...PHOTO_PARAMS };
  // `clearAllMocks` clears calls, not implementations, so every default is re-set per test.
  // `mockReset` (not just `clearAllMocks`) so a `...Once` value a failed case left unconsumed can
  // never leak into the next case.
  mockQuotaFetch.mockReset().mockResolvedValue(quotaResult('free', PACE_FRAME_CAP.free));
  mockCheckConnectivity.mockReset().mockResolvedValue(true);
  mockExtractFrames.mockReset().mockImplementation(() => new Promise(() => {}));
  // Module-level state from the two in-memory mailboxes must not leak between cases.
  clearPendingAnalyzeFormRequest();
  discardResumableAnalysis();
});

// -------------------------------------------------------------------------------------------
// The frame cap
// -------------------------------------------------------------------------------------------

describe('ExtractingScreen — video frame cap comes from the server (the paid-tier bug)', () => {
  beforeEach(() => {
    mockRouteParams = { ...VIDEO_PARAMS };
  });

  // THE headline regression lock. Before the fix every paying tier extracted 1 frame.
  it.each([
    ['free', PACE_FRAME_CAP.free, 5],
    ['pro', PACE_FRAME_CAP.pro, 5],
    ['elite', PACE_FRAME_CAP.elite, 8],
  ] as const)("extracts a %s caller's full %i frames, and shows that same total", async (tier, cap, expected) => {
    mockQuotaFetch.mockResolvedValue(quotaResult(tier, cap));

    await render(<ExtractingScreen />);
    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);

    // What the user actually gets...
    expect(extractedFrameCount()).toBe(expected);
    // ...and what the screen promises, which must be the same number.
    expect(hero()).toHaveTextContent(heroText(1, expected), { exact: true });
    expect(screen.getByText(Copy.upload.status.extracting(1, expected))).toBeTruthy();
  });

  // Falling back to free on failure is accepted; falling back to anything HIGHER is the bug.
  it.each(['unauthorized', 'quota_status_unavailable', 'unknown'] as const)(
    'falls back to the free cap — and fabricates no refusal — when the lookup fails with %s',
    async (code) => {
      mockQuotaFetch.mockResolvedValue({ ok: false, error: { error: `simulated ${code}`, code } });

      await render(<ExtractingScreen />);
      await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);

      expect(extractedFrameCount()).toBe(PACE_FRAME_CAP.free);
      expect(screen.getByText(Copy.upload.status.extracting(1, PACE_FRAME_CAP.free))).toBeTruthy();
      expect(screen.queryByTestId('preparing-stop-paused')).toBeNull();
      expect(screen.queryByTestId('preparing-stop-quota')).toBeNull();
      expect(mockRouter.replace).not.toHaveBeenCalled();
    }
  );

  // A reading that failed open stated no number, so the quota row must not name one.
  it('names no remaining count when the lookup failed open', async () => {
    mockQuotaFetch.mockResolvedValue({ ok: false, error: { error: 'simulated', code: 'unknown' } });

    await render(<ExtractingScreen />);
    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);

    expect(screen.getByTestId('preparing-checklist-quota').props.accessibilityLabel).toBe(
      rowLabel(Copy.upload.rows.quotaChecked, Copy.upload.rows.none, 'done')
    );
  });

  it("names the server's own remaining count when it stated one", async () => {
    mockQuotaFetch.mockResolvedValue(quotaResult('pro', PACE_FRAME_CAP.pro, { used: 6, remaining: 4 }));

    await render(<ExtractingScreen />);
    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);

    expect(screen.getByTestId('preparing-checklist-quota').props.accessibilityLabel).toBe(
      rowLabel(Copy.upload.rows.quotaChecked, Copy.upload.rows.quotaLeft(4), 'done')
    );
  });

  // Until the cap is known there is no honest total, so the screen must not invent one.
  it('names no frame count while the pre-flight is still pending', async () => {
    let releaseQuota: (result: QuotaStatusResult) => void = () => {};
    mockQuotaFetch.mockReturnValue(
      new Promise<QuotaStatusResult>((resolve) => {
        releaseQuota = resolve;
      })
    );

    await render(<ExtractingScreen />);
    await waitFor(() => expect(mockQuotaFetch).toHaveBeenCalledTimes(1), WAIT);

    expect(mockExtractFrames).not.toHaveBeenCalled();
    expect(screen.getByTestId('preparing-status')).toHaveTextContent(Copy.upload.status.checking);
    expect(screen.queryByTestId('preparing-hero', HIDDEN)).toBeNull();
    expect(screen.queryByTestId('preparing-segments')).toBeNull();
    expect(screen.queryByTestId('preparing-strip')).toBeNull();
    // The badge names the media only — no tier, no count.
    expect(screen.getByTestId('preparing-badge')).toHaveTextContent(Copy.upload.badge.video, { exact: true });
    for (const cap of [PACE_FRAME_CAP.free, PACE_FRAME_CAP.elite]) {
      expect(screen.queryByText(Copy.upload.status.extracting(1, cap))).toBeNull();
      expect(screen.queryByText(Copy.upload.badge.frames(cap), { exact: false })).toBeNull();
    }

    await act(async () => {
      releaseQuota(quotaResult('elite', PACE_FRAME_CAP.elite));
    });

    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);
    expect(extractedFrameCount()).toBe(PACE_FRAME_CAP.elite);
  });
});

describe('ExtractingScreen — a photo is always one frame, whatever quota says', () => {
  // A photo takes the pre-flight (its ELIGIBILITY depends on it), but its frame COUNT must not.
  it('extracts one frame even on an Elite reading', async () => {
    mockQuotaFetch.mockResolvedValue(quotaResult('elite', PACE_FRAME_CAP.elite));

    await render(<ExtractingScreen />);
    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);

    expect(extractedFrameCount()).toBe(1);
    expect(hero()).toHaveTextContent(heroText(1, 1), { exact: true });
    expect(screen.getByTestId('preparing-badge')).toHaveTextContent(Copy.upload.badge.photo, { exact: true });
  });

  it('extracts one frame when the quota lookup fails outright', async () => {
    mockQuotaFetch.mockResolvedValue({ ok: false, error: { error: 'simulated', code: 'unknown' } });

    await render(<ExtractingScreen />);
    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);

    expect(extractedFrameCount()).toBe(1);
  });
});

describe('ExtractingScreen — the in-app recording path (app/capture/record.tsx)', () => {
  beforeEach(() => {
    mockQuotaFetch.mockResolvedValue(quotaResult('elite', PACE_FRAME_CAP.elite));
  });

  // `record.tsx` hands over a clip of exactly MAX_CLIP_DURATION_MS for a full-length recording; it
  // used to report a wall-clock span that always read OVER the cap, and this screen rejected it.
  it('extracts a full-length recording instead of rejecting it as too long', async () => {
    mockRouteParams = { ...VIDEO_PARAMS, durationMs: String(MAX_CLIP_DURATION_MS) };

    await render(<ExtractingScreen />);
    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);

    expect(extractedFrameCount()).toBe(PACE_FRAME_CAP.elite);
    expect(screen.queryByText(Copy.sourcePicker.error.clipTooLong.title)).toBeNull();
  });

  it('rejects a clip genuinely longer than the cap with its own copy, before any network or extraction', async () => {
    mockRouteParams = { ...VIDEO_PARAMS, durationMs: String(MAX_CLIP_DURATION_MS + 400) };

    await render(<ExtractingScreen />);

    await waitFor(() => expect(screen.getByTestId('preparing-stop-clipTooLong')).toBeTruthy(), WAIT);
    expect(screen.getByRole('header', { name: Copy.sourcePicker.error.clipTooLong.title })).toBeTruthy();
    expect(screen.getByText(Copy.sourcePicker.error.clipTooLong.body)).toBeTruthy();
    expect(screen.getByText(Copy.upload.error.clipTooLong.eyebrow)).toBeTruthy();
    // Deterministic for this clip: no Retry, a way to pick another.
    expect(screen.queryByTestId('preparing-retry')).toBeNull();
    expect(screen.getByTestId('preparing-choose-another')).toHaveTextContent(Copy.upload.cta.chooseVideo);
    expect(mockExtractFrames).not.toHaveBeenCalled();
    expect(mockQuotaFetch).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------------------------------
// The hand-off to /analyzing
// -------------------------------------------------------------------------------------------

describe('ExtractingScreen — every extracted frame reaches the analysis step', () => {
  async function renderReady(count: number) {
    const frameSet = frameSetOf(count);
    mockRouteParams = { ...VIDEO_PARAMS };
    mockQuotaFetch.mockResolvedValue(quotaResult('elite', PACE_FRAME_CAP.elite));
    mockExtractFrames.mockImplementation(async () => frameSet);

    await render(<ExtractingScreen />);
    await waitFor(() => expect(screen.getByTestId('preparing-start')).toBeTruthy(), WAIT);
    return frameSet;
  }

  // A truncation at this seam — sending `frames[0]`, dropping the timestamps — would look exactly
  // like the extraction bug it isn't: the runner is told N frames and the model is shown one.
  it('stages every frame and timestamp for the signed-in user, not just the first', async () => {
    const frameSet = await renderReady(PACE_FRAME_CAP.elite);
    expect(screen.getByText(Copy.upload.status.readyVideo(PACE_FRAME_CAP.elite))).toBeTruthy();

    await press(screen.getByTestId('preparing-start'));

    const staged = takePendingAnalyzeFormRequest('user-a');
    expect(staged).not.toBeNull();
    expect(staged?.mediaType).toBe('video');
    expect(staged?.frames).toEqual(frameSet.frames.map((f) => f.base64));
    expect(staged?.timestamps).toEqual(frameSet.frames.map((f) => f.timestampMs));
  });

  it('binds the staged request to the signed-in user, so another account cannot take it', async () => {
    await renderReady(PACE_FRAME_CAP.elite);

    await press(screen.getByTestId('preparing-start'));

    expect(takePendingAnalyzeFormRequest('user-b')).toBeNull();
    // ...and the refused take dropped it, so the right user cannot pick it up later either.
    expect(takePendingAnalyzeFormRequest('user-a')).toBeNull();
  });

  it('Start analysis mints a fresh idempotency key, discards any resumable hold, and replaces to /analyzing', async () => {
    const earlier: AnalyzeFormRequest = {
      mediaType: 'video',
      frames: ['T0xE'],
      timestamps: [0],
      idempotencyKey: 'earlier-key',
    };
    holdForResume(earlier, 'user-a', currentResumeGeneration());
    // The earlier analysis was also left in the mailbox: it must be replaced, not reused.
    setPendingAnalyzeFormRequest(earlier, 'user-a');

    await renderReady(5);
    await press(screen.getByTestId('preparing-start'));

    const staged = takePendingAnalyzeFormRequest('user-a');
    expect(staged?.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(staged?.idempotencyKey).not.toBe('earlier-key');
    expect(takeResumableAnalysis('user-a')).toBeNull();
    expect(mockRouter.replace).toHaveBeenCalledWith('/analyzing');
  });

  it('mints a different key for each new analysis', async () => {
    await renderReady(5);
    await press(screen.getByTestId('preparing-start'));
    const first = takePendingAnalyzeFormRequest('user-a');
    await screen.unmount();

    await renderReady(5);
    await press(screen.getByTestId('preparing-start'));
    const second = takePendingAnalyzeFormRequest('user-a');

    expect(first?.idempotencyKey).toBeTruthy();
    expect(second?.idempotencyKey).toBeTruthy();
    expect(second?.idempotencyKey).not.toBe(first?.idempotencyKey);
  });

  it('renders the ready state: every row done, the full count, Start and Cancel', async () => {
    await renderReady(5);

    expect(hero()).toHaveTextContent(heroText(5, 5), { exact: true });
    expect(screen.getByTestId('preparing-status')).toHaveTextContent(Copy.upload.status.readyVideo(5));
    for (const key of ['quota', 'frames', 'ready'] as const) {
      expect(screen.getByTestId(`preparing-checklist-${key}`).props.accessibilityState).toEqual({ busy: false });
    }
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByTestId(`preparing-tile-${i}-frame`).props.accessibilityLabel).toBe(
        Copy.upload.frame.label(i, 5)
      );
    }
    expect(screen.getByTestId('preparing-cancel')).toHaveTextContent(Copy.upload.cta.cancel);
    expect(screen.queryByTestId('preparing-not-counted')).toBeNull();

    await press(screen.getByTestId('preparing-cancel'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/capture');
  });
});

// -------------------------------------------------------------------------------------------
// The working states
// -------------------------------------------------------------------------------------------

describe('ExtractingScreen — the working states', () => {
  it('checking: the pre-flight row is in progress and nothing else has started', async () => {
    mockRouteParams = { ...VIDEO_PARAMS };
    mockQuotaFetch.mockReturnValue(new Promise(() => {}));

    await render(<ExtractingScreen />);
    await waitFor(() => expect(mockQuotaFetch).toHaveBeenCalledTimes(1), WAIT);

    expect(screen.getByRole('header', { name: Copy.upload.eyebrow.video })).toBeTruthy();
    expect(screen.getByTestId('preparing-checklist-quota').props.accessibilityLabel).toBe(
      rowLabel(Copy.upload.rows.quotaChecking, Copy.upload.rows.none, 'now')
    );
    expect(screen.getByTestId('preparing-checklist-frames').props.accessibilityLabel).toBe(
      rowLabel(Copy.upload.rows.extracting, Copy.upload.rows.none, 'todo')
    );
    expect(screen.getByTestId('preparing-checklist-quota').props.accessibilityState).toEqual({ busy: true });
    expect(screen.getByTestId('preparing-checklist-frames').props.accessibilityState).toEqual({ busy: false });
    expect(screen.queryByTestId('preparing-start')).toBeNull();
    expect(screen.getByTestId('preparing-cancel')).toBeTruthy();
  });

  it('extracting a video, 3 of 5: hero, status, segments, and the real frames landing in the strip', async () => {
    mockRouteParams = { ...VIDEO_PARAMS };
    let progress: FrameExtractionProgress | undefined;
    mockExtractFrames.mockImplementation((_input, _count, onProgress) => {
      progress = onProgress;
      return new Promise(() => {});
    });

    await render(<ExtractingScreen />);
    await waitFor(() => expect(progress).toBeDefined(), WAIT);

    await act(async () => {
      progress?.(1, 5, frame(0));
      progress?.(2, 5, frame(1));
    });

    expect(hero()).toHaveTextContent(heroText(3, 5), { exact: true });
    expect(hero().props.accessibilityElementsHidden).toBe(true);
    expect(screen.getByTestId('preparing-status')).toHaveTextContent(Copy.upload.status.extracting(3, 5));
    expect(screen.getByTestId('preparing-segments').children).toHaveLength(5);
    expect(screen.getByTestId('preparing-badge')).toHaveTextContent('Video · 5 frames', { exact: true });
    expect(screen.getByTestId('preparing-checklist-frames').props.accessibilityLabel).toBe(
      rowLabel(Copy.upload.rows.extracting, Copy.upload.rows.progress(3, 5), 'now')
    );

    // Five tiles; the first two draw the frames reported through onProgress — the runner's own.
    for (let i = 1; i <= 5; i++) expect(screen.getByTestId(`preparing-tile-${i}`)).toBeTruthy();
    for (const i of [1, 2]) {
      const tileFrame = screen.getByTestId(`preparing-tile-${i}-frame`);
      expect(tileFrame.props.accessibilityLabel).toBe(`Frame ${i} of 5`);
      expect(screen.getByTestId(`preparing-tile-${i}-frame-image`).props.source).toEqual([
        { uri: `data:image/jpeg;base64,${frame(i - 1).base64}` },
      ]);
    }
    // The pending tiles say so, and draw nothing.
    for (const i of [3, 4, 5]) {
      expect(screen.queryByTestId(`preparing-tile-${i}-frame`)).toBeNull();
      expect(screen.getByTestId(`preparing-tile-${i}`).props.accessibilityLabel).toBe(
        Copy.upload.frame.pending(i, 5)
      );
    }
    expect(screen.getByTestId('preparing-tile-4').props.accessibilityLabel).toBe('Frame 4 of 5, not extracted yet');
  });

  // `lib/frames.ts` reports a collision as a step with `frame: null`. That tile must say it was
  // skipped — not "not extracted yet" — and the final set (one short) must be what the ready state
  // counts, so the runner is never told five frames are ready when four are.
  it('a skipped step is labelled as skipped, and ready counts the frames actually extracted (4/4)', async () => {
    mockRouteParams = { ...VIDEO_PARAMS };
    let progress: FrameExtractionProgress | undefined;
    let finish: (set: PaceFrameSet) => void = () => {};
    mockExtractFrames.mockImplementation((_input, _count, onProgress) => {
      progress = onProgress;
      return new Promise<PaceFrameSet>((resolve) => {
        finish = resolve;
      });
    });

    await render(<ExtractingScreen />);
    await waitFor(() => expect(progress).toBeDefined(), WAIT);
    expect(extractedFrameCount()).toBe(5);

    await act(async () => {
      progress?.(1, 5, frame(0));
      progress?.(2, 5, null);
    });

    expect(screen.getByTestId('preparing-tile-1-frame').props.accessibilityLabel).toBe(Copy.upload.frame.label(1, 5));
    expect(screen.queryByTestId('preparing-tile-2-frame')).toBeNull();
    expect(screen.getByTestId('preparing-tile-2').props.accessibilityLabel).toBe(Copy.upload.frame.skipped(2, 5));
    expect(screen.getByTestId('preparing-tile-3').props.accessibilityLabel).toBe(Copy.upload.frame.pending(3, 5));

    await act(async () => {
      finish({ frames: [frame(0), frame(2), frame(3), frame(4)], totalBytes: 64 });
    });

    await waitFor(() => expect(screen.getByTestId('preparing-start')).toBeTruthy(), WAIT);
    expect(hero()).toHaveTextContent(heroText(4, 4), { exact: true });
    expect(screen.getByTestId('preparing-status')).toHaveTextContent(Copy.upload.status.readyVideo(4));
    expect(screen.getByTestId('preparing-badge')).toHaveTextContent('Video · 4 frames', { exact: true });
    expect(screen.queryByTestId('preparing-tile-5', HIDDEN)).toBeNull();
    for (let i = 1; i <= 4; i++) {
      expect(screen.getByTestId(`preparing-tile-${i}-frame`).props.accessibilityLabel).toBe(Copy.upload.frame.label(i, 4));
    }

    // What is staged is exactly those four, in order.
    await press(screen.getByTestId('preparing-start'));
    const staged = takePendingAnalyzeFormRequest('user-a');
    expect(staged?.frames).toEqual([frame(0), frame(2), frame(3), frame(4)].map((f) => f.base64));
  });

  it('Elite badge: "Video · Elite · 8 frames"', async () => {
    mockRouteParams = { ...VIDEO_PARAMS };
    mockQuotaFetch.mockResolvedValue(quotaResult('elite', PACE_FRAME_CAP.elite));

    await render(<ExtractingScreen />);
    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);

    // The badge is uppercase-STYLED; the source string is what a screen reader reads.
    expect(screen.getByTestId('preparing-badge')).toHaveTextContent('Video · Elite · 8 frames', { exact: true });
    expect(screen.getByTestId('preparing-strip').children).toHaveLength(8);
  });

  it('photo: its own eyebrow, status and row, one tile in a three-column strip', async () => {
    mockRouteParams = { ...PHOTO_PARAMS };

    await render(<ExtractingScreen />);
    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);

    expect(screen.getByRole('header', { name: Copy.upload.eyebrow.photo })).toBeTruthy();
    expect(screen.getByTestId('preparing-status')).toHaveTextContent(Copy.upload.status.photo);
    expect(screen.getByTestId('preparing-checklist-frames').props.accessibilityLabel).toBe(
      rowLabel(Copy.upload.rows.loadingPhoto, Copy.upload.rows.progress(1, 1), 'now')
    );
    expect(screen.getByTestId('preparing-tile-1').props.accessibilityLabel).toBe(Copy.upload.frame.pending(1, 1));
    expect(screen.queryByTestId('preparing-tile-2')).toBeNull();
    expect(screen.getByTestId('preparing-strip').children).toHaveLength(3);
  });

  it('photo ready: the photo copy and no timestamp caption', async () => {
    mockRouteParams = { ...PHOTO_PARAMS };
    mockExtractFrames.mockImplementation(async () => frameSetOf(1));

    await render(<ExtractingScreen />);
    await waitFor(() => expect(screen.getByTestId('preparing-start')).toBeTruthy(), WAIT);

    expect(screen.getByTestId('preparing-status')).toHaveTextContent(Copy.upload.status.readyPhoto);
    expect(screen.queryByText(Copy.upload.frame.timestamp(0), HIDDEN)).toBeNull();
  });
});

// -------------------------------------------------------------------------------------------
// The stop states
// -------------------------------------------------------------------------------------------

describe('ExtractingScreen — out of analyses (the pre-flight found the allowance used up)', () => {
  beforeEach(() => {
    mockRouteParams = { ...VIDEO_PARAMS };
  });

  it('PAID: used / limit and the reset date, See plans opens the paywall, nothing extracted', async () => {
    // 10.5 days ahead, so the whole-day count cannot tick over while the test runs.
    const periodEnd = new Date(Date.now() + 10.5 * 24 * 60 * 60 * 1000).toISOString();
    mockQuotaFetch.mockResolvedValue(
      quotaResult('pro', PACE_FRAME_CAP.pro, { used: 5, limit: 5, remaining: 0, periodEnd })
    );

    await render(<ExtractingScreen />);
    await waitFor(() => expect(screen.getByTestId('preparing-stop-quota')).toBeTruthy(), WAIT);

    expect(screen.getByRole('header', { name: Copy.upload.quota.title })).toBeTruthy();
    expect(screen.getByText(Copy.upload.quota.eyebrow)).toBeTruthy();
    expect(screen.getByText(Copy.upload.quota.paidBody)).toBeTruthy();
    expect(screen.getByLabelText(`${Copy.upload.quota.used}, 5 / 5`)).toBeTruthy();
    const days = daysUntil(periodEnd);
    expect(days).toBe(11);
    expect(
      screen.getByLabelText(
        `${Copy.upload.quota.resets}, ${Copy.upload.quota.resetValue(formatResetDate(periodEnd) as string, 11)}`
      )
    ).toBeTruthy();
    expect(screen.queryByText(Copy.upload.quota.freePlanValue)).toBeNull();
    // Nothing was reserved or uploaded, but no "not counted" note on a refusal.
    expect(screen.queryByTestId('preparing-not-counted')).toBeNull();
    expect(mockExtractFrames).not.toHaveBeenCalled();
    // The panel is the destination — the paywall opens only when the runner asks for it.
    expect(mockRouter.replace).not.toHaveBeenCalled();

    await press(screen.getByTestId('preparing-see-plans'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/paywall');
    expect(mockExtractFrames).not.toHaveBeenCalled();
  });

  it('FREE (lifetime): the free body, "Free · no reset", and no Resets row', async () => {
    mockQuotaFetch.mockResolvedValue(
      quotaResult('free', PACE_FRAME_CAP.free, { used: 1, limit: 1, remaining: 0, isLifetime: true })
    );

    await render(<ExtractingScreen />);
    await waitFor(() => expect(screen.getByTestId('preparing-stop-quota')).toBeTruthy(), WAIT);

    expect(screen.getByText(Copy.upload.quota.freeBody)).toBeTruthy();
    expect(screen.queryByText(Copy.upload.quota.paidBody)).toBeNull();
    expect(screen.getByLabelText(`${Copy.upload.quota.used}, 1 / 1`)).toBeTruthy();
    expect(screen.getByLabelText(`${Copy.upload.quota.plan}, ${Copy.upload.quota.freePlanValue}`)).toBeTruthy();
    expect(screen.queryByText(Copy.upload.quota.resets)).toBeNull();
    expect(mockExtractFrames).not.toHaveBeenCalled();

    // Back leaves for Home (the header back does the same on a stop state).
    // Two "Back" controls: the header chevron and the panel's own button. Both go Home.
    const backs = screen.getAllByRole('button', { name: Copy.upload.cta.back });
    expect(backs).toHaveLength(2);
    await press(backs[1]);
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });
});

describe('ExtractingScreen — the cooldown pause', () => {
  /** A pinned clock, so the countdown under test is exact. `setTimeout` stays real so `waitFor`
   *  polls in real time; `setInterval` and `Date` are faked so the countdown can be wound. */
  const NOW = Date.parse('2026-09-07T12:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout'] }).setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // THE headline lock for this bug class, on BOTH media paths: refused before any extraction.
  it.each([
    ['a video', VIDEO_PARAMS],
    ['a photo', PHOTO_PARAMS],
  ] as const)('refuses %s BEFORE any frame is extracted when the server reports a cooldown', async (_label, params) => {
    mockRouteParams = { ...params };
    mockQuotaFetch.mockResolvedValue(cooldownResult(new Date(NOW + 3 * 60 * 60 * 1000).toISOString()));

    await render(<ExtractingScreen />);

    await waitFor(() => expect(screen.getByTestId('preparing-stop-paused')).toBeTruthy(), WAIT);
    expect(mockExtractFrames).not.toHaveBeenCalled();
  });

  it('42 s ahead: "00:42", a disabled "Continue in 0:42", then Continue asks the server again', async () => {
    mockRouteParams = { ...VIDEO_PARAMS };
    mockQuotaFetch.mockResolvedValueOnce(cooldownResult(new Date(NOW + 42_000).toISOString()));

    await render(<ExtractingScreen />);
    await waitFor(() => expect(screen.getByTestId('preparing-countdown')).toBeTruthy(), WAIT);

    expect(screen.getByRole('header', { name: Copy.upload.pause.title })).toBeTruthy();
    expect(screen.getByText(Copy.upload.pause.body)).toBeTruthy();
    expect(within(screen.getByTestId('preparing-countdown')).getByText('00:42')).toBeTruthy();
    const waiting = screen.getByTestId('preparing-continue');
    expect(waiting).toHaveTextContent(Copy.upload.pause.continueIn('0:42'));
    expect(waiting.props.accessibilityState).toMatchObject({ disabled: true });

    // A press while disabled must not re-run anything.
    await press(waiting);
    expect(mockQuotaFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(42_000);
    });

    const ready = screen.getByTestId('preparing-continue');
    expect(ready).toHaveTextContent(Copy.upload.pause.continue, { exact: true });
    expect(ready.props.accessibilityState).toMatchObject({ disabled: false });
    expect(within(screen.getByTestId('preparing-countdown')).getByText('00:00')).toBeTruthy();
    // Reaching zero unlocks NOTHING on the client's own clock: still no extraction.
    expect(mockExtractFrames).not.toHaveBeenCalled();

    // The default (allowed) reading answers the second ask.
    await press(ready);
    await waitFor(() => expect(mockQuotaFetch).toHaveBeenCalledTimes(2), WAIT);
    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);
  });

  it('no expiry from the server: no countdown, no Continue — only a way back', async () => {
    mockRouteParams = { ...VIDEO_PARAMS };
    mockQuotaFetch.mockResolvedValue(cooldownResult(null));

    await render(<ExtractingScreen />);
    await waitFor(() => expect(screen.getByTestId('preparing-stop-paused')).toBeTruthy(), WAIT);

    expect(screen.queryByTestId('preparing-countdown')).toBeNull();
    expect(screen.queryByTestId('preparing-continue')).toBeNull();
    expect(screen.queryByText(Copy.upload.cta.retry)).toBeNull();
    const backs = screen.getAllByRole('button', { name: Copy.upload.cta.back });
    expect(backs.length).toBeGreaterThanOrEqual(1);

    await press(backs[backs.length - 1]);
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });

  // The pause is a TERMINAL refusal: no "Preparing your video" heading above it, and nothing on
  // the panel may claim something FAILED — nothing did.
  it('drops the preparing heading and never says anything failed', async () => {
    mockRouteParams = { ...VIDEO_PARAMS };
    mockQuotaFetch.mockResolvedValue(cooldownResult(new Date(NOW + 45 * 60 * 1000).toISOString()));

    await render(<ExtractingScreen />);
    await waitFor(() => expect(screen.getByTestId('preparing-stop-paused')).toBeTruthy(), WAIT);

    expect(screen.queryByText(Copy.upload.eyebrow.video)).toBeNull();
    expect(screen.getAllByRole('header')).toHaveLength(1);
    expect(screen.getByRole('header', { name: Copy.upload.pause.title })).toBeTruthy();
    expect(allText().filter((t) => /fail/i.test(t))).toEqual([]);
    expect(screen.queryByTestId('preparing-not-counted')).toBeNull();
  });
});

describe('PreparingView — the countdown figures', () => {
  function renderPaused(pauseRemaining: number | null) {
    return render(
      <PreparingView
        {...VIEW_HANDLERS}
        state={{ status: 'paused', blockedUntil: pauseRemaining === null ? null : '2026-10-06T15:00:00.000Z' }}
        mediaKind="video"
        quota={null}
        reduceMotion={false}
        pauseRemaining={pauseRemaining}
        pauseStartRemaining={pauseRemaining}
      />
    );
  }

  it('reads hours as H:MM:SS — 3 h 12 m 5 s is "3:12:05"', async () => {
    await renderPaused((3 * 3600 + 12 * 60 + 5) * 1000);

    expect(within(screen.getByTestId('preparing-countdown')).getByText('3:12:05')).toBeTruthy();
    expect(screen.getByTestId('preparing-continue')).toHaveTextContent(Copy.upload.pause.continueIn('3:12:05'));
  });

  it('at 42 000 ms the Continue is disabled; at 0 it is enabled and runs the retry', async () => {
    await renderPaused(42_000);
    expect(screen.getByTestId('preparing-continue').props.accessibilityState).toMatchObject({ disabled: true });
    await press(screen.getByTestId('preparing-continue'));
    expect(VIEW_HANDLERS.onRetry).not.toHaveBeenCalled();
    await screen.unmount();

    await renderPaused(0);
    expect(screen.getByTestId('preparing-continue')).toHaveTextContent(Copy.upload.pause.continue, { exact: true });
    await press(screen.getByTestId('preparing-continue'));
    expect(VIEW_HANDLERS.onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('ExtractingScreen — offline before anything started', () => {
  it('shows the offline state, sends nothing, and Try again re-checks', async () => {
    mockRouteParams = { ...VIDEO_PARAMS };
    mockCheckConnectivity.mockResolvedValueOnce(false);

    await render(<ExtractingScreen />);
    await waitFor(() => expect(screen.getByTestId('preparing-stop-offline')).toBeTruthy(), WAIT);

    expect(screen.getByRole('header', { name: Copy.upload.offline.title })).toBeTruthy();
    expect(screen.getByText(Copy.upload.offline.video)).toBeTruthy();
    expect(screen.getByTestId('preparing-not-counted')).toBeTruthy();
    expect(screen.getByText(Copy.upload.notCounted)).toBeTruthy();
    expect(mockQuotaFetch).not.toHaveBeenCalled();
    expect(mockExtractFrames).not.toHaveBeenCalled();

    await press(screen.getByTestId('preparing-retry'));
    await waitFor(() => expect(mockCheckConnectivity).toHaveBeenCalledTimes(2), WAIT);
    // Back online now: the pre-flight and the extraction run.
    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);
    expect(mockQuotaFetch).toHaveBeenCalledTimes(1);
  });

  it('names the photo when the media is a photo', async () => {
    mockRouteParams = { ...PHOTO_PARAMS };
    mockCheckConnectivity.mockResolvedValue(false);

    await render(<ExtractingScreen />);
    await waitFor(() => expect(screen.getByTestId('preparing-stop-offline')).toBeTruthy(), WAIT);

    expect(screen.getByText(Copy.upload.offline.photo)).toBeTruthy();
  });

  // A connectivity read that cannot answer is not evidence of being offline.
  it('proceeds when the connectivity read itself rejects', async () => {
    mockRouteParams = { ...VIDEO_PARAMS };
    mockCheckConnectivity.mockRejectedValue(new Error('netinfo blew up'));

    await render(<ExtractingScreen />);
    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);
    expect(screen.queryByTestId('preparing-stop-offline')).toBeNull();
  });
});

describe('ExtractingScreen — extraction failures', () => {
  beforeEach(() => {
    mockRouteParams = { ...VIDEO_PARAMS };
    mockQuotaFetch.mockResolvedValue(quotaResult('elite', PACE_FRAME_CAP.elite));
  });

  // InsufficientFramesError is deterministic for the clip: a second run collides identically, so
  // offering a retry there is a lie.
  it('routes InsufficientFramesError to its own copy with no Retry control', async () => {
    mockExtractFrames.mockRejectedValueOnce(new InsufficientFramesError(2, PACE_FRAME_CAP.elite));

    await render(<ExtractingScreen />);
    await waitFor(() => expect(screen.getByTestId('preparing-stop-unsupportedFootage')).toBeTruthy(), WAIT);

    expect(screen.getByRole('header', { name: Copy.upload.error.unsupportedFootage.title })).toBeTruthy();
    expect(screen.getByText(Copy.upload.error.unsupportedFootage.body)).toBeTruthy();
    expect(screen.queryByTestId('preparing-retry')).toBeNull();
    expect(screen.queryByText(Copy.upload.cta.retry)).toBeNull();
    expect(screen.getByTestId('preparing-choose-another')).toHaveTextContent(Copy.upload.cta.chooseVideo);
    expect(screen.getByTestId('preparing-not-counted')).toBeTruthy();

    await press(screen.getByTestId('preparing-choose-another'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/capture');
  });

  // The contrast case, and why the InsufficientFramesError check must come FIRST: it IS a
  // FrameExtractionError. A genuine one-off failure keeps Retry, and Retry re-runs.
  it('offers "Try again" for a generic extraction failure, and it re-runs the extraction', async () => {
    mockExtractFrames.mockRejectedValueOnce(new FrameExtractionError('a corrupt file'));

    await render(<ExtractingScreen />);
    await waitFor(() => expect(screen.getByTestId('preparing-stop-extractionFailed')).toBeTruthy(), WAIT);

    expect(screen.getByRole('header', { name: Copy.upload.error.extractionFailed.titleVideo })).toBeTruthy();
    expect(screen.getByText(Copy.upload.error.extractionFailed.eyebrow)).toBeTruthy();
    expect(screen.getByText(Copy.upload.error.extractionFailed.body)).toBeTruthy();
    expect(screen.getByTestId('preparing-retry')).toHaveTextContent(Copy.upload.cta.retry);
    expect(screen.getByText(Copy.upload.cta.chooseVideo)).toBeTruthy();
    expect(screen.getByTestId('preparing-not-counted')).toBeTruthy();

    await press(screen.getByTestId('preparing-retry'));
    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(2), WAIT);
    expect(screen.queryByTestId('preparing-stop-extractionFailed')).toBeNull();
  });
});

describe('PreparingView — the "not counted" line', () => {
  const base: Omit<PreparingViewProps, 'state' | keyof typeof VIEW_HANDLERS> = {
    mediaKind: 'video',
    quota: null,
    reduceMotion: false,
    pauseRemaining: null,
    pauseStartRemaining: null,
  };

  // Nothing was reserved before a refusal or a failed extraction, so the line is TRUE on errors and
  // offline — and it has no place on a working state or on a refusal panel.
  it.each<[string, ExtractState, boolean]>([
    ['error', { status: 'error', kind: 'extractionFailed' }, true],
    ['budget error', { status: 'error', kind: 'budgetExceeded' }, true],
    ['offline', { status: 'offline' }, true],
    ['paused', { status: 'paused', blockedUntil: null }, false],
    ['exhausted', { status: 'exhausted', quota: null }, false],
    ['preparing', { status: 'preparing' }, false],
    ['extracting', { status: 'extracting', done: 2, total: 5, slots: [frame(0), frame(1)] }, false],
    ['ready', { status: 'ready', frameSet: frameSetOf(5), total: 5 }, false],
  ])('%s -> shown: %s', async (_label, state, shown) => {
    await render(<PreparingView {...base} {...VIEW_HANDLERS} state={state} />);

    if (shown) {
      expect(screen.getByTestId('preparing-not-counted')).toBeTruthy();
      expect(screen.getByLabelText(Copy.upload.notCounted)).toBeTruthy();
    } else {
      expect(screen.queryByTestId('preparing-not-counted')).toBeNull();
    }
  });
});

describe('PreparingView — reduced motion', () => {
  // Reduced motion changes how the pulse moves, never what is on screen.
  it.each<[string, ExtractState]>([
    ['extracting', { status: 'extracting', done: 2, total: 5, slots: [frame(0), frame(1)] }],
    ['preparing', { status: 'preparing' }],
    ['ready', { status: 'ready', frameSet: frameSetOf(5), total: 5 }],
  ])('renders the same content for %s', async (_label, state) => {
    const props = {
      ...VIEW_HANDLERS,
      state,
      mediaKind: 'video' as const,
      quota: quotaReading('pro', PACE_FRAME_CAP.pro, { remaining: 4 }),
      pauseRemaining: null,
      pauseStartRemaining: null,
    };
    /** Every tile's spoken label, so "same content" covers the a11y tree as well as the text. */
    const tileLabels = () =>
      [1, 2, 3, 4, 5].map((i) => {
        const tile = screen.queryByTestId(`preparing-tile-${i}`, HIDDEN);
        const drawn = screen.queryByTestId(`preparing-tile-${i}-frame`, HIDDEN);
        return drawn?.props.accessibilityLabel ?? tile?.props.accessibilityLabel ?? null;
      });

    await render(<PreparingView {...props} reduceMotion={false} />);
    const movingText = allText();
    const movingTiles = tileLabels();
    await screen.unmount();

    await render(<PreparingView {...props} reduceMotion />);
    expect(movingText.length).toBeGreaterThan(0);
    expect(allText()).toEqual(movingText);
    expect(tileLabels()).toEqual(movingTiles);
  });

  it('the screen under reduced motion still shows the real progress', async () => {
    mockReduceMotion = true;
    mockRouteParams = { ...VIDEO_PARAMS };
    let progress: FrameExtractionProgress | undefined;
    mockExtractFrames.mockImplementation((_input, _count, onProgress) => {
      progress = onProgress;
      return new Promise(() => {});
    });

    await render(<ExtractingScreen />);
    await waitFor(() => expect(progress).toBeDefined(), WAIT);
    await act(async () => {
      progress?.(1, 5, frame(0));
    });

    expect(screen.getByTestId('preparing-status')).toHaveTextContent(Copy.upload.status.extracting(2, 5));
    expect(screen.getByTestId('preparing-tile-1-frame').props.accessibilityLabel).toBe('Frame 1 of 5');
  });
});

describe('ExtractingScreen (issue #147 render-loop regression)', () => {
  it('does not loop when useLocalSearchParams returns a fresh object every render', async () => {
    await render(<ExtractingScreen />);
    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);

    // A healthy mount renders a small, bounded number of times; the old bug ran away until React
    // aborted with "Maximum update depth exceeded".
    expect(renderCount).toBeLessThan(10);
  });

  // The video path resolves the cap asynchronously — a second chance for the same bug class.
  it('does not loop on the video path, where the cap is resolved asynchronously', async () => {
    mockRouteParams = { ...VIDEO_PARAMS };
    mockQuotaFetch.mockResolvedValue(quotaResult('elite', PACE_FRAME_CAP.elite));

    await render(<ExtractingScreen />);
    await waitFor(() => expect(mockExtractFrames).toHaveBeenCalledTimes(1), WAIT);

    expect(renderCount).toBeLessThan(10);
    // One pre-flight per mount, not one per render.
    expect(mockQuotaFetch).toHaveBeenCalledTimes(1);
    expect(mockCheckConnectivity).toHaveBeenCalledTimes(1);
  });
});
