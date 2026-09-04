/**
 * One tier card on the paywall (Free / Pro / Elite).
 *
 * THE MARK IS THE COMPARISON, and it survived the Cadence Arcs retirement because it was never
 * really decoration. Each card carries a small stack of rules in its top corner, and the only
 * thing that changes between the three is HOW MANY: one, two, three. That is the honest picture of
 * what the tiers actually are — `Copy.paywall.footnote` says it in words ("Elite adds a little
 * more detail and comparison — not a different analysis"), and a mark that GAINS A RULE rather
 * than changing colour or shape says the same thing without a "best value" badge or a feature-tick
 * matrix this product does not have.
 *
 * WHAT CHANGED 2026-09-04 (the "Cold Read" palette): the mark used to be a corner ripple drawn by
 * the retired `<CornerArcs>` in the brand's clay. It is now a ruler — stacked ticks in the
 * achromatic `Meter.rule`, the token that replaced `Arc` — which is both what the new
 * cool-scientific system draws with and a better fit for the idea: a ladder of tiers reads as a
 * scale, and a scale is made of ticks. Nothing chromatic appears on these cards except the single
 * accent CTA, which is the whole point of the two-tier accent system (see `Accent` in theme.ts).
 *
 * `marks` IS ORNAMENT AND ONLY ORNAMENT. It is not a quota, a pillar count, or a fraction of
 * anything — nothing on this screen enforces or computes entitlement (CLAUDE.md: tier and quota are
 * server-only, and issue #52's own rule is that this whole screen is cosmetic). The card renders
 * the strings and the CTA state it is handed and decides nothing.
 *
 * `<SurfaceCard padding={0}>` with an inner padded node is deliberate, and is what that prop's own
 * doc comment describes: an absolutely-positioned mark resolves against its parent's PADDING box,
 * so a mark inside a padded card floats in from the corner instead of sitting at it.
 *
 * The one card carrying `tone="raised"` is whichever one is the CURRENT plan — "the one raised
 * element per screen" (constants/theme.ts) spent on the true statement about this account, not on a
 * tier we would like to sell. When the plan read has not resolved (or failed), no card is raised.
 */
import { StyleSheet, Text, View } from 'react-native';

import { PillButton } from '@/components/ui/pill-button';
import { SurfaceCard } from '@/components/ui/surface-card';
import { Copy } from '@/constants/copy';
import {
  Colors,
  FontFamily,
  FontSize,
  HitTarget,
  LineHeight,
  Meter,
  Radius,
  Spacing,
  Tracking,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** What this card's action currently is. `none` is a real state, not a placeholder: an Elite
 *  account is never offered "Upgrade to Pro" (that would be a downgrade wearing an upgrade's
 *  label), and a paid account is not told Free is its current plan. */
export type TierCardCta =
  | { kind: 'none' }
  | { kind: 'current' }
  | { kind: 'upgrade'; label: string; busy: boolean; disabled: boolean; onPress: () => void };

/** Card-scale, not screen-scale: the screen's own ripple scales with the viewport, and dropping
 *  that radius into a card would fill it. */
/** The tier mark: a stack of rules in the card's top-right corner. Geometry is composition, not a
 *  token — these numbers repeat nowhere else in the app (the same reasoning
 *  `components/pace-readout.tsx` gives for keeping its own ring sizes local). */
const MARK_RULE_WIDTH = 28;
const MARK_RULE_HEIGHT = 2;
const MARK_RULE_GAP = 5;
const MARK_INSET = Spacing.lg;

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
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = createStyles(colors, scheme);
  const isCurrent = cta.kind === 'current';

  return (
    <SurfaceCard testID={testID} tone={isCurrent ? 'raised' : 'base'} padding={0}>
      {/* Decorative and inert: hidden from the a11y tree entirely, because the ladder it draws is
          already stated in words by the tier name, price and detail below it. It takes no layout
          and no touches. */}
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
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.name}>{name}</Text>
          {/* Mono — theme.ts's `FontFamily.mono` role ("measured readouts and any pace/metric
              text"), the same treatment Home gives its quota count. A price is a measured value. */}
          <Text style={styles.price}>{price}</Text>
        </View>
        <Text style={styles.detail}>{detail}</Text>

        {/* A non-interactive label, not a disabled button — "Current plan" names a fact about this
            card. `Radius.pill` + a decorative `hairline`, deliberately NOT `control.border`: giving
            it the 3:1 interactive boundary an upgrade pill has is exactly what would make it look
            tappable. */}
        {cta.kind === 'current' && (
          <View style={styles.currentPlanBadge}>
            <Text style={styles.currentPlanText}>{Copy.paywall.cta.current}</Text>
          </View>
        )}

        {/* `secondary`, deliberately not `primary`: this screen offers a parallel choice between
            two upgrade paths and has no single primary action, so spending `Accent` here would
            break the "one accent, one CTA" rule constants/theme.ts states. */}
        {cta.kind === 'upgrade' && (
          <PillButton
            variant="secondary"
            label={cta.label}
            accessibilityHint={cta.busy ? Copy.paywall.purchase.pending : undefined}
            disabled={cta.disabled}
            busy={cta.busy}
            onPress={cta.onPress}
            style={styles.upgradeButton}
          />
        )}
      </View>
    </SurfaceCard>
  );
}

function createStyles(colors: ThemeColors, scheme: ColorScheme) {
  return StyleSheet.create({
    // The tier mark — see this file's header. Absolutely positioned so it contributes nothing to
    // layout: the card's type must not move because a tier carries one more rule than another.
    mark: {
      position: 'absolute',
      top: MARK_INSET,
      right: MARK_INSET,
      alignItems: 'flex-end',
      gap: MARK_RULE_GAP,
    },
    markRule: {
      width: MARK_RULE_WIDTH,
      height: MARK_RULE_HEIGHT,
      // `Meter.rule`, never `hairline`: a rule this short at 1.2-1.4:1 is simply invisible, and
      // `Meter.rule` is the token proven >=3:1 on every surface and wash stop (theme.ts).
      backgroundColor: Meter[scheme].rule,
    },
    content: {
      padding: Spacing.xl,
      gap: Spacing.sm,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      // Wraps rather than squeezing the price off the card at large Dynamic Type (brief §7).
      flexWrap: 'wrap',
      gap: Spacing.sm,
    },
    name: {
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.xl,
      letterSpacing: Tracking.display,
      color: colors.text.primary,
    },
    price: {
      fontFamily: FontFamily.mono.regular,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
    },
    detail: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      lineHeight: FontSize.sm * LineHeight.body,
      color: colors.text.secondary,
    },
    currentPlanBadge: {
      minHeight: HitTarget.min,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
      marginTop: Spacing.sm,
      paddingHorizontal: Spacing.lg,
    },
    currentPlanText: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.xs,
      letterSpacing: Tracking.eyebrow,
      textTransform: 'uppercase',
      color: colors.text.secondary,
    },
    upgradeButton: {
      marginTop: Spacing.sm,
    },
  });
}
