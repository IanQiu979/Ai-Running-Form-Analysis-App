/**
 * Screen-level locks for `app/analyzing.tsx` (Analysing; rebuilt 2026-10-06 to the "Preparing &
 * Analysing — V23" page).
 *
 * `lib/__tests__/analyzing-machine.test.ts` covers the reducer, `lib/__tests__/loading-screens.test.ts`
 * the pure display mapping, `lib/__tests__/resumable-analysis.test.ts` the resume hold and
 * `lib/__tests__/analyze-form.test.ts` the client seam — but none of them can see what the screen
 * actually WIRES together: which request it submits and how often, what each failure offers the
 * runner, and — the most important new behaviour — whether a session-expired analysis is kept for
 * resume for the right account, and only while the runner has not walked away.
 *
 * What is real here: the `analyze-form` mailbox (`setPendingAnalyzeFormRequest` /
 * `takePendingAnalyzeFormRequest`), the reducer, the display mapping, and the resume hold. What is
 * faked: the network (`analyzeFormClient.submit`, the foreground resolver, connectivity), the
 * session, the router, the #140 marker store, and `signOut` — whose fake keeps the real module's
 * one rule that matters here (a sign-out WITHOUT `keepResumableAnalysis` drops the hold), so a
 * screen that forgot the flag would visibly lose the frames.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, BackHandler } from 'react-native';

import { Copy } from '@/constants/copy';
import {
  clearPendingAnalyzeFormRequest,
  setPendingAnalyzeFormRequest,
  type AnalyzeFormRequest,
} from '@/lib/analyze-form';
import {
  ANALYZING_LONG_WAIT_DELAY_MS,
  ANALYZING_STEP_FLOOR_MS,
  ANALYZING_STEP_KEYS,
  ANALYZING_TIMEOUT_MS,
} from '@/lib/analyzing-machine';
import { checkConnectivity } from '@/lib/connectivity';
import type { AnalysingStop } from '@/lib/loading-screens';
import {
  currentResumeGeneration,
  discardResumableAnalysis,
  hasResumableAnalysis,
  holdForResume,
  takeResumableAnalysis,
} from '@/lib/resumable-analysis';
import { Motion } from '@/constants/v23-theme';

import AnalyzingScreen, { AnalysingView, type AnalysingViewProps } from '../analyzing';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

const mockReplace = jest.fn();
const mockRedirect = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  // Records where a declarative redirect would have gone, and draws nothing.
  Redirect: ({ href }: { href: unknown }) => {
    mockRedirect(href);
    return null;
  },
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const mockResolveAnalysisRequest = jest.fn();
jest.mock('@/lib/analysis-resolver', () => ({
  resolveAnalysisRequest: (...args: unknown[]) => mockResolveAnalysisRequest(...args),
}));

let mockUserId: string | null = 'user-a';
jest.mock('@/lib/session-provider', () => ({
  useSession: () => ({ session: mockUserId ? { user: { id: mockUserId } } : null }),
}));

let mockReduceMotion = false;
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => mockReduceMotion }));

jest.mock('@/lib/connectivity', () => ({ checkConnectivity: jest.fn() }));

let mockForegroundHandler: (() => void) | null = null;
jest.mock('@/lib/app-state', () => ({
  onAppForeground: (handler: () => void) => {
    mockForegroundHandler = handler;
    return () => {
      mockForegroundHandler = null;
    };
  },
}));

const mockSetPendingAnalysisMarker = jest.fn();
const mockClearPendingAnalysisMarker = jest.fn();
jest.mock('@/lib/pending-analysis', () => ({
  setPendingAnalysisMarker: (...args: unknown[]) => mockSetPendingAnalysisMarker(...args),
  clearPendingAnalysisMarker: (...args: unknown[]) => mockClearPendingAnalysisMarker(...args),
}));

const mockSetPendingAnalysisResult = jest.fn();
jest.mock('@/lib/pending-analysis-result', () => ({
  setPendingAnalysisResult: (...args: unknown[]) => mockSetPendingAnalysisResult(...args),
}));

const mockSignOut = jest.fn();
jest.mock('@/lib/sign-out', () => ({ signOut: (...args: unknown[]) => mockSignOut(...args) }));

const mockSubmit = jest.fn();
jest.mock('@/lib/analyze-form', () => {
  const actual = jest.requireActual('@/lib/analyze-form');
  return {
    ...actual,
    analyzeFormClient: { submit: (...args: unknown[]) => mockSubmit(...args) },
  };
});

jest.setTimeout(30_000);

const HIDDEN = { includeHiddenElements: true } as const;
const mockCheckConnectivity = checkConnectivity as jest.MockedFunction<typeof checkConnectivity>;
const PRO_RESULT = jest.requireActual('@/lib/pace-fixtures').proTierVideoResult;
const ANALYSIS_ID = 'b144d29b-2348-4043-a96b-581ff4af6dbe';

/** When the caption reaches "Still analyzing" — from the machine's own constants. */
const LONG_WAIT_AT_MS = ANALYZING_STEP_KEYS.length * ANALYZING_STEP_FLOOR_MS + ANALYZING_LONG_WAIT_DELAY_MS;

/** Fresh objects per call, so every identity (`toBe`) assertion is meaningful. Plain base64, so
 *  the viewer and tiles actually draw them. */
function videoRequest(key = 'idem-video-1'): AnalyzeFormRequest {
  return {
    mediaType: 'video',
    frames: ['QUFB', 'QkJC', 'Q0ND', 'RERE', 'RUVF'],
    timestamps: [0, 400, 800, 1200, 1600],
    idempotencyKey: key,
  };
}

