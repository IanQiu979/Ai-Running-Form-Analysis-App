/**
 * `POST /functions/v1/signup-with-captcha` (issue #12/Known Issue #12) — the ONLY sanctioned way
 * to create an account in this app going forward, and a deliberate alternative to Supabase Auth's
 * native `auth.captcha`.
 *
 * WHY THIS EXISTS INSTEAD OF `auth.captcha`: that native setting was tried and reverted live
 * against the hosted project (`vputdomdlknvthnzritt`) on 2026-08-02. It is project-wide, not
 * per-endpoint — enabling it made BOTH `/auth/v1/signup` and `/auth/v1/token?grant_type=password`
 * (sign-in) reject with `captcha_failed` when no token was supplied, confirmed by direct testing
 * against the live project (not doc-reading). That breaks sign-in for every existing user, which
 * Known Issue #12 explicitly does not want gated — the abuse vector is disposable SIGNUP, not
 * sign-in. There is no server-side knob to scope `auth.captcha` to signup only, so this function
 * is the replacement: it puts the Turnstile check in front of signup only, and never touches
 * sign-in at all (`supabase/config.toml`'s `[auth.captcha]` block stays commented out/disabled).
 *
 * DESIGN: this function verifies the Turnstile token itself (Cloudflare's siteverify API,
 * `captcha.ts`), and — ONLY if that passes — creates the account through `auth.admin.createUser`
 * and mints its session with a plain `auth.signInWithPassword` (`signup-client.ts`).
 *
 * WHY THE ADMIN API (issue #48 residual, 2026-09-19): until then this function proxied an
 * unprivileged `supabase.auth.signUp()`, which is GoTrue's `/auth/v1/signup` — and that route was
 * still open to anyone holding the publishable key, so the CAPTCHA gated only the app's own path.
 * A `before-user-created` auth hook (`supabase/migrations/20260919140000_before_user_created_hook.
 * sql`) now rejects every `email`-provider creation GoTrue routes through it — `/signup`, magic
 * link sign-ups — while allow-listing Google and Apple; the admin API is the one path the hook does not
 * see, which makes this function the only way to get an email-and-password account. That is a
 * stronger version of the same gate, not a different one. `disable_signup` was rejected for the
 * job because it also refuses first-time Google sign-ins (GoTrue checks it on the OAuth path).
 *
 * The admin API does NOT relax the password policy: GoTrue's `adminUserCreate` runs the same
 * `checkPasswordStrength` (`minimum_password_length`, HIBP when enabled) as `/signup` and raises
 * the same weak-password error, which `signup-client.ts` maps exactly as before. (This file's
 * earlier header assumed the admin API skipped those checks; that described an older GoTrue and
 * was verified wrong against the current source on 2026-09-19.) An already-registered address
 * surfaces as GoTrue's `email_exists` on the admin call, mapped to the same `email_in_use` outcome
 * and client copy as before, so the wire contract is unchanged (and no more enumerable than it
 * was: with `mailer_autoconfirm` on, raw `/signup` already answered `user_already_exists`).
 *
 * This file is the portable (Deno + Jest) validation/shaping layer — see
 * `signup-with-captcha/index.ts` for the Deno-only HTTP/env glue, same split as
 * `_shared/purchase-tier.ts` / `purchase-tier/index.ts`.
 */

import type { AgeBandChoice, AgeBandRefusalCode } from './age-band.ts';
import { parseAgeBandChoice } from './age-band.ts';
import type { AgeBandRecorder } from './age-band-recorder.ts';
import type { CaptchaVerifier } from './captcha.ts';
export type { CaptchaVerifier };

export interface SessionPayload {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number | null;
  tokenType: string;
}

export interface UserPayload {
  id: string;
  email: string | null;
}

