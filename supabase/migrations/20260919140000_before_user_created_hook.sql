-- Issue #48 residual (captain-approved 2026-09-19): close the raw `POST /auth/v1/signup` route so
-- that EVERY email-and-password account creation passes the Turnstile check in
-- `supabase/functions/signup-with-captcha`. Until now that function was the sanctioned path but
-- not the only one: anyone holding the publishable key could call GoTrue's `/auth/v1/signup`
-- directly and mint a disposable account with no CAPTCHA at all (`docs/status.md` Known Issue #12
-- closed the app path only).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHY A "BEFORE USER CREATED" AUTH HOOK AND NOT `disable_signup`
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- `disable_signup` (the Dashboard's "Allow new users to sign up" toggle) is project-wide: GoTrue
-- checks it for OAuth account creation too (`internal/api/external.go`, the `models.CreateAccount`
-- branch returns `signup_disabled` when it is set), so flipping it would have refused every
-- first-time Google sign-in as well — Google is a first-class sign-in method here, and the only
-- one with a live account on 2026-09-19. The `before-user-created` hook is the per-provider
-- version of the same gate: GoTrue invokes it from the email/password signup path and from the
-- OAuth path, and NOT from the admin API (`internal/api/admin.go` never triggers it). That is
-- exactly the split this app needs:
--
--   - raw `/auth/v1/signup` (provider `email`)      -> the hook rejects it, 403
--   - Google / any OAuth first sign-in               -> the hook allows it, unchanged
--   - `signup-with-captcha` via `auth.admin.createUser` -> no hook, and the Turnstile check has
--                                                       already run in front of it
--
-- The admin path does NOT skip password policy: GoTrue's `adminUserCreate` runs the same
-- `checkPasswordStrength` (`minimum_password_length`, HIBP when enabled) as `/signup` does, so
-- nothing about the account-creation invariants relaxes. Verified against the `supabase/auth`
-- source on 2026-09-19; the earlier header in `_shared/signup-with-captcha.ts` that assumed
-- the admin API bypassed those checks described an older GoTrue and was wrong for the hosted one.
--
-- WIRING IS TWO-PART, AND ORDER MATTERS. This file creates the function only. GoTrue calls it
-- once `hook_before_user_created_enabled` / `hook_before_user_created_uri` are set on the live
-- project (a scoped Management API PATCH — `docs/auth-config-runbook.md` has the command and the
-- `supabase/config.toml` `[auth.hook.before_user_created]` block mirrors it). Deploy the new
-- `signup-with-captcha` BEFORE enabling the hook: the previous version proxied a plain
-- `auth.signUp()`, which is the very route the hook closes, so enabling the hook first would
-- reject every app sign-up until the function was redeployed.
--
-- PAYLOAD: GoTrue posts `{ "metadata": {...}, "user": { ..., "app_metadata": { "provider":
-- "email" | "google" | ..., "providers": [...] } } }` and accepts either `{}` (allow) or
-- `{ "error": { "http_code": <4xx>, "message": "..." } }` (reject with that status). The provider
-- is read from the user object, not from request metadata, so a caller cannot spoof it.
--
-- ALLOW-LIST, NOT DENY-LIST (security review, 2026-09-19). Only the OAuth providers this app
-- offers or has planned — `google` today, `apple` for Guideline 4.8 — pass. Everything else is
-- rejected: `email` and `phone` (the routes being closed), `anonymous` (off in config, but one
-- Dashboard toggle away from CAPTCHA-free accounts that hold the `authenticated` role and would
-- pass quota gating as real users), any provider added later, and an event with no readable
-- provider at all. A new sign-in method is added here deliberately, in a migration, never by
-- default. GoTrue also routes admin invites and `generateLink(type: 'signup')` through this hook
-- with provider `email`, so Dashboard "Invite user" is refused too — expected, not an outage
-- (`docs/auth-config-runbook.md` § 1).

create or replace function public.pace_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  provider text := event -> 'user' -> 'app_metadata' ->> 'provider';
begin
  if provider in ('google', 'apple') then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error',
    jsonb_build_object(
      'http_code', 403,
      'message', 'Accounts are created through the Pace Analysis AI app only.'
    )
  );
end;
$$;

comment on function public.pace_before_user_created(jsonb) is
  'Supabase before-user-created auth hook: allows only the google and apple OAuth providers, so '
  'email/password accounts can be created only by signup-with-captcha (admin API, Turnstile-gated).';

-- GoTrue calls Postgres hooks as `supabase_auth_admin`; nobody else may execute this function.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.pace_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.pace_before_user_created(jsonb) from public, anon, authenticated;
