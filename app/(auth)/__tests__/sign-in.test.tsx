/**
 * Regression lock for the Turnstile expiry-message fix (no-mistakes review, Known Issue #12).
 * Before this fix, `onExpire` cleared the captcha token but never told the user why the submit
 * button re-disabled itself — the widget silently expired and the screen went quiet. This proves
 * the wiring in `app/(auth)/sign-in.tsx` itself (not just that `TurnstileWidget` fires `onExpire`,
 * which `components/__tests__/turnstile-widget.test.tsx` already covers): that firing `onExpire`
 * surfaces `Copy.auth.error.captchaExpired` on screen, in signUp mode, without a real WebView.
 */
import { render, fireEvent, waitFor } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';

/** What the mocked `useLocalSearchParams` serves — empty (no `?mode=`) unless a test sets it. */
let mockSearchParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => mockSearchParams,
}));

beforeEach(() => {
  mockSearchParams = {};
});

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
    const view = await render(<SignInScreen />);

    // Sign-up is the default mode (V23-06's first artboard), so the widget is mounted on the
    // first render — no mode toggle needed. `waitFor` because the screen's 250 ms mount
    // entrance defers the commit past the same tick.
    await waitFor(() => expect(view.getByTestId('mock-turnstile-expire')).toBeTruthy());

    expect(view.queryByText(Copy.auth.error.captchaExpired)).toBeNull();

    await fireEvent.press(view.getByTestId('mock-turnstile-expire'));

    await waitFor(() =>
      expect(view.getByText(Copy.auth.error.captchaExpired)).toBeTruthy()
    );
  });

  it('re-disables the submit button after expiry even if a token had been issued', async () => {
    const view = await render(<SignInScreen />);

    await waitFor(() => expect(view.getByTestId('mock-turnstile-token')).toBeTruthy());

    // RNTL 14's `fireEvent.*` is async — an un-awaited press followed by another trips React's
    // "overlapping act() calls" and the second press is dropped, so every event here is awaited.
    await fireEvent.press(view.getByTestId('mock-turnstile-token'));
    await waitFor(() =>
      expect(view.getByRole('button', { name: Copy.auth.signUp.submit })).toBeDisabled()
    );
    await fireEvent.press(view.getByTestId('signup-age-18-plus'));
    await fireEvent.press(view.getByTestId('signup-consent'));
    await fireEvent.press(view.getByTestId('signup-future-uploads-consent'));
    await waitFor(() =>
      expect(view.getByRole('button', { name: Copy.auth.signUp.submit })).toBeEnabled()
    );

    await fireEvent.press(view.getByTestId('mock-turnstile-expire'));

    await waitFor(() => {
      expect(view.getByRole('button', { name: Copy.auth.signUp.submit })).toBeDisabled();
      expect(view.getByText(Copy.auth.error.captchaExpired)).toBeTruthy();
    });
  });
});

/**
 * V23-06's consent line is a real gate, not decoration: "Create account" needs a captcha token,
 * the ticked box AND (since 2026-09-20) a complete age choice. Any one missing leaves the button
 * disabled. The age choice's own arms (13–17 needs the attestation, the local refusals, what is
 * sent) live in sign-up-age-band.test.tsx.
 */
