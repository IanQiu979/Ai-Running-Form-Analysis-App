# Email runbook — moving auth email off Supabase's built-in mailer (issue #139)

**Decision (captain, 2026-09-19): Resend, free tier.** This runbook is the exact sequence; it
was written without a Resend account, so every value the captain must supply is marked
**PASTE**. Nothing here has been applied. The only live email flow today is password reset
(`app/(auth)/reset-password.tsx` → `supabase.auth.resetPasswordForEmail` → the recovery email →
`paceanalysisai://update-password`); sign-up is auto-confirmed, so no confirmation email is sent.

**Why this is a launch gate.** Live on 2026-09-19 (`auth_get`, see `docs/auth-config-runbook.md`
for the helpers): `smtp_host`, `smtp_user`, `smtp_pass`, `smtp_admin_email` are all `null`, so
Supabase's built-in mailer is active and `rate_limit_email_sent = 2` — two emails per hour,
project-wide, and Supabase states the built-in mailer is for development only. The third person
to forget their password in an hour silently gets nothing.

## Prerequisites the captain owns

1. **A domain he controls.** Resend sends only from a verified domain (the `onboarding@resend.dev`
   sender delivers to the account's own address only). The privacy policy's contact is a Gmail
   address, which cannot be a sending domain. If there is no domain yet, buying one is a paid
   step and a captain decision, not something this runbook assumes.
2. **A Resend account** (free tier: 3,000 emails/month, 100/day, one verified domain — enough
   for a beta; the Supabase rate limit below is set well under the daily cap).
3. The sender address on that domain, e.g. `no-reply@<domain>` — a role address, so the policy's
   support inbox and the transactional sender stay separate.

## Step 1 — Verify the domain in Resend (DNS)

Resend → Domains → Add domain → enter `<domain>` (region: **ap-northeast-1 / Tokyo** is the
nearest to Thailand and to the Supabase project's Sydney region; any region works). Resend then
lists the records to add at the registrar. Copy them **from the Resend page**, not from here —
the exact values are generated per domain, and domains added after August 2026 may be given
CNAME records in place of the MX/TXT pair. The shape to expect:

| Purpose | Type | Name (host) | Value | Required |
|---|---|---|---|---|
| DKIM | TXT | `resend._domainkey` | `p=MIGf...` (long key, **PASTE** from Resend) | yes |
| SPF / return-path | MX | `send` | `feedback-smtp.<region>.amazonses.com`, priority `10` | yes (or the CNAME Resend shows instead) |
| SPF | TXT | `send` | `v=spf1 include:amazonses.com ~all` | yes (or the CNAME Resend shows instead) |
| DMARC | TXT | `_dmarc` | `v=DMARC1; p=none;` | recommended — start at `p=none`, tighten later |

At the registrar, enter only the host part (`resend._domainkey`, not `resend._domainkey.<domain>`).
Verification usually completes within minutes; Resend's Domains page shows **Verified** when the
records have propagated. Do not proceed until it does — Supabase's SMTP test will fail otherwise.

## Step 2 — Create the API key

Resend → API Keys → Create → name `supabase-auth-pace-analysis`, permission **Sending access**,
domain restricted to `<domain>`. Copy it once; Resend never shows it again. **PASTE** it into the
`RESEND_API_KEY` variable in Step 3. It is a secret: it lives in Supabase's SMTP settings and
nowhere in this repo, `.env`, or `eas.json`.

## Step 3 — Point Supabase Auth at Resend SMTP

Either the Dashboard (Authentication → Emails → SMTP Settings → Enable Custom SMTP) or, matching
how every other auth setting of this project has been applied, one scoped Management API PATCH:

```sh
export SUPABASE_ACCESS_TOKEN="$(cat ~/.supabase/access-token)"
export REF=vputdomdlknvthnzritt
export RESEND_API_KEY='re_...'              # PASTE (Step 2)
export SENDER_EMAIL='no-reply@<domain>'     # PASTE (verified domain)

curl -s -X PATCH -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  "https://api.supabase.com/v1/projects/$REF/config/auth" -d "$(python3 - <<PY
import json, os
print(json.dumps({
  "smtp_host": "smtp.resend.com",
  "smtp_port": "465",
  "smtp_user": "resend",
  "smtp_pass": os.environ["RESEND_API_KEY"],
  "smtp_admin_email": os.environ["SENDER_EMAIL"],
  "smtp_sender_name": "Pace Analysis AI",
  "smtp_max_frequency": 60,
  "rate_limit_email_sent": 30,
}))
PY
)"
```

| Supabase field | Value | Note |
|---|---|---|
| `smtp_host` | `smtp.resend.com` | |
| `smtp_port` | `465` (implicit TLS); `587` also works | |
| `smtp_user` | `resend` | literal — the username is always `resend` |
| `smtp_pass` | the API key | **PASTE** |
| `smtp_admin_email` | `no-reply@<domain>` | the sender address; must be on the verified domain |
| `smtp_sender_name` | `Pace Analysis AI` | |
| `smtp_max_frequency` | `60` | seconds between emails to the same address — leave the default |
| `rate_limit_email_sent` | `30` | **the limit to raise** — Supabase's own default once custom SMTP is on; 30/hour is far under Resend's 100/day and still caps a reset-request flood |

Read it back and confirm `smtp_host` and `smtp_admin_email` are set (the API never echoes
`smtp_pass`):

```sh
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "https://api.supabase.com/v1/projects/$REF/config/auth" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k: d[k] for k in ("smtp_host","smtp_port","smtp_user","smtp_admin_email","smtp_sender_name","rate_limit_email_sent")})'
```

Then mirror the values in `supabase/config.toml` by uncommenting its `[auth.email.smtp]` block with
`pass = "env(SUPABASE_AUTH_SMTP_PASS)"` — never the literal key — and `[auth.rate_limit]
email_sent = 30`, in the same commit as the change-log entry.

## Step 4 — Replace the templates

Only the **recovery** template is on a live path. It is still the unbranded default. The subject
and body below follow the in-app copy rules (`constants/copy.ts`: short sentences, no
contractions, no exclamation marks). Apply in the same PATCH style (`mailer_subjects_recovery`,
`mailer_templates_recovery_content`) or in the Dashboard under Authentication → Emails →
Templates → Reset password.

Subject:

```
Reset your Pace Analysis AI password
```

Body:

```html
<h2>Reset your password</h2>

<p>We received a request to reset the password for the Pace Analysis AI account registered to {{ .Email }}.</p>

<p><a href="{{ .ConfirmationURL }}">Choose a new password</a></p>

<p>The link opens the app, expires in one hour, and can be used once.</p>

<p>If you did not request a reset, you can ignore this email. Your password will not change.</p>
```

`{{ .ConfirmationURL }}` carries the `paceanalysisai://update-password` redirect the app
requests; the one-hour figure is `mailer_otp_exp = 3600` (live) — change both together or neither.

The other templates (confirmation, invite, magic link, email change, the change notifications)
are not sent by any flow the app has; leave them until a flow needs one, then brand it here first.

## Step 5 — Prove it

1. Resend → Domains shows **Verified**; Supabase Dashboard SMTP settings show **Custom SMTP
   enabled**.
2. In the app, request a password reset for a real account. The email arrives from
   `Pace Analysis AI <no-reply@<domain>>` with the subject above; Resend → Emails lists it as
   **Delivered**.
3. Tap the link on the device: the app opens `update-password`, a new password saves, sign-in
   with it works.
4. Request three resets within an hour for three addresses — the third one arrives (the old
   2/hour cap is gone).

Record the date and the `auth_get` read-back in `docs/change_log.md` and `docs/status.md`, and
close #139 with them.

## What the captain must paste, in one list

1. DNS records from Resend's Domains page into the registrar (DKIM TXT, the `send` MX + TXT pair
   or their CNAME equivalents, the `_dmarc` TXT).
2. The Resend API key into `RESEND_API_KEY` (Step 3) — or the Dashboard's SMTP password field.
3. The sender address on the verified domain into `SENDER_EMAIL` — or the Dashboard's sender
   email field.

Everything else in this file is fixed text.

## Not covered here, on purpose

- **Email confirmation on sign-up** (`enable_confirmations`) stays off. Turning it on needs a
  "check your inbox" screen and copy that do not exist (`supabase/config.toml`'s `[auth.email]`
  note); it is a product change, not part of the mailer swap.
- **Custom domain for the Supabase auth endpoint** (Pro-plan feature). Links in the email stay on
  `vputdomdlknvthnzritt.supabase.co`; that is fine for a deep link the app consumes.
- The **Send Email auth hook** (a Resend HTTP hook instead of SMTP). SMTP keeps GoTrue's own
  templating and rate limiting and needs no new edge function; revisit only if per-email
  metadata or a non-SMTP provider is ever needed.
