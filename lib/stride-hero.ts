/**
 * V23-02 Hero — the geometry and timeline of the entry screen's line-drawn runner, ported from
 * the captain-approved Claude Design page (`V23-02 Hero.dc.html`, its `hero(t)` function) with
 * every constant, easing and timestamp kept as the page has them. Pure and framework-free so the
 * whole thing is unit-tested at fixed instants (`lib/__tests__/stride-hero.test.ts`) and so
 * `components/stride-hero.tsx` can evaluate it once per frame on the UI thread — every function
 * here is a worklet.
 *
 * The page's coordinate space is a 393 x 852 canvas (`HERO_VIEWBOX`). The figure's hip sits at
 * (196, 380) and the ground rule at y = 576; the figure group is scaled 1.15 about (196, 576).
 * Cadence 176 spm is one stride (two steps) every 0.682 s, so the runner's phase is
 * `-t * 2pi / 0.682` — and it keeps running after the callouts land. The page holds "running",
 * not a still, and the reduced-motion still is simply the frame at `HERO_END_T`.
 *
 * TIMELINE (seconds from mount):
 *   0.0-1.0  the figure draws itself, head to trailing foot, ease-out (`eo`)
 *   0.9-1.3  the two motion-trail ghosts fade in (0.14 / 0.30 of ink2)
 *   1.2+0.35i  callout i: leader grows 250 ms, label fades 200 ms, number counts up 400 ms
 *   2.6-3.2  leaders and anchor dots dim to 0.65
 *   >= 4.0   the screen shows its cue (that is the screen's job, see `HERO_CUE_T`)
 *
 * WHY LENGTHS ARE COMPUTED. The page draws each stroke on with `pathLength="100"` and a dash
 * offset — react-native-svg has no `pathLength`, so each frame reports the REAL length of every
 * polyline (they are all straight segments, so this is a sum of distances) for the component to
 * use as `strokeDasharray`/`strokeDashoffset`. The head is a circle, whose length is `2 * pi * r`.
 */
import type { PacePillarId } from '@shared/pace';

export const HERO_VIEWBOX = { width: 393, height: 852 } as const;

/** The page's "hold": every callout has landed and the leaders have dimmed. The frame the
 *  reduced-motion still is drawn from (the page's own end frame is `hero(9.05)`). */
export const HERO_END_T = 9;
/** When the screen's "Continue" cue may appear — 0.8 s after the 3.2 s timeline settles. */
export const HERO_CUE_T = 4;

export type Point = readonly [number, number];

const D = Math.PI / 180;
/** One stride every 0.682 s (176 spm). */
const STRIDE_OMEGA = (2 * Math.PI) / 0.682;

const HIP0: Point = [196, 380];
const LEAN = 8 * D;
const TORSO = 112;
const HEAD_R = 21;
export const HEAD_CIRCUMFERENCE = 2 * Math.PI * HEAD_R;
export const GROUND_Y = 576;
const GROUND_X0 = 24;
const GROUND_X1 = 369;
export const GROUND_DASH = 12;
export const FIGURE_SCALE = 1.15;

export const Stroke = {
  figure: 1.4,
  joint: 1.1,
  leader: 1,
  ground: 1,
} as const;

export const Radius = {
  head: HEAD_R,
  joint: 2,
  anchor: 2.5,
} as const;

/** Clamp to [0, 1]. */
export function cl(x: number): number {
  'worklet';
  return Math.max(0, Math.min(1, x));
}

/** The page's ease-out: 1 - (1 - x)^4. */
export function eo(x: number): number {
  'worklet';
  return 1 - Math.pow(1 - cl(x), 4);
}

function fmt(p: Point): string {
  'worklet';
  return p[0].toFixed(1) + ' ' + p[1].toFixed(1);
}

