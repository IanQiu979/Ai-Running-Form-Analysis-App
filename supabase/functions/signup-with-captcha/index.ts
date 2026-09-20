// `POST /functions/v1/signup-with-captcha` (issue #12/Known Issue #12) — the anti-farming gate
// in front of account creation. The app's client (`app/(auth)/sign-in.tsx`) calls this instead of
// `supabase.auth.signUp()` directly in sign-up mode; sign-in is untouched.
//
//     { email, password, captchaToken, ageBand: "18_plus" | "13_17", guardianConsent?: boolean }
//       -> 200 { session: {...} | null, user: {...} }
//       -> 400 { error, code: "invalid_body" | "age_band_required" | "guardian_consent_required"
//                        | "captcha_invalid" | "email_in_use"
//                        | "weak_password_length" | "weak_password_pwned" | "signup_failed" }
//       -> 405 { error, code: "method_not_allowed" }
//       -> 500 { error, code: "signup_unavailable" | "signup_failed" | "no_session"
//                        | "age_band_record_failed" }
//
// THE AGE CHOICE (2026-09-20, `_shared/age-band.ts`): every sign-up names its band, and a 13–17
// band must carry the parent/guardian attestation. Both are refused by name before the CAPTCHA
// token is spent; on success the band — and, for 13–17, a `guardian_consent` row stamped with
// `_shared/legal.ts`'s policy version — is written through the service-role-only
// `pace_record_age_band` RPC before the session is returned, and the account is rolled back if
// that write fails (`_shared/signup-with-captcha.ts`).
//
// WHY THIS FUNCTION EXISTS: see `_shared/signup-with-captcha.ts`'s header for the full story —
// short version, Supabase Auth's native `auth.captcha` is project-wide (verified live: it also
// 400s sign-in), so this function puts the Turnstile check in front of account creation instead,
// leaving `auth.captcha` disabled and sign-in completely unaffected. Since 2026-09-19 (issue #48
// residual) it creates the account through `auth.admin.createUser` (secret key, one call) and then
// signs it in with the publishable key, because the raw `/auth/v1/signup` route is closed by a
// `before-user-created` hook for the `email` provider — this function is the only way to get an
// email-and-password account, and the CAPTCHA below is therefore unconditional.
//
// UNAUTHENTICATED BY DESIGN: there is no user yet at signup, so unlike `purchase-tier`/
// `quota-status`, this route takes no `Authorization` header and does no `auth.getUser()` check.
// Anti-abuse comes entirely from the Turnstile verification below, run BEFORE the proxied signUp.
//
// This file is deliberately thin: request validation, the Turnstile check, and response shaping
// all live in `_shared/signup-with-captcha.ts` + `_shared/captcha.ts` (Deno/Jest-portable, unit
// tested — `_shared/__tests__/signup-with-captcha.deno.test.ts`), same split `purchase-tier/
// index.ts` uses for `_shared/purchase-tier.ts`. This is just the HTTP/env glue.
import { createAgeBandRpc } from '../_shared/age-band-recorder-client.ts';
import { createAgeBandRecorder } from '../_shared/age-band-recorder.ts';
import { createSignUpClient } from '../_shared/signup-client.ts';
import { TurnstileVerifier } from '../_shared/captcha.ts';
import { errorClassOf, hashUserId, logEvent, newRequestId } from '../_shared/log.ts';
import { handleSignupWithCaptcha } from '../_shared/signup-with-captcha.ts';

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  const requestId = newRequestId();

  if (req.method !== 'POST') {
    return jsonResponse(405, {
      error: 'Only POST is supported on this route.',
      code: 'method_not_allowed',
    });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse(400, {
      error: 'Request body must be { email, password, captchaToken, ageBand, guardianConsent? }.',
      code: 'invalid_body',
    });
  }

  const secretKey = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secretKey) {
    // A missing secret is an operational misconfiguration, never something to fail open on —
    // signup must refuse outright rather than silently skip the CAPTCHA check.
    logEvent({
      level: 'error',
      fn: 'signup-with-captcha',
      event: 'missing_turnstile_secret',
      requestId,
    });
    return jsonResponse(500, {
      error: 'Signup is temporarily unavailable. Please try again shortly.',
      code: 'signup_unavailable',
    });
  }

  // Best-effort client IP for Cloudflare's optional `remoteip` siteverify param — take the first
  // hop only; not load-bearing (siteverify still validates the token itself without it).
  const forwardedFor = req.headers.get('x-forwarded-for');
  const remoteIp = forwardedFor ? forwardedFor.split(',')[0].trim() : null;

  try {
    const result = await handleSignupWithCaptcha(
      {
        captchaVerifier: new TurnstileVerifier(secretKey),
        signUpClient: createSignUpClient(),
        ageBandRecorder: createAgeBandRecorder(createAgeBandRpc()),
        // The one failure that leaves state behind: a created account whose band could not be
        // written. `rolledBack: false` is the line an operator acts on (delete the account by
        // hand); the id is hashed like every other user id in these logs.
        onAgeBandWriteFailed: async ({ userId, reason, rolledBack }) => {
          const hashed = await hashUserId(userId);
          logEvent({
            level: 'error',
            fn: 'signup-with-captcha',
            event: rolledBack ? 'age_band_write_failed_rolled_back' : 'age_band_write_failed_account_stranded',
            requestId,
            userId: hashed,
            code: reason,
          });
        },
      },
      rawBody,
      remoteIp,
    );

    logEvent({
      level: result.status === 200 ? 'info' : result.status >= 500 ? 'error' : 'warn',
      fn: 'signup-with-captcha',
      event: result.status === 200 ? 'signup_completed' : 'signup_rejected',
      requestId,
      code: result.status === 200 ? undefined : result.body.code,
      durationMs: Date.now() - startedAt,
    });

    return jsonResponse(result.status, result.body);
  } catch (err) {
    logEvent({
      level: 'error',
      fn: 'signup-with-captcha',
      event: 'signup_failed',
      requestId,
      durationMs: Date.now() - startedAt,
      errorClass: errorClassOf(err),
    });
    return jsonResponse(500, {
      error: 'Something went wrong. Please try again.',
      code: 'signup_failed',
    });
  }
});
