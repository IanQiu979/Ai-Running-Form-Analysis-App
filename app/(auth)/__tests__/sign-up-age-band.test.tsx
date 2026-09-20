/**
 * The age choice on the sign-up form (2026-09-20; captain's plan mirroring V2.2's guardian
 * consent, IanQiu979/Ai-Customized-Running-Plan-App#123). What only a screen test can prove:
 * which controls the form draws in which state, what the submit button's `disabled` is keyed on,
 * and that the two LOCAL refusals fire before any network call — the return key reaches
 * `handleEmailSubmit` with the button still disabled, so the button's `disabled` is not the gate.
 *
 * No full submit here: the 13–17 send is in `sign-up-minor-submit.test.tsx` and the 18+ send in
 * `sign-up-submit.test.tsx`, one per module, for the cross-test-leakage reason the latter's
 * header records.
 */
import { render, fireEvent, waitFor } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);
jest.mock('@/lib/auth', () => ({ signInWithGoogle: jest.fn() }));
jest.mock('@/lib/hibp', () => ({ checkPasswordBreached: jest.fn() }));
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
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('@/components/turnstile-widget', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { forwardRef } = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable } = require('react-native');
  return {
    TurnstileWidget: forwardRef(function MockTurnstileWidget(
      props: { onToken: (token: string) => void },
      _ref: unknown
    ) {
      return <Pressable testID="mock-turnstile-token" onPress={() => props.onToken('a-token')} />;
    }),
  };
});

process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = 'test-site-key';
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://project-ref.supabase.co';
delete process.env.EXPO_PUBLIC_TURNSTILE_HOSTNAME;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SignInScreen = require('../sign-in').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { signUpWithCaptcha } = require('@/lib/signup-with-captcha');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { checkPasswordBreached } = require('@/lib/hibp');

const submit = (view: Awaited<ReturnType<typeof render>>) =>
  view.getByRole('button', { name: Copy.auth.signUp.submit });

beforeEach(() => {
  (signUpWithCaptcha as jest.Mock).mockReset();
  (checkPasswordBreached as jest.Mock).mockReset();
});

