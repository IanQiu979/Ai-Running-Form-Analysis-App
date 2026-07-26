-- Backs `GET /functions/v1/quota-status` (issue #50), the server-authoritative read that #54
-- (Home's quota display) must be wired to instead of the client's current hand-rolled
-- `subscriptions` + `analyses` count query (`app/(tabs)/index.tsx:82`), which CLAUDE.md's
-- "no business rules in the client" rule already forbids and which cannot even be completed for
-- Pro/Elite today: `pace_current_period`'s EXECUTE is revoked from `authenticated`.
--
-- *** APPLIED to the live project — confirmed already present 2026-07-26 (issue #128). ***
-- Per issue #50's original hard constraint, the worktree that wrote this (fix/50) never ran
-- `supabase db push` / `apply_migration` against the live project (`vputdomdlknvthnzritt`); that
-- constraint has since been lifted and this function was found already applied when checked
-- live via `list_migrations`. See `docs/architecture.md`'s "Current — `GET /functions/v1/quota-status`"
-- section for the up-to-date deployment state.
--
-- WHY A NEW FUNCTION INSTEAD OF EXTENDING reserve_analysis: issue #50 explicitly forbids
-- `create or replace`-ing `reserve_analysis`/`settle_analysis`/`release_analysis` in this
-- worktree (another agent may be touching them concurrently, and this repo has already been
-- bitten once by two migrations both rewriting the same function body — see #88's and #2's own
-- header comments). A read-only, side-effect-free, additive function is a safe way to give
-- `quota-status` the same answer `reserve_analysis` would give, without touching the mutation
-- path at all.
--
-- HOW THIS AGREES WITH reserve_analysis, NOT JUST RESEMBLES IT: the two functions this body
-- calls — `pace_current_period` and `pace_is_farming_signal` — are the EXACT SAME functions
-- `reserve_analysis` itself calls (verified live via `pg_get_functiondef` against the live
-- project immediately before writing this file, 2026-07-12). Sharing those two calls means the
-- period-boundary math and the farming-signal taxonomy can never drift between the two
-- functions — a future change to either (e.g. a new farming-signal reason string) is picked up
-- here automatically, with no edit to this file. The one piece that could NOT be shared without
-- touching `reserve_analysis`'s own body is the tier -> limit/frame_cap mapping, which
-- `reserve_analysis` inlines as a literal `case` expression rather than a callable helper. That
-- one table is duplicated below, verbatim, with the literal values verified against the live
-- `pg_get_functiondef(reserve_analysis)` output captured in this session:
--   free -> limit 1,  frame_cap 1
--   pro  -> limit 10, frame_cap 5
--   elite-> limit 30, frame_cap 8
-- IF THIS TABLE EVER CHANGES IN reserve_analysis, IT MUST CHANGE HERE TOO, IN THE SAME COMMIT.
-- A future cleanup (out of scope for issue #50, since it requires touching reserve_analysis's
-- body) would factor this into its own `pace_tier_limits(tier)` helper the same way
-- `pace_is_farming_signal` was factored out by the anti-farm fix, closing this one remaining
-- duplication for good.
--
-- COUNTING RULES, mirrored field-for-field from the live `reserve_analysis` (captured via
-- `pg_get_functiondef` this session, migration `20260712220000_anti_farm_release_reason_fix.sql`
-- is the live body):
--   * "used" (v_active_count in reserve_analysis) = count of `analyses` rows with
--     status in ('reserved','delivered') for this user — free: no window (lifetime); pro/elite:
--     created_at <@ pace_current_period(purchased_at, as_of). Deliberately NOT filtered on
--     deleted_at: a soft-deleted row (issue #2) still counts, exactly as reserve_analysis's own
--     count does (that query has never filtered on deleted_at, before or after #2's migration —
--     #2's whole design is that deleting does not refund quota).
--   * "blocked" (too_many_failed_attempts) = count of `analyses` rows with status = 'released',
--     released_reason confirmed a farming signal via pace_is_farming_signal(release_reason), and
--     released_at within the SAME window (free: rolling 24h off released_at; pro/elite: the
--     current period, off created_at) reserve_analysis uses >= 3. This is a REAL state distinct
--     from quota exhaustion: `used < limit` can be true (quota available) while `blocked` is also
--     true (the anti-farm cap independently refuses further reserves right now). Both fields are
--     always returned so a caller can represent that combination honestly rather than collapsing
--     it into a single "can I analyze" boolean.
--   * "blocked_until" is not tracked anywhere else in this schema (reserve_analysis only needs to
--     know >= 3, never when that count will next drop below 3), so this function derives it:
--     pro/elite recovers exactly at period_end (the same window reset that clears the count to
--     zero); free recovers when enough of the currently-counted farming-signal releases age past
--     their own 24h mark to bring the rolling count back under 3 — computed by ordering the
--     counted releases oldest-first and taking the (released_count - 2)th one's 24h expiry
--     (worked example: released_count = 3 -> offset 1 -> the single oldest row's expiry is the
--     answer, since losing just that one row brings the count to 2).
--
-- SECURITY: same shape as every other function in the quota RPC family — SECURITY DEFINER,
-- pinned search_path, EXECUTE revoked from public/anon/authenticated, granted only to
-- service_role. Only a future edge function calling with the service-role key can invoke this,
-- never the client directly (same as reserve_analysis/settle_analysis/release_analysis/
-- gate_ai_call/record_ai_call). Marked STABLE, not IMMUTABLE (it reads live table state and
-- depends on its `p_as_of` argument's relationship to `now()`-derived data), and never writes —
-- unlike reserve_analysis, it takes no advisory lock, since a status read has no mutation to
-- serialize against; a narrow race between this read and a concurrent reserve/release is
-- acceptable for a display-only endpoint that is never the enforcement point (reserve_analysis
-- remains that, unconditionally).

create or replace function public.pace_quota_status(
  p_user_id uuid,
  p_as_of   timestamptz default now()
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_tier            public.analysis_tier;
  v_purchased_at    timestamptz;
  v_limit           integer;
  v_frame_cap       integer;
  v_window          tstzrange;
  v_used            integer;
  v_released_count  integer;
  v_period_start    timestamptz;
  v_period_end      timestamptz;
  v_blocked_until   timestamptz;
begin
  -- Tier derivation — identical to reserve_analysis: no active subscriptions row means free,
  -- never trusted from the caller (there is no caller-supplied tier argument here at all).
  select tier, purchased_at into v_tier, v_purchased_at
  from public.subscriptions
  where user_id = p_user_id and status = 'active';

  if not found then
    v_tier := 'free';
  end if;

  -- DUPLICATED FROM reserve_analysis's literal case expression — see this file's header comment
  -- ("WHY A NEW FUNCTION...") for why this one table could not be shared, and keep the two in
  -- sync by hand until a future migration factors it out.
  v_limit := case v_tier when 'free' then 1 when 'pro' then 10 when 'elite' then 30 end;
  v_frame_cap := case v_tier when 'free' then 1 when 'pro' then 5 when 'elite' then 8 end;

  if v_tier = 'free' then
    v_period_start := null;
    v_period_end := null;

    select count(*) into v_used
    from public.analyses
    where user_id = p_user_id and status in ('reserved', 'delivered');

    select count(*) into v_released_count
    from public.analyses
    where user_id = p_user_id and status = 'released'
      and public.pace_is_farming_signal(release_reason)
      and released_at > p_as_of - interval '24 hours';

    if v_released_count >= 3 then
      select released_at + interval '24 hours'
      into v_blocked_until
      from public.analyses
      where user_id = p_user_id and status = 'released'
        and public.pace_is_farming_signal(release_reason)
        and released_at > p_as_of - interval '24 hours'
      order by released_at asc
      offset greatest(v_released_count - 3, 0)
      limit 1;
    end if;
  else
    v_window := public.pace_current_period(v_purchased_at, p_as_of);
    v_period_start := lower(v_window);
    v_period_end := upper(v_window);

    select count(*) into v_used
    from public.analyses
    where user_id = p_user_id and status in ('reserved', 'delivered')
      and created_at <@ v_window;

    select count(*) into v_released_count
    from public.analyses
    where user_id = p_user_id and status = 'released'
      and created_at <@ v_window
      and public.pace_is_farming_signal(release_reason);

    if v_released_count >= 3 then
      -- The period reset is what clears the anti-farm count back to zero for pro/elite (the
      -- window this count is filtered by IS the period), so recovery is always exactly
      -- period_end — no per-row expiry walk needed, unlike free's rolling window above.
      v_blocked_until := v_period_end;
    end if;
  end if;

  return jsonb_build_object(
    'tier', v_tier,
    'used', v_used,
    'limit', v_limit,
    'frame_cap', v_frame_cap,
    'is_lifetime', v_tier = 'free',
    'period_start', v_period_start,
    'period_end', v_period_end,
    'blocked', v_released_count >= 3,
    'blocked_reason', case when v_released_count >= 3 then 'too_many_failed_attempts' else null end,
    'blocked_until', v_blocked_until
  );
end;
$$;

revoke execute on function public.pace_quota_status(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.pace_quota_status(uuid, timestamptz) to service_role;
