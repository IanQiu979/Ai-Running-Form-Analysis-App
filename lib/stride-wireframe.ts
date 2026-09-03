/**
 * The stride wireframe — the geometry behind `<StrideWireframeHero>` (components/
 * stride-wireframe-hero.tsx). Pure math, no React, no Reanimated imports: every function here is
 * either build-time (runs once at module load) or a `'worklet'` the component evaluates on the UI
 * thread once per frame. Keeping it here rather than in the component is what lets it be unit-
 * tested as plain functions (lib/__tests__/stride-wireframe.test.ts) and rendered outside the app
 * (a browser harness was used to tune the gait — see the component header).
 *
 * WHAT IT DRAWS. A side-view running figure as a motion-capture-style skeleton: joint markers
 * connected by straight bones, cycling through one closed running gait. Not a silhouette, not a
 * cartoon — the thing a gait lab's readout shows. The whole figure is authored in a normalised
 * 0-1 "figure box" with the hip pinned at `HIP` and the runner facing +x; the component scales
 * that box into whatever it is rendered at. The runner runs in place (a treadmill view), which is
 * exactly how a real gait analysis is filmed and is why the scrolling ground below it carries the
 * forward motion instead of the figure translating.
 *
 * THE GAIT IS CONTINUOUS, NOT KEYFRAME-STEPPED. `components/low-poly-field.tsx`'s runner eases
 * (`smoothstep`) from one of eight keyframes to the next, which means every joint's angular
 * velocity drops to zero at each keyframe — the figure very slightly pauses eight times per
 * cycle. For a low-poly mark that is invisible; for a skeleton that is meant to read as a
 * MEASUREMENT it is the difference between an instrument trace and a flip-book. So the eight
 * per-joint keyframes below are interpolated with a PERIODIC CATMULL-ROM SPLINE
 * (`catmullRomPeriodic`): C1-continuous everywhere, passes exactly through every authored
 * angle, and — because the spline is periodic — the cycle's end IS its start, so `withRepeat`
 * over one linear 0->1 ramp loops with no seam at all. That periodicity is a tested invariant.
 *
 * THE TABLES ARE THE HAND-ADJUSTABLE DATA. Everything else is fixed plumbing (bone lengths, a
 * forward-kinematics chain, path serialisation). Angles are in degrees from vertical for the
 * thigh and upper arm (positive = forward, toward +x), and RELATIVE joint flexion for the knee,
 * ankle and elbow (positive = flexed, the way a goniometer reads them), because that is the form
 * running biomechanics is described in — a table you can check against a textbook gait curve.
 * Eight phases per cycle, index i = i/8 of the way from one initial contact of the same foot to
 * the next. The second leg and the contralateral arm read the same tables half a cycle out of
 * phase, which is how two legs actually run — no second table.
 *
 * Grounded in the app's own certified PACE knowledge (`knowledge/pace_framework.md`), so the hero
 * never depicts a fault the app itself would flag:
 *   - Posture: one whole-body lean from the ankles (`LEAN_DEG`), never a bend at the waist.
 *   - Cadence: a compact landing — at contact the shin is near-vertical and the foot lands under
 *     the knee, a hair ahead of the hip, not reaching out in front (the overstride silhouette).
 *   - Elasticity: the deepest knee flexion in stance is at mid-stance (a compliant spring), and
 *     the vertical oscillation (`BOB_AMPLITUDE`) is deliberately small — energy travels forward.
 *   - Arm swing: elbows stay bent through the whole cycle and swing front-to-back, contralateral
 *     to the legs.
 */

// ---- Types -------------------------------------------------------------------------------------

/** A point in the normalised figure box (0-1, +y down, matching SVG). */
export type Pt = readonly [x: number, y: number];

/** Every joint the solver positions, for one phase of the cycle. `near*` is the side facing the
 *  camera (drawn on top, bright); `far*` is the other side (drawn behind, dimmer). */