export type SignUpOutcome =
  | { outcome: 'created'; session: SessionPayload; user: UserPayload }
  // The account was created but the follow-up `signInWithPassword` returned no session — a
  // fail-safe (`signup-client.ts` creates with `email_confirm: true`, so it should not happen in
  // practice), kept from the earlier `signUp()` design so the handler still has a named branch.
  | { outcome: 'created_no_session'; user: UserPayload }
  // GoTrue's admin API answers an already-registered address with `email_exists`; the earlier
  // `signUp()` design detected the same case from `/signup`'s response. Same outcome, same client
  // copy either way.
  | { outcome: 'email_in_use' }
  | { outcome: 'weak_password'; message: string; reasons: string[] }
  | { outcome: 'error'; message: string; code: string | null };

export interface SignUpClient {
  signUp(email: string, password: string): Promise<SignUpOutcome>;
  /**
   * Rollback for the one failure that can happen AFTER the account exists: the age-band write
   * (below). Must resolve, not throw, when the user is already gone. `auth.admin.deleteUser` on
   * the secret key in production (`signup-client.ts`).
   */
  deleteUser(userId: string): Promise<void>;
}

export interface SignupRequest {
  email: string;
  password: string;
  captchaToken: string;
  /** The age choice (2026-09-20) — see `age-band.ts`. Validated before the CAPTCHA is spent. */
  ageChoice: AgeBandChoice;
}

export type ParseResult =
  | { ok: true; request: SignupRequest }
  | { ok: false; error: string; code: 'invalid_body' | AgeBandRefusalCode };

/** Deliberately minimal — this is a shape/presence check only. The real business rules (password
 * length, breach status, email format) are GoTrue's job on the `createUser` call below; this
 * function must not duplicate or pre-empt them, or the two can silently drift (same reasoning as
 * `constants/auth.ts`'s `PASSWORD_MIN_LENGTH` header). */
export function parseSignupRequest(rawBody: unknown): ParseResult {
  if (typeof rawBody !== 'object' || rawBody === null) {
    return { ok: false, error: 'Request body must be a JSON object.', code: 'invalid_body' };
  }
  const body = rawBody as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const captchaToken = typeof body.captchaToken === 'string' ? body.captchaToken.trim() : '';

  if (email.length === 0 || password.length === 0 || captchaToken.length === 0) {
    return {
      ok: false,
      error:
        'Request body must be { email, password, captchaToken, ageBand, guardianConsent? }, with the first three non-empty strings.',
      code: 'invalid_body',
    };
  }

  // The age choice is checked here, before the CAPTCHA token is spent on siteverify: a form that
  // arrives without a band (or a 13–17 band without the attestation) is refused by name and the
  // client keeps its token. The two rules are re-checked by `pace_record_age_band` itself, which is
  // the layer no future caller can skip.
  const ageChoice = parseAgeBandChoice(body);
  if (!ageChoice.ok) {
    return { ok: false, error: ageChoice.error, code: ageChoice.code };
  }

  return { ok: true, request: { email, password, captchaToken, ageChoice: ageChoice.choice } };
}

export type SignupResult =
  | { status: 200; body: { session: SessionPayload | null; user: UserPayload } }
  | { status: 400; body: { error: string; code: string } }
  | { status: 500; body: { error: string; code: string } };

/**
 * The one entry point both the real edge function and its tests call. Every dependency
 * (`captchaVerifier`, `signUpClient`) is injected — this function never touches `Deno.env` or
 * `fetch` directly, so it runs identically under `deno test` and Jest.
 */
/**
 * Fired when the age-band write fails after the account exists — the one operator-actionable
 * failure this handler has. `rolledBack: false` means a bandless account is STRANDED and named
 * here; `index.ts` logs it with the hashed user id. Optional so the portable handler stays
 * dependency-light under Jest.
 */
export type AgeBandWriteFailure = { userId: string; reason: string; rolledBack: boolean };

