-- Fixes issue #6 (HIGH, live in production): the free tier's 3-failed-attempt
-- anti-farming cap never resets, and never distinguished OUR fault from
-- THEIRS, or a CONFIRMED-ABUSE signal from a merely-inconclusive one.
--
-- NOTE ON THIS FILE'S HISTORY: this migration was written once, reviewed
-- before being applied anywhere (it never reached the live project), and
-- revised in place based on that review — see "WINDOWING — REVISED after
-- review" below for exactly what changed and why. It was never split into a
-- second migration because it was never applied or shared outside this
-- branch; there is nothing to layer on top of.
--
-- ROOT CAUSE, verified against the live `reserve_analysis` definition
-- (pg_get_functiondef, project vputdomdlknvthnzritt) before writing this
-- migration, not just the migration file text: both the free branch and the
-- pro/elite branch derive `v_released_count` from `count(*) where status =
-- 'released'` (free: no window at all; pro/elite: windowed by
-- `created_at <@ v_window`), with `>= 3` refusing further reserves as
-- `too_many_failed_attempts`. Neither branch looks at WHY a row was
-- released. `release_analysis` records a `release_reason` on every release
-- (20260711150200_analyses.sql's own header: "e.g. 'validation_failed',
-- 'model_error' — observability only, not read by any check") but nothing
-- ever read it. So a model timeout, an Anthropic 500, or any other
-- infrastructure failure counts identically to a deliberate prompt-injection
-- farming attempt. For Free — a LIFETIME cap, never rolling over — three bad
-- days at Anthropic permanently brick a free account that never received a
-- single result, with no in-app or admin recovery path (M6 delete does not
-- refund quota or the anti-farm count either, by design).
--
-- FIX: classify `release_reason`, not the mere fact of a release.
--
-- `release_reason` already exists for exactly this distinction (per its own
-- column comment); this migration pins it down instead of inventing a
-- parallel mechanism, per the issue's own "Fix direction". Two steps:
--
--   1. A CHECK constraint restricts `release_reason` to a known, closed set
--      — safe to add now (not a breaking change to any caller) because
--      `release_analysis` has ZERO live callers today: `analyze-form` (#44)
--      has not been built yet (verified: `supabase/functions/` has no
--      top-level function, only `_shared/`), and the live `analyses` table
--      has 0 rows (verified live: 2 profiles, 0 analyses — grep of the repo
--      also finds no application code calling `release_analysis` anywhere
--      outside migrations/tests). This is the first and only point in the
--      project's history where the taxonomy can be pinned down for free.
--        - server-fault (OUR fault; excluded from the anti-farm count):
--          'model_error', 'provider_timeout', 'internal_error'
--        - farming signal (THEIR fault; still counted): 'validation_failed'
--          — the actual prompt-injection/deliberate-junk vector the cap
--          exists to stop, per the issue's own framing.
--      NULL (no reason given) is also allowed and, like an unrecognized-but-
--      permitted value can never be inserted past the CHECK, is treated as
--      NOT a farming signal by the classifier below — the safe default: an
--      unclassified release must never silently re-brick a user the way the
--      unconditional count did. Whoever builds #44 (`ai-feature-builder`)
--      MUST call `release_analysis` with one of the four reasons above on
--      every failure path for the cap to have any teeth at all — this is
--      the same obligation `docs/architecture.md`'s "release_analysis...
--      Known Issue #14" note already places on that work, just extended to
--      cover the specific string.
--
--   2. `public.pace_is_farming_signal(release_reason text)` — a tiny,
--      standalone, IMMUTABLE classifier, deliberately NOT inlined into
--      `reserve_analysis`'s body. This is the load-bearing design choice:
--      `reserve_analysis` is `create or replace`, and this repo has already
--      been bitten once by two migrations both rewriting that function and
--      one silently erasing the other's body (the exact hazard #88's and
--      #2's header comments both flag at length). Pulling the
--      reason-classification rule OUT of `reserve_analysis` and into its own
--      one-line function means a FUTURE change to the taxonomy (e.g. adding
--      a new farming-signal reason) only ever needs a `create or replace` of
--      this tiny function — never touching `reserve_analysis`'s body again,
--      never risking that collision a second time.
--
-- reserve_analysis is rewritten starting from the CURRENT LIVE 4-arg
-- definition (issue #88's signature: p_user_id, p_idempotency_key,
-- p_media_type, p_frame_count — p_media_paths already dropped), fetched via
-- `pg_get_functiondef` against the live project immediately before writing
-- this file and diffed by hand against
-- 20260712123606_frame_upload_ordering.sql, which is byte-for-byte
-- identical to what is live. ONLY the two `v_released_count` queries change
-- (add `and public.pace_is_farming_signal(release_reason)`); every other
-- line — the three validation checks, the advisory lock, the idempotency
-- lookup, tier derivation, `v_limit`/`v_frame_cap`, the frame-cap check, the
-- quota check, the insert (still 4-column, no media_paths — #88's fix is
-- untouched), the return shapes, and the exception handler — is preserved
-- verbatim. `settle_analysis` and `release_analysis` themselves are NOT
-- touched by this migration (matching the precedent #88 set for
-- `release_analysis` and #2 set for leaving `reserve_analysis`'s
-- soft-delete-compatible counting alone): the fix lives entirely in the new
-- CHECK constraint, the new classifier function, and the two query filters.
--
-- WINDOWING — REVISED after review (Ian + coordinator, same day). The first
-- version of this migration excluded server-fault reasons but left free's
-- cap LIFETIME-scoped on the theory that, once server-fault releases are
-- excluded, what remains (`validation_failed`) is pure confirmed abuse and a
-- lifetime cap on confirmed abuse is fine. That reasoning was wrong, and it
-- reopened a narrower version of the exact bug this issue exists to close:
--
--   * `validation_failed` fires whenever the model's structured output fails
--     shape validation after one retry (`docs/architecture.md`'s "Planned —
--     analyze-form" step 9 / `docs/mvp-build-prompt.md`'s gate #4). That
--     happens on real prompt-injection abuse, but it ALSO happens on an odd
--     camera angle, poor lighting, an unusual clip, or a genuinely hard
--     case — none of which is the user's fault. It is an OUTCOME label
--     ("we couldn't produce a valid result"), not an INTENT label ("this
--     user is attacking us"), and #45 (the retry-once + honest-partial
--     fallback that would at least reduce, though not eliminate, honest
--     false positives) does not exist yet — there is currently no code path
--     that distinguishes "the user attacked us" from "we and the model had
--     a bad day."
--   * A release never burns quota (it hands the reservation back — see
--     `release_analysis`'s own header). So a free user can legitimately
--     cycle reserve → fail → release, over and over, without ever spending
--     their one lifetime analysis. Three genuinely confusing videos in a
--     row — plausible for a first-time user who has never seen what "good"
--     output looks like — permanently locked them out under the lifetime
--     design, having never once received the single result they signed up
--     for. No reset, no recovery, no explanation. That is the same shape of
--     harm as the original bug, just triggered by hard inputs instead of
--     Anthropic outages.
--
-- THE INVARIANT this design must satisfy: a user who has never successfully
-- received an analysis must never be PERMANENTLY unable to obtain one.
-- Anti-farming may throttle, delay, or rate-limit; it must not permanently
-- deny a first-time user their first result with no recovery path. A
-- lifetime cap on `validation_failed` cannot satisfy this — nothing about
-- that signal proves intent, so any lifetime consequence attached to it is
-- a lifetime consequence attached to bad luck as much as bad faith.
--
-- FIX: free's anti-farm count is now windowed, matching what the ORIGINAL
-- SPEC already said before the first implementation (20260711150400)
-- conflated it with the lifetime quota — `planning/02-product-requirements.
-- md:64`, `planning/03-engineering-requirements.md:81`, and `docs/
-- mvp-build-prompt.md:223` all say "capped at 3 free retries PER PERIOD
-- against prompt-injection farming", never "lifetime". This migration is
-- not inventing new behavior; it is finally implementing that line.
--
-- Window chosen: a rolling 24 hours, measured from `released_at` (`released_at
-- > now() - interval '24 hours'`), not a calendar-day or a purchase-anchored
-- period like pro/elite's — free has no subscription row to anchor a period
-- to, and a true rolling window (vs. midnight-anchored) can't be gamed by
-- timing a release just before a reset. 24h was picked over shorter/longer
-- alternatives for two reasons: (1) it matches the product's own "try again"
-- mental model — a legitimate user who got 3 confusing failures can
-- reasonably retry the same or next day with a better angle/lighting, which
-- a 7-day or period-length window would not offer; (2) it still meaningfully
-- throttles a scripted farmer (3 real Anthropic calls/day/account, not
-- unlimited), and the marginal cost of that residual trickle is bounded by
-- #91's account-independent guardrails (kill switch, circuit breaker, daily
-- $ cap) — this cap was never the sole defense against runaway spend, #91 is.
-- A 1-hour window was rejected as too weak a deterrent against automation
-- that doesn't mind waiting; a 7-day/period-length window was rejected as
-- indefensible against the invariant above — a full week is a long time to
-- lock a first-time user out of the one thing the app does.
--
-- Pro/elite's branch is NOT further changed here beyond the reason filter
-- already added: its existing per-period window (`pace_current_period`,
-- purchase-anchored, ~1 calendar month) already satisfies the invariant —
-- a paying user recovers every period regardless of `release_reason`, so
-- there is no permanent-lockout bug on that branch to begin with. It is not
-- shrunk to 24h because it was never reported broken and its window length
-- already matches how that tier's own quota behaves (same period, same
-- anchor) — changing it is a product decision (is a month too long for a
-- paying user to wait after 3 failures?) outside this bug's scope, worth
-- raising separately if it becomes a real complaint.
--
-- ANTI-FARMING PRESERVED. This migration does not delete or weaken the cap,
-- only correctly scopes it: 3 confirmed `validation_failed` releases within
-- 24h (free) or within the current period (pro/elite) still returns
-- `too_many_failed_attempts`, same threshold as before. A scripted farmer
-- is throttled to a small daily/periodic trickle, not stopped outright by
-- this RPC alone — but it never was outright-stopped here; #91's spend
-- guardrails (kill switch / circuit breaker / daily $ cap, ahead of
-- `reserve_analysis` in the eventual #44 call order) and #2's soft-delete
-- fix (a client can no longer un-count a release by deleting the row) are
-- the other two fronts, both untouched and both account-independent, so a
-- farmer running one or many accounts still hits a real ceiling. A
-- legitimate user, meanwhile, is now guaranteed to recover — throttled, per
-- the invariant, never permanently denied.
--
-- BACKFILL / REPAIR OF ALREADY-BRICKED USERS: verified live, explicitly, not
-- assumed — `select count(*) from public.analyses` = 0 and
-- `select count(*) from public.profiles` = 2, and of those 0 analyses rows,
-- 0 carry a non-null `release_reason`. There is no user in production today
-- who has ever been released, let alone bricked. This migration therefore
-- ships NO data backfill/repair statement — there is nothing to repair. Any
-- future release row created before this migration would have a NULL
-- `release_reason` (the only kind of row that could possibly predate this
-- fix), which the classifier below already treats as "not a farming
-- signal", so even a hypothetical pre-existing released row would
-- automatically stop counting against the cap the moment this migration
-- applies — no manual UPDATE required either way.

-- ---------------------------------------------------------------------------
-- 1. Pin down release_reason to a known, closed vocabulary.
-- ---------------------------------------------------------------------------
-- NOT VALID is unnecessary (and would be misleading) here: the table has 0
-- rows live, so a full validating ADD CONSTRAINT is instant and free, and
-- leaves no unvalidated window.

alter table public.analyses
  add constraint analyses_release_reason_known_values
  check (
    release_reason is null
    or release_reason in (
      'model_error',       -- server-fault: the Anthropic call itself errored
      'provider_timeout',  -- server-fault: the Anthropic call timed out
      'internal_error',    -- server-fault: our own code raised before/after
                            -- the model call (not Anthropic's fault, still
                            -- not the user's)
      'validation_failed'  -- farming signal: response failed structural
                            -- validation after retry — the actual
                            -- prompt-injection / deliberate-junk vector this
                            -- cap exists to stop (see pace.ts's
                            -- PACE_MIN_ASSESSED_PILLARS_FOR_PARTIAL comment
                            -- for where this reason is decided)
    )
  );

-- ---------------------------------------------------------------------------
-- 2. The classifier — the only place the taxonomy's meaning lives.
-- ---------------------------------------------------------------------------
-- Deliberately its own function, not inlined into reserve_analysis — see the
-- header comment above for why. IMMUTABLE + plain SQL: pure function of its
-- one input, no table access, safe to use inside a WHERE clause on every
-- reserve_analysis call. Returns a real boolean, never NULL, even for NULL
-- input (`coalesce`) — a caller of this function must never have to
-- special-case NULL again.

create or replace function public.pace_is_farming_signal(p_release_reason text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_release_reason in ('validation_failed'), false);
$$;

revoke execute on function public.pace_is_farming_signal(text) from public, anon, authenticated;
grant execute on function public.pace_is_farming_signal(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. reserve_analysis — same 4-arg signature as #88 (no drop needed, no
--    overload risk), rewritten from the CURRENT LIVE body. Only the two
--    v_released_count queries change.
-- ---------------------------------------------------------------------------

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

  -- Free's QUOTA is lifetime (count(analyses) total, never per-period) —
  -- that part is unchanged and correct, per planning/03's "Quota-period
  -- arithmetic". Free's ANTI-FARM COUNT is a different scope: a rolling 24h
  -- window (see this migration's header, "WINDOWING") — the original spec
  -- always said "3 free retries per period", distinct from the lifetime
  -- quota; the first cut of this fix conflated the two, this one does not.
  -- Pro/elite use purchase-day-anchored, month-end-clamped periods computed
  -- at read time via pace_current_period for BOTH counts.
  if v_tier = 'free' then
    select count(*) into v_active_count
    from public.analyses
    where user_id = p_user_id and status in ('reserved', 'delivered');

    -- issue #6 fix: only a confirmed farming signal counts, AND only within
    -- the last rolling 24h — a model outage or any other server-fault
    -- release is excluded regardless of when it happened, and even a
    -- confirmed validation_failed release ages out after 24h, so a
    -- legitimate user who hit 3 confusing failures always recovers on
    -- their own and is never permanently denied their first analysis.
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

    -- issue #6 fix: same reason filter as the free branch, applied within
    -- the existing per-period window — a paying user's period budget is no
    -- more entitled to be burned by our infrastructure than a free user's
    -- lifetime budget is.
    select count(*) into v_released_count
    from public.analyses
    where user_id = p_user_id and status = 'released'
      and created_at <@ v_window
      and public.pace_is_farming_signal(release_reason);
  end if;

  -- Anti-farming cap (docs/mvp-build-prompt.md gate #4: "3 free retries per
  -- period"): max 3 CONFIRMED farming-signal releases (see
  -- public.pace_is_farming_signal) within the window — free: rolling 24h;
  -- pro/elite: the current purchase-anchored period. A released reservation
  -- never counts against the quota limit above, but a genuine, RECENT
  -- farming signal does count here — otherwise prompt-injection farming
  -- (deliberately tripping validation) could burn unlimited Anthropic calls
  -- for free, since failures/fallbacks don't cost quota. A release caused by
  -- OUR infrastructure (model timeout, provider error, our own bug) is
  -- excluded from this count by construction, and even a confirmed farming
  -- signal ages out of the window — see this migration's header ("WINDOWING")
  -- for why both are required to satisfy #6's invariant: a user who has
  -- never received a result must never be PERMANENTLY denied one.
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
