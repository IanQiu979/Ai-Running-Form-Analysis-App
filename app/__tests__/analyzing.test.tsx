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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

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

const mockSignOut = jest.fn();
jest.mock('@/lib/sign-out', () => ({ signOut: (...args: unknown[]) => mockSignOut(...args) }));

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
      expect(screen.getByLabelText(Copy.analyzing.error.previousAttemptFailed.title)).toBeTruthy()
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

    await waitFor(() => expect(screen.getByLabelText(Copy.analyzing.error.failed.title)).toBeTruthy());
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
    expect(screen.queryByLabelText(Copy.analyzing.error.failed.title)).toBeNull();
  });

  // The anti-farm cooldown (issue #6's `too_many_failed_attempts`), reached here only when it beat
  // `app/capture/extracting.tsx`'s pre-flight. This used to render `error.failed` — "Your analysis
  // failed / The analysis service didn't return a usable result" — with a Retry beside it. Both
  // halves were untrue: the reserve was refused, so no model call was ever made, and retrying
  // resubmits into the identical refusal until the window clears.
  it('renders the honest paused panel for a 429 cooldown, never the failure copy', async () => {
    mockSubmit.mockResolvedValue({
      ok: false,
      error: { error: 'Too many analyses failed recently.', code: 'too_many_failed_attempts' },
    });

    await render(<AnalyzingScreen />);

    await waitFor(() => expect(screen.getByLabelText(Copy.analysisPause.title)).toBeTruthy());
    expect(screen.getByText(Copy.analysisPause.body)).toBeTruthy();
    // The exact regression: the failure copy must be gone, not merely joined.
    expect(screen.queryByLabelText(Copy.analyzing.error.failed.title)).toBeNull();
    expect(screen.queryByText(Copy.analyzing.error.failed.body)).toBeNull();
  });

  it('offers no Retry on the cooldown path, only a way home', async () => {
    mockSubmit.mockResolvedValue({
      ok: false,
      error: { error: 'Too many analyses failed recently.', code: 'too_many_failed_attempts' },
    });

    await render(<AnalyzingScreen />);

    await waitFor(() => expect(screen.getByLabelText(Copy.analysisPause.title)).toBeTruthy());
    expect(screen.queryByText(Copy.analyzing.error.cta.retry)).toBeNull();
    // A single exit, at full emphasis — there is exactly one honest action here.
    expect(screen.queryByText(Copy.analyzing.error.cta.cancel)).toBeNull();

    fireEvent.press(screen.getByText(Copy.analysisPause.cta));
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  // The contrast case, and the reason the cooldown needed its own branch rather than a tweak to
  // the shared one: a genuine transient failure still gets Retry, because retrying it can plausibly
  // succeed. That is the whole distinction.
  it('still offers Retry for a failure a retry could plausibly fix', async () => {
    mockSubmit.mockResolvedValue({
      ok: false,
      error: { error: 'the model call failed', code: 'model_error' },
    });

    await render(<AnalyzingScreen />);

    await waitFor(() => expect(screen.getByLabelText(Copy.analyzing.error.failed.title)).toBeTruthy());
    expect(screen.getByText(Copy.analyzing.error.cta.retry)).toBeTruthy();
    expect(screen.queryByLabelText(Copy.analysisPause.title)).toBeNull();
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

  // L7 follow-up (v23-ux-audit-r1, review-1): the `unauthorized` panel's primary CTA must sign the
  // user out (lib/sign-out.ts), not resubmit into the same expired session the way a plain Retry
  // would — this is the regression a bare "Retry" label would silently reintroduce.
  it('signs out (does not retry) when the primary CTA on an unauthorized failure is pressed', async () => {
    mockSubmit.mockResolvedValue({
      ok: false,
      error: { error: 'session expired', code: 'unauthorized' },
    });
    mockSignOut.mockResolvedValue({ ok: true });

    await render(<AnalyzingScreen />);

    await waitFor(() =>
      expect(screen.getByLabelText(Copy.analyzing.error.unauthorized.title)).toBeTruthy()
    );
    expect(screen.getByText(Copy.analyzing.error.unauthorized.body)).toBeTruthy();
    expect(screen.queryByText(Copy.analyzing.error.cta.retry)).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByText(Copy.analyzing.error.cta.signOut));
      // Let the handler's `await signOut()` and its post-await setState settle inside this act().
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockSubmit).toHaveBeenCalledTimes(1); // pressing sign-out must not resubmit the form
  });
});

/**
 * The Free zero-pillar cooldown's 429 (review r8-1). Before this branch existed the response fell
 * into the generic panel, which says "Your analysis failed / the analysis service didn't return a
 * usable result" — false on every count, since the cooldown is refused before any model call — and
 * offered a Retry that reuses this request's idempotency key and can only ever come back 409.
 */
describe('AnalyzingScreen — the zero-pillar cooldown 429', () => {
  const COOLDOWN_ERROR = {
    ok: false as const,
    error: {
      error: 'Nothing in that last clip could be read.',
      code: 'zero_pillar_cooldown',
      retryAfterSeconds: 900,
    },
  };

  it("states the server's own reason and when to come back — never the generic failure copy", async () => {
    mockSubmit.mockResolvedValue(COOLDOWN_ERROR);

    await render(<AnalyzingScreen />);

    await waitFor(() =>
      expect(screen.getByLabelText(Copy.analyzing.error.zeroPillarCooldown.title)).toBeTruthy()
    );
    const body = screen.getByText(/Nothing in that last clip could be read\./);
    // The server's sentence, verbatim, and a clock time — not a duration that goes stale on screen.
    expect(body.props.children).toContain('Nothing in that last clip could be read.');
    expect(body.props.children).toMatch(/You can try again at .+\.$/);
    expect(screen.queryByLabelText(Copy.analyzing.error.failed.title)).toBeNull();
    expect(screen.queryByText(Copy.analyzing.error.failed.body)).toBeNull();
  });

  it('offers no button that cannot work — no Retry, no "start a new analysis"', async () => {
    mockSubmit.mockResolvedValue(COOLDOWN_ERROR);

    await render(<AnalyzingScreen />);

    await waitFor(() =>
      expect(screen.getByLabelText(Copy.analyzing.error.zeroPillarCooldown.title)).toBeTruthy()
    );
    expect(screen.queryByText(Copy.analyzing.error.cta.retry)).toBeNull();
    expect(screen.queryByText(Copy.analyzing.error.cta.startNew)).toBeNull();
    expect(screen.getByText(Copy.analyzing.error.cta.backHome)).toBeTruthy();
  });

  it('names no time at all when the server sent none, rather than inventing one', async () => {
    mockSubmit.mockResolvedValue({
      ok: false,
      error: { error: 'Nothing in that last clip could be read.', code: 'zero_pillar_cooldown' },
    });

    await render(<AnalyzingScreen />);

    await waitFor(() =>
      expect(screen.getByLabelText(Copy.analyzing.error.zeroPillarCooldown.title)).toBeTruthy()
    );
    expect(screen.getByText(/Give it a few minutes and try again\.$/)).toBeTruthy();
  });

  it('leaves Home to state the same wait — the panel is the backstop, not the gate', async () => {
    mockSubmit.mockResolvedValue(COOLDOWN_ERROR);

    await render(<AnalyzingScreen />);

    await waitFor(() =>
      expect(screen.getByLabelText(Copy.analyzing.error.zeroPillarCooldown.title)).toBeTruthy()
    );
    // Pressing the one action leaves this screen instead of resubmitting.
    fireEvent.press(screen.getByText(Copy.analyzing.error.cta.backHome));
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });
});
