/**
 * The low-poly morph — species-in-pieces.com's motif, adapted to this app.
 *
 * A small, fixed set of triangles continuously morphs between named poses. It carries the two
 * screens that are otherwise dead air: the Analyzing wait (where it is the honest "work is
 * happening" signal — see the caveat below about what it must never claim) and the first-run/empty
 * states, where it stands in for a result that does not exist yet.
 *
 * WHY PLAIN VIEWS AND NOT SVG: `react-native-svg` is not a dependency of this project and, per
 * `components/annotation-lines.tsx`'s own header, must not become one — a ruling this file inherits
 * rather than relitigates. A triangle is therefore built the CSS way: a zero-size box with
 * transparent left/right borders and one coloured bottom border. That renders a real, crisp
 * triangle on every RN platform with no library at all. It costs one constraint, and it is worth
 * naming: a border-triangle is always isoceles about its own vertical axis, so a pose changes a
 * facet's POSITION, SCALE and ROTATION, never its internal vertex geometry. Genuine per-vertex
 * morphing is what SVG would buy; at this scale, on a decorative field, the difference is not
 * visible, and the dependency is.
 *
 * WHAT A POSE IS: an array of per-facet `{ x, y, scale, rotate, opacity }` in normalised 0-1 space,
 * so the field is resolution-independent and one pose can be interpolated toward the next by
 * driving a single shared `progress` value on the UI thread. Every facet reads the same progress,
 * offset by `Motion.stagger.facet * index`, which is what makes the shape assemble rather than
 * snap. Poses must all have `FACET_COUNT` entries — enforced by the type, not by a runtime check.
 *
 * HONESTY (this matters more than the animation): on the Analyzing screen this must never look like
 * a progress bar. It has no start and no end, it does not fill, and it does not accelerate as the
 * request ages. It is an ambient "alive" signal, in exactly the same category as
 * `app/analyzing.tsx`'s existing step captions — that screen's header already establishes the rule
 * that its wait-state signaling shows no fake progress, and this obeys it.
 *
 * REDUCED MOTION: renders pose 0, statically, with no animation scheduled. The field still appears
 * — it is composition, not just movement — it simply stops moving. That is the correct reading of
 * the reduced-motion contract `docs/design/motion-consult.md` sets out: suppress vestibular
 * triggers, keep the thing that carries meaning.
 */
import { useEffect, useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Motion } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

/** Fixed, so a pose is a tuple the type system can check rather than a list that can be short. */
export const FACET_COUNT = 9;

export type Facet = {
  /** Centre, normalised 0-1 across the field's box. */
  x: number;
  y: number;
  /** Multiplier on `FACET_BASE`. */
  scale: number;
  /** Degrees. */
  rotate: number;
  opacity: number;
};

export type Pose = readonly Facet[];

/** Facet size at `scale: 1`, as a fraction of the field's smaller dimension. */
const FACET_BASE = 0.3;

/**
 * The three poses this app ships, in the order they cycle. They are deliberately abstract rather
 * than literal: an attempt at a recognisable runner in nine isoceles triangles reads as a broken
 * pictogram, whereas these read as a considered mark. Named for what they suggest, not what they
 * depict.
 *
 *  `scatter` — dispersed, low-opacity. The resting/entry state.
 *  `stride`  — a forward-leaning diagonal mass, the app's subject at its most abstract.
 *  `gather`  — converged toward centre, the "result exists" state.
 */
export const POSES: Record<'scatter' | 'stride' | 'gather', Pose> = {
  scatter: [
    { x: 0.14, y: 0.2, scale: 0.5, rotate: 12, opacity: 0.5 },
    { x: 0.78, y: 0.14, scale: 0.36, rotate: -28, opacity: 0.38 },
    { x: 0.32, y: 0.62, scale: 0.62, rotate: 160, opacity: 0.62 },
    { x: 0.86, y: 0.55, scale: 0.44, rotate: 74, opacity: 0.44 },
    { x: 0.5, y: 0.36, scale: 0.72, rotate: -8, opacity: 0.7 },
    { x: 0.2, y: 0.84, scale: 0.34, rotate: 200, opacity: 0.34 },
    { x: 0.66, y: 0.8, scale: 0.5, rotate: 44, opacity: 0.5 },
    { x: 0.06, y: 0.48, scale: 0.28, rotate: -60, opacity: 0.3 },
    { x: 0.94, y: 0.86, scale: 0.3, rotate: 120, opacity: 0.32 },
  ],
  stride: [
    { x: 0.24, y: 0.72, scale: 0.72, rotate: 28, opacity: 0.72 },
    { x: 0.38, y: 0.52, scale: 0.62, rotate: 34, opacity: 0.66 },
    { x: 0.52, y: 0.34, scale: 0.86, rotate: 22, opacity: 0.86 },
    { x: 0.66, y: 0.2, scale: 0.54, rotate: 40, opacity: 0.6 },
    { x: 0.78, y: 0.1, scale: 0.34, rotate: 16, opacity: 0.42 },
    { x: 0.34, y: 0.88, scale: 0.4, rotate: 190, opacity: 0.46 },
    { x: 0.6, y: 0.62, scale: 0.44, rotate: -14, opacity: 0.5 },
    { x: 0.14, y: 0.44, scale: 0.3, rotate: 62, opacity: 0.34 },
    { x: 0.86, y: 0.44, scale: 0.26, rotate: -40, opacity: 0.3 },
  ],
  gather: [
    { x: 0.5, y: 0.5, scale: 1, rotate: 0, opacity: 0.9 },
    { x: 0.38, y: 0.4, scale: 0.6, rotate: 180, opacity: 0.6 },
    { x: 0.62, y: 0.4, scale: 0.6, rotate: 180, opacity: 0.6 },
    { x: 0.38, y: 0.62, scale: 0.48, rotate: 0, opacity: 0.5 },
    { x: 0.62, y: 0.62, scale: 0.48, rotate: 0, opacity: 0.5 },
    { x: 0.5, y: 0.26, scale: 0.4, rotate: 0, opacity: 0.44 },
    { x: 0.5, y: 0.76, scale: 0.4, rotate: 180, opacity: 0.44 },
    { x: 0.24, y: 0.5, scale: 0.3, rotate: 90, opacity: 0.34 },
    { x: 0.76, y: 0.5, scale: 0.3, rotate: -90, opacity: 0.34 },
  ],
};

