-- The quota RPC family for analyze-form's reserve -> settle/release
-- lifecycle (docs/mvp-build-prompt.md Ruling 2, ported from Echo V1's
-- try_record_form_analysis atomicity pattern in
-- supabase/functions/anthropic-coach/index.ts and V2.2's plan-regen-gate
-- reserve/consume/compensating-refund shape — fixing V1's known flaw where
-- quota was charged before the model call, so failures still cost the
-- user).
--
-- SECURITY: all three are SECURITY DEFINER with a pinned search_path, and
-- all take p_user_id as a plain argument rather than deriving it from
-- auth.uid() (the calling context is the edge function's service-role
-- client, acting on behalf of whichever user it already authenticated via
-- the caller's JWT). Without revoking EXECUTE, PostgREST's default
-- auto-exposure would let any authenticated client call these directly with
-- an arbitrary user_id, forging reservations into another user's quota or
-- reading/settling/releasing their rows — see Echo V1's schema.sql
-- (try_record_form_analysis / try_record_coach_message) for the identical
-- lesson. EXECUTE is revoked from public/anon/authenticated and granted
-- only to service_role below.
--
-- CONCURRENCY (why two simultaneous reserves for the last quota slot can't
-- both succeed): reserve_analysis opens with
-- pg_advisory_xact_lock(hashtext(p_user_id || ':analysis_reserve')), which
-- serializes every reserve_analysis call for one user — a second concurrent
-- call for the same user blocks until the first call's transaction (its
-- count-check AND its insert) has committed or rolled back. A bare
-- `insert ... select where (select count(*)...) < limit` single statement
-- does NOT close this race in Postgres on its own: no lock is taken over
-- "rows matching this filter", so two truly concurrent statements can each
-- evaluate the count subquery before either commits, and both insert,
-- overshooting the limit. The advisory lock makes the second caller's count
-- reflect the first caller's just-inserted reservation, not just "less
-- likely to race." The UNIQUE (user_id, idempotency_key) constraint on
-- analyses is a second, unconditional backstop against a genuine
-- lock-hash collision (see the exception handler below).

