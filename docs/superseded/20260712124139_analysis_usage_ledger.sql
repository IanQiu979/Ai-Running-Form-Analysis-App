-- SUPERSEDED — DO NOT APPLY. See docs/superseded/README.md.
-- Recovered 2026-07-27 from Supabase preview branch `issue-2-analysis-usage-ledger`
-- (project ref fccevldnebauvcvrzqyp) before that branch was deleted. Never committed,
-- never applied to production. Superseded by 20260712040000_analyses_quota_soft_delete
-- and 20260712230000_analyses_client_delete_removed.
--
-- Original content follows verbatim.

-- Fix for issue #2: quota was resettable via a client-issued DELETE.
--
-- THE EXPLOIT: reserve_analysis (20260711150400) counted quota by querying
-- live rows in public.analyses — `status in ('reserved','delivered')` for
-- the active count, `status = 'released'` for the anti-farm count. But
-- 20260711150200 also gave `authenticated` an owner-scoped DELETE policy on
-- that same table. A free user who had used their one lifetime analysis
-- could simply `DELETE FROM analyses WHERE id = ...` from the client (a
-- plain authenticated PostgREST call, no RPC involved) and their live-row
-- count went back to 0 — reserve_analysis would then allow another
-- reservation, and another, and another: unlimited claude-sonnet-5 vision
-- calls for a nominally-free tier. The identical delete also reset the
-- 3-released anti-farm cap, so a user could grind through validation
-- failures indefinitely rather than being capped at 3 per window. Deleting
-- the row deleted the *evidence* that quota had been used — the quota and
-- its audit trail were the same mutable, client-deletable object.
--
-- THE FIX has two parts, decided together:
--
--   (A) An append-only usage ledger (public.analysis_usage below) that
--       reserve_analysis counts instead of public.analyses. A 'reserved'
--       event is appended when a reservation is made, a 'released' event
--       when it's compensated-released. Usage is `count(reserved) -
--       count(released)`, exactly mirroring the old `n_total - n_released`
--       arithmetic (see the backfill comment below for the equivalence
--       proof) — but the ledger carries no DELETE policy at all, so no
--       client action can make a past reservation stop having happened.
--
--   (C) Client DELETE on public.analyses is removed entirely — the policy
--       is dropped and the DELETE/INSERT/UPDATE/TRUNCATE grants are
--       revoked (§10). Row deletion becomes exclusively
--       DELETE /functions/v1/analysis/:id (#57, not yet built), which will
--       purge the analyses row and its Storage objects but must NOT touch
--       analysis_usage — the ledger is the point of the fix, so it must
--       outlive the row it was reserved for.
--
-- This also RETRACTS the trailing comment in 20260711150200_analyses.sql
-- ("Direct client DELETE is intentionally allowed...") — that comment
-- documented the exploit as a deliberate design choice. It wasn't; it was
-- the bug. §11 of this migration appends a superseded-by marker directly
-- below it rather than editing it away, so the history of the mistake
-- stays legible.
--
-- ACCEPTED RESIDUAL (not defended, by design): free-tier quota keys on
-- user_id, and user_id only exists once auth.users has a row. Delete the
-- account (once #57/#58 build account deletion) and re-sign-up with the
-- same email mints a new auth.users.id, hence a new profiles row, hence a
-- ledger with zero rows for that id — the free lifetime cap resets. This is
-- inherent to any per-account quota, not specific to this ledger design,
-- and is not worth defending (e.g. via email-hash tracking survives account
-- deletion) for a budget of exactly one free analysis. Documented here so
-- it isn't mistaken for an oversight if raised again later.

-- §2: the ledger itself.

create type public.analysis_usage_event as enum ('reserved', 'released');

create table public.analysis_usage (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  -- Deliberately NO foreign key to public.analyses: the ledger row must OUTLIVE
  -- a hard-delete of the analysis (that is the entire fix for #2). An FK with
  -- on delete cascade would reintroduce #2 exactly; on delete restrict would make
  -- the future DELETE /functions/v1/analysis/:id (#57) unable to delete. So: no FK.
  analysis_id uuid not null,
  event       public.analysis_usage_event not null,
  tier_at_run public.analysis_tier not null,
  -- The RESERVATION's timestamp, copied onto BOTH events for one analysis. This,
  -- not created_at, is what the pro/elite period window filters on — matching the
  -- semantics reserve_analysis has always had (it windowed released rows on
  -- analyses.created_at, i.e. reservation time, never released_at). Windowing a
  -- 'released' event on its own append time would charge quota for a failure
  -- released after the period rolled and drive `used` negative next period.
  reserved_at timestamptz not null,
  -- This event's own append time. Audit/ordering only; never a quota input.
  created_at  timestamptz not null default now(),
  -- At most one 'reserved' and one 'released' event per analysis, ever.
  constraint analysis_usage_analysis_event_unique unique (analysis_id, event)
);

-- §3: index. The free branch uses the user_id prefix alone (count(*) filter,
-- no range); pro/elite adds the reserved_at range scan on top of it; event is
-- read by the FILTER aggregates straight off the index without a heap fetch,
-- since (user_id, reserved_at, event) covers every column both reserve_analysis
-- queries touch. NOT dropping analyses_user_status_created_idx (20260711150200)
-- here — the RPCs below no longer use it, but it still backs the client's Home
-- quota count in app/(tabs)/index.tsx (a plain SELECT count against analyses,
-- unaffected by this migration); it retires with #57 once that read moves too.
create index analysis_usage_user_reserved_event_idx
  on public.analysis_usage (user_id, reserved_at, event);

-- §4: RLS — one policy, and deliberately only one.
alter table public.analysis_usage enable row level security;

-- Owner-scoped SELECT is a strictly smaller disclosure than analyses (no media
-- paths, no result jsonb — just user_id/analysis_id/event/tier/timestamps), so
-- it cannot weaken enforcement anywhere: the RPCs below count server-side as
-- service_role under SECURITY DEFINER regardless of what this policy allows a
-- client to read. What it enables is the Home quota display staying truthful
-- once #57's hard-delete exists — reading analyses' live rows for a quota count
-- would go back to being gameable the same way #2 was; reading this ledger's
-- reserved/released events is not, since deleting the analyses row never
-- deletes the ledger events. (select auth.uid()) per the initplan-fix
-- precedent (20260711150600).
create policy "Users can view their own analysis usage"
  on public.analysis_usage for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- NO insert/update/delete policy for anyone. The absence is what makes the
-- ledger append-only — RLS default-denies any privilege with no policy
-- present. Mirroring the consents precedent's wording (20260712020729): do
-- not add one.

-- §5: grant hardening, following the 20260712030617 (consents) precedent
-- exactly. RLS alone is insufficient here for two reasons: TRUNCATE is a
-- table-level privilege that RLS policies never apply to at all (only the
-- grant is checked), and Supabase's default `grant all` hands anon/
-- authenticated every table privilege underneath whatever policy exists,
-- INSERT/UPDATE/DELETE included, none of which have a policy to authorize
-- them. Leaves `authenticated` with SELECT only on this table; `service_role`
-- keeps its default full grant (it needs it — the RPCs write as service_role
-- via SECURITY DEFINER, not as the ledger's own privilege, but service_role's
-- grant is left untouched here regardless). The anon SELECT revoke is
-- behavior-neutral by itself (RLS already denies anon, which has no JWT to
-- match user_id against) but removes privilege surface that has no reason to
-- exist under a policy anon can never satisfy.
revoke insert, update, delete, truncate on public.analysis_usage from authenticated, anon;
revoke select on public.analysis_usage from anon;

-- §6: backfill, BEFORE the RPC replacement so reserve_analysis never runs
-- against a partially-populated ledger. Parity-preserving: every analyses row
-- was 'reserved' at some point (status defaults to 'reserved' and it is the
-- only value reserve_analysis's insert ever writes), so every row gets a
-- 'reserved' backfill event; only status='released' rows also get a
-- 'released' event. That makes the OLD counting rule
--   used = count(status in ('reserved','delivered')) = n_total - n_released
-- equal the NEW rule
--   used = count(reserved events) - count(released events)
-- and the old anti-farm count(status='released') equal the new
-- count(released events) — the ledger starts in exact agreement with
-- whatever analyses already recorded. Timestamps are taken from the row,
-- never now(): reserved_at := a.created_at preserves period attribution (a
-- pro/elite reservation from two periods ago must stay attributed to that
-- period, not get dragged into the current one by a now()-stamped backfill).
-- Re-runnable via on-conflict do nothing, so a migration retry or a
-- future manual re-apply is a safe no-op. (Against this project's live
-- database today this inserts 0 rows — analyses is empty — but it must be
-- correct on `db reset` and on fresh branches, which is where it's actually
-- exercised.)
insert into public.analysis_usage (user_id, analysis_id, event, tier_at_run, reserved_at, created_at)
select a.user_id, a.id, 'reserved'::public.analysis_usage_event, a.tier_at_run, a.created_at, a.created_at
from public.analyses a
on conflict (analysis_id, event) do nothing;

insert into public.analysis_usage (user_id, analysis_id, event, tier_at_run, reserved_at, created_at)
select a.user_id, a.id, 'released'::public.analysis_usage_event, a.tier_at_run, a.created_at, coalesce(a.released_at, a.created_at)
from public.analyses a
where a.status = 'released'
on conflict (analysis_id, event) do nothing;

-- §7: reserve_analysis — same signature, same security definer, same pinned
-- search_path as 20260711150400. Every input validation, the advisory-lock
-- serialization, the (user_id, idempotency_key) idempotency short-circuit,
-- tier derivation from subscriptions, the v_limit/v_frame_cap case
-- statements, the frame-cap check, and the anti-farm >= 3 check's position
-- BEFORE the quota check are all preserved unchanged below. Only the
-- counting block changes: it now counts public.analysis_usage instead of
-- live public.analyses rows, which is the entire fix — the ledger has no
-- DELETE policy, so nothing a client does can make counted usage go back
-- down.
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
  v_reserved_count integer;
  v_released_count integer;
  v_active_count   integer;
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

  -- Serialize every reserve call for this user — see 20260711150400's header
  -- comment for why this is required, not merely defensive.
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
  -- from the caller. No row (or no active row) = free.
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

  -- Free is lifetime (count(analysis_usage) total, never per-period); pro/elite
  -- are purchase-day-anchored, month-end-clamped periods computed at read time
  -- via pace_current_period, windowed on the ledger's reserved_at (== the
  -- original reservation's created_at — see the table comment above for why
  -- that column, not the released event's own append time, is what's
  -- windowed). v_active_count = count(reserved) - count(released), floored at
  -- 0, replacing the old "count live analyses rows" arithmetic; see §6's
  -- backfill comment for the equivalence.
  if v_tier = 'free' then
    select count(*) filter (where event = 'reserved'),
           count(*) filter (where event = 'released')
      into v_reserved_count, v_released_count
      from public.analysis_usage
     where user_id = p_user_id;
  else
    v_window := public.pace_current_period(v_purchased_at, now());
    select count(*) filter (where event = 'reserved'),
           count(*) filter (where event = 'released')
      into v_reserved_count, v_released_count
      from public.analysis_usage
     where user_id = p_user_id and reserved_at <@ v_window;
  end if;
  v_active_count := greatest(v_reserved_count - v_released_count, 0);

  -- Anti-farming cap (docs/mvp-build-prompt.md gate #4): max 3 released
  -- reservations per window. A released reservation never counts against the
  -- quota limit above, but it does count here — otherwise prompt-injection
  -- farming (deliberately tripping validation) could burn unlimited Anthropic
  -- calls for free. This count now comes from the ledger too, so it survives
  -- the same client DELETE that used to reset it (the other half of #2).
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

  -- Append the 'reserved' ledger event in the same transaction as the
  -- analyses insert, sourcing reserved_at from the just-inserted row so it is
  -- byte-identical to analyses.created_at rather than a second now() call
  -- that could in principle disagree with it by a few microseconds.
  insert into public.analysis_usage (user_id, analysis_id, event, tier_at_run, reserved_at)
  select p_user_id, v_new_id, 'reserved', v_tier, a.created_at
  from public.analyses a where a.id = v_new_id
  on conflict (analysis_id, event) do nothing;

  return jsonb_build_object('allowed', true, 'existing', false, 'id', v_new_id, 'status', 'reserved', 'tier', v_tier);
exception
  when unique_violation then
    -- Belt-and-braces, as before — but now hardened against a corrupt-success
    -- misread. This handler used to assume ANY unique_violation here meant
    -- "the (user_id, idempotency_key) constraint on analyses fired, so the
    -- winning row must already exist" and unconditionally returned it. That
    -- was true when analyses.analyses_user_idempotency_key_unique was the
    -- only unique constraint reachable from this function body — but the
    -- ledger insert above added a second one
    -- (analysis_usage_analysis_event_unique), which cannot legitimately fire
    -- here (v_new_id is freshly minted by gen_random_uuid() a few lines
    -- above) but must not be silently reinterpreted as the analyses race if
    -- it somehow did. Re-fetch by the actual idempotency key; if that lookup
    -- comes back empty, the violation was NOT the analyses race after all —
    -- re-raise rather than fabricate an {allowed:true, existing:true, id:null}
    -- payload that would tell the caller a reservation succeeded when none
    -- exists.
    select * into v_existing
    from public.analyses
    where user_id = p_user_id and idempotency_key = p_idempotency_key;

    if not found then
      raise;
    end if;

    return jsonb_build_object(
      'allowed', true, 'existing', true, 'id', v_existing.id,
      'status', v_existing.status, 'tier', v_existing.tier_at_run,
      'result', v_existing.result, 'is_fallback', v_existing.is_fallback
    );
end;
$$;

-- Re-assert UNCONDITIONALLY, even though this is a CREATE OR REPLACE of an
-- already-hardened function. Cheap and idempotent, and it's the correct
-- posture for the general case: if this signature were ever dropped and
-- recreated fresh (rather than replaced) by some future migration, default
-- Postgres/PostgREST privileges would re-expose it to authenticated/anon
-- with no compile-time signal that anything was wrong. Restating the
-- revoke/grant here costs nothing and removes that failure mode entirely.
revoke execute on function public.reserve_analysis(uuid, text, public.media_type, integer, text[]) from public, anon, authenticated;
grant  execute on function public.reserve_analysis(uuid, text, public.media_type, integer, text[]) to service_role;

-- §8: release_analysis — same signature, same guards (status = 'reserved',
-- this user, this id). Widened to capture tier_at_run off the update so the
-- ledger insert below doesn't need a second lookup, and to source the
-- ledger row's reserved_at from the LEDGER's own immutable 'reserved' event
-- rather than analyses.created_at — self-contained period arithmetic that
-- stays correct even if analyses.created_at ever became writable by
-- something other than reserve_analysis's own insert.
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
  v_id   uuid;
  v_tier public.analysis_tier;
begin
  update public.analyses
     set status = 'released',
         released_at = now(),
         release_reason = p_reason
   where id = p_analysis_id and user_id = p_user_id and status = 'reserved'
  returning id, tier_at_run into v_id, v_tier;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_reserved_or_not_found');
  end if;

  -- Append the 'released' ledger event, reusing the SAME reserved_at that was
  -- stamped on this analysis's 'reserved' event, so both events for one
  -- analysis windowed identically regardless of which period `now()` falls
  -- in at release time. If the 'reserved' event is somehow absent (should
  -- never happen — reserve_analysis always inserts one before returning, and
  -- nothing else can reach 'reserved' status), this select simply inserts
  -- nothing; the analyses row is still released successfully. That's
  -- acceptable — a released reservation that goes uncounted only makes usage
  -- look lower than it is, never higher, so it can't cause an over-grant.
  insert into public.analysis_usage (user_id, analysis_id, event, tier_at_run, reserved_at)
  select p_user_id, v_id, 'released', v_tier, u.reserved_at
  from public.analysis_usage u
  where u.analysis_id = v_id and u.event = 'reserved'
  on conflict (analysis_id, event) do nothing;

  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'released');
end;
$$;

-- Re-assert unconditionally — same reasoning as reserve_analysis above.
revoke execute on function public.release_analysis(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.release_analysis(uuid, uuid, text) to service_role;

-- §9: settle_analysis (20260711150400) is intentionally NOT touched by this
-- migration. Delivered analyses consume quota exactly as reserved ones do —
-- the ledger is a quota ledger, not an outcome log, so settle_analysis has
-- nothing to append to it: the 'reserved' event from reserve_analysis
-- already covers a row all the way through to 'delivered'.

-- §10: kill client DELETE on analyses, and harden the ledger's cascade
-- chain. The dropped policy below was the entire reachable exploit for #2 —
-- everything else in this migration exists because this policy shouldn't
-- have let a client remove the evidence of quota usage. SELECT is
-- deliberately KEPT for authenticated on analyses (the Home quota display
-- and the future M6 Past Analyses both need to read it); only
-- INSERT/UPDATE/DELETE/TRUNCATE are revoked. TRUNCATE specifically matters
-- here even with the DELETE policy gone: it's a table privilege RLS never
-- governs, and the grant alone would let it wipe every user's quota record
-- in one statement. Deletion becomes exclusively
-- DELETE /functions/v1/analysis/:id (#57), which must purge the analyses row
-- and its Storage objects but must NOT touch analysis_usage.
drop policy "Users can delete their own analyses" on public.analyses;
revoke insert, update, delete, truncate on public.analyses from authenticated, anon;

-- Defense-in-depth for the ledger's cascade chain (analysis_usage.user_id ->
-- profiles(id) -> auth.users(id)). Both tables still carry the default `grant
-- all` for anon/authenticated; today RLS (no DELETE/INSERT/UPDATE policy on
-- either — see 20260711150000_profiles.sql and 20260711150100_subscriptions.sql)
-- is the ONLY barrier. If anyone later adds a self-serve delete policy to
-- profiles, that latent DELETE grant would let a user wipe their profiles row,
-- cascade-wipe their ledger, and reopen #2 through a different door. Close the
-- privilege now, matching the consents precedent (20260712030617) and this
-- project's "append-only by construction, not convention" philosophy.
-- subscriptions is included for the same reason (a stray policy there could
-- let a user self-grant elite). Verified against the live schema before
-- writing this: profiles rows are created solely by handle_new_user(), a
-- SECURITY DEFINER trigger on auth.users that runs as its definer regardless
-- of authenticated's own table grants, so revoking these from authenticated
-- does not touch signup; and no application code (app/(tabs)/index.tsx is the
-- only client-side reader of either table) ever writes to profiles or
-- subscriptions — both are read-only from the client today.
revoke insert, update, delete, truncate on public.profiles      from authenticated, anon;
revoke insert, update, delete, truncate on public.subscriptions from authenticated, anon;
