-- Captain's ruling 2026-09-10 ("Option E"): a zero-pillar analysis is DELIVERED BUT UNCHARGED.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- THE TWO RULINGS, AND WHY THEY COLLIDE
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- RULING A — NEVER CHARGE FOR A BLANK RESULT (PR #213, on main). A structurally valid verdict in
-- which all four PACE pillars came back `score: null` told the runner nothing. Charging a Free
-- account its ONE lifetime analysis for that is the harshest available reading of a clip we could
-- not read — the fault is almost always framing or lighting, not intent. #213 implemented this by
-- RELEASING the reservation (`release_reason = 'zero_pillars_assessed'`), which is how quota gets
-- handed back everywhere else in this schema.
--
-- RULING B — PIN THE CANONICAL RESULT (20260909120000_canonical_analysis_idempotency.sql). Two
-- byte-identical submissions must never produce two different verdicts. That machinery pins a
-- verdict to (user, input_fingerprint, analyzer_revision, tier) via `canonical_analysis_claims`,
-- and replays the PERSISTED result instead of calling the model again. It can only replay a row
-- that is SETTLED: the claim lookup requires `a.status in ('reserved','delivered')`, and the
-- `analyses_retire_canonical_claim` trigger deletes the claim outright the moment a row goes
-- 'released'.
--
-- THE COLLISION. Release is the only uncharging mechanism this schema had, and release is exactly
-- what retires a canonical claim. Under #213 a zero-pillar verdict returned an UNPERSISTED 200:
-- the row went 'released', `result` was never written, the claim was destroyed, and the identical
-- clip resubmitted an hour later reached the model again and could come back different. That is a
-- launch blocker for Ruling B while Ruling A is implemented by releasing.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- OPTION E — KEEP #213's INTENT, CHANGE ITS MECHANISM
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- The row is SETTLED (status 'delivered', `result` persisted, claim left active, so the pinned
-- verdict replays for identical evidence with no model call) and separately marked EXEMPT from
-- quota counting. Uncharging stops being "give the slot back by unwinding the row" and becomes
-- "this row was never a charge in the first place". Nobody is charged, and nothing un-pins.
--
-- ONE COLUMN, NOT TWO. `analyses.zero_pillar_at` is BOTH the exemption marker (`is not null` =>
-- delivered but uncharged) and the cooldown anchor. A separate boolean plus a timestamp could
-- disagree with each other; one nullable timestamp cannot. It also survives the soft-delete
-- redaction trigger (20260712040000 nulls `result` and `media_paths` only), which is the correct
-- behaviour on both counts: a deleted analysis stays uncharged, and deleting the row cannot clear
-- the resubmission cooldown it anchors.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- THE COOLDOWN HAD TO MOVE WITH THE REPRESENTATION, OR IT WOULD SILENTLY FAIL OPEN
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- READ THIS BEFORE TOUCHING §4. `pace_zero_pillar_cooldown_remaining` (20260906130000, narrowed to
-- one argument by 20260906140000) is the ONLY thing bounding how often a Free account may farm
-- free model calls by resubmitting unreadable clips — an uncharged result costs the user nothing,
-- so quota is not the bound; frequency is. It found its events by reading
-- `status = 'released' AND release_reason = 'zero_pillars_assessed'`.
--
-- After this migration NOTHING WRITES THOSE ROWS ANY MORE. The lookup would still compile, still
-- run, and still return 0 — forever. Its own deliberate fail-safe shape (`coalesce(...)` so "no
-- qualifying row" reads as "no wait", per 20260906130000's comment) is precisely what would turn
-- a dead query into an unlimited-resubmission hole with a green test suite. The same is true of
-- `pace_quota_status`'s copy of that read, which is what Home pre-flights against; leaving it
-- behind would have it report `blocked = false` while analyze-form still refused.
--
-- So §4 re-points both reads at the most recent zero-pillar event from EITHER representation:
-- the new `zero_pillar_at` rows, OR the legacy released rows. The legacy arm is not dead weight —
-- it keeps historical rows bounding resubmission, and it keeps the cooldown intact if the edge
-- function is rolled back to a build that still releases.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHAT IS DELIBERATELY NOT CHANGED
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
--   * The 5-argument `settle_analysis(uuid, uuid, jsonb, boolean, text[])` stays exactly as
--     20260713150000 left it. §2 adds a SIXTH-argument overload beside it rather than replacing
--     it, so this migration can be pushed AHEAD of the edge function (DB-first) and the currently
--     deployed build keeps working unchanged.
--   * `p_zero_pillar` has NO DEFAULT, for the same reason `p_analysis_identity` is a required
--     fifth argument on 20260909120000's reserve overload. A defaulted sixth argument would make
--     a five-named-argument call — which is exactly what the deployed edge function sends —
--     match BOTH overloads, and PostgreSQL would fail it at resolution ("function is not
--     unique") rather than pick one. No default is what keeps the old signature unambiguous.
--   * The media-path prefix validation and the `deleted_at is null` guard are carried into the new
--     overload verbatim. Dropping either would re-open issue #133 (a soft-deleted 'reserved' row
--     getting a real result written back onto it, un-redacted) on the new code path.
--   * The LEGACY four-argument `reserve_analysis` / `reserve_analysis_unlimited` overloads are NOT
--     given the exemption. They are rollback-only surface; a build old enough to call them is also
--     old enough that it never passes `p_zero_pillar`, so it never creates an exempt row. The one
--     residual case — rolling the edge function back AFTER exempt rows exist — then counts those
--     rows, i.e. it over-charges rather than under-charges. Fail-closed, and self-healing on
--     roll-forward.
--   * `reserve_analysis_unlimited` (the FIVE-argument overload in 20260909120000) is untouched
--     because it contains NO quota count at all — it deliberately retains the override's quota and
--     anti-farm bypass. Its `a.status in ('reserved','delivered')` is the canonical-CLAIM liveness
--     test, not a charge; adding the exemption there would un-pin every zero-pillar verdict and
--     defeat the entire point of this migration. The same is true of the identical predicate in
--     `reserve_analysis`'s claim lookup, which is likewise left alone. The unlimited family's
--     actual counter is `pace_quota_status_unlimited`, and THAT is what §3 updates.

-- ---------------------------------------------------------------------------------------------
-- 1. The marker.
--
-- Nullable, no default, no backfill. Every row that exists today predates Option E and is
-- correctly NULL: it was either charged (delivered/reserved) or already unwound (released).
-- ---------------------------------------------------------------------------------------------

alter table public.analyses add column zero_pillar_at timestamptz;

comment on column public.analyses.zero_pillar_at is
  'Set by settle_analysis(..., p_zero_pillar => true) when a delivered verdict assessed none of '
  'the four PACE pillars. Non-null means DELIVERED BUT UNCHARGED: the row is settled and its '
  'result is pinned for canonical replay, but it is excluded from every quota count. Also the '
  'anchor for pace_zero_pillar_cooldown_remaining. Survives soft-delete on purpose.';

-- ---------------------------------------------------------------------------------------------
-- 2. settle_analysis, with an explicit zero-pillar flag.
--
-- Body-for-body identical to 20260713150000's five-argument function — same prefix validation,
-- same `deleted_at is null` guard (issue #133), same refusal string, same return shape — plus the
-- one column this ruling adds. A NEW OVERLOAD, not a replacement: see the header on why
-- `p_zero_pillar` carries no default and why the old signature must stay callable.
-- ---------------------------------------------------------------------------------------------

create or replace function public.settle_analysis(
  p_user_id      uuid,
  p_analysis_id  uuid,
  p_result       jsonb,
  p_is_fallback  boolean,
  p_media_paths  text[],
  p_zero_pillar  boolean
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
  -- bug or an attack, and swallowing it would hide both. Unchanged from
  -- 20260712123606.
  foreach v_path in array coalesce(p_media_paths, '{}')
  loop
    if v_path is null or position(v_prefix in v_path) <> 1 or length(v_path) <= length(v_prefix) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_media_path');
    end if;
  end loop;

  -- `and deleted_at is null` (issue #133, 20260713150000): a row soft-deleted while 'reserved'
  -- can no longer match this UPDATE, so no RPC can write a real result back onto a row the
  -- redaction trigger already emptied. Carried here verbatim — the new overload is a second door
  -- into the same table and must not be a weaker one.
  --
  -- THE ONLY BEHAVIOURAL ADDITION: `zero_pillar_at`. The row still settles to 'delivered' with its
  -- result persisted, so the canonical claim from 20260909120000 stays ACTIVE and identical
  -- evidence replays this exact verdict instead of reaching the model again. The stamp is what
  -- makes it uncharged; the settle is what makes it pinned.
  update public.analyses
  set status = 'delivered',
      result = p_result,
      is_fallback = coalesce(p_is_fallback, false),
      media_paths = coalesce(p_media_paths, '{}'),
      delivered_at = now(),
      zero_pillar_at = case when coalesce(p_zero_pillar, false) then now() else null end
  where id = p_analysis_id
    and user_id = p_user_id
    and status = 'reserved'
    and deleted_at is null
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

comment on function public.settle_analysis(uuid, uuid, jsonb, boolean, text[], boolean) is
  'Settles a reservation into a delivered analysis. p_zero_pillar => true additionally stamps '
  'analyses.zero_pillar_at, making the row DELIVERED BUT UNCHARGED: pinned for canonical replay, '
  'excluded from every quota count, and the anchor for the resubmission cooldown.';

-- Same posture as every other RPC in this family, and as the five-argument overload it sits
-- beside: service_role only, called from analyze-form under the service key.
revoke execute on function public.settle_analysis(uuid, uuid, jsonb, boolean, text[], boolean)
  from public, anon, authenticated;
grant execute on function public.settle_analysis(uuid, uuid, jsonb, boolean, text[], boolean)
  to service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. Quota counting excludes uncharged rows.
--
-- Both functions below are reproduced VERBATIM from their current committed definitions
-- (reserve_analysis from 20260909120000, pace_quota_status from 20260906140000,
-- pace_quota_status_unlimited from 20260807090000) with only the counting predicate and the
-- cooldown read changed. `create or replace` replaces the whole body, so anything dropped
-- here would be silently lost — see 20260713150000's header on that hazard.
-- ---------------------------------------------------------------------------------------------

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
  v_frame_cap := case v_tier when 'free' then 1 when 'pro' then 5 when 'elite' then 8 end;
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
  v_frame_cap := case v_tier when 'free' then 1 when 'pro' then 5 when 'elite' then 8 end;

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
  where user_id = p_user_id and status in ('reserved', 'delivered')
    -- Option E exemption, so the override's display count agrees with pace_quota_status.
    and zero_pillar_at is null;

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

-- ---------------------------------------------------------------------------------------------
-- 4. The cooldown follows the representation, or it fails open.
-- ---------------------------------------------------------------------------------------------

-- Superseding 20260906140000's one-argument version. Same signature, same fail-open-by-design
-- `coalesce`/`greatest` shape, same interval from pace_zero_pillar_cooldown_seconds() — do NOT
-- reintroduce a TypeScript constant for it. The ONLY change is WHERE the events come from: a
-- union of the Option E marker and the legacy released rows, because §1/§2 stopped writing the
-- latter and a lookup over rows nobody writes returns 0 forever without ever erroring.
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
            (max(event_at) + make_interval(secs => public.pace_zero_pillar_cooldown_seconds()))
              - now()
        )
      )
    ),
    0
  )::integer
  from (
    -- Option E (current): delivered but uncharged. Deliberately not filtered on status or
    -- deleted_at — deleting the analysis must not clear the cooldown it anchors, and the row is
    -- 'delivered' by construction.
    select a.zero_pillar_at as event_at
    from public.analyses a
    where a.user_id = p_user_id
      and a.zero_pillar_at is not null
    union all
    -- Legacy (PR #213 and earlier): the reservation was released with the zero-pillar reason.
    -- Kept so historical rows keep bounding resubmission and so an edge-function rollback to a
    -- releasing build is still throttled.
    select a.released_at
    from public.analyses a
    where a.user_id = p_user_id
      and a.status = 'released'
      and a.release_reason = 'zero_pillars_assessed'
      and a.released_at is not null
  ) events
  where event_at > now() - make_interval(secs => public.pace_zero_pillar_cooldown_seconds());
$$;

comment on function public.pace_zero_pillar_cooldown_remaining(uuid) is
  'Seconds a user must still wait after their most recent zero-pillar result before analyze-form '
  'accepts another submission (free tier only). Reads BOTH representations: analyses.zero_pillar_at '
  '(delivered but uncharged) and the legacy zero_pillars_assessed release. Read-only over '
  'public.analyses — no counter, no new state.';

revoke all on function public.pace_zero_pillar_cooldown_remaining(uuid) from public;
revoke all on function public.pace_zero_pillar_cooldown_remaining(uuid) from anon;
revoke all on function public.pace_zero_pillar_cooldown_remaining(uuid) from authenticated;
grant execute on function public.pace_zero_pillar_cooldown_remaining(uuid) to service_role;
