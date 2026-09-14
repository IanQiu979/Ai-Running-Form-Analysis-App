/**
 * One tier card on the paywall (Free / Pro / Elite) — V23-11's card, transcribed from the
 * captain-approved page: a `<SquareCard>` at 24 pt padding, a 12 pt column of the tier mark, the
 * name/price row, the detail line, and then whichever control this card currently carries.
 *
 * THE MARK IS THE COMPARISON, and it survived every palette change because it was never really
 * decoration. Each card carries a small stack of rules in its top corner, and the only thing that
 * changes between the three is HOW MANY: one, two, three. That is the honest picture of what the
 * tiers actually are — `Copy.paywall.footnote` says it in words ("Elite adds detail and
 * comparison, not a different analysis"), and a mark that GAINS A RULE rather than changing colour
 * or shape says the same thing without a "best value" badge or a feature-tick matrix this product
 * does not have. The page keeps it ("rule-count mark kept as ornament") and draws every rule in
 * `ink2`, 28 x 2, 5 pt apart, right-aligned.
 *
 * `marks` IS ORNAMENT AND ONLY ORNAMENT. It is not a quota, a pillar count, or a fraction of
 * anything — nothing on this screen enforces or computes entitlement (CLAUDE.md: tier and quota are
 * server-only, and issue #52's own rule is that this whole screen is cosmetic). The card renders
 * the strings and the CTA state it is handed and decides nothing.
 *
 * THE MARK SHARES THE CONTENT COLUMN, and does not float over it. It once sat absolutely
 * positioned over the card and put a three-rule ladder straight through the right-aligned price.
 * It is now the first row of the card's own column — it cannot overlap the price at ANY rule
 * count, because nothing in a column overlaps anything else in it. The lane reserves
 * `MARK_LADDER_MAX` rules' worth of height (the page's `min-height:16px`) whatever this card
 * carries, so the type below does not move because a tier wears one rule fewer than its
 * neighbour; a taller ladder grows the lane rather than colliding with anything.
 *
 * The one card carrying `tone="selected"` is whichever one is the CURRENT plan — the page's
 * `#1A1A1A` "this one" surface, spent on the true statement about this account, not on a tier we
 * would like to sell. When the plan read has not resolved (or failed), no card is selected.
 *
 * NO ACCENT CTA. The page's own note: "upgrades are secondary buttons, per the one-accent rule" —
 * this screen offers a parallel choice between two upgrade paths and has no single primary action.
 */
import { StyleSheet, Text, View } from 'react-native';

import { SquareButton } from '@/components/ui/square-button';
import { SquareCard } from '@/components/ui/square-card';
import { Copy } from '@/constants/copy';
import { Ink, Layout, Space, Type } from '@/constants/v23-theme';

/** What this card's action currently is. `none` is a real state, not a placeholder: an Elite
 *  account is never offered "Upgrade to Pro" (that would be a downgrade wearing an upgrade's
 *  label), and a paid account is not told Free is its current plan — the page's Voluntary
 *  artboard draws the Free card with no control at all. */
export type TierCardCta =
  | { kind: 'none' }
  | { kind: 'current' }
  | { kind: 'upgrade'; label: string; busy: boolean; disabled: boolean; onPress: () => void };

/** The tier mark: a stack of rules at the top of the card's column. The page's own numbers
 *  (`width:28px;height:2px`, `gap:5px`); geometry is composition, not a token — it repeats
 *  nowhere else in the app. */
const MARK_RULE_WIDTH = 28;
const MARK_RULE_HEIGHT = 2;
const MARK_RULE_GAP = 5;
/** The tallest rung the ladder currently climbs to. Only the RESERVED height depends on it: a card
 *  handed more rules than this still draws all of them, it just makes its own lane taller. */
const MARK_LADDER_MAX = 3;
export const MARK_LANE_HEIGHT =
  MARK_LADDER_MAX * MARK_RULE_HEIGHT + (MARK_LADDER_MAX - 1) * MARK_RULE_GAP;

export type TierCardProps = {
  name: string;
  price: string;
  detail: string;
  /** How many rules this tier's mark carries — 1, 2, 3 up the ladder. Ornament only; see header. */
  marks: number;
  cta: TierCardCta;
  testID?: string;
};

export function TierCard({ name, price, detail, marks, cta, testID }: TierCardProps) {
  const isCurrent = cta.kind === 'current';

  return (
    <SquareCard
      testID={testID}
      padding={Layout.cardPaddingLg}
      tone={isCurrent ? 'selected' : 'raised'}
      style={styles.card}>
      {/* Decorative and inert: hidden from the a11y tree entirely, because the ladder it draws is
          already stated in words by the tier name, price and detail below it. It takes no
          touches, and it takes a FIXED slice of layout that does not vary with `marks`. */}
      <View
        testID={testID ? `${testID}-mark` : undefined}
        style={styles.mark}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {Array.from({ length: marks }, (_, i) => (
          <View key={i} testID={testID ? `${testID}-mark-${i}` : undefined} style={styles.markRule} />
        ))}
      </View>
      <View style={styles.headerRow}>
        <Text style={styles.name}>{name}</Text>
        {/* Mono, `ink2` — a price is a measured value (`Type.mono`'s own note). */}
        <Text style={styles.price}>{price}</Text>
      </View>
      <Text style={styles.detail}>{detail}</Text>

      {/* A non-interactive label, not a disabled button — "Current plan" names a fact about this
          card. The page draws it as a 44 pt box ruled in `line` with the label in `ink2`, which is
          exactly what keeps it from reading as tappable beside a 56 pt `ink`-labelled upgrade. */}
      {cta.kind === 'current' && (
        <View style={styles.currentPlan}>
          <Text style={styles.currentPlanText}>{Copy.paywall.cta.current}</Text>
        </View>
      )}

      {cta.kind === 'upgrade' && (
        <View style={styles.upgrade}>
          <SquareButton
            variant="secondary"
            label={cta.label}
            accessibilityHint={cta.busy ? Copy.paywall.purchase.pending : undefined}
            disabled={cta.disabled}
            busy={cta.busy}
            onPress={cta.onPress}
          />
        </View>
      )}
    </SquareCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Space.md,
  },
  // The tier mark — see this file's header. In the card's normal flow, so it cannot be drawn over
  // the price beside it, with a reserved lane height so the card's type does not move because a
  // tier carries one more rule than another.
  mark: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    minHeight: MARK_LANE_HEIGHT,
    gap: MARK_RULE_GAP,
  },
  markRule: {
    width: MARK_RULE_WIDTH,
    height: MARK_RULE_HEIGHT,
    backgroundColor: Ink.ink2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    // Wraps rather than squeezing the price off the card at large Dynamic Type.
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  name: {
    ...Type.h1,
    color: Ink.ink,
  },
  price: {
    ...Type.mono,
    color: Ink.ink2,
  },
  detail: {
    ...Type.note,
    color: Ink.ink2,
  },
  currentPlan: {
    height: Layout.hitTarget,
    borderWidth: Layout.hairline,
    borderColor: Ink.line,
    borderRadius: Layout.radius,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Space.sm,
  },
  currentPlanText: {
    ...Type.label,
    color: Ink.ink2,
  },
  upgrade: {
    marginTop: Space.sm,
  },
});
