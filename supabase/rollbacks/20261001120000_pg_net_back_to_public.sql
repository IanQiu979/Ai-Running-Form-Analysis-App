-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- NOT A MIGRATION. This directory is outside `supabase/migrations/`, so `db push` never reads it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- To roll back 20261001120000_pg_net_extensions_schema.sql, copy this file into
-- `supabase/migrations/<new timestamp>_pg_net_back_to_public.sql` and ship it as a NEW forward
-- migration through `supabase db push --linked`. Never delete ledger rows and never use the MCP
-- `apply_migration` tool (CLAUDE.md, issue #201). Apply outside 08:55-09:05 UTC.
--
-- Rollback is almost certainly not the fix for a misbehaving sweep: nothing in the project reads
-- `pg_extension.extnamespace`. Try `select net.worker_restart(); select net.wait_until_running();`
-- first (docs/status.md Known Issue #53).
--
-- LOSSY, exactly like the forward move: it drops every `net._http_response` row written since
-- the move and restarts the request-id sequence at 1. It loses no user data, media, cron job,
-- cron run history or Vault secret, because none of those live in `net`. The guard aborts on a
-- queued request instead of losing it.
--
-- Rollback of 20261001120000_pg_net_extensions_schema.sql (issue #205): returns pg_net's
-- extnamespace to public, which re-raises the advisor's extension_in_public WARN.
set lock_timeout = '10s';

do $$
declare
  queued bigint;
begin
  if to_regclass('net.http_request_queue') is not null then
    execute 'select count(*) from net.http_request_queue' into queued;
    if queued > 0 then
      raise exception 'pg_net has % queued request(s); re-run after the queue drains', queued;
    end if;
  end if;
end;
$$;

drop extension if exists pg_net;
create extension pg_net schema public;

reset lock_timeout;
