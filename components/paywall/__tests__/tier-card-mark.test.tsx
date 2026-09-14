/**
 * Layout lock for the tier mark — the ladder of rules a `<TierCard>` wears (see that file's
 * header for why the ladder itself is the comparison and must not become a badge).
 *
 * THE REGRESSION THIS PINS: the mark once shipped absolutely positioned at a 16pt inset over a
 * card whose content column sits at 24pt, so a three-rule ladder's lower rules were drawn straight
 * through the right-aligned price. A translucent ripple could get away with overlapping type; an
 * opaque `ink2` rule cannot.
 *
 * Jest performs no layout here, so nothing below measures pixels. What it asserts is the structural
 * property that makes an overlap IMPOSSIBLE at any rule count: the mark is a NON-ABSOLUTE child of
 * the same single-column flex node the price lives in, and it comes first in that column. Two
 * in-flow rows of a column cannot occupy the same space, whatever either of them contains — so a
 * future fourth rung cannot silently re-introduce the collision. The reserved lane is asserted
 * separately, because that is what keeps the type from moving between tiers.
 *
 * Since V23-11 (2026-09-14) the card IS the column: `<SquareCard>` is one padded `View`, so the
 * node under test is the card's own `testID`, not an inner `-content` wrapper.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { MARK_LANE_HEIGHT, TierCard } from '../tier-card';

const TEST_ID = 'tier';

const renderCard = (marks: number) =>
  render(
    <TierCard
      testID={TEST_ID}
      name="Elite"
      price="$14.99 / mo"
      detail="Everything in Pro, with more detail and comparison."
      marks={marks}
      cta={{ kind: 'none' }}
    />
  );

/** Both nodes are inside a subtree hidden from the a11y tree, so hidden elements must be included
 *  — see CLAUDE.md § Testing. */
const node = (suffix: string) =>
  screen.getByTestId(`${TEST_ID}-${suffix}`, { includeHiddenElements: true });

/** The card itself — the single padded column every row, the mark first, sits in. */
const card = () => screen.getByTestId(TEST_ID, { includeHiddenElements: true });

const flat = (suffix: string) => StyleSheet.flatten(node(suffix).props.style) ?? {};

/** Ladder counts the product ships (1, 2, 3) plus the one it does not yet: a fourth tier must not
 *  be the change that puts rules back through the price. */
const LADDER_COUNTS = [1, 2, 3, 4];

describe.each(LADDER_COUNTS)('a %i-rule ladder', (marks) => {
  it('draws exactly that many rules', async () => {
    await renderCard(marks);
    expect(
      screen.getAllByTestId(new RegExp(`^${TEST_ID}-mark-\\d+$`), { includeHiddenElements: true })
    ).toHaveLength(marks);
  });

  it('sits in the content column, not over it, so it cannot reach the price', async () => {
    await renderCard(marks);
    const content = card();
    const column = StyleSheet.flatten(content.props.style) ?? {};

    // A column: children stack, they do not share space.
    expect(column.flexDirection ?? 'column').toBe('column');

    // Every row of that column is in normal flow. One `position: 'absolute'` here is exactly the
    // defect being locked out, whichever row acquires it.
    for (const child of content.children) {
      if (typeof child === 'string') continue;
      expect(StyleSheet.flatten(child.props.style)?.position).toBeUndefined();
    }

    // ...and the mark is the FIRST of them, above the header row that carries the price.
    const rows = content.children.filter((child) => typeof child !== 'string');
    expect(rows[0]).toBe(node('mark'));
    expect(rows.length).toBeGreaterThan(1);
  });
  it('reserves the shipped ladder its lane, without capping a taller one', async () => {
    await renderCard(marks);
    const mark = flat('mark');
    const rule = flat('mark-0');
    const extent = marks * (rule.height as number) + (marks - 1) * ((mark.gap as number) ?? 0);

    // A floor, never a cap, and the same floor whatever this card carries: 1, 2 and 3 rules all
    // reserve the 3-rule lane, so the type below does not shift between tiers, and a 4-rule ladder
    // simply makes its own lane taller instead of spilling over the header row.
    expect(mark.minHeight).toBe(MARK_LANE_HEIGHT);
    expect(mark.height).toBeUndefined();
    if (marks <= 3) {
      expect(MARK_LANE_HEIGHT).toBeGreaterThanOrEqual(extent);
    } else {
      expect(extent).toBeGreaterThan(MARK_LANE_HEIGHT);
    }
  });
});
