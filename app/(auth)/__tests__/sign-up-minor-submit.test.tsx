/**
 * The 13–17 sign-up, end to end through the screen: a full submit with the guardian attestation
 * ticked hands `signUpWithCaptcha` exactly `{ ageBand: '13_17', guardianConsent: true }` and then
 * the session to `applySignupSession`. Its own module for the one-full-submit-per-file reason
 * `sign-up-submit.test.tsx`'s header records (that file is the 18+ twin).
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
const { signUpWithCaptcha, applySignupSession } = require('@/lib/signup-with-captcha');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { checkPasswordBreached } = require('@/lib/hibp');

describe('sign-in screen: a 13–17 sign-up with the attestation', () => {
  it('sends ageBand 13_17 with guardianConsent true and enters the app', async () => {
    (checkPasswordBreached as jest.Mock).mockResolvedValue({ status: 'safe' });
    const session = { accessToken: 'access-tok', refreshToken: 'refresh-tok' };
    (signUpWithCaptcha as jest.Mock).mockResolvedValue({ ok: true, session });
    (applySignupSession as jest.Mock).mockResolvedValue(undefined);

    const view = await render(<SignInScreen />);
    await waitFor(() => expect(view.getByTestId('mock-turnstile-token')).toBeTruthy());

    await fireEvent.changeText(view.getByPlaceholderText(Copy.auth.email.placeholder), 'runner@example.com');
    await fireEvent.changeText(view.getByPlaceholderText(Copy.auth.password.placeholder), 'aRealStrongPassw0rd!9x');
    await fireEvent.press(view.getByTestId('signup-age-13-17'));
    await waitFor(() => expect(view.getByTestId('signup-age-guardian-consent')).toBeTruthy());
    await fireEvent.press(view.getByTestId('signup-age-guardian-consent'));
    await fireEvent.press(view.getByTestId('signup-consent'));
    await fireEvent.press(view.getByTestId('mock-turnstile-token'));
    await waitFor(() => expect(view.getByRole('button', { name: Copy.auth.signUp.submit })).toBeEnabled());

    await fireEvent.press(view.getByRole('button', { name: Copy.auth.signUp.submit }));

    await waitFor(() => expect(applySignupSession).toHaveBeenCalledWith(session));
    expect(signUpWithCaptcha).toHaveBeenCalledWith('runner@example.com', 'aRealStrongPassw0rd!9x', 'a-token', {
      ageBand: '13_17',
      guardianConsent: true,
    });
    expect(view.queryByText(Copy.auth.error.generic)).toBeNull();
  });
});
