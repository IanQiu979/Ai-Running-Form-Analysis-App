-- Issue #89, captain's decision 2026-09-19: Free's ONE lifetime VIDEO analysis scores all four
-- PACE pillars.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHAT THIS CHANGES, AND THE ONE NUMBER IT CHANGES
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- `knowledge/pace_framework.md` ("What each medium can and cannot show") is certified content:
-- a single frame "cannot show cadence, arm-swing range, vertical oscillation, or ground-contact
-- time". With `v_frame_cap` at 1 for 'free', a Free runner who recorded a flawless side-on clip
-- still had exactly one frame extracted, so Cadence and Elasticity came back "not assessed" on
-- EVERY free trial — the product's one conversion moment shipped as a 2-of-4 "Partial read".
--
-- The captain's ruling: Free VIDEO uses the SAME stride-burst extraction as the paid tiers
-- (`lib/frames.ts`'s `sampleTimestamps`: one centred ~700ms window, density set by the cap), so
-- both motion pillars can be assessed. The cap is PRO'S BURST — 5 frames — because that is the
-- smaller of the two paid bursts that ship today and the one measured live to score all four
-- pillars (`docs/change_log.md` 2026-09-07: Pro/5 on the outdoor jogger scored 64 = 74/62/58/60).
-- Nothing else in the Free contract moves: still ONE lifetime analysis, still no flags/drills
-- (stripped server-side in `analyze-form/flow.ts`), still the same quota and anti-farm rules.
-- Cost delta is ~1.6k input tokens per extra frame (`_shared/ai-pricing.ts`), and `gate_ai_call`
-- already reserves per real frame count, so the per-user daily cap needs no change.
--
-- A PHOTO STAYS ONE FRAME on every tier. That is not a tier rule and is not touched here: the
-- `if p_media_type = 'photo' and p_frame_count <> 1` guard below (unchanged since 20260711150400)
-- rejects anything else with `invalid_frame_count_for_photo`, and `analyze-form/flow.ts`'s
-- normalization still forces Cadence/Elasticity to `needsVideo` on any one-frame submission. So
-- after this migration the honest shape is: Free photo = 2 of 4 with "Requires video" copy;
-- Free video = up to 4 of 4.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHY TWO FUNCTIONS, AND WHY VERBATIM
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- `reserve_analysis` ENFORCES the cap; `pace_quota_status` REPORTS it (`frame_cap`), and the
-- client extracts exactly the reported number (`lib/extraction-frame-cap.ts` reads `frameCap`,
-- never a client-side tier table). 20260712233000's header explains why the case expression is
-- duplicated rather than shared; the two MUST stay in sync by hand, which is why both are
-- replaced here in one migration. Both bodies are reproduced VERBATIM from
-- 20260910120000_zero_pillar_delivered_uncharged.sql — `create or replace` replaces the whole
-- body, so anything dropped here would be silently lost (see 20260713150000's header on that
-- hazard). The ONLY edit in each body is the `v_frame_cap` case expression:
--
--     before:  case v_tier when 'free' then 1 when 'pro' then 5 when 'elite' then 8 end
--     after:   case v_tier when 'free' then 5 when 'pro' then 5 when 'elite' then 8 end
--
-- `supabase/functions/_shared/pace.ts`'s `PACE_FRAME_CAP` carries the same numbers on the
-- TypeScript side and is locked to this expression by `lib/__tests__/frames.test.ts` and
-- `supabase/functions/_shared/__tests__/pace.test.ts`; the behaviour of THIS file is proven by
-- `supabase/functions/_shared/__tests__/free-video-frame-cap-sql.deno.test.ts` (PGlite, the real
-- SQL, inside `npm run test:edge`).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHAT IS DELIBERATELY NOT CHANGED
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
--   * The LEGACY four-argument `reserve_analysis` / `reserve_analysis_unlimited` overloads keep
--     `'free' then 1`. They are rollback-only surface (20260910120000's header): a build old
--     enough to call them predates the canonical-identity contract entirely, and giving a
--     rollback path a wider cap than the build that calls it was written against buys nothing.
--   * `reserve_analysis_unlimited` (5-arg) and `pace_quota_status_unlimited` are untouched: the
--     `ALL_USERS_UNLIMITED_ACCESS` override already treats every account as Elite / 8 frames.
--   * `settle_analysis`, `release_analysis`, the cooldown, the anti-farm count, the quota limits
--     (`v_limit`: free 1 / pro 10 / elite 30) and every grant are byte-identical to 20260910120000.
--
-- ROLLOUT ORDER (DB-first, like every migration in this family): push this migration, then deploy
-- `analyze-form` (whose prompt builder asserts `frames.length <= PACE_FRAME_CAP[tier]`), then ship
-- the app. Until the migration is live, a Free client that could not read `quota-status` and fell
-- back to `PACE_FRAME_CAP.free` would be refused with `frame_cap_exceeded` — a clean 400 that
-- uploads nothing and charges nothing (#88), not a silent degradation.

-- Quota-enforcing overload. Ordering after the per-user lock is deliberate: request-key lookup,
-- server-side tier/frame enforcement, active canonical lookup, then (only for a true miss) the
-- existing anti-farm/quota checks and atomic analysis+claim creation.
create or replace function public.reserve_analysis(
  p_user_id          uuid,
  p_idempotency_key  text,
  p_media_type       public.media_type,
  p_frame_count      integer,
  p_analysis_identity jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing          public.analyses;
  v_alias             public.analysis_request_aliases;
  v_claim             public.canonical_analysis_claims;
  v_fingerprint       text;
  v_revision          text;
  v_tier              public.analysis_tier;
  v_purchased_at      timestamptz;
  v_limit             integer;
  v_frame_cap         integer;
  v_window            tstzrange;
  v_active_count      integer;
  v_released_count    integer;
  v_new_id            uuid;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_idempotency_key');
  end if;
  if p_frame_count is null or p_frame_count < 1 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_frame_count');
  end if;
  if p_media_type = 'photo' and p_frame_count <> 1 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_frame_count_for_photo');
  end if;
  if coalesce(jsonb_typeof(p_analysis_identity), '') <> 'object'
     or coalesce(jsonb_typeof(p_analysis_identity -> 'input_fingerprint'), '') <> 'string'
     or coalesce(jsonb_typeof(p_analysis_identity -> 'analyzer_revision'), '') <> 'string'
     or coalesce(p_analysis_identity ->> 'input_fingerprint', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_analysis_identity ->> 'analyzer_revision', '') !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$' then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_analysis_identity');
  end if;

  v_fingerprint := p_analysis_identity ->> 'input_fingerprint';
  v_revision := p_analysis_identity ->> 'analyzer_revision';

  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':analysis_reserve'));

  select r.* into v_alias
  from public.analysis_request_aliases r
  where r.user_id = p_user_id and r.idempotency_key = p_idempotency_key;

  if found then
    if v_alias.input_fingerprint <> v_fingerprint or v_alias.analyzer_revision <> v_revision then
      return jsonb_build_object('allowed', false, 'reason', 'idempotency_identity_mismatch');
    end if;
    select * into v_existing
    from public.analyses
    where id = v_alias.analysis_id and user_id = p_user_id
    for share;
    if not found then
      return jsonb_build_object('allowed', false, 'reason', 'idempotency_target_missing');
    end if;
    return jsonb_build_object(
      'allowed', true, 'existing', true, 'id', v_existing.id,
      'status', v_existing.status, 'tier', v_existing.tier_at_run,
      'result', v_existing.result, 'is_fallback', v_existing.is_fallback
    );
  end if;

  -- A row minted by the legacy overload has no server-owned identity to compare. Never guess that
  -- a changed request is the same input; the authenticated resolver can still reconcile it.
  select * into v_existing
  from public.analyses
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('allowed', false, 'reason', 'idempotency_identity_unverifiable');
  end if;

  select tier, purchased_at into v_tier, v_purchased_at
  from public.subscriptions
  where user_id = p_user_id and status = 'active';
  if not found then
    v_tier := 'free';
  end if;

  v_limit := case v_tier when 'free' then 1 when 'pro' then 10 when 'elite' then 30 end;
  v_frame_cap := case v_tier when 'free' then 5 when 'pro' then 5 when 'elite' then 8 end;
  if p_frame_count > v_frame_cap then
    return jsonb_build_object(
      'allowed', false, 'reason', 'frame_cap_exceeded',
      'tier', v_tier, 'frame_cap', v_frame_cap
    );
  end if;

  select c.* into v_claim
  from public.canonical_analysis_claims c
  join public.analyses a on a.id = c.analysis_id and a.user_id = c.user_id
  where c.user_id = p_user_id
    and c.input_fingerprint = v_fingerprint
    and c.analyzer_revision = v_revision
    and c.tier_at_run = v_tier
    and a.status in ('reserved', 'delivered')
    and a.deleted_at is null
  for share of a;

  if found then
    insert into public.analysis_request_aliases (
      user_id, idempotency_key, analysis_id, input_fingerprint, analyzer_revision, tier_at_run
    ) values (
      p_user_id, p_idempotency_key, v_claim.analysis_id, v_fingerprint, v_revision, v_tier
    );
    select * into v_existing from public.analyses where id = v_claim.analysis_id;
    return jsonb_build_object(
      'allowed', true, 'existing', true, 'id', v_existing.id,
      'status', v_existing.status, 'tier', v_existing.tier_at_run,
      'result', v_existing.result, 'is_fallback', v_existing.is_fallback
    );
  end if;

  if v_tier = 'free' then
    select count(*) into v_active_count
    from public.analyses
    where user_id = p_user_id and status in ('reserved', 'delivered')
      -- Option E: a zero-pillar verdict is DELIVERED (pinned, replayable) but UNCHARGED.
      -- `zero_pillar_at is not null` is the exemption marker; everything else counts as before.
      and zero_pillar_at is null;
    select count(*) into v_released_count
    from public.analyses
    where user_id = p_user_id and status = 'released'
      and public.pace_is_farming_signal(release_reason)
      and released_at > now() - interval '24 hours';
  else
    v_window := public.pace_current_period(v_purchased_at, now());
    select count(*) into v_active_count
    from public.analyses
    where user_id = p_user_id and status in ('reserved', 'delivered')
      -- Option E exemption, identical to the free branch above.
      and zero_pillar_at is null
      and created_at <@ v_window;
    select count(*) into v_released_count
    from public.analyses
    where user_id = p_user_id and status = 'released'
      and created_at <@ v_window
      and public.pace_is_farming_signal(release_reason);
  end if;

  if v_released_count >= 3 then
    return jsonb_build_object('allowed', false, 'reason', 'too_many_failed_attempts', 'tier', v_tier);
  end if;
  if v_active_count >= v_limit then
    return jsonb_build_object(
      'allowed', false, 'reason', 'quota_exceeded',
      'tier', v_tier, 'used', v_active_count, 'limit', v_limit
    );
  end if;

  insert into public.analyses (
    user_id, media_type, frame_count, tier_at_run, status, idempotency_key
  ) values (
    p_user_id, p_media_type, p_frame_count, v_tier, 'reserved', p_idempotency_key
  ) returning id into v_new_id;

  insert into public.canonical_analysis_claims (
    user_id, input_fingerprint, analyzer_revision, tier_at_run, analysis_id
  ) values (
    p_user_id, v_fingerprint, v_revision, v_tier, v_new_id
  );
  insert into public.analysis_request_aliases (
    user_id, idempotency_key, analysis_id, input_fingerprint, analyzer_revision, tier_at_run
  ) values (
    p_user_id, p_idempotency_key, v_new_id, v_fingerprint, v_revision, v_tier
  );

  return jsonb_build_object(
    'allowed', true, 'existing', false, 'id', v_new_id,
    'status', 'reserved', 'tier', v_tier
  );
end;
$$;

revoke execute on function public.reserve_analysis(uuid, text, public.media_type, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.reserve_analysis(uuid, text, public.media_type, integer, jsonb)
  to service_role;

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
  v_frame_cap := case v_tier when 'free' then 5 when 'pro' then 5 when 'elite' then 8 end;

  if v_tier = 'free' then
    v_period_start := null;
    v_period_end := null;

    select count(*) into v_used
    from public.analyses
    where user_id = p_user_id and status in ('reserved', 'delivered')
      -- Option E: a zero-pillar verdict is DELIVERED (pinned, replayable) but UNCHARGED.
      -- `zero_pillar_at is not null` is the exemption marker; everything else counts as before.
      and zero_pillar_at is null;

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
    -- warning and the refusal cannot disagree — which is why this read had to move to the union
    -- below in lockstep with pace_zero_pillar_cooldown_remaining. Reading only the legacy
    -- released rows here would report `blocked = false` while the edge function still refuses.
    select max(event_at) + make_interval(secs => public.pace_zero_pillar_cooldown_seconds())
    into v_cooldown_until
    from (
      -- Option E representation: delivered-but-uncharged.
      select a.zero_pillar_at as event_at
      from public.analyses a
      where a.user_id = p_user_id and a.zero_pillar_at is not null
      union all
      -- Legacy PR #213 representation: released with the zero-pillar reason. Kept so historical
      -- rows and an edge-function rollback still bound resubmission.
      select a.released_at
      from public.analyses a
      where a.user_id = p_user_id and a.status = 'released'
        and a.release_reason = 'zero_pillars_assessed'
        and a.released_at is not null
    ) events
    where event_at > p_as_of - make_interval(secs => public.pace_zero_pillar_cooldown_seconds());
  else
    v_window := public.pace_current_period(v_purchased_at, p_as_of);
    v_period_start := lower(v_window);
    v_period_end := upper(v_window);

    select count(*) into v_used
    from public.analyses
    where user_id = p_user_id and status in ('reserved', 'delivered')
      -- Option E exemption, identical to the free branch above.
      and zero_pillar_at is null
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
