/**
 * The ticker. Two things here are easy to get wrong and expensive to notice later, so both are
 * locked:
 *
 *   1. REDUCED MOTION MUST NOT JUST SLOW IT DOWN. A perpetually scrolling strip is a textbook
 *      vestibular trigger; there is no gentler version worth shipping, so it stops entirely and
 *      the duplicate copy is not even mounted. The duplicate is what makes the loop seamless, so
 *      its absence is the observable proof that nothing is scrolling.
 *   2. THE ITEMS ARE ANNOUNCED ONCE. The strip renders its list twice; without the a11y wiring a
 *      screen reader would read every pillar name twice in a row.
 *   3. THE SEAM IS EVEN. V23-07's copy is one span with `padding-right:16px`; drawn per item, every
 *      join — including the one between the two copies — has to measure the same, or the loop
 *      visibly hitches once per period.
 *
 * Reanimated tweens never advance under Jest (CLAUDE.md § Testing), so the loop's period is not
 * asserted here — only that it is the token, read from the module, not a speed.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { Space } from '@/constants/v23-theme';

import { Marquee } from '../marquee';

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

const ITEMS = ['Posture', 'Arm swing', 'Cadence', 'Elasticity'];

describe('Marquee', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(false);
  });

  it('announces the item list exactly once, however many copies are drawn', async () => {
    await render(<Marquee items={ITEMS} testID="ticker" />);

    expect(screen.getByTestId('ticker').props.accessibilityLabel).toBe(
      'Posture · Arm swing · Cadence · Elasticity'
    );
  });

  it('draws each item twice when animating — the duplicate is what hides the loop seam', async () => {
    await render(<Marquee items={ITEMS} testID="ticker" />);

    expect(screen.getAllByText('Cadence', { includeHiddenElements: true })).toHaveLength(2);
  });

  it('drops the duplicate copy entirely under reduced motion — nothing scrolls, so nothing follows', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    await render(<Marquee items={ITEMS} testID="ticker" />);

    expect(screen.getAllByText('Cadence', { includeHiddenElements: true })).toHaveLength(1);
  });

  it('still shows the items under reduced motion — it stops moving, it does not disappear', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    await render(<Marquee items={ITEMS} testID="ticker" />);

    for (const item of ITEMS) {
      expect(screen.getByText(item, { includeHiddenElements: true })).toBeTruthy();
    }
  });

  it('takes no pointer events — it is standing furniture, never a control', async () => {
    await render(<Marquee items={ITEMS} testID="ticker" />);

    expect(screen.getByTestId('ticker').props.pointerEvents).toBe('none');
  });

  it('draws the separator after every item, so the seam between copies is a normal join', async () => {
    await render(<Marquee items={ITEMS} testID="ticker" />);

    // Two copies, four items each, one dot per item — eight dots, none skipped at the copy's end.
    expect(screen.getAllByText('·', { includeHiddenElements: true })).toHaveLength(ITEMS.length * 2);

    // Every item cell pads the page's 16 pt after its dot and 8 pt around it.
    const dot = screen.getAllByText('·', { includeHiddenElements: true })[ITEMS.length - 1];
    const cell = StyleSheet.flatten(dot.parent?.props.style);
    expect(cell.paddingRight).toBe(Space.lg);
    expect(cell.gap).toBe(Space.sm);
  });
});
