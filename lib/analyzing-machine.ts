/**
 * The Analyzing screen's (issue #80) pure state machine — the wait-state pacing constants and
 * the reducer that decide what `app/analyzing.tsx` renders. No I/O, no timers, no React: fully
 * unit-testable (`lib/__tests__/analyzing-machine.test.ts`). The screen owns firing the actual
 * `analyzeFormClient.submit()` call and the timers that dispatch events into this reducer — this
 * file only owns what those events MEAN.
 *
 * "We are waiting on a server-side job, not holding a promise in memory" (issue #80's framing,
 * kept honest so #64's future backgrounding-recovery work never has to tear this out): every
 * state below is built entirely from plain values — an attempt counter, a settled result payload
 * — never a `Promise` or a timer handle. Recovering an analysis that finished while this screen
 * (or the whole app) was gone is issue #64's job; this machine only has to not assume the
 * opposite, e.g. by trusting a stale attempt's late resolution over the current one (see
 * `isCurrentAttempt` below).
 */
import type { PaceAnalysisOutcome, PaceResult } from '@shared/pace';

import type { AnalyzeFormError } from './analyze-form';

// -------------------------------------------------------------------------------------------
// Wait-state pacing — docs/design/motion-consult.md "The wait state — V2.2's honesty mechanic,
// restated". Issue #61 owns the motion/reduced-motion spec these constants and
// `captionPhaseForElapsed` implement; this issue (#80) only owns the screen that has to honor it.
// -------------------------------------------------------------------------------------------

/**
 * A short, fixed client-side step list, each step held for this floor regardless of how fast the
 * real response arrives — motion-consult.md: "reveal gates on BOTH the step timeline finishing
 * AND the response arriving — whichever is later. Response lands early -> remaining steps still
 * play at normal cadence, never accelerated or skipped." V2.2 precedent, restated there:
 * ~400ms/step.
 */
export const ANALYZING_STEP_FLOOR_MS = 400;

/**
 * The step captions, in order — `docs/design/copy-deck.md`'s `analyzing.step.reading` /
 * `.scoring`. `docs/design/frontend-design-brief.md` §4.6's prose sketches a third step
 * ("Finalizing your read") as an example, but the copy deck defines no key for it — only these
 * two ship. Inventing a third string here would be exactly the "don't invent wording that isn't
 * in the deck" mistake CLAUDE.md warns against; add it in both docs together if a third step is
 * ever wanted.
 */
export const ANALYZING_STEP_KEYS = ['reading', 'scoring'] as const;
export type AnalyzingStepKey = (typeof ANALYZING_STEP_KEYS)[number];

/**
 * motion-consult.md: "Steps finish first (the expected path) -> last step stays lit, steady,
 * non-pulsing; after a ~1.5-2s dwell, fade in once (never loops): 'Still analyzing...'." Measured
 * from the moment the step list's fixed floor finishes (see `captionPhaseForElapsed`), not from
 * mount.
 */
export const ANALYZING_LONG_WAIT_DELAY_MS = 1750;

/**
 * Client-side wait ceiling, past which this screen gives up and shows `analyzing.error.timeout.*`
 * instead of waiting forever. NOT a guess at `analyze-form`'s own server-side timeout — there
 * isn't a documented one. `pending_timeout_seconds` (300s, `docs/architecture.md`'s AI-spend-gate
 * schema) is a different concern: how long a *reservation* sits before the gate ages it out on
 * its own, not a promise about how long the model call itself may run. This value is set well
 * past the documented 20-60s call range (extended-thinking calls can legitimately run long) but
 * comfortably under that 300s reservation ceiling, so the user is told something before the
 * server-side accounting would have moved on regardless. A client-side heuristic, not an
 * authoritative spec — revisit once #44 exists and this can be checked against real call
 * latencies.
 *
 * Reaching this ceiling does NOT cancel the in-flight `analyzeFormClient.submit()` call — per
 * `docs/architecture.md`'s "Backgrounding recovery" note, the server finishes and settles the
 * analysis regardless of whether this client is still listening. `app/analyzing.tsx` simply stops
 * waiting on it once a newer attempt (a Retry) starts; see `isCurrentAttempt`.
 */
export const ANALYZING_TIMEOUT_MS = 120_000;

export type AnalyzingCaptionPhase =
  | { kind: 'step'; stepIndex: number; stepKey: AnalyzingStepKey }
  | { kind: 'longWait' };

