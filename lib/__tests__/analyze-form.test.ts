/**
 * `lib/analyze-form.ts` (issue #80) — the `analyze-form` request builder, the dev mock client
 * every `outcome` branch, and the one-shot pending-request mailbox.
 */
import { isPaceAnalysisOutcome, isPaceResult, PACE_PILLARS } from '@shared/pace';

import {
  createMockAnalyzeFormClient,
  setPendingAnalyzeFormRequest,
  takePendingAnalyzeFormRequest,
  toAnalyzeFormRequest,
  type AnalyzeFormRequest,
} from '../analyze-form';
import type { PaceFrameSet } from '../frames';

const sampleRequest: AnalyzeFormRequest = {
  mediaType: 'photo',
  frames: ['base64-a'],
  timestamps: [0],
  idempotencyKey: 'idempotency-key-1',
};

describe('toAnalyzeFormRequest', () => {
  it('flattens a PaceFrameSet into the two parallel arrays analyze-form expects', () => {
    const frameSet: PaceFrameSet = {
      frames: [
        { base64: 'frame-0', timestampMs: 100 },
        { base64: 'frame-1', timestampMs: 900 },
      ],
      totalBytes: 14,
    };

    const request = toAnalyzeFormRequest('video', frameSet, 'idempotency-key-2');

    expect(request).toEqual({
      mediaType: 'video',
      frames: ['frame-0', 'frame-1'],
      timestamps: [100, 900],
      idempotencyKey: 'idempotency-key-2',
    });
  });

  it('keeps frame/timestamp order 1:1 with the source PaceFrameSet', () => {
    const frameSet: PaceFrameSet = {
      frames: [
        { base64: 'z', timestampMs: 3 },
        { base64: 'y', timestampMs: 1 },
        { base64: 'x', timestampMs: 2 },
      ],
      totalBytes: 3,
    };

    const request = toAnalyzeFormRequest('video', frameSet, 'k');

    expect(request.frames).toEqual(['z', 'y', 'x']);
    expect(request.timestamps).toEqual([3, 1, 2]);
  });
});

describe('createMockAnalyzeFormClient', () => {
  it('resolves ok:true with a structurally-valid, non-fallback PaceAnalysisOutcome for "success"', async () => {
    const client = createMockAnalyzeFormClient({ outcome: 'success', delayMs: 0 });

    const result = await client.submit(sampleRequest);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.data.isFallback).toBe(false);
    expect(isPaceResult(result.data.result)).toBe(true);
    expect(typeof result.data.analysisId).toBe('string');
    // Every pillar is assessed on the happy path — a real, non-partial result.
    for (const id of PACE_PILLARS) {
      expect(result.data.result.pillars[id].score).not.toBeNull();
    }
  });

  it('resolves ok:true with isFallback: true and >=2 assessed pillars for "fallback" (issue #45)', async () => {
    const client = createMockAnalyzeFormClient({ outcome: 'fallback', delayMs: 0 });

    const result = await client.submit(sampleRequest);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.data.isFallback).toBe(true);
    expect(isPaceAnalysisOutcome({ result: result.data.result, isFallback: result.data.isFallback })).toBe(true);

    const assessedCount = PACE_PILLARS.filter((id) => result.data.result.pillars[id].score !== null).length;
    expect(assessedCount).toBeGreaterThanOrEqual(2);
    expect(assessedCount).toBeLessThan(PACE_PILLARS.length);
  });

  it('resolves ok:false with a structured { error, code } for "failed"', async () => {
    const client = createMockAnalyzeFormClient({ outcome: 'failed', delayMs: 0 });

    const result = await client.submit(sampleRequest);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok:false');
    expect(typeof result.error.error).toBe('string');
    expect(typeof result.error.code).toBe('string');
  });

  it('rejects for "thrown", simulating an unexpected/network failure', async () => {
    const client = createMockAnalyzeFormClient({ outcome: 'thrown', delayMs: 0 });

    await expect(client.submit(sampleRequest)).rejects.toThrow();
  });

  // The screen's own client-side timeout (ANALYZING_TIMEOUT_MS) is what's supposed to fire here,
  // never the mock resolving on its own — proven by racing it against a short delay instead of
  // actually waiting out the real timeout constant in a test.
  it('never resolves or rejects for "timeout" within a short window', async () => {
    const client = createMockAnalyzeFormClient({ outcome: 'timeout' });
    const sentinel = Symbol('still-pending');

    const outcome = await Promise.race([
      client.submit(sampleRequest),
      new Promise((resolve) => setTimeout(() => resolve(sentinel), 50)),
    ]);

    expect(outcome).toBe(sentinel);
  });

  it('defaults to a "success" outcome when no options are given', async () => {
    const client = createMockAnalyzeFormClient({ delayMs: 0 });
    const result = await client.submit(sampleRequest);
    expect(result.ok).toBe(true);
  });
});

describe('pending analyze-form request mailbox', () => {
  it('returns null when nothing is pending', () => {
    expect(takePendingAnalyzeFormRequest()).toBeNull();
  });

  it('returns exactly what was set', () => {
    setPendingAnalyzeFormRequest(sampleRequest);
    expect(takePendingAnalyzeFormRequest()).toEqual(sampleRequest);
  });

  // One-shot: a second take (a re-mount, a fast-refresh) must not replay a stale request.
  it('is one-shot — a second take after the first returns null', () => {
    setPendingAnalyzeFormRequest(sampleRequest);
    takePendingAnalyzeFormRequest();
    expect(takePendingAnalyzeFormRequest()).toBeNull();
  });
});