function dist(a: Point, b: Point): number {
  'worklet';
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/** Sum of the straight segments joining `pts` in order. */
export function polylineLength(pts: readonly Point[]): number {
  'worklet';
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  return total;
}

export type Skeleton = {
  head: Point;
  /** The five stroke runs, in the page's order: torso, far leg, far arm, near leg, near arm. */
  segments: readonly (readonly Point[])[];
  /** The thirteen joints the main figure marks. */
  joints: readonly Point[];
};

type Leg = { K: Point; F: Point; T: Point; HL: Point };
type Arm = { E: Point; Hd: Point };

/** The figure at stride phase `ph` (radians), in canvas coordinates. */
export function skeletonAt(ph: number): Skeleton {
  'worklet';
  const leg = (f: number): Leg => {
    // Thigh swings +-44 deg; the knee flexes most mid forward-swing, nearly straight at toe-off.
    const th = 44 * D * Math.sin(f);
    const kf = (12 + 105 * Math.pow(0.5 + 0.5 * Math.sin(f - 1.0), 3)) * D;
    const K: Point = [HIP0[0] + 96 * Math.sin(th), HIP0[1] + 96 * Math.cos(th)];
    const sa = th - kf;
    const F: Point = [K[0] + 92 * Math.sin(sa), K[1] + 92 * Math.cos(sa)];
    const ft = (-10 + 30 * Math.sin(f) + 8 * Math.cos(f)) * D;
    const c = Math.cos(ft);
    const sn = Math.sin(ft);
    const rot = (x: number, y: number): Point => [F[0] + x * c + y * sn, F[1] - x * sn + y * c];
    return { K, F, T: rot(24, 9), HL: rot(-7, 9) };
  };
  const L1 = leg(ph);
  const L2 = leg(ph + Math.PI);
  // Steady hip height with a gentle sinusoidal bob, two per stride.
  const dy = GROUND_Y - (HIP0[1] + 178) - 11 * Math.cos(2 * ph + 0.6);
  const sh = (p: Point): Point => [p[0], p[1] + dy];
  const HIP: Point = [HIP0[0], HIP0[1] + dy];
  const SH: Point = [HIP[0] + TORSO * Math.sin(LEAN), HIP[1] - TORSO * Math.cos(LEAN)];
  const NECK: Point = [SH[0] + 14 * Math.sin(LEAN), SH[1] - 14 * Math.cos(LEAN)];
  const HEAD: Point = [NECK[0] + 23 * Math.sin(LEAN), NECK[1] - 23 * Math.cos(LEAN)];
  const arm = (f: number): Arm => {
    const ua = -45 * D * Math.sin(f) + 4 * D;
    const E: Point = [SH[0] + 62 * Math.sin(ua), SH[1] + 62 * Math.cos(ua)];
    const fa = ua + 85 * D;
    return { E, Hd: [E[0] + 58 * Math.sin(fa), E[1] + 58 * Math.cos(fa)] };
  };
  // Arms lag the legs slightly.
  const A1 = arm(ph + Math.PI + 0.15);
  const A2 = arm(ph + 0.15);
  const l1: Leg = { K: sh(L1.K), F: sh(L1.F), T: sh(L1.T), HL: sh(L1.HL) };
  const l2: Leg = { K: sh(L2.K), F: sh(L2.F), T: sh(L2.T), HL: sh(L2.HL) };
  return {
    head: HEAD,
    segments: [
      [HIP, SH, NECK],
      [HIP, l2.K, l2.F, l2.HL, l2.T, l2.F],
      [SH, A2.E, A2.Hd],
      [HIP, l1.K, l1.F, l1.HL, l1.T, l1.F],
      [SH, A1.E, A1.Hd],
    ],
    joints: [HIP, NECK, SH, l1.K, l1.F, l1.T, l2.K, l2.F, l2.T, A1.E, A1.Hd, A2.E, A2.Hd],
  };
}

/** One skeleton as the component draws it. */
export type SkeletonFrame = {
  head: Point;
  /** The five runs joined into one `d` string, so a single dash offset draws them in order. */
  d: string;
  /** Real length of `d` — the dash array the draw-on uses. */
  length: number;
  /** 0-1 of the body drawn; 1 once the draw-on is over (and always 1 for a ghost). */
  draw: number;
  /** 0-1 of the head circle drawn — it completes in the first quarter of the body's draw. */
  headDraw: number;
  /** Group opacity. */
  opacity: number;
  /** The joint markers' group opacity (main figure only; ghosts have none). */
  jointOpacity: number;
  joints: readonly Point[];
};

export type CalloutFrame = {
  /** 0-1 of the leader line drawn. */
  leader: number;
  /** Real length of the leader polyline. */
  leaderLength: number;
  /** Leader and anchor dot: the 2.6-3.2 s settle dims both to 0.65. */
  dim: number;
  /** The anchor dot's own opacity (`dim * leader`). */
  anchorOpacity: number;
  /** Name and sub-line opacity. */
  labelOpacity: number;
  /** 1 once the count-up has started, else 0. */
  metricOpacity: number;
  /** The counted-up number, rounded. */
  value: number;
};

export type HeroFrame = {
  /** Both ground rules share this opacity (they arrive with the draw-on). */
  groundOpacity: number;
  /** The dashed rule's travel. */
  groundDashOffset: number;
  ghosts: readonly [SkeletonFrame, SkeletonFrame];
  main: SkeletonFrame;
  callouts: readonly CalloutFrame[];
};

export type HeroCallout = {
  id: PacePillarId;
  value: number;
  /** `A` = the anchor on the figure, `E` = the elbow, `X` = the end at the margin. */
  A: Point;
  E: Point;
  X: Point;
  /** Which margin the text hangs from. */
  anchor: 'start' | 'end';
  /** Text x, and the three baselines: name, sub-line, metric. */
  tx: number;
  ly: number;
  sy: number;
  my: number;
};

/** The page's `C` table, in arrival order. Names, sub-lines and units live in `Copy.entry.hero`. */
export const HERO_CALLOUTS: readonly HeroCallout[] = [
  { id: 'posture', value: 6, A: [176, 232], E: [150, 200], X: [24, 200], anchor: 'start', tx: 24, ly: 178, sy: 194, my: 232 },
  { id: 'armSwing', value: 90, A: [304, 262], E: [332, 290], X: [369, 290], anchor: 'end', tx: 369, ly: 312, sy: 328, my: 366 },
  { id: 'cadence', value: 176, A: [272, 576], E: [310, 620], X: [369, 620], anchor: 'end', tx: 369, ly: 642, sy: 658, my: 694 },
  { id: 'elasticity', value: 230, A: [138, 576], E: [90, 620], X: [24, 620], anchor: 'start', tx: 24, ly: 642, sy: 658, my: 694 },
];

/** The ground rules' endpoints, for the component's two `<Line>`s. */
export const GROUND_LINE = { x1: GROUND_X0, x2: GROUND_X1, solidY: GROUND_Y, dashedY: GROUND_Y + 12 } as const;

function skeletonFrame(ph: number, opacity: number, draw: number | null, marksJoints: boolean): SkeletonFrame {
  'worklet';
  const s = skeletonAt(ph);
  let d = '';
  let length = 0;
  for (let i = 0; i < s.segments.length; i++) {
    const seg = s.segments[i];
    d += 'M' + fmt(seg[0]);
    for (let j = 1; j < seg.length; j++) d += 'L' + fmt(seg[j]);
    length += polylineLength(seg);
  }
  return {
    head: s.head,
    d,
    length,
    draw: draw == null ? 1 : draw,
    headDraw: draw == null ? 1 : cl(draw * 4),
    opacity,
    jointOpacity: marksJoints ? (draw == null ? 1 : cl((draw - 0.75) / 0.25)) : 0,
    joints: marksJoints ? s.joints : [],
  };
}

/** Everything drawn at `t` seconds. */
export function heroFrame(t: number): HeroFrame {
  'worklet';
  const phase = -t * STRIDE_OMEGA;
  const drawP = eo(t / 1.0);
  const ghostOp = cl((t - 0.9) / 0.4);
  const dim = 1 - 0.35 * cl((t - 2.6) / 0.6);
  const callouts: CalloutFrame[] = [];
  for (let i = 0; i < HERO_CALLOUTS.length; i++) {
    const c = HERO_CALLOUTS[i];
    const ts = 1.2 + 0.35 * i;
    const lp = eo((t - ts) / 0.25);
    const tp = cl((t - ts - 0.25) / 0.2);
    const cp = eo((t - ts - 0.45) / 0.4);
    callouts.push({
      leader: lp,
      leaderLength: polylineLength([c.A, c.E, c.X]),
      dim,
      anchorOpacity: dim * lp,
      labelOpacity: tp,
      metricOpacity: cp > 0 ? 1 : 0,
      value: Math.round(c.value * cp),
    });
  }
  return {
    groundOpacity: drawP,
    groundDashOffset: (t * 260) % (GROUND_DASH * 2),
    ghosts: [
      skeletonFrame(phase + 0.55, 0.14 * ghostOp, null, false),
      skeletonFrame(phase + 0.28, 0.3 * ghostOp, null, false),
    ],
    main: skeletonFrame(phase, 1, drawP < 1 ? drawP : null, true),
    callouts,
  };
}

/** The dash offset that shows the first `progress` (0-1) of a stroke `length` long. */
export function dashOffsetFor(length: number, progress: number): number {
  'worklet';
  return length * (1 - cl(progress));
}
