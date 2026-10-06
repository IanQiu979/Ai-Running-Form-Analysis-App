/**
 * Locks for `lib/loading-screens.ts` — the Preparing and Analysing screens' pure display decisions
 * (2026-10-06 redesign). Nothing here decides anything; these tests pin the mapping from states
 * the screens already own to what is drawn, so a refactor of either screen cannot silently change
 * which stop layout a server code lands on, or have a failed pre-flight name a quota number the
 * server never gave.
 */
import type { QuotaStatus } from '@shared/quota-status';

import type { AnalyzingCaptionPhase, AnalyzingState } from '../analyzing-machine';
import {
  analysingPhase,
  analysingStop,
  analysingTrack,
  formatElapsed,
  preparingBadgeParts,
  preparingChecklist,
  preparingHeroIndex,
  preparingTileStatus,
  quotaPanel,
  quotaRemaining,
  stopIsRetryable,
  stopIsUncounted,
  type AnalysingStop,
} from '../loading-screens';

function quota(overrides: Partial<QuotaStatus> = {}): QuotaStatus {
  return {
    tier: 'pro',
    used: 3,
    limit: 10,
    remaining: 7,
    frameCap: 5,
    isLifetime: false,
    periodStart: '2026-10-01T00:00:00.000Z',
    periodEnd: '2026-11-01T00:00:00.000Z',
    blocked: false,
    blockedReason: null,
    blockedUntil: null,
    ...overrides,
  };
}

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

const UPLOADING: AnalyzingCaptionPhase = { kind: 'step', stepIndex: 0, stepKey: 'uploading' };
const FINDING: AnalyzingCaptionPhase = { kind: 'step', stepIndex: 1, stepKey: 'finding' };
const LONG_WAIT: AnalyzingCaptionPhase = { kind: 'longWait' };

// ---------------------------------------------------------------------------------------------
// Preparing
// ---------------------------------------------------------------------------------------------

describe('preparingChecklist', () => {
  it('lights the quota row while the pre-flight is checking', () => {
    expect(preparingChecklist('checking')).toEqual([
      { key: 'quota', status: 'now' },
      { key: 'frames', status: 'todo' },
      { key: 'ready', status: 'todo' },
    ]);
  });

  it('completes the quota row and lights frames while extracting', () => {
    expect(preparingChecklist('extracting')).toEqual([
      { key: 'quota', status: 'done' },
      { key: 'frames', status: 'now' },
      { key: 'ready', status: 'todo' },
    ]);
  });

  it('marks every row done once ready — ready is the end state, not a step in progress', () => {
    expect(preparingChecklist('ready')).toEqual([
      { key: 'quota', status: 'done' },
      { key: 'frames', status: 'done' },
      { key: 'ready', status: 'done' },
    ]);
  });
});

describe('quotaRemaining', () => {
  it("returns the server's own remaining count", () => {
    expect(quotaRemaining(quota({ remaining: 4 }))).toBe(4);
    expect(quotaRemaining(quota({ remaining: 0 }))).toBe(0);
  });

  it('returns null for a pre-flight that failed open, never inventing a count', () => {
    expect(quotaRemaining(null)).toBeNull();
  });
});

describe('preparingBadgeParts', () => {
  it('is just the media kind for a photo, whatever the tier or count', () => {
    expect(preparingBadgeParts('photo', 1, 'elite')).toEqual(['photo']);
  });

  it('omits the frame count for a video whose total is not yet known', () => {
    expect(preparingBadgeParts('video', null, 'pro')).toEqual(['video']);
  });

  it('shows the frame count for a Pro video, without naming the tier', () => {
    expect(preparingBadgeParts('video', 5, 'pro')).toEqual(['video', { frames: 5 }]);
  });

  it('names Elite for an Elite video — the one tier whose frame count differs', () => {
    expect(preparingBadgeParts('video', 8, 'elite')).toEqual(['video', 'elite', { frames: 8 }]);
  });
});

describe('preparingHeroIndex', () => {
  it('shows the frame being pulled now, one past the count done', () => {
    expect(preparingHeroIndex(0, 5)).toBe(1);
    expect(preparingHeroIndex(2, 5)).toBe(3);
  });

  it('clamps a finished extraction to the total, never reading 6 / 5', () => {
    expect(preparingHeroIndex(5, 5)).toBe(5);
    expect(preparingHeroIndex(9, 5)).toBe(5);
  });

  it('treats a negative done count as zero', () => {
    expect(preparingHeroIndex(-3, 5)).toBe(1);
  });

  it('is 0 when there is no total', () => {
    expect(preparingHeroIndex(0, 0)).toBe(0);
    expect(preparingHeroIndex(2, -1)).toBe(0);
  });
});

