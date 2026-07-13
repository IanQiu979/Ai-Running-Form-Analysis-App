/**
 * Locks for `lib/compare.ts` (issue #60). THE PROPERTY THAT MATTERS MOST IN THIS FILE (mirroring
 * `lib/pace-readout.test.ts`'s own framing for the single-result screen): a pillar that is `null`
 * ("not assessed") in EITHER of the two compared results must diff to `{ kind: 'notAssessed' }`,
 * NEVER a fabricated `{ kind: 'delta', delta: 0 }` — and the copy it renders as must never be
 * indistinguishable from a genuine zero-change delta. Several tests below exist specifically to
 * pin that trap, using real (non-null) scores on one side so a buggy implementation that
 * accidentally coerced `null` to `0` and subtracted would produce a plausible-looking, but
 * fabricated, non-zero OR zero delta instead of failing loudly.
 */
import {
  computePaceDeltas,
  computePillarDelta,
  formatPillarDelta,
  orderByCreatedAt,
  pillarDeltaA11yLabel,
  type PillarDelta,
} from '../compare';
import { Copy } from '@/constants/copy';
import { allNotAssessedResult, freeTierOutcome, freeTierVideoResult, photoResult } from '@/lib/pace-fixtures';
import type { HistoryListItem } from '@/lib/history';

function historyItem(id: string, createdAt: string, outcome = freeTierOutcome): HistoryListItem {
  return { id, createdAt, mediaType: 'photo', outcome, mediaPaths: [] };
}

// -------------------------------------------------------------------------------------------
// computePillarDelta
// -------------------------------------------------------------------------------------------

describe('computePillarDelta', () => {
  it('computes a positive delta when the later score is higher', () => {
    // freeTierVideoResult.posture = 78, photoResult.posture = 82.
    const delta = computePillarDelta(freeTierVideoResult.pillars.posture, photoResult.pillars.posture);
    expect(delta).toEqual({ kind: 'delta', delta: 4, fromScore: 78, toScore: 82 });
  });

  it('computes a negative delta when the later score is lower', () => {
    // photoResult.armSwing = 70, freeTierVideoResult.armSwing = 64.
    const delta = computePillarDelta(photoResult.pillars.armSwing, freeTierVideoResult.pillars.armSwing);
    expect(delta).toEqual({ kind: 'delta', delta: -6, fromScore: 70, toScore: 64 });
  });

  it('computes a genuine zero delta for two identical real scores (not the same object)', () => {
    // freeTierVideoResult.elasticity and photoResult... are different objects; use two pillars
    // that are both genuinely scored 78 to prove a real "no change" is distinguishable from the
    // not-assessed case below by more than just "delta happens to be 0".
    const bothSeventyEight = computePillarDelta(
      { score: 78, band: 'good', feedback: null, flags: [], drills: [] },
      { score: 78, band: 'good', feedback: null, flags: [], drills: [] }
    );
    expect(bothSeventyEight).toEqual({ kind: 'delta', delta: 0, fromScore: 78, toScore: 78 });
  });

  // --- THE TRAP (issue #60's own words) ---------------------------------------------------
  it('never fabricates a delta when the FIRST side is not assessed, even though the second side has a real score', () => {
    // photoResult.cadence is not-assessed (score: null); freeTierVideoResult.cadence is a real
    // 44. A buggy implementation that coerced null to 0 would compute `44 - 0 = 44` here — a
    // fabricated number this test must catch.
    const delta = computePillarDelta(photoResult.pillars.cadence, freeTierVideoResult.pillars.cadence);
    expect(delta).toEqual({ kind: 'notAssessed' });
  });

  it('never fabricates a delta when the SECOND side is not assessed, even though the first side has a real score', () => {
    // The mirror image of the case above — freeTierVideoResult.cadence (44) -> photoResult.cadence
    // (null). A buggy `0 - 44 = -44` must not appear here either.
    const delta = computePillarDelta(freeTierVideoResult.pillars.cadence, photoResult.pillars.cadence);
    expect(delta).toEqual({ kind: 'notAssessed' });
  });

  it('never fabricates a delta when BOTH sides are not assessed', () => {
    const delta = computePillarDelta(allNotAssessedResult.pillars.posture, allNotAssessedResult.pillars.cadence);
    expect(delta).toEqual({ kind: 'notAssessed' });
  });
});

