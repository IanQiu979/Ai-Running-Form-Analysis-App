/**
 * The result container: a notched rectangle rather than a rounded card (spec 2026-07-26 §3.6).
 *
 * A card that is not a rounded rectangle is the cheapest available signal that a screen was
 * designed rather than templated. Built from plain Views — two circles in the page's own
 * background colour, centred on the left and right edges, read as die-cut notches. No SVG, no
 * mask, no dependency (see the spec's "net new runtime dependencies: none").
 *
 * `overflow: 'hidden'` is kept on purpose and does NOT defeat the effect: each notch straddles an
 * edge, and the half that gets clipped is the half OUTSIDE the card — which was page-coloured on
 * the page's own background, i.e. invisible either way. Only the inner half ever reads, and that
 * half is inside the bounds.
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
  const page = Colors[scheme].background;
  const surface = Colors[scheme].surface.base;

  const notch = [
    styles.notch,
    { backgroundColor: page, width: NOTCH_DIAMETER, height: NOTCH_DIAMETER, borderRadius: NOTCH_DIAMETER / 2 },
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
  },
  notchLeft: {
    left: -NOTCH_DIAMETER / 2,
  },
  notchRight: {
    right: -NOTCH_DIAMETER / 2,
  },
});