describe('preparingTileStatus', () => {
  it('marks tiles before the done count as done, the next as now, the rest as todo', () => {
    expect([0, 1, 2, 3, 4].map((i) => preparingTileStatus(i, 2, 5))).toEqual([
      'done',
      'done',
      'now',
      'todo',
      'todo',
    ]);
  });

  it('has no "now" tile once every frame is done', () => {
    expect([0, 1, 2].map((i) => preparingTileStatus(i, 3, 3))).toEqual(['done', 'done', 'done']);
  });
});

describe('quotaPanel', () => {
  it('is unknown with no reading, stating no numbers', () => {
    expect(quotaPanel(null)).toEqual({ kind: 'unknown' });
  });

  it('is the Free panel, with no reset date, for a lifetime quota', () => {
    expect(
      quotaPanel(quota({ tier: 'free', isLifetime: true, used: 1, limit: 1, periodEnd: null }))
    ).toEqual({ kind: 'free', used: 1, limit: 1 });
  });

  it('is the Free panel for the free tier even if isLifetime were false', () => {
    expect(quotaPanel(quota({ tier: 'free', isLifetime: false, used: 1, limit: 1 }))).toEqual({
      kind: 'free',
      used: 1,
      limit: 1,
    });
  });

  it("is the paid panel, resetting at the server's periodEnd, for a paid plan", () => {
    expect(quotaPanel(quota({ tier: 'elite', used: 30, limit: 30 }))).toEqual({
      kind: 'paid',
      used: 30,
      limit: 30,
      resetsAt: '2026-11-01T00:00:00.000Z',
    });
  });

  it('passes a null periodEnd through as an unknown reset rather than inventing one', () => {
    expect(quotaPanel(quota({ periodEnd: null }))).toMatchObject({ kind: 'paid', resetsAt: null });
  });
});

// ---------------------------------------------------------------------------------------------
// Analysing
// ---------------------------------------------------------------------------------------------

describe('analysingPhase', () => {
  const waiting: AnalyzingState = { phase: 'waiting', attempt: 1 };

  it('is uploading while waiting on the uploading step', () => {
    expect(analysingPhase(waiting, UPLOADING)).toBe('uploading');
  });

  it('is finding while waiting on the finding step', () => {
    expect(analysingPhase(waiting, FINDING)).toBe('finding');
  });

  it('is longWait once the caption has moved past the step list', () => {
    expect(analysingPhase(waiting, LONG_WAIT)).toBe('longWait');
  });

  it('is done once succeeded, whatever the caption', () => {
    expect(
      analysingPhase({ phase: 'succeeded', outcome: mockOutcome, analysisId: 'a1' }, UPLOADING)
    ).toBe('done');
  });

  it.each<AnalyzingState>([
    { phase: 'failed', attempt: 1, code: 'internal_error' },
    { phase: 'timedOut', attempt: 1 },
    { phase: 'offline', attempt: 1 },
    { phase: 'released', analysisId: 'a1' },
  ])('is null for the stop state $phase, which draws the failure layout', (state) => {
    expect(analysingPhase(state, LONG_WAIT)).toBeNull();
  });
});

describe('analysingTrack', () => {
  it('lights Upload while uploading', () => {
    expect(analysingTrack('uploading')).toEqual([
      { key: 'upload', status: 'now' },
      { key: 'read', status: 'todo' },
      { key: 'result', status: 'todo' },
    ]);
  });

  it.each(['finding', 'longWait'] as const)('lights Read (the same step, held) while %s', (phase) => {
    expect(analysingTrack(phase)).toEqual([
      { key: 'upload', status: 'done' },
      { key: 'read', status: 'now' },
      { key: 'result', status: 'todo' },
    ]);
  });

  it('completes all three when done', () => {
    expect(analysingTrack('done')).toEqual([
      { key: 'upload', status: 'done' },
      { key: 'read', status: 'done' },
      { key: 'result', status: 'done' },
    ]);
  });
});