export async function handleSignupWithCaptcha(
  deps: {
    captchaVerifier: CaptchaVerifier;
    signUpClient: SignUpClient;
    ageBandRecorder: AgeBandRecorder;
    onAgeBandWriteFailed?: (failure: AgeBandWriteFailure) => void | Promise<void>;
  },
  rawBody: unknown,
  remoteIp: string | null,
): Promise<SignupResult> {
  const parsed = parseSignupRequest(rawBody);
  if (!parsed.ok) {
    return { status: 400, body: { error: parsed.error, code: parsed.code } };
  }
  const { email, password, captchaToken, ageChoice } = parsed.request;

  const captchaOk = await deps.captchaVerifier.verify(captchaToken, remoteIp);
  if (!captchaOk) {
    return {
      status: 400,
      body: {
        error: 'CAPTCHA verification failed. Please try again.',
        code: 'captcha_invalid',
      },
    };
  }

  const result = await deps.signUpClient.signUp(email, password);

  // THE AGE BAND IS PART OF ACCOUNT CREATION, NOT A FOLLOW-UP. On either "the account now exists"
  // outcome the band (and, for 13–17, the guardian-consent row) is written before anything is
  // returned; if that write fails the account is deleted again and the attempt fails as a whole,
  // so no email-and-password account can exist without a band. The client keeps its form and can
  // retry; a retry is a fresh CAPTCHA token and a fresh `createUser`, which is why the rollback
  // matters — without it the retry would come back `email_in_use` against a bandless account.
  if (result.outcome === 'created' || result.outcome === 'created_no_session') {
    const recorded = await deps.ageBandRecorder.record(result.user.id, ageChoice);
    // `already_recorded` cannot happen for a user created a moment ago; it is accepted rather than
    // rolled back because the invariant it guards (a band exists) already holds.
    if (recorded.outcome !== 'recorded' && recorded.outcome !== 'already_recorded') {
      const reason = recorded.outcome === 'unavailable' ? recorded.message : recorded.code;
      let rolledBack = true;
      try {
        await deps.signUpClient.deleteUser(result.user.id);
      } catch {
        // Best effort: the 500 below is returned either way. A stranded bandless account is the
        // residual this cannot close — so it is at least NAMED, via the callback, in the log.
        rolledBack = false;
      }
      try {
        await deps.onAgeBandWriteFailed?.({ userId: result.user.id, reason, rolledBack });
      } catch {
        // The log line is evidence, not the response — a failing hook must not mask the 500.
      }
      return {
        status: 500,
        body: {
          error: 'Your account could not be created. Please try again.',
          code: 'age_band_record_failed',
        },
      };
    }
  }

  switch (result.outcome) {
    case 'created':
      return { status: 200, body: { session: result.session, user: result.user } };
    case 'created_no_session':
      // Ported as-is from `app/(auth)/sign-in.tsx`'s existing fail-safe comment: this shouldn't
      // happen given `mailer_autoconfirm = true`, but if it ever does, tell the user something
      // rather than silently handing back a sessionless 200.
      return {
        status: 500,
        body: { error: 'Something went wrong. Please try again.', code: 'no_session' },
      };
    case 'email_in_use':
      return {
        status: 400,
        body: { error: 'An account with this email already exists.', code: 'email_in_use' },
      };
    case 'weak_password':
      // The client (`lib/signup-with-captcha.ts`) needs to tell "too short" apart from
      // "breached" to show the right copy, but `invokeFunction` (issue #46,
      // `lib/functions-client.ts`) only forwards `{ error, code }` on a non-2xx response — not
      // arbitrary extra fields like `reasons`, and widening that shared contract for one caller
      // isn't worth it. So the precedence decision is made HERE, server-side, and encoded
      // directly in `code` instead: same length-before-pwned priority `lib/auth-errors.ts`'s
      // `mapAuthError` uses for the direct-`signUp` path, and for the same reason — `reasons` is
      // a set GoTrue accumulates (a password can be both too short AND breached), and length is
      // the more actionable of the two to tell the user about first.
      return {
        status: 400,
        body: {
          error: result.message,
          code: result.reasons.includes('length')
            ? 'weak_password_length'
            : result.reasons.includes('pwned')
              ? 'weak_password_pwned'
              : 'weak_password',
        },
      };
    case 'error':
      return {
        status: 400,
        body: { error: result.message, code: result.code ?? 'signup_failed' },
      };
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}
