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
 * `captcha.ts`), and — ONLY if that passes — proxies a perfectly normal `supabase.auth.signUp()`
 * call using the PUBLISHABLE key (not the service-role key; no admin API involved). This is
 * deliberate: `signUp()` still goes through GoTrue's own `/auth/v1/signup` endpoint, so
 * `minimum_password_length` and `password_hibp_enabled` (`supabase/config.toml`) keep being
 * enforced exactly as they were before this function existed — nothing about the account-creation
 * invariants this app already relies on changes. The only new gate is the Turnstile check in
 * front of it. (An earlier design considered `auth.admin.createUser`, which would have bypassed
 * both of those checks and required reimplementing them here — rejected for exactly that reason.)
 *
 * This file is the portable (Deno + Jest) validation/shaping layer — see
 * `signup-with-captcha/index.ts` for the Deno-only HTTP/env glue, same split as
 * `_shared/purchase-tier.ts` / `purchase-tier/index.ts`.
 */

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
  // Email confirmations are disabled for this MVP (`supabase/config.toml`'s `auth.email` note),
  // so a successful signUp should always carry a session — this branch is a fail-safe for the
  // case where it somehow doesn't, ported from `app/(auth)/sign-in.tsx`'s existing handling
  // rather than a case this function expects to hit in practice.
  | { outcome: 'created_no_session'; user: UserPayload }
  // Supabase deliberately does not error on a signup to an already-registered email — it returns
  // `{ error: null, session: null }` with an empty `identities` array, to avoid leaking which
  // emails exist. Ported from the same detection `app/(auth)/sign-in.tsx` used to do client-side.
  | { outcome: 'email_in_use' }
  | { outcome: 'weak_password'; message: string; reasons: string[] }
  | { outcome: 'error'; message: string; code: string | null };

export interface SignUpClient {
  signUp(email: string, password: string): Promise<SignUpOutcome>;
}

export interface SignupRequest {
  email: string;
  password: string;
  captchaToken: string;
}

export type ParseResult =
  | { ok: true; request: SignupRequest }
  | { ok: false; error: string; code: 'invalid_body' };

/** Deliberately minimal — this is a shape/presence check only. The real business rules (password
 * length, breach status, email format) are GoTrue's job on the proxied `signUp` call below; this
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
      error: 'Request body must be { email, password, captchaToken }, all non-empty strings.',
      code: 'invalid_body',
    };
  }

  return { ok: true, request: { email, password, captchaToken } };
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
export async function handleSignupWithCaptcha(
  deps: { captchaVerifier: CaptchaVerifier; signUpClient: SignUpClient },
  rawBody: unknown,
  remoteIp: string | null,
): Promise<SignupResult> {
  const parsed = parseSignupRequest(rawBody);
  if (!parsed.ok) {
    return { status: 400, body: { error: parsed.error, code: parsed.code } };
  }
  const { email, password, captchaToken } = parsed.request;

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
