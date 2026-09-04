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
      props: {
        siteKey: string;
        baseUrl: string;
        onToken: (token: string) => void;
        onExpire: () => void;
        onError: () => void;
      },
      _ref: unknown
    ) {
      mockTurnstileProps.siteKey = props.siteKey;
      mockTurnstileProps.baseUrl = props.baseUrl;
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

/** Captures what the screen actually hands the widget — the only way to prove it from outside,
 * since neither prop has any rendered representation. Declared with `var` so it is hoisted
 * alongside the `jest.mock` factory above, which babel-jest lifts above every `const`. */
// eslint-disable-next-line no-var
var mockTurnstileProps: { siteKey?: string; baseUrl?: string } = {};

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

// `TURNSTILE_CONFIG` (app/(auth)/sign-in.tsx) is resolved from these at MODULE-EVALUATION time,
// so they must be set before `sign-in.tsx` is first required — a plain ES `import` is hoisted
// above this line, which is why this file loads the screen via `require` after setting them
// instead. Both are set explicitly rather than relying on whatever `.env` jest-expo happens to
// load: a checkout without a `.env` would otherwise resolve no config and every test in this
// file would fail on a missing widget for a reason that has nothing to do with the widget.
process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = 'test-site-key';
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://project-ref.supabase.co';
delete process.env.EXPO_PUBLIC_TURNSTILE_HOSTNAME;
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
 * Regression lock for the sign-in screen's control reachability. The low-poly mark section was
 * removed (captain's call, 2026-09-01 — "remove that shapes created running figure") along with
 * its scroll-reveal wiring; every control must still mount up front, not gated behind a scroll
 * event, both with and without reduced motion.
 */
describe('sign-in screen: control reachability', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(false);
  });

  it('mounts every control up front, not gated behind a scroll event', async () => {
    await render(<SignInScreen />);

    expect(screen.getByRole('button', { name: Copy.auth.cta.google })).toBeTruthy();
    expect(screen.getByRole('button', { name: Copy.auth.cta.email })).toBeTruthy();
    expect(screen.getByRole('button', { name: Copy.auth.signUp.link })).toBeTruthy();
  });

  it('keeps every control reachable with reduced motion on', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    await render(<SignInScreen />);

    expect(screen.getByRole('button', { name: Copy.auth.cta.google })).toBeEnabled();
    expect(screen.getByRole('button', { name: Copy.auth.cta.email })).toBeEnabled();
    expect(screen.getByRole('button', { name: Copy.auth.signUp.link })).toBeEnabled();
  });
});

/**
 * REGRESSION LOCK — v23-signup-signin-cloudflare-fix-r1. Email sign-up was impossible against
 * the live project for the whole of #166's life. Two stacked causes presented as one symptom:
 * the site key was never provisioned outside `eas.json`'s two `*-local` profiles (so the widget
 * never mounted and "Create account" was permanently disabled — verified live on 2026-08-12,
 * `auth.users` held not one email/password identity), and underneath that, the challenge was
 * loaded with no base URL, so a real site key could only ever have failed Cloudflare's hostname
 * check with error 110200.
 *
 * `lib/__tests__/turnstile-config.test.ts` proves the resolution in isolation. What only a
 * screen-level render can prove — and what the second cause actually was — is that this screen
 * passes the resolved `baseUrl` DOWN to the widget rather than dropping it on the floor. Same
 * reasoning `app/capture/__tests__/extracting.test.tsx` records for the frame-cap bug: a
 * mapping test cannot show which arguments a screen really hands downstream.
 */
describe('sign-in screen: Turnstile configuration handed to the widget', () => {
  it('gives the widget both the site key and a base URL with a real hostname', async () => {
    await render(<SignInScreen />);

    fireEvent.press(screen.getByRole('button', { name: Copy.auth.signUp.link }));
    await waitFor(() => expect(screen.getByText('mock-turnstile-widget')).toBeTruthy());

    expect(mockTurnstileProps.siteKey).toBe('test-site-key');
    // Derived from EXPO_PUBLIC_SUPABASE_URL, since no EXPO_PUBLIC_TURNSTILE_HOSTNAME is set.
    expect(mockTurnstileProps.baseUrl).toBe('https://project-ref.supabase.co/');
  });
});

/**
 * REGRESSION LOCK — the signature mark's mount (2026-09-04). `<StrideWireframeHero>` is the
 * redesign's entry animation and this screen is the only place it is mounted, so nothing else in
 * the repo would notice if it silently stopped rendering here. Two things are worth holding:
 * that it is on the screen at all, and that it is DECORATIVE — the screen deliberately gives it
 * no `accessibilityLabel`, so it must stay out of the a11y tree rather than announcing an
 * unlabelled image over the wordmark. (Hence `includeHiddenElements`: an a11y-hidden node is
 * excluded from RNTL queries by default — see CLAUDE.md § Testing.)
 *
 * The control-reachability block above is what proves the mark cannot gate the form, in both
 * motion settings; it does not need repeating here.
 */
describe('sign-in screen: the stride wireframe mark', () => {
  it('mounts the hero, hidden from assistive tech', async () => {
    await render(<SignInScreen />);

    const hero = screen.getByTestId('sign-in-stride-hero', { includeHiddenElements: true });

    expect(hero.props.accessibilityElementsHidden).toBe(true);
    expect(hero.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(screen.queryByTestId('sign-in-stride-hero')).toBeNull();
  });
});
