/**
 * Regression lock for the home-tab cleanup pass: the top-bar `LowPolyField` logo must be gone
 * (issue: captain called `app/(tabs)/index.tsx` messy) and `Copy.home.title` must render exactly
 * once — it used to also duplicate into the ready-quota block's eyebrow, which read as a second,
 * unlabeled title directly under the first. Since the V23-07 re-theme the title is `<TopBar>`'s
 * header and the Settings control is the page's bled icon button; both are locked here too.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';
import { Ink } from '@/constants/v23-theme';
import { takePendingAnalyzeFormRequest, type AnalyzeFormRequest } from '@/lib/analyze-form';
import { checkPendingAnalysis } from '@/lib/pending-analysis';
import { quotaStatusClient, type QuotaStatus } from '@/lib/quota';
import {
  currentResumeGeneration,
  discardResumableAnalysis,
  hasResumableAnalysis,
  holdForResume,
} from '@/lib/resumable-analysis';

import HomeScreen from '../index';

const mockPush = jest.fn();

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const react = require('react');
  return {
    router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn() },
    // Real effect semantics (run once after mount, per the `cb` identity), not a call on every
    // render — a naive `useFocusEffect: (cb) => cb()` re-fires `fetchQuota` on every state update
    // it triggers, which loops forever and hangs the test.
    useFocusEffect: (cb: () => void | (() => void)) => react.useEffect(cb, [cb]),
  };
});

jest.mock('@/lib/session-provider', () => ({
  useSession: () => ({ session: { user: { id: 'user-1' } } }),
}));

jest.mock('@/lib/pending-analysis', () => ({
  checkPendingAnalysis: jest.fn(async () => ({ kind: 'none' })),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

jest.mock('@/lib/quota', () => {
  const actual = jest.requireActual('@/lib/quota');
  return {
    ...actual,
    quotaStatusClient: {
      fetch: jest.fn(async () => ({
        ok: true,
        data: {
          tier: 'free',
          used: 1,
          limit: 3,
          remaining: 2,
          frameCap: 6,
          isLifetime: true,
          periodStart: null,
          periodEnd: null,
          blocked: false,
          blockedReason: null,
          blockedUntil: null,
        },
      })),
    },
  };
});

describe('HomeScreen top bar', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('renders no low-poly mark and the title exactly once, as the header', async () => {
    await render(<HomeScreen />);

    expect(screen.queryByTestId('home-mark')).toBeNull();
    expect(screen.getAllByText(Copy.home.title)).toHaveLength(1);
    expect(screen.getByTestId('home-title').props.accessibilityRole).toBe('header');
  });

  it('routes the Settings control to /settings', async () => {
    await render(<HomeScreen />);

    const settings = screen.getByRole('button', { name: Copy.settings.title });
    await act(async () => {
      fireEvent.press(settings);
    });
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });

  it('routes the primary CTA to /capture while quota is available', async () => {
    await render(<HomeScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('home-primary-cta'));
    });
    expect(mockPush).toHaveBeenCalledWith('/capture');
  });
});

const PRO_REMAINING: QuotaStatus = {
  tier: 'pro',
  used: 2,
  limit: 10,
  remaining: 8,
  frameCap: 12,
  isLifetime: false,
  periodStart: '2026-09-01T00:00:00.000Z',
  periodEnd: '2026-10-01T00:00:00.000Z',
  blocked: false,
  blockedReason: null,
  blockedUntil: null,
};

/**
 * `ink3` is deliberately under AA and the page mandates it for exactly one line of copy — the
 * "Renews …" line. Any other secondary caption is a status the user has to read (issue #6's
 * anti-farm notice, the stale last-known disclosure) and stays on `ink2`.
 */
