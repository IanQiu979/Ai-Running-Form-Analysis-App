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
import { AuthApiError, AuthWeakPasswordError } from '@supabase/supabase-js';

import { Copy } from '../../constants/copy';
import { mapAuthError } from '../auth-errors';

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
});
