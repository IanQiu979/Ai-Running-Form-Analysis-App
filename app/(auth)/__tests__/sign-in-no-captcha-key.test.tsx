/**
 * Regression lock for the v23-launch-audit-r1 §3.1/§5.2 blocker (report bug B1): with
 * `EXPO_PUBLIC_TURNSTILE_SITE_KEY` unset, `app/(auth)/sign-in.tsx` rendered no Turnstile widget,
 * therefore issued no token, therefore left "Create account" permanently disabled with NOTHING on
 * screen explaining why. The audit reproduced it against a real build; the key was empty in every
 * environment it could read.
 *
 * The button STAYING disabled is correct and these tests deliberately lock that too: sign-up
 * genuinely cannot complete without a token, which `supabase/functions/signup-with-captcha`
 * verifies server-side. What changed is only that the dead end is now explained instead of silent.
 *
 * WHY THIS IS A SEPARATE FILE FROM `sign-in.test.tsx`, which covers the key-IS-set cases:
 * `TURNSTILE_SITE_KEY` is read from the environment at MODULE-EVALUATION time, so the two cases
 * need two different module evaluations. Doing that inside one file via `jest.resetModules()` +
 * re-`require` does not work — the re-required screen picks up a second React instance while the
 * renderer keeps the first, and every hook then throws "Cannot read properties of null (reading
 * 'useMemo')". Jest already gives each test FILE its own module registry, so splitting is the
 * mechanism that actually works here. The mock block below is duplicated from `sign-in.test.tsx`
 * for the same reason: `jest.mock` factories are hoisted per-file and cannot be shared.
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

// Stubbed so that if the screen ever DID mount the widget with no site key, these testIDs would
// appear and the assertions below would catch it. Without the stub the real widget would drag a
// WebView into the test and the "no widget was rendered" assertion could pass for the wrong reason.
jest.mock('@/components/turnstile-widget', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { forwardRef } = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable, Text } = require('react-native');
  return {
    TurnstileWidget: forwardRef(function MockTurnstileWidget(
      props: { onToken: (token: string) => void; onExpire: () => void; onError: () => void },
      _ref: unknown
    ) {
      return (
        <>
          <Pressable testID="mock-turnstile-token" onPress={() => props.onToken('a-token')} />
          <Text>mock-turnstile-widget</Text>
        </>
      );
    }),
  };
});

// THE POINT OF THIS FILE: unset before `sign-in.tsx` is first evaluated. A plain ES `import` is
// hoisted above this line, hence the `require` below — same mechanism `sign-in.test.tsx` uses to
// set it, inverted.
delete process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SignInScreen = require('../sign-in').default;

describe('sign-in screen: EXPO_PUBLIC_TURNSTILE_SITE_KEY unset', () => {
  it('explains why sign-up is unavailable instead of rendering nothing', async () => {
    await render(<SignInScreen />);

    // toggleMode() flips to signUp AND opens the email form in one press (issue #16), so the
    // notice is mounted after this single press. `waitFor` is required — see sign-in.test.tsx's
    // note on PillButton's async re-render.
    fireEvent.press(screen.getByRole('button', { name: Copy.auth.signUp.link }));

    await waitFor(() => expect(screen.getByTestId('signup-unavailable-notice')).toBeTruthy());
    expect(screen.getByText(Copy.auth.signUp.unavailable.title)).toBeTruthy();
    expect(screen.getByText(Copy.auth.signUp.unavailable.body)).toBeTruthy();
    // No widget mounted, so no token can ever arrive — this is what makes the button permanently,
    // not temporarily, disabled, and therefore what makes the explanation necessary.
    expect(screen.queryByTestId('mock-turnstile-token')).toBeNull();
  });

  it('keeps the submit button disabled, but now carries the reason for a screen reader', async () => {
    await render(<SignInScreen />);

    fireEvent.press(screen.getByRole('button', { name: Copy.auth.signUp.link }));

    await waitFor(() => {
      const submit = screen.getByRole('button', { name: Copy.auth.signUp.submit });
      expect(submit).toBeDisabled();
      expect(submit.props.accessibilityHint).toBe(Copy.auth.signUp.unavailable.a11yHint);
    });
  });

  it('does not show the notice in signIn mode, which needs no captcha', async () => {
    await render(<SignInScreen />);

    // Sign-in mode is the default. The key is missing in both modes, but only sign-up needs it,
    // so telling a returning user that "creating an account isn't available" would be noise.
    expect(screen.queryByTestId('signup-unavailable-notice')).toBeNull();
    expect(screen.queryByText(Copy.auth.signUp.unavailable.title)).toBeNull();
  });
});
