-- #88 — frame-upload ordering. The upload moves server-side, into the
-- analyze-form edge function, and happens AFTER reserve_analysis has already
-- minted the row.
--
-- WHY. The old contract was unbuildable and leaked. reserve_analysis mints the
-- analysis id server-side (insert ... returning id) yet took p_media_paths as
-- an INPUT, so the client had to name {user_id}/{analysis_id}/ before the
-- analysis_id that path needs existed. And all four rejection branches
-- (invalid_*, frame_cap_exceeded, too_many_failed_attempts, quota_exceeded)
-- return BEFORE the insert — so a Free user who has spent their one lifetime
-- analysis uploaded frames, got a 402, and left images of their body in the
-- bucket with no row pointing at them, forever, with no way to ever delete
-- them.
--
-- THE INVARIANT, both directions:
--   * No object exists in the media bucket unless an analyses row already
--     points at it.  (forward: the upload now happens after the reserve)
--   * No row can be destroyed while its objects survive.  (reverse: the
--     client loses DELETE on both storage.objects and analyses; purge is
--     #57's job)
--
-- DELETION AUTHORITY. Purge deletes by PREFIX {user_id}/{analysis_id}/, never
-- by iterating media_paths. Reachability comes from the ROW EXISTING, not
-- from media_paths being populated: a crash between the upload and the
-- settle leaves objects under a prefix whose row is still 'reserved' with an
-- empty media_paths. A prefix-delete finds them; a media_paths-driven delete
-- would not, and would reinvent the exact orphan this migration removes.
-- media_paths is the frame-strip DISPLAY list. #47/#57/#58 all inherit this.
--
-- OVERLAP WITH #2 (quota-reset RLS hole, worked concurrently in a sibling
-- worktree). #2 also needs the client DELETE policy on public.analyses gone
-- (deleting a row currently resets the free-tier lifetime count and the
-- 3-strike anti-farming counter, since reserve_analysis counts *surviving*
-- rows). This migration drops that policy for an independent reason (a
-- client-side row delete would strand that row's frames now that the
-- client's storage DELETE is also gone) — the two fixes want the same end
-- state and should not conflict on the policy itself. But #2 may ALSO need
-- to change reserve_analysis's counting query (e.g. to filter on a
-- soft-delete column or read an append-only ledger instead of counting live
-- rows). Because `create or replace function` replaces the whole body, the
-- two migrations cannot both blindly apply in sequence without one of them
-- overwriting the other's function body — whichever migration's
-- reserve_analysis definition lands last WINS in full, silently dropping
-- whatever the other one changed inside that function. THIS NEEDS MANUAL
-- RECONCILIATION when the two branches merge: combine this migration's
-- signature change (4 args, no p_media_paths) with #2's counting-logic fix
-- into one final function body, rather than applying both files back to
-- back. Do not apply both to the live project without doing that merge by
-- hand first.