describe('HomeScreen quota secondary line', () => {
  const fetch = quotaStatusClient.fetch as jest.Mock;

  it('draws the page-mandated "Renews …" line in ink3', async () => {
    fetch.mockResolvedValueOnce({ ok: true, data: PRO_REMAINING });
    await render(<HomeScreen />);

    const renews = await screen.findByTestId('home-quota-renews');
    expect(renews).toHaveTextContent(/^Renews /);
    expect(renews).toHaveStyle({ color: Ink.ink3 });
    expect(screen.queryByTestId('home-quota-notice')).toBeNull();
  });

  it('draws the anti-farm blocked notice in ink2, never the placeholder tone', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      data: {
        ...PRO_REMAINING,
        blocked: true,
        blockedReason: 'too_many_failed_attempts',
        blockedUntil: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      },
    });
    await render(<HomeScreen />);

    const notice = await screen.findByTestId('home-quota-notice');
    expect(notice).not.toHaveTextContent(/^Renews /);
    expect(notice).toHaveStyle({ color: Ink.ink2 });
    await waitFor(() => expect(screen.queryByTestId('home-quota-renews')).toBeNull());
  });
});

/**
 * The session-expired resume (2026-10-06, `lib/resumable-analysis.ts`): Home is where the auth
 * guard lands a runner who signed back in after "Sign in and retry". Driven through the REAL resume
 * hold and the REAL `analyze-form` mailbox, so what is asserted is what Analyzing would actually
 * take — the very same request object, staged for this user — not that a helper was called.
 * `useSession` is mocked above to user `user-1`.
 */
describe('HomeScreen session-expired resume', () => {
  const mockCheckPendingAnalysis = checkPendingAnalysis as jest.Mock;

  function makeRequest(): AnalyzeFormRequest {
    return {
      mediaType: 'video',
      frames: ['QUFBQQ==', 'QkJCQg=='],
      timestamps: [0, 250],
      idempotencyKey: 'idem-resume-1',
    };
  }

  function holdFor(request: AnalyzeFormRequest, userId: string) {
    holdForResume(request, userId, currentResumeGeneration());
  }

  function analyzingPushes(): unknown[][] {
    return mockPush.mock.calls.filter(([href]) => href === '/analyzing');
  }

  beforeEach(() => {
    mockPush.mockClear();
    mockCheckPendingAnalysis.mockClear();
    discardResumableAnalysis();
    takePendingAnalyzeFormRequest(null);
  });

  afterAll(() => {
    discardResumableAnalysis();
    takePendingAnalyzeFormRequest(null);
  });

  it('sends a same-user hold back to /analyzing once, staging the identical request for that user', async () => {
    const request = makeRequest();
    const frames = request.frames;
    holdFor(request, 'user-1');

    await render(<HomeScreen />);

    expect(analyzingPushes()).toHaveLength(1);
    const staged = takePendingAnalyzeFormRequest('user-1');
    expect(staged).toBe(request);
    expect(staged?.frames).toBe(frames);
    expect(staged?.idempotencyKey).toBe('idem-resume-1');
    expect(hasResumableAnalysis()).toBe(false);
    // The #140 marker check is skipped on the resume pass — Analyzing settles that key itself.
    expect(mockCheckPendingAnalysis).not.toHaveBeenCalled();
  });

  it("never resumes another account's hold, and drops it", async () => {
    holdFor(makeRequest(), 'user-2');

    await render(<HomeScreen />);

    expect(analyzingPushes()).toHaveLength(0);
    expect(hasResumableAnalysis()).toBe(false);
    expect(takePendingAnalyzeFormRequest('user-1')).toBeNull();
    expect(takePendingAnalyzeFormRequest('user-2')).toBeNull();
    // With nothing to resume, the ordinary startup check runs.
    expect(mockCheckPendingAnalysis).toHaveBeenCalledWith('user-1');
  });

  it('runs the ordinary startup check, and pushes nothing, when there is no hold', async () => {
    await render(<HomeScreen />);

    expect(analyzingPushes()).toHaveLength(0);
    expect(mockCheckPendingAnalysis).toHaveBeenCalledTimes(1);
    expect(mockCheckPendingAnalysis).toHaveBeenCalledWith('user-1');
  });

  it('does not push twice across a re-render or a second mount', async () => {
    holdFor(makeRequest(), 'user-1');

    const { rerender, unmount } = await render(<HomeScreen />);
    await rerender(<HomeScreen />);
    await unmount();
    await render(<HomeScreen />);

    expect(analyzingPushes()).toHaveLength(1);
  });
});
