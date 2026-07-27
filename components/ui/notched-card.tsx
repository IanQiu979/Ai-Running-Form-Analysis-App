/**
 * The result container: a notched rectangle rather than a rounded card (spec 2026-07-26 §3.6).
 *
 * A card that is not a rounded rectangle is the cheapest available signal that a screen was
 * designed rather than templated. Built from plain Views — two circles in the page's own
 * background colour, centred on the left and right edges, read as die-cut notches. No SVG, no
 * mask, no dependency (see the spec's "net new runtime dependencies: none").
 *
 * `overflow: 'hidden'` is LOAD-BEARING, not incidental. Each notch straddles an edge; clipping
 * removes the outer half, so what renders is a single arc biting into the card — a die-cut. Drop
 * the clip and the same View reads as a whole circle sitting on top of the card instead.
 *
 * WHY THE ARC IS STROKED: a fill alone does not read. `background` against `surface.base` is
 * 1.07:1 (light) / 1.08:1 (dark), and against `surface.raised` 1.13:1 / 1.19:1 — all far below
 * perceptible, so a fill-only notch is invisible on every surface this card can sit on and the
 * shape signal the spec is buying (§3.6, "shape as identity") would never arrive. The 1pt
 * `hairline` stroke is what makes the cut edge read. `hairline` is the right token by its own
 * definition in `constants/theme.ts` — "rules, ticks, annotations", decorative structure, not a
 * control boundary — so WCAG 1.4.11 does not apply to it and no contrast floor is being dodged.
 *
 * The notches are pure decoration and are hidden from assistive technology (brief §7).
 */
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const NOTCH_DIAMETER = 24;

type NotchedCardProps = ViewProps & {
  testID?: string;
  children: React.ReactNode;
};

export function NotchedCard({ testID, children, style, ...rest }: NotchedCardProps) {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const page = colors.background;
  const surface = colors.surface.base;

  const notch = [
    styles.notch,
    {
      backgroundColor: page,
      borderColor: colors.hairline,
      width: NOTCH_DIAMETER,
      height: NOTCH_DIAMETER,
      borderRadius: NOTCH_DIAMETER / 2,
    },
  ];

  return (
    <View testID={testID} style={[styles.card, { backgroundColor: surface }, style]} {...rest}>
      {children}
      <View
        testID={testID ? `${testID}-notch-left` : undefined}
        style={[...notch, styles.notchLeft]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      />
      <View
        testID={testID ? `${testID}-notch-right` : undefined}
        style={[...notch, styles.notchRight]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.xl,
    overflow: 'hidden',
  },
  notch: {
    position: 'absolute',
    top: '50%',
    marginTop: -NOTCH_DIAMETER / 2,
    // See the header: the stroke, not the fill, is what makes the cut edge visible.
    borderWidth: StyleSheet.hairlineWidth,
  },
  notchLeft: {
    left: -NOTCH_DIAMETER / 2,
  },
  notchRight: {
    right: -NOTCH_DIAMETER / 2,
  },
});