-- ---------------------------------------------------------------------------
-- 1. reserve_analysis: drop p_media_paths.
-- ---------------------------------------------------------------------------
-- The old 5-arg function must be DROPPED, not just replaced: a create-or-
-- replace with fewer args creates an OVERLOAD, leaving the old signature
-- callable and still accepting client-supplied paths (#8).

drop function if exists public.reserve_analysis(uuid, text, public.media_type, integer, text[]);

create or replace function public.reserve_analysis(
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

  -- Serialize every reserve call for this user — see the original
  -- migration's header for why a bare count-then-insert does not close the
  -- race.
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

  select tier, purchased_at into v_tier, v_purchased_at
  from public.subscriptions
  where user_id = p_user_id and status = 'active';

  if not found then
    v_tier := 'free';
  end if;

  v_limit := case v_tier when 'free' then 1 when 'pro' then 10 when 'elite' then 30 end;
  v_frame_cap := case v_tier when 'free' then 1 when 'pro' then 5 when 'elite' then 8 end;

  if p_frame_count > v_frame_cap then
    return jsonb_build_object('allowed', false, 'reason', 'frame_cap_exceeded', 'tier', v_tier, 'frame_cap', v_frame_cap);
  end if;

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

  if v_released_count >= 3 then
    return jsonb_build_object('allowed', false, 'reason', 'too_many_failed_attempts', 'tier', v_tier);
  end if;

  if v_active_count >= v_limit then
    return jsonb_build_object('allowed', false, 'reason', 'quota_exceeded', 'tier', v_tier, 'used', v_active_count, 'limit', v_limit);
  end if;

  -- media_paths is deliberately NOT set here. The row is minted first, with
  -- an empty media_paths; the edge function uploads the frames only after
  -- the model call succeeds, then records the paths that actually landed via
  -- settle_analysis. That ordering is the whole point of #88.
  insert into public.analyses (
    user_id, media_type, frame_count, tier_at_run, status, idempotency_key
  ) values (
    p_user_id, p_media_type, p_frame_count, v_tier, 'reserved', p_idempotency_key
  )
  returning id into v_new_id;

  return jsonb_build_object('allowed', true, 'existing', false, 'id', v_new_id, 'status', 'reserved', 'tier', v_tier);
exception
  when unique_violation then
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

revoke execute on function public.reserve_analysis(uuid, text, public.media_type, integer) from public, anon, authenticated;
grant execute on function public.reserve_analysis(uuid, text, public.media_type, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 2. settle_analysis: gain p_media_paths, with a namespace guard.
-- ---------------------------------------------------------------------------
-- Same overload hazard as above — drop the 4-arg signature explicitly.
--
-- The guard is what permanently closes #8: after this, not even the service
-- role can record a path outside the row's own {user_id}/{analysis_id}/
-- namespace, so a compromised or buggy edge function cannot point one user's
-- analyses row at another user's frames.

drop function if exists public.settle_analysis(uuid, uuid, jsonb, boolean);

create or replace function public.settle_analysis(
  p_user_id     uuid,
  p_analysis_id uuid,
  p_result      jsonb,
  p_is_fallback boolean default false,
  p_media_paths text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.analyses;
  v_prefix text;
  v_path   text;
begin
  v_prefix := p_user_id::text || '/' || p_analysis_id::text || '/';

  -- Every path must sit under this row's own prefix, and must name a file
  -- inside it (not the bare prefix). Reject the whole call rather than
  -- silently dropping the bad element — a caller passing a foreign path is a
  -- bug or an attack, and swallowing it would hide both.
  foreach v_path in array coalesce(p_media_paths, '{}')
  loop
    if v_path is null or position(v_prefix in v_path) <> 1 or length(v_path) <= length(v_prefix) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_media_path');
    end if;
  end loop;

  update public.analyses
  set status = 'delivered',
      result = p_result,
      is_fallback = coalesce(p_is_fallback, false),
      media_paths = coalesce(p_media_paths, '{}'),
      delivered_at = now()
  where id = p_analysis_id and user_id = p_user_id and status = 'reserved'
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_reserved_or_not_found');
  end if;

  return jsonb_build_object(
    'ok', true, 'id', v_row.id, 'status', v_row.status,
    'result', v_row.result, 'is_fallback', v_row.is_fallback,
    'media_paths', to_jsonb(v_row.media_paths)
  );
end;
$$;

revoke execute on function public.settle_analysis(uuid, uuid, jsonb, boolean, text[]) from public, anon, authenticated;
grant execute on function public.settle_analysis(uuid, uuid, jsonb, boolean, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 3. storage.objects: the client no longer writes to the bucket at all.
-- ---------------------------------------------------------------------------
-- The frames now ride in the analyze-form request body as base64 (they
-- always did — the old spec had the client uploading each frame TWICE, once
-- to the bucket and once in the body) and the edge function writes them with
-- the service-role key, which bypasses RLS. So the client needs no INSERT.
--
-- Dropping INSERT closes #7: a bucket-fill by an authenticated client stops
-- being POSSIBLE, rather than being budgeted against with a per-user byte
-- cap.
--
-- Dropping DELETE keeps the client from purging objects out from under a
-- live row. Purge is #57 (DELETE /analysis/:id) and #58 (delete-account),
-- both service-role, both by prefix.
--
-- SELECT stays: the client mints short-TTL signed URLs for the M6 frame
-- strip, which requires SELECT on the object.

drop policy if exists "Users can upload their own media objects" on storage.objects;
drop policy if exists "Users can delete their own media objects" on storage.objects;

-- ---------------------------------------------------------------------------
-- 4. public.analyses: drop the client DELETE policy.
-- ---------------------------------------------------------------------------
-- This is the REVERSE direction of the invariant. With the client's storage
-- DELETE gone (section 3), a client-side row delete would strand that row's
-- frames: no row pointing at them, and no client-side way to remove them —
-- #88's own bug, reintroduced from the other end, and #3 made strictly
-- worse.
--
-- So deletion becomes the exclusive job of the DELETE /analysis/:id edge
-- function (#57), which removes the row AND prefix-purges the objects in one
-- place. Nothing regresses today: no client code deletes an analysis (the
-- only client reference to the table is a quota-display SELECT in
-- app/(tabs)/index.tsx) and the M6 delete UI does not exist yet.
--
-- This also happens to be the exact policy #2 needs gone (deleting a row
-- currently resets the free-tier lifetime count and the 3-strike anti-
-- farming counter, since reserve_analysis counts surviving rows) — see the
-- OVERLAP note at the top of this file.
--
-- CONSEQUENCE: #57 is now a hard prerequisite for any user-facing delete.

drop policy if exists "Users can delete their own analyses" on public.analyses;
