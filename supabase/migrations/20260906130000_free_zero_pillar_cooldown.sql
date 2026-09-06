-- Review ruling r5-4 (fm/v23-free-tier-real-analysis): Free follows the SAME no-charge-on-zero-
-- pillars policy as Pro/Elite, and the free-form-checking-loop worry that a Free-specific charge
-- used to answer is answered by FREQUENCY instead.
--
-- WHAT THE OLD CARVE-OUT DID. `analyze-form/flow.ts` settled (charged) a zero-pillar result on
-- free, while releasing it uncharged on pro/elite, and attributed that split to
-- `20260819120000_zero_pillar_release_reason.sql` (cd8bf97, PR #194, 2026-08-19). That attribution
-- was wrong: cd8bf97 is a blanket policy with no tier exception. Charging a runner their ONE
-- lifetime analysis for a result that carried nothing is also the harshest available reading of a
-- submission we could not read — the failure is usually framing or lighting, not intent.
--
-- WHAT REPLACES IT. A cooldown, bounding how OFTEN a free account may resubmit after a zero-pillar
-- result rather than how many times ever. 15 minutes (`FREE_ZERO_PILLAR_COOLDOWN_SECONDS` in
-- flow.ts, which owns the number — this function takes it as an argument and holds no policy of
-- its own): long enough that a scripted loop is capped at four model calls an hour per account,
-- short enough that the honest fix (film again, side-on, in better light) is never blocked by it.
-- Deliberately far shorter than the 24h anti-farm window of
-- 20260712220000_anti_farm_release_reason_fix.sql — this is not an abuse finding and must not read
-- like one.
--
-- NO NEW COUNTER, NO NEW SCHEMA. The lookup below is read-only over rows `release_analysis`
-- already writes. There is no cooldown table, no column, and no state that can drift from the
-- ledger: the cooldown IS the ledger, read back.
--
-- ---------------------------------------------------------------------------------------------
-- 1. The lookup.
-- ---------------------------------------------------------------------------------------------

create or replace function public.pace_zero_pillar_cooldown_remaining(
  p_user_id uuid,
  p_cooldown_seconds integer
)
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
            (max(released_at) + make_interval(secs => greatest(p_cooldown_seconds, 0))) - now()
        )
      )
    ),
    0
  )::integer
  from public.analyses
  where user_id = p_user_id
    and status = 'released'
    and release_reason = 'zero_pillars_assessed'
    and released_at is not null
    and released_at > now() - make_interval(secs => greatest(p_cooldown_seconds, 0));
$$;

-- Same posture as every other RPC in this family: service_role only, called from the edge function
-- under the service key. `authenticated` gets nothing — a client that could read this could not do
-- anything with it that `quota_status` does not already tell it honestly, and a client is never
-- the authority for a server-side throttle.
revoke all on function public.pace_zero_pillar_cooldown_remaining(uuid, integer) from public;
revoke all on function public.pace_zero_pillar_cooldown_remaining(uuid, integer) from anon;
revoke all on function public.pace_zero_pillar_cooldown_remaining(uuid, integer) from authenticated;
grant execute on function public.pace_zero_pillar_cooldown_remaining(uuid, integer) to service_role;

comment on function public.pace_zero_pillar_cooldown_remaining(uuid, integer) is
  'Seconds a user must still wait after their most recent zero_pillars_assessed release before '
  'analyze-form accepts another submission (free tier only; the caller owns the interval). '
  'Read-only over public.analyses — no counter, no new state.';

-- ---------------------------------------------------------------------------------------------
-- 2. The release reason the cooldown writes.
--
-- Superset-only, same drop-and-recreate idiom as 20260713130000, 20260819120000 and
-- 20260906120000: one constraint, one name, one place the taxonomy is spelled. `pace_is_farming_
-- signal` (20260712220000) is NOT touched and needs no change — it returns false for every reason
-- string it has not been taught, so a new value is non-farming by construction.
--
-- DEPLOY ORDER IS SELF-GATING HERE. `analyze-form` only writes 'zero_pillar_cooldown' when the
-- function above returned a positive number, and it treats a missing/erroring function as "no
-- cooldown" (fail open). So a function deployed ahead of this migration simply does not throttle;
-- it cannot write a reason this constraint would reject.
-- ---------------------------------------------------------------------------------------------

alter table public.analyses
  drop constraint analyses_release_reason_known_values;

alter table public.analyses
  add constraint analyses_release_reason_known_values
  check (
    release_reason is null
    or release_reason in (
      'model_error',            -- server-fault: the Anthropic call itself errored
      'provider_timeout',       -- server-fault: the Anthropic call timed out
      'internal_error',         -- server-fault: our own code raised before/after the model call
      'validation_failed',      -- farming signal: response failed structural validation after
                                 -- retry — the only value pace_is_farming_signal() ever returns
                                 -- true for
      'stale_sweep',            -- server-fault (issue #47): the reservation was never settled or
                                 -- released by its own analyze-form invocation, which was killed
                                 -- before it could reach any of its own release paths
      'zero_pillars_assessed',  -- cd8bf97 / PR #194: the response validated in full, but every
                                 -- pillar was honestly not-assessed — nothing useful was
                                 -- delivered, so the quota slot is refunded rather than charged,
                                 -- on EVERY tier. Deliberately not a farming signal: an honest
                                 -- "nothing to see here" is not an attack.
      'invalid_safety',         -- our-fault (review r4-4): a present pillar's certified `safety`
                                 -- declaration was absent, malformed, ungrounded, or a declared
                                 -- signal with a blank note, so the response failed closed. OUR
                                 -- added requirement not being met, not user abuse.
      'zero_pillar_cooldown'    -- review r5-4: a free resubmission arrived inside the cooldown
                                 -- window above, so it was refused BEFORE any model call and its
                                 -- reservation handed straight back. Being early is not abuse,
                                 -- and a throttled request must never spend the one lifetime slot.
    )
  );