function photoRequest(): AnalyzeFormRequest {
  return { mediaType: 'photo', frames: ['UEhP'], timestamps: [0], idempotencyKey: 'idem-photo-1' };
}

function failure(code: string, error = `simulated ${code}`, retryAfterSeconds?: number) {
  return { ok: false as const, error: { error, code, retryAfterSeconds } };
}

function success(analysisId = ANALYSIS_ID) {
  return { ok: true as const, data: { analysisId, isFallback: false, result: PRO_RESULT } };
}

/** A submit the test settles by hand. */
function deferredSubmit() {
  let resolve: (value: unknown) => void = () => {};
  mockSubmit.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    })
  );
  return (value: unknown) => resolve(value);
}

async function renderWith(request: AnalyzeFormRequest = videoRequest(), owner = 'user-a') {
  setPendingAnalyzeFormRequest(request, owner);
  await render(<AnalyzingScreen />);
  return request;
}

/** Drains the connectivity -> submit -> dispatch promise chain inside one act. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

async function press(node: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => {
    fireEvent.press(node);
  });
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

let mockHardwareBack: Parameters<typeof BackHandler.addEventListener>[1] | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'user-a';
  mockReduceMotion = false;
  mockForegroundHandler = null;
  mockHardwareBack = null;
  mockSubmit.mockReset().mockReturnValue(new Promise(() => {}));
  mockCheckConnectivity.mockReset().mockResolvedValue(true);
  mockResolveAnalysisRequest.mockReset().mockResolvedValue(null);
  // Keeps the real sign-out's one relevant rule: only `keepResumableAnalysis` keeps the hold.
  mockSignOut.mockReset().mockImplementation(async (options?: { keepResumableAnalysis?: boolean }) => {
    if (!options?.keepResumableAnalysis) discardResumableAnalysis();
    return { ok: true };
  });
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    mockHardwareBack = handler;
    return { remove: jest.fn() };
  });
  // Both in-memory stores are module state: start every case empty.
  clearPendingAnalyzeFormRequest();
  discardResumableAnalysis();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// -------------------------------------------------------------------------------------------
// Submitting
// -------------------------------------------------------------------------------------------

describe('AnalyzingScreen — submitting', () => {
  it('submits the staged request exactly once per attempt, however often it re-renders', async () => {
    jest.useFakeTimers();
    try {
      const request = await renderWith();
      await flush();
      expect(mockSubmit).toHaveBeenCalledTimes(1);
      expect(mockSubmit.mock.calls[0][0]).toBe(request);

      // Caption steps, clock ticks and the viewer's frame cycle all re-render the screen.
      await advance(LONG_WAIT_AT_MS + 5_000);
      expect(mockSubmit).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('Retry re-submits the SAME request object — same idempotency key, same frames', async () => {
    mockSubmit.mockResolvedValueOnce(failure('model_error'));
    const request = await renderWith();

    await waitFor(() => expect(screen.getByTestId('analyzing-stop-failed')).toBeTruthy());
    await press(screen.getByTestId('analyzing-retry'));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(2));

    expect(mockSubmit.mock.calls[1][0]).toBe(request);
    expect(mockSubmit.mock.calls[1][0].idempotencyKey).toBe('idem-video-1');
  });

  it('times out after ANALYZING_TIMEOUT_MS, stops the clock, and Retry re-sends the same request', async () => {
    jest.useFakeTimers();
    try {
      const request = await renderWith();
      await flush();

      await advance(ANALYZING_TIMEOUT_MS - 1);
      expect(screen.queryByTestId('analyzing-stop-timeout')).toBeNull();
      await advance(1);

      expect(screen.getByTestId('analyzing-stop-timeout')).toBeTruthy();
      expect(screen.getByRole('header', { name: Copy.analyzing.error.timeout.title })).toBeTruthy();
      // The clock reads "Stopped at" and stays where it stopped.
      const stopped = screen.getByTestId('analyzing-clock').props.accessibilityLabel;
      expect(stopped).toMatch(new RegExp(`^${Copy.analyzing.clock.stoppedAt} \\d\\d:\\d\\d$`));
      await advance(5_000);
      expect(screen.getByTestId('analyzing-clock').props.accessibilityLabel).toBe(stopped);

      await press(screen.getByTestId('analyzing-retry'));
      await flush();
      expect(mockSubmit).toHaveBeenCalledTimes(2);
      expect(mockSubmit.mock.calls[1][0]).toBe(request);
    } finally {
      jest.useRealTimers();
    }
  });

  // Issue #93: an offline read dispatches before the call, so "nothing was sent" is true.
  it('never submits when offline, and Retry re-checks the connection first', async () => {
    mockCheckConnectivity.mockResolvedValueOnce(false);
    await renderWith();

    await waitFor(() => expect(screen.getByTestId('analyzing-stop-offline')).toBeTruthy());
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('header', { name: Copy.analyzing.error.offline.title })).toBeTruthy();
    expect(screen.getByText(Copy.analyzing.error.offline.video)).toBeTruthy();

    await press(screen.getByTestId('analyzing-retry'));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockCheckConnectivity).toHaveBeenCalledTimes(2);
  });

  // Issue #136: a 402 opens the paywall instead of a Retry into the same exhausted quota.
  it('routes a server quota_exceeded to the paywall and draws no stop panel', async () => {
    mockSubmit.mockResolvedValueOnce(failure('quota_exceeded'));
    await renderWith();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/paywall'));
    expect(screen.queryByTestId('analyzing-stop-headline')).toBeNull();
    expect(screen.queryByTestId('analyzing-retry')).toBeNull();
  });

  it('redirects home without submitting when nothing was staged', async () => {
    await render(<AnalyzingScreen />);

    expect(mockRedirect).toHaveBeenCalledWith('/');
    await flush();
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockSetPendingAnalysisMarker).not.toHaveBeenCalled();
  });

  // The mailbox is bound to the account it was staged for: user-b's frames never go out under
  // user-a's session.
  it('redirects home without submitting when the staged request belongs to another account', async () => {
    await renderWith(videoRequest(), 'user-b');

    expect(mockRedirect).toHaveBeenCalledWith('/');
    await flush();
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------------------------------
// Terminal branches: what each failure offers
// -------------------------------------------------------------------------------------------

describe('AnalyzingScreen — what each failure offers', () => {
  // Retrying a released reservation reuses the key and can only hand back the same released row.
  it('409 previous_attempt_failed -> "Start new analysis", no Retry; it leaves for /capture and drops everything', async () => {
    mockSubmit.mockResolvedValueOnce(failure('previous_attempt_failed'));
    await renderWith();

    await waitFor(() => expect(screen.getByTestId('analyzing-stop-released')).toBeTruthy());
    expect(screen.getByRole('header', { name: Copy.analyzing.error.previousAttemptFailed.title })).toBeTruthy();
    expect(screen.getByText(Copy.analyzing.error.previousAttemptFailed.body)).toBeTruthy();
    expect(screen.queryByTestId('analyzing-retry')).toBeNull();
    expect(screen.queryByText(Copy.analyzing.error.cta.retry)).toBeNull();

    await press(screen.getByTestId('analyzing-start-new'));
    expect(mockReplace).toHaveBeenCalledWith('/capture');
    expect(mockClearPendingAnalysisMarker).toHaveBeenCalledTimes(1);
  });

  it('409 analysis_in_progress -> "Still running" with Retry, which replays the same key', async () => {
    mockSubmit.mockResolvedValueOnce(failure('analysis_in_progress'));
    const request = await renderWith();

    await waitFor(() => expect(screen.getByTestId('analyzing-stop-inProgress')).toBeTruthy());
    expect(screen.getByText(Copy.analyzing.error.inProgress.eyebrow)).toBeTruthy();
    expect(screen.getByRole('header', { name: Copy.analyzing.error.inProgress.title })).toBeTruthy();
    expect(screen.queryByTestId('analyzing-start-new')).toBeNull();

    await press(screen.getByTestId('analyzing-retry'));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(2));
    expect(mockSubmit.mock.calls[1][0]).toBe(request);
  });

  it('410 analysis_deleted -> "Start new analysis", no Retry', async () => {
    mockSubmit.mockResolvedValueOnce(failure('analysis_deleted'));
    await renderWith();

    await waitFor(() => expect(screen.getByTestId('analyzing-stop-deleted')).toBeTruthy());
    expect(screen.getByRole('header', { name: Copy.analyzing.error.deleted.title })).toBeTruthy();
    expect(screen.getByTestId('analyzing-start-new')).toBeTruthy();
    expect(screen.queryByTestId('analyzing-retry')).toBeNull();
  });

  it('still offers Retry for an ordinary failure code', async () => {
    mockSubmit.mockResolvedValueOnce(failure('validation_failed'));
    await renderWith();

    await waitFor(() => expect(screen.getByTestId('analyzing-stop-failed')).toBeTruthy());
    expect(screen.getByTestId('analyzing-retry')).toHaveTextContent(Copy.analyzing.error.cta.retry);
    expect(screen.queryByTestId('analyzing-start-new')).toBeNull();
    expect(screen.getByTestId('analyzing-back')).toBeTruthy();
  });

  // Issue #6's cooldown, reached only when it beat the Preparing pre-flight. Retrying resubmits
  // into the identical refusal, and nothing failed — so one exit and no failure copy.
  it('429 too_many_failed_attempts -> the paused panel with Back to Home as the only action', async () => {
    mockSubmit.mockResolvedValueOnce(failure('too_many_failed_attempts'));
    await renderWith();

    await waitFor(() => expect(screen.getByTestId('analyzing-stop-paused')).toBeTruthy());
    expect(screen.getByRole('header', { name: Copy.analyzing.error.paused.title })).toBeTruthy();
    expect(screen.getByText(Copy.analyzing.error.paused.body)).toBeTruthy();
    expect(screen.queryByText(Copy.analyzing.error.failed.title)).toBeNull();
    expect(screen.queryByTestId('analyzing-retry')).toBeNull();
    expect(screen.queryByTestId('analyzing-start-new')).toBeNull();
    expect(screen.queryByTestId('analyzing-back')).toBeNull();

    await press(screen.getByTestId('analyzing-back-home'));
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  describe('429 zero_pillar_cooldown (review r8-1)', () => {
    it("states the server's own sentence and a clock time, with Back to Home only", async () => {
      mockSubmit.mockResolvedValueOnce(failure('zero_pillar_cooldown', 'Nothing in that last clip could be read.', 900));
      await renderWith();

      await waitFor(() => expect(screen.getByTestId('analyzing-stop-zeroPillarCooldown')).toBeTruthy());
      expect(screen.getByRole('header', { name: Copy.analyzing.error.zeroPillarCooldown.title })).toBeTruthy();
      const body = screen.getByText(/Nothing in that last clip could be read\./);
      expect(body.props.children).toMatch(/^Nothing in that last clip could be read\. Try again at .+\.$/);
      expect(screen.queryByText(Copy.analyzing.error.failed.title)).toBeNull();
      expect(screen.queryByTestId('analyzing-retry')).toBeNull();
      expect(screen.queryByTestId('analyzing-start-new')).toBeNull();

      await press(screen.getByTestId('analyzing-back-home'));
      expect(mockReplace).toHaveBeenCalledWith('/');
      expect(mockSubmit).toHaveBeenCalledTimes(1);
    });

    it('names no time at all when the server sent none', async () => {
      mockSubmit.mockResolvedValueOnce(failure('zero_pillar_cooldown', 'Nothing in that last clip could be read.'));
      await renderWith();

      await waitFor(() => expect(screen.getByText(/Try again in a few minutes\.$/)).toBeTruthy());
    });

    // The panel must never be empty on the one path that has removed Retry and "start new".
    it.each([
      ['an empty sentence', ''],
      ['a whitespace-only sentence', '   '],
    ])('falls back to the local sentence when the server sends %s', async (_label, sentence) => {
      mockSubmit.mockResolvedValueOnce(failure('zero_pillar_cooldown', sentence, 900));
      await renderWith();

      await waitFor(() => expect(screen.getByTestId('analyzing-stop-zeroPillarCooldown')).toBeTruthy());
      const body = screen.getByText(new RegExp(Copy.analyzing.error.zeroPillarCooldown.fallbackMessage));
      expect(body.props.children).toMatch(/Try again at .+\.$/);
      expect(screen.getByTestId('analyzing-back-home')).toBeTruthy();
    });
  });

  // "Not counted against your quota" is drawn only where it is TRUE.
  it.each<[string, () => void, AnalysingStop, boolean]>([
    ['a server-coded failure', () => mockSubmit.mockResolvedValueOnce(failure('model_error')), 'failed', true],
    ['a thrown submit (no code)', () => mockSubmit.mockRejectedValueOnce(new Error('socket hang up')), 'failed', false],
    ["the client's own unknown code", () => mockSubmit.mockResolvedValueOnce(failure('unknown')), 'failed', false],
    ['unauthorized', () => mockSubmit.mockResolvedValueOnce(failure('unauthorized')), 'unauthorized', true],
    ['offline', () => mockCheckConnectivity.mockResolvedValueOnce(false), 'offline', true],
    ['released (409)', () => mockSubmit.mockResolvedValueOnce(failure('previous_attempt_failed')), 'released', true],
    ['paused', () => mockSubmit.mockResolvedValueOnce(failure('too_many_failed_attempts')), 'paused', true],
    ['zero-pillar cooldown', () => mockSubmit.mockResolvedValueOnce(failure('zero_pillar_cooldown', 'x', 60)), 'zeroPillarCooldown', true],
    ['in progress (409)', () => mockSubmit.mockResolvedValueOnce(failure('analysis_in_progress')), 'inProgress', false],
    ['deleted (410)', () => mockSubmit.mockResolvedValueOnce(failure('analysis_deleted')), 'deleted', false],
  ])('"not counted" on %s: %s', async (_label, arrange, stop, shown) => {
    arrange();
    await renderWith();

    await waitFor(() => expect(screen.getByTestId(`analyzing-stop-${stop}`)).toBeTruthy());
    if (shown) {
      expect(screen.getByLabelText(Copy.analyzing.notCounted)).toBeTruthy();
    } else {
      expect(screen.queryByTestId('analyzing-not-counted')).toBeNull();
      expect(screen.queryByText(Copy.analyzing.notCounted)).toBeNull();
    }
  });

  it('"not counted" is absent on a timeout — the server may still finish and charge it', async () => {
    jest.useFakeTimers();
    try {
      await renderWith();
      await flush();
      await advance(ANALYZING_TIMEOUT_MS);

      expect(screen.getByTestId('analyzing-stop-timeout')).toBeTruthy();
      expect(screen.queryByTestId('analyzing-not-counted')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

// -------------------------------------------------------------------------------------------
// Issue #64 foreground reconciliation, issue #140 marker, success
// -------------------------------------------------------------------------------------------

describe('AnalyzingScreen — foreground reconciliation (issue #64)', () => {
  async function foreground() {
    await act(async () => {
      mockForegroundHandler?.();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
  }

  it('delivered -> the result route, by the resolver keyed on the idempotency key', async () => {
    mockResolveAnalysisRequest.mockResolvedValue({ id: ANALYSIS_ID, status: 'delivered', result: PRO_RESULT, is_fallback: false });
    await renderWith();
    expect(mockForegroundHandler).not.toBeNull();

    await foreground();

    expect(mockResolveAnalysisRequest).toHaveBeenCalledWith('idem-video-1');
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({ pathname: '/result/[id]', params: { id: ANALYSIS_ID, justAnalyzed: '1' } })
    );
    expect(mockClearPendingAnalysisMarker).toHaveBeenCalledTimes(1);
  });

  it('released -> the start-new stop, and the #140 marker is cleared', async () => {
    mockResolveAnalysisRequest.mockResolvedValue({ id: ANALYSIS_ID, status: 'released', result: null, is_fallback: false });
    await renderWith();

    await foreground();

    await waitFor(() => expect(screen.getByTestId('analyzing-stop-released')).toBeTruthy());
    expect(screen.getByTestId('analyzing-start-new')).toBeTruthy();
    expect(screen.queryByTestId('analyzing-retry')).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockClearPendingAnalysisMarker).toHaveBeenCalledTimes(1);
  });

  it.each<[string, () => void]>([
    ['still reserved', () => mockResolveAnalysisRequest.mockResolvedValue({ id: ANALYSIS_ID, status: 'reserved', result: null, is_fallback: false })],
    ['no row', () => mockResolveAnalysisRequest.mockResolvedValue(null)],
    ['a thrown read', () => mockResolveAnalysisRequest.mockRejectedValue(new Error('network down'))],
    [
      'a delivered row with a malformed result',
      () => mockResolveAnalysisRequest.mockResolvedValue({ id: ANALYSIS_ID, status: 'delivered', result: { garbage: true }, is_fallback: false }),
    ],
  ])('%s -> keeps waiting, never resubmits, keeps the marker', async (_label, arrange) => {
    arrange();
    await renderWith();

    await foreground();

    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockClearPendingAnalysisMarker).not.toHaveBeenCalled();
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('analyzing-viewer')).toBeTruthy();
  });
});

describe('AnalyzingScreen — the #140 marker', () => {
  it('is set on mount for this request and this user', async () => {
    await renderWith();
    expect(mockSetPendingAnalysisMarker).toHaveBeenCalledWith({ idempotencyKey: 'idem-video-1', userId: 'user-a' });
  });

  // A failure does not prove the server stopped; only the runner walking away clears it.
  it('survives a failure, and is cleared when the runner goes Back', async () => {
    mockSubmit.mockResolvedValueOnce(failure('model_error'));
    await renderWith();

    await waitFor(() => expect(screen.getByTestId('analyzing-stop-failed')).toBeTruthy());
    expect(mockClearPendingAnalysisMarker).not.toHaveBeenCalled();

    await press(screen.getByTestId('analyzing-back'));
    expect(mockClearPendingAnalysisMarker).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/');
  });
});

describe('AnalyzingScreen — success', () => {
  // "Complete · timer stops · hold 300 ms → result fades in".
  it('shows Done, then replaces to /result/[id] with justAnalyzed only after the 300 ms hold', async () => {
    jest.useFakeTimers();
    try {
      const resolve = deferredSubmit();
      await renderWith();
      await flush();

      await act(async () => {
        resolve(success());
        for (let i = 0; i < 5; i++) await Promise.resolve();
      });

      expect(screen.getByTestId('analyzing-phase-title')).toHaveTextContent(Copy.analyzing.phase.done.title, { exact: true });
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockClearPendingAnalysisMarker).not.toHaveBeenCalled();

      await advance(Motion.duration.fade - 1);
      expect(mockReplace).not.toHaveBeenCalled();
      await advance(1);

      expect(mockReplace).toHaveBeenCalledWith({ pathname: '/result/[id]', params: { id: ANALYSIS_ID, justAnalyzed: '1' } });
      expect(mockClearPendingAnalysisMarker).toHaveBeenCalledTimes(1);
      // Review r7-4: the result screen is handed the body the server just sent.
      expect(mockSetPendingAnalysisResult).toHaveBeenCalledWith({
        analysisId: ANALYSIS_ID,
        outcome: { result: PRO_RESULT, isFallback: false },
        mediaType: 'video',
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

// -------------------------------------------------------------------------------------------
// The progress states
// -------------------------------------------------------------------------------------------

describe('AnalyzingScreen — the progress states', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function trackStatuses() {
    return (['upload', 'read', 'result'] as const).map((key) =>
      (['done', 'now', 'todo'] as const).find((status) => screen.queryByTestId(`analyzing-track-${key}-${status}`))
    );
  }

  function viewerFrameLabel() {
    return screen.getByTestId('analyzing-viewer-frame').props.accessibilityLabel;
  }

  it('uploading: title, body, Upload lit, the real third frame in the viewer, the clock at 00:00', async () => {
    const request = await renderWith();
    await flush();

    expect(screen.getByTestId('analyzing-phase-title')).toHaveTextContent(Copy.analyzing.phase.uploading.title, { exact: true });
    expect(screen.getByText(Copy.analyzing.phase.uploading.video(5))).toBeTruthy();
    expect(trackStatuses()).toEqual(['now', 'todo', 'todo']);
    expect(screen.getByTestId('analyzing-track-upload-now').props.accessibilityLabel).toBe(
      `${Copy.analyzing.track.upload}, ${Copy.upload.rows.stateNow}`
    );
    expect(screen.getByTestId('analyzing-track-result-todo').props.accessibilityLabel).toBe(
      `${Copy.analyzing.track.result}, ${Copy.upload.rows.stateTodo}`
    );
    expect(screen.getByTestId('analyzing-viewer-tag')).toHaveTextContent(Copy.analyzing.viewer.sending, { exact: true });
    expect(viewerFrameLabel()).toBe('Frame 3 of 5');
    expect(screen.getByTestId('analyzing-viewer-frame-image').props.source).toEqual([
      { uri: `data:image/jpeg;base64,${request.frames[2]}` },
    ]);
    expect(screen.getByText(Copy.analyzing.viewer.frame(3, 5))).toBeTruthy();
    expect(screen.getByTestId('analyzing-clock').props.accessibilityLabel).toBe(`${Copy.analyzing.clock.elapsed} 00:00`);
    expect(screen.getByTestId('analyzing-strip')).toBeTruthy();
    for (let i = 1; i <= 5; i++) expect(screen.getByTestId(`analyzing-tile-${i}`)).toBeTruthy();
    // Not reading yet: no scan line.
    expect(screen.queryByTestId('analyzing-scan', HIDDEN)).toBeNull();
  });

  it('finding your stride: Read lit, the scan line drawn, and the viewer steps through the frames', async () => {
    await renderWith();
    await flush();

    await advance(ANALYZING_STEP_FLOOR_MS);

    expect(screen.getByTestId('analyzing-phase-title')).toHaveTextContent(Copy.analyzing.phase.finding.title, { exact: true });
    expect(screen.getByText(Copy.analyzing.phase.finding.video(5))).toBeTruthy();
    expect(trackStatuses()).toEqual(['done', 'now', 'todo']);
    expect(screen.getByTestId('analyzing-track-upload-done').props.accessibilityLabel).toBe(
      `${Copy.analyzing.track.upload}, ${Copy.upload.rows.stateDone}`
    );
    expect(screen.getByTestId('analyzing-viewer-tag')).toHaveTextContent(Copy.analyzing.viewer.reading, { exact: true });
    expect(screen.getByTestId('analyzing-scan', HIDDEN)).toBeTruthy();
    expect(viewerFrameLabel()).toBe('Frame 3 of 5');

    await advance(Motion.loading.frameCycle);
    expect(viewerFrameLabel()).toBe('Frame 4 of 5');
  });

  it('still analyzing: the long-wait title, Read still lit', async () => {
    await renderWith();
    await flush();

    await advance(LONG_WAIT_AT_MS);

    expect(screen.getByTestId('analyzing-phase-title')).toHaveTextContent(Copy.analyzing.phase.longWait.title, { exact: true });
    expect(screen.getByText(Copy.analyzing.phase.longWait.body)).toBeTruthy();
    expect(trackStatuses()).toEqual(['done', 'now', 'todo']);
  });

  it('the clock counts the attempt in mm:ss', async () => {
    await renderWith();
    await flush();

    await advance(7_400);
    expect(screen.getByTestId('analyzing-clock').props.accessibilityLabel).toBe(`${Copy.analyzing.clock.elapsed} 00:07`);
    await advance(65_000 - 7_400);
    expect(screen.getByTestId('analyzing-clock').props.accessibilityLabel).toBe(`${Copy.analyzing.clock.elapsed} 01:05`);
  });

  it('done: every step complete, "Read complete", no scan line', async () => {
    const resolve = deferredSubmit();
    await renderWith();
    await flush();
    await advance(ANALYZING_STEP_FLOOR_MS);

    await act(async () => {
      resolve(success());
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(screen.getByTestId('analyzing-phase-title')).toHaveTextContent(Copy.analyzing.phase.done.title, { exact: true });
    expect(trackStatuses()).toEqual(['done', 'done', 'done']);
    expect(screen.getByTestId('analyzing-viewer-tag')).toHaveTextContent(Copy.analyzing.viewer.complete, { exact: true });
    expect(screen.queryByTestId('analyzing-scan', HIDDEN)).toBeNull();
  });

  it('reduced motion: no scan line, and the viewer holds one frame while reading', async () => {
    mockReduceMotion = true;
    await renderWith();
    await flush();

    await advance(ANALYZING_STEP_FLOOR_MS);
    expect(screen.getByTestId('analyzing-phase-title')).toHaveTextContent(Copy.analyzing.phase.finding.title, { exact: true });
    expect(screen.queryByTestId('analyzing-scan', HIDDEN)).toBeNull();
    expect(viewerFrameLabel()).toBe('Frame 3 of 5');

    await advance(Motion.loading.frameCycle * 3);
    expect(viewerFrameLabel()).toBe('Frame 3 of 5');
  });

  it('a photo: no strip, the photo label, one frame in the viewer', async () => {
    const request = await renderWith(photoRequest());
    await flush();

    expect(screen.queryByTestId('analyzing-strip')).toBeNull();
    expect(screen.getByText(Copy.analyzing.viewer.photo)).toBeTruthy();
    expect(viewerFrameLabel()).toBe('Frame 1 of 1');
    expect(screen.getByTestId('analyzing-viewer-frame-image').props.source).toEqual([
      { uri: `data:image/jpeg;base64,${request.frames[0]}` },
    ]);
    expect(screen.getByText(Copy.analyzing.phase.uploading.photo)).toBeTruthy();
  });
});

// -------------------------------------------------------------------------------------------
// The stop layouts (stateless view)
// -------------------------------------------------------------------------------------------

describe('AnalysingView — every stop layout', () => {
  const handlers = { onRetry: jest.fn(), onSignInAndRetry: jest.fn(), onStartNew: jest.fn(), onBack: jest.fn() };

  function viewProps(stop: AnalysingStop, overrides: Partial<AnalysingViewProps> = {}): AnalysingViewProps {
    return {
      ...handlers,
      request: videoRequest(),
      phase: null,
      stop,
      elapsedMs: 42_000,
      activeIndex: 2,
      stepping: false,
      reduceMotion: false,
      zeroPillarBody: 'The last clip could not be read. Try again in a few minutes.',
      uncounted: false,
      busy: false,
      ...overrides,
    };
  }

  const e = Copy.analyzing.error;
  it.each<[AnalysingStop, string, string, boolean]>([
    ['failed', e.failed.eyebrow, e.failed.title, true],
    ['timeout', e.timeout.eyebrow, e.timeout.title, true],
    ['inProgress', e.inProgress.eyebrow, e.inProgress.title, true],
    ['offline', e.offline.eyebrow, e.offline.title, true],
    ['unauthorized', e.unauthorized.eyebrow, e.unauthorized.title, true],
    ['released', e.previousAttemptFailed.eyebrow, e.previousAttemptFailed.title, false],
    ['deleted', e.deleted.eyebrow, e.deleted.title, false],
    ['paused', e.paused.eyebrow, e.paused.title, false],
    ['zeroPillarCooldown', e.zeroPillarCooldown.eyebrow, e.zeroPillarCooldown.title, false],
  ])('%s: its eyebrow and title; "5 frames ready to retry": %s', async (stop, eyebrow, title, kept) => {
    await render(<AnalysingView {...viewProps(stop)} />);

    expect(screen.getByTestId(`analyzing-stop-${stop}`)).toBeTruthy();
    expect(screen.getByText(eyebrow)).toBeTruthy();
    expect(screen.getByRole('header', { name: title })).toBeTruthy();
    expect(screen.getByTestId('analyzing-clock').props.accessibilityLabel).toBe(`${Copy.analyzing.clock.stoppedAt} 00:42`);
    if (kept) {
      expect(screen.getByTestId('analyzing-kept-label')).toHaveTextContent(Copy.analyzing.kept.video(5), { exact: true });
      expect(Copy.analyzing.kept.video(5)).toBe('5 frames ready to retry');
    } else {
      expect(screen.queryByTestId('analyzing-kept-label')).toBeNull();
    }
    // The kept frames are drawn, dimmed, in every stop.
    expect(screen.getAllByLabelText(/^Frame \d of 5$/)).toHaveLength(5);
  });

  it('the "not counted" line follows the `uncounted` prop', async () => {
    await render(<AnalysingView {...viewProps('failed', { uncounted: true })} />);
    expect(screen.getByTestId('analyzing-not-counted')).toBeTruthy();
    await screen.unmount();

    await render(<AnalysingView {...viewProps('failed', { uncounted: false })} />);
    expect(screen.queryByTestId('analyzing-not-counted')).toBeNull();
  });

  it('unauthorized: the 15-minute promise, and "Sign in and retry" instead of Retry', async () => {
    await render(<AnalysingView {...viewProps('unauthorized')} />);

    expect(screen.getByText(Copy.analyzing.error.unauthorized.video)).toBeTruthy();
    expect(Copy.analyzing.error.unauthorized.video).toContain('within 15 minutes');
    expect(screen.getByTestId('analyzing-sign-in-retry')).toHaveTextContent(Copy.analyzing.error.unauthorized.cta);
    expect(screen.queryByTestId('analyzing-retry')).toBeNull();
  });
});

// -------------------------------------------------------------------------------------------
// THE SESSION-EXPIRED RESUME
// -------------------------------------------------------------------------------------------

describe('AnalyzingScreen — the session-expired resume', () => {
  async function renderUnauthorized() {
    mockSubmit.mockResolvedValueOnce(failure('unauthorized'));
    const request = await renderWith();
    await waitFor(() => expect(screen.getByTestId('analyzing-stop-unauthorized')).toBeTruthy());
    return request;
  }

  it('(1) a 401 holds the SAME request — same idempotency key, same frames — for the user who started it', async () => {
    const request = await renderUnauthorized();
    const frames = [...request.frames];

    expect(screen.getByText(Copy.analyzing.error.unauthorized.video)).toBeTruthy();
    expect(screen.getByTestId('analyzing-kept-label')).toHaveTextContent('5 frames ready to retry', { exact: true });
    expect(screen.queryByTestId('analyzing-retry')).toBeNull();

    const held = takeResumableAnalysis('user-a');
    expect(held).toBe(request);
    expect(held?.idempotencyKey).toBe('idem-video-1');
    expect(held?.frames).toEqual(frames);
  });

  it('(2) a different account never gets it, and its take discards the hold', async () => {
    await renderUnauthorized();

    expect(takeResumableAnalysis('user-b')).toBeNull();
    expect(hasResumableAnalysis()).toBe(false);
    expect(takeResumableAnalysis('user-a')).toBeNull();
  });

  it('(3) "Sign in and retry" signs out KEEPING the hold, without resubmitting or navigating', async () => {
    const request = await renderUnauthorized();

    await press(screen.getByTestId('analyzing-sign-in-retry'));

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledWith({ keepResumableAnalysis: true });
    expect(takeResumableAnalysis('user-a')).toBe(request);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('(3b) a second tap while the sign-out is in flight does not sign out twice', async () => {
    await renderUnauthorized();
    mockSignOut.mockImplementationOnce(() => new Promise(() => {}));

    await press(screen.getByTestId('analyzing-sign-in-retry'));
    await press(screen.getByTestId('analyzing-sign-in-retry'));

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the panel Back', 'analyzing-back'],
    ['the header Back', 'analyzing-header-back'],
  ])('(4) %s after a 401 discards the hold and goes Home', async (_label, testID) => {
    await renderUnauthorized();

    await press(screen.getByTestId(testID));

    expect(hasResumableAnalysis()).toBe(false);
    expect(takeResumableAnalysis('user-a')).toBeNull();
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(mockClearPendingAnalysisMarker).toHaveBeenCalledTimes(1);
  });

  // Android's hardware back leaves through the same door as the on-screen Back.
  it('(4b) the Android hardware back after a 401 discards the hold, goes Home, and consumes the event', async () => {
    await renderUnauthorized();
    expect(mockHardwareBack).not.toBeNull();

    let handled: boolean | null | undefined;
    await act(async () => {
      handled = mockHardwareBack?.({} as Parameters<NonNullable<typeof mockHardwareBack>>[0]);
    });

    expect(handled).toBe(true);
    expect(hasResumableAnalysis()).toBe(false);
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(mockClearPendingAnalysisMarker).toHaveBeenCalledTimes(1);
  });

  describe('(5) a 401 that lands after the runner walked away is refused', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    /** Attempt 1 hangs, the client times out, and the runner presses Back. */
    async function timeOutAndGoBack() {
      const resolve = deferredSubmit();
      const request = await renderWith();
      await flush();
      await advance(ANALYZING_TIMEOUT_MS);
      expect(screen.getByTestId('analyzing-stop-timeout')).toBeTruthy();
      await press(screen.getByTestId('analyzing-back'));
      expect(mockReplace).toHaveBeenCalledWith('/');
      return { resolve, request };
    }

    it('while the screen is still mounted', async () => {
      const { resolve } = await timeOutAndGoBack();

      await act(async () => {
        resolve(failure('unauthorized'));
        for (let i = 0; i < 5; i++) await Promise.resolve();
      });

      expect(hasResumableAnalysis()).toBe(false);
      expect(takeResumableAnalysis('user-a')).toBeNull();
    });

    it('after the screen unmounted following Back', async () => {
      const { resolve } = await timeOutAndGoBack();
      await screen.unmount();

      await act(async () => {
        resolve(failure('unauthorized'));
        for (let i = 0; i < 5; i++) await Promise.resolve();
      });

      expect(hasResumableAnalysis()).toBe(false);
    });

    // The contrast: without the Back, the same late 401 IS kept — the guard is the Back, not time.
    it('but is kept when the runner had not walked away', async () => {
      const resolve = deferredSubmit();
      const request = await renderWith();
      await flush();
      await advance(ANALYZING_TIMEOUT_MS);

      await act(async () => {
        resolve(failure('unauthorized'));
        for (let i = 0; i < 5; i++) await Promise.resolve();
      });

      expect(takeResumableAnalysis('user-a')).toBe(request);
    });
  });

  // auth-js may end the session itself and the route guard tear the screen down mid-call; the
  // runner did not choose to leave, so the analysis must still be there when they sign back in.
  it('(6) a 401 that lands after an unmount WITHOUT a Back (route-guard teardown) is still held', async () => {
    const resolve = deferredSubmit();
    const request = await renderWith();
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));

    await screen.unmount();
    await act(async () => {
      resolve(failure('unauthorized'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(takeResumableAnalysis('user-a')).toBe(request);
  });

  it('(7) the resumed mount submits the identical request — same object, same key, same frames', async () => {
    const original = await renderUnauthorized();
    await screen.unmount();

    // What Home does after the same user signs back in.
    const held = takeResumableAnalysis('user-a');
    expect(held).toBe(original);
    setPendingAnalyzeFormRequest(held as AnalyzeFormRequest, 'user-a');
    mockSubmit.mockClear();
    await render(<AnalyzingScreen />);

    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    const resent = mockSubmit.mock.calls[0][0] as AnalyzeFormRequest;
    expect(resent).toBe(original);
    expect(resent.idempotencyKey).toBe('idem-video-1');
    expect(resent.frames).toEqual(videoRequest().frames);
    expect(resent.timestamps).toEqual(videoRequest().timestamps);
  });

  it('(8) a delivered result discards any hold', async () => {
    holdForResume(videoRequest('older'), 'user-a', currentResumeGeneration());
    mockSubmit.mockResolvedValueOnce(success());
    await renderWith(videoRequest('newer'));

    await waitFor(() => expect(screen.getByTestId('analyzing-phase-title')).toHaveTextContent(Copy.analyzing.phase.done.title));
    expect(hasResumableAnalysis()).toBe(false);
  });

  it('(10) a sign-out that leaves the runner signed in shows the ConfirmDialog, never a native Alert', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    await renderUnauthorized();
    mockSignOut.mockResolvedValueOnce({ ok: false, reason: 'stillSignedIn' });

    await press(screen.getByTestId('analyzing-sign-in-retry'));

    await waitFor(() =>
      expect(screen.getByRole('header', { name: Copy.settings.signOutError.stillSignedIn.title })).toBeTruthy()
    );
    expect(screen.getByTestId('analyzing-signout-stuck-primary')).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();

    // Its primary tries the same sign-out again, still keeping the hold.
    await press(screen.getByTestId('analyzing-signout-stuck-primary'));
    expect(mockSignOut).toHaveBeenCalledTimes(2);
    expect(mockSignOut).toHaveBeenLastCalledWith({ keepResumableAnalysis: true });
  });

  it('(10b) a sign-out whose global revoke failed shows no dialog — the local session is gone', async () => {
    await renderUnauthorized();
    mockSignOut.mockResolvedValueOnce({ ok: false, reason: 'globalRevokeFailed' });

    await press(screen.getByTestId('analyzing-sign-in-retry'));

    expect(screen.queryByRole('header', { name: Copy.settings.signOutError.stillSignedIn.title })).toBeNull();
  });

  describe('a different account signed in than the request owner', () => {
    // The attempt that hits the 401 is RUNNING under user-b's session (it started after the switch),
    // so its 401 says nothing about user-a's session: no hold, for either account.
    it('a 401 on an attempt started after the switch creates no hold', async () => {
      mockSubmit.mockResolvedValueOnce(failure('model_error'));
      await renderWith();
      await waitFor(() => expect(screen.getByTestId('analyzing-stop-failed')).toBeTruthy());

      mockUserId = 'user-b';
      await screen.rerender(<AnalyzingScreen />);
      mockSubmit.mockResolvedValueOnce(failure('unauthorized'));
      await press(screen.getByTestId('analyzing-retry'));
      await waitFor(() => expect(screen.getByTestId('analyzing-stop-unauthorized')).toBeTruthy());

      expect(hasResumableAnalysis()).toBe(false);
    });

    it('"Sign in and retry" pressed under another account re-holds nothing', async () => {
      await renderUnauthorized();
      // Home (or anything) already took the hold; now the session belongs to someone else.
      takeResumableAnalysis('user-a');
      mockUserId = 'user-b';
      await screen.rerender(<AnalyzingScreen />);

      await press(screen.getByTestId('analyzing-sign-in-retry'));

      expect(hasResumableAnalysis()).toBe(false);
    });

    // The contract: no hold if the signed-in user differs from the owner WHEN THE 401 LANDS — a
    // switch to user-b mid-attempt must not keep user-a's frames while user-b is signed in.
    it('a 401 that lands after the user switched mid-attempt creates no hold', async () => {
      const resolve = deferredSubmit();
      await renderWith();
      await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));

      mockUserId = 'user-b';
      await screen.rerender(<AnalyzingScreen />);
      await act(async () => {
        resolve(failure('unauthorized'));
        for (let i = 0; i < 5; i++) await Promise.resolve();
      });

      expect(hasResumableAnalysis()).toBe(false);
    });
  });
});
