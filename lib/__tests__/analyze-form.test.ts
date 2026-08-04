/**
 * `lib/analyze-form.ts` (issue #80; made real 2026-07-26 for issue #128) — the `analyze-form`
 * request builder, the REAL edge-function client, the dev/test-only mock client's every `outcome`
 * branch, and the one-shot pending-request mailbox.
 *
 * WHAT THE REAL-CLIENT SUITE PROVES, AND WHAT IT CANNOT: it proves `submitToEdgeFunction` reads the
 * documented `{ result, analysisId, isFallback }` contract correctly and never reports a success
 * whose `analysisId` `app/result/[id].tsx` would refuse to query — the property #128 exists to
 * guarantee. It does NOT prove the edge function itself behaves correctly (that is
 * `supabase/functions/analyze-form/__tests__/flow.deno.test.ts`'s job) and it cannot prove a real
 * upload writes a row; only a live end-to-end run against the deployed function does that.
 */
import { isPaceAnalysisOutcome, isPaceResult, PACE_PILLARS } from '@shared/pace';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { proTierVideoResult } from '../pace-fixtures';
import { supabase } from '../supabase';

// `lib/analyze-form.ts` now imports `./functions-client`, which imports `./supabase` — a module
// that builds a real client from `EXPO_PUBLIC_*` env at import time. Mocked at the module boundary,
// the same way `lib/__tests__/delete-account.test.ts` and `lib/__tests__/consent.test.ts` do.
jest.mock('../supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const mockInvoke = supabase.functions.invoke as jest.MockedFunction<typeof supabase.functions.invoke>;

// Re-imported after the mock is registered, matching this repo's established pattern.
import {
  createAnalyzeFormClient,
  createMockAnalyzeFormClient,
  analyzeFormClient,
  setPendingAnalyzeFormRequest,
  takePendingAnalyzeFormRequest,
  toAnalyzeFormRequest,
  type AnalyzeFormRequest,
} from '../analyze-form';
import type { PaceFrameSet } from '../frames';

beforeEach(() => {
  mockInvoke.mockReset();
});

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

/** A minimal fake `Response`-shaped object — all `invokeFunction` ever calls on
 *  `FunctionsHttpError.context` is `.json()`. Same helper as the delete-account suite's. */
function fakeJsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

const REAL_ANALYSIS_ID = '11111111-2222-4333-8444-555555555555';

describe('createAnalyzeFormClient (the real implementation)', () => {
  it('posts the request body to the analyze-form function and reports a 200 as a success', async () => {
    mockInvoke.mockResolvedValue({
      data: { result: proTierVideoResult, analysisId: REAL_ANALYSIS_ID, isFallback: false },
      error: null,
    } as never);

    const result = await createAnalyzeFormClient().submit(sampleRequest);

    expect(mockInvoke).toHaveBeenCalledWith('analyze-form', { method: 'POST', body: sampleRequest });
    expect(result).toEqual({
      ok: true,
      data: { kind: 'result', result: proTierVideoResult, analysisId: REAL_ANALYSIS_ID, isFallback: false },
    });
  });

  // Issue #45: an honest-partial fallback is a 200 SUCCESS in the same shape, differentiated only
  // by `isFallback`. Routing it to the failure branch would throw away a result the user's quota
  // has already been spent on.
  it('reports an honest-partial fallback as a success, not a failure', async () => {
    mockInvoke.mockResolvedValue({
      data: { result: proTierVideoResult, analysisId: REAL_ANALYSIS_ID, isFallback: true },
      error: null,
    } as never);

    const result = await createAnalyzeFormClient().submit(sampleRequest);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected the success branch');
    if (result.data.kind !== 'result') throw new Error('expected the result branch, not sample');
    expect(result.data.isFallback).toBe(true);
  });

  // THE #128 CASE, structurally. The original bug was a client handing the screen an `analysisId`
  // with no row behind it. We cannot prove a row exists from here — but we CAN refuse an id
  // `app/result/[id].tsx` would reject out of hand, which is what made the dead end silent.
  it('does NOT report success when analysisId is not a UUID', async () => {
    mockInvoke.mockResolvedValue({
      data: { result: proTierVideoResult, analysisId: 'mock-1783932324144', isFallback: false },
      error: null,
    } as never);

    const result = await createAnalyzeFormClient().submit(sampleRequest);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the failure branch');
    expect(result.error.code).toBe('unknown');
  });

  it('does NOT report success for a 200 body whose result fails the PACE structural check', async () => {
    mockInvoke.mockResolvedValue({
      data: { result: { pillars: 'not-an-object' }, analysisId: REAL_ANALYSIS_ID, isFallback: false },
      error: null,
    } as never);

    const result = await createAnalyzeFormClient().submit(sampleRequest);

    expect(result.ok).toBe(false);
  });

  // Issue #136 depends on this passing through untouched: `app/analyzing.tsx` keys the paywall
  // route off the server's own `quota_exceeded`, so narrowing or renaming codes here would break it.
  it.each([
    ['quota_exceeded', 'You have used all of your analyses.'],
    ['frame_cap_exceeded', 'That clip has more frames than your tier allows.'],
    ['too_many_failed_attempts', 'Too many failed attempts. Try again later.'],
    ['validation_failed', 'The analysis service did not return a usable result.'],
    ['a_future_server_code', 'Something the client has never heard of.'],
  ] as const)('passes a documented %s failure through verbatim', async (code, error) => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(fakeJsonResponse({ error, code })),
    } as never);

    const result = await createAnalyzeFormClient().submit(sampleRequest);

    expect(result).toEqual({ ok: false, error: { error, code } });
  });

  // A bare/HTML 404 is what an undeployed function returns. It must resolve as an honest failure,
  // never reject and never fabricate a server code.
  it('folds a non-2xx response with an unreadable body into an honest unknown failure', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError({
        json: async () => {
          throw new Error('not JSON');
        },
      } as unknown as Response),
    } as never);

    const result = await createAnalyzeFormClient().submit(sampleRequest);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the failure branch');
    expect(result.error.code).toBe('unknown');
  });

  it('resolves rather than rejecting when the request never reached the server', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('fetch failed') } as never);

    await expect(createAnalyzeFormClient().submit(sampleRequest)).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'unknown' }),
    });
  });
});

