-- Per-user daily AI spend cap (security review finding, 2026-09-06 — carried out of the
-- free-tier task, which correctly left it unfixed as pre-existing and out of its scope).
--
-- THE BUG. `gate_ai_call` (20260712210100_ai_spend_guardrail_functions.sql) has exactly ONE
-- daily ceiling and it is GLOBAL: `daily_usd_cap`, summed over every row in
-- `public.ai_call_log` regardless of who spent it. One shared counter for everybody. Two real
-- consequences, both of which get worse the moment V2.3 has paying users:
--
--   1. SELF-INFLICTED OUTAGE. A single account's activity exhausts the day's allowance for
--      every other account. Every other user's next analysis comes back `daily_cap` — a 503 —
--      until UTC midnight, for something they did not do.
--
--   2. FREE MODEL CALLS THAT TRIP NOTHING. A Pro/Elite user can farm zero-pillar analyses
--      without tripping EITHER per-user control:
--        - Quota: `flow.ts` calls `release_analysis` with `'zero_pillars_assessed'` on a
--          structurally valid result that assessed no pillars, which HANDS THE QUOTA SLOT BACK
--          (captain decision audit-v23-r1-decision-zero-pillar-charge-policy,
--          20260819120000_zero_pillar_release_reason.sql). Nothing is charged.
--        - Anti-farm: `public.pace_is_farming_signal` deliberately does NOT classify
--          `'zero_pillars_assessed'` as abuse — that same migration is explicit that an honest
--          "I could not assess anything in this clip" must never tick the 3-strike counter.
--      Both refusals are correct in isolation. Together they leave a path where a real,
--      fully-billed Anthropic call costs the caller nothing and is bounded only by the GLOBAL
--      cap — i.e. bounded only by how much of everyone else's day the farmer is willing to burn.
--
-- THE FIX, and why it is shaped this way.
--
-- The per-user cap counts EVERY gated call for that user, whatever its outcome — success,
-- fallback, model_error, validation_failed, cancelled, and `zero_pillars_assessed` alike. That
-- is the whole point, and it is what "key the anti-farm counter consistently with the cap"
-- means here: `pace_is_farming_signal` is an INTENT classifier and deliberately has blind spots
-- (server-fault releases, honest zero-pillar results) so that a legitimate user is never
-- permanently locked out. A SPEND cap must have no such blind spots — money left the building
-- either way. Both controls are now keyed to the same subject (one user) and the cap sees every
-- path the anti-farm counter is designed to forgive, so nothing walks past both at once.
--
-- Crucially the cap is NOT a second anti-farm counter and does not touch
-- `pace_is_farming_signal`, `reserve_analysis`, or the release-reason taxonomy. Those encode a
-- captain decision about what a user is CHARGED for; this encodes what we are willing to SPEND
-- on one account per day. Refunding the quota slot for an honest zero-pillar result stays
-- exactly as it is.
--
-- WHY IN SQL, NOT IN `flow.ts`. `gate_ai_call` is `security definer`, EXECUTE revoked from
-- `public`/`anon`/`authenticated` and granted only to `service_role`, and takes `p_user_id` as
-- an argument supplied by the edge function AFTER it has verified the caller's JWT (flow.ts
-- CONTRACT RULE 1). A client cannot call it, cannot forge a `p_user_id`, and cannot see the
-- ledger. The tier that selects the cap is derived HERE, from `public.subscriptions` via
-- `public.pace_current_tier`, rather than taken as an argument — so even the edge function
-- cannot mis-report a caller as Elite to buy a bigger allowance.
--
-- THE NUMBERS, and total exposure. Worst-case pre-call estimates at
-- `_shared/ai-pricing.ts`'s own list-price math (24k prompt tokens + 1600/frame in, tier's full
-- max_tokens out, claude-sonnet-5 at $3/$15 per Mtok):
--
--     Free   1 frame,  4k out  -> $0.137/call   (first gate reserves elite's 8k out: $0.197)
--     Pro    5 frames, 6k out  -> $0.186/call   (first gate: $0.216)
--     Elite  8 frames, 8k out  -> $0.230/call
--
--   A worst-case ANALYSIS is two gated calls (the first attempt plus one retry): ~$0.33 Free,
--   ~$0.40 Pro, ~$0.46 Elite. Quotas are MONTHLY (Free: 1 lifetime; Pro: 10/period; Elite:
--   30/period), so the per-user DAILY caps below are sized to be invisible to any legitimate
--   session while bounding a farmer to a small daily trickle:
--
--     free   $0.75/day  ~2 worst-case analyses  (Free's entire quota is 1, ever)
--     pro    $2.00/day  ~5 worst-case analyses  (half a month's quota, in one day)
--     elite  $4.00/day  ~8 worst-case analyses  (a quarter of a month's quota, in one day)
--
--   THE DOLLAR CEILINGS ARE THE CONTRACT; the per-call figures above are illustrative at
--   `ai-pricing.ts`'s constants as of 2026-09-07 (`SYSTEM_PROMPT_TOKENS_ESTIMATE` 24000). A
--   prompt that grows, or a reprice of `ai_model_pricing`, moves how MANY calls fit under a
--   ceiling; it does not move the ceiling, and it does not need this migration re-run — the caps
--   are `ai_ops_config` columns an operator tunes with one UPDATE. (`fm/v23-free-tier-real-
--   analysis` raises that constant to 25500, which shifts an Elite call $0.230 -> $0.235: ~2%,
--   well inside the rounding these figures already carry.)
--
--   TOTAL SPEND EXPOSURE IS UNCHANGED AT $10.00/day. The global `daily_usd_cap` is deliberately
--   RETAINED as the outer ceiling and is still checked on every call — this migration does not
--   replace it with a per-user number, which would have multiplied the ceiling by the user
--   count. What changes is only how much of that $10 any ONE account can take: 7.5% (Free), 20%
--   (Pro), 40% (Elite), down from 100%. It now takes at least 3 simultaneously-maxed Elite
--   accounts, 5 Pro, or 14 Free to exhaust the day for everyone, instead of one.
--
--   RESIDUAL EXPOSURE, stated honestly: the zero-pillar path is BOUNDED, not eliminated. An
--   Elite account can still burn up to $4.00/day of un-quota'd, un-anti-farmed model calls —
--   roughly 17 calls at the gate's own worst-case estimate, and more than that in practice
--   because the cap counts SETTLED actual cost, which prompt caching pulls well below the
--   estimate. That is the deliberate trade for not treating an honest "nothing assessable in
--   this clip" as abuse. What it is no longer is unbounded, and it is no longer anybody else's
--   problem. Farming ACROSS accounts is a different hole (unbounded account creation, issue
--   #48) and is not addressed here.
--
-- THE EXISTING COUNTER, and in-flight state. There is nothing to migrate, reset, or retire: the
-- "global counter" was never a stored counter, it is a SUM derived on read over
-- `public.ai_call_log`. The per-user cap is derived from the SAME rows, keyed by `user_id`,
-- which every row has carried since the table was created — so history is already correctly
-- attributed with no backfill, and a row in flight when this migration applies is counted by
-- both ceilings from its next gate check onward. The one asymmetry is by design: `user_id` is
-- `on delete set null`, so a deleted account's rows keep counting toward the GLOBAL cap (the
-- money was really spent) but toward no user's cap (there is no longer anybody to charge).
--
-- STRUCTURE. `gate_ai_call`'s body moves, verbatim apart from the two new checks, into
-- `gate_ai_call_for_tier`, and `gate_ai_call` becomes a thin tier-deriving wrapper over it. That
-- is the same lesson `20260712220000_anti_farm_release_reason_fix.sql` learned the hard way with
-- `pace_is_farming_signal`: a rule that a later migration will want to change belongs in its own
-- small function, so changing it never means a second `create or replace` of a large body that
-- two migrations can silently clobber. It also gives the temporary
-- `ALL_USERS_UNLIMITED_ACCESS` override (20260807090000) a one-line
-- `gate_ai_call_unlimited` sibling, matching `pace_current_tier_unlimited` /
-- `reserve_analysis_unlimited` exactly — and note that override's own words: "unlimited" means
-- analysis COUNT, and "the AI spend guardrails remain intact too". So the override does NOT
-- disable this cap; it applies the Elite cap, which is what its callers are already being
-- charged for.
--
-- SIGNATURES. `gate_ai_call(uuid, integer, integer, text, uuid)` keeps its exact argument list —
-- `create or replace`, no drop, no overload, no caller change required beyond the new deny
-- reasons.
--
-- DEPLOYMENT ORDER — DB FIRST. `supabase db push` MUST run BEFORE `analyze-form` is deployed
-- from this branch, the same ordering `pace_quota_status` / `pace_purchase_tier` needed for
-- `quota-status` / `purchase-tier`. `gate_ai_call` itself already exists, so the default path is
-- safe either way; the new one is `gate_ai_call_unlimited`, which `_shared/ai-guard.ts` selects
-- whenever the `ALL_USERS_UNLIMITED_ACCESS` secret is set (it is, on the live project). Deploying
-- the function first no longer 500s — `gateAiCall` detects the missing function and falls back to
-- `gate_ai_call` once. Be clear about what that fallback buys: in a database where this migration
-- is unapplied, `gate_ai_call` is still the old 20260712210100 definition, so the degraded window
-- enforces the GLOBAL `daily_usd_cap` alone with NO per-user ceiling — availability preserved at
-- today's production behaviour, not a tighter cap. Push this migration first.

-- ---------------------------------------------------------------------------------------------
-- 1. The dials. Operator-tunable by UPDATE from the dashboard/SQL editor/MCP, no redeploy —
--    exactly like `daily_usd_cap` and the breaker dials that already live on this row.
-- ---------------------------------------------------------------------------------------------

alter table public.ai_ops_config
  add column user_daily_usd_cap_free  numeric not null default 0.75
    check (user_daily_usd_cap_free > 0),
  add column user_daily_usd_cap_pro   numeric not null default 2.00
    check (user_daily_usd_cap_pro > 0),
  add column user_daily_usd_cap_elite numeric not null default 4.00
    check (user_daily_usd_cap_elite > 0);

comment on column public.ai_ops_config.user_daily_usd_cap_free is
  'Per-user daily USD ceiling for a Free-tier caller, checked by gate_ai_call IN ADDITION to the '
  'global daily_usd_cap. Sized against ai-pricing.ts worst-case estimates — see this column''s '
  'migration header for the arithmetic and the total-exposure statement.';
comment on column public.ai_ops_config.user_daily_usd_cap_pro is
  'Per-user daily USD ceiling for a Pro-tier caller. See user_daily_usd_cap_free.';
comment on column public.ai_ops_config.user_daily_usd_cap_elite is
  'Per-user daily USD ceiling for an Elite-tier caller, and the ceiling applied by '
  'gate_ai_call_unlimited while ALL_USERS_UNLIMITED_ACCESS is on. See user_daily_usd_cap_free.';

-- ---------------------------------------------------------------------------------------------
-- 2. Indexes for the two new per-user sums. Both mirror the existing global partial indexes
--    (ai_call_log_pending_created_idx / ai_call_log_settled_idx) with `user_id` leading, so the
--    per-user sums range-scan the same way the global ones already do rather than degrading the
--    gate — which holds a global advisory lock while it runs — into a full scan per call.
-- ---------------------------------------------------------------------------------------------

create index ai_call_log_user_pending_created_idx
  on public.ai_call_log (user_id, created_at)
  where status = 'pending';

create index ai_call_log_user_settled_idx
  on public.ai_call_log (user_id, settled_at desc)
  where status <> 'pending';

-- ---------------------------------------------------------------------------------------------
-- 3. The tier -> cap mapping, in its own function. The ONLY place that mapping lives; a future
--    repricing or a fourth tier changes this one small body, never gate_ai_call_for_tier's.
--    Fails CLOSED on a null/unknown tier (the tightest cap), never open.
-- ---------------------------------------------------------------------------------------------

create or replace function public.ai_user_daily_cap_usd(p_tier public.analysis_tier)
returns numeric
language sql
security definer
stable
set search_path = public
as $$
  select case p_tier
           when 'pro'   then user_daily_usd_cap_pro
           when 'elite' then user_daily_usd_cap_elite
           else              user_daily_usd_cap_free
         end
  from public.ai_ops_config
  where id;
$$;

revoke execute on function public.ai_user_daily_cap_usd(public.analysis_tier)
  from public, anon, authenticated;
grant execute on function public.ai_user_daily_cap_usd(public.analysis_tier) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. The gate body. Rewritten from the CURRENT definition in
--    20260712210100_ai_spend_guardrail_functions.sql: every existing check is preserved verbatim
--    and in the same order, with two additions — an explicit null-user refusal, and the per-user
--    cap immediately BEFORE the global one.
-- ---------------------------------------------------------------------------------------------

create or replace function public.gate_ai_call_for_tier(
  p_user_id                 uuid,
  p_tier                    public.analysis_tier,
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
  v_cfg                public.ai_ops_config;
  v_pricing            public.ai_model_pricing;
  v_tier               public.analysis_tier;
  v_estimated_usd      numeric;
  v_breaker            jsonb;
  v_user_cap           numeric;
  v_user_settled_usd   numeric;
  v_user_pending_usd   numeric;
  v_user_spent_usd     numeric;
  v_settled_usd        numeric;
  v_pending_usd        numeric;
  v_spent_usd          numeric;
  v_call_id            uuid;
begin
  if p_estimated_input_tokens is null or p_estimated_input_tokens < 0
     or p_estimated_output_tokens is null or p_estimated_output_tokens < 0 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_estimate');
  end if;

  -- A cap that is keyed by user cannot be enforced for a call that names no user. Before this
  -- migration a null p_user_id inserted an unattributed ledger row and spent only against the
  -- global cap — i.e. the one input that made the spend unattributable also made it uncapped.
  -- Refused outright now. No caller passes null (flow.ts always has an authenticated user id by
  -- the time it reaches the gate); this is the guard that keeps that true.
  if p_user_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_user');
  end if;

  -- Fail closed on an unknown/absent tier: the tightest cap, never the loosest.
  v_tier := coalesce(p_tier, 'free');

  -- Single GLOBAL advisory lock — unchanged. It serializes every gate_ai_call across every user,
  -- which is what makes BOTH the global read below and the new per-user read reflect every call
  -- that already committed rather than a stale pre-insert figure. A per-user lock would have
  -- been strictly weaker here, not stronger: the global cap still needs global serialization,
  -- and this one lock already provides it for both. Held only for this transaction (check +
  -- insert), never for the model call itself.
  perform pg_advisory_xact_lock(hashtext('ai_ops_gate'));

  select * into v_cfg from public.ai_ops_config where id;

  -- 1. Kill switch.
  if not v_cfg.analyze_enabled then
    return jsonb_build_object(
      'allowed', false, 'reason', 'killed', 'disabled_reason', v_cfg.disabled_reason
    );
  end if;

  -- 2. Circuit breaker (derived on read, not stored — see ai_breaker_state()).
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

  -- 3. PER-USER daily cap — the fix. Same arithmetic as the global cap below (settled actual
  -- since UTC midnight + still-live pending estimates), narrowed to this one user, and counting
  -- EVERY status: a 'cancelled', 'model_error' or zero-pillar-released call cost real money and
  -- is charged against this user's own day even though it costs them no quota slot and no
  -- anti-farm strike.
  --
  -- Checked BEFORE the global cap on purpose. When both would deny, the honest answer is the one
  -- about the caller's own allowance ('user_daily_cap', a 429 they can act on) rather than the
  -- one about our operational ceiling ('daily_cap', a 503 that is our brake, not their fault).
  v_user_cap := public.ai_user_daily_cap_usd(v_tier);

  select coalesce(sum(actual_usd), 0) into v_user_settled_usd
  from public.ai_call_log
  where user_id = p_user_id
    and status <> 'pending'
    and settled_at >= date_trunc('day', now());

  select coalesce(sum(estimated_usd), 0) into v_user_pending_usd
  from public.ai_call_log
  where user_id = p_user_id
    and status = 'pending'
    and created_at > now() - make_interval(secs => v_cfg.pending_timeout_seconds);

  v_user_spent_usd := v_user_settled_usd + v_user_pending_usd;

  if v_user_spent_usd + v_estimated_usd > v_user_cap then
    return jsonb_build_object(
      'allowed', false, 'reason', 'user_daily_cap',
      'spent_usd', v_user_spent_usd, 'estimated_usd', v_estimated_usd,
      'cap_usd', v_user_cap, 'tier', v_tier
    );
  end if;

  -- 4. GLOBAL daily cap — retained unchanged, still the outer ceiling on total exposure. See
  --    the original migration's comment for why pending estimates are counted here too.
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

revoke execute on function public.gate_ai_call_for_tier(
  uuid, public.analysis_tier, integer, integer, text, uuid
) from public, anon, authenticated;
grant execute on function public.gate_ai_call_for_tier(
  uuid, public.analysis_tier, integer, integer, text, uuid
) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. gate_ai_call — SAME 5-argument signature as before, now a tier-deriving wrapper.
--    The tier is read from public.subscriptions server-side (public.pace_current_tier), never
--    taken from the caller, so no edge-function bug or compromise can buy a bigger allowance by
--    claiming a tier the user does not have.
-- ---------------------------------------------------------------------------------------------

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
  v_tier public.analysis_tier;
begin
  if p_user_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_user');
  end if;

  v_tier := public.pace_current_tier(p_user_id);

  return public.gate_ai_call_for_tier(
    p_user_id, v_tier, p_estimated_input_tokens, p_estimated_output_tokens, p_model, p_analysis_id
  );
end;
$$;

revoke execute on function public.gate_ai_call(uuid, integer, integer, text, uuid)
  from public, anon, authenticated;
grant execute on function public.gate_ai_call(uuid, integer, integer, text, uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. gate_ai_call_unlimited — the ALL_USERS_UNLIMITED_ACCESS sibling, matching
--    pace_current_tier_unlimited / reserve_analysis_unlimited (20260807090000). Everyone is
--    treated as Elite, which is exactly what that override already does for tier, frame cap and
--    quota. It applies the ELITE per-user cap; it does NOT disable it — per that migration's own
--    wording, "unlimited" means analysis COUNT and "the AI spend guardrails remain intact too".
--    Unsetting the secret drops every caller straight back onto gate_ai_call with no DB change.
-- ---------------------------------------------------------------------------------------------

create or replace function public.gate_ai_call_unlimited(
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
begin
  return public.gate_ai_call_for_tier(
    p_user_id, 'elite', p_estimated_input_tokens, p_estimated_output_tokens, p_model, p_analysis_id
  );
end;
$$;

revoke execute on function public.gate_ai_call_unlimited(uuid, integer, integer, text, uuid)
  from public, anon, authenticated;
grant execute on function public.gate_ai_call_unlimited(uuid, integer, integer, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------------------------
-- 7. ai_spend_today — surface the new dials next to the global one, so the operator snapshot
--    that db-audit/cost-monitor read is not left half-describing the ceilings actually in force.
--    Body otherwise unchanged from 20260712210100.
-- ---------------------------------------------------------------------------------------------

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
    'user_daily_usd_caps', jsonb_build_object(
      'free', v_cfg.user_daily_usd_cap_free,
      'pro', v_cfg.user_daily_usd_cap_pro,
      'elite', v_cfg.user_daily_usd_cap_elite
    ),
    'call_counts_today', v_counts,
    'breaker', v_breaker,
    'analyze_enabled', v_cfg.analyze_enabled,
    'disabled_reason', v_cfg.disabled_reason
  );
end;
$$;

revoke execute on function public.ai_spend_today() from public, anon, authenticated;
grant execute on function public.ai_spend_today() to service_role;
