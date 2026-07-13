/**
 * Regression locks for `lib/auth-errors.ts`, extracted from `app/(auth)/sign-in.tsx` (issue #70
 * follow-up) specifically so this mapping gets real coverage.
 *
 * The load-bearing case here is 'pwned' vs 'length'. Supabase-js throws the SAME error class
 * (`AuthWeakPasswordError`) for both a server-side leaked-password rejection (issue #70 — HIBP
 * now enforced server-side, org on Pro) and a plain too-short password — the only thing that
 * tells them apart is the `reasons` array (`['pwned']` vs `['length']`), not the error class or
 * even necessarily the message. A version of `mapAuthError` that keys off
 * `isAuthWeakPasswordError(error)` alone, without checking `reasons`, would pass every other
 * test in this file while silently telling a user with an ordinary too-short password that
 * their password was "found in a data breach" — confusing and simply false. Case 1 vs case 2
 * below is what catches that regression.
 */
import { AuthApiError, AuthPKCECodeVerifierMissingError, AuthWeakPasswordError } from '@supabase/supabase-js';

import { Copy } from '../../constants/copy';
import { mapAuthError, OAuthRedirectError, validateSignInForm } from '../auth-errors';

describe('mapAuthError', () => {
  // Case 1: the server rejected a breached password (issue #70). This is the new branch.
  it('maps a pwned AuthWeakPasswordError to passwordBreached', () => {
    const error = new AuthWeakPasswordError(
      'Password is known to be weak and easy to guess, please choose a different one.',
      422,
      ['pwned']
    );

    expect(mapAuthError(error)).toBe(Copy.auth.error.passwordBreached);
  });

  // Case 2: THE collision lock. Same error class as case 1, different `reasons` — must NOT
  // fall into the breach branch. Supabase's own message for this case doesn't even contain the
  // word "breach", so a substring-only implementation would also get this right; what this
  // case actually guards against is a typed check that keys off the class instead of `reasons`.
  it('maps a length AuthWeakPasswordError to passwordTooShort, not passwordBreached', () => {
    const error = new AuthWeakPasswordError('Password should be at least 8 characters.', 422, [
      'length',
    ]);

    expect(mapAuthError(error)).toBe(Copy.auth.error.passwordTooShort);
  });

  // Case 2b: THE ordering lock, and the reason `length` is tested before `pwned` in the mapper.
  // GoTrue accumulates `reasons` rather than picking one, so a password that is both too short
  // and breached really does come back as `['length', 'pwned']` with both sentences joined into
  // one message — verified against the live project on 2026-07-12 with "abc123", which returns
  // exactly this. Reverse the two checks in `mapAuthError` and this user is told only that their
  // password was breached: they then pick another short password, get "breached" again, and are
  // never told the 8-character rule that would actually let them through. Every other test in
  // this file still passes under that reversal — this case is the only thing that catches it.
  it('maps a combined length+pwned rejection to passwordTooShort, the more actionable one', () => {
    const error = new AuthWeakPasswordError(
      'Password should be at least 8 characters. Password is known to be weak and easy to guess, please choose a different one.',
      422,
      ['length', 'pwned']
    );

    expect(mapAuthError(error)).toBe(Copy.auth.error.passwordTooShort);
  });

  // Case 3: the ordinary too-short rejection also arrives as a plain message on a non-weak-
  // password error shape in some code paths (e.g. a validation error ahead of the weak_password
  // check) — the substring branch must still catch it independent of case 2's typed branch.
  it('maps a plain "password should be at least" message to passwordTooShort', () => {
    const error = new AuthApiError('Password should be at least 8 characters.', 400, 'validation_failed');

    expect(mapAuthError(error)).toBe(Copy.auth.error.passwordTooShort);
  });

  it('maps invalid login credentials to invalidCredentials', () => {
    const error = new AuthApiError('Invalid login credentials', 400, 'invalid_credentials');

    expect(mapAuthError(error)).toBe(Copy.auth.error.invalidCredentials);
  });

  it('maps an already-registered email to emailInUse', () => {
    const error = new Error('User already registered');

    expect(mapAuthError(error)).toBe(Copy.auth.error.emailInUse);
  });

  it('maps an unrecognized error to the generic fallback', () => {
    const error = new Error('Something the mapping has no branch for');

    expect(mapAuthError(error)).toBe(Copy.auth.error.generic);
  });

  // Callers (sign-in.tsx's catch blocks) hand this the raw caught value, which TypeScript
  // types as `unknown` and is not guaranteed to be an Error at all (e.g. `throw 'oops'`).
  it('falls back to generic for a non-Error thrown value', () => {
    expect(mapAuthError('a string, not an Error')).toBe(Copy.auth.error.generic);
  });

  // Issue #5: a failed OAuth code exchange used to be swallowed with no error shown at all
  // (see lib/auth.ts and lib/session-provider.tsx). These lock the three cases the fix has to
  // tell apart: the provider says the user declined, the provider reports some other failure,
  // and a lost/mismatched PKCE verifier — plus the "no branch = generic fallback" guarantee for
  // OAuthRedirectError specifically, since that class didn't exist before this issue.
  describe('OAuth redirect / PKCE cases (issue #5)', () => {
    it('maps a provider access_denied redirect to signInCancelled', () => {
      const error = new OAuthRedirectError('access_denied', 'The user denied the request.');

      expect(mapAuthError(error)).toBe(Copy.auth.error.signInCancelled);
    });

    // Any OTHER provider-reported code (server_error, temporarily_unavailable, ...) is a real
    // break, not a user decision — must NOT collapse into the same "cancelled" message as
    // access_denied, which would hide an actual outage from the user.
    it('maps a non-access_denied provider redirect error to the generic fallback, not signInCancelled', () => {
      const error = new OAuthRedirectError('server_error', 'The provider had an internal error.');

      const mapped = mapAuthError(error);
      expect(mapped).toBe(Copy.auth.error.generic);
      expect(mapped).not.toBe(Copy.auth.error.signInCancelled);
    });

    // The client-side half of a lost PKCE verifier: nothing was in storage to send at all.
    it('maps AuthPKCECodeVerifierMissingError to signInExpired', () => {
      const error = new AuthPKCECodeVerifierMissingError();

      expect(mapAuthError(error)).toBe(Copy.auth.error.signInExpired);
    });

    // The server-side half of the same situation: GoTrue no longer recognizes the flow state
    // the code/verifier pair claims to belong to. Every code in FLOW_STATE_ERROR_CODES must
    // resolve the same way, not just one representative code — a partial match here would
    // silently regress to the generic message for whichever code was left out.
    it.each(['flow_state_not_found', 'flow_state_expired', 'bad_code_verifier', 'bad_oauth_state', 'bad_oauth_callback'])(
      'maps AuthApiError with code %s to signInExpired',
      (code) => {
        const error = new AuthApiError('Invalid flow state, no valid flow state found.', 401, code);

        expect(mapAuthError(error)).toBe(Copy.auth.error.signInExpired);
      }
    );

    // An AuthApiError with an unrelated code must not fall into the PKCE branch just because
    // it's the same class — only a recognized flow-state code should trigger signInExpired.
    it('does not map an unrelated AuthApiError code to signInExpired', () => {
      const error = new AuthApiError('Invalid login credentials', 400, 'invalid_credentials');

      expect(mapAuthError(error)).not.toBe(Copy.auth.error.signInExpired);
    });
  });
});

