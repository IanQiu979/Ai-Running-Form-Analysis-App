/**
 * Regression locks for `lib/pending-analysis.ts` (issue #140).
 *
 * The load-bearing cases, roughly in order of how badly a regression would hurt:
 *   1. Cross-account safety (`checkPendingAnalysis` describe block, "cross-account safety"): a
 *      marker written under one user must never be reconciled — routed, or even read past the
 *      guard — against a different or absent session. A regression here is exactly the "leak into
 *      another account's session" failure mode the issue calls out by name.
 *   2. The marker is cleared ONLY on an authoritative outcome (`delivered`/`released`) or a
 *      cross-account mismatch — never on `reserved`, "no row yet", or a transient read error. A
 *      regression that clears too eagerly reintroduces the exact "resurrect a stale analysis"
 *      failure the issue's requirement #4 warns against in the other direction: a real analysis
 *      whose marker got wiped while it was still genuinely in flight can never be reconciled on a
 *      later cold start.
 *   3. `interpretPendingAnalysisRow` never routes to a result whose stored `result`/`is_fallback`
 *      fails structural validation (CLAUDE.md: shape, never content) — mirrors
 *      `app/analyzing.tsx`'s own reconciliation guard for the identical case.
 *   4. Every failure path (a query error, a thrown exception, malformed stored JSON) resolves to a
 *      safe, non-throwing state rather than rejecting — a caller must never need its own try/catch
 *      around this module.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { fallbackOutcome, freeTierOutcome } from '../pace-fixtures';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn() },
}));

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;

// Re-imported after the mock is registered, matching this repo's established pattern
// (lib/__tests__/consent.test.ts, lib/__tests__/history.test.ts).
import {
  checkPendingAnalysis,
  clearPendingAnalysisMarker,
  getPendingAnalysisMarker,
  interpretPendingAnalysisRow,
  setPendingAnalysisMarker,
  type PendingAnalysisRow,
} from '../pending-analysis';

const USER_A = 'a0000000-0000-0000-0000-000000000001';
const USER_B = 'b0000000-0000-0000-0000-000000000002';
const IDEMPOTENCY_KEY = 'idempotency-key-1';
const ANALYSIS_ID = 'c0000000-0000-0000-0000-000000000003';

/** Mocks `.from('analyses').select(..).eq(..).maybeSingle()`. */
function mockSelectChain(result: { data: PendingAnalysisRow | null; error: { message: string } | null }) {
  const maybeSingle = jest.fn().mockResolvedValue(result);
  const eq = jest.fn().mockReturnValue({ maybeSingle });
  const select = jest.fn().mockReturnValue({ eq });
  mockFrom.mockReturnValue({ select } as never);
  return { select, eq, maybeSingle };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

// -------------------------------------------------------------------------------------------
// setPendingAnalysisMarker / getPendingAnalysisMarker / clearPendingAnalysisMarker
// -------------------------------------------------------------------------------------------

describe('marker persistence', () => {
  it('round-trips a written marker', async () => {
    await setPendingAnalysisMarker({ idempotencyKey: IDEMPOTENCY_KEY, userId: USER_A });

    await expect(getPendingAnalysisMarker()).resolves.toEqual({
      idempotencyKey: IDEMPOTENCY_KEY,
      userId: USER_A,
    });
  });

  it('returns null when nothing was ever written', async () => {
    await expect(getPendingAnalysisMarker()).resolves.toBeNull();
  });

  it('clearPendingAnalysisMarker removes a stored marker', async () => {
    await setPendingAnalysisMarker({ idempotencyKey: IDEMPOTENCY_KEY, userId: USER_A });
    await clearPendingAnalysisMarker();

    await expect(getPendingAnalysisMarker()).resolves.toBeNull();
  });

  it('clearPendingAnalysisMarker on an already-empty store is a safe no-op', async () => {
    await expect(clearPendingAnalysisMarker()).resolves.toBeUndefined();
  });

  it('discards and clears malformed JSON rather than throwing', async () => {
    await AsyncStorage.setItem('pace.pendingAnalysis.v1', '{not valid json');

    await expect(getPendingAnalysisMarker()).resolves.toBeNull();
    await expect(AsyncStorage.getItem('pace.pendingAnalysis.v1')).resolves.toBeNull();
  });

  it('discards and clears valid JSON that is missing the required fields', async () => {
    await AsyncStorage.setItem('pace.pendingAnalysis.v1', JSON.stringify({ idempotencyKey: IDEMPOTENCY_KEY }));

    await expect(getPendingAnalysisMarker()).resolves.toBeNull();
    await expect(AsyncStorage.getItem('pace.pendingAnalysis.v1')).resolves.toBeNull();
  });
});

// -------------------------------------------------------------------------------------------
// interpretPendingAnalysisRow — pure, no I/O.
// -------------------------------------------------------------------------------------------

describe('interpretPendingAnalysisRow', () => {
  it('returns pending for a null row (not found yet, or a transient read already folded to null)', () => {
    expect(interpretPendingAnalysisRow(null)).toEqual({ kind: 'pending' });
  });

  it('returns pending for a still-reserved row', () => {
    const row: PendingAnalysisRow = { id: ANALYSIS_ID, status: 'reserved', result: null, is_fallback: false };
    expect(interpretPendingAnalysisRow(row)).toEqual({ kind: 'pending' });
  });

  it('returns delivered with the validated outcome for a delivered row', () => {
    const row: PendingAnalysisRow = {
      id: ANALYSIS_ID,
      status: 'delivered',
      result: freeTierOutcome.result,
      is_fallback: false,
    };
    expect(interpretPendingAnalysisRow(row)).toEqual({
      kind: 'delivered',
      analysisId: ANALYSIS_ID,
      outcome: freeTierOutcome,
    });
  });

  it('routes an honest isFallback: true partial through the SAME delivered branch as a full result', () => {
    const row: PendingAnalysisRow = {
      id: ANALYSIS_ID,
      status: 'delivered',
      result: fallbackOutcome.result,
      is_fallback: true,
    };
    expect(interpretPendingAnalysisRow(row)).toEqual({
      kind: 'delivered',
      analysisId: ANALYSIS_ID,
      outcome: fallbackOutcome,
    });
  });

  // THE STRUCTURAL-VALIDATION LOCK. Never route to a broken result screen.
  it('returns pending, not delivered, for a delivered row whose result fails structural validation', () => {
    const row: PendingAnalysisRow = {
      id: ANALYSIS_ID,
      status: 'delivered',
      result: { garbage: true },
      is_fallback: false,
    };
    expect(interpretPendingAnalysisRow(row)).toEqual({ kind: 'pending' });
  });

  it('returns released with the analysis id for a released row', () => {
    const row: PendingAnalysisRow = { id: ANALYSIS_ID, status: 'released', result: null, is_fallback: false };
    expect(interpretPendingAnalysisRow(row)).toEqual({ kind: 'released', analysisId: ANALYSIS_ID });
  });
});

// -------------------------------------------------------------------------------------------
// checkPendingAnalysis — the impure wiring: marker + session + the live row.
// -------------------------------------------------------------------------------------------

describe('checkPendingAnalysis', () => {
  it('returns none and makes no query when there is no marker at all', async () => {
    await expect(checkPendingAnalysis(USER_A)).resolves.toEqual({ kind: 'none' });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  describe('cross-account safety', () => {
    it('returns none and clears the marker when the current session is a different user', async () => {
      await setPendingAnalysisMarker({ idempotencyKey: IDEMPOTENCY_KEY, userId: USER_A });

      await expect(checkPendingAnalysis(USER_B)).resolves.toEqual({ kind: 'none' });

      expect(mockFrom).not.toHaveBeenCalled();
      await expect(getPendingAnalysisMarker()).resolves.toBeNull();
    });

    it('returns none and clears the marker when nobody is signed in', async () => {
      await setPendingAnalysisMarker({ idempotencyKey: IDEMPOTENCY_KEY, userId: USER_A });

      await expect(checkPendingAnalysis(null)).resolves.toEqual({ kind: 'none' });

      expect(mockFrom).not.toHaveBeenCalled();
      await expect(getPendingAnalysisMarker()).resolves.toBeNull();
    });
  });

  describe('a matching session', () => {
    it('queries by idempotency_key, scoped to the analyses table', async () => {
      await setPendingAnalysisMarker({ idempotencyKey: IDEMPOTENCY_KEY, userId: USER_A });
      const { select, eq } = mockSelectChain({ data: null, error: null });

      await checkPendingAnalysis(USER_A);

      expect(mockFrom).toHaveBeenCalledWith('analyses');
      expect(select).toHaveBeenCalledWith('id, status, result, is_fallback');
      expect(eq).toHaveBeenCalledWith('idempotency_key', IDEMPOTENCY_KEY);
    });

    it('leaves the marker in place and returns pending when the row is not found yet', async () => {
      await setPendingAnalysisMarker({ idempotencyKey: IDEMPOTENCY_KEY, userId: USER_A });
      mockSelectChain({ data: null, error: null });

      await expect(checkPendingAnalysis(USER_A)).resolves.toEqual({ kind: 'pending' });
      await expect(getPendingAnalysisMarker()).resolves.toEqual({ idempotencyKey: IDEMPOTENCY_KEY, userId: USER_A });
    });

    it('leaves the marker in place and returns pending on a query error', async () => {
      await setPendingAnalysisMarker({ idempotencyKey: IDEMPOTENCY_KEY, userId: USER_A });
      mockSelectChain({ data: null, error: { message: 'network down' } });

      await expect(checkPendingAnalysis(USER_A)).resolves.toEqual({ kind: 'pending' });
      await expect(getPendingAnalysisMarker()).resolves.not.toBeNull();
    });

    it('leaves the marker in place and returns pending when the query throws', async () => {
      await setPendingAnalysisMarker({ idempotencyKey: IDEMPOTENCY_KEY, userId: USER_A });
      mockFrom.mockImplementation(() => {
        throw new Error('boom');
      });

      await expect(checkPendingAnalysis(USER_A)).resolves.toEqual({ kind: 'pending' });
      await expect(getPendingAnalysisMarker()).resolves.not.toBeNull();
    });

    it('leaves the marker in place and returns pending while the row is still reserved', async () => {
      await setPendingAnalysisMarker({ idempotencyKey: IDEMPOTENCY_KEY, userId: USER_A });
      mockSelectChain({
        data: { id: ANALYSIS_ID, status: 'reserved', result: null, is_fallback: false },
        error: null,
      });

      await expect(checkPendingAnalysis(USER_A)).resolves.toEqual({ kind: 'pending' });
      await expect(getPendingAnalysisMarker()).resolves.not.toBeNull();
    });

    it('clears the marker and returns the outcome when the row has delivered', async () => {
      await setPendingAnalysisMarker({ idempotencyKey: IDEMPOTENCY_KEY, userId: USER_A });
      mockSelectChain({
        data: { id: ANALYSIS_ID, status: 'delivered', result: freeTierOutcome.result, is_fallback: false },
        error: null,
      });

      await expect(checkPendingAnalysis(USER_A)).resolves.toEqual({
        kind: 'delivered',
        analysisId: ANALYSIS_ID,
        outcome: freeTierOutcome,
      });
      await expect(getPendingAnalysisMarker()).resolves.toBeNull();
    });

    // THE "NEVER A DEAD END" LOCK, the other half of the issue's own framing.
    it('clears the marker and returns released when the server gave up while nothing was watching', async () => {
      await setPendingAnalysisMarker({ idempotencyKey: IDEMPOTENCY_KEY, userId: USER_A });
      mockSelectChain({
        data: { id: ANALYSIS_ID, status: 'released', result: null, is_fallback: false },
        error: null,
      });

      await expect(checkPendingAnalysis(USER_A)).resolves.toEqual({ kind: 'released', analysisId: ANALYSIS_ID });
      await expect(getPendingAnalysisMarker()).resolves.toBeNull();
    });

    it('leaves the marker in place when a delivered row fails structural validation', async () => {
      await setPendingAnalysisMarker({ idempotencyKey: IDEMPOTENCY_KEY, userId: USER_A });
      mockSelectChain({
        data: { id: ANALYSIS_ID, status: 'delivered', result: { garbage: true }, is_fallback: false },
        error: null,
      });

      await expect(checkPendingAnalysis(USER_A)).resolves.toEqual({ kind: 'pending' });
      await expect(getPendingAnalysisMarker()).resolves.not.toBeNull();
    });
  });
});
