/**
 * Screen-level coverage for `app/analyzing.tsx`'s terminal branches (issue #128's client swap and
 * the released-reservation UI that came with it).
 *
 * `lib/__tests__/analyzing-machine.test.ts` covers the reducer, and `lib/__tests__/analyze-form.ts`
 * covers the client seam — but neither can see what the user is actually offered on screen. The
 * behavior that matters here is precisely that: a `previous_attempt_failed` (or a reconciled
 * `released`) reservation must NOT render a Retry, because retrying reuses the same idempotency key
 * and can only ever hand back the same released row; it must offer "Start a new analysis" instead.
 * A plain failure and a timeout must still offer Retry.
 */
import { render, screen, waitFor } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
    functions: { invoke: jest.fn() },
  },
}));

jest.mock('@/lib/session-provider', () => ({
  useSession: () => ({ session: { user: { id: 'user-1' } } }),
}));

jest.mock('@/lib/connectivity', () => ({ checkConnectivity: jest.fn(async () => true) }));
jest.mock('@/lib/app-state', () => ({ onAppForeground: () => () => {} }));
jest.mock('@/lib/pending-analysis', () => ({
  setPendingAnalysisMarker: jest.fn(),
  clearPendingAnalysisMarker: jest.fn(),
}));

const mockSubmit = jest.fn();
jest.mock('@/lib/analyze-form', () => {
  const actual = jest.requireActual('@/lib/analyze-form');
  return {
    ...actual,
    analyzeFormClient: { submit: (...args: unknown[]) => mockSubmit(...args) },
    takePendingAnalyzeFormRequest: () => ({
      mediaType: 'photo' as const,
      frames: ['base64'],
      timestamps: [0],
      idempotencyKey: 'idem-1',
    }),
  };
});

// Imported after the mocks above are registered.
// eslint-disable-next-line import/first
import AnalyzingScreen from '../analyzing';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AnalyzingScreen terminal branches', () => {
  it('offers "Start a new analysis" — and no Retry — when the server returns previous_attempt_failed', async () => {
    mockSubmit.mockResolvedValue({
      ok: false,
      error: { error: 'That analysis was already released.', code: 'previous_attempt_failed' },
    });

    await render(<AnalyzingScreen />);

    await waitFor(() =>
      expect(screen.getByText(Copy.analyzing.error.previousAttemptFailed.title)).toBeTruthy()
    );
    expect(screen.getByText(Copy.analyzing.error.previousAttemptFailed.body)).toBeTruthy();
    expect(screen.getByText(Copy.analyzing.error.cta.startNew)).toBeTruthy();
    expect(screen.queryByText(Copy.analyzing.error.cta.retry)).toBeNull();
  });

  it('still offers Retry for an ordinary failure code', async () => {
    mockSubmit.mockResolvedValue({
      ok: false,
      error: { error: 'no usable result', code: 'validation_failed' },
    });

    await render(<AnalyzingScreen />);

    await waitFor(() => expect(screen.getByText(Copy.analyzing.error.failed.title)).toBeTruthy());
    expect(screen.getByText(Copy.analyzing.error.cta.retry)).toBeTruthy();
    expect(screen.queryByText(Copy.analyzing.error.cta.startNew)).toBeNull();
  });

  // Issue #136: the paywall route, which keys off the server's own code — the reason the real
  // client passes codes through verbatim instead of whitelisting them.
  it('routes a server quota_exceeded to the paywall instead of rendering an error panel', async () => {
    mockSubmit.mockResolvedValue({
      ok: false,
      error: { error: 'out of analyses', code: 'quota_exceeded' },
    });

    await render(<AnalyzingScreen />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/paywall'));
    expect(screen.queryByText(Copy.analyzing.error.failed.title)).toBeNull();
  });

  // The #128 fix end-to-end from the screen's point of view: a 200 carrying a real UUID navigates
  // to the result route that queries `public.analyses` by exactly that id.
  it('navigates to /result/[id] with the server-issued analysis id on success', async () => {
    const analysisId = 'b144d29b-2348-4043-a96b-581ff4af6dbe';
    mockSubmit.mockResolvedValue({
      ok: true,
      data: {
        analysisId,
        isFallback: false,
        result: jest.requireActual('@/lib/pace-fixtures').proTierVideoResult,
      },
    });

    await render(<AnalyzingScreen />);

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/result/[id]',
        params: { id: analysisId, justAnalyzed: '1' },
      })
    );
  });
});
