# Auth config runbook — live changes to the hosted project's GoTrue settings

Every change to the live auth configuration of `vputdomdlknvthnzritt` is made with a **scoped
Management API PATCH** to `/v1/projects/{ref}/config/auth` carrying only the fields being changed.
Never `supabase config push` — `supabase/config.toml`'s warning above `[auth.external.apple]`
explains why (the file declares no Google block, so a wholesale push may disable live Google
sign-in). `config.toml` is the mirror of what has been applied; keep it in step with every PATCH.

The access token is the Supabase CLI's (`~/.supabase/access-token`, created by `supabase login`).
Every command below reads it from there; nothing is pasted into a shell history.

```sh
export SUPABASE_ACCESS_TOKEN="$(cat ~/.supabase/access-token)"
export REF=vputdomdlknvthnzritt
auth_get()   { curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
                 "https://api.supabase.com/v1/projects/$REF/config/auth"; }
auth_patch() { curl -s -X PATCH -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
                 -H "Content-Type: application/json" \
                 "https://api.supabase.com/v1/projects/$REF/config/auth" -d "$1"; }
```

Always follow a PATCH with `auth_get` and read the fields back: the API answers `200` even for a
field it silently drops (`docs/change_log.md` 2026-07-11, `sign_in_sign_ups`).

---

## 1. Close the raw sign-up route — `before-user-created` hook (issue #48 residual) — APPLIED 2026-09-19

