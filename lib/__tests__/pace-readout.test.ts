/**
 * Locks for `lib/pace-readout.ts` (issue #56). The property that matters most in this file: a
 * not-assessed pillar's `score`/`band` never gets coerced into a numeral anywhere in these
 * helpers — `pillarA11yLabel`/`overallA11yLabel` produce a sentence with no digit in it, not
 * "null out of 100" or "0 out of 100".
 */
import {
  countAssessedPillars,
  formatPartialBannerBody,
  isRevealTriggered,
  notAssessedCopy,
  overallA11yLabel,
  pillarA11yLabel,
  pillarDetailA11yLabel,
  pillarLabel,
  pillarLetter,
} from '../pace-readout';
import { Copy } from '@/constants/copy';
import {
  allNotAssessedResult,
  fallbackResult,
  photoResult,
  poorFramingPhotoResult,
  proTierVideoResult,
} from '@/lib/pace-fixtures';

describe('countAssessedPillars', () => {
  it('counts all four for a fully-scored video result', () => {
    expect(countAssessedPillars(proTierVideoResult)).toBe(4);
  });

  it('counts exactly two for a photo result (Cadence + Elasticity are structurally unassessable)', () => {
    expect(countAssessedPillars(photoResult)).toBe(2);
  });

  it('counts one for a badly-framed photo (Posture also fails)', () => {
    expect(countAssessedPillars(poorFramingPhotoResult)).toBe(1);
  });

  it('counts zero when every pillar is not assessed', () => {
    expect(countAssessedPillars(allNotAssessedResult)).toBe(0);
  });

  it('counts two for the fallback fixture, matching PACE_MIN_ASSESSED_PILLARS_FOR_PARTIAL', () => {
    expect(countAssessedPillars(fallbackResult)).toBe(2);
  });
});

describe('notAssessedCopy', () => {
  it('maps "angle" to the deck string', () => {
    expect(notAssessedCopy('angle')).toBe(Copy.result.pillar.notAssessed.angle);
  });

  it('maps "needsVideo" to the deck string', () => {
    expect(notAssessedCopy('needsVideo')).toBe(Copy.result.pillar.notAssessed.needsVideo);
  });

  it('falls back to the generic string for an unnamed reason instead of dropping the pillar', () => {
    // Cast: pace.ts's own validator deliberately does not restrict notAssessedReason to exactly
    // the two known values (see its doc comment) — this proves the client honors that.
    expect(notAssessedCopy('some-future-reason' as never)).toBe(Copy.result.pillar.notAssessed.generic);
  });

  it('falls back to the generic string when no reason is given at all', () => {
    expect(notAssessedCopy(undefined)).toBe(Copy.result.pillar.notAssessed.generic);
  });
});

describe('pillarLabel / pillarLetter', () => {
  it('returns the deck label for every pillar', () => {
    expect(pillarLabel('posture')).toBe('Posture');
    expect(pillarLabel('armSwing')).toBe('Arm swing');
    expect(pillarLabel('cadence')).toBe('Cadence');
    expect(pillarLabel('elasticity')).toBe('Elasticity');
  });

  it('returns the PACE-acronym letter for every pillar', () => {
    expect(pillarLetter('posture')).toBe('P');
    expect(pillarLetter('armSwing')).toBe('A');
    expect(pillarLetter('cadence')).toBe('C');
    expect(pillarLetter('elasticity')).toBe('E');
  });
});

describe('pillarA11yLabel', () => {
  it('announces score + band for an assessed pillar', () => {
    const pillar = proTierVideoResult.pillars.posture;
    expect(pillarA11yLabel('Posture', pillar)).toBe(`Posture, ${pillar.score} out of 100, Solid.`);
  });

  it('never renders a digit for a not-assessed pillar — no fabricated score in the announcement', () => {
    const label = pillarA11yLabel('Cadence', photoResult.pillars.cadence);
    expect(label).toBe(`Cadence. ${Copy.result.pillar.notAssessed.needsVideo}`);
    expect(label).not.toMatch(/\d/);
  });

  it('uses the angle reason for a badly-framed pillar', () => {
    const label = pillarA11yLabel('Posture', poorFramingPhotoResult.pillars.posture);
    expect(label).toBe(`Posture. ${Copy.result.pillar.notAssessed.angle}`);
  });
});

describe('pillarDetailA11yLabel', () => {
  it('names the pillar the detail-modal info button opens', () => {
    expect(pillarDetailA11yLabel('Posture')).toBe(Copy.result.pillar.detail.a11yLabel.replace('{pillar}', 'Posture'));
    expect(pillarDetailA11yLabel('Posture')).toBe('Posture details');
  });

  it('templates cleanly for every pillar label', () => {
    expect(pillarDetailA11yLabel('Arm swing')).toBe('Arm swing details');
    expect(pillarDetailA11yLabel('Cadence')).toBe('Cadence details');
    expect(pillarDetailA11yLabel('Elasticity')).toBe('Elasticity details');
  });
});

describe('overallA11yLabel', () => {
  it('announces the overall score + band when assessed', () => {
    expect(overallA11yLabel(proTierVideoResult.overall)).toBe(
      `Overall, ${proTierVideoResult.overall.score} out of 100, Developing.`
    );
  });

  it('never renders a digit when the overall is not assessed', () => {
    const label = overallA11yLabel(allNotAssessedResult.overall);
    expect(label).not.toMatch(/\d/);
    expect(label).toBe(`Overall. ${Copy.result.pillar.notAssessed.generic}`);
  });
});

describe('formatPartialBannerBody', () => {
  it('interpolates the assessed-pillar count into the deck template', () => {
    expect(formatPartialBannerBody(2, 'video')).toBe(
      "We could confidently score 2 of 4 pillars from this clip. The rest are marked not assessed — we don't guess at a score."
    );
  });

  it('says "photo" instead of "clip" for a photo submission (M3, v23-ux-audit-r1)', () => {
    expect(formatPartialBannerBody(2, 'photo')).toBe(
      "We could confidently score 2 of 4 pillars from this photo. The rest are marked not assessed — we don't guess at a score."
    );
  });
});

describe('isRevealTriggered (Phase 2 plan Task 5 — moment 3 sequencing)', () => {
  it('does not trigger before layout, regardless of revealReady', () => {
    expect(isRevealTriggered(false, true)).toBe(false);
    expect(isRevealTriggered(false, false)).toBe(false);
  });

  it('does not trigger after layout while revealReady is still false — waiting on the hero annotations to finish drawing', () => {
    expect(isRevealTriggered(true, false)).toBe(false);
  });

  it('triggers once both layout has happened and revealReady is true', () => {
    expect(isRevealTriggered(true, true)).toBe(true);
  });
});
