-- Backs `POST /functions/v1/purchase-tier` (issue #51), the ONLY legitimate writer to
-- public.subscriptions. The dummy purchase for v1: no real money moves, no IAP, no Stripe
-- (real IAP is Apple-gated and post-MVP — see docs/blocked-on-apple.md).
--
-- *** APPLIED to the live project — confirmed already present 2026-07-26 (issue #128). ***
-- Per issue #51's original hard constraint, the worktree that wrote this never ran
-- `supabase db push` / `apply_migration` against the live project; that constraint has since
-- been lifted and this function was found already applied when checked live via
-- `list_migrations`. See `docs/architecture.md`'s "Current — `POST /functions/v1/purchase-tier`"
-- section for the up-to-date deployment state.
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
--   created      — no row existed. INSERT, anchoring purchased_at := now(). The only path
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
--   rate_limited — row exists AND was updated less than 3 seconds ago. Returns the EXISTING
--                  tier/anchor/period unchanged — no INSERT, no UPDATE. See "RATE LIMITING" below.
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
--
-- ==========================================================================================
-- SECURITY HARDENING — 2026-07-13 audit on PR #123 (issue #51), addressed in this same file
-- ==========================================================================================
--
-- 1. DEPLOYMENT GATE LIVES IN THE EDGE FUNCTION, NOT HERE, AND THAT IS DELIBERATE.
--    The audit's HIGH finding: this endpoint is a $0 self-grant of the highest paid tier,
--    reachable by anyone on the internet, once deployed — sign up (open, unconfirmed signup),
--    call this endpoint with tier=elite, burn analyses until the live `ai_ops_config`
--    daily-spend cap trips, repeat with a fresh throwaway account. SQL has no concept of
--    "TestFlight build" vs "public App Store build" — both would hit the same database — so a
--    SQL-layer flag would be exactly as forgeable/misconfigurable as no flag at all. The only
--    place that can trustworthily gate "is dummy purchasing switched on for THIS deployment" is
--    the edge function itself, reading a server-side env var
--    (`PURCHASE_TIER_DUMMY_ENABLED`, default OFF) that is never present in production secrets.
--    See `supabase/functions/purchase-tier/index.ts`'s header for the full gate design
--    (fail-closed 404, checked before auth, plus an optional tester allowlist).
--
-- 2. p_as_of PARAMETER REMOVED — the anchor is always the real wall-clock `now()`.
--    The original signature took `p_as_of timestamptz default now()`, mirroring
--    `pace_quota_status`'s own optional `p_as_of` (there, harmless: that function is read-only).
--    Here it was a live footgun even though unreachable today (EXECUTE is service-role-only and
--    `purchaseTier()` in `_shared/purchase-tier.ts` never passes it): a future edge-function edit
--    that threaded a client-supplied timestamp through to this parameter would hand an attacker
--    exactly the re-anchoring exploit the "purchased_at IS THE PERIOD ANCHOR" section above spends
--    forty lines forbidding — set purchased_at to any past OR future instant of their choosing.
--    Removed entirely rather than guarded (`if p_as_of > now() then raise exception`), because a
--    removed parameter cannot be reintroduced by accident the way a guarded one can be loosened by
--    accident. `now()` is used directly everywhere the old parameter was.
--
-- 3. GRANT-LAYER HARDENING — subscriptions and profiles still carried Supabase's default
--    `grant all` to `anon`/`authenticated` (`DELETE, INSERT, REFERENCES, SELECT, TRIGGER,
--    TRUNCATE, UPDATE`), underneath RLS policies that only ever granted SELECT. No live exploit
--    exists today — RLS with no INSERT/UPDATE/DELETE policy default-denies those verbs — but two
--    reasons this belongs in THIS migration rather than being filed and deferred:
--      - TRUNCATE is a table-level privilege, not a row-level one. RLS does not apply to it at
--        all; only the grant is checked. This exact gap was already found and fixed twice in this
--        codebase — `consents` (`20260712030617_consents_grant_hardening.sql`) and the still-open
--        `storage.objects` case (issue #100, Known Issue #18) — and the payments table never got
--        the same pass.
--      - The whole point of "no INSERT/UPDATE policy" as a control is that it is one accidental
--        `create policy ... for insert on subscriptions` away from Echo V1's exact mistake, with
--        nothing underneath to catch it. Revoking the grant means even a careless future policy
--        addition alone would not be enough — the grant would still refuse the client.
--    Verified safe before writing the revoke below (not assumed):
--      - The only two writers of either table are `pace_purchase_tier` (this function) and
--        `handle_new_user()` (`20260711150000_profiles.sql`). Both are `security definer`, which
--        means Postgres checks table privileges against the FUNCTION OWNER for the duration of the
--        call, not against `authenticated`/`anon` — a revoke against those two roles cannot affect
--        either function regardless of who invokes them.
--      - `profiles.id references auth.users(id) on delete cascade`: the cascade delete Postgres
--        performs when an `auth.users` row is deleted (e.g. by a future `delete-account` function)
--        is enforced by Postgres's own internal referential-integrity trigger, which runs with
--        system-level privilege — not subject to the deleting session's own table grants. Also
--        unaffected.
--      - Grepped the client (`app/`, `lib/`) for the whole repo: the only reference to
--        `subscriptions` is a SELECT (`app/(tabs)/index.tsx`, the pre-#50 client-side quota read
--        `quota-status` is meant to replace); zero references to writing `profiles` anywhere.
--      - Grepped `reserve_analysis`/`settle_analysis`/`release_analysis`
--        (`20260711150400_quota_reserve_settle_release.sql`): they only SELECT from
--        `subscriptions` to derive tier, never write it.
--    Not revoking REFERENCES/TRIGGER — matches `consents`' own hardening exactly (see that
--    migration), which only ever revoked update/delete/truncate (plus a scoped insert), not the
--    full default set; PostgREST exposes no path to either privilege, and `anon`/`authenticated`
--    are `NOLOGIN` roles that cannot open a raw SQL session to use them directly either.
--
-- 4. BASIC PER-USER RATE LIMITING — added below as the `rate_limited` outcome: a second call for
--    the same user within 3 seconds of the last write returns the EXISTING state unchanged rather
--    than doing any work. Said plainly, because the audit asked for honesty here: this does NOT
--    mitigate the audit's actual amplification vector. That attack uses one throwaway account per
--    call — a per-user cooldown cannot rate-limit a campaign that never calls this function twice
--    with the same user. The real levers for that are #3 above (deployment gate, which closes the
--    whole vector when off) and signup throttling (CAPTCHA, already tracked as Known Issue #12,
--    blocked on Ian). This control's actual job is narrower: stopping a single compromised or
--    scripted account from hammering this endpoint in a tight loop, which the earlier
--    `pg_advisory_xact_lock` only serializes (guarantees correctness) without throttling (does
--    nothing to stop the same caller from immediately calling again). No new column needed — it
--    reads the existing `updated_at`, already bumped by the `subscriptions_updated_at` trigger on
--    every UPDATE.

create or replace function public.pace_purchase_tier(
  p_user_id uuid,
  p_tier    public.subscription_tier
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  v_prev_tier         public.subscription_tier;
  v_prev_status       public.subscription_status;
  v_prev_purchased_at timestamptz;
  v_prev_updated_at   timestamptz;
  v_tier              public.subscription_tier;
  v_purchased_at      timestamptz;
  v_outcome           text;
  v_window            tstzrange;
begin
  -- Serialize concurrent purchases for this user. Two racing first-time purchases would
  -- otherwise both fall into the INSERT branch and the loser would hit a PK unique violation.
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':tier_purchase'));

  select tier, status, purchased_at, updated_at
    into v_prev_tier, v_prev_status, v_prev_purchased_at, v_prev_updated_at
  from public.subscriptions
  where user_id = p_user_id
  for update;

  -- Basic per-user rate limit (see "SECURITY HARDENING" #4 in this file's header for exactly
  -- what this does and does not defend against). Only applies to a REPEAT call — a first-ever
  -- purchase always proceeds, since there is no prior `updated_at` to be "too soon" after. A
  -- deny is a normal, typed return value here, never an exception — same house style
  -- `gate_ai_call` uses for its own denies, so a missed error branch on the caller side can't
  -- accidentally let a mutation through.
  if found and (now() - v_prev_updated_at) < interval '3 seconds' then
    v_window := public.pace_current_period(v_prev_purchased_at, now());
    return jsonb_build_object(
      'tier',         v_prev_tier,
      'purchased_at', v_prev_purchased_at,
      'period_start', lower(v_window),
      'period_end',   upper(v_window),
      'outcome',      'rate_limited'
    );
  end if;

  if not found then
    -- The ONLY statement in this schema that ever writes purchased_at.
    insert into public.subscriptions (user_id, tier, purchased_at, status)
    values (p_user_id, p_tier, now(), 'active')
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
  v_window := public.pace_current_period(v_purchased_at, now());

  return jsonb_build_object(
    'tier',         v_tier,
    'purchased_at', v_purchased_at,
    'period_start', lower(v_window),
    'period_end',   upper(v_window),
    'outcome',      v_outcome
  );
end;
$$;

revoke execute on function public.pace_purchase_tier(uuid, public.subscription_tier) from public, anon, authenticated;
grant execute on function public.pace_purchase_tier(uuid, public.subscription_tier) to service_role;

-- Grant-layer hardening (SECURITY HARDENING #3 above) — closes the same class of gap
-- `20260712030617_consents_grant_hardening.sql` closed for `consents`, for the two tables that
-- gap was never applied to: the payments table itself, and its FK target. Neither table has any
-- legitimate authenticated/anon writer (see the evidence in #3 above) — RLS already denied
-- INSERT/UPDATE/DELETE with no policy present; this removes the underlying privilege too, and
-- additionally revokes TRUNCATE, which RLS cannot restrict at all.
revoke insert, update, delete, truncate on public.subscriptions from authenticated, anon;
revoke insert, update, delete, truncate on public.profiles      from authenticated, anon;
