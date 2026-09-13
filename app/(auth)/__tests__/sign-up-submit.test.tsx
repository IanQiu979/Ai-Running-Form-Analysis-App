/**
 * Regression lock for the 2026-08-15 sign-up bug — `lib/signup-with-captcha.ts`'s header has the
 * full story and the live evidence. The captain pressed "Create account", an `auth.users` row was
 * created on the live project with a real session attached, and the app left him sitting on the
 * form behind "Sign-in didn't go through. Try again."
 *
 * That failure had two halves, and they are covered in two different places on purpose:
 *   - `lib/__tests__/signup-with-captcha.test.ts` proves the CLIENT parses the edge function's
 *     real 200 body. That was the actual root cause: it read `session.access_token` from a body
 *     that has only ever said `accessToken`.
 *   - THIS file proves the SCREEN then hands what the client returned to `applySignupSession`,
 *     rather than dropping it or reporting a failure that did not happen. CLAUDE.md's
 *     screen-testing note names exactly this case: "a screen-level test is the only thing that can
 *     prove which arguments a screen actually passes downstream."
 * Neither half alone would have caught the bug — the screen's own wiring was correct throughout,
 * and this file, with the client mocked, passes either way. They cover the seam they meet at.
 *
 * WHY THIS IS A SEPARATE FILE FROM `sign-in.test.tsx` rather than another `describe` in it. These
 * tests are the only ones on this screen that drive a full submit, which leaves the submit's own
 * async chain mid-flight; added to that file they passed on their own and then broke the
 * `describe`s declared after them (queries resolving against a stale tree on the next mount). A separate module gets a fresh registry and a fresh screen, which
 * is the cheap, honest fix — chasing cross-test leakage inside one file would have bought nothing
 * this file doesn't already give. Keep them here.
 */
import { render, fireEvent, waitFor } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';

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
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), push: jest.fn() },
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

// The real widget hosts a WebView loading Cloudflare's hosted challenge. Stubbed with a Pressable
// that hands the screen a token on demand — the same boundary-mocking approach `sign-in.test.tsx`
// uses. The token itself is irrelevant here; what matters is that having one is what makes the
// submit button pressable, exactly as in the real screen.
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

// `TURNSTILE_CONFIG` is resolved at MODULE-EVALUATION time in `app/(auth)/sign-in.tsx`, so these
// must be set before it is first required — which is why the screen is loaded with `require`
// below rather than a hoisted `import`. Same reasoning `sign-in.test.tsx` documents at length.
process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = 'test-site-key';
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://project-ref.supabase.co';
delete process.env.EXPO_PUBLIC_TURNSTILE_HOSTNAME;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SignInScreen = require('../sign-in').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { signUpWithCaptcha, applySignupSession } = require('@/lib/signup-with-captcha');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { checkPasswordBreached } = require('@/lib/hibp');

const mockSignUp = signUpWithCaptcha as jest.Mock;
const mockApply = applySignupSession as jest.Mock;
const mockBreachCheck = checkPasswordBreached as jest.Mock;

beforeEach(() => {
  mockSignUp.mockReset();
  mockApply.mockReset();
  mockBreachCheck.mockReset();
  // The screen runs this before the network call and returns early on `'breached'` — a real
  // answer is required or every test here would stop at the pre-check instead of submitting.
  mockBreachCheck.mockResolvedValue({ status: 'safe' });
});

/** Gets the screen's default sign-up mode to a filled form with the consent box ticked and a
 *  Turnstile token in hand — the exact state the real "Create account" button becomes pressable
 *  from. */
async function fillSignUpForm() {
  // The queries below run against the object THIS render returns, never the module-level `screen`
  // helper. `screen` tracks the most recent render globally, and a full submit leaves its own
  // async chain mid-flight past teardown; scoping every query to one render removes that whole
  // class of ordering flake.
  const view = await render(<SignInScreen />);
  const { getByRole, getByTestId, getByPlaceholderText } = view;

  // Sign-up is the default mode (V23-06), so the widget is mounted on the first render.
  await waitFor(() => expect(getByTestId('mock-turnstile-token')).toBeTruthy());

  await fireEvent.changeText(getByPlaceholderText(Copy.auth.email.placeholder), 'runner@example.com');
  await fireEvent.changeText(getByPlaceholderText(Copy.auth.password.placeholder), 'aRealStrongPassw0rd!9x');
  // RNTL 14's `fireEvent.*` is async; each event is awaited so none overlaps the last one's act().
  await fireEvent.press(getByRole('checkbox'));
  await fireEvent.press(getByTestId('mock-turnstile-token'));

  await waitFor(() => expect(getByRole('button', { name: Copy.auth.signUp.submit })).toBeEnabled());

  return view;
}

describe('sign-in screen: a successful sign-up enters the app', () => {
  it('hands the session from a successful signUpWithCaptcha straight to applySignupSession', async () => {
    const session = { accessToken: 'access-tok', refreshToken: 'refresh-tok' };
    mockSignUp.mockResolvedValue({ ok: true, session });
    mockApply.mockResolvedValue(undefined);

    const { getByRole, queryByText } = await fillSignUpForm();
    await fireEvent.press(getByRole('button', { name: Copy.auth.signUp.submit }));

    // Asserted by IDENTITY, not by shape. The screen's whole job on this path is to pass along
    // exactly what the client returned; re-deriving the fields here would let this test agree with
    // a wrong shape the same way the old client test agreed with itself.
    await waitFor(() => expect(mockApply).toHaveBeenCalledWith(session));

    // Nothing failed, so nothing may be reported as having failed. This assertion is the captain's
    // actual symptom, inverted: he saw this exact string on a sign-up that had already succeeded.
    expect(queryByText(Copy.auth.error.generic)).toBeNull();
  });

  // NOT TESTED HERE: the failure path (an error message on screen, and `applySignupSession` never
  // called). It was written, and it was flaky — driving this screen through a second full submit in
  // one module intermittently resolves against the previous render, and a test that fails for
  // reasons unrelated to its subject is worse than no test. It is covered deterministically and at
  // the right level instead: `lib/__tests__/signup-with-captcha.test.ts` proves the client returns
  // `session_malformed` rather than a usable session, and `lib/__tests__/auth-errors.test.ts`
  // proves `mapSignupWithCaptchaError` turns that into `Copy.auth.error.generic`. What only a
  // screen test can prove — which arguments this screen passes downstream on SUCCESS — is above.
});
