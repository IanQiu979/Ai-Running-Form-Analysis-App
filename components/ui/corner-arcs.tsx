/**
 * Corner arcs — the Cadence Arcs ornament that appears on every screen, and the motif's most
 * visible carrier.
 *
 * Concentric circles pinned to one corner of their parent, clipped by their own box, so only the
 * quarter that falls inside is drawn: a ripple entering the screen, not a set of circles sitting
 * on it. Each arc outward is fainter than the last, because a ripple loses energy as it travels —
 * equally-weighted rings read as a target, which is the wrong idea entirely.
 *
 * PURELY DECORATIVE, and the code says so three ways rather than relying on a comment:
 * `pointerEvents="none"`, `accessibilityElementsHidden`, and no text or state anywhere in it. It
 * carries no information a screen reader or a contrast failure could hide. It is nonetheless drawn
 * in `Arc.*.ornament`, which is proven >=3:1 against every surface and every wash stop (see the
 * token's own note on why it takes a floor WCAG would not impose on it) — an ornament that
 * survives on one screen's backdrop and vanishes on another's is not a system, it is an accident.
 *
 * ABSOLUTELY POSITIONED. It expects a parent with `position: 'relative'` (the default) and
 * `overflow: 'hidden'` where the parent's own corner is rounded. It never affects layout.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Arc, type ColorScheme } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ArcCorner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

/** Where the box sits, and where inside it the arcs' shared origin is (in 0-1 of the box). */
const CORNERS: Record<ArcCorner, { placement: ViewStyle; cx: number; cy: number }> = {
  topLeft: { placement: { top: 0, left: 0 }, cx: 0, cy: 0 },
  topRight: { placement: { top: 0, right: 0 }, cx: 1, cy: 0 },
  bottomLeft: { placement: { bottom: 0, left: 0 }, cx: 0, cy: 1 },
  bottomRight: { placement: { bottom: 0, right: 0 }, cx: 1, cy: 1 },
};

export type CornerArcsProps = {
  /** Which corner the ripple radiates from. */
  corner?: ArcCorner;
  /** Radius of the OUTERMOST arc, in points — also the size of the box that clips them. */
  radius: number;
  /** How many concentric arcs. */
  count?: number;
  /** Opacity of the innermost (strongest) arc; each one outward steps down from it. */
  opacity?: number;
  /**
   * Override the ornament colour. The one legitimate reason is a backdrop the token was not proven
   * against — photographic media, where a caller passes `text.primary` or a `Glass` tone instead.
   * Never pass a literal; pass another token.
   */
  color?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function CornerArcs({
  corner = 'topRight',
  radius,
  count = 4,
  opacity = 0.5,
  color,
  style,
  testID,
}: CornerArcsProps) {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const stroke = color ?? Arc[scheme].ornament;
  const { placement, cx, cy } = CORNERS[corner];
  const rings = Array.from({ length: count }, (_, i) => ((i + 1) / count) * radius);

  return (
    <View
      style={[styles.box, placement, { width: radius, height: radius }, style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}>
      <Svg width={radius} height={radius}>
        {rings.map((r, i) => (
          <Circle
            key={r}
            // Per-arc testID so `components/__tests__/arc-ring.test.tsx` can assert the opacity
            // ramp directly. RNTL cannot traverse into an SVG subtree by node type here, so the
            // only way to prove the ripple fades outward is to be able to name each arc.
            testID={testID ? `${testID}-arc-${i}` : undefined}
            cx={cx * radius}
            cy={cy * radius}
            r={r}
            stroke={stroke}
            strokeOpacity={opacity * (1 - i / (count + 1))}
            strokeWidth={1}
            fill="none"
          />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    overflow: 'hidden',
  },
});
