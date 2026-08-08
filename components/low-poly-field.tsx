/**
 * The low-poly mark — species-in-pieces.com's motif, adapted to this app.
 *
 * A small, fixed set of triangles cycles through exactly one story: an abstract, coiled-looking
 * `DEFAULT_POSE` shatters apart and reassembles into a running figure, which cycles through a
 * full gait — contact, load, toe-off, swing, knee drive, landing — before shattering back to the
 * default and holding there. `default -> shatter -> runner (gait loop) -> shatter -> default`,
 * forever. It carries the two screens that are otherwise dead air: the Analyzing wait (where it
 * is the honest "work is happening" signal — see the caveat below about what it must never
 * claim) and the first-run/empty/splash states, where it stands in for a result that does not
 * exist yet.
 *
 * REPLACED 2026-08-03: the previous build cycled three abstract poses (`scatter`/`stride`/
 * `gather`) with a plain per-vertex morph between them. This redesign keeps that per-vertex
 * morph technique — see "THE MORPH TECHNIQUE" below, unchanged — but replaces the pose set
 * entirely and adds a second interpolation mode, the shatter, for the two transitions that cross
 * between the abstract mark and the runner.
 *
 * THE MORPH TECHNIQUE (unchanged from the prior build): every pose is `FACET_COUNT` facets, each
 * three independent `[x, y]` vertices in normalised 0-1 space plus an opacity. A facet is an SVG
 * `<Polygon>`, not a CSS border-triangle, specifically so a pose can change a triangle's own
 * SHAPE (a sliver opening into a wedge) and not just its position/scale/rotation. One shared
 * `progress` value drives every facet on the UI thread; each facet reads it offset by
 * `FACET_STAGGER_UNIT * index` (a fraction of a pose-transition, not a millisecond count, so the
 * stagger scales automatically with whichever transition — a fast gait step or a slow shatter —
 * is currently playing) so the shape assembles rather than snaps.
 *
 * THE SHATTER (new): a plain per-vertex lerp reads as a dissolve, not a break — precisely wrong
 * for "the current large facets should break apart with real outward motion." So the two
 * transitions that cross the abstract/runner boundary (`SHATTER_AT`, computed below) use a
 * different vertex path: each vertex flies from its start point OUT to an exploded waypoint
 * (its own start/end midpoint pushed away from the field's centre, clamped so the burst stays
 * inside the field's own box — the SVG viewBox clips at its edge, so a shard that flew past it
 * would just vanish instead of reading as a burst), then flies IN from there to its destination.
 * Every other transition (one runner gait keyframe to the next) uses the plain straight lerp —
 * genuinely continuous limb motion has no business exploding outward every step.
 *
 * THE RUNNER POSE is procedurally generated (`buildRunnerKeyframes`, below), not hand-typed like
 * the old poses: it is 8 gait-phase keyframes x 17 facets x 3 vertices = 408 numbers, and getting
 * the two legs and two arms exactly half-a-cycle out of phase by hand-authoring six-plus copies
 * would drift. The generator is parameterised by two small, readable phase tables
 * (`LEG_TABLE`/`ARM_TABLE`) — those tables ARE the hand-adjustable data; the geometry functions
 * around them are fixed plumbing (joint lengths, the lean line, a limb-segment wedge shape),
 * which is the same "eyeball-able authored data, not a black-box loop" spirit the old `gather`
 * pose's comment asked for, just with the loop doing FK arithmetic instead of literal duplication.
 *
 * The gait is grounded in this app's own certified PACE knowledge (`knowledge/pace_framework.md`)
 * so the mark never depicts a fault the app itself would flag:
 *   - Posture: the whole body leans forward `LEAN_DEG` (~7°) from a straight ankle-hip-shoulder-
 *     head line, not a bend at the waist.
 *   - Cadence: `LEG_TABLE`'s contact/landing phases keep the foot close under the hip (a small
 *     forward thigh angle, a near-vertical shin) rather than reaching out ahead of it —
 *     deliberately avoiding the overstride silhouette PACE flags as a fault.
 *   - Elasticity: the load phase is the deepest knee bend (a compliant spring, not a stiff
 *     landing), and `bobTable`'s small hip-height oscillation is deliberately subtle — PACE wants
 *     energy travelling forward, not bouncing up.
 *   - Arm swing: `ARM_TABLE` keeps the elbow roughly bent through the whole cycle (never fully
 *     extended) and swings front-to-back, contralateral to the legs.
 * `FACET_COUNT` (17) was reached by rendering the 8 keyframes to SVG and iterating until the
 * figure genuinely read as a runner — the prior pose set's 9 facets were confirmed too few for
 * this; this is not a guessed number.
 *
 * HONESTY (this matters more than the animation): on the Analyzing screen this must never look
 * like a progress bar. It has no start and no end, it does not fill, and it does not accelerate
 * as the request ages. It is an ambient "alive" signal, in exactly the same category as
 * `app/analyzing.tsx`'s existing step captions.
 *
 * REDUCED MOTION: renders `DEFAULT_POSE` as plain, un-animated `<Polygon>`s — not merely a paused
 * animation, but no Reanimated work scheduled at all. The field still appears — it is
 * composition, not just movement — it simply stops moving and never shatters. That is the correct
 * reading of the reduced-motion contract `docs/design/motion-consult.md` sets out: suppress
 * vestibular triggers, keep the thing that carries meaning. The abstract default, not a runner
 * frame, is the still frame — a held gait-cycle instant would misleadingly imply an in-progress
 * motion the reduced-motion user has explicitly asked not to see animate.
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
import Svg, { Path, Polygon } from 'react-native-svg';

import { Motion } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

/** Fixed, so a pose is a tuple the type system can check rather than a list that can be short. */
export const FACET_COUNT = 17;

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

