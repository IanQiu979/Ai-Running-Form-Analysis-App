/**
 * `lib/analyzing-machine.ts` (issue #80) — the Analyzing screen's pure state machine.
 *
 * The load-bearing cases here are the staleness guards: a late `succeeded`/`failed`/`timedOut`
 * event tagged with an OLD `attempt` must never clobber a newer attempt already in flight (a
 * client-side timeout racing a real response, or a Retry started after one). Without that guard,
 * a slow straggler from attempt 1 could overwrite attempt 2's real result with attempt 1's stale
 * failure — see the reducer's doc comment for why this is what keeps the screen honest about
 * "waiting on a server-side job" rather than trusting whichever promise settles last.
 */
import {
  ANALYZING_LONG_WAIT_DELAY_MS,
  ANALYZING_STEP_FLOOR_MS,
  ANALYZING_STEP_KEYS,
  INITIAL_ANALYZING_STATE,
  analyzingReducer,
  captionPhaseForElapsed,
  type AnalyzingState,
} from '../analyzing-machine';

const mockOutcome = {
  result: {
    pillars: {
      posture: { score: 80, band: 'good' as const, feedback: null, flags: [], drills: [] },
      armSwing: { score: null, band: null, feedback: null, flags: [], drills: [] },
      cadence: { score: null, band: null, feedback: null, flags: [], drills: [] },
      elasticity: { score: null, band: null, feedback: null, flags: [], drills: [] },
    },
    overall: { score: 80, band: 'good' as const },
  },
  isFallback: false,
};

describe('captionPhaseForElapsed', () => {
  it('shows the first step at t=0', () => {
    expect(captionPhaseForElapsed(0)).toEqual({ kind: 'step', stepIndex: 0, stepKey: 'reading' });
  });

  it('shows the first step for its whole floor', () => {
    expect(captionPhaseForElapsed(ANALYZING_STEP_FLOOR_MS - 1)).toEqual({
      kind: 'step',
      stepIndex: 0,
      stepKey: 'reading',
    });
  });

  it('advances to the second step once the first step floor passes', () => {
    expect(captionPhaseForElapsed(ANALYZING_STEP_FLOOR_MS)).toEqual({
      kind: 'step',
      stepIndex: 1,
      stepKey: 'scoring',
    });
  });

  // The honesty mechanic: the last step stays "lit, steady" — captionPhaseForElapsed keeps
  // reporting the SAME last step index for the whole dwell, never inventing a third step just
  // because more time passed.
  it('holds the last step steady through the whole dwell, never advancing past it', () => {
    const stepListFloorMs = ANALYZING_STEP_KEYS.length * ANALYZING_STEP_FLOOR_MS;
    const justBeforeLongWait = stepListFloorMs + ANALYZING_LONG_WAIT_DELAY_MS - 1;

    expect(captionPhaseForElapsed(stepListFloorMs)).toEqual({ kind: 'step', stepIndex: 1, stepKey: 'scoring' });
    expect(captionPhaseForElapsed(justBeforeLongWait)).toEqual({ kind: 'step', stepIndex: 1, stepKey: 'scoring' });
  });

  it('switches to the long-wait line once the dwell elapses', () => {
    const threshold = ANALYZING_STEP_KEYS.length * ANALYZING_STEP_FLOOR_MS + ANALYZING_LONG_WAIT_DELAY_MS;

    expect(captionPhaseForElapsed(threshold)).toEqual({ kind: 'longWait' });
    expect(captionPhaseForElapsed(threshold + 60_000)).toEqual({ kind: 'longWait' });
  });

  it('never advances past the step list even for a negative/garbage elapsed value', () => {
    expect(captionPhaseForElapsed(-100)).toEqual({ kind: 'step', stepIndex: 0, stepKey: 'reading' });
  });
});

