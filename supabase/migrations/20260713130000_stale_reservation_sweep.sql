-- Issue #47 (M4): sweep 'reserved' analyses rows stranded by a crashed/killed analyze-form
-- invocation. This is the BACKSTOP for the failure #44's own `finally` block cannot handle: a
-- `finally` runs when the function throws or returns, but not when the process is KILLED
-- (edge-function wall-clock limit, OOM, a deploy mid-request). A row stuck in 'reserved' counts
-- toward the user's quota FOREVER (reserve_analysis's v_active_count: `status in ('reserved',
-- 'delivered')`) and toward quota-status's "used" count (20260712233000_quota_status_function.sql)
-- — on Free, a lifetime tier, that is the user's ENTIRE allowance, silently gone, for an analysis
-- they never received. docs/status.md Known Issue #14 asked for exactly this.
--
-- READ #6 AND ITS FIX (20260712220000_anti_farm_release_reason_fix.sql) BEFORE TOUCHING THIS
-- FILE. A release hands the reservation back — release_analysis's own header: "never counts
-- toward quota again, but it DOES count toward the 3-failed-attempt anti-farming cap." An
-- over-eager or wrongly-classified sweep is a free-analysis farming vector in one direction
-- (releasing quota with no cost) and a re-run of #6's bug in the other (bricking a free account
-- via a release_reason the anti-farm count treats as abuse). Both failure modes are closed below
-- by construction, not by convention — see "WHY release_reason = 'stale_sweep' CANNOT FARM"
-- further down.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- DESIGN DECISION 1 — THE STALENESS THRESHOLD (15 minutes), derived, not guessed.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- Two independent ceilings bound how long a LEGITIMATE (non-crashed) 'reserved' row can stay
-- reserved, both read from the live code, not assumed:
--
--   1. analyze-form's OWN self-imposed budget: `ANALYZE_FORM_DEADLINE_MS = 105_000` (105s),
--      `supabase/functions/analyze-form/flow.ts:122` — "Wall-clock budget for ALL model work in
--      one request, measured from the moment the reserve lands... sized to leave ~15s of
--      headroom under the client's timeout." The reservation itself lands slightly AFTER this
--      clock starts (consent + the AI spend gate run first), so a normally-completing request's
--      row age at settle/release time is bounded by ~105s, plus a further, unbounded-in-code but
--      empirically small tail for uploadFrames (capped by `PACE_MAX_REQUEST_BODY_BYTES` = 5MB
--      across at most `PACE_FRAME_CAP.elite` = 8 frames) + settle_analysis's one RPC round trip
--      + the `finally` block's own RPC calls. Call the realistic non-crashed ceiling ~120-125s.
--
--   2. Supabase Edge Functions' PLATFORM wall-clock limit: 150 seconds for a Free/Pro-plan
--      function to return its initial HTTP response (Supabase docs, "Edge Function 'wall clock
--      time limit reached'" / supabase.com/docs/guides/functions/limits, checked at the time of
--      writing this migration). This is the TRUE outer bound on how long ANY invocation — even
--      one wedged on a hung Storage/DB call with no explicit per-call timeout, a real gap in
--      `uploadFrames`/`settleAnalysis` today — can still be genuinely alive and about to finish
--      on its own. Past 150s, the platform itself terminates the isolate; nothing analyze-form's
--      own code does can extend that. This, not the self-imposed 105s, is the number a sweep
--      threshold must clear with margin, because it is the case the sweep exists FOR: a killed
--      process cannot ever produce a row older than this while still being "in flight."
--
-- Threshold chosen: 15 minutes (900s) — 6x the 150s platform kill, ~7.5x the 120s self-imposed
-- ceiling. That margin absorbs clock skew between the edge runtime and Postgres, any queueing/
-- cold-start delay before a request's clock even starts, and the sweep's own cron cadence (below)
-- — while still being "the backstop for a genuinely dead invocation," never a threat to a live
-- one. The issue's own suggested "e.g. 15 min" turns out to check out against the actual numbers,
-- not just be a round figure.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- DESIGN DECISION 2 — RELEASES QUOTA, WITH release_reason = 'stale_sweep', A NEW SERVER-FAULT
-- VALUE. WHY IT CANNOT FARM.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- The row MUST be released (not left 'reserved' forever, and not hard-deleted — release_analysis's
-- own contract is "kept, not hard-deleted... still counts toward the 3-failed-attempt anti-farming
-- cap"): the whole point is to give the user their quota slot back, per the issue's stated harm.
--
-- 'stale_sweep' is added to `analyses_release_reason_known_values` (the CHECK constraint #6's fix
-- introduced) as a FOURTH server-fault reason, alongside 'model_error' / 'provider_timeout' /
-- 'internal_error'. It is NOT added to `public.pace_is_farming_signal`'s vocabulary (still, and
-- only, `release_reason in ('validation_failed')`) — meaning `reserve_analysis`'s
-- `v_released_count` NEVER counts a swept row, by the exact same construction #6 already relies on
-- for every other infrastructure-caused release. `reserve_analysis` itself needs NO change for
-- this to hold: it calls `pace_is_farming_signal(release_reason)` generically, so a release_reason
-- string it has never seen before is automatically excluded from the cap the moment the classifier
-- (unchanged) returns false for it — the exact "future taxonomy change never touches
-- reserve_analysis again" property that migration's header predicted.
--
-- Why 'stale_sweep' is honestly a server-fault, not an abuse signal: the row's own existence past
-- the threshold proves the analyze-form invocation that created it never got the chance to decide
-- anything — it did not fail validation, it did not run out of retries, it did not even necessarily
-- call the model. It was killed by infrastructure (a timeout, an OOM, a bad deploy) before it could
-- reach ANY of its own release paths. Attributing that to the user would be a narrower repeat of
-- #6's exact mistake (counting an outage against a farming cap) — which is precisely what the "READ
-- #6" instruction at the top of this file exists to prevent a future editor from reintroducing.
--
-- Farming check, explicitly: could a user exploit the sweep itself to farm free calls? No —
-- sweeping never HANDS BACK anything a user didn't already have (it releases a reservation that
-- already existed, at most once, 15 minutes after the fact, at zero incremental Anthropic spend
-- since sweeping does not call the model) and a swept release costs nothing extra against the
-- anti-farm cap either. The worst a user can do is deliberately abandon a client mid-request
-- (close the app after submitting) — that already does not save them anything: the server-side
-- analyze-form invocation runs to completion (or crashes) independent of whether the client is
-- still listening ("backgrounding recovery", flow.ts's own header), so abandoning the client early
-- cannot manufacture a stale row on demand; only a genuine crash of the SERVER-SIDE invocation can.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- DESIGN DECISION 3 — pg_cron calling a SQL function DIRECTLY, not a scheduled edge function.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- CLAUDE.md: "No business rules in the client... [reserved for] edge functions" — both a pg_cron
-- job and an edge function satisfy "server-only"; the choice between them is operational, not a
-- business-rule question, and is made explicitly here so a future reader does not have to re-derive
-- it:
--
--   * This operation is PURE DATABASE bookkeeping — read stale rows, flip a status, stamp a
--     reason and a timestamp. No third-party API, no external I/O, nothing an edge/Deno runtime
--     is suited for that Postgres itself is not.
--   * A pg_cron-triggers-an-edge-function design is NOT actually simpler: pg_cron can only run SQL,
--     so reaching an HTTP edge function requires `pg_net.http_post` from inside the cron job, which
--     needs SOME credential in its request headers (a service-role key, or at minimum a shared
--     secret the function checks itself if `verify_jwt` is disabled). That credential has to live
--     somewhere `pg_net`'s SQL can read it from — Supabase Vault is the documented place — and a
--     migration file (checked into git) can never safely provision the ACTUAL secret VALUE into
--     Vault without violating CLAUDE.md's "never hold a secret in a function's source" (a migration
--     is source). That would leave the wiring incomplete until a human manually inserts a Vault
--     secret out-of-band — a real deploy-order gap this migration would rather not introduce.
--   * Calling `public.sweep_stale_reservations()` straight from `cron.schedule(...)` needs no
--     credential at all: the job runs as the role that scheduled it (here, the migration-owning
--     `postgres` role), which already has the privilege to call a function it owns — zero secrets,
--     zero HTTP round trip, zero additional deploy step, one self-contained migration file.
--   * Precedent already in this schema: `pending_timeout_seconds` (ai_ops_config,
--     20260712210000_ai_spend_guardrails.sql) ages a stuck 'pending' ai_call_log row out AT READ
--     TIME, inside the spend-sum query itself, explicitly "no cron sweeper needed" — but that
--     trick only works because exactly ONE query consumes that state. A stale 'reserved' analyses
--     row is consumed by THREE independent places that must all agree it is no longer active:
--     reserve_analysis's v_active_count, quota-status's "used" count
--     (20260712233000_quota_status_function.sql), and the anti-farm v_released_count. Requiring
--     all three to independently reimplement an age-out predicate is exactly the kind of
--     duplicated business rule this codebase has already been bitten by more than once (#2, #6,
--     #88 are all "two places disagreed" bugs) — a real status TRANSITION, done once, gives every
--     consumer a single source of truth for free. This is why #47 asks for an actual sweep rather
--     than a read-time exclusion, and why that request is architecturally correct here even though
--     it wasn't needed for the pending-call case.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- DESIGN DECISION 4 — RACE-SAFETY AGAINST A LIVE settle_analysis/release_analysis, WITHOUT AN
-- ADVISORY LOCK.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- The sweep uses the SAME idiom `settle_analysis`/`release_analysis` already rely on (their own
-- header comments: "a duplicate/late call is a safe no-op") — a single UPDATE statement whose
-- WHERE clause re-checks `status = 'reserved'` at the moment it actually writes, plus
-- `for update skip locked` in the row-selection subquery for safe, non-blocking BATCHING:
--
--   * If a live analyze-form invocation's settle_analysis/release_analysis call reaches a row
--     BEFORE the sweep's row-selection subquery does, that row is already locked; the sweep's
--     `for update skip locked` simply skips it this cycle (it is not stale by construction anyway
--     — see Decision 1 — so skipping it is always correct, never a missed sweep of a truly dead
--     row).
--   * If the sweep's subquery locks a row FIRST, any concurrent settle_analysis/release_analysis
--     call for that same row blocks on ITS OWN UPDATE until the sweep's transaction commits, then
--     re-evaluates ITS OWN `where ... and status = 'reserved'` against the now-committed
--     'released' row, matches zero rows, and returns its already-documented safe no-op
--     (`{ok: false, reason: 'not_reserved_or_not_found'}` — flow.ts's `safeRelease`/the
--     `!settled.ok` branch both already treat this as non-fatal).
--   * Either ordering: the row is mutated exactly once, by whichever transaction gets there first,
--     and the other side's own pre-existing no-op guard absorbs the loss. No advisory lock is
--     needed because — unlike `reserve_analysis`'s count-then-insert race, which genuinely needs
--     one to make two concurrent COUNTS agree — this is a single conditional UPDATE, and Postgres's
--     own row-level locking already serializes two writers of the same row for free.
--
-- BOUNDING THE WORK: `p_batch_limit` (default 500) caps rows swept per invocation via `limit ...
-- for update skip locked` in the subquery, so an incident that leaves many rows stale at once
-- (e.g. a bad deploy crashing every request for 20 minutes) cannot make one sweep run try to lock
-- and rewrite an unbounded number of rows; whatever a run does not reach is picked up on the next
-- cron tick (5-minute cadence, chosen for near-real-time recovery without querying on every tick).
--
-- OBSERVABILITY: every swept row's `release_reason = 'stale_sweep'` and `released_at` ARE the
-- audit trail (`select * from analyses where release_reason = 'stale_sweep'` shows exactly what
-- was swept and when) — the same "release_reason exists for observability" idiom this column has
-- carried since its introduction. The function also `raise log`s a one-line summary whenever it
-- sweeps at least one row, visible in Postgres logs, and every cron run's outcome (success/failure,
-- duration) is separately recorded by pg_cron itself in `cron.job_run_details` with no extra code.
-- KNOWN GAP, stated rather than silently left: neither of those is wired to actual alerting (a
-- human being paged if the sweep starts firing constantly, which would mean analyze-form is
-- crashing far more than expected) — that is `uptime-healthcheck`/`observability-setup` territory
-- per AGENTS.md's routing table, out of scope for this issue, and worth its own follow-up.

