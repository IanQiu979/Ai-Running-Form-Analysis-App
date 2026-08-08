/**
 * Regression lock for the Turnstile expiry-message fix (no-mistakes review, Known Issue #12).
 * Before this fix, `onExpire` cleared the captcha token but never told the user why the submit
 * button re-disabled itself — the widget silently expired and the screen went quiet. This proves
 * the wiring in `app/(auth)/sign-in.tsx` itself (not just that `TurnstileWidget` fires `onExpire`,
 * which `components/__tests__/turnstile-widget.test.tsx` already covers): that firing `onExpire`
 * surfaces `Copy.auth.error.captchaExpired` on screen, in signUp mode, without a real WebView.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

jest.mock('@/lib/auth', () => ({
  signInWithGoogle: jest.fn(),
}));

jest.mock('@/lib/hibp', () => ({
  checkPasswordBreached: jest.fn(),
}));

jest.mock('@/lib/signup-with-captcha', () => ({
  signUpWithCaptcha: jest.fn(),
  applySignupSession: jest.fn(),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: jest.fn() } },
}));

jest.mock('@/lib/session-provider', () => ({
  useSession: () => ({
    deepLinkAuthError: null,
    clearDeepLinkAuthError: jest.fn(),
    corruptedSessionError: null,
    clearCorruptedSessionError: jest.fn(),
  }),
}));

// The real widget hosts a WebView loading Cloudflare's hosted challenge — irrelevant to this
// test, which only needs to prove sign-in.tsx's own onExpire callback prop. Stubbed with plain
// Pressables so the test can fire each callback directly, same boundary-mocking approach as
// app/capture/__tests__/extracting.test.tsx uses for lib/supabase.
jest.mock('@/components/turnstile-widget', () => {
  const { forwardRef } = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    TurnstileWidget: forwardRef(function MockTurnstileWidget(
      props: { onToken: (token: string) => void; onExpire: () => void; onError: () => void },
      _ref: unknown
    ) {
      return (
        <>
          <Pressable testID="mock-turnstile-token" onPress={() => props.onToken('a-token')} />
          <Pressable testID="mock-turnstile-expire" onPress={() => props.onExpire()} />
          <Pressable testID="mock-turnstile-error" onPress={() => props.onError()} />
          <Text>mock-turnstile-widget</Text>
        </>
      );
    }),
  };
});

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

// `TURNSTILE_SITE_KEY` (app/(auth)/sign-in.tsx) is read from `EXPO_PUBLIC_TURNSTILE_SITE_KEY` at
// MODULE-EVALUATION time, so it must be set before `sign-in.tsx` is first required — a plain ES
// `import` is hoisted above this line, which is why this file loads the screen via `require`
// after setting the env var instead.
process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = 'test-site-key';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SignInScreen = require('../sign-in').default;

describe('sign-in screen: Turnstile expiry', () => {
  it('shows the expiry error message when the challenge expires in signUp mode', async () => {
    await render(<SignInScreen />);

    // toggleMode() (app/(auth)/sign-in.tsx) flips mode to signUp AND opens the email form in one
    // call, so the Turnstile widget is already mounted after this single press — see that
    // function's own comment (issue #16) for why. Buttons here are `<PillButton>`, whose actual
    // press handling is Pressable's internal responder system rather than a literal `onPress`
    // prop on the queried node, and the resulting re-render lands asynchronously (this screen's
    // animated header components defer the commit past the same tick) — `waitFor` is required;
    // asserting immediately after `fireEvent.press` intermittently observes the pre-press tree.
    fireEvent.press(screen.getByRole('button', { name: Copy.auth.signUp.link }));
    await waitFor(() => expect(screen.getByTestId('mock-turnstile-expire')).toBeTruthy());

    expect(screen.queryByText(Copy.auth.error.captchaExpired)).toBeNull();

    fireEvent.press(screen.getByTestId('mock-turnstile-expire'));

    await waitFor(() =>
      expect(screen.getByText(Copy.auth.error.captchaExpired)).toBeTruthy()
    );
  });

  it('re-disables the submit button after expiry even if a token had been issued', async () => {
    await render(<SignInScreen />);

    fireEvent.press(screen.getByRole('button', { name: Copy.auth.signUp.link }));
    await waitFor(() => expect(screen.getByTestId('mock-turnstile-token')).toBeTruthy());

    fireEvent.press(screen.getByTestId('mock-turnstile-token'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: Copy.auth.signUp.submit })).toBeEnabled()
    );

    fireEvent.press(screen.getByTestId('mock-turnstile-expire'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: Copy.auth.signUp.submit })).toBeDisabled();
      expect(screen.getByText(Copy.auth.error.captchaExpired)).toBeTruthy();
    });
  });
});

/**
 * Regression lock for the scroll-reveal restructuring (fm/v23-onboard-scroll): the header,
 * `LowPolyField` mark, and action buttons/toggle now live in their own scroll-order sections
 * instead of one static screenful, with the mark's own opacity/scale responding to scroll
 * position. Two things must stay true regardless of that restructuring, and neither can be seen
 * from `render()` alone actually scrolling (RNTL renders the full component tree without a real
 * layout pass, so "reachable" here means "present in the tree", exactly what a screen reader
 * needs too — see CLAUDE.md's screen-testing note):
 *
 *  1. The mark, the sign-in buttons, and the sign-up/sign-in toggle are all mounted on first
 *     render — none of them is gated behind a scroll event firing first. A control that only
 *     entered the tree after a real scroll would be unreachable by VoiceOver/TalkBack until the
 *     user physically scrolled to reveal it, and untestable without simulating layout RNTL can't
 *     produce.
 *  2. With reduced motion on, the same is true, and additionally proves the reduced-motion path
 *     doesn't crash — `useScrollViewOffset`/`useAnimatedStyle` still run every render either way,
 *     only the `markAnimatedStyle` worklet takes the "no transform" branch (see sign-in.tsx).
 */
describe('sign-in screen: scroll-reveal structure', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(false);
  });

  it('mounts the mark and every control up front, not gated behind a scroll event', async () => {
    await render(<SignInScreen />);

    expect(screen.getByTestId('sign-in-mark', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: Copy.auth.cta.google })).toBeTruthy();
    expect(screen.getByRole('button', { name: Copy.auth.cta.email })).toBeTruthy();
    expect(screen.getByRole('button', { name: Copy.auth.signUp.link })).toBeTruthy();
  });

  it('keeps the mark and every control reachable with reduced motion on', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    await render(<SignInScreen />);

    expect(screen.getByTestId('sign-in-mark', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: Copy.auth.cta.google })).toBeEnabled();
    expect(screen.getByRole('button', { name: Copy.auth.cta.email })).toBeEnabled();
    expect(screen.getByRole('button', { name: Copy.auth.signUp.link })).toBeEnabled();
  });
});
