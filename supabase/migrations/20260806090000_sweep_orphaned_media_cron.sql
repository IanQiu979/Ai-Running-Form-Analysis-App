-- Issue #137 / decision `orphan-sweep-scheduling-mechanism`: put the already-built, already-tested
-- `sweep-orphaned-media` edge function (`supabase/functions/sweep-orphaned-media/`) on a recurring
-- schedule against the live project. It has existed, deployed, since 2026-07-26 but nothing has
-- ever called it (docs/status.md Known Issue #32) — orphaned `{user_id}/{analysis_id}/` prefixes in
-- the private `media` bucket accumulate unswept until this lands.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- ROUTE — pg_cron + pg_net + Vault, not a Supabase Dashboard Cron Job.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- `sweep-orphaned-media/index.ts`'s own header already reasoned through Dashboard Cron Job vs.
-- pg_net+Vault and picked the Dashboard route "because... no code in this repo can create a
-- Dashboard Cron Job; that is a Studio UI action only Ian can take." This migration exists because
-- that constraint doesn't hold in reverse: this environment has no interactive Studio UI login, but
-- it does have direct SQL access to the live project (equivalent to what the Dashboard's own Cron
-- Jobs integration does under the hood — it is pg_cron+pg_net too). Per this issue's own routing
-- ("pg_cron + pg_net directly if the dashboard UI isn't reachable from this environment"), and per
-- `20260713130000_stale_reservation_sweep.sql`'s Design Decision 3 (the prior sweep's reasoning for
-- avoiding this exact route), the blocker that reasoning named — "a migration file (checked into
-- git) can never safely provision the ACTUAL secret VALUE into Vault" — is respected here too: this
-- file references a Vault secret BY NAME only. The secret's actual value was provisioned directly
-- against the live project via `vault.create_secret(...)`, run ad hoc (not from a committed file),
-- immediately before this migration — see the deploy/config note in docs/status.md for the exact
-- shape. This migration is safe to read, commit, and re-run; it contains no credential.
--
-- The credential itself is a fresh value for `SWEEP_ORPHANED_MEDIA_SECRET` (the edge function's own
-- shared-secret env var, set via `supabase secrets set`, matching what's now in Vault under the name
-- referenced below) — NOT a service-role key. The function's own `checkCronAuth` (core.ts) was
-- always designed around a shared secret compared against `X-Cron-Secret`, not a JWT (a cron
-- invocation has no user session to present), so a service-role credential was never the right shape
-- here regardless of scheduling mechanism.
--
-- ALSO FIXED IN THE SAME BATCH, NOT BY THIS FILE: the function was live with `verify_jwt: true`,
-- which would have 401'd every cron call at the platform gateway before `checkCronAuth` ever ran —
-- contradicting the deploy instruction in the function's own header. Fixed by redeploying with
-- `--no-verify-jwt` (now pinned in `supabase/config.toml`'s `[functions.sweep-orphaned-media]`) as
-- an out-of-band `supabase functions deploy` step, not a migration concern.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- DRY-RUN BY DEFAULT — deliberately not armed for live deletion by this migration.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- The scheduled request body is `{}` (empty), which `parseSweepRequest` (core.ts) defaults to
-- `dryRun: true` — the sweep will report what it WOULD delete without deleting anything. The
-- function's own header names this as the intended posture for a "freshly wired-up but not-yet-
-- reviewed Cron Job." Flipping to live deletion (`{"dryRun": false}`) is a deliberate follow-up act
-- once dry-run output has been reviewed in the edge function logs — it deletes user media
-- permanently and is out of scope for "schedule the sweep," which is what this migration does.
--
-- Cadence: once daily, matching this decision's own "cleanup, not latency-sensitive" framing.
-- 09:00 UTC — outside any known peak-traffic window for this app (no traffic data exists yet to
-- pick a better time; revisit once it does).

create extension if not exists pg_net;

select cron.schedule(
  'sweep-orphaned-media-daily',
  '0 9 * * *', -- 09:00 UTC daily
  $$
  select net.http_post(
    url := 'https://vputdomdlknvthnzritt.supabase.co/functions/v1/sweep-orphaned-media',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'sweep_orphaned_media_cron_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