export type Skeleton = {
  head: Pt;
  neck: Pt;
  shoulder: Pt;
  hip: Pt;
  nearKnee: Pt;
  nearAnkle: Pt;
  nearHeel: Pt;
  nearToe: Pt;
  farKnee: Pt;
  farAnkle: Pt;
  farHeel: Pt;
  farToe: Pt;
  nearElbow: Pt;
  nearWrist: Pt;
  farElbow: Pt;
  farWrist: Pt;
  /** Near-leg knee flexion in degrees at this phase — the angle the knee-arc readout displays. */
  nearKneeFlexDeg: number;
  /** The near thigh's direction from vertical, for placing the knee arc. */
  nearThighDeg: number;
  /** The near shin's direction from vertical, for placing the knee arc. */
  nearShinDeg: number;
};

// ---- Body proportions (figure-box units) ------------------------------------------------------

/** Where the pelvis sits. Everything hangs off this; the ground is derived below from where the
 *  feet actually reach, not authored independently, so the two can never disagree. */
export const HIP: Pt = [0.5, 0.5];
/** Whole-body forward lean from the ankles, degrees. PACE Posture wants ~5-8°. */
export const LEAN_DEG = 7;
export const TORSO_LEN = 0.21;
export const NECK_LEN = 0.035;
export const HEAD_RADIUS = 0.04;
export const THIGH_LEN = 0.2;
export const SHIN_LEN = 0.19;
/** Ankle -> ball of the foot. */
export const FOOT_LEN = 0.07;
/** Ankle -> heel. Short: the heel is a nub behind the ankle, not a second toe. */
export const HEEL_LEN = 0.028;
/** How far below horizontal the ankle->toe line points when the sole is flat on the ground. The
 *  ankle sits above the sole, so a flat foot's toe is this far down-forward of it. */
export const FOOT_DROP_DEG = 22;
/** The foot is RIGID: heel and toe are fixed relative to each other, so the sole is one line.
 *  This is the heel's direction relative to the ankle->toe direction, solved so that when the
 *  foot is flat (toe at `FOOT_DROP_DEG` below horizontal) the heel sits at the same height as
 *  the toe — a flat sole — rather than being a separately animated stub. */
export const HEEL_DIR_OFFSET_DEG: number = (() => {
  const toeDrop = FOOT_LEN * Math.sin((FOOT_DROP_DEG * Math.PI) / 180);
  const heelDeg = -(Math.acos(Math.min(1, toeDrop / HEEL_LEN)) * 180) / Math.PI;
  return heelDeg - (90 - FOOT_DROP_DEG);
})();
export const UPPER_ARM_LEN = 0.13;
export const FOREARM_LEN = 0.125;
/** Vertical oscillation of the hip, in figure-box units (peak-to-centre). Deliberately subtle. */
export const BOB_AMPLITUDE = 0.011;

// ---- Gait tables — eight phases, one closed cycle, from initial contact to initial contact ------
//
// Phase:      0      1      2      3      4      5      6      7
// Event:   contact  mid-  push-  toe-   early  mid-   knee   terminal
//                  stance  off    off    swing  swing  drive  swing

/** Thigh direction from vertical (+ forward). Flexed ahead at contact, extends through stance to
 *  trail behind at toe-off, then drives forward through swing to its peak before contact. */
export const THIGH_DEG: readonly number[] = [18, 10, -8, -24, -12, 14, 32, 30];
/** Knee flexion, relative (0 = straight). Small at contact, loads to its stance peak at
 *  mid-stance, near-straight at toe-off, folds hard mid-swing (heel to glute), unfolds to land. */
export const KNEE_FLEX_DEG: readonly number[] = [18, 36, 26, 12, 78, 102, 78, 34];
/** Ankle, relative to the shin: positive = plantarflexed (toe pointing down), negative =
 *  dorsiflexed (toe pulled up). Dorsiflexed as the body passes over the foot, plantarflexed for
 *  push-off, neutral-to-slightly-dorsiflexed through swing so the toe clears. */
export const ANKLE_FLEX_DEG: readonly number[] = [-6, -26, -22, 20, 10, 0, -8, -10];
/** Upper arm direction from vertical, for the arm on the SAME side as the leg the phase indexes
 *  — so it swings back while that leg drives forward (contralateral to the opposite leg, which
 *  is the one going forward with it). */