**Live since 2026-09-19 16:12Z** (function v12, migration, PATCH, in that order; evidence in
`docs/status.md` Known Issue #51). Kept as the runbook for a rollback or a re-apply.

**What it does.** `public.pace_before_user_created` (`supabase/migrations/
20260919140000_before_user_created_hook.sql`) rejects every `email` (and `phone`) account
creation GoTrue routes through the hook — raw `POST /auth/v1/signup`, magic-link sign-ups — with
`403 Accounts are created through the Pace Analysis AI app only.`, and allows only the `google`
and `apple` providers (an allow-list — `anonymous` and any future provider are refused until a
migration adds them). `signup-with-captcha` creates accounts through `auth.admin.createUser`, which GoTrue
does not route through the hook, so after this the only way to get an email-and-password
account is through the app's Turnstile check. Google sign-in, including first-time, is
unaffected. `disable_signup` was **not** used: it is checked on the OAuth path too and would
refuse new Google users (the migration header has the source references).

**Order is load-bearing.** The previous `signup-with-captcha` proxied a plain `auth.signUp()`,
which is the route the hook closes. Enabling the hook before the new function is live rejects
every app sign-up until it is.

```sh
# 1. Deploy the function that creates accounts through the admin API.
export SUPABASE_GO_BINARY=~/.local/share/supabase/supabase-go
supabase functions deploy signup-with-captcha --project-ref $REF --use-api

# 2. Apply the migration that creates the hook function (needs SUPABASE_DB_PASSWORD).
supabase db push --linked --dry-run     # must list 20260919140000_before_user_created_hook
supabase db push --linked

# 3. Point GoTrue at it.
auth_patch '{
  "hook_before_user_created_enabled": true,
  "hook_before_user_created_uri": "pg-functions://postgres/public/pace_before_user_created"
}'
auth_get | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k: d[k] for k in d if k.startswith("hook_before_user_created")})'
```

**Verify, immediately, against the live project.**

```sh
export PUBLISHABLE_KEY="$(grep EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY .env | cut -d= -f2)"
# Raw route: expect HTTP 403, {"code":403,"error_code":"unknown","msg":"Accounts are created ..."}
# (GoTrue reports a hook rejection under error_code "unknown" — observed live 2026-09-19)
curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://$REF.supabase.co/auth/v1/signup" \
  -H "apikey: $PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  -d '{"email":"hook-probe-'"$(date +%s)"'@example.com","password":"aRealStrongPassw0rd!9x"}'
# Sign-in of an existing account: unchanged (expect 400 invalid_credentials for a wrong password,
# never a hook error).
curl -s -X POST "https://$REF.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: $PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  -d '{"email":"nobody@example.com","password":"wrong"}'
```

Then one real sign-up through the app (dev build or Expo Go; Turnstile's dummy key is fine for
this since only the account-creation path is under test), and one Google sign-in.

**Expected side effects, not outages.** Dashboard "Invite user" and `auth.admin.inviteUserByEmail`
/ `generateLink({ type: 'signup' })` go through the hook with provider `email` and are refused
with the app-only message; the app has no invite flow. Adding a sign-in provider (Apple is
already allow-listed) means a migration editing the hook's list first. After deploy, watch
`signup_rejected code=no_session` in the function logs: it is the "account created, follow-up
sign-in failed" branch (e.g. the shared per-IP `/token` rate limit under a burst) — the account
exists and the user signs in with the password they chose; if it ever shows up in numbers, give
it its own client code.

**Roll back** (any order, each independent): `auth_patch '{"hook_before_user_created_enabled":
false}'` re-opens the raw route immediately; the function keeps working either way.

---

## 2. Remove `exp://**` from the redirect allowlist (issue #69) — PREPARED, NOT APPLIED

**Gate.** The captain confirms Google sign-in tap-through works on the **Android dev build**
(`docs/status.md` Known Issue #7). Until then a physical device under Expo Go is the only
on-device auth path, and its redirect is `exp://<LAN-IP>:8081/--/oauth-callback`, which only
`exp://**` matches (`config.toml`'s note on why `*` cannot cross the dots in an IP address).
Removing it earlier breaks that path. Nothing below runs until the captain says so; firstmate
applies it after his word.

Live value on 2026-09-19 (`auth_get | jq -r .uri_allow_list`):
`paceanalysisai://oauth-callback,paceanalysisai://**,exp://**`

```sh
auth_patch '{"uri_allow_list": "paceanalysisai://oauth-callback,paceanalysisai://**"}'
auth_get | python3 -c 'import json,sys; print(json.load(sys.stdin)["uri_allow_list"])'
# expected: paceanalysisai://oauth-callback,paceanalysisai://**
```

`site_url` (`paceanalysisai://`) is not touched.

**Matching `supabase/config.toml` edit, in the same commit as the record of the PATCH:**

```toml
additional_redirect_urls = ["paceanalysisai://oauth-callback", "paceanalysisai://**"]
```

and drop the `exp://**` bullet from the comment block above it plus open item 3 in the
`[auth]` header (the "Redirect allowlist dev/prod split" note). Then close #69 with the
`auth_get` output as evidence and note it in `docs/change_log.md`.

**Verify.** Google sign-in on the Android dev build and on the iOS simulator dev build still
lands on Home; a `npm run start:go` Expo Go session on a phone now fails Google sign-in with
Supabase's `redirect_to` rejection — expected, and the reason this waits for the dev build.

**Roll back.** `auth_patch '{"uri_allow_list": "paceanalysisai://oauth-callback,paceanalysisai://**,exp://**"}'`.

---

## 3. Age band + guardian consent (2026-09-20) — PREPARED, NOT APPLIED

Not an auth-config PATCH — a DB push plus two function deploys — but it lives here because the
order is load-bearing in the same way § 1's was, and because `signup-with-captcha` is the function
§ 1 already governs. Source: the PR for `fm/v22-v23-under18-guardian-consent` (`docs/change_log.md`
2026-09-20, `docs/status.md` Known Issue #52).

**Order: migration → functions → app build.** The redeployed `signup-with-captcha` calls
`pace_record_age_band()` right after `createUser` and ROLLS THE ACCOUNT BACK when that call fails
— on a database without the migration every sign-up would create-and-delete an account and answer
`500 age_band_record_failed`. Old function + new database is safe (the new column is nullable and
nothing reads it), which is why the database goes first. The app build goes last: an old app
against the new function gets `400 age_band_required` (it sends no band), which the old client
folds to the generic error copy — sign-up unavailable, not broken data.

```sh
export SUPABASE_GO_BINARY=~/.local/share/supabase/supabase-go
# 1. Database (needs SUPABASE_DB_PASSWORD in the environment; dry-run first, expect exactly one file)
supabase db push --linked --dry-run
supabase db push --linked          # 20260920120000_guardian_consent
supabase db query --linked "select column_name from information_schema.columns where table_name = 'profiles' and column_name = 'age_band'"
supabase db query --linked "select has_function_privilege('service_role', 'public.pace_record_age_band(uuid, text, boolean, text)', 'execute') as service_exec, has_function_privilege('authenticated', 'public.pace_record_age_band(uuid, text, boolean, text)', 'execute') as auth_exec, has_table_privilege('authenticated', 'public.guardian_consent', 'insert') as auth_insert"
# expected: service_exec true, auth_exec false, auth_insert false
# 2. Functions
supabase functions deploy signup-with-captcha --project-ref $REF --use-api
supabase functions deploy record-age-band     --project-ref $REF --use-api
# 3. Verify the refusals live (no account is created by either)
curl -s -X POST "https://$REF.supabase.co/functions/v1/signup-with-captcha" -H 'Content-Type: application/json' \
  -d '{"email":"probe@example.com","password":"probe-Passw0rd!","captchaToken":"x"}'
# expected: 400 {"code":"age_band_required"}
curl -s -X POST "https://$REF.supabase.co/functions/v1/signup-with-captcha" -H 'Content-Type: application/json' \
  -d '{"email":"probe@example.com","password":"probe-Passw0rd!","captchaToken":"x","ageBand":"13_17"}'
# expected: 400 {"code":"guardian_consent_required"}
curl -s -X POST "https://$REF.supabase.co/functions/v1/record-age-band" -H 'Content-Type: application/json' -d '{"ageBand":"18_plus"}'
# expected: 401 {"code":"unauthorized"}
# 4. Then the app build (EAS) — the old build's sign-up is refused by the new function until then.
```

**Rollback.** Functions: redeploy the previous bundles (the pre-deploy source is what `main` held
before the PR merged). Database: the migration is additive; leave it in place — an old function
ignores the column and the table. Do not drop `guardian_consent` while any 13–17 account exists.

**After the push:** regenerate `lib/database.types.ts` (`supabase gen types typescript --linked`)
and commit it — the PR hand-patched the three new entries in the generator's shape.