type LowPolyFieldProps = {
  /** The poses to cycle through, in order, looping back to the first. One pose = a static mark. */
  poses: readonly Pose[];
  /** Triangle colour. Callers pass a theme token — this component invents no colour. */
  color: string;
  /** Field size in points. Square. */
  size: number;
  /** Time spent morphing between two consecutive poses. */
  durationMs?: number;
  /** Time held at each pose before the next morph begins. */
  holdMs?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function LowPolyField({
  poses,
  color,
  size,
  durationMs = Motion.duration.cinematic,
  holdMs = Motion.duration.epic,
  style,
  testID,
}: LowPolyFieldProps) {
  const reduceMotion = useReducedMotion();
  const animate = !reduceMotion && poses.length > 1;

  // A single driver for the whole field: its integer part selects the pose pair, its fractional
  // part is the interpolation between them. One shared value, nine readers, zero JS per frame.
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!animate) {
      progress.value = 0;
      return;
    }
    // One `withSequence` step per pose transition, repeated forever. Built rather than driven by a
    // modulo so the final step lands exactly back where it started and the loop seam is invisible:
    // the driver ramps 0 -> poses.length, and `poses.length % poses.length === 0` is pose 0 again.
    const steps = poses.map((_, index) =>
      withDelay(
        holdMs,
        withTiming(index + 1, {
          duration: durationMs,
          easing: Easing.bezier(...Motion.curve.morph),
        })
      )
    );
    progress.value = 0;
    // `withSequence`'s return type widens to `AnimatableValue` (it can sequence colours and
    // strings too); this driver is only ever numeric, so the narrowing cast is safe and is what
    // keeps the shared value typed as `number` for every reader in `FacetView`.
    progress.value = withRepeat(withSequence(...steps), -1, false) as number;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- progress is a stable shared value
  }, [animate, poses, durationMs, holdMs]);

  const facetIndices = useMemo(() => Array.from({ length: FACET_COUNT }, (_, i) => i), []);

  return (
    <View
      testID={testID}
      style={[{ width: size, height: size }, style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {facetIndices.map((index) => (
        <FacetView
          key={index}
          index={index}
          poses={poses}
          progress={progress}
          color={color}
          size={size}
          animate={animate}
        />
      ))}
    </View>
  );
}

function FacetView({
  index,
  poses,
  progress,
  color,
  size,
  animate,
}: {
  index: number;
  poses: readonly Pose[];
  progress: ReturnType<typeof useSharedValue<number>>;
  color: string;
  size: number;
  animate: boolean;
  }) {
  const half = (FACET_BASE * size) / 2;
  // Per-facet phase offset, in "pose units", so facets arrive at the next pose slightly apart.
  const offset = (index * Motion.stagger.facet) / Motion.duration.cinematic;

  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
    const raw = animate ? Math.max(0, progress.value - offset) : 0;
    const count = poses.length;
    const from = Math.floor(raw) % count;
    const to = (from + 1) % count;
    const t = raw - Math.floor(raw);
    // Smoothstep the segment so a facet eases into and out of each pose even though the driver
    // itself is one continuous ramp across the whole sequence.
    const e = t * t * (3 - 2 * t);
    const a = poses[from][index];
    const b = poses[to][index];
    const mix = (p: number, q: number) => p + (q - p) * e;

    return {
      opacity: mix(a.opacity, b.opacity),
      // TRANSFORM ONLY — never `left`/`top`. Those are layout properties: animating them re-runs
      // layout for nine nodes every frame. `translate` is composited on the UI thread and touches
      // nothing else, the same rule `components/pace-reveal.tsx` states as "scaleX, never width".
      // Translate is applied before scale/rotate so the facet spins about its own centre rather
      // than about the field's origin.
      transform: [
        { translateX: mix(a.x, b.x) * size - half },
        { translateY: mix(a.y, b.y) * size - half * 0.866 },
        { scale: mix(a.scale, b.scale) },
        { rotate: `${mix(a.rotate, b.rotate)}deg` },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.facet,
        {
          borderLeftWidth: half,
          borderRightWidth: half,
          borderBottomWidth: half * 1.732, // equilateral: height = side * sqrt(3) / 2
          borderBottomColor: color,
        },
        animatedStyle,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  facet: {
    position: 'absolute',
    // The CSS triangle: a zero-size box whose left/right borders are transparent and whose bottom
    // border is the visible shape. See this file's header for why this and not SVG.
    backgroundColor: 'transparent',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopWidth: 0,
    height: 0,
    width: 0,
  },
});
