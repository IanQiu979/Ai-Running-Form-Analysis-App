/**
 * Maps a caught sign-in/sign-up error to the copy deck's fixed strings (screen 1). Also home to
 * `validateSignInForm` (issue #17), the client-side form-validation counterpart — deliberately
 * kept in this same module rather than `sign-in.tsx` so it gets the same unit-test coverage as
 * everything else here, and so its output can never accidentally converge with a real
 * server-error string produced by `mapAuthError` below.
 *
 * Extracted out of `app/(auth)/sign-in.tsx` (issue #70 follow-up) purely so this
 * security-relevant mapping gets real unit-test coverage — screens themselves are not
 * unit-tested by convention (CLAUDE.md § Testing). Every branch that existed before the
 * extraction behaves identically; the only new branch is the leaked-password one below.
 *
 * Takes the raw caught value (`unknown`), not just its `.message` string, because the
 * leaked-password branch needs supabase-js's typed `AuthWeakPasswordError.reasons` array, not a
 * pattern-match over text. Supabase's server now enforces HaveIBeenPwned itself (issue #70: the
 * org moved to Pro; `password_hibp_enabled = true` was applied to the hosted project on
 * 2026-07-12 — see `lib/hibp.ts`'s header for the full story) and rejects a breached password
 * with HTTP 422, `error_code: 'weak_password'`, `reasons: ['pwned']`. That is exactly the case
 * `lib/hibp.ts`'s client-side pre-check exists to catch before the round-trip even happens, and
 * exactly the case it can miss on its own — it fails open on a HIBP timeout/outage by design
 * (issue #74). Without the branch below, a breached password that slips past the client
 * pre-check surfaced only the generic "Sign-in didn't go through" message: true, but useless —
 * it gave the user no hint of what was actually wrong or how to fix it.
 *
 * IMPORTANT: Supabase returns the same `weak_password` / `AuthWeakPasswordError` for a too-short
 * password as for a breached one — the ONLY thing that separates them is the `reasons` array, not
 * the error class and not reliably the message. And `reasons` is a set, not a tag: GoTrue
 * accumulates it, so a password that is both too short and breached returns `['length', 'pwned']`
 * (verified against the live project on 2026-07-12). Two consequences, both load-bearing:
 *   1. Treating every `AuthWeakPasswordError` as a breach would tell a user with an ordinary
 *      too-short password that it "showed up in a data breach" — confusing and simply false.
 *   2. Checking `pwned` before `length` would do the same thing to the `['length', 'pwned']` case,
 *      which is why `length` is tested first below. It is the more actionable of the two: a user
 *      told only "breached" picks another short password and never learns the rule that would let
 *      them through.
 * `sign-in.tsx` also runs a client-side length pre-check before `signUp`, which masks case 2 on
 * that screen today — but this is a shared `lib/` module (a password-reset flow is the obvious
 * next caller), so the guarantee has to live here, not in one screen's call ordering.
 */
import { isAuthApiError, isAuthPKCECodeVerifierMissingError, isAuthWeakPasswordError } from '@supabase/supabase-js';

import { Copy } from '@/constants/copy';
import type { SignupWithCaptchaErrorCode } from './signup-with-captcha';

/**
 * Thrown by `createSessionFromUrl` (lib/auth.ts) when the OAuth redirect URL itself carries a
 * provider-reported outcome — Supabase forwards Google's own `error`/`error_description` query
 * params straight onto the app's redirect without ever reaching the token exchange (issue #5).
 * Kept as its own class rather than a plain `Error` so `mapAuthError` can branch on the
 * provider's stable `code` (`'access_denied'`, etc.) instead of pattern-matching
 * human-readable, potentially-localized text.
 */
export class OAuthRedirectError extends Error {
  constructor(
    /** The raw `error` query param from the redirect, e.g. `'access_denied'`. */
    readonly code: string,
    description?: string
  ) {
    super(description ?? code);
    this.name = 'OAuthRedirectError';
  }
}

/**
 * GoTrue error codes (see `@supabase/auth-js`'s `error-codes.ts`) that all describe the same
 * user-facing situation: the PKCE flow state didn't match by the time the redirect came back —
 * the code was replayed, expired, or issued against a verifier the server no longer has on
 * file. Distinct from `AuthPKCECodeVerifierMissingError` below, which is the client-side mirror
 * of the same problem (nothing in local storage to send at all). Issue #5 — the PKCE verifier is
 * stored client-side and a lost/rotated verifier is a real failure mode in this app, not an edge
 * case to leave unhandled.
 */
const FLOW_STATE_ERROR_CODES = new Set([
  'flow_state_not_found',
  'flow_state_expired',
  'bad_code_verifier',
  'bad_oauth_state',
  'bad_oauth_callback',
]);

function isValidEmail(value: string): boolean {
  return /\S+@\S+\.\S+/.test(value.trim());
}

/**
 * Client-side field validation for the sign-in/sign-up form (issue #17), run BEFORE any network
 * call in `handleEmailSubmit` (app/(auth)/sign-in.tsx). Kept as its own function, entirely
 * separate from `mapAuthError` below, because the two answer different questions: this one
 * decides whether the form is even well-formed enough to send; `mapAuthError` only ever runs on
 * a value caught from an actual attempted request. Collapsing the two used to produce a
 * dishonest result — a malformed email, which never left the device, surfaced the exact same
 * "Sign-in didn't go through. Try again." copy as a real server rejection, claiming a
 * round-trip that never happened.
 *
 * Returns the copy string for the first violated rule, in the order a user encounters the
 * fields top-to-bottom on screen (email, then password), or `null` if the form is well-formed
 * enough to submit. Never returns `Copy.auth.error.generic` or any other string that implies a
 * server was contacted — that is the whole guarantee this function exists to hold.
 */
