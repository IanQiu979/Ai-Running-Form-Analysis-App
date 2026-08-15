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
 *
 * ⚠️ THE 200 BODY IS camelCase, AND READING IT AS snake_case IS HOW SIGN-UP BROKE IN PRODUCTION.
 * Fixed 2026-08-15. This file used to declare the success body itself, by hand, as
 * `session: { access_token, refresh_token }` — but the edge function has only ever emitted
 * `_shared/signup-with-captcha.ts`'s `SessionPayload`, which is `{ accessToken, refreshToken,
 * expiresIn, expiresAt, tokenType }`. Both hand-written reads resolved to `undefined`, so a
 * perfectly good server-issued session was handed to `supabase.auth.setSession({ access_token:
 * undefined, refresh_token: undefined })`, which throws `AuthSessionMissingError` *before it
 * makes any network call at all*. The user was left on the form behind the generic "Sign-in
 * didn't go through" — while the account had in fact been created, so their next attempt came
 * back `email_in_use`. Live proof (project `vputdomdlknvthnzritt`, 2026-08-15T13:15:41Z): a 200
 * from this endpoint with a real session, an `auth.users` row to match, and then ZERO further
 * requests from the device — the signature of a `setSession` that never reached the wire.
 *
 * Two things now stop that recurring, and BOTH are load-bearing — neither alone is enough:
 *   1. The wire types below are IMPORTED from `@shared/signup-with-captcha`, the same module the
 *      edge function shapes its response with (the `@shared/*` alias `lib/quota.ts` already uses
 *      for exactly this "the two sides can't silently drift on field names" reason). A rename on
 *      either side is now a compile error, not a production outage.
 *   2. `readSessionPayload` below VALIDATES the two tokens are non-empty strings before anything
 *      is handed to `setSession`. A type-only import is erased at runtime and proves nothing
 *      about what the deployed function actually sent, so a mismatch that survives (1) — an old
 *      function version still deployed, say — degrades to an honest `session_malformed` code and
 *      a dev-time warning naming the fields, rather than a generic error from inside supabase-js.
 */
import type { SessionPayload, UserPayload } from '@shared/signup-with-captcha';

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
  // Client-side only, never sent by the server: a 200 arrived but its `session` object did not
  // carry the two non-empty token strings `setSession` needs. See this file's header — this is
  // the code that would have named the camelCase/snake_case break out loud instead of letting it
  // reach supabase-js as an undefined access token.
  | 'session_malformed'
  | 'unknown';

export type SignupWithCaptchaResult =
  | { ok: true; session: SignupWithCaptchaSession }
  | { ok: false; code: SignupWithCaptchaErrorCode };

/** Mirrors the `code` strings `supabase/functions/_shared/signup-with-captcha.ts`'s
 * `handleSignupWithCaptcha` emits on its 400/500 arms. This one IS hand-maintained — unlike the
 * 200 body above, which is imported — and the reason is NOT the `supabase/functions/` boundary
 * (this file crosses it at the top via `@shared/*`). It is that there is nothing over there to
 * import: `SignupResult` types these as a bare `string`, the codes exist only as inline literals
 * inside the handler's `switch`, and its `'error'` arm forwards `result.code` straight from GoTrue,
 * so the emitted set is open-ended by design and cannot be closed into a union without changing the
 * deployed function's behavior.
 *
 * THE DRIFT RISK THAT LEAVES, stated plainly: if the server renames one of these (say
 * `weak_password_pwned`), nothing fails to compile — the code silently folds to `'unknown'` and the
 * user gets the generic message instead of the actionable one. That is a copy regression, not a
 * broken session, which is why it is tolerated here where the 200-body equivalent was not.
 * Renaming a code server-side means updating this list in the same commit. */
function isKnownErrorCode(
  code: string
): code is Exclude<SignupWithCaptchaErrorCode, 'network' | 'session_malformed' | 'unknown'> {
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

/**
 * The 200 body, typed from the server's OWN declaration rather than restated here — see this
 * file's header for the outage that restating it caused. `SignupResult`'s `status: 200` arm in
 * `@shared/signup-with-captcha.ts` is literally `{ session: SessionPayload | null; user:
 * UserPayload }`, so these two lines are that arm and cannot drift from it silently.
 */
interface SignupWithCaptchaResponseBody {
  session: SessionPayload | null;
  user: UserPayload;
}

/**
 * Narrows an unvalidated `session` field off the wire to the two tokens `setSession` requires.
 * Returns `null` when either is missing or blank — which, per this file's header, is the check
 * that turns a wire-contract break into a named error code instead of an `AuthSessionMissingError`
 * raised deep inside supabase-js with an empty request log behind it.
 *
 * The parameter is deliberately `unknown`, not `SessionPayload | null`: the compile-time type is
 * erased at runtime and describes what the CURRENTLY-CHECKED-OUT shared module says, not what the
 * deployed function actually sent. This function exists precisely for the case where those two
 * disagree, so it cannot be allowed to assume they don't.
 */
function readSessionPayload(session: unknown): SignupWithCaptchaSession | null {
  if (session === null || typeof session !== 'object') return null;
  const { accessToken, refreshToken } = session as Record<string, unknown>;
  if (typeof accessToken !== 'string' || accessToken.length === 0) return null;
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) return null;
  return { accessToken, refreshToken };
}

/**
 * `__DEV__`-guarded operator diagnostic, same contract as `lib/turnstile-config.ts`'s
 * `warnUnusable`: a release build stays silent, and NO token value is ever logged — only the
 * field names present on the object, which is the thing being debugged. Without this, the only
 * signal a wire-contract break gives is a generic error message on screen.
 */
function warnMalformedSession(value: unknown): void {
  if (!__DEV__) return;
  const fields = value !== null && typeof value === 'object' ? Object.keys(value).join(', ') : String(value);
  console.warn(
    `[signup-with-captcha] the 200 response did not carry usable accessToken/refreshToken ` +
      `strings. Fields present: ${fields}. The deployed edge function's response shape and ` +
      `@shared/signup-with-captcha's SessionPayload have diverged.`
  );
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

  if (result.data === null || typeof result.data !== 'object') {
    // `supabase.functions.invoke` yields `data: null` for a 200 whose body was empty or
    // unparseable, so this cannot be destructured blind — doing so would throw a TypeError out of a
    // function whose contract above says it never throws, skipping the named code entirely.
    warnMalformedSession(result.data);
    return { ok: false, code: 'session_malformed' };
  }

  const { session } = result.data;
  if (!session) {
    // The server itself fails safe on a sessionless success (`no_session`, a 500) — this branch
    // is a defensive fallback for a malformed 200 body, not a path the server is expected to take.
    return { ok: false, code: 'unknown' };
  }

  const parsed = readSessionPayload(session);
  if (parsed === null) {
    warnMalformedSession(session);
    return { ok: false, code: 'session_malformed' };
  }

  return { ok: true, session: parsed };
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