// ---------------------------------------------------------------------------------------------
// Geometry helpers — plain build-time math, run once at module load to produce the pose data
// below. Not worklets: nothing here runs per-frame, only the interpolation in `MorphingFacet`
// does.
// ---------------------------------------------------------------------------------------------

function addV(a: Vertex, b: Vertex): Vertex {
  return [a[0] + b[0], a[1] + b[1]];
}
function scaleV(a: Vertex, s: number): Vertex {
  return [a[0] * s, a[1] * s];
}
/** deg=0 -> straight down; positive rotates toward +x (forward); negative toward -x (backward);
 *  |deg| approaching 180 points upward. Used for every bone direction below. */
function directionFromVertical(deg: number): Vertex {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
}
/** Unit vector perpendicular to (b - a), for building a limb's width off its own long axis. */
function perpendicular(a: Vertex, b: Vertex): Vertex {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [-dy / len, dx / len];
}
/** A tapered limb wedge: wide at `a` (the joint it attaches from), narrowing to a point at `b` —
 *  the same "elongated wedge" language the shipped `stride` pose used, just computed from two
 *  joint positions instead of hand-typed. */
function limbFacet(a: Vertex, b: Vertex, thickness: number, opacity: number): Facet {
  const p = perpendicular(a, b);
  const p1 = addV(a, scaleV(p, thickness));
  const p2 = addV(a, scaleV(p, -thickness));
  return { points: [p1, p2, b], opacity };
}

// ---- Body proportions (normalised 0-1 space) ----
const LEAN_DEG = 7; // whole-body forward lean from the ankles, ~5-8° (PACE Posture)
const HIP: Vertex = [0.5, 0.53];
const TORSO_LEN = 0.22;
const HEAD_LEN = 0.055;
const THIGH_LEN = 0.19;
const SHIN_LEN = 0.19;
const UPPER_ARM_LEN = 0.13;
const FOREARM_LEN = 0.12;

const upLean: Vertex = (() => {
  const d = directionFromVertical(LEAN_DEG);
  return [-d[0], -d[1]];
})();

/** Torso, head and pelvis — facet indices 0-4. `hipYOffset` carries the gait cycle's small
 *  vertical bob (Elasticity: energy travels forward, so the bob stays subtle). */
