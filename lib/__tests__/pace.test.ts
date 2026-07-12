/**
 * Regression locks for `lib/pace.ts` (issue #43).
 *
 * This is the shared type contract #44, #45, #46, #56, and #60 all build against, so the two
 * things this suite exists to protect are:
 *   1. The honest-failure contract — a pillar the model did not (or could not) assess must be
 *      representable as `score: null`, never a fabricated number, and `score`/`band` must be
 *      null or non-null TOGETHER (the "hollow bar vs. colored bar" rule — see case group 2).
 *   2. `isFallback` is NOT re-derivable from pillar null-counts, and this file must not start
 *      cross-checking them — see case group 4's regression lock, which documents exactly why
 *      (a legitimate photo submission and a genuine retry-fallback produce byte-identical
 *      `PacePillarResult` shapes by design).
 *
 * The numeric constants (case group 5) are locked against the exact values in
 * `docs/architecture.md` "Planned — media pipeline" and issue #45's decision table — a change to
 * either should be a deliberate, visible diff here, not a silent drift.
 */
import {
  PACE_FRAME_CAP,
  PACE_MAX_REQUEST_BODY_BYTES,
  PACE_MIN_ASSESSED_PILLARS_FOR_PARTIAL,
  PACE_PILLARS,
  type PaceAnalysisOutcome,
  type PaceDrill,
  type PaceInjuryFlag,
  type PacePillarResult,
  type PaceResult,
  isPaceAnalysisOutcome,
  isPaceResult,
} from '../pace';

/** A fully-assessed pillar with no flags/drills — the Free-tier shape. */
function assessedPillar(overrides: Partial<PacePillarResult> = {}): PacePillarResult {
  return {
    score: 72,
    band: 'good',
    feedback: "Your foot's landing a bit ahead of you — here's the fix.",
    flags: [],
    drills: [],
    ...overrides,
  };
}

/** A not-assessed pillar — score/band/feedback all null, the shared "not assessed" shape. */
function notAssessedPillar(reason: PacePillarResult['notAssessedReason'] = 'needsVideo'): PacePillarResult {
  return {
    score: null,
    band: null,
    feedback: null,
    notAssessedReason: reason,
    flags: [],
    drills: [],
  };
}

function validResult(overrides: Partial<Record<(typeof PACE_PILLARS)[number], PacePillarResult>> = {}): PaceResult {
  return {
    pillars: {
      posture: assessedPillar(),
      armSwing: assessedPillar({ score: 65, band: 'mid' }),
      cadence: assessedPillar({ score: 80, band: 'good' }),
      elasticity: assessedPillar({ score: 55, band: 'mid' }),
      ...overrides,
    },
    overall: { score: 68, band: 'mid' },
  };
}

