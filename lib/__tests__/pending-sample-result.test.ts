/**
 * `lib/pending-sample-result.ts` — the one-shot mailbox handing Free tier's sample preview from
 * `app/analyzing.tsx` to `app/result/sample.tsx`. Same shape and same load-bearing property as
 * `lib/analyze-form.ts`'s `pendingRequest` mailbox (see that file's own test, "pending
 * analyze-form request mailbox"): a second read after the first must return `null`, or a
 * fast-refresh / re-mount could replay a stale sample onto a screen that never asked for one.
 */
import { setPendingSampleResult, takePendingSampleResult, type PendingSampleResult } from '../pending-sample-result';

const sample: PendingSampleResult = {
  result: {
    pillars: {
      posture: { score: 81, band: 'good', feedback: 'Tall through mid-stance.', flags: [], drills: [] },
      armSwing: { score: 64, band: 'mid', feedback: null, flags: [], drills: [] },
      cadence: { score: 76, band: 'good', feedback: null, flags: [], drills: [] },
      elasticity: { score: 58, band: 'mid', feedback: null, flags: [], drills: [] },
    },
    overall: { score: 70, band: 'good' },
  },
  heroDataUri: 'data:image/jpeg;base64,AAAA',
};

describe('pending sample-result mailbox', () => {
  it('returns null when nothing is pending', () => {
    expect(takePendingSampleResult()).toBeNull();
  });

  it('returns exactly what was set', () => {
    setPendingSampleResult(sample);
    expect(takePendingSampleResult()).toEqual(sample);
  });

  it('accepts a null heroDataUri (the defensive empty-frame-array case)', () => {
    setPendingSampleResult({ ...sample, heroDataUri: null });
    expect(takePendingSampleResult()).toEqual({ ...sample, heroDataUri: null });
  });

  // One-shot: a second take (a re-mount, a fast-refresh) must not replay a stale sample.
  it('is one-shot — a second take after the first returns null', () => {
    setPendingSampleResult(sample);
    takePendingSampleResult();
    expect(takePendingSampleResult()).toBeNull();
  });
});
