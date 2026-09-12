/**
 * Regression locks for `lib/password-reset.ts` (issue #81 — there was previously no
 * password-reset flow at all for an email-account user locked out of their password).
 *
 * THE LOAD-BEARING GUARANTEE across the `requestPasswordReset` cases: issue #81 requires the
 * "we sent you an email" response to be identical whether or not the address has an account.
 * This module makes that true by construction — it has no branch that could ever key off
 * whether the account exists, because Supabase's own `resetPasswordForEmail` doesn't expose
 * that distinction to the caller at all (it returns `{ error: null }` uniformly either way).
 * The tests below lock the actual behavior (mapping a mocked `{ error }`/`{ error: null }`
 * response to a status), not a claim about what the real API does — that part is Supabase's
 * contract, cited in this module's own header.
 *
 * The `updateRecoveryPassword` cases lock the same length-before-breach ordering sign-up already
 * gets right (lib/auth-errors.ts's own tests cover the mirror case for the server-rejection
 * path) — a too-short password must never trigger the HIBP round-trip at all.
 */
jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: jest.fn(),
      updateUser: jest.fn(),
    },
  },
}));

// lib/password-reset.ts calls makeRedirectUri at module scope to build
// `passwordResetRedirectTo` — under Jest there's no real app.json/expo-constants manifest for it
// to resolve a URI scheme from, so it throws before the module even finishes loading. Same
// stub lib/__tests__/auth.test.ts uses for lib/auth.ts's identical module-scope call.
jest.mock('expo-auth-session', () => ({
  makeRedirectUri: jest.fn(() => 'paceanalysisai://update-password'),
}));

jest.mock('../hibp', () => ({
  checkPasswordBreached: jest.fn(),
}));

import { AuthApiError } from '@supabase/supabase-js';

import { PASSWORD_MIN_LENGTH } from '../../constants/auth';
import { Copy } from '../../constants/copy';
import { checkPasswordBreached } from '../hibp';
import {
  requestPasswordReset,
  updateRecoveryPassword,
  validateResetEmail,
} from '../password-reset';
import { supabase } from '../supabase';

const mockResetPasswordForEmail = supabase.auth.resetPasswordForEmail as jest.MockedFunction<
  typeof supabase.auth.resetPasswordForEmail
>;
const mockUpdateUser = supabase.auth.updateUser as jest.MockedFunction<
  typeof supabase.auth.updateUser
>;
const mockCheckPasswordBreached = checkPasswordBreached as jest.MockedFunction<
  typeof checkPasswordBreached
>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('validateResetEmail', () => {
  // Same guarantee as lib/auth-errors.ts's validateSignInForm: never implies a request was sent.
  it('returns emailRequired for an empty email', () => {
    expect(validateResetEmail('')).toBe(Copy.auth.error.emailRequired);
  });

  it('returns emailRequired for a whitespace-only email', () => {
    expect(validateResetEmail('   ')).toBe(Copy.auth.error.emailRequired);
  });

  it('returns emailInvalid for a malformed email', () => {
    expect(validateResetEmail('not-an-email')).toBe(Copy.auth.error.emailInvalid);
  });

  it('returns null for a well-formed email', () => {
    expect(validateResetEmail('runner@example.com')).toBeNull();
  });
});

