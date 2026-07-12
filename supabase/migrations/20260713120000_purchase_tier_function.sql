-- Backs `POST /functions/v1/purchase-tier` (issue #51), the ONLY legitimate writer to
-- public.subscriptions. The dummy purchase for v1: no real money moves, no IAP, no Stripe
-- (real IAP is Apple-gated and post-MVP — see docs/blocked-on-apple.md).
--
-- *** THIS MIGRATION IS WRITTEN, NOT APPLIED. ***
-- Per issue #51's hard constraint, this worktree never runs `supabase db push` /
-- `apply_migration` against the live project and never deploys the edge function that calls
-- this. Until a later, explicitly-authorized step applies it, calling `pace_purchase_tier`
-- from `supabase/functions/purchase-tier/` will fail against production — the same footing
-- #57's `DELETE /functions/v1/analysis/:id` and #50's `pace_quota_status` already ship on
-- (built + Deno-tested, not deployed). Check `list_migrations` against the live project
-- before trusting this function is callable.
--
-- ==========================================================================================
-- WHY THIS IS A SERVICE-ROLE RPC AND NOT A CLIENT WRITE — READ BEFORE EDITING
-- ==========================================================================================
-- `20260711150100_subscriptions.sql` deliberately created public.subscriptions with a SELECT
-- policy and NO insert/update/delete policy for authenticated/anon, and said why, in a comment
-- worth repeating because it is a scar and not documentation:
--
--   "A client-writable INSERT/UPDATE policy here would let any authenticated user self-grant
--    elite tier for free with a single REST call — see Echo V1's schema.sql, which shipped and
--    then removed exactly that policy for exactly that reason. Do not add one; route tier
--    writes through a service-role edge function instead."
--
-- THIS FUNCTION IS THAT ROUTE. It therefore adds NO policy and NO grant to authenticated/anon
-- on public.subscriptions — it deliberately contains no `create policy` statement at all, and
-- `__tests__/purchase-tier.deno.test.ts` asserts on this file's text that it never grows one.
-- The tier write happens here, as SECURITY DEFINER, reachable only by a caller holding the
-- service-role key (i.e. an edge function), whose EXECUTE grant is the last line of this file.
--
-- ==========================================================================================
-- purchased_at IS THE PERIOD ANCHOR, AND IT IS SET EXACTLY ONCE — THE WHOLE JOB
-- ==========================================================================================
-- There is no stored period_start/period_end and no rollover cron, by design: quota periods
-- are DERIVED at read time from the single column subscriptions.purchased_at, via
-- public.pace_current_period (20260711150300_quota_period_helpers.sql).
--
-- That makes purchased_at load-bearing in a way that is easy to get catastrophically wrong.
-- `reserve_analysis` and `pace_quota_status` both count a paid user's usage as:
--
--     count(*) from analyses
--     where status in ('reserved','delivered')
--       and created_at <@ pace_current_period(purchased_at, now())
--
-- The window is derived FROM purchased_at. So moving purchased_at MOVES THE WINDOW, and every
-- analysis created before the new anchor falls outside it — silently resetting `used` to 0.
--
-- If this function re-anchored purchased_at := now() on every call, then any user who had
-- exhausted their quota could POST /purchase-tier again and get a brand-new period with a
-- clean usage count. Because the v1 payment is a DUMMY (this endpoint costs the caller
-- nothing and is unlimited), that is not a billing quirk — it is an unlimited free-analysis
-- exploit, reachable by replaying one request. The identical hole would open via
-- pro -> elite -> pro tier flapping if a tier change re-anchored.
--
-- THE RULE, ENFORCED BELOW: purchased_at is written ONLY by the INSERT (first purchase ever).
-- It is deliberately ABSENT from the UPDATE path's SET list, so no repurchase, tier change, or
-- reactivation can ever move it. A repurchase is therefore idempotent with respect to
-- everything that governs quota: same anchor -> same period -> same used count.
--
-- Consequence, accepted deliberately: a user who first bought on Jan 31 keeps a Jan-31-anchored
-- period forever, even across a cancel and a later repurchase. That is harmless — pace_current_period
-- derives the period CONTAINING now() from any anchor however old, so a long-lapsed user simply
-- lands in a current window with a fresh (correctly-zero) usage count without the anchor moving.
-- When real receipt verification replaces `source: "dummy"`, the store owns the true renewal
-- date and this anchoring policy should be revisited THERE, consciously — not loosened here.
--
-- ==========================================================================================
-- OUTCOMES
-- ==========================================================================================
--   created      — no row existed. INSERT, anchoring purchased_at := p_as_of. The only path
--                  that ever writes purchased_at.
--   unchanged    — row exists, same tier, already active. A true no-op for tier/anchor/status
--                  (updated_at does bump via the subscriptions_updated_at trigger; nothing that
--                  governs quota, period, or tier changes). This is the repurchase case.
--   tier_changed — row exists, different tier (upgrade or downgrade). `tier` is swapped and
--                  status forced back to 'active'; the anchor is preserved. An upgrade mid-period
--                  therefore raises the limit within the SAME window (Pro 10 -> Elite 30 hands the
--                  user the difference immediately); a downgrade lowers it, and a user already
--                  past the lower limit simply has remaining = 0 (max(limit - used, 0)) until the
--                  period rolls. Neither direction resets `used`, which is what makes tier
--                  flapping worthless as an exploit.
--   reactivated  — row exists, same tier, status was 'canceled'. status -> 'active', anchor
--                  preserved. (Nothing in v1 writes 'canceled' — there is no cancel endpoint yet —
--                  but the column exists and `pace_quota_status`/`reserve_analysis` both read
--                  `status = 'active'`, so this path is handled explicitly rather than left to
--                  chance for whoever adds one.)
--
-- NOTE ON TIER VALIDATION: p_tier is typed `public.subscription_tier`, an enum of ('pro','elite')
-- ONLY. 'free' is intentionally not a member — free is the ABSENCE of a subscriptions row, never a
-- row with tier='free' (see the subscriptions table comment). So an attempt to "purchase free"
-- cannot even be represented here: it fails as an invalid enum input at the PostgREST boundary
-- before this body runs. The edge function validates the tier itself and returns a clean 400
-- rather than letting that surface as a 500 — but the enum is the backstop that means a bypassed
-- validator still cannot persist a bogus tier. Downgrading to free (i.e. deleting the row) is NOT
-- this endpoint's job and is deliberately not implemented: it would destroy the anchor, which is
-- exactly the reset this function exists to prevent.
--
-- SECURITY/SHAPE: same as the rest of the quota RPC family (reserve_analysis, settle_analysis,
-- release_analysis, pace_quota_status) — SECURITY DEFINER, pinned search_path, EXECUTE revoked
-- from public/anon/authenticated and granted only to service_role, and a per-user
-- pg_advisory_xact_lock so two concurrent purchases for the same user serialize (without it, two
-- racing first-purchases would both see "no row" and the loser would take a PK unique violation).
-- The lock key mirrors reserve_analysis's own `hashtext(p_user_id::text || ':analysis_reserve')`
-- idiom with this function's own suffix, so it never contends with the reserve path.
-- VOLATILE (it writes) — contrast pace_quota_status, which is STABLE.

create or replace function public.pace_purchase_tier(
  p_user_id uuid,
  p_tier    public.subscription_tier,
  p_as_of   timestamptz default now()
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_prev_tier      public.subscription_tier;
  v_prev_status    public.subscription_status;
  v_tier           public.subscription_tier;
  v_purchased_at   timestamptz;
  v_outcome        text;
  v_window         tstzrange;
begin
  -- Serialize concurrent purchases for this user. Two racing first-time purchases would
  -- otherwise both fall into the INSERT branch and the loser would hit a PK unique violation.
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':tier_purchase'));

  select tier, status
    into v_prev_tier, v_prev_status
  from public.subscriptions
  where user_id = p_user_id
  for update;

  if not found then
    -- The ONLY statement in this schema that ever writes purchased_at.
    insert into public.subscriptions (user_id, tier, purchased_at, status)
    values (p_user_id, p_tier, p_as_of, 'active')
    returning tier, purchased_at into v_tier, v_purchased_at;

    v_outcome := 'created';
  else
    update public.subscriptions
    set tier   = p_tier,
        status = 'active'
        -- purchased_at is DELIBERATELY ABSENT from this SET list. Adding it here would let a
        -- quota-exhausted user mint a fresh period (and a zeroed usage count) by replaying this
        -- free, unlimited dummy purchase. See this file's header. Do not add it.
    where user_id = p_user_id
    returning tier, purchased_at into v_tier, v_purchased_at;

    v_outcome := case
      when v_prev_tier is distinct from p_tier   then 'tier_changed'
      when v_prev_status is distinct from 'active' then 'reactivated'
      else 'unchanged'
    end;
  end if;

  -- The period is derived — never stored. Same function reserve_analysis and pace_quota_status
  -- call, so the boundaries this endpoint reports can never drift from the ones enforcement uses.
  v_window := public.pace_current_period(v_purchased_at, p_as_of);

  return jsonb_build_object(
    'tier',         v_tier,
    'purchased_at', v_purchased_at,
    'period_start', lower(v_window),
    'period_end',   upper(v_window),
    'outcome',      v_outcome
  );
end;
$$;

revoke execute on function public.pace_purchase_tier(uuid, public.subscription_tier, timestamptz) from public, anon, authenticated;
grant execute on function public.pace_purchase_tier(uuid, public.subscription_tier, timestamptz) to service_role;