export const UPPER_ARM_DEG: readonly number[] = [-34, -22, 0, 18, 34, 24, 4, -18];
/** Elbow flexion, relative. Never extends — ~90° with a little more fold at the back of the swing
 *  and a little less at the front, which is how a relaxed arm actually carries. */
export const ELBOW_FLEX_DEG: readonly number[] = [104, 100, 92, 84, 80, 84, 92, 100];

export const GAIT_PHASES = THIGH_DEG.length;

// ---- Interpolation -----------------------------------------------------------------------------

/**
 * Periodic uniform Catmull-Rom over `table` at cycle position `phase` (any real; wraps mod 1).
 * Passes exactly through every table value at phase = i / N and is C1 across the wrap, which is
 * what makes the loop seamless. A worklet: called per frame on the UI thread.
 */
export function catmullRomPeriodic(table: readonly number[], phase: number): number {
  'worklet';
  const n = table.length;
  const p = ((phase % 1) + 1) % 1;
  const scaled = p * n;
  const i1 = Math.floor(scaled) % n;
  const t = scaled - Math.floor(scaled);
  const i0 = (i1 - 1 + n) % n;
  const i2 = (i1 + 1) % n;
  const i3 = (i1 + 2) % n;
  const p0 = table[i0];
  const p1 = table[i1];
  const p2 = table[i2];
  const p3 = table[i3];
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/** Where in the cycle the hip is lowest: mid-stance, a little after the 1/8 keyframe (the body
 *  is still loading the leg as it passes over the foot). Highest a quarter-cycle later, in
 *  mid-flight between this foot's toe-off and the other foot's contact. */
export const BOB_LOWEST_PHASE = 0.17;

/** Hip height offset (+ = lower). Two bounces per cycle (one per step). Analytic rather than
 *  tabled because it is a pure cosine by nature — a table would just be a worse cosine. */
export function hipBob(phase: number): number {
  'worklet';
  return BOB_AMPLITUDE * Math.cos(4 * Math.PI * (phase - BOB_LOWEST_PHASE));
}

// ---- Forward kinematics ------------------------------------------------------------------------

/** deg = 0 points straight down (+y); positive rotates toward +x (forward). */
function dir(deg: number): Pt {
  'worklet';
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
}

function step(from: Pt, deg: number, len: number): Pt {
  'worklet';
  const d = dir(deg);
  return [from[0] + d[0] * len, from[1] + d[1] * len];
}

/**
 * One leg at cycle position `phase`: knee, ankle and toe, hanging from `hip`. Direction of the
 * shin is the thigh's direction minus the knee flexion (flexion folds the shin backward); the
 * foot is perpendicular to the shin, rotated by the ankle's plantar/dorsiflexion.
 */
function solveLeg(
  hip: Pt,
  phase: number
): {
  knee: Pt;
  ankle: Pt;
  heel: Pt;
  toe: Pt;
  thighDeg: number;
  shinDeg: number;
  kneeFlexDeg: number;
} {
  'worklet';
  const thighDeg = catmullRomPeriodic(THIGH_DEG, phase);
  const kneeFlexDeg = catmullRomPeriodic(KNEE_FLEX_DEG, phase);
  const ankleFlexDeg = catmullRomPeriodic(ANKLE_FLEX_DEG, phase);
  const shinDeg = thighDeg - kneeFlexDeg;
  const knee = step(hip, thighDeg, THIGH_LEN);
  const ankle = step(knee, shinDeg, SHIN_LEN);
  // Neutral ankle = sole perpendicular to the shin, i.e. flat when the shin is vertical.
  const footDeg = shinDeg + 90 - FOOT_DROP_DEG - ankleFlexDeg;
  const toe = step(ankle, footDeg, FOOT_LEN);
  const heel = step(ankle, footDeg + HEEL_DIR_OFFSET_DEG, HEEL_LEN);
  return { knee, ankle, heel, toe, thighDeg, shinDeg, kneeFlexDeg };
}

function solveArm(shoulder: Pt, phase: number): { elbow: Pt; wrist: Pt } {
  'worklet';
  const upperDeg = catmullRomPeriodic(UPPER_ARM_DEG, phase);
  const elbowFlexDeg = catmullRomPeriodic(ELBOW_FLEX_DEG, phase);
  const elbow = step(shoulder, upperDeg, UPPER_ARM_LEN);
  // Flexion folds the forearm forward/up from the upper arm's line.
  const wrist = step(elbow, upperDeg + elbowFlexDeg, FOREARM_LEN);
  return { elbow, wrist };
}

/**
 * The whole skeleton at cycle position `phase` (0-1, wraps). The near leg reads the tables at
 * `phase`; the far leg at `phase + 0.5`. The near ARM reads at `phase + 0.5` — it is on the same
 * side as the near leg, so it swings back when that leg drives forward — and the far arm at
 * `phase`. A worklet: this is what every animated path calls per frame.
 */
export function solveStride(phase: number): Skeleton {
  'worklet';
  const hip: Pt = [HIP[0], HIP[1] + hipBob(phase)];
  // The trunk leans forward as one line from the hip; the head continues it.
  const shoulder = step(hip, 180 - LEAN_DEG, TORSO_LEN);
  const neck = step(shoulder, 180 - LEAN_DEG, NECK_LEN);
  const head = step(neck, 180 - LEAN_DEG, HEAD_RADIUS);
  const near = solveLeg(hip, phase);
  const far = solveLeg(hip, phase + 0.5);
  const nearArm = solveArm(shoulder, phase + 0.5);
  const farArm = solveArm(shoulder, phase);
  return {
    head,
    neck,
    shoulder,
    hip,
    nearKnee: near.knee,
    nearAnkle: near.ankle,
    nearHeel: near.heel,
    nearToe: near.toe,
    farKnee: far.knee,
    farAnkle: far.ankle,
    farHeel: far.heel,
    farToe: far.toe,
    nearElbow: nearArm.elbow,
    nearWrist: nearArm.wrist,
    farElbow: farArm.elbow,
    farWrist: farArm.wrist,
    nearKneeFlexDeg: near.kneeFlexDeg,
    nearThighDeg: near.thighDeg,
    nearShinDeg: near.shinDeg,
  };
}

// ---- Derived constants (build-time, from the gait itself) --------------------------------------

/** Sampling density for the build-time derivations below. Fine enough that the derived ground
 *  sits within a hairline of the true lowest point. */
const DERIVE_SAMPLES = 256;

/**
 * The ground line's y. Derived as the lowest point any foot reaches across the whole cycle, so
 * the stance foot visibly touches the ground at contact and nothing ever sinks through it — the
 * two things a gait readout would be laughed out of the lab for getting wrong. Not hand-authored:
 * retune a leg table and the ground follows.
 */
export const GROUND_Y: number = (() => {
  let lowest = 0;
  for (let i = 0; i < DERIVE_SAMPLES; i++) {
    const s = solveStride(i / DERIVE_SAMPLES);
    lowest = Math.max(lowest, s.nearHeel[1], s.nearToe[1], s.farHeel[1], s.farToe[1]);
  }
  return lowest;
})();

/** A foot closer to the ground than this counts as planted, for the derivations below. */
const PLANTED_TOLERANCE = 0.012;

/**
 * The stance window: the phases at which the near foot is planted, from a build-time sweep of
 * the first half-cycle. `from` should be ~0 (initial contact IS phase 0 by definition) and `to`
 * ~0.35-0.4 (toe-off); the tests hold the tables to that.
 */
export const STANCE: { readonly from: number; readonly to: number } = (() => {
  let from: number | null = null;
  let to = 0;
  for (let i = 0; i < DERIVE_SAMPLES; i++) {
    const phase = i / DERIVE_SAMPLES;
    if (phase > 0.5) break;
    const s = solveStride(phase);
    const soleY = Math.max(s.nearHeel[1], s.nearToe[1]);
    if (GROUND_Y - soleY < PLANTED_TOLERANCE) {
      if (from === null) from = phase;
      to = phase;
    }
  }
  return { from: from ?? 0, to };
})();

/**
 * How far the ground travels per cycle, in figure-box units — the planted foot's backward speed
 * relative to the hip, measured over the stance window above and held for the whole cycle. The
 * scrolling ground under the runner must move at exactly the speed the feet push it: a ground
 * that slides faster or slower than the stance foot is the single most common tell of a fake
 * treadmill loop. Derived, so a retuned leg table cannot desynchronise it.
 */
export const GROUND_TRAVEL_PER_CYCLE: number = (() => {
  const a = solveStride(STANCE.from).nearAnkle[0];
  const b = solveStride(STANCE.to).nearAnkle[0];
  const dt = STANCE.to - STANCE.from;
  return dt > 0 ? (a - b) / dt : 0;
})();

/** The still frame `<StrideWireframeHero>` renders under reduced motion: late swing, knee
 *  driving, the moment that reads as "running" even when frozen. Also the first painted frame
 *  before the driver's first tick, so a mount never flashes a different pose than a still. */
export const REST_PHASE = 0.72;

// ---- Path serialisation ------------------------------------------------------------------------
//
// Every drawn element is a `<Path d>` rather than a `<Line>`/`<Circle>`/`<Polyline>`, for the
// same reason `components/low-poly-field.tsx` animates a `Path`: under Fabric, Reanimated's
// UI-thread `animatedProps` commit writes straight to the host view, and only `d` is a real
// native prop on every element that draws a shape — an animated `points`, `x1`, or `cx` may be
// silently inert. One `d` string per layer also means a handful of animated nodes rather than
// one per bone.

/** Figure-box coordinates are serialised into a `VIEWBOX`-unit space, two decimals — short
 *  enough to build per frame, fine enough that nothing visibly quantises. */
export const VIEWBOX = 100;

function f(v: number): string {
  'worklet';
  return (v * VIEWBOX).toFixed(2);
}

function polyline(points: readonly Pt[]): string {
  'worklet';
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 1; i < points.length; i++) d += ` L${f(points[i][0])} ${f(points[i][1])}`;
  return d;
}