describe('sign-in screen: the consent checkbox gates sign-up', () => {
  it('stays disabled with a token and an age but no consent, and enables once all three are present', async () => {
    const view = await render(<SignInScreen />);

    await waitFor(() => expect(view.getByTestId('mock-turnstile-token')).toBeTruthy());
    await fireEvent.press(view.getByTestId('mock-turnstile-token'));
    await fireEvent.press(view.getByTestId('signup-age-18-plus'));
    await waitFor(() =>
      expect(view.getByRole('button', { name: Copy.auth.signUp.submit })).toBeDisabled()
    );

    const checkbox = view.getByTestId('signup-consent');
    expect(checkbox.props.accessibilityState.checked).toBe(false);
    await fireEvent.press(checkbox);
    await fireEvent.press(view.getByTestId('signup-future-uploads-consent'));

    await waitFor(() => {
      expect(view.getByTestId('signup-consent').props.accessibilityState.checked).toBe(true);
      expect(view.getByRole('button', { name: Copy.auth.signUp.submit })).toBeEnabled();
    });
  });

  it('stays disabled with consent but no token', async () => {
    const view = await render(<SignInScreen />);

    await waitFor(() => expect(view.getByTestId('signup-consent')).toBeTruthy());
    await fireEvent.press(view.getByTestId('signup-consent'));

    await waitFor(() =>
      expect(view.getByTestId('signup-consent').props.accessibilityState.checked).toBe(true)
    );
    expect(view.getByRole('button', { name: Copy.auth.signUp.submit })).toBeDisabled();
  });

  it('does not render the checkbox in sign-in mode', async () => {
    const view = await render(<SignInScreen />);

    await fireEvent.press(view.getByRole('button', { name: Copy.auth.signIn.switchLink }));

    await waitFor(() =>
      expect(view.getByRole('button', { name: Copy.auth.signIn.submit })).toBeTruthy()
    );
    expect(view.queryByRole('checkbox')).toBeNull();
  });

  // Security audit, 2026-09-14: the button's `disabled` is not the gate — the password field's
  // return key calls the submit handler directly, and "Continue with Google" is a second way to
  // create an account. Both must refuse, locally, with the consent box unticked.
  it('refuses a return-key submit without consent, before any network call', async () => {
    const { signUpWithCaptcha } = jest.requireMock('@/lib/signup-with-captcha');
    const { checkPasswordBreached } = jest.requireMock('@/lib/hibp');
    const view = await render(<SignInScreen />);

    await waitFor(() => expect(view.getByTestId('mock-turnstile-token')).toBeTruthy());
    await fireEvent.press(view.getByTestId('mock-turnstile-token'));
    await fireEvent.changeText(view.getByPlaceholderText(Copy.auth.email.placeholder), 'runner@example.com');
    await fireEvent.changeText(view.getByPlaceholderText(Copy.auth.password.placeholder), 'aRealStrongPassw0rd!9x');

    await fireEvent(view.getByPlaceholderText(Copy.auth.password.placeholder), 'submitEditing');

    await waitFor(() => expect(view.getByText(Copy.auth.error.consentRequired)).toBeTruthy());
    expect(checkPasswordBreached).not.toHaveBeenCalled();
    expect(signUpWithCaptcha).not.toHaveBeenCalled();
  });

  // A mode toggle unmounts the widget, so a token issued before the toggle can expire with
  // nobody to report it. The round trip must drop it: consent survives, but "Create account"
  // stays disabled until the widget re-solves.
  it('drops a held captcha token across a sign-in round trip, so the button re-disables', async () => {
    const view = await render(<SignInScreen />);

    await waitFor(() => expect(view.getByTestId('mock-turnstile-token')).toBeTruthy());
    await fireEvent.press(view.getByTestId('mock-turnstile-token'));
    await fireEvent.press(view.getByTestId('signup-age-18-plus'));
    await fireEvent.press(view.getByTestId('signup-consent'));
    await fireEvent.press(view.getByTestId('signup-future-uploads-consent'));
    await waitFor(() =>
      expect(view.getByRole('button', { name: Copy.auth.signUp.submit })).toBeEnabled()
    );

    await fireEvent.press(view.getByRole('button', { name: Copy.auth.signIn.switchLink }));
    await waitFor(() =>
      expect(view.getByRole('button', { name: Copy.auth.signIn.submit })).toBeTruthy()
    );
    await fireEvent.press(view.getByRole('button', { name: Copy.auth.signUp.switchLink }));

    await waitFor(() =>
      expect(view.getByRole('button', { name: Copy.auth.signUp.submit })).toBeDisabled()
    );
    expect(view.getByTestId('signup-consent').props.accessibilityState.checked).toBe(true);
    expect(view.getByTestId('signup-future-uploads-consent').props.accessibilityState.checked).toBe(true);
    // The age choice survives the round trip too, like the consent tick.
    expect(view.getByTestId('signup-age-18-plus').props.accessibilityState.checked).toBe(true);

    await fireEvent.press(view.getByTestId('mock-turnstile-token'));
    await waitFor(() =>
      expect(view.getByRole('button', { name: Copy.auth.signUp.submit })).toBeEnabled()
    );
  });

  it('refuses Continue with Google in sign-up mode without consent', async () => {
    const { signInWithGoogle } = jest.requireMock('@/lib/auth');
    const view = await render(<SignInScreen />);

    await fireEvent.press(view.getByRole('button', { name: Copy.auth.cta.google }));

    await waitFor(() => expect(view.getByText(Copy.auth.error.consentRequired)).toBeTruthy());
    expect(signInWithGoogle).not.toHaveBeenCalled();
  });
});

