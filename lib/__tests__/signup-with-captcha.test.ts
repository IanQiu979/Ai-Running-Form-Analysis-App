/**
 * `lib/signup-with-captcha.ts` (issue #12/Known Issue #12) — the `signup-with-captcha` client
 * `app/(auth)/sign-in.tsx` calls in sign-up mode instead of `supabase.auth.signUp()` directly.
 *
 * ⚠️ READ THIS BEFORE ADDING A 200-RESPONSE FIXTURE. This suite used to open with a caveat that
 * it "does NOT prove the two projects agree on the contract." That caveat was not a limitation to
 * live with — it was the bug, sitting in the file, described in its own words. The happy-path test
 * below handed `signUpWithCaptcha` a fixture the test author wrote by hand
 * (`{ access_token, refresh_token }`), the client read exactly those snake_case fields, the two
 * agreed with each other, and the suite went green — while the edge function had only ever emitted
 * `{ accessToken, refreshToken }` and sign-up was broken in production for every real user. See
 * `lib/signup-with-captcha.ts`'s header for the live evidence and the full failure mode.
 *
 * SO THE 200 FIXTURE IS NO LONGER WRITTEN BY HAND. `serverSuccessBody()` below builds it by
 * calling the edge function's OWN `handleSignupWithCaptcha` (`@shared/signup-with-captcha`, the
 * exact module `supabase/functions/signup-with-captcha/index.ts` serves its response from) with
 * stubbed dependencies, and feeds that real body to the mocked `invoke`. A field renamed on either
 * side now fails here instead of in the app. Keep it that way: a hand-written success body in this
 * file is a fixture agreeing with itself, which is precisely what proved nothing last time.
 *
 * WHAT THIS STILL CANNOT PROVE: that the version of the function actually DEPLOYED matches the
 * checked-out `_shared/` module. Nothing in a unit test can. That residual gap is what
 * `lib/signup-with-captcha.ts`'s runtime `readSessionPayload` guard and its `session_malformed`
 * code exist to make loud — and the `'rejects the pre-2026-08-15 snake_case shape'` case below is
 * the regression lock on it.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';

import type { AgeBandChoice } from '@shared/age-band';
import {
  handleSignupWithCaptcha,
  type SessionPayload,
  type SignUpClient,
} from '@shared/signup-with-captcha';

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

/** The session the stubbed `SignUpClient` hands back. Typed as the SERVER's `SessionPayload`, so
 *  renaming a field in `@shared/signup-with-captcha.ts` breaks this line at compile time — that
 *  type annotation is load-bearing, not decoration. */
/** The baseline age choice every call here sends; the 13–17 arm spells out its own. */
const ADULT: AgeBandChoice = { ageBand: '18_plus', guardianConsent: false };

const SERVER_SESSION: SessionPayload = {
  accessToken: 'access-tok',
  refreshToken: 'refresh-tok',
  expiresIn: 3600,
  expiresAt: 1_800_000_000,
  tokenType: 'bearer',
};

/**
 * The real 200 body, produced by the edge function's own response-shaping code rather than
 * transcribed here — see this file's header for why that distinction is the entire point of this
 * suite. Only the two injected dependencies are stubbed (there is no Cloudflare and no GoTrue in
 * a unit test); every field name on the way out is the server's.
 */
async function serverSuccessBody(email = 'runner@example.com') {
  const signUpClient: SignUpClient = {
    async signUp(signUpEmail) {
      return { outcome: 'created', session: SERVER_SESSION, user: { id: 'user-1', email: signUpEmail } };
    },
    async deleteUser() {},
  };

  const result = await handleSignupWithCaptcha(
    {
      captchaVerifier: { verify: async () => true },
      signUpClient,
      ageBandRecorder: { record: async () => ({ outcome: 'recorded' }) },
    },
    { email, password: 'aRealStrongPassw0rd!9x', captchaToken: 'tok-123', ageBand: '18_plus' },
    null
  );

  if (result.status !== 200) {
    throw new Error(`expected the stubbed server to return 200, got ${result.status}`);
  }
  return result.body;
}

