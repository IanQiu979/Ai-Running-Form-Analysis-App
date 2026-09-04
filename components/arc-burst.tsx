/**
 * The arc burst — the sign-in screen's oversized, slowly rotating ring set, and the ONE place in
 * the app where the motif is allowed to be loud.
 *
 * Every other screen gets `<CornerArcs>`: a small, still, quarter-clipped ripple. This is that same
 * idea at splash scale — rings drawn far wider than the viewport, anchored off-centre so they read
 * as a ripple passing through the screen rather than as a target centred on it, each turning at its
 * own rate and direction. It exists because the redesign's one deliberate exception is the screen
 * a person sees before they have any reason to care about the product; everything after it stays
 * disciplined.
 *
 * WHY IT IS A SEPARATE COMPONENT FROM `<ArcLoader>`, which is also rotating concentric arcs: they
 * mean opposite things. The loader says "work is happening, wait"; if this were the same component,
 * a future edit that retuned the loader's timing to feel more urgent would silently make the
 * sign-in screen urgent too. A shared primitive would be a shared MEANING, and these two do not
 * share one. What they do share — the drawing — is `react-native-svg` in both, which is the part
 * that genuinely is the same.
 *
 * DECORATIVE, INERT, AND SUPPRESSED UNDER REDUCED MOTION. It carries no information; it is hidden
 * from the a11y tree and never takes touches. Under reduced motion the rings render dead still
 * with nothing scheduled — ambient, non-informational motion is exactly what that setting is for,
 * and the still composition is still a composition (the arcs keep their gaps and offsets, so what
 * remains reads as a deliberate mark rather than as an animation someone paused).
 *
 * `transform: rotate` only. No path is re-serialised and no dimension animates, so every frame
 * stays on the UI thread — the same discipline `components/pace-reveal.tsx` set for the readout.
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
 * The ring set, authored rather than generated — the irregularity IS the composition. `scale` is
 * the ring's diameter as a fraction of the burst's own size; `sweep` how much of the circle is
 * drawn; `turns` the direction and relative rate; `opacity` its weight in the stack.
 *
 * Nothing here is a full circle. A complete ring rotating is indistinguishable from a still one,
 * and a stack of complete rings reads as a target — the two failure modes this table avoids.
 */
const RINGS = [
  { scale: 1, sweep: 0.55, turns: 1, opacity: 0.5 },
  { scale: 0.82, sweep: 0.34, turns: -0.7, opacity: 0.38 },
  { scale: 0.64, sweep: 0.72, turns: 1.5, opacity: 0.46 },
  { scale: 0.46, sweep: 0.28, turns: -2.1, opacity: 0.6 },
  { scale: 0.3, sweep: 0.6, turns: 2.8, opacity: 0.7 },
] as const;

/** One full turn of the outermost ring. Deliberately slow — four `cinematic` durations. Anything
 *  faster stops being atmosphere and starts asking to be looked at, which on a sign-in screen
 *  competes with the one thing the user is there to do. */
const BASE_PERIOD_MS = Motion.duration.cinematic * 4;

export type ArcBurstProps = {
  /** Diameter of the OUTERMOST ring, in points. Callers pass something larger than the viewport;
   *  the rings are meant to run off every edge. */
  size: number;
  strokeWidth?: number;
  /** Override the arc colour. Defaults to `Meter[scheme].rule` — the brand clay. */
  color?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function ArcBurst({ size, strokeWidth = 1.5, color, style, testID }: ArcBurstProps) {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const stroke = color ?? Meter[scheme].rule;
  const reduceMotion = useReducedMotion();

  return (
    <View
      style={[styles.root, { width: size, height: size }, style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}>
      {RINGS.map((ring, index) => (
        <BurstRing
          key={ring.scale}
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

function BurstRing({
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
  const diameter = size * ring.scale;
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
        // Constant rate — the only correct curve for a continuous loop; anything eased pulses
        // visibly at the seam (`Motion.curve.linear`'s own token comment).
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
          testID={testID ? `${testID}-arc` : undefined}
          cx={diameter / 2}
          cy={diameter / 2}
          r={radius}
          stroke={stroke}
          strokeOpacity={ring.opacity}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
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