/**
 * `?mode=signIn` seeds sign-in mode for update-password's deep-link-entered "Back to sign in",
 * so an expired-recovery-link user does not land on "Create account". Anything else is sign-up.
 */
describe('sign-in screen: the mode search param', () => {
  it('opens in sign-in mode for ?mode=signIn — no checkbox, no widget', async () => {
    mockSearchParams = { mode: 'signIn' };
    const view = await render(<SignInScreen />);

    await waitFor(() =>
      expect(view.getByRole('button', { name: Copy.auth.signIn.submit })).toBeTruthy()
    );
    expect(view.queryByRole('button', { name: Copy.auth.signUp.submit })).toBeNull();
    expect(view.queryByRole('checkbox')).toBeNull();
    expect(view.queryByTestId('mock-turnstile-token')).toBeNull();
    expect(view.getByRole('button', { name: Copy.auth.reset.cta.forgotPassword })).toBeTruthy();
  });

  it('keeps the sign-up default for any other value', async () => {
    mockSearchParams = { mode: 'signUp?' };
    const view = await render(<SignInScreen />);

    await waitFor(() =>
      expect(view.getByRole('button', { name: Copy.auth.signUp.submit })).toBeTruthy()
    );
    expect(view.getByTestId('signup-consent')).toBeTruthy();
    expect(view.getByTestId('signup-future-uploads-consent')).toBeTruthy();
  });
});

/**
 * Supabase OAuth creates a brand-new account for a Google identity it has never seen, in either
 * mode — so "Continue with Google" from sign-in mode is an account creation too. The sign-in
 * artboard draws no consent row at rest; the tap reveals it (same row, same testID as sign-up)
 * and refuses OAuth until it is ticked. Once ticked, the tap proceeds.
 */
describe('sign-in screen: Continue with Google needs consent in sign-in mode too', () => {
  beforeEach(() => {
    jest.requireMock('@/lib/auth').signInWithGoogle.mockClear();
  });

  it('reveals the consent row and refuses OAuth until it is ticked', async () => {
    const { signInWithGoogle } = jest.requireMock('@/lib/auth');
    mockSearchParams = { mode: 'signIn' };
    const view = await render(<SignInScreen />);

    await waitFor(() =>
      expect(view.getByRole('button', { name: Copy.auth.signIn.submit })).toBeTruthy()
    );
    expect(view.queryByTestId('signup-consent')).toBeNull();

    await fireEvent.press(view.getByRole('button', { name: Copy.auth.cta.google }));

    await waitFor(() => {
      expect(view.getByText(Copy.auth.error.consentRequired)).toBeTruthy();
      expect(view.getByTestId('signup-consent')).toBeTruthy();
    });
    expect(signInWithGoogle).not.toHaveBeenCalled();
    // Still sign-in mode: revealing consent must not flip the screen into sign-up.
    expect(view.getByRole('button', { name: Copy.auth.signIn.submit })).toBeTruthy();

    await fireEvent.press(view.getByTestId('signup-consent'));
    await waitFor(() =>
      expect(view.getByTestId('signup-consent').props.accessibilityState.checked).toBe(true)
    );
    // The Terms box alone is not enough — the future-uploads attestation gates Google too.
    await fireEvent.press(view.getByRole('button', { name: Copy.auth.cta.google }));
    await waitFor(() => expect(view.getByText(Copy.auth.error.futureUploadsConsentRequired)).toBeTruthy());
    expect(signInWithGoogle).not.toHaveBeenCalled();

    await fireEvent.press(view.getByTestId('signup-future-uploads-consent'));
    await fireEvent.press(view.getByRole('button', { name: Copy.auth.cta.google }));

    await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledTimes(1));
    expect(view.queryByText(Copy.auth.error.consentRequired)).toBeNull();
  });

  it('carries a tick given in sign-up mode across the footer toggle', async () => {
    const { signInWithGoogle } = jest.requireMock('@/lib/auth');
    const view = await render(<SignInScreen />);

    await waitFor(() => expect(view.getByTestId('signup-consent')).toBeTruthy());
    await fireEvent.press(view.getByTestId('signup-consent'));
    await fireEvent.press(view.getByTestId('signup-future-uploads-consent'));
    await fireEvent.press(view.getByRole('button', { name: Copy.auth.signIn.switchLink }));
    await waitFor(() =>
      expect(view.getByRole('button', { name: Copy.auth.signIn.submit })).toBeTruthy()
    );

    await fireEvent.press(view.getByRole('button', { name: Copy.auth.cta.google }));

    await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledTimes(1));
  });
});

