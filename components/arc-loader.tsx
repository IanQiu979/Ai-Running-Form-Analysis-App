/**
 * The loading rings — the motif's wait state. Three concentric arcs rotating at different rates
 * and in alternating directions, so the group reads as one system turning rather than as three
 * spinners stacked.
 *
 * WHAT IT MUST NEVER CLAIM. This is an INDETERMINATE indicator: it says work is happening, it does
 * not say how far along that work is. It shows no percentage, no arc that fills toward a
 * completion, and nothing that could be read as progress — that discipline is inherited verbatim
 * from `components/low-poly-field.tsx`, which carries the same caveat on the same screen, and from
 * `app/analyzing.tsx`, whose honest step-list is where real progress information belongs. A ring
 * that appeared to fill toward 100% while an LLM call ran would be a fabrication.
 *
 * REDUCED MOTION: the rings render dead still, with no animation scheduled at all — not paused,
 * never started. This is ambient, non-informational motion, exactly the category
 * `useReducedMotion()` exists to suppress (same treatment as `<ScreenGradient>`'s drift). The
 * static composition is deliberately still legible as a mark rather than collapsing to nothing:
 * each arc keeps its gap, so what remains is three broken rings, which is the same picture the
 * motion is made of.
 *
 * `transform: rotate` only — nothing here animates a path, a dimension, or a colour, so every
 * frame stays on the UI thread and no layout pass is ever triggered. Same discipline as
 * `components/pace-reveal.tsx` and `components/annotation-lines.tsx`.
 */
import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { Meter, Motion, type ColorScheme } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

/**
 * The three rings, outermost first. `inset` is how far in from the outer diameter this ring sits;
 * `sweep` is the fraction of the circle actually drawn (the rest is the gap that makes rotation
 * visible at all — a complete circle rotating is indistinguishable from a still one); `turns` is
 * the direction and relative speed. Authored data, deliberately eyeball-able, not a generated
 * ramp: the alternating sign is the whole reason the group reads as gears rather than as a wheel.
 */
const RINGS = [
  { inset: 0, sweep: 0.62, turns: 1 },
  { inset: 0.22, sweep: 0.4, turns: -1.6 },
  { inset: 0.44, sweep: 0.75, turns: 2.4 },
] as const;

/** One full turn of the outermost ring. The inner two derive from it via their `turns` factor, so
 *  the whole group retimes from this single number. */
const BASE_PERIOD_MS = Motion.duration.cinematic * 2;

export type ArcLoaderProps = {
  /** Outer diameter, in points. */
  size: number;
  /** Ring thickness. Defaults to a hairline-plus stroke that holds at every size used today. */
  strokeWidth?: number;
  /** Override the arc colour — for a loader over photographic media, where the clay ornament is
   *  not the proven role. Pass another token, never a literal. */
  color?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function ArcLoader({ size, strokeWidth = 2, color, style, testID }: ArcLoaderProps) {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const stroke = color ?? Meter[scheme].rule;
  const reduceMotion = useReducedMotion();

  return (
    <View
      style={[styles.root, { width: size, height: size }, style]}
      pointerEvents="none"
      // Indeterminate and decorative: the screens that mount this all state what is happening in
      // real copy beside it (`app/analyzing.tsx`'s step list, `extracting`'s own status line), and
      // that copy is what a screen reader should read — not a second, contentless "loading" node.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}>
      {RINGS.map((ring, index) => (
        <SpinningArc
          key={ring.inset}
          size={size}
          strokeWidth={strokeWidth}
          stroke={stroke}
          ring={ring}
          still={reduceMotion}
          testID={testID ? `${testID}-ring-${index}` : undefined}
        />
      ))}
    </View>
  );
}

function SpinningArc({
  size,
  strokeWidth,
  stroke,
  ring,
  still,
  testID,
}: {
  size: number;
  strokeWidth: number;
  stroke: string;
  ring: (typeof RINGS)[number];
  still: boolean;
  testID?: string;
}) {
  const diameter = size * (1 - ring.inset);
  const radius = (diameter - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const spin = useSharedValue(0);

  useEffect(() => {
    if (still) {
      spin.value = 0;
      return;
    }
    spin.value = withRepeat(
      withTiming(ring.turns > 0 ? 360 : -360, {
        duration: BASE_PERIOD_MS / Math.abs(ring.turns),
        // The only correct curve for a continuous loop — anything eased visibly pulses at the seam.
        easing: Easing.bezier(...Motion.curve.linear),
      }),
      -1,
      false
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- spin is a stable shared value
  }, [still, ring.turns]);

  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));

  return (
    <Animated.View
      testID={testID}
      style={[styles.ring, { width: diameter, height: diameter }, still ? undefined : spinStyle]}>
      <Svg width={diameter} height={diameter}>
        <Circle
          // Named so a test can reach it: the GAP in this dash array is the whole reason the
          // rotation is visible at all, and there is no way to assert that from an unnamed node.
          testID={testID ? `${testID}-arc` : undefined}
          cx={diameter / 2}
          cy={diameter / 2}
          r={radius}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          // Drawn arc, then the gap — the gap is what makes the rotation readable.
          strokeDasharray={[circumference * ring.sweep, circumference * (1 - ring.sweep)]}
          fill="none"
        />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
