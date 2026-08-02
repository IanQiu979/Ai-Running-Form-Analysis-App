/**
 * The low-poly morph — species-in-pieces.com's motif, adapted to this app.
 *
 * A small, fixed set of triangles continuously morphs between named poses. It carries the two
 * screens that are otherwise dead air: the Analyzing wait (where it is the honest "work is
 * happening" signal — see the caveat below about what it must never claim) and the first-run/empty
 * states, where it stands in for a result that does not exist yet.
 *
 * IT MORPHS PER-VERTEX, and that is new as of 2026-08-02. The redesign built this from CSS
 * border-triangles (a zero-size box with transparent side borders) because `react-native-svg` was
 * under a standing ruling in `components/annotation-lines.tsx`. A border-triangle is always isoceles
 * about its own vertical axis, so a pose could only change a facet's POSITION, SCALE and ROTATION —
 * the facets slid around, they never actually changed shape, which is the one thing the reference is
 * about. The captain lifted the ruling for this purpose (see that file's header for the record), so
 * a facet is now an SVG `<Polygon>` and a pose is THREE INDEPENDENT VERTICES. A triangle can become
 * a different triangle: a sliver can open into a wedge, a wedge can collapse into a spike. That is
 * the whole point of the motif and it was not previously expressible.
 *
 * WHAT A POSE IS: `FACET_COUNT` facets, each three `[x, y]` vertices in normalised 0-1 space plus an
 * opacity, so the field is resolution-independent and one pose can be interpolated toward the next
 * by driving a single shared `progress` value on the UI thread. Every facet reads the same progress,
 * offset by `Motion.stagger.facet * index`, which is what makes the shape assemble rather than snap.
 * Interpolation is per-vertex and independent: vertex 0 travels its own path while vertices 1 and 2
 * travel theirs, which is exactly what a border-triangle could not do.
 *
 * HONESTY (this matters more than the animation): on the Analyzing screen this must never look like
 * a progress bar. It has no start and no end, it does not fill, and it does not accelerate as the
 * request ages. It is an ambient "alive" signal, in exactly the same category as
 * `app/analyzing.tsx`'s existing step captions — that screen's header already establishes the rule
 * that its wait-state signaling shows no fake progress, and this obeys it.
 *
 * REDUCED MOTION: renders pose 0 as plain, un-animated `<Polygon>`s — not merely a paused animation,
 * but no Reanimated work scheduled at all. The field still appears — it is composition, not just
 * movement — it simply stops moving. That is the correct reading of the reduced-motion contract
 * `docs/design/motion-consult.md` sets out: suppress vestibular triggers, keep the thing that
 * carries meaning.
 */
import { useEffect, useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Polygon } from 'react-native-svg';

import { Motion } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

/** Fixed, so a pose is a tuple the type system can check rather than a list that can be short. */
export const FACET_COUNT = 9;

/** The `viewBox` side. Poses are authored in normalised 0-1 space and scaled into this on the way
 *  out, so the same pose data drives any rendered `size` with no per-size rounding. */
const VIEWBOX = 100;

/** A single vertex, normalised 0-1 across the field's box. */
export type Vertex = readonly [x: number, y: number];

export type Facet = {
  /** Exactly three vertices. Each interpolates INDEPENDENTLY toward the next pose's matching
   *  vertex, which is what makes this a morph rather than a transform. */
  points: readonly [Vertex, Vertex, Vertex];
  opacity: number;
};

export type Pose = readonly Facet[];

/**
 * The three poses this app ships, in the order they cycle. They are deliberately abstract rather
 * than literal: an attempt at a recognisable runner in nine triangles reads as a broken pictogram,
 * whereas these read as a considered mark. Named for what they suggest, not what they depict.
 *
 *  `scatter` — dispersed slivers and wedges, no two alike. The resting/entry state.
 *  `stride`  — every facet sheared onto one forward-leaning diagonal, elongated ALONG that
 *              diagonal. The app's subject at its most abstract, and only expressible per-vertex:
 *              shearing a triangle along an axis is precisely what rotate+scale cannot do.
 *  `gather`  — eight sectors converged on a shared centre vertex plus a core. The "result exists"
 *              state, and the pose that reads most clearly as an iris closing when it arrives.
 */