function coreFacets(hipYOffset: number): { hip: Vertex; shoulder: Vertex; facets: Facet[] } {
  const hip: Vertex = [HIP[0], HIP[1] + hipYOffset];
  const shoulder = addV(hip, scaleV(upLean, TORSO_LEN));
  const headBase = addV(shoulder, scaleV(upLean, HEAD_LEN * 0.3));
  const headTip = addV(shoulder, scaleV(upLean, HEAD_LEN));
  const p = perpendicular(hip, shoulder);
  const torsoFront: Facet = {
    points: [addV(shoulder, scaleV(p, 0.05)), addV(hip, scaleV(p, 0.045)), addV(hip, scaleV(p, -0.045))],
    opacity: 0.92,
  };
  const torsoBack: Facet = {
    points: [addV(shoulder, scaleV(p, 0.05)), addV(hip, scaleV(p, -0.045)), addV(shoulder, scaleV(p, -0.05))],
    opacity: 0.7,
  };
  const headP = perpendicular(headBase, headTip);
  const headFront: Facet = { points: [headBase, headTip, addV(headBase, scaleV(headP, 0.05))], opacity: 0.92 };
  const headBack: Facet = { points: [headBase, headTip, addV(headBase, scaleV(headP, -0.05))], opacity: 0.7 };
  const pelvis: Facet = {
    points: [addV(hip, scaleV(p, 0.05)), addV(hip, scaleV(p, -0.05)), addV(hip, scaleV(upLean, -0.05))],
    opacity: 0.6,
  };
  return { hip, shoulder, facets: [torsoFront, torsoBack, headFront, headBack, pelvis] };
}

/** 8-phase leg story (thighDeg, shinDeg), one full gait cycle for one leg. The other leg reads
 *  this same table offset by half the cycle (`legFacets` below), which is how two legs actually
 *  run — no separate table needed. */
const LEG_TABLE: readonly [number, number][] = [
  [16, 4], // 0 contact — compact, lands under the hip, not out ahead (Cadence)
  [-8, -30], // 1 load / mid-stance — deepest compliant knee bend (Elasticity)
  [-35, -55], // 2 toe-off — leg extending behind for push-off
  [-28, -100], // 3 early swing — heel rising behind
  [-22, -160], // 4 recovery fold peak — thigh still trailing, heel folded up near the glute
  [40, -45], // 5 knee drive rising — thigh forward, shin still folded/tucked (not reaching)
  [42, -8], // 6 knee drive peak — thigh forward-high, shin tucked near-vertical under the knee
  [22, 2], // 7 unfolding toward landing — still compact, about to contact under the hip
];
const GAIT_PHASES = LEG_TABLE.length;

/** Elbows stay bent through the whole cycle (never fully extended) and swing front-to-back,
 *  contralateral to the legs (PACE Arm swing). Phase-indexed the same way as `LEG_TABLE`. */
const ARM_TABLE: readonly [number, number][] = [
  [-25, -95],
  [-40, -100],
  [-55, -95],
  [-35, -60],
  [10, -50],
  [40, -80],
  [45, -95],
  [10, -95],
];

/** Small hip-height oscillation, lowest at load (deepest compression) and highest at flight —
 *  kept subtle per PACE Elasticity ("low, controlled vertical oscillation"). */
const BOB_TABLE: readonly number[] = [0, 0.012, 0.006, -0.01, -0.016, -0.01, -0.004, 0.004];

/** Bone lengths are fixed (real joints don't stretch), so a joint-angle-only keyframe would
 *  leave every limb facet a RIGID triangle that only rotates step to step — congruent shapes,
 *  the exact "moved but never reshaped" failure the per-vertex morph rebuild exists to rule out
 *  (see the file header). This multiplies each limb's wedge thickness per phase — thicker at
 *  load (a compressed, weighted look), thinner at the recovery fold (light, relaxed) — so the
 *  triangle's own proportions genuinely change keyframe to keyframe, not just its position. */
const PHASE_THICKNESS_MULT: readonly number[] = [1.15, 1.3, 1.0, 0.85, 0.8, 0.9, 0.95, 1.05];

function legFacets(hip: Vertex, phaseIdx: number): { facets: Facet[] } {
  const phase = ((phaseIdx % GAIT_PHASES) + GAIT_PHASES) % GAIT_PHASES;
  const [thighDeg, shinDeg] = LEG_TABLE[phase];
  const m = PHASE_THICKNESS_MULT[phase];
  const knee = addV(hip, scaleV(directionFromVertical(thighDeg), THIGH_LEN));
  const ankle = addV(knee, scaleV(directionFromVertical(shinDeg), SHIN_LEN));
  // Foot: a short wedge toward a toe point — dorsiflexed near load, plantarflexed at toe-off.
  const footDeg = shinDeg + (phase === 2 ? -50 : phase === 1 ? 20 : -10);
  const toe = addV(ankle, scaleV(directionFromVertical(footDeg), 0.09));
  return {
    facets: [
      limbFacet(hip, knee, 0.032 * m, 0.85),
      limbFacet(knee, ankle, 0.024 * m, 0.8),
      limbFacet(ankle, toe, 0.02 * m, 0.75),
    ],
  };
}