describe('isPaceResult', () => {
  // Case 1: the happy path — all four pillars assessed, valid overall.
  it('accepts a fully-assessed result', () => {
    expect(isPaceResult(validResult())).toBe(true);
  });

  // Case 2: the medium-limitation path — a photo legitimately cannot show Cadence/Elasticity.
  // This must validate cleanly with isFallback nowhere in sight; see the file's own doc comment
  // on why "not assessed" here looks identical to a retry-fallback "not assessed".
  it('accepts a result where some pillars are honestly not assessed (photo medium limitation)', () => {
    const result = validResult({
      cadence: notAssessedPillar('needsVideo'),
      elasticity: notAssessedPillar('needsVideo'),
    });

    expect(isPaceResult(result)).toBe(true);
  });

  // Case 3: a pillar can be not-assessed for a reason string this file has never seen before —
  // rejecting on an unrecognized (but well-typed) reason would be over-tight content validation.
  it('accepts a notAssessedReason value outside the known "angle"/"needsVideo" set', () => {
    const result = validResult({
      posture: notAssessedPillar('lighting_too_dark' as PacePillarResult['notAssessedReason']),
    });

    expect(isPaceResult(result)).toBe(true);
  });

  // Case 4: the core honest-failure rule — never a fabricated score. score: null must never
  // carry a band.
  it('rejects a not-assessed pillar (score: null) that still carries a band', () => {
    const result = validResult({
      posture: { score: null, band: 'strong', feedback: null, flags: [], drills: [] },
    });

    expect(isPaceResult(result)).toBe(false);
  });

  // Case 5: the mirror of case 4 — a real score with no band is a shape the result screen
  // cannot render (no color, no bar length source), not just untidy content.
  it('rejects an assessed pillar (real score) with a null band', () => {
    const result = validResult({
      posture: { score: 72, band: null, feedback: 'Solid.', flags: [], drills: [] },
    });

    expect(isPaceResult(result)).toBe(false);
  });

  // Case 6: never a fabricated placeholder in place of null. This is the exact Echo V1 mistake
  // (`planning/03-engineering-requirements.md`: the tolerant parser "fabricates score 75").
  it('rejects a fabricated score used as a stand-in for "not assessed" (e.g. 0) with no band', () => {
    const result = validResult({
      posture: { score: 0, band: null, feedback: null, flags: [], drills: [] },
    });

    expect(isPaceResult(result)).toBe(false);
  });

  it.each([-1, 101, 150])('rejects a pillar score out of the 0-100 range (%d)', (score) => {
    const result = validResult({
      posture: { score, band: 'strong', feedback: 'x', flags: [], drills: [] },
    });

    expect(isPaceResult(result)).toBe(false);
  });

  it('rejects a non-finite pillar score (NaN)', () => {
    const result = validResult({
      posture: { score: NaN, band: 'strong', feedback: 'x', flags: [], drills: [] },
    });

    expect(isPaceResult(result)).toBe(false);
  });

  // Case 7: a required pillar key missing entirely from the response.
  it('rejects a result missing one of the four required pillar keys', () => {
    const result = validResult();
    const broken = { ...result, pillars: { ...result.pillars } } as unknown as Record<string, unknown>;
    delete (broken.pillars as Record<string, unknown>).elasticity;

    expect(isPaceResult(broken)).toBe(false);
  });

  // Case 8: flags/drills are paid-tier content — Free renders an empty array, never omits it,
  // and this must validate as a normal, complete shape (not "missing" content).
  it('accepts empty flags/drills arrays (Free tier)', () => {
    expect(isPaceResult(validResult())).toBe(true);
  });

  it('accepts well-shaped flags and drills', () => {
    const flag: PaceInjuryFlag = { pattern: 'Overstriding', detail: 'Foot lands well ahead of the hips.' };
    const drill: PaceDrill = { name: 'Wall Forward-Lean Drill', instructions: 'Stand facing a wall...' };
    const result = validResult({
      posture: assessedPillar({ flags: [flag], drills: [drill] }),
    });

    expect(isPaceResult(result)).toBe(true);
  });

  it('rejects a flag missing its "detail" field', () => {
    const result = validResult({
      posture: assessedPillar({ flags: [{ pattern: 'Overstriding' } as unknown as PaceInjuryFlag] }),
    });

    expect(isPaceResult(result)).toBe(false);
  });

  it('rejects a drill missing its "instructions" field', () => {
    const result = validResult({
      posture: assessedPillar({ drills: [{ name: 'Wall Forward-Lean Drill' } as unknown as PaceDrill] }),
    });

    expect(isPaceResult(result)).toBe(false);
  });

  // Case 9: additive, unrecognized keys are forward-compatible, not a violation.
  it('ignores unknown extra keys on the pillars object', () => {
    const result = validResult();
    const withExtra = {
      ...result,
      pillars: { ...result.pillars, futurePillar: assessedPillar() },
    };

    expect(isPaceResult(withExtra)).toBe(true);
  });

  // Case 10: overall follows the same score/band co-occurrence rule as every pillar.
  it('accepts overall: { score: null, band: null } when every pillar is not assessed', () => {
    const result: PaceResult = {
      pillars: {
        posture: notAssessedPillar('angle'),
        armSwing: notAssessedPillar('angle'),
        cadence: notAssessedPillar('needsVideo'),
        elasticity: notAssessedPillar('needsVideo'),
      },
      overall: { score: null, band: null },
    };

    expect(isPaceResult(result)).toBe(true);
  });

  it('rejects overall with a score but no band', () => {
    const result = validResult();
    const broken = { ...result, overall: { score: 68, band: null } };

    expect(isPaceResult(broken)).toBe(false);
  });

  // Case 11: obviously-wrong top-level shapes. Each row is wrapped in its own tuple — Jest's
  // `.each` spreads a bare array row as multiple arguments, and `[]`/an array value would
  // otherwise be misread as zero arguments instead of "the value under test is an array".
  it.each([[null], [undefined], ['a string'], [42], [[]]])('rejects a non-object value (%p)', (value) => {
    expect(isPaceResult(value)).toBe(false);
  });
});

