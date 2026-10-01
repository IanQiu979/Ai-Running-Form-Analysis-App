-- Issue #205: clear the live security advisor's `extension_in_public` WARN for `pg_net` by
-- re-creating the extension with `schema extensions`, the placement Supabase documents.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHAT ACTUALLY MOVES — only a catalog label. No pg_net object has ever been in `public`.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- `20260806090000_sweep_orphaned_media_cron.sql` ran `create extension if not exists pg_net`
-- with no `schema` clause, so Postgres recorded the first existing schema on `postgres`'s
-- search_path (`public`) as `pg_extension.extnamespace` — which is the only thing the advisor's
-- lint (0014) reads. pg_net's install script hard-codes every object it creates into its own
-- `net` schema, so all 28 member objects were verified live in `net` on 2026-09-30 and none in
-- `public`. After this file they are re-created in `net` again, under identical names and
-- signatures; only `extnamespace` changes, to `extensions`.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHY DROP + CREATE, NOT `ALTER EXTENSION ... SET SCHEMA`
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- pg_net 0.20.3's control file says `relocatable = false` (live: `pg_extension.extrelocatable =
-- false`), and Postgres refuses SET SCHEMA on a non-relocatable extension even for a superuser
-- ("extension "pg_net" does not support SET SCHEMA"). Supabase's own troubleshooting guide for
-- pg_net gives this same drop-then-create pair. supautils runs both statements as
-- `supabase_admin` for `postgres`, because pg_net is in `supautils.privileged_extensions`.
--
-- WHAT IS LOST: every row in `net._http_response` (pg_net's 6-hour response log; one row live on
-- 2026-09-30, that day's 09:00 sweep response) and the `net.http_request_queue_id_seq`
-- position (request ids restart at 1). The guard below makes an in-flight request a hard
-- failure rather than a silent loss. The Supabase CLI runs this file and its ledger insert as
-- one implicit transaction, so if the CREATE fails the DROP is rolled back with it.
--
-- WHAT IS NOT CHANGED: the `sweep-orphaned-media-daily` pg_cron job (jobid 2). Its command
-- calls `net.http_post(...)` schema-qualified and pg_cron re-parses the text on every run, so
-- it has no OID dependency to break. It is the only pg_net caller in the repo or the live
-- database (`cron.job`, `pg_proc`, views, triggers, policies, defaults and event triggers were
-- all searched on 2026-09-30; issue #205).
--
-- GRANTS ARE NOT TOUCHED. `anon`/`authenticated` hold `net` USAGE and EXECUTE through grants
-- made BY `supabase_admin` (pg_net.sql's own `grant ... to PUBLIC`, and Supabase's
-- `grant_pg_net_access` event trigger, which re-fires on the CREATE below). A REVOKE run as
-- `postgres` cannot remove a grant it did not make — it only warns and changes nothing, the same
-- trap as `storage.objects` (docs/status.md Known Issue #18) — so none is written here. `net` is
-- not a PostgREST-exposed schema; that residual is a documented decision in docs/status.md
-- (issue #205), not "fixed" by a statement that does nothing.
--
-- APPLY WINDOW: not between 08:55 and 09:05 UTC. The sweep job enqueues at 09:00 and the pg_net
-- worker holds a lock on both tables for the whole HTTP round-trip (up to the 30 s request
-- timeout), which the DROP would have to wait behind. `lock_timeout` turns that wait into a
-- clean failure; re-run outside the window.

set lock_timeout = '10s';

do $$
declare
  queued bigint;
begin
  if to_regclass('net.http_request_queue') is not null then
    execute 'select count(*) from net.http_request_queue' into queued;
    if queued > 0 then
      raise exception 'pg_net has % queued request(s); re-run after the queue drains', queued
        using hint = 'The sweep job enqueues at 09:00 UTC. Apply outside 08:55-09:05 UTC.';
    end if;
  end if;
end;
$$;

drop extension if exists pg_net;
create extension pg_net schema extensions;

reset lock_timeout;
