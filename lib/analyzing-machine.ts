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
import type { PaceAnalysisOutcome } from '@shared/pace';

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

export type AnalyzingState =
  | { phase: 'waiting'; attempt: number }
  | { phase: 'succeeded'; outcome: PaceAnalysisOutcome; analysisId: string }
  | { phase: 'failed'; attempt: number }
  | { phase: 'timedOut'; attempt: number };

export const INITIAL_ANALYZING_STATE: AnalyzingState = { phase: 'waiting', attempt: 1 };

export type AnalyzingEvent =
  | { type: 'succeeded'; attempt: number; outcome: PaceAnalysisOutcome; analysisId: string }
  | { type: 'failed'; attempt: number }
  | { type: 'timedOut'; attempt: number }
  | { type: 'retry' };

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
    case 'failed':
      return isCurrentAttempt(state, event.attempt) ? { phase: 'failed', attempt: event.attempt } : state;
    case 'timedOut':
      return isCurrentAttempt(state, event.attempt) ? { phase: 'timedOut', attempt: event.attempt } : state;
    case 'retry':
      // Only a `failed`/`timedOut` screen shows a Retry button in the first place — this guard
      // just keeps the reducer honest about that instead of trusting the caller never to fire a
      // stray 'retry' from `waiting`/`succeeded`.
      return state.phase === 'failed' || state.phase === 'timedOut'
        ? { phase: 'waiting', attempt: state.attempt + 1 }
        : state;
    default:
      return state;
  }
}