/** A circle as two arcs, so a marker is a `Path` like everything else. `r` in figure-box units. */
function circle(c: Pt, r: number): string {
  'worklet';
  const cx = c[0] * VIEWBOX;
  const cy = c[1] * VIEWBOX;
  const rr = r * VIEWBOX;
  return (
    `M${(cx - rr).toFixed(2)} ${cy.toFixed(2)} ` +
    `a${rr.toFixed(2)} ${rr.toFixed(2)} 0 1 0 ${(2 * rr).toFixed(2)} 0 ` +
    `a${rr.toFixed(2)} ${rr.toFixed(2)} 0 1 0 ${(-2 * rr).toFixed(2)} 0`
  );
}

/** The trunk: hip -> shoulder -> neck as one stroke, plus the head as a ring. */
export function corePath(s: Skeleton): string {
  'worklet';
  return `${polyline([s.hip, s.shoulder, s.neck])} ${circle(s.head, HEAD_RADIUS)}`;
}

/** A leg as one stroke: hip -> knee -> ankle, then the rigid foot as a closed ankle-heel-toe
 *  wedge, which is what a heel, toe and ankle marker joined up look like on a real capture. */
function legPath(hip: Pt, knee: Pt, ankle: Pt, heel: Pt, toe: Pt): string {
  'worklet';
  return `${polyline([hip, knee, ankle])} ${polyline([ankle, heel, toe])}Z`;
}