function armFacets(shoulder: Vertex, phaseIdx: number): { facets: Facet[] } {
  const phase = ((phaseIdx % GAIT_PHASES) + GAIT_PHASES) % GAIT_PHASES;
  const [upperDeg, foreDeg] = ARM_TABLE[phase];
  const m = PHASE_THICKNESS_MULT[phase];
  const elbow = addV(shoulder, scaleV(directionFromVertical(upperDeg), UPPER_ARM_LEN));
  const hand = addV(elbow, scaleV(directionFromVertical(foreDeg), FOREARM_LEN));
  const fist = addV(hand, scaleV(directionFromVertical(foreDeg), 0.035));
  return {
    facets: [
      limbFacet(shoulder, elbow, 0.02 * m, 0.85),
      limbFacet(elbow, hand, 0.016 * m, 0.8),
      limbFacet(hand, fist, 0.0144 * m, 0.7),
    ],
  };
}

/** One full runner keyframe at gait-phase `phaseIdx` (0..GAIT_PHASES-1): torso/head/pelvis, then
 *  both legs and both arms, the second of each pair reading the same tables half a cycle out of
 *  phase — exactly `FACET_COUNT` facets, in the fixed index order every pose shares. */
function runnerKeyframe(phaseIdx: number): Pose {
  const { hip, shoulder, facets: core } = coreFacets(BOB_TABLE[((phaseIdx % GAIT_PHASES) + GAIT_PHASES) % GAIT_PHASES]);
  const legA = legFacets(hip, phaseIdx);
  const legB = legFacets(hip, phaseIdx + GAIT_PHASES / 2);
  const armA = armFacets(shoulder, phaseIdx + GAIT_PHASES / 2);
  const armB = armFacets(shoulder, phaseIdx);
  return [...core, ...legA.facets, ...legB.facets, ...armA.facets, ...armB.facets];
}

function buildRunnerKeyframes(): readonly Pose[] {
  return Array.from({ length: GAIT_PHASES }, (_, i) => runnerKeyframe(i));
}

/** A fan of `count` triangles sharing an inner vertex near `center`, spanning `spreadDeg` around
 *  `dirDeg` (0=left, 90=down, 180=right, 270=up) — the same technique the shipped `gather` pose
 *  used for its eight sectors, reused here per body-region cluster. */
function fanCluster(
  count: number,
  center: Vertex,
  dirDeg: number,
  spreadDeg: number,
  innerR: number,
  outerR: number,
  opacityBase: number
): Facet[] {
  const facets: Facet[] = [];
  for (let i = 0; i < count; i++) {
    const a0 = dirDeg - spreadDeg / 2 + (spreadDeg * i) / count;
    const a1 = dirDeg - spreadDeg / 2 + (spreadDeg * (i + 1)) / count;
    const inner = addV(center, scaleV(directionFromVertical(a0 - 90), innerR));
    const outer0 = addV(center, scaleV(directionFromVertical(a0 - 90), outerR));
    const outer1 = addV(center, scaleV(directionFromVertical(a1 - 90), outerR));
    facets.push({ points: [inner, outer0, outer1], opacity: opacityBase - i * 0.04 });
  }
  return facets;
}

/** The abstract default mark: five fan clusters (17 facets total, matching `FACET_COUNT`)
 *  loosely topological to the runner it shatters into — the torso/head cluster sits up top, the
 *  two leg clusters fan down and out, the two arm clusters sit at the sides — so the shatter
 *  reads as this mark unfurling into the figure it was always coiled to become, not an arbitrary
 *  swap. Each cluster reads as one visually fused chunk despite being several facets, which is
 *  what gives the shatter something chunky to break apart (see the file header). */
function buildDefaultPose(): Pose {
  const core = fanCluster(5, [0.5, 0.32], 270, 110, 0.02, 0.16, 0.85); // 0-4: torso/head/pelvis
  const legA = fanCluster(3, [0.44, 0.5], 65, 60, 0.03, 0.3, 0.6); // 5-7
  const legB = fanCluster(3, [0.56, 0.5], 115, 60, 0.03, 0.3, 0.6); // 8-10
  const armA = fanCluster(3, [0.34, 0.36], 15, 55, 0.03, 0.2, 0.5); // 11-13
  const armB = fanCluster(3, [0.66, 0.36], 165, 55, 0.03, 0.2, 0.5); // 14-16
  return [...core, ...legA, ...legB, ...armA, ...armB];
}

