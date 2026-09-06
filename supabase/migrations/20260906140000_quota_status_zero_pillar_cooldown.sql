-- Review ruling r8-1 (fm/v23-free-tier-real-analysis): the Free zero-pillar cooldown added by
-- 20260906130000 must be PRE-FLIGHTABLE, exactly the way the issue #6 anti-farm block already is.
--
-- WHY. As shipped, the cooldown was only discoverable by submitting: the client extracted frames
-- on device, uploaded several megabytes of base64, and only then learned it had to wait. The
-- anti-farm cap never had that problem, because `pace_quota_status` reports it through
-- `blocked`/`blocked_reason`/`blocked_until`, which Home reads before enabling the Analyze CTA.
-- The cooldown gets the same treatment here rather than a second, parallel pre-flight path.
--
-- ONE NUMBER, IN ONE PLACE. Two callers now need the interval — `analyze-form` (to refuse) and
-- `pace_quota_status` (to warn) — so it stops being a TypeScript constant passed in and becomes
-- `public.pace_zero_pillar_cooldown_seconds()`. A constant duplicated across an edge function and
-- a SQL function is exactly the drift that would let Home say "try again at 3:15" while the server
-- refuses until 3:30.
--
-- Still no counter and no new schema: every read below is over rows `release_analysis` already
-- writes.

-- ---------------------------------------------------------------------------------------------
-- 1. The interval itself.
--
-- FIFTEEN MINUTES. A zero-pillar result means the clip showed us nothing, and the fix is to film
-- again — minutes of work, so an honest runner is rarely blocked by this at all. It caps a
-- scripted resubmission loop at four model calls an hour per account, which is far below what
-- would make free-tier form-checking-by-resubmission worth automating. It is deliberately far
-- shorter than the 24h anti-farm window of 20260712220000: this is a throttle, not an abuse
-- finding, and it must not read like a punishment.
-- ---------------------------------------------------------------------------------------------

create or replace function public.pace_zero_pillar_cooldown_seconds()
returns integer
language sql
immutable
as $$
  select 900;
$$;

comment on function public.pace_zero_pillar_cooldown_seconds() is
  'The single source of truth for how long a free account waits after a zero-pillar result. Read '
  'by analyze-form (via pace_zero_pillar_cooldown_remaining) and by pace_quota_status, so the '
  'refusal and the warning can never disagree.';

revoke all on function public.pace_zero_pillar_cooldown_seconds() from public;
revoke all on function public.pace_zero_pillar_cooldown_seconds() from anon;
revoke all on function public.pace_zero_pillar_cooldown_seconds() from authenticated;
grant execute on function public.pace_zero_pillar_cooldown_seconds() to service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. The remaining-time lookup, superseding 20260906130000's two-argument version.
--
-- Same body, same fail-open posture; it just reads the interval above instead of taking it as an
-- argument. The old signature is dropped rather than left as an overload, so there is exactly one
-- way to ask this question and no caller can pass a different number.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.pace_zero_pillar_cooldown_remaining(uuid, integer);

create or replace function public.pace_zero_pillar_cooldown_remaining(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Seconds still to wait, or 0. `coalesce` over the aggregate, not `greatest` alone: with no
  -- qualifying row `max()` is NULL and the whole expression would be NULL rather than "no wait".
  select coalesce(
    greatest(
      0,
      ceil(
        extract(
          epoch from
            (max(released_at) + make_interval(secs => public.pace_zero_pillar_cooldown_seconds()))
              - now()
        )
      )
    ),
    0
  )::integer
  from public.analyses
  where user_id = p_user_id
    and status = 'released'
    and release_reason = 'zero_pillars_assessed'
    and released_at is not null
    and released_at > now() - make_interval(secs => public.pace_zero_pillar_cooldown_seconds());
$$;

comment on function public.pace_zero_pillar_cooldown_remaining(uuid) is
  'Seconds a user must still wait after their most recent zero_pillars_assessed release before '
  'analyze-form accepts another submission (free tier only). Read-only over public.analyses — no '
  'counter, no new state.';

revoke all on function public.pace_zero_pillar_cooldown_remaining(uuid) from public;
revoke all on function public.pace_zero_pillar_cooldown_remaining(uuid) from anon;
revoke all on function public.pace_zero_pillar_cooldown_remaining(uuid) from authenticated;
grant execute on function public.pace_zero_pillar_cooldown_remaining(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. pace_quota_status reports the cooldown on the SAME channel as the anti-farm cap.
--
-- Body-only change to 20260712233000's function: identical signature, identical tier/limit/period
-- derivation, identical anti-farm branch. The only addition is a free-tier cooldown read and the
-- two lines that let it set `blocked`/`blocked_reason`/`blocked_until`.
--
-- PRECEDENCE IS DELIBERATE: `too_many_failed_attempts` wins whenever both apply. It is the longer
-- and stricter block (24h vs 15 min), so reporting the cooldown's earlier `blocked_until` while
-- the anti-farm cap is still refusing would tell the user a time at which nothing will actually
-- work — the one thing a pre-flight must never do.
--
-- The cooldown is FREE-ONLY, matching analyze-form: pro/elite zero-pillar refunds are already
-- bounded by their period quota, and they are never refused by this throttle, so reporting it for
-- them would be a lie.
-- ---------------------------------------------------------------------------------------------

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
  v_cooldown_until  timestamptz;
  v_blocked_reason  text;
  v_blocked         boolean;
begin
  -- Tier derivation — identical to reserve_analysis: no active subscriptions row means free,
  -- never trusted from the caller (there is no caller-supplied tier argument here at all).
  select tier, purchased_at into v_tier, v_purchased_at
  from public.subscriptions
  where user_id = p_user_id and status = 'active';

  if not found then
    v_tier := 'free';
  end if;

  -- DUPLICATED FROM reserve_analysis's literal case expression — see 20260712233000's header
  -- comment ("WHY A NEW FUNCTION...") for why this one table could not be shared, and keep the
  -- two in sync by hand until a future migration factors it out.
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

    -- The zero-pillar cooldown. Same rows analyze-form's own lookup reads, same interval, so the
    -- warning and the refusal cannot disagree.
    select max(released_at) + make_interval(secs => public.pace_zero_pillar_cooldown_seconds())
    into v_cooldown_until
    from public.analyses
    where user_id = p_user_id and status = 'released'
      and release_reason = 'zero_pillars_assessed'
      and released_at is not null
      and released_at > p_as_of - make_interval(secs => public.pace_zero_pillar_cooldown_seconds());
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

  if v_released_count >= 3 then
    v_blocked := true;
    v_blocked_reason := 'too_many_failed_attempts';
  elsif v_cooldown_until is not null then
    v_blocked := true;
    v_blocked_reason := 'zero_pillar_cooldown';
    v_blocked_until := v_cooldown_until;
  else
    v_blocked := false;
    v_blocked_reason := null;
    v_blocked_until := null;
  end if;

  return jsonb_build_object(
    'tier', v_tier,
    'used', v_used,
    'limit', v_limit,
    'frame_cap', v_frame_cap,
    'is_lifetime', v_tier = 'free',
    'period_start', v_period_start,
    'period_end', v_period_end,
    'blocked', v_blocked,
    'blocked_reason', v_blocked_reason,
    'blocked_until', v_blocked_until
  );
end;
$$;

revoke execute on function public.pace_quota_status(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.pace_quota_status(uuid, timestamptz) to service_role;
