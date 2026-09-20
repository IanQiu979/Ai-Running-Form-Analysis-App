/**
 * Honesty locks for the compare screen's delta panel, re-cut to V23 (2026-09-21) — the ring pair
 * this file used to lock is retired (`components/compare/pace-delta-panel.tsx`'s header).
 *
 * The bug class these exist for is the one issue #60 names by name and `lib/compare.ts` is built to
 * refuse: a pillar that is not-assessed on either side must never be drawn — or read out — as a
 * delta of zero. `lib/__tests__/compare.test.ts` already proves the arithmetic and the copy; what
 * is only provable HERE is the WIRING, i.e. that each row's accessible label carries each side's
 * own nullness rather than a coerced zero, which is exactly the "a screen-level test is the only
 * thing that can prove which arguments a screen actually passes downstream" case CLAUDE.md §
 * Testing describes.
 *
 * Per CLAUDE.md § Testing: `await render(...)` throughout.
 */
import { render, screen } from '@testing-library/react-native';

import { PaceDeltaPanel } from '../pace-delta-panel';
import { Copy } from '@/constants/copy';
import { PACE_PILLARS } from '@shared/pace';
import { pillarDeltaA11yLabel } from '@/lib/compare';
import { freeTierVideoResult, photoResult } from '@/lib/pace-fixtures';

// The earlier analysis scored all four pillars (posture 78, cadence 44); the later one is a photo,
// which can only ever report two (posture 82, cadence null). So Posture is a real +4 and Cadence is
// "nothing to compare" — one panel covering both branches.
async function renderPanel() {
  return render(<PaceDeltaPanel from={freeTierVideoResult} to={photoResult} testID="panel" />);
}

describe('a pillar scored on both sides', () => {
  it('states the delta in the deck’s own copy', async () => {
    await renderPanel();

    // 78 -> 82. The sign glyph and wording come from `formatPillarDelta`, never from this screen.
    expect(screen.getByText('+4 Posture')).toBeTruthy();
  });

  it('carries the certified a11y sentence on the row, not a loose numeral', async () => {
    await renderPanel();

    expect(screen.getByTestId('compare-delta-row-posture').props.accessibilityLabel).toBe(
      pillarDeltaA11yLabel('Posture', { kind: 'delta', delta: 4, fromScore: 78, toScore: 82 })
    );
  });
});

describe('a pillar not assessed on one side is never a zero', () => {
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

describe('the panel', () => {
  it('renders every pillar as its own row, naming the pillar once through the delta sentence', async () => {
    await renderPanel();

    for (const id of PACE_PILLARS) {
      expect(screen.getByTestId(`compare-delta-row-${id}`)).toBeTruthy();
    }
    expect(screen.queryByText('Posture')).toBeNull();
    expect(screen.queryByText('Cadence')).toBeNull();
    expect(screen.getByText('+4 Posture')).toBeTruthy();
  });
});
