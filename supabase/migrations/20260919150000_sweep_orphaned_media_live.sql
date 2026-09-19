-- Issue #137, final step (captain's 2026-08-15 ruling: the sweeper running for real is a launch
-- gate). `20260806090000_sweep_orphaned_media_cron.sql` scheduled `sweep-orphaned-media-daily`
-- with an empty request body, which `sweep-orphaned-media/core.ts`'s `parseSweepRequest` defaults
-- to `dryRun: true` — the job has run daily at 09:00 UTC since, succeeded every time (`cron.
-- job_run_details`), and reported what it WOULD delete without touching anything. That was the
-- deliberate posture for a freshly wired schedule whose output nobody had reviewed yet. It has
-- now been reviewed: the dry run of 2026-09-18 (`net._http_response` id 46) listed three
-- candidate prefixes, one object each, whose `{user_id}/{analysis_id}/` rows do not exist in
-- `public.analyses` (dating from 2026-07-26, 07-27 and 08-02 — the first live end-to-end runs,
-- before `settle_analysis` attached paths), and `list_orphaned_media_prefixes('15 minutes',
-- 500)` returns the same three today. They are exactly the class of object this job exists to
-- remove, and there is nothing else on the list.
--
-- This migration flips the scheduled body to `{"dryRun": false}`. Nothing else changes: same job
-- name, cadence, endpoint, Vault-sourced `X-Cron-Secret` (by name only — no credential in this
-- file, same rule as the original), timeout, and the function's own defaults for `olderThan`
-- (15 minutes — a frame uploaded by an in-flight `analyze-form` call is never a candidate) and
-- `limit` (500 per run; anything beyond is picked up next tick).
--
-- `cron.schedule(job_name, ...)` with an existing name updates that job in place (pg_cron names
-- are unique), so the live job keeps its `jobid` (2) and its run history; this is not a second
-- schedule. Re-running this file is harmless for the same reason.
--
-- Rolling back is the same statement with `body := '{}'::jsonb`. Deleted objects are not
-- recoverable — the private `media` bucket has no versioning — which is why the review above is
-- recorded here rather than assumed.

select cron.schedule(
  'sweep-orphaned-media-daily',
  '0 9 * * *', -- 09:00 UTC daily, unchanged
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
    body := '{"dryRun": false}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
