-- Captain decision audit-v23-r1-decision-zero-pillar-charge-policy: do NOT charge Pro/Elite quota
-- for a structurally VALID analysis result in which every one of the four pillars came back
-- honestly not-assessed (`score: null`). The user got nothing useful; charging their quota slot
-- for it is the bug this migration's companion `flow.ts` change closes.
--
-- WHY THIS IS A NEW release_reason, NOT A settle_analysis CHANGE. `pace.ts`'s own
-- `isPaceAnalysisOutcome` doc comment already names the exact case this migration exists for: "a
-- response in which the model *validly* reports all four pillars as not-assessed... validates, so
-- it never reaches [decideOutcome], and it is delivered as a real result." That response
-- structurally passes `isPaceResult` on the FIRST attempt — `decideOutcome` returns `kind:
-- 'valid'` and never even evaluates the `>= 1 assessed pillar` bar that already guards the
-- 'partial'/salvage branch (`PACE_MIN_ASSESSED_PILLARS_FOR_PARTIAL` in
-- `supabase/functions/_shared/pace.ts`). `flow.ts` is therefore the only place that can see both
-- "this validated" and "nothing was assessed" at once, and it answers by calling
-- `release_analysis` (not `settle_analysis`) with this new reason — the exact mechanism
-- `'validation_failed'`/`'model_error'`/`'internal_error'`/`'provider_timeout'`/`'stale_sweep'`
-- already use to hand a quota slot back, per `release_analysis`'s own header
-- (`20260711150400_quota_reserve_settle_release.sql`). The computed result is still returned to
-- the caller in the same HTTP response — nothing is persisted, and the request is not failed
-- outright, exactly like every other release path.
--
-- WHY 'zero_pillars_assessed' MUST NOT BE A FARMING SIGNAL. `public.pace_is_farming_signal`
-- (20260712220000_anti_farm_release_reason_fix.sql) is the sole, standalone classifier
-- `reserve_analysis`'s 3-strike anti-farming cap reads, and it already treats any reason string it
-- has never seen as "not a farming signal" by construction (`coalesce(p_release_reason in
-- ('validation_failed'), false)`) — the same property `20260713130000_stale_reservation_sweep.sql`
-- relied on to add `'stale_sweep'` without touching that function. This migration relies on the
-- identical property: adding 'zero_pillars_assessed' to the CHECK constraint's vocabulary, below,
-- is sufficient on its own — `pace_is_farming_signal` needs NO change, and does not get one. An
-- honest "I could not assess anything in this clip" (a camera never showing the runner, a black
-- frame, an unrelated video) is not an attack, and must never tick the 3-strike counter the way a
-- deliberate prompt-injection farming attempt does.
--
-- ---------------------------------------------------------------------------------------------
-- Extend the release_reason vocabulary. Superset-only (every previously-valid value stays valid),
-- same idiom as 20260713130000_stale_reservation_sweep.sql's own extension of this constraint —
-- drop and recreate rather than an ADD CHECK with a second name, so there remains exactly one
-- constraint, one name, one place the full taxonomy is spelled out.
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
      'zero_pillars_assessed'   -- captain decision (audit-v23-r1-decision-zero-pillar-charge-
                                 -- policy): the response validated in full, but every pillar was
                                 -- honestly not-assessed — nothing useful was delivered, so the
                                 -- quota slot is refunded rather than charged. Deliberately NOT in
                                 -- pace_is_farming_signal's vocabulary — an honest "nothing to see
                                 -- here" is not abuse.
    )
  );
