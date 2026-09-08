-- Review ruling r4-4 (fm/v23-free-tier-real-analysis): a request that fails because of OUR OWN new
-- per-pillar `safety` contract must not be charged to the user, and must not be reported with a
-- reason that means "the user is farming". Before this migration `analyze-form` released those with
-- 'model_error' — non-farming, and therefore already safe on the abuse axis, but wrong on the
-- ledger axis: it blamed the Anthropic call for a response the call returned perfectly well, and
-- which only our own added requirement rejected. This migration gives that path its own reason.
--
-- WHY NO CHANGE TO pace_is_farming_signal. `public.pace_is_farming_signal`
-- (20260712220000_anti_farm_release_reason_fix.sql) is the sole classifier `reserve_analysis`'s
-- 3-strike cap reads, and it treats any reason string it has never seen as "not a farming signal"
-- by construction (`coalesce(p_release_reason in ('validation_failed'), false)`). Both
-- 20260713130000_stale_reservation_sweep.sql ('stale_sweep') and
-- 20260819120000_zero_pillar_release_reason.sql ('zero_pillars_assessed') added a reason on exactly
-- that property. This migration relies on the identical property: extending the CHECK vocabulary
-- below is sufficient on its own, and 20260712220000 is not touched.
--
-- Superset-only: every previously-valid value stays valid. Drop-and-recreate rather than a second
-- named constraint, so there remains exactly one constraint and one place the taxonomy is spelled.

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
      'zero_pillars_assessed',  -- captain decision (audit-v23-r1-decision-zero-pillar-charge-
                                 -- policy): the response validated in full, but every pillar was
                                 -- honestly not-assessed — nothing useful was delivered, so the
                                 -- quota slot is refunded rather than charged. Deliberately NOT in
                                 -- pace_is_farming_signal's vocabulary — an honest "nothing to see
                                 -- here" is not abuse.
      'invalid_safety'          -- our-fault (review r4-4): a present pillar's certified `safety`
                                 -- declaration was absent, malformed, ungrounded, or a declared
                                 -- signal with a blank note, so the response failed closed. That is
                                 -- OUR added requirement not being met, not user abuse, and is
                                 -- likewise absent from pace_is_farming_signal's vocabulary.
    )
  );