/** The abstract mark — also the reduced-motion still frame (see file header). */
export const DEFAULT_POSE: Pose = buildDefaultPose();
/** One full running gait cycle, in order. Loops back to its own start seamlessly (`GAIT_PHASES`
 *  keyframes are one closed cycle), so repeating this array plays as continuous running. */
export const RUNNER_KEYFRAMES: readonly Pose[] = buildRunnerKeyframes();

/** How many times the gait cycle repeats before shattering back to the default. */
const GAIT_CYCLES = 3;

/** The full driven sequence for one loop of the mark: the default mark, then the gait cycle
 *  repeated `GAIT_CYCLES` times, then back to the default (via `withRepeat` wrapping the last
 *  entry to the first — see the `useEffect` below). */
const SEQUENCE: readonly Pose[] = [
  DEFAULT_POSE,
  ...Array.from({ length: GAIT_CYCLES }, () => RUNNER_KEYFRAMES).flat(),
];

/** `SHATTER_AT[i]` is true when the transition FROM `SEQUENCE[i]` is a shatter (crosses the
 *  abstract/runner boundary) rather than a plain gait-to-gait morph. Exactly two: default -> the
 *  first runner keyframe, and the last runner keyframe -> default — symmetric in both directions,
 *  per the design brief. */
const SHATTER_AT: readonly boolean[] = SEQUENCE.map((_, i) => i === 0 || i === SEQUENCE.length - 1);

/** The `points` string for a facet at rest — the exact value the reduced-motion path renders, and
 *  the same formatting the worklet produces, so a still frame and a morphing frame are the same
 *  shape expressed the same way. */
function facetPoints(facet: Facet): string {
  return facet.points.map(([x, y]) => `${x * VIEWBOX},${y * VIEWBOX}`).join(' ');
}

/** Same shape as `facetPoints`, expressed as the `d` a `<Polygon points=...>` compiles to
 *  internally (`Mx0 y0 x1 y1 x2 y2z`) — used directly by `MorphingFacet`'s at-rest value, see
 *  its comment for why the animated facet is a `Path`, not a `Polygon`. */
function facetPathD(facet: Facet): string {
  return `M${facet.points.map(([x, y]) => `${x * VIEWBOX} ${y * VIEWBOX}`).join(' ')}z`;
}

const AnimatedPath = Animated.createAnimatedComponent(Path);

type LowPolyFieldProps = {
  /** Triangle colour. Callers pass a theme token — this component invents no colour. */
  color: string;
  /** Field size in points. Square. */
  size: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function LowPolyField({ color, size, style, testID }: LowPolyFieldProps) {
  const reduceMotion = useReducedMotion();
  const animate = !reduceMotion;

  // A single driver for the whole field: its integer part selects the pose pair, its fractional
  // part is the interpolation between them. One shared value, seventeen readers, zero JS/frame.
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!animate) {
      progress.value = 0;
      return;
    }
    // One `withSequence` step per pose transition, repeated forever. Built rather than driven by
    // a modulo so the final step lands exactly back where it started and the loop seam is
    // invisible: the driver ramps 0 -> SEQUENCE.length, and `SEQUENCE.length % SEQUENCE.length
    // === 0` is the default pose again. Only the very first step (arriving at/holding the
    // default) carries the hold delay — the gait steps run back-to-back for continuous motion.
    const steps = SEQUENCE.map((_, i) => {
      const timing = withTiming(i + 1, {
        duration: SHATTER_AT[i] ? Motion.duration.epic : Motion.duration.quick,
        easing: Easing.bezier(...Motion.curve.morph),
      });
      return i === 0 ? withDelay(Motion.duration.epic, timing) : timing;
    });
    progress.value = 0;
    // `withSequence`'s return type widens to `AnimatableValue` (it can sequence colours and
    // strings too); this driver is only ever numeric, so the narrowing cast is safe and is what
    // keeps the shared value typed as `number` for every reader in `FacetView`.
    progress.value = withRepeat(withSequence(...steps), -1, false) as number;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- progress is a stable shared value
  }, [animate]);

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
              progress={progress}
              color={color}
              testID={testID ? `${testID}-facet-${index}` : undefined}
            />
          ) : (
            <Polygon
              key={index}
              testID={testID ? `${testID}-facet-${index}` : undefined}
              points={facetPoints(DEFAULT_POSE[index])}
              fill={color}
              opacity={DEFAULT_POSE[index].opacity}
            />
          )
        )}
      </Svg>
    </View>
  );
}

