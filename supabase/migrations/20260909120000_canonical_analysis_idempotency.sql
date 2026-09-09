-- Canonical analysis idempotency for byte-identical input.
--
-- The existing four-argument reservation RPCs intentionally remain unchanged for rollback
-- compatibility. New callers use the non-defaulted fifth argument below:
--   {"input_fingerprint":"<64 lowercase hex chars>","analyzer_revision":"<stable id>"}
-- Extra JSON keys are ignored and never persisted. The fingerprint is computed by trusted server
-- code over the exact model input; tier is never accepted from the caller and is derived here.
--
-- `canonical_analysis_claims` contains only ACTIVE ownership. Release or soft-delete retires the
-- claim, allowing a later request key to become a fresh owner. `analysis_request_aliases` is the
-- durable idempotency map: every 5-arg request key (owner and aliases alike) remains tied to the
-- attempt it observed, allowing lost-response reconciliation and fail-closed changed-input checks.
-- Both tables are server-only and have no client-facing RLS policies or table grants.

create table public.canonical_analysis_claims (
  user_id            uuid not null references public.profiles(id) on delete cascade,
  input_fingerprint  text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  analyzer_revision  text not null check (analyzer_revision ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$'),
  tier_at_run         public.analysis_tier not null,
  analysis_id         uuid not null unique references public.analyses(id) on delete cascade,
  created_at          timestamptz not null default now(),
  primary key (user_id, input_fingerprint, analyzer_revision, tier_at_run)
);

create table public.analysis_request_aliases (
  user_id            uuid not null references public.profiles(id) on delete cascade,
  idempotency_key    text not null,
  analysis_id         uuid not null references public.analyses(id) on delete cascade,
  input_fingerprint  text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  analyzer_revision  text not null check (analyzer_revision ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$'),
  tier_at_run         public.analysis_tier not null,
  created_at          timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);

create index analysis_request_aliases_analysis_idx
  on public.analysis_request_aliases (analysis_id);

alter table public.canonical_analysis_claims enable row level security;
alter table public.analysis_request_aliases enable row level security;

revoke all on public.canonical_analysis_claims from public, anon, authenticated;
revoke all on public.analysis_request_aliases from public, anon, authenticated;
grant select, insert, update, delete on public.canonical_analysis_claims to service_role;
grant select, insert, update, delete on public.analysis_request_aliases to service_role;

-- A released analysis handed quota back and must not pin the input forever. A soft-deleted row
-- keeps its quota accounting (the established privacy/anti-farming contract) but likewise cannot
-- be reused as a canonical result. Hard deletion is handled by the claim's ON DELETE CASCADE.
create or replace function public.retire_canonical_analysis_claim()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'released' or new.deleted_at is not null then
    delete from public.canonical_analysis_claims where analysis_id = new.id;
  end if;
  return new;
end;
$$;

create trigger analyses_retire_canonical_claim
  after update of status, deleted_at on public.analyses
  for each row execute function public.retire_canonical_analysis_claim();

revoke execute on function public.retire_canonical_analysis_claim()
  from public, anon, authenticated, service_role;

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
    where user_id = p_user_id and status in ('reserved', 'delivered');
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

-- Temporary unlimited-access overload. It shares the same claim/alias model and Elite identity
-- partition, but intentionally retains the existing override's quota and anti-farm bypass.
create or replace function public.reserve_analysis_unlimited(
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
  v_existing     public.analyses;
  v_alias        public.analysis_request_aliases;
  v_claim        public.canonical_analysis_claims;
  v_fingerprint  text;
  v_revision     text;
  v_new_id       uuid;
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

  select * into v_existing
  from public.analyses
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('allowed', false, 'reason', 'idempotency_identity_unverifiable');
  end if;

  if p_frame_count > 8 then
    return jsonb_build_object(
      'allowed', false, 'reason', 'frame_cap_exceeded',
      'tier', 'elite', 'frame_cap', 8
    );
  end if;

  select c.* into v_claim
  from public.canonical_analysis_claims c
  join public.analyses a on a.id = c.analysis_id and a.user_id = c.user_id
  where c.user_id = p_user_id
    and c.input_fingerprint = v_fingerprint
    and c.analyzer_revision = v_revision
    and c.tier_at_run = 'elite'
    and a.status in ('reserved', 'delivered')
    and a.deleted_at is null
  for share of a;

  if found then
    insert into public.analysis_request_aliases (
      user_id, idempotency_key, analysis_id, input_fingerprint, analyzer_revision, tier_at_run
    ) values (
      p_user_id, p_idempotency_key, v_claim.analysis_id, v_fingerprint, v_revision, 'elite'
    );
    select * into v_existing from public.analyses where id = v_claim.analysis_id;
    return jsonb_build_object(
      'allowed', true, 'existing', true, 'id', v_existing.id,
      'status', v_existing.status, 'tier', v_existing.tier_at_run,
      'result', v_existing.result, 'is_fallback', v_existing.is_fallback
    );
  end if;

  insert into public.analyses (
    user_id, media_type, frame_count, tier_at_run, status, idempotency_key
  ) values (
    p_user_id, p_media_type, p_frame_count, 'elite', 'reserved', p_idempotency_key
  ) returning id into v_new_id;
  insert into public.canonical_analysis_claims (
    user_id, input_fingerprint, analyzer_revision, tier_at_run, analysis_id
  ) values (
    p_user_id, v_fingerprint, v_revision, 'elite', v_new_id
  );
  insert into public.analysis_request_aliases (
    user_id, idempotency_key, analysis_id, input_fingerprint, analyzer_revision, tier_at_run
  ) values (
    p_user_id, p_idempotency_key, v_new_id, v_fingerprint, v_revision, 'elite'
  );
  return jsonb_build_object(
    'allowed', true, 'existing', false, 'id', v_new_id,
    'status', 'reserved', 'tier', 'elite'
  );
end;
$$;

revoke execute on function public.reserve_analysis_unlimited(uuid, text, public.media_type, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.reserve_analysis_unlimited(uuid, text, public.media_type, integer, jsonb)
  to service_role;

-- Authenticated, user-scoped lost-response resolver. The request key can be either the canonical
-- owner's direct key or any alias. Identity fields are intentionally absent from the return.
create or replace function public.resolve_analysis_request(p_idempotency_key text)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  with target as (
    select r.analysis_id
    from public.analysis_request_aliases r
    where r.user_id = auth.uid() and r.idempotency_key = p_idempotency_key
    union all
    select a.id
    from public.analyses a
    where a.user_id = auth.uid()
      and a.idempotency_key = p_idempotency_key
      and not exists (
        select 1 from public.analysis_request_aliases r
        where r.user_id = auth.uid() and r.idempotency_key = p_idempotency_key
      )
    limit 1
  )
  select jsonb_build_object(
    'id', a.id,
    'status', a.status,
    'result', a.result,
    'is_fallback', a.is_fallback
  )
  from target t
  join public.analyses a on a.id = t.analysis_id
  where a.user_id = auth.uid();
$$;

revoke execute on function public.resolve_analysis_request(text)
  from public, anon, service_role;
grant execute on function public.resolve_analysis_request(text) to authenticated;