describe('sign-up form: the age choice', () => {
  it('draws both options and the eligibility line, and no attestation until 13–17 is picked', async () => {
    const view = await render(<SignInScreen />);
    await waitFor(() => expect(view.getByTestId('mock-turnstile-token')).toBeTruthy());

    expect(view.getByTestId('signup-age-18-plus').props.accessibilityState.checked).toBe(false);
    expect(view.getByTestId('signup-age-13-17').props.accessibilityState.checked).toBe(false);
    expect(view.getByText(Copy.auth.ageBand.eligibility)).toBeTruthy();
    expect(view.queryByTestId('signup-age-guardian-consent')).toBeNull();

    await fireEvent.press(view.getByTestId('signup-age-13-17'));

    await waitFor(() => expect(view.getByTestId('signup-age-guardian-consent')).toBeTruthy());
    expect(view.getByTestId('signup-age-13-17').props.accessibilityState.checked).toBe(true);
    expect(view.getByTestId('signup-age-guardian-consent').props.accessibilityState.checked).toBe(false);
    expect(view.getByText(Copy.auth.ageBand.guardian.checkbox)).toBeTruthy();
  });

  it('13–17 keeps the button disabled until the attestation is ticked, even with consent and a token', async () => {
    const view = await render(<SignInScreen />);
    await waitFor(() => expect(view.getByTestId('mock-turnstile-token')).toBeTruthy());

    await fireEvent.press(view.getByTestId('mock-turnstile-token'));
    await fireEvent.press(view.getByTestId('signup-consent'));
    await fireEvent.press(view.getByTestId('signup-future-uploads-consent'));
    await fireEvent.press(view.getByTestId('signup-age-13-17'));
    await waitFor(() => expect(view.getByTestId('signup-age-guardian-consent')).toBeTruthy());
    expect(submit(view)).toBeDisabled();

    await fireEvent.press(view.getByTestId('signup-age-guardian-consent'));
    await waitFor(() => expect(submit(view)).toBeEnabled());
  });

  it('18 or older needs no attestation: consent and a token are enough', async () => {
    const view = await render(<SignInScreen />);
    await waitFor(() => expect(view.getByTestId('mock-turnstile-token')).toBeTruthy());

    await fireEvent.press(view.getByTestId('mock-turnstile-token'));
    await fireEvent.press(view.getByTestId('signup-consent'));
    await fireEvent.press(view.getByTestId('signup-future-uploads-consent'));
    expect(submit(view)).toBeDisabled();
    await fireEvent.press(view.getByTestId('signup-age-18-plus'));
    await waitFor(() => expect(submit(view)).toBeEnabled());
    expect(view.queryByTestId('signup-age-guardian-consent')).toBeNull();
  });

  it('switching away from 13–17 drops the attestation, so it must be re-affirmed', async () => {
    const view = await render(<SignInScreen />);
    await waitFor(() => expect(view.getByTestId('mock-turnstile-token')).toBeTruthy());

    await fireEvent.press(view.getByTestId('signup-age-13-17'));
    await waitFor(() => expect(view.getByTestId('signup-age-guardian-consent')).toBeTruthy());
    await fireEvent.press(view.getByTestId('signup-age-guardian-consent'));
    await waitFor(() =>
      expect(view.getByTestId('signup-age-guardian-consent').props.accessibilityState.checked).toBe(true)
    );

    await fireEvent.press(view.getByTestId('signup-age-18-plus'));
    await waitFor(() => expect(view.queryByTestId('signup-age-guardian-consent')).toBeNull());
    await fireEvent.press(view.getByTestId('signup-age-13-17'));
    await waitFor(() =>
      expect(view.getByTestId('signup-age-guardian-consent').props.accessibilityState.checked).toBe(false)
    );
  });

  it('a return-key submit with no age picked is refused locally, before any network call', async () => {
    const view = await render(<SignInScreen />);
    await waitFor(() => expect(view.getByTestId('mock-turnstile-token')).toBeTruthy());
    await fireEvent.press(view.getByTestId('mock-turnstile-token'));
    await fireEvent.press(view.getByTestId('signup-consent'));
    await fireEvent.changeText(view.getByPlaceholderText(Copy.auth.email.placeholder), 'runner@example.com');
    await fireEvent.changeText(view.getByPlaceholderText(Copy.auth.password.placeholder), 'aRealStrongPassw0rd!9x');

    await fireEvent(view.getByPlaceholderText(Copy.auth.password.placeholder), 'submitEditing');

    await waitFor(() => expect(view.getByText(Copy.auth.error.ageBandRequired)).toBeTruthy());
    expect(checkPasswordBreached).not.toHaveBeenCalled();
    expect(signUpWithCaptcha).not.toHaveBeenCalled();
  });

  it('a return-key submit as 13–17 without the attestation is refused locally, by name', async () => {
    const view = await render(<SignInScreen />);
    await waitFor(() => expect(view.getByTestId('mock-turnstile-token')).toBeTruthy());
    await fireEvent.press(view.getByTestId('mock-turnstile-token'));
    await fireEvent.press(view.getByTestId('signup-consent'));
    await fireEvent.press(view.getByTestId('signup-age-13-17'));
    await fireEvent.changeText(view.getByPlaceholderText(Copy.auth.email.placeholder), 'runner@example.com');
    await fireEvent.changeText(view.getByPlaceholderText(Copy.auth.password.placeholder), 'aRealStrongPassw0rd!9x');

    await fireEvent(view.getByPlaceholderText(Copy.auth.password.placeholder), 'submitEditing');

    await waitFor(() => expect(view.getByText(Copy.auth.error.guardianConsentRequired)).toBeTruthy());
    expect(checkPasswordBreached).not.toHaveBeenCalled();
    expect(signUpWithCaptcha).not.toHaveBeenCalled();
  });

  it('is not drawn in sign-in mode', async () => {
    const view = await render(<SignInScreen />);
    await fireEvent.press(view.getByRole('button', { name: Copy.auth.signIn.switchLink }));
    await waitFor(() => expect(view.getByRole('button', { name: Copy.auth.signIn.submit })).toBeTruthy());
    expect(view.queryByTestId('signup-age-18-plus')).toBeNull();
    expect(view.queryByTestId('signup-age-13-17')).toBeNull();
    expect(view.queryByText(Copy.auth.ageBand.eligibility)).toBeNull();
  });
});