/** Per-facet phase offset, as a fraction of a pose-transition rather than a millisecond count —
 *  `progress` always advances exactly 1.0 per transition regardless of that transition's own
 *  duration, so a fixed fraction here scales automatically whether it lands inside a brisk gait
 *  step or a slow shatter, instead of needing a different constant for each. */
const FACET_STAGGER_UNIT = 0.008;

function smoothstep(t: number): number {
  'worklet';
  return t * t * (3 - 2 * t);
}

/** During a plain gait-to-gait transition, a vertex eases straight from `a` to `b`. During a
 *  shatter transition it instead flies OUT from `a` to an exploded waypoint — the segment's own
 *  midpoint pushed away from the field's centre, clamped to stay inside the field's box — then
 *  flies IN from there to `b`. That waypoint is shared by both halves (continuous at t=0.5), so
 *  the piece visibly detaches, disperses, and arrives newly assembled rather than dissolving in
 *  a straight line. See the file header for why a straight lerp reads as a dissolve, not a break.
 */
function vertexPos(a: Vertex, b: Vertex, t: number, shatter: boolean): [number, number] {
  'worklet';
  if (!shatter) {
    const e = smoothstep(t);
    return [(a[0] + (b[0] - a[0]) * e) * VIEWBOX, (a[1] + (b[1] - a[1]) * e) * VIEWBOX];
  }
  const midX = (a[0] + b[0]) / 2;
  const midY = (a[1] + b[1]) / 2;
  const dx = midX - 0.5;
  const dy = midY - 0.5;
  const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
  const r = Math.min(Math.max(dist * 1.5, 0.14), 0.44);
  const ex = 0.5 + (dx / dist) * r;
  const ey = 0.5 + (dy / dist) * r;
  if (t < 0.5) {
    const e = smoothstep(t / 0.5);
    return [(a[0] + (ex - a[0]) * e) * VIEWBOX, (a[1] + (ey - a[1]) * e) * VIEWBOX];
  }
  const e = smoothstep((t - 0.5) / 0.5);
  return [(ex + (b[0] - ex) * e) * VIEWBOX, (ey + (b[1] - ey) * e) * VIEWBOX];
}

function MorphingFacet({
  index,
  progress,
  color,
  testID,
}: {
  index: number;
  progress: ReturnType<typeof useSharedValue<number>>;
  color: string;
  testID?: string;
}) {
  const offset = index * FACET_STAGGER_UNIT;

  const animatedProps = useAnimatedProps(() => {
    'worklet';
    const raw = Math.max(0, progress.value - offset);
    const count = SEQUENCE.length;
    const from = Math.floor(raw) % count;
    const to = (from + 1) % count;
    const t = raw - Math.floor(raw);
    const shatter = SHATTER_AT[from];
    const a = SEQUENCE[from][index];
    const b = SEQUENCE[to][index];

    const [x0, y0] = vertexPos(a.points[0], b.points[0], t, shatter);
    const [x1, y1] = vertexPos(a.points[1], b.points[1], t, shatter);
    const [x2, y2] = vertexPos(a.points[2], b.points[2], t, shatter);

    return {
      // A real `d`, not a `points` string: `<Polygon points=...>` only turns `points` into the
      // `d` its native view actually draws inside its own JS `render()`/`setNativeProps`, and
      // under Fabric, Reanimated's UI-thread `animatedProps` commit writes straight to the host
      // view without ever calling either of those — so an animated `points` prop is silently
      // inert (the shared value keeps advancing; nothing ever repaints). Building `d` ourselves
      // and animating a `<Path>` (whose `d` IS the native prop) is the fix, not a workaround.
      d: `M${x0} ${y0} ${x1} ${y1} ${x2} ${y2}z`,
      opacity: a.opacity + (b.opacity - a.opacity) * smoothstep(t),
    };
  });

  return (
    <AnimatedPath
      testID={testID}
      animatedProps={animatedProps}
      // The at-rest value, so the first painted frame is a real facet rather than an empty
      // path waiting for the driver's first tick.
      d={facetPathD(DEFAULT_POSE[index])}
      opacity={DEFAULT_POSE[index].opacity}
      fill={color}
    />
  );
}
