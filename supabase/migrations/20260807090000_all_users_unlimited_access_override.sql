-- TEMPORARY ALL-USERS UNLIMITED ACCESS OVERRIDE
--
-- Captain instruction for the v2.3 comprehensive test pass: every authenticated account should
-- receive the full Elite analysis (including Elite's 8-frame cap and paid-only flags/drills) and
-- no analysis-count or anti-farm quota refusal while ALL_USERS_UNLIMITED_ACCESS=true.
--
-- EASY REVERT: unset the edge-function secret ALL_USERS_UNLIMITED_ACCESS (or set it to false).
-- The edge functions then call the original pace_current_tier / reserve_analysis /
-- pace_quota_status functions exactly as before. Do this BEFORE onboarding real users.
--
-- SECURITY / EXPLOIT HARDENING: these are additive service-role-only wrapper RPCs. They do NOT
-- replace, weaken, or grant client access to reserve_analysis, pace_quota_status, the analyses
-- soft-delete protection, or the append-only/counted history those controls rely on. The normal
-- functions remain the default path. The wrapper reservation still takes the same per-user
-- advisory lock, preserves idempotency, validates photo/frame counts, inserts the same immutable
-- analyses row, and relies on the same settle/release lifecycle. It bypasses only the temporary
-- entitlement decisions requested here: subscription tier, count quota, and anti-farm refusal.
--
-- Purchase/subscription flows are untouched.

create or replace function public.pace_current_tier_unlimited(
  p_user_id uuid
)
returns public.analysis_tier
language sql
security definer
stable
set search_path = public
as $$
  select 'elite'::public.analysis_tier;
$$;

revoke execute on function public.pace_current_tier_unlimited(uuid) from public, anon, authenticated;
grant execute on function public.pace_current_tier_unlimited(uuid) to service_role;

create or replace function public.reserve_analysis_unlimited(
  p_user_id         uuid,
  p_idempotency_key text,
  p_media_type      public.media_type,
  p_frame_count     integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.analyses;
  v_new_id   uuid;
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
  -- Elite is still bounded to 8 frames. "Unlimited" means analysis COUNT, not unbounded request
  -- size/model spend; the global 5MB request limit and AI spend guardrails remain intact too.
  if p_frame_count > 8 then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'frame_cap_exceeded',
      'tier', 'elite',
      'frame_cap', 8
    );
  end if;

  -- Same concurrency and idempotency protections as reserve_analysis. Keeping the identical lock
  -- key means normal and override-path reservations serialize with each other during flag flips.
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':analysis_reserve'));

  select * into v_existing
  from public.analyses
  where user_id = p_user_id and idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'allowed', true,
      'existing', true,
      'id', v_existing.id,
      'status', v_existing.status,
      'tier', v_existing.tier_at_run,
      'result', v_existing.result,
      'is_fallback', v_existing.is_fallback
    );
  end if;

  insert into public.analyses (
    user_id, media_type, frame_count, tier_at_run, status, idempotency_key
  ) values (
    p_user_id, p_media_type, p_frame_count, 'elite', 'reserved', p_idempotency_key
  )
  returning id into v_new_id;

  return jsonb_build_object(
    'allowed', true,
    'existing', false,
    'id', v_new_id,
    'status', 'reserved',
    'tier', 'elite'
  );
exception
  when unique_violation then
    select * into v_existing
    from public.analyses
    where user_id = p_user_id and idempotency_key = p_idempotency_key;

    if not found then
      raise;
    end if;

    return jsonb_build_object(
      'allowed', true,
      'existing', true,
      'id', v_existing.id,
      'status', v_existing.status,
      'tier', v_existing.tier_at_run,
      'result', v_existing.result,
      'is_fallback', v_existing.is_fallback
    );
end;
$$;

revoke execute on function public.reserve_analysis_unlimited(uuid, text, public.media_type, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_analysis_unlimited(uuid, text, public.media_type, integer)
  to service_role;

create or replace function public.pace_quota_status_unlimited(
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
  v_used integer;
begin
  -- Display/diagnostic count only. No limit is enforced from it while the override is selected.
  -- Count rows exactly as the hardened system records them; deleted analyses remain counted.
  select count(*) into v_used
  from public.analyses
  where user_id = p_user_id and status in ('reserved', 'delivered');

  return jsonb_build_object(
    'tier', 'elite',
    'used', v_used,
    'limit', null,
    'frame_cap', 8,
    'is_lifetime', false,
    'period_start', null,
    'period_end', null,
    'blocked', false,
    'blocked_reason', null,
    'blocked_until', null,
    'unlimited', true
  );
end;
$$;

revoke execute on function public.pace_quota_status_unlimited(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.pace_quota_status_unlimited(uuid, timestamptz)
  to service_role;