export function validateSignInForm(email: string, password: string): string | null {
  const trimmedEmail = email.trim();
  if (!trimmedEmail) {
    return Copy.auth.error.emailRequired;
  }
  if (!isValidEmail(trimmedEmail)) {
    return Copy.auth.error.emailInvalid;
  }
  if (!password) {
    return Copy.auth.error.passwordRequired;
  }
  return null;
}

export function mapAuthError(error: unknown): string {
  // Typed check first — see header. `reasons` is a set, not a tag: GoTrue ACCUMULATES it, so a
  // password that is both too short and breached comes back as `['length', 'pwned']` with both
  // sentences joined into one message (verified live, 2026-07-12: "abc123" → exactly that).
  // Length is therefore tested first, and deliberately so — it is the more actionable of the
  // two. Told only "breached", a user with a short breached password picks another short
  // password, hits "breached" again, and is never told the one rule that would actually let
  // them through. Order here is the whole guarantee: reverse these two and that regression is
  // silent, since every single-reason case still passes.
  if (isAuthWeakPasswordError(error)) {
    if (error.reasons.includes('length')) {
      return Copy.auth.error.passwordTooShort;
    }
    if (error.reasons.includes('pwned')) {
      return Copy.auth.error.passwordBreached;
    }
  }

  // Issue #5: the OAuth redirect URL carried a provider-reported outcome, not an exchange
  // failure — see OAuthRedirectError's own doc comment above. `access_denied` is the user
  // declining on the provider's own consent screen; every other provider code (`server_error`,
  // `temporarily_unavailable`, etc.) is a genuine break and falls through to the same generic
  // message an exchange failure gets, deliberately — the user can't do anything different for
  // either one beyond "try again."
  if (error instanceof OAuthRedirectError) {
    if (error.code === 'access_denied') {
      return Copy.auth.error.signInCancelled;
    }
    return Copy.auth.error.generic;
  }

  // Issue #5: a lost/rotated PKCE verifier — either nothing was left in client storage to send
  // (AuthPKCECodeVerifierMissingError, thrown locally before any request goes out) or the server
  // rejected what was sent as no longer matching (FLOW_STATE_ERROR_CODES above). Both get the
  // same message because the fix is identical either way: start the sign-in over.
  if (
    isAuthPKCECodeVerifierMissingError(error) ||
    (isAuthApiError(error) && !!error.code && FLOW_STATE_ERROR_CODES.has(error.code))
  ) {
    return Copy.auth.error.signInExpired;
  }

  const message = error instanceof Error ? error.message : String(error);
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials') || m.includes('invalid credentials')) {
    return Copy.auth.error.invalidCredentials;
  }
  if (m.includes('already registered') || m.includes('already exists') || m.includes('user already')) {
    return Copy.auth.error.emailInUse;
  }
  if (m.includes('password should be at least')) {
    return Copy.auth.error.passwordTooShort;
  }
  return Copy.auth.error.generic;
}

/**
 * Maps a `signUpWithCaptcha` (lib/signup-with-captcha.ts) failure `code` to copy — the sign-up
 * equivalent of `mapAuthError` above, for the one path that no longer throws a `supabase-js`
 * error directly (issue #12/Known Issue #12: sign-up now proxies through
 * `signup-with-captcha`, an edge function, whose failures arrive as a `{ code }` string, not a
 * typed `AuthError`).
 *
 * `weak_password_length` vs `weak_password_pwned` is decided SERVER-SIDE (`supabase/functions/
 * _shared/signup-with-captcha.ts`), with the SAME length-before-pwned priority `mapAuthError`
 * uses above and for the same reason — `reasons` is a set GoTrue accumulates, not a single tag,
 * and length is the more actionable of the two. This file only picks the copy for whichever one
 * the server already decided; it does not re-derive the priority.
 */
export function mapSignupWithCaptchaError(code: SignupWithCaptchaErrorCode): string {
  switch (code) {
    case 'captcha_invalid':
      return Copy.auth.error.captchaInvalid;
    case 'email_in_use':
      return Copy.auth.error.emailInUse;
    case 'weak_password_length':
      return Copy.auth.error.passwordTooShort;
    case 'weak_password_pwned':
      return Copy.auth.error.passwordBreached;
    case 'weak_password':
    case 'invalid_body':
    case 'signup_failed':
    case 'signup_unavailable':
    case 'no_session':
    case 'network':
    // `session_malformed` is a build/deploy fault, not anything the user did or can fix, so it
    // deliberately shares the generic copy — inventing a new user-facing string for "our two
    // sides disagree about a field name" would explain nothing to a reader. The signal an
    // operator needs is emitted separately and in dev only, by `lib/signup-with-captcha.ts`'s
    // `warnMalformedSession`; the same split `lib/turnstile-config.ts` uses for its own
    // misconfiguration branches (one honest on-screen notice, one dev-only diagnostic).
    case 'session_malformed':
    case 'unknown':
      return Copy.auth.error.generic;
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}