/**
 * Regression lock for the sign-in screen's control reachability. Every control mounts up front
 * — nothing is gated behind a scroll event or the 250 ms mount entrance — both with and without
 * reduced motion. (The low-poly mark and its scroll-reveal wiring were removed on 2026-09-01;
 * the V23-06 rebuild kept the lock.)
 */
describe('sign-in screen: control reachability', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(false);
  });

  it('mounts every control up front, not gated behind a scroll event', async () => {
    const view = await render(<SignInScreen />);

    await waitFor(() => {
      expect(view.getByRole('button', { name: Copy.auth.cta.google })).toBeTruthy();
      expect(view.getByRole('button', { name: Copy.auth.signUp.submit })).toBeTruthy();
      expect(view.getByRole('button', { name: Copy.auth.signIn.switchLink })).toBeTruthy();
      expect(view.getByTestId('signup-consent')).toBeTruthy();
      expect(view.getByTestId('signup-future-uploads-consent')).toBeTruthy();
    });
  });

  it('keeps every control reachable with reduced motion on', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    const view = await render(<SignInScreen />);

    expect(view.getByRole('button', { name: Copy.auth.cta.google })).toBeEnabled();
    expect(view.getByRole('button', { name: Copy.auth.signIn.switchLink })).toBeEnabled();
    expect(view.getByTestId('signup-consent')).toBeEnabled();
    expect(view.getByTestId('signup-future-uploads-consent')).toBeEnabled();
  });

  it('switches to sign-in mode from the footer link and back', async () => {
    const view = await render(<SignInScreen />);

    await fireEvent.press(view.getByRole('button', { name: Copy.auth.signIn.switchLink }));
    await waitFor(() =>
      expect(view.getByRole('button', { name: Copy.auth.signIn.submit })).toBeTruthy()
    );
    expect(view.queryByTestId('mock-turnstile-widget')).toBeNull();
    // Issue #81's way back in survives the rebuild, sign-in mode only.
    expect(view.getByRole('button', { name: Copy.auth.reset.cta.forgotPassword })).toBeTruthy();

    await fireEvent.press(view.getByRole('button', { name: Copy.auth.signUp.switchLink }));
    await waitFor(() =>
      expect(view.getByRole('button', { name: Copy.auth.signUp.submit })).toBeTruthy()
    );
    expect(view.queryByRole('button', { name: Copy.auth.reset.cta.forgotPassword })).toBeNull();
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
    const view = await render(<SignInScreen />);

    await waitFor(() => expect(view.getByText('mock-turnstile-widget')).toBeTruthy());

    expect(mockTurnstileProps.siteKey).toBe('test-site-key');
    // Derived from EXPO_PUBLIC_SUPABASE_URL, since no EXPO_PUBLIC_TURNSTILE_HOSTNAME is set.
    expect(mockTurnstileProps.baseUrl).toBe('https://project-ref.supabase.co/');
  });
});