// Issue #17: `handleEmailSubmit` (app/(auth)/sign-in.tsx) used to collapse every purely
// client-side validation failure into `Copy.auth.error.generic` — "Sign-in didn't go through.
// Try again." — which claims a network round-trip that never happened, since these checks all
// run BEFORE any supabase.auth.* call. `validateSignInForm` is the fix: it must return a
// field-specific string for each failure, and — the load-bearing guarantee — that string must
// never be `generic` or any other copy that could be mistaken for a real, attempted-and-rejected
// sign-in (`invalidCredentials`, `signInExpired`, etc., every string `mapAuthError` above can
// produce from an actual caught error).
describe('validateSignInForm', () => {
  const SERVER_ATTEMPT_COPY: readonly string[] = [
    Copy.auth.error.generic,
    Copy.auth.error.invalidCredentials,
    Copy.auth.error.emailInUse,
    Copy.auth.error.signInCancelled,
    Copy.auth.error.signInExpired,
    Copy.auth.error.passwordBreached,
    Copy.auth.error.passwordTooShort,
  ];

  it('returns emailRequired for an empty email, never server-attempt copy', () => {
    const result = validateSignInForm('', 'correct-horse-battery-staple');

    expect(result).toBe(Copy.auth.error.emailRequired);
    expect(SERVER_ATTEMPT_COPY).not.toContain(result);
  });

  it('returns emailRequired for a whitespace-only email', () => {
    expect(validateSignInForm('   ', 'correct-horse-battery-staple')).toBe(
      Copy.auth.error.emailRequired
    );
  });

  it('returns emailInvalid for a malformed email, never server-attempt copy', () => {
    const result = validateSignInForm('not-an-email', 'correct-horse-battery-staple');

    expect(result).toBe(Copy.auth.error.emailInvalid);
    expect(SERVER_ATTEMPT_COPY).not.toContain(result);
  });

  it('returns passwordRequired for an empty password, never server-attempt copy', () => {
    const result = validateSignInForm('runner@example.com', '');

    expect(result).toBe(Copy.auth.error.passwordRequired);
    expect(SERVER_ATTEMPT_COPY).not.toContain(result);
  });

  // Ordering lock: email is checked before password (top-to-bottom field order on screen) — a
  // form that is wrong in both fields should name the email problem first, not the password one.
  it('reports the email problem before the password problem when both are empty', () => {
    expect(validateSignInForm('', '')).toBe(Copy.auth.error.emailRequired);
  });

  it('returns null for a well-formed email and a non-empty password', () => {
    expect(validateSignInForm('runner@example.com', 'correct-horse-battery-staple')).toBeNull();
  });

  // The whole point of extracting this function (see the file header): its output space and
  // mapAuthError's output space must never overlap. If a future edit ever made a validation
  // failure return the same string as a real server rejection, this is the test that would catch
  // it — every string this function can produce must be absent from `mapAuthError`'s.
  it('never produces a string mapAuthError can also produce', () => {
    const validationOutputs = [
      validateSignInForm('', 'x'),
      validateSignInForm('not-an-email', 'x'),
      validateSignInForm('runner@example.com', ''),
    ];

    for (const output of validationOutputs) {
      expect(SERVER_ATTEMPT_COPY).not.toContain(output);
    }
  });
});