export const POSES: Record<'scatter' | 'stride' | 'gather', Pose> = {
  scatter: [
    { points: [[0.05, 0.12], [0.28, 0.06], [0.16, 0.3]], opacity: 0.5 },
    { points: [[0.62, 0.04], [0.92, 0.14], [0.7, 0.22]], opacity: 0.38 },
    { points: [[0.2, 0.48], [0.44, 0.4], [0.3, 0.66]], opacity: 0.62 },
    { points: [[0.74, 0.42], [0.96, 0.52], [0.78, 0.62]], opacity: 0.44 },
    { points: [[0.38, 0.18], [0.6, 0.26], [0.42, 0.34]], opacity: 0.7 },
    { points: [[0.08, 0.72], [0.3, 0.8], [0.12, 0.94]], opacity: 0.34 },
    { points: [[0.52, 0.72], [0.82, 0.76], [0.6, 0.92]], opacity: 0.5 },
    { points: [[0.02, 0.38], [0.14, 0.34], [0.06, 0.52]], opacity: 0.3 },
    { points: [[0.86, 0.8], [0.98, 0.88], [0.84, 0.96]], opacity: 0.32 },
  ],
  stride: [
    { points: [[0.1, 0.86], [0.34, 0.7], [0.16, 0.66]], opacity: 0.72 },
    { points: [[0.24, 0.74], [0.48, 0.54], [0.3, 0.52]], opacity: 0.66 },
    { points: [[0.38, 0.58], [0.64, 0.34], [0.44, 0.34]], opacity: 0.86 },
    { points: [[0.52, 0.42], [0.76, 0.2], [0.58, 0.2]], opacity: 0.6 },
    { points: [[0.66, 0.26], [0.86, 0.1], [0.72, 0.08]], opacity: 0.42 },
    { points: [[0.18, 0.96], [0.42, 0.86], [0.22, 0.8]], opacity: 0.46 },
    { points: [[0.46, 0.68], [0.7, 0.56], [0.52, 0.5]], opacity: 0.5 },
    { points: [[0.04, 0.6], [0.18, 0.5], [0.08, 0.44]], opacity: 0.34 },
    { points: [[0.78, 0.44], [0.94, 0.34], [0.82, 0.28]], opacity: 0.3 },
  ],
  gather: [
    // Eight 45° sectors sharing the centre vertex, plus a core. Written out rather than generated
    // so a pose stays what every other pose in this file is — plain, readable, hand-adjustable
    // data — instead of one entry being the output of a loop nobody can eyeball.
    { points: [[0.5, 0.5], [0.8, 0.5], [0.71, 0.71]], opacity: 0.9 },
    { points: [[0.5, 0.5], [0.71, 0.71], [0.5, 0.8]], opacity: 0.6 },
    { points: [[0.5, 0.5], [0.5, 0.8], [0.29, 0.71]], opacity: 0.6 },
    { points: [[0.5, 0.5], [0.29, 0.71], [0.2, 0.5]], opacity: 0.5 },
    { points: [[0.5, 0.5], [0.2, 0.5], [0.29, 0.29]], opacity: 0.5 },
    { points: [[0.5, 0.5], [0.29, 0.29], [0.5, 0.2]], opacity: 0.44 },
    { points: [[0.5, 0.5], [0.5, 0.2], [0.71, 0.29]], opacity: 0.44 },
    { points: [[0.5, 0.5], [0.71, 0.29], [0.8, 0.5]], opacity: 0.34 },
    { points: [[0.5, 0.38], [0.6, 0.56], [0.4, 0.56]], opacity: 0.34 },
  ],
};

/** The `points` string for a facet at rest — the exact value the reduced-motion path renders, and
 *  the same formatting the worklet produces, so a still frame and a morphing frame are the same
 *  shape expressed the same way. */
function facetPoints(facet: Facet): string {
  return facet.points.map(([x, y]) => `${x * VIEWBOX},${y * VIEWBOX}`).join(' ');
}

const AnimatedPolygon = Animated.createAnimatedComponent(Polygon);

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
      {/* `viewBox` rather than point coordinates: the poses are normalised, so the SVG does the
          scaling and nothing in this file has to know the rendered size. */}
      <Svg width={size} height={size} viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}>
        {facetIndices.map((index) =>
          animate ? (
            <MorphingFacet
              key={index}
              index={index}
              poses={poses}
              progress={progress}
              color={color}
              testID={testID ? `${testID}-facet-${index}` : undefined}
            />
          ) : (
            <Polygon
              key={index}
              testID={testID ? `${testID}-facet-${index}` : undefined}
              points={facetPoints(poses[0][index])}
              fill={color}
              opacity={poses[0][index].opacity}
            />
          )
        )}
      </Svg>
    </View>
  );
}

function MorphingFacet({
  index,
  poses,
  progress,
  color,
  testID,
}: {
  index: number;
  poses: readonly Pose[];
  progress: ReturnType<typeof useSharedValue<number>>;
  color: string;
  testID?: string;
}) {
  // Per-facet phase offset, in "pose units", so facets arrive at the next pose slightly apart.
  const offset = (index * Motion.stagger.facet) / Motion.duration.cinematic;

  const animatedProps = useAnimatedProps(() => {
    'worklet';
    const raw = Math.max(0, progress.value - offset);
    const count = poses.length;
    const from = Math.floor(raw) % count;
    const to = (from + 1) % count;
    const t = raw - Math.floor(raw);
    // Smoothstep the segment so a facet eases into and out of each pose even though the driver
    // itself is one continuous ramp across the whole sequence.
    const e = t * t * (3 - 2 * t);
    const a = poses[from][index];
    const b = poses[to][index];
    const mix = (p: number, q: number) => (p + (q - p) * e) * VIEWBOX;

    // THE PER-VERTEX MORPH. Three vertices, three independent interpolations — the triangle's own
    // internal geometry changes between poses, which is the thing the previous CSS-border build
    // could not express at all (see this file's header).
    return {
      points:
        `${mix(a.points[0][0], b.points[0][0])},${mix(a.points[0][1], b.points[0][1])} ` +
        `${mix(a.points[1][0], b.points[1][0])},${mix(a.points[1][1], b.points[1][1])} ` +
        `${mix(a.points[2][0], b.points[2][0])},${mix(a.points[2][1], b.points[2][1])}`,
      opacity: a.opacity + (b.opacity - a.opacity) * e,
    };
  });

  return (
    <AnimatedPolygon
      testID={testID}
      animatedProps={animatedProps}
      // The at-rest value, so the first painted frame is a real facet rather than an empty polygon
      // waiting for the driver's first tick.
      points={facetPoints(poses[0][index])}
      opacity={poses[0][index].opacity}
      fill={color}
    />
  );
}