describe('analysingStop', () => {
  it('is null while waiting and once succeeded', () => {
    expect(analysingStop({ phase: 'waiting', attempt: 1 })).toBeNull();
    expect(analysingStop({ phase: 'succeeded', outcome: mockOutcome, analysisId: 'a1' })).toBeNull();
  });

  it('maps timedOut, offline and released to their own layouts', () => {
    expect(analysingStop({ phase: 'timedOut', attempt: 1 })).toBe('timeout');
    expect(analysingStop({ phase: 'offline', attempt: 2 })).toBe('offline');
    expect(analysingStop({ phase: 'released', analysisId: 'a1' })).toBe('released');
  });

  it('is null for quota_exceeded, which routes to the paywall instead of drawing', () => {
    expect(analysingStop({ phase: 'failed', attempt: 1, code: 'quota_exceeded' })).toBeNull();
  });

  it.each<[string, AnalysingStop]>([
    ['unauthorized', 'unauthorized'],
    ['previous_attempt_failed', 'released'],
    ['analysis_in_progress', 'inProgress'],
    ['analysis_deleted', 'deleted'],
    ['too_many_failed_attempts', 'paused'],
    ['zero_pillar_cooldown', 'zeroPillarCooldown'],
  ])('maps the server code %s to the %s layout', (code, stop) => {
    expect(analysingStop({ phase: 'failed', attempt: 1, code })).toBe(stop);
  });

  it('falls back to the plain failed layout for an unrecognized or client-side code', () => {
    expect(analysingStop({ phase: 'failed', attempt: 1, code: 'internal_error' })).toBe('failed');
    expect(analysingStop({ phase: 'failed', attempt: 1, code: 'unknown' })).toBe('failed');
  });

  it('falls back to the plain failed layout when no response carried a code', () => {
    expect(analysingStop({ phase: 'failed', attempt: 1 })).toBe('failed');
    expect(analysingStop({ phase: 'failed', attempt: 1, code: undefined })).toBe('failed');
  });
});

describe('stopIsRetryable', () => {
  it.each<[AnalysingStop, boolean]>([
    ['failed', true],
    ['timeout', true],
    ['offline', true],
    // A Retry under the same key replays the earlier attempt once it has settled.
    ['inProgress', true],
    ['unauthorized', false],
    ['released', false],
    ['deleted', false],
    ['paused', false],
    ['zeroPillarCooldown', false],
  ])('%s -> %s', (stop, retryable) => {
    expect(stopIsRetryable(stop)).toBe(retryable);
  });
});

describe('stopIsUncounted', () => {
  const failed = (code?: string): AnalyzingState => ({ phase: 'failed', attempt: 1, code });

  // The line is only drawn where it is TRUE: where the server is known not to have charged.
  it('is false for a timeout — the server may still finish and settle it', () => {
    expect(stopIsUncounted('timeout', { phase: 'timedOut', attempt: 1 })).toBe(false);
  });

  it('is false for inProgress — the earlier attempt is charged when it settles', () => {
    expect(stopIsUncounted('inProgress', failed('analysis_in_progress'))).toBe(false);
  });

  it('is false for deleted — the analysis was delivered, and charged, before it was deleted', () => {
    expect(stopIsUncounted('deleted', failed('analysis_deleted'))).toBe(false);
  });

  it('is true for a plain failure the SERVER answered with its own code (the reservation was released)', () => {
    expect(stopIsUncounted('failed', failed('model_error'))).toBe(true);
    expect(stopIsUncounted('failed', failed('validation_failed'))).toBe(true);
  });

  // A submit that threw has no response at all; `unknown` also covers a 200 this client could not
  // validate, where the server DID settle and keep the quota. Neither proves nothing was charged.
  it.each<[string, AnalyzingState]>([
    ['a thrown submit (no code)', failed()],
    ['an explicit undefined code', failed(undefined)],
    ["the client's own unknown code", failed('unknown')],
  ])('is false for a plain failure from %s', (_label, state) => {
    expect(stopIsUncounted('failed', state)).toBe(false);
  });

  it.each<[AnalysingStop, AnalyzingState]>([
    ['unauthorized', failed('unauthorized')],
    ['offline', { phase: 'offline', attempt: 1 }],
    ['released', { phase: 'released', analysisId: 'a1' }],
    ['released', failed('previous_attempt_failed')],
    ['paused', failed('too_many_failed_attempts')],
    ['zeroPillarCooldown', failed('zero_pillar_cooldown')],
  ])('is true for %s', (stop, state) => {
    expect(stopIsUncounted(stop, state)).toBe(true);
  });
});

describe('formatElapsed', () => {
  it('reads mm:ss, flooring partial seconds', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(999)).toBe('00:00');
    expect(formatElapsed(42_500)).toBe('00:42');
    expect(formatElapsed(120_000)).toBe('02:00');
  });

  it('reads 00:00 for a negative elapsed time', () => {
    expect(formatElapsed(-1000)).toBe('00:00');
  });
});
