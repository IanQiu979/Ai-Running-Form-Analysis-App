-- analyses: one row per reserve_analysis() call (RPC family added in a
-- later migration). Rows move through status 'reserved' -> 'delivered' on
-- success, or 'reserved' -> 'released' on failure/fallback (compensating
-- release — a released row never counts toward quota again, but it does
-- count toward the 3-failed-attempt anti-farming cap; see reserve_analysis).
--
-- Client code never inserts or updates this table directly — every write
-- goes through the SECURITY DEFINER RPCs (reserve_analysis / settle_analysis
-- / release_analysis), called from the analyze-form edge function under the
-- service role. The client only ever reads and deletes its own rows, via
-- the RLS policies below.

create type public.media_type as enum ('photo', 'video');
create type public.analysis_status as enum ('reserved', 'delivered', 'released');
-- Distinct from subscription_tier (previous migration): an analysis can run
-- at the free tier, where subscriptions has no row at all, so 'free' has to
-- be a valid value here even though it can never appear in
-- subscriptions.tier.
create type public.analysis_tier as enum ('free', 'pro', 'elite');

create table public.analyses (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,

  media_type      public.media_type not null,
  -- Private-bucket paths of the analyzed frames (already uploaded
  -- direct-to-bucket by the client before analyze-form is called) — kept by
  -- default so Past Analyses can render them; NOT a single video path (the
  -- original video is never uploaded or stored, per Ruling 1).
  media_paths     text[] not null default '{}',
  frame_count     integer not null check (frame_count > 0),

  tier_at_run     public.analysis_tier not null,
  status          public.analysis_status not null default 'reserved',
  result          jsonb,
  is_fallback     boolean not null default false,

  -- Client-minted once per capture-flow commit; UNIQUE below with user_id so
  -- a retried request returns the existing row via reserve_analysis instead
  -- of double-reserving/double-charging quota and Anthropic.
  idempotency_key text not null,
  -- Freeform note from release_analysis (e.g. 'validation_failed',
  -- 'model_error') — observability only, not read by any check.
  release_reason  text,

  created_at      timestamptz not null default now(), -- = reservation time
  delivered_at    timestamptz,
  released_at     timestamptz,
  updated_at      timestamptz not null default now(),

  constraint analyses_user_idempotency_key_unique unique (user_id, idempotency_key)
);

-- Backs "list my analyses, most recent first" (Past Analyses / History).
create index analyses_user_created_idx on public.analyses (user_id, created_at desc);
-- Backs reserve_analysis's quota-window counts (equality on user_id, filter
-- on status, range-scan on created_at within the current period).
create index analyses_user_status_created_idx on public.analyses (user_id, status, created_at);

create trigger analyses_updated_at
  before update on public.analyses
  for each row execute function public.set_updated_at();

alter table public.analyses enable row level security;

create policy "Users can view their own analyses"
  on public.analyses for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can delete their own analyses"
  on public.analyses for delete
  to authenticated
  using (auth.uid() = user_id);

-- No insert/update policy for authenticated/anon: rows are created only by
-- reserve_analysis() and mutated only by settle_analysis()/release_analysis()
-- (all SECURITY DEFINER, service_role-only, added in a later migration) —
-- never directly by the client. Direct client DELETE is intentionally
-- allowed (matches the task's owner-scoped RLS spec); the planned
-- DELETE /functions/v1/analysis/:id edge function is the *preferred* path
-- for keeping the row and its Storage objects from getting out of sync, but
-- RLS still permits the row-only delete as a fallback/direct path.

-- SUPERSEDED 2026-07-12 by 20260712041500_analysis_usage_ledger.sql (issue #2):
-- the "Users can delete their own analyses" policy above is DROPPED and the
-- DELETE/UPDATE/TRUNCATE grants revoked. Counting live analyses rows for quota
-- meant deleting the row deleted the evidence of quota being used — a free user
-- could DELETE their row and get unlimited free analyses. Quota now derives from
-- the append-only public.analysis_usage ledger; deletion is exclusively
-- DELETE /functions/v1/analysis/:id (#57). The "intentionally allowed" comment
-- above is retracted.