/**
 * Pure function of elapsed time -> which caption phase is showing. No `Date.now()`, no timers —
 * the caller (`app/analyzing.tsx`) supplies `elapsedMs`, which is what makes this testable with
 * plain numbers instead of fake timers. The last step index is clamped, not advanced past the end
 * of `ANALYZING_STEP_KEYS`, which is exactly the "last step stays lit, steady" behavior:
 * `stepIndex` simply stops changing once the list is exhausted, for as long as the honesty-
 * threshold dwell lasts.
 */
export function captionPhaseForElapsed(elapsedMs: number): AnalyzingCaptionPhase {
  const stepCount = ANALYZING_STEP_KEYS.length;
  const stepIndex = Math.min(Math.floor(Math.max(elapsedMs, 0) / ANALYZING_STEP_FLOOR_MS), stepCount - 1);
  const stepListFloorMs = stepCount * ANALYZING_STEP_FLOOR_MS;

  if (elapsedMs < stepListFloorMs + ANALYZING_LONG_WAIT_DELAY_MS) {
    return { kind: 'step', stepIndex, stepKey: ANALYZING_STEP_KEYS[stepIndex] };
  }
  return { kind: 'longWait' };
}

// -------------------------------------------------------------------------------------------
// The reducer — what each outcome of the analyze-form call (or a client-side timeout, or a
// Retry) means for what's on screen.
// -------------------------------------------------------------------------------------------

/**
 * `'released'` (issue #64): reached ONLY by `reconciledReleased` below, never by `failed` or a
 * client-side `timedOut` — those two mean "the call this screen made came back bad or never came
 * back"; `'released'` means "we checked the row directly (because the app was backgrounded while
 * waiting) and the SERVER already gave up on it while we were away." The two are kept as
 * distinct phases, not folded into `failed`, because `failed`/`timedOut` legitimately offer a
 * Retry that resubmits with the same idempotency key — useful when nothing has settled yet — but
 * a `released` row is already a terminal, settled outcome for that key: `reserve_analysis`
 * returns an idempotency match "as-is, whatever its status" (see
 * supabase/migrations/20260711150400_quota_reserve_settle_release.sql), so resubmitting here
 * would just hand back the same `released` row again, not actually try again. That is exactly the
 * "otherwise spin forever" case the issue calls out — this phase carries no `attempt`, and the
 * reducer's `retry` case (below) does not list it, so a stray Retry tap from here is a no-op by
 * construction rather than a dead-end resubmit.
 *
 * `failed`'s `code` (issue #136): the exact `AnalyzeFormError['code']` the server sent, when the
 * failure came from a documented non-2xx response — `undefined` for the "MAY reject (throw)"
 * case `lib/analyze-form.ts`'s `AnalyzeFormClient` doc comment describes (no response was ever
 * received, so there is no server-authored code to carry). This machine does not special-case any
 * particular code value — it only has to carry whatever the server said through to the state
 * untouched, so `app/analyzing.tsx` can route on it (`code === 'quota_exceeded'` -> `/paywall`,
 * issue #52) without adding client-side quota logic. That routing decision, like every other
 * quota/tier decision, belongs to the screen reading server state, never to this reducer.
 *
 * `'sample'` (captain-approved 2026-07-26): Free tier's zero-model-call labeled preview. Kept as
 * its own phase, not folded into `'succeeded'`, because a sample has nothing in common with a
 * real result's `analysisId`/DB row — see `lib/analyze-form.ts`'s `AnalyzeFormSuccess` union.
 * Like `'released'`, a sample is not a failure, so `retry` (below) does not list it: there is
 * nothing to retry, and the sample screen's own Upgrade/Done CTAs are the only exits.
 */
export type AnalyzingState =
  | { phase: 'waiting'; attempt: number }
  | { phase: 'succeeded'; outcome: PaceAnalysisOutcome; analysisId: string }
  | { phase: 'sample'; result: PaceResult; heroDataUri: string | null }
  | { phase: 'failed'; attempt: number; code?: AnalyzeFormError['code'] }
  | { phase: 'timedOut'; attempt: number }
  | { phase: 'offline'; attempt: number }
  | { phase: 'released'; analysisId: string };

export const INITIAL_ANALYZING_STATE: AnalyzingState = { phase: 'waiting', attempt: 1 };

