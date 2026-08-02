/**
 * `lib/signup-with-captcha.ts` (issue #12/Known Issue #12) — the `signup-with-captcha` client
 * `app/(auth)/sign-in.tsx` calls in sign-up mode instead of `supabase.auth.signUp()` directly.
 *
 * WHAT THIS SUITE PROVES, AND WHAT IT CANNOT: it proves `signUpWithCaptcha` reads the documented
 * `{ session, user }` response shape correctly, never reports success without a session, folds
 * an unrecognized server `code` to `'unknown'` rather than crashing, and that `applySignupSession`
 * hydrates the on-device session via `supabase.auth.setSession`. It does NOT prove the edge
 * function itself behaves correctly (that's `supabase/functions/_shared/__tests__/
 * signup-with-captcha.deno.test.ts`) and does NOT prove the two projects agree on the contract —
 * same drift-risk caveat `lib/delete-account.ts`'s header documents for its own hand-mirrored
 * error codes.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: {
    functions: { invoke: jest.fn() },
    auth: { setSession: jest.fn() },
  },
}));

const mockInvoke = supabase.functions.invoke as jest.MockedFunction<typeof supabase.functions.invoke>;
const mockSetSession = supabase.auth.setSession as jest.MockedFunction<typeof supabase.auth.setSession>;

// Re-imported after the mocks are registered, matching this repo's established pattern
// (lib/__tests__/delete-account.test.ts mocks `../supabase` the same way).
import { applySignupSession, signUpWithCaptcha } from '../signup-with-captcha';

beforeEach(() => {
  mockInvoke.mockReset();
  mockSetSession.mockReset();
});

/** A minimal fake `Response`-shaped object — all `invokeFunction` ever calls on
 *  `FunctionsHttpError.context` is `.json()`. */
function fakeJsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

describe('signUpWithCaptcha', () => {
  it('resolves { ok: true, session } on a 200 with a session', async () => {
    mockInvoke.mockResolvedValue({
      data: {
        session: { access_token: 'access-tok', refresh_token: 'refresh-tok' },
        user: { id: 'user-1', email: 'runner@example.com' },
      },
      error: null,
    } as never);

    const result = await signUpWithCaptcha('runner@example.com', 'aRealStrongPassw0rd!9x', 'tok-123');

    expect(result).toEqual({
      ok: true,
      session: { accessToken: 'access-tok', refreshToken: 'refresh-tok' },
    });
    expect(mockInvoke).toHaveBeenCalledWith('signup-with-captcha', {
      method: 'POST',
      body: { email: 'runner@example.com', password: 'aRealStrongPassw0rd!9x', captchaToken: 'tok-123' },
    });
  });

  it('resolves { ok: false, code: "unknown" } for a 200 body with no session', async () => {
    mockInvoke.mockResolvedValue({
      data: { session: null, user: { id: 'user-1', email: null } },
      error: null,
    } as never);

    const result = await signUpWithCaptcha('runner@example.com', 'password123!', 'tok-123');

    expect(result).toEqual({ ok: false, code: 'unknown' });
  });

  it('unwraps a captcha_invalid HTTP error into { ok: false, code: "captcha_invalid" }', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(
        fakeJsonResponse({ error: 'CAPTCHA verification failed. Please try again.', code: 'captcha_invalid' })
      ),
    } as never);

    const result = await signUpWithCaptcha('runner@example.com', 'password123!', 'bad-tok');

    expect(result).toEqual({ ok: false, code: 'captcha_invalid' });
  });

  it('reports the server-decided weak_password_pwned code', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(
        fakeJsonResponse({
          error: 'Password is known to be weak and easy to guess, please choose a different one.',
          code: 'weak_password_pwned',
        })
      ),
    } as never);

    const result = await signUpWithCaptcha('runner@example.com', 'password123!', 'tok-123');

    expect(result).toEqual({ ok: false, code: 'weak_password_pwned' });
  });

  it('folds an unrecognized server code to "unknown" rather than crashing', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(fakeJsonResponse({ error: 'Something new.', code: 'some_future_code' })),
    } as never);

    const result = await signUpWithCaptcha('runner@example.com', 'password123!', 'tok-123');

    expect(result).toEqual({ ok: false, code: 'unknown' });
  });

  it('reports { ok: false, code: "network" } for a network-class failure', async () => {
    mockInvoke.mockRejectedValue(new Error('offline'));

    const result = await signUpWithCaptcha('runner@example.com', 'password123!', 'tok-123');

    expect(result).toEqual({ ok: false, code: 'network' });
  });
});

describe('applySignupSession', () => {
  it('hydrates the on-device session via supabase.auth.setSession', async () => {
    mockSetSession.mockResolvedValue({ data: { session: null, user: null }, error: null } as never);

    await applySignupSession({ accessToken: 'access-tok', refreshToken: 'refresh-tok' });

    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: 'access-tok',
      refresh_token: 'refresh-tok',
    });
  });

  it('throws whatever setSession reports as an error', async () => {
    const sessionError = new Error('invalid refresh token');
    mockSetSession.mockResolvedValue({ data: { session: null, user: null }, error: sessionError } as never);

    await expect(applySignupSession({ accessToken: 'a', refreshToken: 'b' })).rejects.toThrow(
      'invalid refresh token'
    );
  });
});