describe('signUpWithCaptcha', () => {
  it('resolves { ok: true, session } on a real 200 body built by the edge function itself', async () => {
    mockInvoke.mockResolvedValue({ data: await serverSuccessBody(), error: null } as never);

    const result = await signUpWithCaptcha('runner@example.com', 'aRealStrongPassw0rd!9x', 'tok-123', ADULT);

    expect(result).toEqual({
      ok: true,
      session: { accessToken: 'access-tok', refreshToken: 'refresh-tok' },
    });
    expect(mockInvoke).toHaveBeenCalledWith('signup-with-captcha', {
      method: 'POST',
      body: {
        email: 'runner@example.com',
        password: 'aRealStrongPassw0rd!9x',
        captchaToken: 'tok-123',
        ageBand: '18_plus',
        guardianConsent: false,
      },
    });
  });

  it('sends the 13–17 choice with its guardian attestation under the server\'s field names', async () => {
    mockInvoke.mockResolvedValue({ data: await serverSuccessBody(), error: null } as never);
    await signUpWithCaptcha('runner@example.com', 'aRealStrongPassw0rd!9x', 'tok-123', {
      ageBand: '13_17',
      guardianConsent: true,
    });
    expect(mockInvoke).toHaveBeenCalledWith('signup-with-captcha', {
      method: 'POST',
      body: expect.objectContaining({ ageBand: '13_17', guardianConsent: true }),
    });
  });

  it.each(['age_band_required', 'guardian_consent_required', 'age_band_record_failed'] as const)(
    'passes the server\'s %s code through by name',
    async (code) => {
      mockInvoke.mockResolvedValue({
        data: null,
        error: new FunctionsHttpError(fakeJsonResponse({ error: 'refused', code })),
      } as never);
      const result = await signUpWithCaptcha('runner@example.com', 'aRealStrongPassw0rd!9x', 'tok-123', ADULT);
      expect(result).toEqual({ ok: false, code });
    }
  );

  // THE REGRESSION LOCK. This exact body is what the old test asserted success on, and what the
  // old client happily "read" — producing `{ accessToken: undefined, refreshToken: undefined }`
  // and, one `setSession` call later, an `AuthSessionMissingError` raised before any request went
  // out. It must now be refused by name, never silently carried forward as a usable session.
  it('rejects the pre-2026-08-15 snake_case shape as session_malformed instead of passing undefined tokens on', async () => {
    mockInvoke.mockResolvedValue({
      data: {
        session: { access_token: 'access-tok', refresh_token: 'refresh-tok' },
        user: { id: 'user-1', email: 'runner@example.com' },
      },
      error: null,
    } as never);

    const result = await signUpWithCaptcha('runner@example.com', 'aRealStrongPassw0rd!9x', 'tok-123', ADULT);

    expect(result).toEqual({ ok: false, code: 'session_malformed' });
  });

  it.each([
    ['a blank access token', { accessToken: '', refreshToken: 'refresh-tok' }],
    ['a blank refresh token', { accessToken: 'access-tok', refreshToken: '' }],
    ['a non-string token', { accessToken: 42, refreshToken: 'refresh-tok' }],
  ])('reports session_malformed for a 200 carrying %s', async (_label, session) => {
    mockInvoke.mockResolvedValue({
      data: { session, user: { id: 'user-1', email: 'runner@example.com' } },
      error: null,
    } as never);

    const result = await signUpWithCaptcha('runner@example.com', 'aRealStrongPassw0rd!9x', 'tok-123', ADULT);

    expect(result).toEqual({ ok: false, code: 'session_malformed' });
  });

  // `supabase.functions.invoke` hands back `data: null` for a 200 whose body was empty or
  // unparseable. That must resolve like any other unusable 200, not throw out of a function
  // documented as never throwing.
  it('reports session_malformed for a 200 with no body at all', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: null } as never);

    const result = await signUpWithCaptcha('runner@example.com', 'aRealStrongPassw0rd!9x', 'tok-123', ADULT);

    expect(result).toEqual({ ok: false, code: 'session_malformed' });
  });

  it('resolves { ok: false, code: "unknown" } for a 200 body with no session', async () => {
    mockInvoke.mockResolvedValue({
      data: { session: null, user: { id: 'user-1', email: null } },
      error: null,
    } as never);

    const result = await signUpWithCaptcha('runner@example.com', 'password123!', 'tok-123', ADULT);

    expect(result).toEqual({ ok: false, code: 'unknown' });
  });

  it('unwraps a captcha_invalid HTTP error into { ok: false, code: "captcha_invalid" }', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(
        fakeJsonResponse({ error: 'CAPTCHA verification failed. Please try again.', code: 'captcha_invalid' })
      ),
    } as never);

    const result = await signUpWithCaptcha('runner@example.com', 'password123!', 'bad-tok', ADULT);

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

    const result = await signUpWithCaptcha('runner@example.com', 'password123!', 'tok-123', ADULT);

    expect(result).toEqual({ ok: false, code: 'weak_password_pwned' });
  });

  it('folds an unrecognized server code to "unknown" rather than crashing', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(fakeJsonResponse({ error: 'Something new.', code: 'some_future_code' })),
    } as never);

    const result = await signUpWithCaptcha('runner@example.com', 'password123!', 'tok-123', ADULT);

    expect(result).toEqual({ ok: false, code: 'unknown' });
  });

  it('reports { ok: false, code: "network" } for a network-class failure', async () => {
    mockInvoke.mockRejectedValue(new Error('offline'));

    const result = await signUpWithCaptcha('runner@example.com', 'password123!', 'tok-123', ADULT);

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