export type AnalyzingEvent =
  | { type: 'succeeded'; attempt: number; outcome: PaceAnalysisOutcome; analysisId: string }
  /** Free tier's response resolved. Guarded by the same `isCurrentAttempt` staleness check as
   * every other attempt-tagged event — see `'sample'` phase's doc comment above. */
  | { type: 'sample'; attempt: number; result: PaceResult; heroDataUri: string | null }
  /**
   * `code` (issue #136): threaded straight from `AnalyzeFormClientResult`'s `error.code` — see
   * `AnalyzingState`'s `failed` doc comment above for what carries it and what doesn't, and why
   * this reducer never inspects the value itself.
   */
  | { type: 'failed'; attempt: number; code?: AnalyzeFormError['code'] }
  | { type: 'timedOut'; attempt: number }
  /**
   * Issue #93: dispatched by `app/analyzing.tsx`'s submit effect when its pre-flight
   * `checkConnectivity()` read comes back offline — BEFORE `analyzeFormClient.submit()` is ever
   * called and before the client-side timeout timer starts. Kept as its own phase rather than
   * folded into `failed` so the screen can show `offline.blocked.*`, whose "nothing has been sent
   * yet" is true here BY CONSTRUCTION (no call was attempted), instead of the generic
   * `analyzing.error.failed.*`. Retriable exactly like `failed`/`timedOut` — see `retry` below.
   */
  | { type: 'offline'; attempt: number }
  | { type: 'retry' }
  /**
   * Issue #64: dispatched by `app/analyzing.tsx` when a foreground-triggered reconciliation read
   * of the `analyses` row (matched by idempotency key, since the row's own id is not known
   * client-side until a real `succeeded`) finds `status: 'released'` — the analysis failed
   * server-side while the app was backgrounded. A `'delivered'` row reconciles through the
   * EXISTING `succeeded` event above instead (same fields it already carries: `outcome` +
   * `analysisId`); a `'reserved'` row needs no event at all — see that effect's own comment for
   * why doing nothing is the correct handling of "still genuinely in flight."
   */
  | { type: 'reconciledReleased'; attempt: number; analysisId: string };

/**
 * True only while `state` is still `waiting` on exactly this `attempt`. A submit promise or a
 * timeout timer from an OLDER attempt (a Retry already started a new one, or we already moved to
 * `succeeded`) fails this check and its event is dropped — see the doc comment above for why that
 * staleness guard, not a cancelled promise or a cleared timer, is what this screen leans on.
 */
function isCurrentAttempt(state: AnalyzingState, attempt: number): boolean {
  return state.phase === 'waiting' && state.attempt === attempt;
}

export function analyzingReducer(state: AnalyzingState, event: AnalyzingEvent): AnalyzingState {
  switch (event.type) {
    case 'succeeded':
      return isCurrentAttempt(state, event.attempt)
        ? { phase: 'succeeded', outcome: event.outcome, analysisId: event.analysisId }
        : state;
    case 'sample':
      return isCurrentAttempt(state, event.attempt)
        ? { phase: 'sample', result: event.result, heroDataUri: event.heroDataUri }
        : state;
    case 'failed':
      return isCurrentAttempt(state, event.attempt)
        ? { phase: 'failed', attempt: event.attempt, code: event.code }
        : state;
    case 'timedOut':
      return isCurrentAttempt(state, event.attempt) ? { phase: 'timedOut', attempt: event.attempt } : state;
    case 'offline':
      return isCurrentAttempt(state, event.attempt) ? { phase: 'offline', attempt: event.attempt } : state;
    case 'reconciledReleased':
      // Same staleness guard as every other attempt-tagged event: a reconciliation read that was
      // already in flight when a Retry (or an earlier reconcile) moved the machine off this
      // attempt must not clobber whatever the machine has already moved on to.
      return isCurrentAttempt(state, event.attempt)
        ? { phase: 'released', analysisId: event.analysisId }
        : state;
    case 'retry':
      // Only a `failed`/`timedOut` screen shows a Retry button in the first place — this guard
      // just keeps the reducer honest about that instead of trusting the caller never to fire a
      // stray 'retry' from `waiting`/`succeeded`. `'released'` is deliberately excluded too — see
      // that phase's own doc comment above for why a Retry from there would silently do nothing
      // useful rather than actually retry.
      return state.phase === 'failed' || state.phase === 'timedOut' || state.phase === 'offline'
        ? { phase: 'waiting', attempt: state.attempt + 1 }
        : state;
    default:
      return state;
  }
}
