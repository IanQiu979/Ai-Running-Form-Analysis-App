-- AI spend guardrails — the gate (issue #91, design spec
-- docs/superpowers/specs/2026-07-12-ai-spend-guardrails-design.md). Reads/writes the tables from
-- the prior migration, 20260712210000_ai_spend_guardrails.sql.
--
-- SECURITY, same lesson as quota_reserve_settle_release.sql: all four functions are
-- SECURITY DEFINER with a pinned search_path and take p_user_id as a plain argument rather than
-- deriving it from auth.uid() — the calling context is always the edge function's service-role
-- client, acting on behalf of whichever user it already authenticated via the caller's JWT.
-- EXECUTE is revoked from public/anon/authenticated and granted only to service_role on every
-- one of them, so the client cannot call these directly, cannot forge a call_id into another
-- user's spend row, and cannot read the ledger. That is real, DB-enforced denial.
--
-- What is NOT DB-enforced, stated plainly: nothing in Postgres can stop a *future*
-- analyze-form (#44) from calling the Anthropic API directly without ever calling
-- gate_ai_call() first — Postgres never sees that HTTP call. "Physically cannot make an
-- Anthropic call without passing through this brake" is true in two senses here, not three:
--   1. The client cannot bypass it (DB privilege, enforced, above).
--   2. record_ai_call() cannot be called without a call_id, and the only way to get one is
--      through gate_ai_call() — there is no "just log a call after the fact" escape hatch in
--      the exported interface (supabase/functions/_shared/ai-guard.ts), so *using the ledger at
--      all* runs through the gate by construction.
--   3. analyze-form's OWN code choosing to skip both and call Anthropic un-gated is a code-review
--      problem, not a database one — closed by AGENTS.md's mandatory HIGH/CRITICAL chain, which
--      requires security-auditor review of anything on the hot list (edge functions, the
--      analyze-form flow explicitly named) before it ships. This migration's job is to make
--      passing through the gate the only sanctioned, ergonomic path; #44's review is what
--      actually checks it took that path. docs/architecture.md's "analyze-form edge function
--      flow" section is updated in this commit with a binding step naming this requirement, the
--      same way Known Issue #14 already binds the consent/idempotency/release requirements.
--
-- CALL ORDERING — the decision that matters, per the design spec: the gate runs BEFORE
-- reserve_analysis, not after.
--
--   auth -> consent -> AI GATE -> idempotency + quota reserve -> model call -> record + settle
--
-- If the gate ran after the quota reserve, every kill-switch/cap/breaker denial would have to
-- release that reservation — and reserve_analysis counts released rows against its 3-failed-
-- attempt anti-farming cap (quota_reserve_settle_release.sql). Three outages and a legitimate
-- user gets locked out with "too many failed attempts" for something we did, not them. Gating
-- first means a denied request never creates a reservation: nothing to release, the user's
-- retry budget untouched, and reserve_analysis needs NO changes for this to work.
--
-- The cost of gating first: because idempotency lives inside reserve_analysis, EVERY call to
-- analyze-form — including a pure replay of an already-delivered idempotent request — passes
-- through the gate and reserves a 'pending' ai_call_log row before the edge function can know
-- via reserve_analysis that no new model call is actually needed. record_ai_call(p_status =>
-- 'cancelled') is the release valve for exactly this: settle at $0 the moment the caller
-- discovers the call was never going to happen (an idempotent replay, or a genuine quota denial
-- after the gate already passed). This is why 'cancelled' exists as its own status distinct from
-- 'model_error' — a cancelled call is not a breaker failure, since nothing failed.
--
-- DEFINITION ORDER matters here, not just prose order: ai_breaker_state() is defined FIRST,
-- before gate_ai_call(), even though the gate is the more important function to read first —
-- gate_ai_call() calls ai_breaker_state() in its body, and with plpgsql.check_function_bodies on
-- (the Postgres default), CREATE FUNCTION resolves and type-checks every function call in the
-- body at creation time, not lazily. Defining gate_ai_call() before its callee exists would fail
-- the migration outright with "function public.ai_breaker_state() does not exist" — a forward
-- reference, not deferred resolution.

-- ai_breaker_state: derived, not stored — "look at the last breaker_failure_threshold settled
-- calls; if ALL of them failed and the most recent is within breaker_cooldown_seconds, the
-- breaker is open." No counter to reset or drift out of sync with reality. Defined before
-- gate_ai_call() (which calls it) — see the "DEFINITION ORDER" note above.
create or replace function public.ai_breaker_state()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_cfg                   public.ai_ops_config;
  v_fail_count             integer;
  v_most_recent_settled_at timestamptz;
  v_cooldown_active        boolean;
  v_probe_in_flight        boolean;
  v_open                   boolean := false;
begin
  select * into v_cfg from public.ai_ops_config where id;

  -- model_error / validation_failed count as failures. 'fallback' does NOT: a delivered partial
  -- result (>=2 pillars parsed) is a SUCCESS for the breaker — the user got value. This matters
  -- because it's exactly the issue's "a bad prompt change bills a solo developer's personal
  -- card" scenario: if every response were unparseable, EVERY call would burn full token cost
  -- and deliver nothing (validation_failed), which trips the breaker; a prompt that degrades
  -- gracefully into partial-but-useful results should not.
  select count(*) into v_fail_count
  from (
    select status
    from public.ai_call_log
    where status <> 'pending'
    order by settled_at desc
    limit v_cfg.breaker_failure_threshold
  ) recent
  where recent.status in ('model_error', 'validation_failed');

  select settled_at into v_most_recent_settled_at
  from public.ai_call_log
  where status <> 'pending'
  order by settled_at desc
  limit 1;

  v_cooldown_active :=
    v_most_recent_settled_at is not null
    and v_most_recent_settled_at > now() - make_interval(secs => v_cfg.breaker_cooldown_seconds);

  if v_fail_count >= v_cfg.breaker_failure_threshold and v_cooldown_active then
    -- Hard open: the failure streak is unbroken and still fresh.
    v_open := true;
  elsif v_fail_count >= v_cfg.breaker_failure_threshold and v_most_recent_settled_at is not null then
    -- HALF-OPEN GAP FILLED (not spelled out in the design spec): the streak is unbroken but the
    -- cooldown has lapsed, so exactly one call should probe through. gate_ai_call's global
    -- advisory lock serializes calls that reach the gate one at a time, but this state is
    -- DERIVED, not stored, so it has no counter to mark "a probe is already spoken for" — a
    -- burst of concurrent requests could otherwise all read "cooldown lapsed, not open" in the
    -- same instant, before any of their pending rows exist for each other to see, and all of
    -- them would pass through as "the" probe. So: if a pending call was already reserved AFTER
    -- the last failure (and hasn't aged out via pending_timeout_seconds), the breaker stays open
    -- for every OTHER caller until that one probe settles, one way or the other.
    select exists(
      select 1 from public.ai_call_log
      where status = 'pending'
        and created_at > v_most_recent_settled_at
        and created_at > now() - make_interval(secs => v_cfg.pending_timeout_seconds)
    ) into v_probe_in_flight;

    v_open := v_probe_in_flight;
  end if;

  return jsonb_build_object(
    'open', v_open,
    'consecutive_failures', v_fail_count,
    'failure_threshold', v_cfg.breaker_failure_threshold,
    'most_recent_settled_at', v_most_recent_settled_at,
    'cooldown_active', v_cooldown_active
  );
end;
$$;

revoke execute on function public.ai_breaker_state() from public, anon, authenticated;
grant execute on function public.ai_breaker_state() to service_role;

-- gate_ai_call: check kill switch -> circuit breaker -> daily cap, in that order, and reserve a
-- 'pending' ledger row on allow. Returns { allowed: false, reason } or
-- { allowed: true, call_id, estimated_usd }.
create or replace function public.gate_ai_call(
  p_user_id                 uuid,
  p_estimated_input_tokens  integer,
  p_estimated_output_tokens integer,
  p_model                   text default 'claude-sonnet-5',
  p_analysis_id             uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
set timezone = 'UTC'
as $$
declare
  v_cfg           public.ai_ops_config;
  v_pricing       public.ai_model_pricing;
  v_estimated_usd numeric;
  v_breaker       jsonb;
  v_settled_usd   numeric;
  v_pending_usd   numeric;
  v_spent_usd     numeric;
  v_call_id       uuid;
begin
  if p_estimated_input_tokens is null or p_estimated_input_tokens < 0
     or p_estimated_output_tokens is null or p_estimated_output_tokens < 0 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_estimate');
  end if;

  -- Single GLOBAL advisory lock — deliberately not per-user like reserve_analysis's lock,
  -- because this cap is global, not per-user. Serializes every gate_ai_call across every user so
  -- the "today's spend" read below reflects every other call that already committed, not a
  -- stale pre-insert figure — the identical concurrency lesson
  -- quota_reserve_settle_release.sql's header explains for per-user quota, one level up. Held
  -- only for this transaction (check + insert), never for the model call itself.
  perform pg_advisory_xact_lock(hashtext('ai_ops_gate'));

  select * into v_cfg from public.ai_ops_config where id;

  -- 1. Kill switch.
  if not v_cfg.analyze_enabled then
    return jsonb_build_object(
      'allowed', false, 'reason', 'killed', 'disabled_reason', v_cfg.disabled_reason
    );
  end if;

  -- 2. Circuit breaker (derived on read, not stored — see ai_breaker_state() above).
  v_breaker := public.ai_breaker_state();
  if (v_breaker ->> 'open')::boolean then
    return jsonb_build_object('allowed', false, 'reason', 'breaker_open', 'breaker', v_breaker);
  end if;

  -- Price the estimate. An unpriced/unknown model is refused outright rather than let through
  -- un-costed — nothing may spend against a budget it can't be measured against.
  select * into v_pricing from public.ai_model_pricing where model = p_model;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'unknown_model', 'model', p_model);
  end if;

  v_estimated_usd := (p_estimated_input_tokens * v_pricing.input_usd_per_mtok
                       + p_estimated_output_tokens * v_pricing.output_usd_per_mtok) / 1000000.0;

  -- 3. Daily cap. Today's spend = settled actual_usd since UTC midnight (keyed on settled_at —
  -- when the cost became real) + estimated_usd of every still-pending reservation made since
  -- midnight and not yet timed out. Counting PENDING estimates is what makes the cap hold under
  -- a burst: without it, N concurrent calls all read the same stale "spent so far" figure before
  -- any of them commits, and all N pass — the exact race the advisory lock above closes, but
  -- only if the sum itself accounts for in-flight reservations too. An orphaned pending row (the
  -- edge function crashed mid-call, so record_ai_call never ran) ages out of this sum on its own
  -- once pending_timeout_seconds has passed — no cron sweeper needed.
  select coalesce(sum(actual_usd), 0) into v_settled_usd
  from public.ai_call_log
  where status <> 'pending' and settled_at >= date_trunc('day', now());

  select coalesce(sum(estimated_usd), 0) into v_pending_usd
  from public.ai_call_log
  where status = 'pending'
    and created_at > now() - make_interval(secs => v_cfg.pending_timeout_seconds);

  v_spent_usd := v_settled_usd + v_pending_usd;

  if v_spent_usd + v_estimated_usd > v_cfg.daily_usd_cap then
    return jsonb_build_object(
      'allowed', false, 'reason', 'daily_cap',
      'spent_usd', v_spent_usd, 'estimated_usd', v_estimated_usd, 'cap_usd', v_cfg.daily_usd_cap
    );
  end if;

  insert into public.ai_call_log (
    user_id, analysis_id, model, status,
    estimated_input_tokens, estimated_output_tokens, estimated_usd
  ) values (
    p_user_id, p_analysis_id, p_model, 'pending',
    p_estimated_input_tokens, p_estimated_output_tokens, v_estimated_usd
  )
  returning id into v_call_id;

  return jsonb_build_object('allowed', true, 'call_id', v_call_id, 'estimated_usd', v_estimated_usd);
end;
$$;

revoke execute on function public.gate_ai_call(uuid, integer, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.gate_ai_call(uuid, integer, integer, text, uuid) to service_role;

-- record_ai_call: settle a 'pending' row with real usage. No-op (ok: true, already_settled:
-- true) on a row that isn't 'pending' anymore — safe on a retried invocation, same guard shape
-- as settle_analysis()/release_analysis().
create or replace function public.record_ai_call(
  p_call_id                     uuid,
  p_status                      public.ai_call_status,
  p_input_tokens                integer default null,
  p_output_tokens               integer default null,
  p_cache_creation_input_tokens integer default null,
  p_cache_read_input_tokens     integer default null,
  p_analysis_id                 uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     public.ai_call_log;
  v_pricing public.ai_model_pricing;
  v_actual  numeric;
begin
  if p_status = 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;

  select * into v_row from public.ai_call_log where id = p_call_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_row.status <> 'pending' then
    return jsonb_build_object(
      'ok', true, 'already_settled', true, 'status', v_row.status, 'actual_usd', v_row.actual_usd
    );
  end if;

  if p_status = 'cancelled' then
    -- The gate allowed the call but it was never made (idempotent replay of an already-delivered
    -- analysis, or a genuine quota denial arriving after the gate already passed — see the
    -- "call ordering" note at the top of this file). Released for $0 immediately, not left to
    -- age out via pending_timeout_seconds.
    v_actual := 0;
  elsif p_input_tokens is null and p_output_tokens is null
        and p_cache_creation_input_tokens is null and p_cache_read_input_tokens is null then
    -- No usage data at all (e.g. the Anthropic call itself timed out/network-errored before any
    -- response, including a usage block, ever came back) — settle at the ESTIMATE, not zero. An
    -- unknown cost is assumed incurred, so the daily-cap budget stays honest instead of quietly
    -- under-counting real spend on exactly the failure mode most likely to repeat in a loop.
    v_actual := v_row.estimated_usd;
  else
    select * into v_pricing from public.ai_model_pricing where model = v_row.model;
    if not found then
      -- Model was priced at gate time; the pricing row was deleted since (an operator edit
      -- mid-flight). Fail safe to the estimate rather than error or silently record $0.
      v_actual := v_row.estimated_usd;
    else
      v_actual :=
        (coalesce(p_input_tokens, 0)
           + coalesce(p_cache_creation_input_tokens, 0) * v_pricing.cache_write_multiplier
           + coalesce(p_cache_read_input_tokens, 0) * v_pricing.cache_read_multiplier
        ) * v_pricing.input_usd_per_mtok / 1000000.0
        + coalesce(p_output_tokens, 0) * v_pricing.output_usd_per_mtok / 1000000.0;
    end if;
  end if;

  update public.ai_call_log
  set status = p_status,
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      cache_creation_input_tokens = p_cache_creation_input_tokens,
      cache_read_input_tokens = p_cache_read_input_tokens,
      actual_usd = v_actual,
      analysis_id = coalesce(p_analysis_id, analysis_id),
      settled_at = now()
  where id = p_call_id and status = 'pending'
  returning * into v_row;

  if not found then
    -- Lost a race with a concurrent settle between the select above and this update. Postgres's
    -- row-level locking means that settle already fully committed by the time we get here, not
    -- that we clobbered it — re-read and report it the same way as the already-settled branch
    -- above, rather than a hard error.
    select * into v_row from public.ai_call_log where id = p_call_id;
    return jsonb_build_object(
      'ok', true, 'already_settled', true, 'status', v_row.status, 'actual_usd', v_row.actual_usd
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'already_settled', false, 'status', v_row.status, 'actual_usd', v_row.actual_usd
  );
end;
$$;

revoke execute on function public.record_ai_call(uuid, public.ai_call_status, integer, integer, integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.record_ai_call(uuid, public.ai_call_status, integer, integer, integer, integer, uuid) to service_role;

-- ai_spend_today: one JSONB snapshot for db-audit / cost-monitor / manual inspection.
-- service_role only, same as everything else here.
create or replace function public.ai_spend_today()
returns jsonb
language plpgsql
security definer
set search_path = public
set timezone = 'UTC'
stable
as $$
declare
  v_cfg         public.ai_ops_config;
  v_settled_usd numeric;
  v_pending_usd numeric;
  v_counts      jsonb;
  v_breaker     jsonb;
begin
  select * into v_cfg from public.ai_ops_config where id;

  select coalesce(sum(actual_usd), 0) into v_settled_usd
  from public.ai_call_log
  where status <> 'pending' and settled_at >= date_trunc('day', now());

  select coalesce(sum(estimated_usd), 0) into v_pending_usd
  from public.ai_call_log
  where status = 'pending'
    and created_at > now() - make_interval(secs => v_cfg.pending_timeout_seconds);

  select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) into v_counts
  from (
    select status::text as status, count(*) as cnt
    from public.ai_call_log
    where coalesce(settled_at, created_at) >= date_trunc('day', now())
    group by status
  ) c;

  v_breaker := public.ai_breaker_state();

  return jsonb_build_object(
    'as_of', now(),
    'spend_settled_usd', v_settled_usd,
    'spend_pending_usd', v_pending_usd,
    'spend_total_usd', v_settled_usd + v_pending_usd,
    'daily_usd_cap', v_cfg.daily_usd_cap,
    'call_counts_today', v_counts,
    'breaker', v_breaker,
    'analyze_enabled', v_cfg.analyze_enabled,
    'disabled_reason', v_cfg.disabled_reason
  );
end;
$$;

revoke execute on function public.ai_spend_today() from public, anon, authenticated;
grant execute on function public.ai_spend_today() to service_role;
