/**
 * Password-reset request + recovery-session password update (issue #81 — there was previously
 * no way back into an email account for a user who forgot their password).
 *
 * Two halves of the flow, kept in one module because both are thin wrappers around a single
 * Supabase Auth call plus the same pre-checks sign-up already runs — screens own all UI state
 * (`app/(auth)/reset-password.tsx` requests the email, `app/(auth)/update-password.tsx` consumes
 * the recovery session this creates and sets the new password).
 *
 * Reuses rather than duplicates:
 *   - `PASSWORD_MIN_LENGTH` (constants/auth.ts) for the new password's length pre-check — issue
 *     #9's literal "8" stays a single source; this is NOT a fourth copy of it.
 *   - `checkPasswordBreached` (lib/hibp.ts) for the same HIBP pre-check sign-up runs. That
 *     module's header comment explicitly anticipates and blesses this exact call site: the
 *     password here is always a *candidate* being submitted to `updateUser`, never a user's
 *     live password being checked on a sign-in path (which lib/hibp.ts's header forbids).
 *   - `oauthRedirectTo`'s pattern from lib/auth.ts (not the constant itself — this flow needs a
 *     different redirect path) for building the deep-link redirect URI via the same
 *     `makeRedirectUri({ scheme: 'paceanalysisai', path })` shape. The already-allowlisted
 *     `paceanalysisai://**` wildcard in supabase/config.toml explicitly anticipates "password
 *     reset, magic links" under the same scheme, so no allowlist change is needed for this.
 *
 * Deliberately does NOT reuse `mapAuthError` (lib/auth-errors.ts) for the request half
 * (`requestPasswordReset`): that function's OAuth-flavored branches (e.g. mapping a
 * provider-redirect `access_denied` to "Sign-in was cancelled") have no meaningful counterpart
 * here, and `resetPasswordForEmail` itself is already enumeration-safe (see that function's own
 * doc comment) — the only errors it can surface are operational, not existence-correlated, so
 * they get their own small, honest mapping instead of forcing them through a mapper shaped for
 * a different flow. The update half (`updateRecoveryPassword`) DOES let a genuine
 * `updateUser` failure propagate to the caller so it can reuse `mapAuthError` — that error shape
 * (including the length-vs-pwned `AuthWeakPasswordError` disambiguation) is exactly what that
 * mapper already gets right, and re-deriving it here would be exactly the duplication issue #9
 * warns against.
 */
import { isAuthApiError } from '@supabase/supabase-js';
import { makeRedirectUri } from 'expo-auth-session';

import { PASSWORD_MIN_LENGTH } from '@/constants/auth';
import { Copy } from '@/constants/copy';

import { checkPasswordBreached } from './hibp';
import { supabase } from './supabase';

// Matches app/(auth)/update-password.tsx's route path (route groups like `(auth)` are not part
// of the URL expo-router matches against), so a clicked recovery-email link opens directly onto
// the right screen rather than falling back to whatever the deep link's default landing spot is.
// See that screen's header comment for the root-layout routing caveat this redirect is currently
// subject to — a session created by this exchange is, today, indistinguishable from a normal
// signed-in session to `app/_layout.tsx`'s guard, which is a gap outside this module's file lane.
export const passwordResetRedirectTo = makeRedirectUri({
  scheme: 'paceanalysisai',
  path: 'update-password',
});

// Not exported from lib/auth-errors.ts (kept private there), so this is a small, deliberate
// duplicate — not the kind of duplication issue #9 is about (a business rule that must track a
// server value), just a stable, universally-known email-shape check. Mirrors the same permissive
// pattern used there: this only ever gates whether to bother sending the request at all, never
// what account state exists server-side.
function isValidEmail(value: string): boolean {
  return /\S+@\S+\.\S+/.test(value.trim());
}

/**
 * Client-side validation for the reset-request form, run BEFORE `requestPasswordReset` — same
 * shape and same guarantee as `validateSignInForm` (lib/auth-errors.ts): never returns a string
 * that implies a request was actually sent. Reuses the exact same copy keys sign-in's form
 * already validates against (`emailRequired`/`emailInvalid`), not new ones — an empty or
 * malformed email is the same problem on both screens.
 */
export function validateResetEmail(email: string): string | null {
  const trimmedEmail = email.trim();
  if (!trimmedEmail) {
    return Copy.auth.error.emailRequired;
  }
  if (!isValidEmail(trimmedEmail)) {
    return Copy.auth.error.emailInvalid;
  }
  return null;
}

export type RequestResetResult =
  | { status: 'sent' }
  | { status: 'rateLimited' }
  | { status: 'error' };

/**
 * Requests a password-reset email. Enumeration-safe by construction, not by convention:
 * `resetPasswordForEmail` itself returns `{ error: null }` uniformly whether or not the address
 * has an account (confirmed by supabase-js's own doc comment on the method) — there is no
 * "account not found" branch to accidentally leak. The only errors this can ever surface are
 * operational (rate-limited, or a genuine network/API failure) and neither correlates with
 * whether the address exists, so it's safe for a caller to show a distinct message for those
 * without reopening the enumeration gap issue #81 requires closed. Callers MUST still render the
 * identical `status: 'sent'` UI regardless of account existence — this function guarantees the
 * two cases are indistinguishable at the call site.
 */
export async function requestPasswordReset(email: string): Promise<RequestResetResult> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: passwordResetRedirectTo,
  });

  if (!error) return { status: 'sent' };

  if (isAuthApiError(error) && error.code === 'over_email_send_rate_limit') {
    return { status: 'rateLimited' };
  }

  return { status: 'error' };
}

export type UpdateRecoveryPasswordOutcome =
  | { status: 'updated' }
  | { status: 'tooShort' }
  | { status: 'breached' };

/**
 * Sets a new password during an active password-recovery session (established by the recovery
 * deep link's PKCE exchange — see app/(auth)/update-password.tsx for how that session is
 * detected via the `PASSWORD_RECOVERY` auth event). Same two pre-checks as sign-up
 * (app/(auth)/sign-in.tsx), same order, same reason: length is checked before the HIBP breach
 * check because a password that's both too short and breached must tell the user the more
 * actionable problem first (see lib/hibp.ts's header and sign-in.tsx's own comment for the full
 * reasoning behind that ordering — not re-derived here, just followed identically).
 *
 * Returns a result for the two client-side pre-check failures, but RE-THROWS whatever
 * `supabase.auth.updateUser` throws for every other failure (including a real server-side
 * weak-password rejection if these pre-checks ever miss one, or the recovery session having
 * expired between this screen mounting and the user submitting). Callers catch that with the
 * exact same `mapAuthError` (lib/auth-errors.ts) sign-in.tsx already uses — see this module's
 * header for why that reuse only applies to this half of the flow, not `requestPasswordReset`.
 */
export async function updateRecoveryPassword(
  password: string
): Promise<UpdateRecoveryPasswordOutcome> {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { status: 'tooShort' };
  }

  const breachCheck = await checkPasswordBreached(password);
  if (breachCheck.status === 'breached') {
    return { status: 'breached' };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;

  return { status: 'updated' };
}
