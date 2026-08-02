/**
 * The `signup-with-captcha` client (issue #12/Known Issue #12). `app/(auth)/sign-in.tsx` calls
 * `signUpWithCaptcha` instead of `supabase.auth.signUp()` directly in sign-up mode — sign-in is
 * untouched and calls `supabase.auth.signInWithPassword()` exactly as before.
 *
 * WHY THIS EXISTS: Supabase Auth's native `auth.captcha` is project-wide, not per-endpoint —
 * verified live against the hosted project on 2026-08-02: enabling it also 400s
 * `signInWithPassword`, not just `signUp`. `supabase/functions/signup-with-captcha` puts the
 * Turnstile check in front of a plain, unprivileged `signUp()` proxy instead, so
 * `supabase/config.toml`'s `[auth.captcha]` stays disabled and sign-in is never gated. See that
 * function's `_shared/signup-with-captcha.ts` for the full story.
 *
 * Goes through issue #46's shared `lib/functions-client.ts` (`invokeFunction`), same as
 * `lib/delete-account.ts` — see that file's header for why callers don't unwrap
 * `FunctionsHttpError`/`FunctionsRelayError`/`FunctionsFetchError` themselves. This file owns only
 * what's specific to this endpoint: the 200 success shape and narrowing the wrapper's generic
 * `code: string` to the codes this function actually emits.
 *
 * ON SUCCESS, THIS FUNCTION DOES NOT SIGN THE USER IN ITSELF — it returns the session the server
 * already established (via its own `signUp()` call); the caller must hand it to
 * `supabase.auth.setSession()` to hydrate the on-device session. `lib/session-provider.tsx`'s
 * `onAuthStateChange` listener treats a `setSession`-triggered `SIGNED_IN` event identically to
 * one from `signUp`/`signInWithPassword` — no special-casing needed there.
 */
import { invokeFunction } from './functions-client';
import { supabase } from './supabase';

const EDGE_FUNCTION_NAME = 'signup-with-captcha';

export interface SignupWithCaptchaSession {
  accessToken: string;
  refreshToken: string;
}

export type SignupWithCaptchaErrorCode =
  | 'invalid_body'
  | 'captcha_invalid'
  | 'email_in_use'
  | 'weak_password_length'
  | 'weak_password_pwned'
  | 'weak_password'
  | 'signup_failed'
  | 'signup_unavailable'
  | 'no_session'
  | 'network'
  | 'unknown';

export type SignupWithCaptchaResult =
  | { ok: true; session: SignupWithCaptchaSession }
  | { ok: false; code: SignupWithCaptchaErrorCode };

/** Mirrors `supabase/functions/_shared/signup-with-captcha.ts`'s `SignupResult['body']['code']`
 * union — a hand-maintained copy, not an import, since this file cannot reach across the
 * `supabase/functions/` boundary (same convention `lib/delete-account.ts`'s
 * `isServerDeleteAccountErrorCode` documents). An unrecognized code folds to `'unknown'` rather
 * than crashing, so server-side drift degrades gracefully. */
function isKnownErrorCode(code: string): code is Exclude<SignupWithCaptchaErrorCode, 'network' | 'unknown'> {
  return (
    code === 'invalid_body' ||
    code === 'captcha_invalid' ||
    code === 'email_in_use' ||
    code === 'weak_password_length' ||
    code === 'weak_password_pwned' ||
    code === 'weak_password' ||
    code === 'signup_failed' ||
    code === 'signup_unavailable' ||
    code === 'no_session'
  );
}

interface SignupWithCaptchaResponseBody {
  session: { access_token: string; refresh_token: string } | null;
  user: { id: string; email: string | null };
}

/**
 * Calls `signup-with-captcha`. Never throws — every failure mode (validation, captcha rejection,
 * a weak/breached password, an already-registered email, a network failure) resolves to
 * `{ ok: false, code }`.
 */
export async function signUpWithCaptcha(
  email: string,
  password: string,
  captchaToken: string
): Promise<SignupWithCaptchaResult> {
  const result = await invokeFunction<SignupWithCaptchaResponseBody>(EDGE_FUNCTION_NAME, {
    method: 'POST',
    body: { email, password, captchaToken },
  });

  if (!result.ok) {
    if (result.error.kind === 'network' || result.error.kind === 'malformed') {
      return { ok: false, code: 'network' };
    }
    const { code } = result.error;
    return { ok: false, code: isKnownErrorCode(code) ? code : 'unknown' };
  }

  const { session } = result.data;
  if (!session) {
    // The server itself fails safe on a sessionless success (`no_session`, a 500) — this branch
    // is a defensive fallback for a malformed 200 body, not a path the server is expected to take.
    return { ok: false, code: 'unknown' };
  }

  return {
    ok: true,
    session: { accessToken: session.access_token, refreshToken: session.refresh_token },
  };
}

/** Hydrates the on-device session from a `signUpWithCaptcha` success — see this file's header for
 * why this is a separate step rather than something `signUpWithCaptcha` does itself. */
export async function applySignupSession(session: SignupWithCaptchaSession): Promise<void> {
  const { error } = await supabase.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
  });
  if (error) throw error;
}