describe('analyzingReducer', () => {
  it('starts waiting on attempt 1', () => {
    expect(INITIAL_ANALYZING_STATE).toEqual({ phase: 'waiting', attempt: 1 });
  });

  it('moves to succeeded on a matching-attempt success, carrying the outcome and id through', () => {
    const next = analyzingReducer(INITIAL_ANALYZING_STATE, {
      type: 'succeeded',
      attempt: 1,
      outcome: mockOutcome,
      analysisId: 'analysis-1',
    });

    expect(next).toEqual({ phase: 'succeeded', outcome: mockOutcome, analysisId: 'analysis-1' });
  });

  // isFallback: true is a real, shippable result, not a failure (issue #45) — the reducer must
  // not special-case it; it flows through the exact same 'succeeded' transition.
  it('routes an isFallback: true outcome through the SAME succeeded transition as a full success', () => {
    const fallbackOutcome = { ...mockOutcome, isFallback: true };

    const next = analyzingReducer(INITIAL_ANALYZING_STATE, {
      type: 'succeeded',
      attempt: 1,
      outcome: fallbackOutcome,
      analysisId: 'analysis-2',
    });

    expect(next).toEqual({ phase: 'succeeded', outcome: fallbackOutcome, analysisId: 'analysis-2' });
  });

  it('moves to failed on a matching-attempt failure', () => {
    const next = analyzingReducer(INITIAL_ANALYZING_STATE, { type: 'failed', attempt: 1 });
    expect(next).toEqual({ phase: 'failed', attempt: 1, code: undefined });
  });

  // Issue #136: AnalyzeFormError.code must survive into state, distinguishably, so
  // app/analyzing.tsx can route a quota_exceeded failure to the paywall instead of rendering the
  // generic retryable error panel — see AnalyzingState's 'failed' doc comment.
  describe('failed carries the server code through (issue #136)', () => {
    it('moves to failed with the quota_exceeded code on a matching-attempt failure', () => {
      const next = analyzingReducer(INITIAL_ANALYZING_STATE, {
        type: 'failed',
        attempt: 1,
        code: 'quota_exceeded',
      });
      expect(next).toEqual({ phase: 'failed', attempt: 1, code: 'quota_exceeded' });
    });

    it('a quota_exceeded failure is distinguishable in state from a generic (undefined-code) failure', () => {
      const genericFailure = analyzingReducer(INITIAL_ANALYZING_STATE, { type: 'failed', attempt: 1 });
      const quotaFailure = analyzingReducer(INITIAL_ANALYZING_STATE, {
        type: 'failed',
        attempt: 1,
        code: 'quota_exceeded',
      });

      expect(genericFailure).not.toEqual(quotaFailure);
      expect(genericFailure.phase === 'failed' && genericFailure.code).toBeUndefined();
      expect(quotaFailure.phase === 'failed' && quotaFailure.code).toBe('quota_exceeded');
    });

    it('carries a non-quota documented code through unchanged (e.g. validation_failed)', () => {
      const next = analyzingReducer(INITIAL_ANALYZING_STATE, {
        type: 'failed',
        attempt: 1,
        code: 'validation_failed',
      });
      expect(next).toEqual({ phase: 'failed', attempt: 1, code: 'validation_failed' });
    });

    // The "MAY reject (throw)" case (lib/analyze-form.ts's AnalyzeFormClient doc comment) has no
    // server-authored code at all — app/analyzing.tsx's .catch() dispatches 'failed' with no
    // `code` field, which must behave exactly like today's generic failure, not crash or coerce
    // to some fabricated value.
    it('a failure with no code at all still moves to the generic failed phase', () => {
      const next = analyzingReducer(INITIAL_ANALYZING_STATE, { type: 'failed', attempt: 1 });
      expect(next.phase).toBe('failed');
      expect(next.phase === 'failed' && next.code).toBeUndefined();
    });

    // Both directions (issue #136's own wording): a generic failure must STILL be retryable —
    // carrying `code` through must not disturb the existing failed -> retry -> waiting transition,
    // for either a coded or an uncoded failure.
    it('a generic (uncoded) failed state is still retryable', () => {
      const failed = analyzingReducer(INITIAL_ANALYZING_STATE, { type: 'failed', attempt: 1 });
      expect(analyzingReducer(failed, { type: 'retry' })).toEqual({ phase: 'waiting', attempt: 2 });
    });

    it('a quota_exceeded failed state is still retryable at the machine level (routing away is app/analyzing.tsx\'s job, not this reducer\'s)', () => {
      const failed = analyzingReducer(INITIAL_ANALYZING_STATE, {
        type: 'failed',
        attempt: 1,
        code: 'quota_exceeded',
      });
      expect(analyzingReducer(failed, { type: 'retry' })).toEqual({ phase: 'waiting', attempt: 2 });
    });
  });

  it('moves to timedOut on a matching-attempt timeout', () => {
    const next = analyzingReducer(INITIAL_ANALYZING_STATE, { type: 'timedOut', attempt: 1 });
    expect(next).toEqual({ phase: 'timedOut', attempt: 1 });
  });

  it('retry from failed starts a new, incremented attempt back in waiting', () => {
    const failed: AnalyzingState = { phase: 'failed', attempt: 1 };
    expect(analyzingReducer(failed, { type: 'retry' })).toEqual({ phase: 'waiting', attempt: 2 });
  });

  it('retry from timedOut starts a new, incremented attempt back in waiting', () => {
    const timedOut: AnalyzingState = { phase: 'timedOut', attempt: 3 };
    expect(analyzingReducer(timedOut, { type: 'retry' })).toEqual({ phase: 'waiting', attempt: 4 });
  });

  it('ignores a retry event while still waiting', () => {
    expect(analyzingReducer(INITIAL_ANALYZING_STATE, { type: 'retry' })).toBe(INITIAL_ANALYZING_STATE);
  });

  it('ignores a retry event once already succeeded', () => {
    const succeeded: AnalyzingState = { phase: 'succeeded', outcome: mockOutcome, analysisId: 'a' };
    expect(analyzingReducer(succeeded, { type: 'retry' })).toBe(succeeded);
  });

  // The staleness guard. A Retry has already moved the machine to attempt 2 (waiting) by the time
  // attempt 1's timer/promise settles late — that late event must be dropped, not applied.
  it('drops a stale failed event from an old attempt after a Retry has already started a new one', () => {
    const retried: AnalyzingState = { phase: 'waiting', attempt: 2 };
    const next = analyzingReducer(retried, { type: 'failed', attempt: 1 });
    expect(next).toBe(retried);
  });

  it('drops a stale timedOut event from an old attempt after a Retry has already started a new one', () => {
    const retried: AnalyzingState = { phase: 'waiting', attempt: 2 };
    const next = analyzingReducer(retried, { type: 'timedOut', attempt: 1 });
    expect(next).toBe(retried);
  });

  // The exact scenario issue #80 calls out: a client-side timeout fires, the screen shows the
  // timeout error — and only THEN does the real (slow) response straggle in. It must not silently
  // overwrite the timeout screen out from under the user.
  it('drops a stale succeeded event that arrives after the same attempt already timed out', () => {
    const timedOut: AnalyzingState = { phase: 'timedOut', attempt: 1 };
    const next = analyzingReducer(timedOut, {
      type: 'succeeded',
      attempt: 1,
      outcome: mockOutcome,
      analysisId: 'late-analysis',
    });
    expect(next).toBe(timedOut);
  });

  it('drops a stale succeeded event that arrives after the same attempt already failed', () => {
    const failed: AnalyzingState = { phase: 'failed', attempt: 1 };
    const next = analyzingReducer(failed, {
      type: 'succeeded',
      attempt: 1,
      outcome: mockOutcome,
      analysisId: 'late-analysis',
    });
    expect(next).toBe(failed);
  });

  it('drops a failed event whose attempt does not match the current waiting attempt, even without a retry', () => {
    const waitingOnTwo: AnalyzingState = { phase: 'waiting', attempt: 2 };
    expect(analyzingReducer(waitingOnTwo, { type: 'failed', attempt: 1 })).toBe(waitingOnTwo);
  });

  // Issue #64 — the three-case foreground reconciliation. A 'delivered' row reconciles through
  // the EXISTING 'succeeded' transition tested above (same fields, no new case needed); these
  // cover the genuinely new case, 'released' — "the state that will otherwise spin forever"
  // without it.
  describe('reconciledReleased (issue #64)', () => {
    it('moves a matching-attempt reconciliation to the released phase, carrying the analysis id', () => {
      const next = analyzingReducer(INITIAL_ANALYZING_STATE, {
        type: 'reconciledReleased',
        attempt: 1,
        analysisId: 'analysis-3',
      });

      expect(next).toEqual({ phase: 'released', analysisId: 'analysis-3' });
    });

    // Same staleness guard every other attempt-tagged event gets: a reconciliation read that was
    // already in flight when a Retry moved the machine to a new attempt must not clobber it.
    it('drops a stale reconciledReleased event from an old attempt after a Retry has already started a new one', () => {
      const retried: AnalyzingState = { phase: 'waiting', attempt: 2 };
      const next = analyzingReducer(retried, {
        type: 'reconciledReleased',
        attempt: 1,
        analysisId: 'analysis-stale',
      });
      expect(next).toBe(retried);
    });

    it('ignores a reconciledReleased event once the attempt has already succeeded', () => {
      const succeeded: AnalyzingState = { phase: 'succeeded', outcome: mockOutcome, analysisId: 'a' };
      const next = analyzingReducer(succeeded, {
        type: 'reconciledReleased',
        attempt: 1,
        analysisId: 'analysis-late',
      });
      expect(next).toBe(succeeded);
    });

    // The load-bearing case for "otherwise spin forever": released must NOT be retriable via the
    // normal retry path, because a retry would resubmit the SAME idempotency key and
    // reserve_analysis returns an idempotency match "as-is, whatever its status" — i.e. the same
    // released row again, never an actual new attempt. The reducer must not pretend otherwise.
    it('ignores a retry event from the released phase (no working retry exists for a released row)', () => {
      const released: AnalyzingState = { phase: 'released', analysisId: 'analysis-4' };
      expect(analyzingReducer(released, { type: 'retry' })).toBe(released);
    });
  });

  // Issue #93 — the pre-flight offline gate. Its own phase rather than a fold into `failed`,
  // because the screen must be able to say "nothing has been sent yet", which is true here only
  // because submit() is never called. Unlike `released`, this one IS genuinely retryable: no
  // request was ever made, so retrying is a real attempt, not a resubmit of a settled key.
  describe('offline (issue #93)', () => {
    it('moves a matching-attempt offline reading to the offline phase', () => {
      const next = analyzingReducer(INITIAL_ANALYZING_STATE, { type: 'offline', attempt: 1 });
      expect(next).toEqual({ phase: 'offline', attempt: 1 });
    });

    it('retry from offline starts a new, incremented attempt back in waiting', () => {
      const offline: AnalyzingState = { phase: 'offline', attempt: 2 };
      expect(analyzingReducer(offline, { type: 'retry' })).toEqual({ phase: 'waiting', attempt: 3 });
    });

    it('drops a stale offline event from an old attempt after a Retry has already started a new one', () => {
      const retried: AnalyzingState = { phase: 'waiting', attempt: 2 };
      expect(analyzingReducer(retried, { type: 'offline', attempt: 1 })).toBe(retried);
    });

    it('ignores an offline event once the attempt has already succeeded', () => {
      const succeeded: AnalyzingState = { phase: 'succeeded', outcome: mockOutcome, analysisId: 'a' };
      expect(analyzingReducer(succeeded, { type: 'offline', attempt: 1 })).toBe(succeeded);
    });
  });
});