// Free tier's zero-model-call sample preview (captain-approved 2026-07-26). The wire body has NO
// `analysisId`/`isFallback` keys at all — see `AnalyzeFormSuccess`'s doc comment for why this is a
// structurally distinct `kind: 'sample'` branch, not a nullable field bolted onto the real shape.
describe('sample response (Free tier)', () => {
  it('parses a { result, isSample: true } body as kind: "sample"', async () => {
    mockInvoke.mockResolvedValue({
      data: { result: proTierVideoResult, isSample: true },
      error: null,
    } as never);

    const result = await createAnalyzeFormClient().submit(sampleRequest);

    expect(result).toEqual({ ok: true, data: { kind: 'sample', result: proTierVideoResult } });
  });

  it('does NOT report success for isSample: true whose result fails the PACE structural check', async () => {
    mockInvoke.mockResolvedValue({
      data: { result: { pillars: 'not-an-object' }, isSample: true },
      error: null,
    } as never);

    const result = await createAnalyzeFormClient().submit(sampleRequest);

    expect(result.ok).toBe(false);
  });

  // A real result body never carries isSample, so it must keep parsing as kind: 'result' — the
  // isSample check must not accidentally swallow the ordinary success path.
  it('does not affect parsing of an ordinary result response with no isSample key', async () => {
    mockInvoke.mockResolvedValue({
      data: { result: proTierVideoResult, analysisId: REAL_ANALYSIS_ID, isFallback: false },
      error: null,
    } as never);

    const result = await createAnalyzeFormClient().submit(sampleRequest);

    expect(result).toEqual({
      ok: true,
      data: { kind: 'result', result: proTierVideoResult, analysisId: REAL_ANALYSIS_ID, isFallback: false },
    });
  });
});

// THE REGRESSION GUARD FOR #128 ITSELF. The bug was never a wrong implementation — both clients
// were correct — it was the BINDING pointing at the mock. Assert the shipped binding calls the
// edge function, so rebinding it back to the mock fails here instead of in production.
describe('the analyzeFormClient binding', () => {
  it('is the real client — it calls the analyze-form edge function', async () => {
    mockInvoke.mockResolvedValue({
      data: { result: proTierVideoResult, analysisId: REAL_ANALYSIS_ID, isFallback: false },
      error: null,
    } as never);

    await analyzeFormClient.submit(sampleRequest);

    expect(mockInvoke).toHaveBeenCalledWith('analyze-form', { method: 'POST', body: sampleRequest });
  });
});

describe('createMockAnalyzeFormClient', () => {
  it('resolves ok:true with a structurally-valid, non-fallback PaceAnalysisOutcome for "success"', async () => {
    const client = createMockAnalyzeFormClient({ outcome: 'success', delayMs: 0 });

    const result = await client.submit(sampleRequest);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    if (result.data.kind !== 'result') throw new Error('expected the result branch, not sample');
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
    if (result.data.kind !== 'result') throw new Error('expected the result branch, not sample');
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

  // #128's tripwire, the direct counterpart of the delete-account suite's. This mock must be
  // unable to run in a release build. __DEV__ is true under Jest (react-native/jest/setup.js sets
  // it), which is what lets every test above construct the mock at all.
  it('refuses to run at all when __DEV__ is false', async () => {
    const original = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;

    try {
      const client = createMockAnalyzeFormClient({ outcome: 'success', delayMs: 0 });
      await expect(client.submit(sampleRequest)).rejects.toThrow(/never run outside a dev\/test build/);
    } finally {
      (globalThis as { __DEV__?: boolean }).__DEV__ = original;
    }
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