describe('computePaceDeltas', () => {
  it('diffs all four pillars, mixing real deltas with honest not-assessed pillars in one result', () => {
    // photoResult has two real scores (posture/armSwing) and two structurally not-assessed
    // pillars (cadence/elasticity — a photo cannot show motion-over-time pillars). Diffing it
    // against a fully-scored video result must keep that mix intact, not paper over it.
    const deltas = computePaceDeltas(freeTierVideoResult, photoResult);

    expect(deltas.posture).toEqual({ kind: 'delta', delta: 4, fromScore: 78, toScore: 82 });
    expect(deltas.armSwing).toEqual({ kind: 'delta', delta: 6, fromScore: 64, toScore: 70 });
    expect(deltas.cadence).toEqual({ kind: 'notAssessed' });
    expect(deltas.elasticity).toEqual({ kind: 'notAssessed' });
  });
});

// -------------------------------------------------------------------------------------------
// formatPillarDelta / pillarDeltaA11yLabel — copy formatting
// -------------------------------------------------------------------------------------------

describe('formatPillarDelta', () => {
  it('formats a positive delta with the deck template', () => {
    const delta: PillarDelta = { kind: 'delta', delta: 6, fromScore: 64, toScore: 70 };
    expect(formatPillarDelta('Posture', delta)).toBe(
      Copy.compare.delta.positive.replace('{n}', '6').replace('{pillar}', 'Posture')
    );
  });

  it('formats a negative delta with the deck template, magnitude only (the glyph carries the sign)', () => {
    const delta: PillarDelta = { kind: 'delta', delta: -6, fromScore: 70, toScore: 64 };
    expect(formatPillarDelta('Cadence', delta)).toBe(
      Copy.compare.delta.negative.replace('{n}', '6').replace('{pillar}', 'Cadence')
    );
    // Never a literal "-6" (hyphen-minus) — the deck requires U+2212 MINUS SIGN specifically.
    expect(formatPillarDelta('Cadence', delta)).not.toContain('-6');
  });

  it('formats a genuine zero delta as "No change"', () => {
    const delta: PillarDelta = { kind: 'delta', delta: 0, fromScore: 78, toScore: 78 };
    expect(formatPillarDelta('Elasticity', delta)).toBe(Copy.compare.delta.none);
  });

  // --- THE TRAP ------------------------------------------------------------------------------
  it('formats a not-assessed diff as its own honest string, never as "No change" or a numeral', () => {
    const delta: PillarDelta = { kind: 'notAssessed' };
    const formatted = formatPillarDelta('Cadence', delta);
    expect(formatted).toBe(Copy.compare.delta.notAssessed);
    expect(formatted).not.toBe(Copy.compare.delta.none);
    expect(formatted).not.toMatch(/\d/);
  });
});

describe('pillarDeltaA11yLabel', () => {
  it('announces the full delta sentence for an assessed pair', () => {
    const delta: PillarDelta = { kind: 'delta', delta: -6, fromScore: 70, toScore: 64 };
    expect(pillarDeltaA11yLabel('Arm swing', delta)).toBe(
      Copy.compare.delta.a11yLabel
        .replace('{pillar}', 'Arm swing')
        .replace('{delta}', '-6')
        .replace('{oldScore}', '70')
        .replace('{newScore}', '64')
    );
  });

  // --- THE TRAP ------------------------------------------------------------------------------
  it('never renders a digit when either side is not assessed — no fabricated score in the announcement', () => {
    const label = pillarDeltaA11yLabel('Cadence', { kind: 'notAssessed' });
    expect(label).toBe(Copy.compare.delta.notAssessedA11yLabel.replace('{pillar}', 'Cadence'));
    expect(label).not.toMatch(/\d/);
  });
});

// -------------------------------------------------------------------------------------------
// orderByCreatedAt
// -------------------------------------------------------------------------------------------

describe('orderByCreatedAt', () => {
  it('returns [older, newer] when given newest-first', () => {
    const older = historyItem('a', '2026-07-01T00:00:00.000Z');
    const newer = historyItem('b', '2026-07-10T00:00:00.000Z');
    expect(orderByCreatedAt(newer, older)).toEqual([older, newer]);
  });

  it('returns [older, newer] when given oldest-first (already in order)', () => {
    const older = historyItem('a', '2026-07-01T00:00:00.000Z');
    const newer = historyItem('b', '2026-07-10T00:00:00.000Z');
    expect(orderByCreatedAt(older, newer)).toEqual([older, newer]);
  });

  it('is stable (first argument first) when both timestamps are identical', () => {
    const first = historyItem('a', '2026-07-01T00:00:00.000Z');
    const second = historyItem('b', '2026-07-01T00:00:00.000Z');
    expect(orderByCreatedAt(first, second)).toEqual([first, second]);
  });
});