/** The near-side limbs (drawn on top): the leg and the arm shoulder->elbow->wrist. */
export function nearLimbsPath(s: Skeleton): string {
  'worklet';
  return `${legPath(s.hip, s.nearKnee, s.nearAnkle, s.nearHeel, s.nearToe)} ${polyline([
    s.shoulder,
    s.nearElbow,
    s.nearWrist,
  ])}`;
}

/** The far-side limbs (drawn behind the trunk, dimmer). */
export function farLimbsPath(s: Skeleton): string {
  'worklet';
  return `${legPath(s.hip, s.farKnee, s.farAnkle, s.farHeel, s.farToe)} ${polyline([
    s.shoulder,
    s.farElbow,
    s.farWrist,
  ])}`;
}

/** Marker radius, figure-box units. Small: these are mocap dots, not beads. */
export const MARKER_RADIUS = 0.011;

/** Every joint marker on the near side plus the trunk's, as one path of rings. */
export function nearMarkersPath(s: Skeleton): string {
  'worklet';
  const joints: readonly Pt[] = [
    s.hip,
    s.shoulder,
    s.nearKnee,
    s.nearAnkle,
    s.nearToe,
    s.nearElbow,
    s.nearWrist,
  ];
  let d = '';
  for (let i = 0; i < joints.length; i++) d += `${i ? ' ' : ''}${circle(joints[i], MARKER_RADIUS)}`;
  return d;
}

