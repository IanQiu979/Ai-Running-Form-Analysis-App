/**
 * M7 a11y re-sweep (#62) regression lock for the two password-reset screens' text fields.
 *
 * Issue #28 established the contract on `app/(auth)/sign-in.tsx`: a text field carries
 * `autoComplete` ALONGSIDE `textContentType`, and its return key submits (or chains) rather than
 * dead-ending. `textContentType` is the iOS half only — Android's autofill service reads
 * `autoComplete` — so a field with just `textContentType` silently never offers a saved
 * credential on Android. That is the same iOS/Android parity trap as issue #11's live regions,
 * and both of these screens shipped after #28 closed without picking the pattern up.
 *
 * Asserted on the rendered field's props rather than on the source text: a prop that has been
 * deleted from the JSX is what actually breaks autofill, and only a render can see that.
 */
import { render, screen } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), push: jest.fn() },
}));

jest.mock('@/lib/password-reset', () => ({
  requestPasswordReset: jest.fn(),
  validateResetEmail: jest.fn(() => null),
  updateRecoveryPassword: jest.fn(),
}));

jest.mock('@/lib/auth-errors', () => ({
  mapAuthError: jest.fn(() => 'error'),
}));

// A live session is update-password's "signal 1" — it puts the screen straight into the `ready`
// phase, which is the only phase that renders the form this test is about.
jest.mock('@/lib/session-provider', () => ({
  useSession: () => ({
    session: { user: { id: 'u1' } },
    deepLinkAuthError: null,
    clearDeepLinkAuthError: jest.fn(),
    clearPasswordRecovery: jest.fn(),
  }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      updateUser: jest.fn(),
      // update-password subscribes on mount to catch the PASSWORD_RECOVERY event.
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
  },
}));

// Imported after the mocks above are registered.
/* eslint-disable import/first */
import ResetPasswordScreen from '../reset-password';
import UpdatePasswordScreen from '../update-password';
/* eslint-enable import/first */

describe('reset-password: the email field', () => {
  it('carries autoComplete alongside textContentType, so Android autofill offers the saved email', async () => {
    await render(<ResetPasswordScreen />);

    const field = screen.getByPlaceholderText(Copy.auth.email.placeholder);

    expect(field.props.textContentType).toBe('emailAddress');
    expect(field.props.autoComplete).toBe('email');
  });

  it('submits from the keyboard rather than dead-ending on the return key', async () => {
    await render(<ResetPasswordScreen />);

    const field = screen.getByPlaceholderText(Copy.auth.email.placeholder);

    // One field on this screen, so "go" (submit), not "next" (chain to a sibling).
    expect(field.props.returnKeyType).toBe('go');
    expect(typeof field.props.onSubmitEditing).toBe('function');
  });
});

describe('update-password: the new-password field', () => {
  it('carries autoComplete alongside textContentType, so a password manager can save the new password', async () => {
    await render(<UpdatePasswordScreen />);

    const field = screen.getByPlaceholderText(Copy.auth.reset.update.password.placeholder);

    expect(field.props.textContentType).toBe('newPassword');
    expect(field.props.autoComplete).toBe('new-password');
  });

  it('submits from the keyboard rather than dead-ending on the return key', async () => {
    await render(<UpdatePasswordScreen />);

    const field = screen.getByPlaceholderText(Copy.auth.reset.update.password.placeholder);

    expect(field.props.returnKeyType).toBe('go');
    expect(typeof field.props.onSubmitEditing).toBe('function');
  });
});