describe('requestPasswordReset', () => {
  it('reports sent on success, and calls resetPasswordForEmail with the trimmed email and the recovery redirect', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ data: {}, error: null } as never);

    await expect(requestPasswordReset('  runner@example.com  ')).resolves.toEqual({
      status: 'sent',
    });
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith('runner@example.com', {
      redirectTo: 'paceanalysisai://update-password',
    });
  });

  // THE enumeration-safety lock: an error shaped exactly like "this account doesn't exist"
  // would, if Supabase ever surfaced one, still need to collapse to the same 'error' status a
  // network failure gets — never a distinct, existence-revealing status. There is no real
  // "user not found" error code for this endpoint (see this module's header), so this locks the
  // fallback behavior for ANY unrecognized error, which is what such a response would hit.
  it('folds an unrecognized error into the generic error status, not a distinct one', async () => {
    const error = new AuthApiError('unexpected_failure', 500, 'unexpected_failure');
    mockResetPasswordForEmail.mockResolvedValue({ data: null, error } as never);

    await expect(requestPasswordReset('runner@example.com')).resolves.toEqual({
      status: 'error',
    });
  });

  it('reports rateLimited for the over_email_send_rate_limit error code specifically', async () => {
    const error = new AuthApiError('Email rate limit exceeded', 429, 'over_email_send_rate_limit');
    mockResetPasswordForEmail.mockResolvedValue({ data: null, error } as never);

    await expect(requestPasswordReset('runner@example.com')).resolves.toEqual({
      status: 'rateLimited',
    });
  });

  // Two different, unregistered-vs-registered emails must produce the exact same call shape and
  // the exact same result when the underlying API behaves identically for both (as Supabase's
  // real endpoint does) — this is the enumeration-safety guarantee made concrete.
  it('produces an identical result for two different emails given an identical API response', async () => {
    mockResetPasswordForEmail.mockResolvedValue({ data: {}, error: null } as never);

    const resultA = await requestPasswordReset('exists@example.com');
    const resultB = await requestPasswordReset('does-not-exist@example.com');

    expect(resultA).toEqual(resultB);
    expect(resultA).toEqual({ status: 'sent' });
  });
});

describe('updateRecoveryPassword', () => {
  const shortPassword = 'a'.repeat(PASSWORD_MIN_LENGTH - 1);
  const validPassword = 'correct-horse-battery-staple';

  // Mirrors sign-in.tsx's own comment on why length is checked first: a password that is both
  // too short and breached must surface the more actionable problem, and the HIBP round-trip
  // must never run for a password that's already rejected on length alone.
  it('reports tooShort for a password under PASSWORD_MIN_LENGTH, without calling checkPasswordBreached', async () => {
    await expect(updateRecoveryPassword(shortPassword)).resolves.toEqual({ status: 'tooShort' });
    expect(mockCheckPasswordBreached).not.toHaveBeenCalled();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('reports breached when checkPasswordBreached says so, without calling updateUser', async () => {
    mockCheckPasswordBreached.mockResolvedValue({ status: 'breached', count: 12 });

    await expect(updateRecoveryPassword(validPassword)).resolves.toEqual({ status: 'breached' });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('updates the password and reports updated when every check passes', async () => {
    mockCheckPasswordBreached.mockResolvedValue({ status: 'safe' });
    mockUpdateUser.mockResolvedValue({ data: { user: {} }, error: null } as never);

    await expect(updateRecoveryPassword(validPassword)).resolves.toEqual({ status: 'updated' });
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: validPassword });
  });

  // lib/hibp.ts fails open by design (issue #74) — 'unavailable' must not block the update.
  it('treats an unavailable breach check as safe to proceed, same as sign-up does', async () => {
    mockCheckPasswordBreached.mockResolvedValue({ status: 'unavailable', reason: 'network' });
    mockUpdateUser.mockResolvedValue({ data: { user: {} }, error: null } as never);

    await expect(updateRecoveryPassword(validPassword)).resolves.toEqual({ status: 'updated' });
  });

  // THE reuse guarantee this module's header describes: a genuine `updateUser` failure must
  // propagate to the caller as-is (not be swallowed or re-shaped here) so callers can reuse
  // `mapAuthError` (lib/auth-errors.ts) — including its length-vs-pwned AuthWeakPasswordError
  // disambiguation — exactly as sign-in.tsx already does, with zero new branches in this module.
  it('rethrows whatever updateUser throws, unchanged', async () => {
    const error = new Error('session expired');
    mockCheckPasswordBreached.mockResolvedValue({ status: 'safe' });
    mockUpdateUser.mockResolvedValue({ data: { user: null }, error } as never);

    await expect(updateRecoveryPassword(validPassword)).rejects.toBe(error);
  });
});
