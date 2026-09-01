/**
 * Honesty locks for the compare screen's delta panel and its before/after ring pair.
 *
 * The bug class these exist for is the one issue #60 names by name and `lib/compare.ts` is built to
 * refuse: a pillar that is not-assessed on either side must never be drawn — or read out — as a
 * delta of zero. `lib/__tests__/compare.test.ts` already proves the arithmetic and the copy; what
 * is only provable HERE is the WIRING, i.e. that the rendered rings receive each side's own
 * nullness rather than a coerced zero, which is exactly the "a screen-level test is the only thing
 * that can prove which arguments a screen actually passes downstream" case CLAUDE.md § Testing
 * describes.
 *
 * Per CLAUDE.md § Testing: `await render(...)`, and `includeHiddenElements` throughout — every SVG
 * node below is correctly hidden from the a11y tree by `<ArcRing>` itself.
 */
import { render, screen } from '@testing-library/react-native';

import { PaceDeltaPanel } from '../pace-delta-panel';
import { Copy } from '@/constants/copy';
import { pillarDeltaA11yLabel } from '@/lib/compare';
import { freeTierVideoResult, photoResult } from '@/lib/pace-fixtures';

const HIDDEN = { includeHiddenElements: true } as const;

// The earlier analysis scored all four pillars (posture 78, cadence 44); the later one is a photo,
// which can only ever report two (posture 82, cadence null). So Posture is a real +4 and Cadence is
// "nothing to compare" — one panel covering both branches.
function renderPanel() {
  return render(<PaceDeltaPanel from={freeTierVideoResult} to={photoResult} testID="panel" />);
}

describe('a pillar scored on both sides', () => {
  it('draws both arcs and shows the later score inside the ring', async () => {
    await renderPanel();

    expect(screen.getByTestId('compare-delta-ring-posture-fill', HIDDEN)).toBeTruthy();
    expect(screen.getByTestId('compare-delta-ring-posture-before-fill', HIDDEN)).toBeTruthy();
    expect(screen.getByTestId('compare-delta-ring-posture-score', HIDDEN).props.children).toBe(82);
  });

  it('states the delta in the deck’s own copy', async () => {
    await renderPanel();

    // 78 -> 82. The sign glyph and wording come from `formatPillarDelta`, never from this screen.
    expect(screen.getByText('+4 Posture')).toBeTruthy();
  });
});

describe('a pillar not assessed on one side is never a zero', () => {
  it('mounts NO fill arc for the missing side, and no numeral at all', async () => {
    await renderPanel();

    // The later side is null: no outer fill, no centre numeral. The earlier side WAS scored (44),
    // so its inner arc is still drawn — the ring tells the two sides apart rather than blanking.
    expect(screen.queryByTestId('compare-delta-ring-cadence-fill', HIDDEN)).toBeNull();
    expect(screen.queryByTestId('compare-delta-ring-cadence-score', HIDDEN)).toBeNull();
    expect(screen.getByTestId('compare-delta-ring-cadence-before-fill', HIDDEN)).toBeTruthy();
  });

  it('dashes the missing side’s track — a different picture from “filled at 0%”', async () => {
    await renderPanel();

    expect(screen.getByTestId('compare-delta-ring-cadence-track', HIDDEN).props.strokeDasharray).toEqual([
      5, 5,
    ]);
    expect(screen.getByTestId('compare-delta-ring-posture-track', HIDDEN).props.strokeDasharray).toBeUndefined();
  });

  it('says so in words, and announces the honest sentence — never “No change”', async () => {
    await renderPanel();

    // Two of them: a photo can report neither Cadence nor Elasticity.
    expect(screen.getAllByText(Copy.compare.delta.notAssessed)).toHaveLength(2);
    expect(screen.queryByText(Copy.compare.delta.none)).toBeNull();
    expect(screen.getByTestId('compare-delta-row-cadence').props.accessibilityLabel).toBe(
      pillarDeltaA11yLabel('Cadence', { kind: 'notAssessed' })
    );
  });
});

describe('the motif', () => {
  it('wears the corner ripple, so the deltas read as the same system as the readouts above them', async () => {
    await renderPanel();

    expect(screen.getByTestId('panel-ornament', HIDDEN)).toBeTruthy();
  });
});