describe('isPaceAnalysisOutcome', () => {
  it('accepts a fully-assessed result with isFallback: false', () => {
    const outcome: PaceAnalysisOutcome = { result: validResult(), isFallback: false };

    expect(isPaceAnalysisOutcome(outcome)).toBe(true);
  });

  // Case 12: the honest-partial shape from issue #45 — >=2 pillars parsed, the rest null,
  // clearly labelled isFallback: true.
  it('accepts a partial result (>=2 pillars parsed) with isFallback: true', () => {
    const outcome: PaceAnalysisOutcome = {
      result: validResult({
        cadence: notAssessedPillar('needsVideo'),
        elasticity: notAssessedPillar('needsVideo'),
      }),
      isFallback: true,
    };

    expect(isPaceAnalysisOutcome(outcome)).toBe(true);
  });

  // Case 13: THE regression lock referenced in the file's own doc comment. A fully-assessed,
  // no-retry-needed result and a genuine fallback are structurally indistinguishable by pillar
  // count alone, so this function must not reject either isFallback value for the same result
  // shape. If someone "fixes" isPaceAnalysisOutcome to cross-check isFallback against null
  // counts, this is the test that catches the legitimate photo-submission case it would break.
  it('does not cross-check isFallback against how many pillars are assessed, either direction', () => {
    const fullyAssessed = validResult();
    const partiallyAssessed = validResult({
      cadence: notAssessedPillar('needsVideo'),
      elasticity: notAssessedPillar('needsVideo'),
    });

    expect(isPaceAnalysisOutcome({ result: fullyAssessed, isFallback: true })).toBe(true);
    expect(isPaceAnalysisOutcome({ result: partiallyAssessed, isFallback: false })).toBe(true);
  });

  it('rejects a missing isFallback field', () => {
    expect(isPaceAnalysisOutcome({ result: validResult() })).toBe(false);
  });

  it('rejects a non-boolean isFallback value', () => {
    expect(isPaceAnalysisOutcome({ result: validResult(), isFallback: 'true' })).toBe(false);
  });

  it('rejects an outcome whose result is structurally invalid', () => {
    const brokenResult = validResult({
      posture: { score: null, band: 'strong', feedback: null, flags: [], drills: [] },
    });

    expect(isPaceAnalysisOutcome({ result: brokenResult, isFallback: true })).toBe(false);
  });
});

describe('shared constants', () => {
  // Case 14: locked against docs/architecture.md "Planned — media pipeline" — "Frame count per
  // tier: Free 1 / Pro 5 / Elite 8".
  it('PACE_FRAME_CAP matches Free 1 / Pro 5 / Elite 8', () => {
    expect(PACE_FRAME_CAP).toEqual({ free: 1, pro: 5, elite: 8 });
  });

  // Case 15: locked against the same doc — "total request body ≤5MB".
  it('PACE_MAX_REQUEST_BODY_BYTES is 5MB', () => {
    expect(PACE_MAX_REQUEST_BODY_BYTES).toBe(5 * 1024 * 1024);
  });

  // Case 16: locked against issue #45's decision table — "Honest partial (>=2 pillars parsed)".
  it('PACE_MIN_ASSESSED_PILLARS_FOR_PARTIAL is 2', () => {
    expect(PACE_MIN_ASSESSED_PILLARS_FOR_PARTIAL).toBe(2);
  });

  it('PACE_PILLARS is the canonical P-A-C-E order', () => {
    expect(PACE_PILLARS).toEqual(['posture', 'armSwing', 'cadence', 'elasticity']);
  });
});