create or replace function public.reserve_analysis(
  p_user_id         uuid,
  p_idempotency_key text,
  p_media_type      public.media_type,
  p_frame_count     integer,
  p_media_paths     text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing       public.analyses;
  v_tier           public.analysis_tier;
  v_purchased_at   timestamptz;
  v_limit          integer;
  v_frame_cap      integer;
  v_window         tstzrange;
  v_active_count   integer;
  v_released_count integer;
  v_new_id         uuid;
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

  -- Serialize every reserve call for this user — see header comment.
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':analysis_reserve'));

  -- Idempotency: an existing row for (user_id, idempotency_key) is returned
  -- as-is, whatever its status — never a second reservation for the same
  -- key. The client mints idempotency_key once per capture-flow commit, so
  -- a genuine retry after a released failure uses a fresh key, not this
  -- path.
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

  -- Tier is derived here, server-side, from subscriptions — never trusted
  -- from the caller. No row (or no active row) = free (see the
  -- subscriptions table comment in the prior migration).
  select tier, purchased_at into v_tier, v_purchased_at
  from public.subscriptions
  where user_id = p_user_id and status = 'active';

  if not found then
    v_tier := 'free';
  end if;

  -- Canonical per-tier numbers per planning/03-engineering-requirements.md
  -- ("DB schema" + "Frame pipeline" sections). This RPC is the sole
  -- enforcement point — the client's lib/subscription.ts tier/quota display
  -- is cosmetic only, never authoritative, so there is no second copy of
  -- these numbers to drift out of sync with (unlike Echo V1's edge-function/
  -- app duplication).
  v_limit := case v_tier when 'free' then 1 when 'pro' then 10 when 'elite' then 30 end;
  v_frame_cap := case v_tier when 'free' then 1 when 'pro' then 5 when 'elite' then 8 end;

  if p_frame_count > v_frame_cap then
    return jsonb_build_object('allowed', false, 'reason', 'frame_cap_exceeded', 'tier', v_tier, 'frame_cap', v_frame_cap);
  end if;

  -- Free is lifetime (count(analyses) total, never per-period); pro/elite
  -- are purchase-day-anchored, month-end-clamped periods computed at read
  -- time via pace_current_period. Both branches are implemented separately
  -- per planning/03's "Quota-period arithmetic" — free does not reuse the
  -- period logic.
  if v_tier = 'free' then
    select count(*) into v_active_count
    from public.analyses
    where user_id = p_user_id and status in ('reserved', 'delivered');

    select count(*) into v_released_count
    from public.analyses
    where user_id = p_user_id and status = 'released';
  else
    v_window := public.pace_current_period(v_purchased_at, now());

    select count(*) into v_active_count
    from public.analyses
    where user_id = p_user_id and status in ('reserved', 'delivered')
      and created_at <@ v_window;

    select count(*) into v_released_count
    from public.analyses
    where user_id = p_user_id and status = 'released'
      and created_at <@ v_window;
  end if;

  -- Anti-farming cap (docs/mvp-build-prompt.md gate #4): max 3 released
  -- reservations per window. A released reservation never counts against
  -- the quota limit above, but it does count here — otherwise
  -- prompt-injection farming (deliberately tripping validation) could burn
  -- unlimited Anthropic calls for free, since failures/fallbacks don't cost
  -- quota.
  if v_released_count >= 3 then
    return jsonb_build_object('allowed', false, 'reason', 'too_many_failed_attempts', 'tier', v_tier);
  end if;

  if v_active_count >= v_limit then
    return jsonb_build_object('allowed', false, 'reason', 'quota_exceeded', 'tier', v_tier, 'used', v_active_count, 'limit', v_limit);
  end if;

  insert into public.analyses (
    user_id, media_type, media_paths, frame_count, tier_at_run, status, idempotency_key
  ) values (
    p_user_id, p_media_type, coalesce(p_media_paths, '{}'), p_frame_count, v_tier, 'reserved', p_idempotency_key
  )
  returning id into v_new_id;

  return jsonb_build_object('allowed', true, 'existing', false, 'id', v_new_id, 'status', 'reserved', 'tier', v_tier);
exception
  when unique_violation then
    -- Belt-and-braces: the advisory lock already serializes same-user
    -- callers, but if two sessions ever raced past it (e.g. a hashtext lock
    -- collision with a different user_id), UNIQUE (user_id,
    -- idempotency_key) is the unconditional second backstop. Return the row
    -- that won instead of raising a 500 to the edge function.
    select * into v_existing
    from public.analyses
    where user_id = p_user_id and idempotency_key = p_idempotency_key;
    return jsonb_build_object(
      'allowed', true, 'existing', true, 'id', v_existing.id,
      'status', v_existing.status, 'tier', v_existing.tier_at_run,
      'result', v_existing.result, 'is_fallback', v_existing.is_fallback
    );
end;
$$;

revoke execute on function public.reserve_analysis(uuid, text, public.media_type, integer, text[]) from public, anon, authenticated;
grant execute on function public.reserve_analysis(uuid, text, public.media_type, integer, text[]) to service_role;

-- Marks a reservation delivered on a successful (or honest-partial) result.
-- Guarded to only affect a row that is (a) this user's, (b) the exact
-- analysis id, and (c) still 'reserved' — so a duplicate/late settle call
-- (e.g. a retried edge-function invocation) is a safe no-op rather than
-- overwriting an already-delivered result.
create or replace function public.settle_analysis(
  p_user_id     uuid,
  p_analysis_id uuid,
  p_result      jsonb,
  p_is_fallback boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.analyses;
begin
  update public.analyses
  set status = 'delivered',
      result = p_result,
      is_fallback = coalesce(p_is_fallback, false),
      delivered_at = now()
  where id = p_analysis_id and user_id = p_user_id and status = 'reserved'
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_reserved_or_not_found');
  end if;

  return jsonb_build_object(
    'ok', true, 'id', v_row.id, 'status', v_row.status,
    'result', v_row.result, 'is_fallback', v_row.is_fallback
  );
end;
$$;

revoke execute on function public.settle_analysis(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.settle_analysis(uuid, uuid, jsonb, boolean) to service_role;

-- Compensating release for reserve_analysis above — a reservation that never
-- gets settled (the vision call errored after its one retry, or the
-- response validated to a clean failure per gate #4) is released here so it
-- stops counting toward the caller's quota (v_active_count above only
-- counts 'reserved'/'delivered'), while the row itself is kept, not
-- hard-deleted, with status 'released' — it still counts toward the
-- 3-failed-attempt anti-farming cap in reserve_analysis. Same guard shape as
-- settle_analysis: only a still-'reserved' row belonging to this user can be
-- released, so a duplicate/late call is a safe no-op.
create or replace function public.release_analysis(
  p_user_id     uuid,
  p_analysis_id uuid,
  p_reason      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.analyses
  set status = 'released',
      released_at = now(),
      release_reason = p_reason
  where id = p_analysis_id and user_id = p_user_id and status = 'reserved'
  returning id into v_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_reserved_or_not_found');
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'released');
end;
$$;

revoke execute on function public.release_analysis(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.release_analysis(uuid, uuid, text) to service_role;