-- ---------------------------------------------------------------------------------------------
-- 1. Enable pg_cron. Verified live (list_extensions, project vputdomdlknvthnzritt) as available
--    but NOT installed (installed_version: null) before writing this migration. Exact recipe from
--    Supabase's own docs ("Install" / supabase.com/docs/guides/cron/install) — the `postgres` role
--    in a managed Supabase project is not a full superuser, so the explicit grants below are
--    required even though `postgres` owns this migration.
-- ---------------------------------------------------------------------------------------------

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- ---------------------------------------------------------------------------------------------
-- 2. Extend the release_reason vocabulary. Superset-only (every previously-valid value stays
--    valid), so this is safe regardless of the table's current row count — unlike #6's fix, which
--    depended on the table being empty, this one does not need that fact to be true. Verified live
--    immediately before writing this file anyway (project vputdomdlknvthnzritt): 0 rows in
--    public.analyses, so there is nothing to reconcile either way.
-- ---------------------------------------------------------------------------------------------

alter table public.analyses
  drop constraint analyses_release_reason_known_values;

alter table public.analyses
  add constraint analyses_release_reason_known_values
  check (
    release_reason is null
    or release_reason in (
      'model_error',       -- server-fault: the Anthropic call itself errored
      'provider_timeout',  -- server-fault: the Anthropic call timed out
      'internal_error',    -- server-fault: our own code raised before/after the model call
      'validation_failed', -- farming signal: response failed structural validation after retry —
                            -- the only value pace_is_farming_signal() ever returns true for
      'stale_sweep'        -- server-fault (issue #47): the reservation was never settled or
                            -- released by its own analyze-form invocation, which was killed
                            -- (timeout/OOM/deploy) before it could reach any of its own release
                            -- paths — reclaimed by public.sweep_stale_reservations() below.
                            -- Deliberately NOT in pace_is_farming_signal's vocabulary; see this
                            -- file's header, "WHY release_reason = 'stale_sweep' CANNOT FARM".
    )
  );

-- ---------------------------------------------------------------------------------------------
-- 3. A partial index scoped to exactly what the sweep (and only the sweep) queries: live
--    reservations, oldest first. Kept small by construction — most rows a mature product
--    accumulates are 'delivered' or 'released', never 'reserved' for long, so this index only ever
--    holds the current in-flight set. `analyses_user_status_created_idx` (the existing composite
--    index) leads with user_id and cannot serve this GLOBAL, cross-user query efficiently.
-- ---------------------------------------------------------------------------------------------

create index if not exists analyses_reserved_created_idx
  on public.analyses (created_at)
  where status = 'reserved';

-- ---------------------------------------------------------------------------------------------
-- 4. The sweep function itself. SECURITY DEFINER + pinned search_path, matching every other RPC
--    in this schema (quota_reserve_settle_release.sql's own header explains why: p_user_id-style
--    trust is not the concern here since this function takes no caller-supplied identity at all,
--    but EXECUTE must still be locked down — see the revoke/grant below — so no client can ever
--    invoke it directly, tune its own staleness window, or force an early release of someone
--    else's live reservation).
-- ---------------------------------------------------------------------------------------------

create or replace function public.sweep_stale_reservations(
  p_stale_after interval default interval '15 minutes',
  p_batch_limit integer default 500
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_swept_count integer;
begin
  with candidates as (
    select id
    from public.analyses
    where status = 'reserved'
      and created_at < now() - p_stale_after
    order by created_at
    limit greatest(p_batch_limit, 0)
    for update skip locked
  )
  update public.analyses a
  set status = 'released',
      released_at = now(),
      release_reason = 'stale_sweep'
  from candidates c
  where a.id = c.id
    -- Belt-and-braces re-check, same idiom as settle_analysis/release_analysis's own guard: the
    -- `for update skip locked` above already makes this redundant under normal MVCC semantics
    -- (see this file's header, Design Decision 4), but costs nothing and documents the invariant
    -- inline rather than only in a comment two sections up.
    and a.status = 'reserved';

  get diagnostics v_swept_count = row_count;

  if v_swept_count > 0 then
    raise log 'sweep_stale_reservations: released % row(s) as stale_sweep (older than %)',
      v_swept_count, p_stale_after;
  end if;

  return v_swept_count;
end;
$$;

revoke execute on function public.sweep_stale_reservations(interval, integer) from public, anon, authenticated;
grant execute on function public.sweep_stale_reservations(interval, integer) to service_role;
-- No grant to postgres needed: cron.schedule's job below runs as the role that scheduled it
-- (postgres, the migration-owning role), which already has EXECUTE on a function it owns
-- regardless of the revoke above (that revoke targets public/anon/authenticated — client-facing
-- roles — never the owner).

-- ---------------------------------------------------------------------------------------------
-- 5. Schedule it. `cron.schedule(job_name, ...)` UPSERTS by name (documented pg_cron behavior),
--    so re-running this migration (or a future migration that needs to retune the schedule) is
--    safe and idempotent — no `cron.unschedule` needed first. Every run's own outcome (succeeded/
--    failed, start/end time) is recorded by pg_cron itself in cron.job_run_details with no
--    additional code on this end.
-- ---------------------------------------------------------------------------------------------

select cron.schedule(
  'sweep-stale-analysis-reservations',
  '*/5 * * * *', -- every 5 minutes — see this file's header for why that cadence
  $$select public.sweep_stale_reservations();$$
);