export function farMarkersPath(s: Skeleton): string {
  'worklet';
  const joints: readonly Pt[] = [s.farKnee, s.farAnkle, s.farToe, s.farElbow, s.farWrist];
  let d = '';
  for (let i = 0; i < joints.length; i++) d += `${i ? ' ' : ''}${circle(joints[i], MARKER_RADIUS)}`;
  return d;
}

/** Radius of the knee-flexion arc readout, figure-box units. */
export const KNEE_ARC_RADIUS = 0.055;

/**
 * The instrument readings: an arc at the near knee spanning the knee's flexion (between the
 * thigh's line continued past the knee and the shin), and a short vertical reference dropped
 * from the hip with a small arc to the trunk showing the lean. These two are what turn a
 * skeleton into a MEASUREMENT: the eye reads the arc opening and closing every stride.
 */
export function readoutPath(s: Skeleton): string {
  'worklet';
  // Knee flexion arc: from the thigh's continued direction (thighDeg) sweeping backward to the
  // shin's direction (shinDeg = thighDeg - flex). Directions are "from vertical, + forward", so
  // in SVG terms (0 = +x, clockwise positive) an angle `deg` from vertical is 90 - deg.
  const k = s.nearKnee;
  const r = KNEE_ARC_RADIUS;
  const a0 = ((90 - s.nearThighDeg) * Math.PI) / 180;
  const a1 = ((90 - s.nearShinDeg) * Math.PI) / 180;
  const x0 = k[0] + Math.cos(a0) * r;
  const y0 = k[1] + Math.sin(a0) * r;
  const x1 = k[0] + Math.cos(a1) * r;
  const y1 = k[1] + Math.sin(a1) * r;
  const large = s.nearKneeFlexDeg > 180 ? 1 : 0;
  const knee =
    `M${f(x0)} ${f(y0)} A${f(r)} ${f(r)} 0 ${large} 1 ${f(x1)} ${f(y1)}`;

  // Lean reference: a vertical from the hip up to shoulder height, and an arc from it to the
  // trunk's line. Small — it is a reading, not a second bone.
  const lr = 0.09;
  const hx = s.hip[0];
  const hy = s.hip[1];
  const leanRef = `M${f(hx)} ${f(hy)} L${f(hx)} ${f(hy - TORSO_LEN)}`;
  const la0 = -Math.PI / 2; // straight up
  const la1 = ((90 - (180 - LEAN_DEG)) * Math.PI) / 180; // the trunk's direction
  const lx0 = hx + Math.cos(la0) * lr;
  const ly0 = hy + Math.sin(la0) * lr;
  const lx1 = hx + Math.cos(la1) * lr;
  const ly1 = hy + Math.sin(la1) * lr;
  const leanArc = `M${f(lx0)} ${f(ly0)} A${f(lr)} ${f(lr)} 0 0 1 ${f(lx1)} ${f(ly1)}`;

  return `${knee} ${leanRef} ${leanArc}`;
}

/** The near leg alone, for the onion-skin trails that show where the limb just was. */
export function nearLegPath(s: Skeleton): string {
  'worklet';
  return legPath(s.hip, s.nearKnee, s.nearAnkle, s.nearHeel, s.nearToe);
}

/** Convenience for tests and the harness: every layer at one phase. */
export function strideLayers(phase: number) {
  const s = solveStride(phase);
  return {
    core: corePath(s),
    near: nearLimbsPath(s),
    far: farLimbsPath(s),
    nearMarkers: nearMarkersPath(s),
    farMarkers: farMarkersPath(s),
    readout: readoutPath(s),
    nearLeg: nearLegPath(s),
  };
}
