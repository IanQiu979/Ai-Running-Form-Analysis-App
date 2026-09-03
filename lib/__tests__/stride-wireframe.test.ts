/**
 * The stride wireframe's geometry (lib/stride-wireframe.ts). These lock the things that make the
 * figure read as a MEASUREMENT rather than a drawing — every one of them can silently regress
 * from an innocent retune of a gait table, and none of them is visible in a unit test of the
 * component, which only sees a `d` string:
 *
 *   1. RIGID BONES. A skeleton whose thigh stretched between phases would be a cartoon; a real
 *      capture's segment lengths are constant. Locked at every joint, across the whole cycle.
 *   2. SEAMLESS LOOP. The spline is periodic, so phase 1 IS phase 0 — the driver's `withRepeat`
 *      relies on that, and a table edit cannot break it, but an interpolation edit could.
 *   3. CONTRALATERAL LIMBS. The far leg is the near leg half a cycle later; the near arm swings
 *      opposite the near leg. That is what makes two legs read as running.
 *   4. THE FEET TOUCH THE GROUND, AND ONLY IN STANCE. The ground is derived from the gait (so it
 *      cannot be wrong by construction) — what CAN go wrong is a contact frame that floats, a
 *      swing foot that drags, or a stance window that is not a running stance (~35-40%).
 *   5. THE GAIT IS PACE-CORRECT: the knee never hyperextends, the elbow never straightens, the
 *      landing is compact (foot under the knee, not out ahead), the trunk leans as one line.
 *   6. THE GROUND MOVES AT THE PLANTED FOOT'S SPEED — a treadmill loop's one give-away.
 */
import {
  ANKLE_FLEX_DEG,
  BOB_AMPLITUDE,
  ELBOW_FLEX_DEG,
  FOOT_LEN,
  FOREARM_LEN,
  GAIT_PHASES,
  GROUND_TRAVEL_PER_CYCLE,
  GROUND_Y,
  HEAD_RADIUS,
  HEEL_LEN,
  HIP,
  KNEE_FLEX_DEG,
  LEAN_DEG,
  NECK_LEN,
  REST_PHASE,
  SHIN_LEN,
  STANCE,
  THIGH_DEG,
  THIGH_LEN,
  TORSO_LEN,
  UPPER_ARM_DEG,
  UPPER_ARM_LEN,
  catmullRomPeriodic,
  hipBob,
  solveStride,
  strideLayers,
  type Pt,
} from '../stride-wireframe';

const SAMPLES = 240;
const phases = Array.from({ length: SAMPLES }, (_, i) => i / SAMPLES);
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('catmullRomPeriodic', () => {
  const table = [3, 7, -2, 5];

  it('passes exactly through every table value at its own phase', () => {
    table.forEach((v, i) => {
      expect(catmullRomPeriodic(table, i / table.length)).toBeCloseTo(v, 10);
    });
  });

  it('is periodic: phase 1 is phase 0, and negative phases wrap', () => {
    expect(catmullRomPeriodic(table, 1)).toBeCloseTo(catmullRomPeriodic(table, 0), 10);
    expect(catmullRomPeriodic(table, -0.3)).toBeCloseTo(catmullRomPeriodic(table, 0.7), 10);
    expect(catmullRomPeriodic(table, 2.35)).toBeCloseTo(catmullRomPeriodic(table, 0.35), 10);
  });

  it('is C1 across the wrap — no velocity kink at the loop seam', () => {
    // Second-order one-sided differences, so the estimate's own error (O(h²)) cannot mask a
    // real kink: the left derivative arriving at phase 1, the right derivative leaving phase 0.
    const h = 1e-4;
    const f = (x: number) => catmullRomPeriodic(table, x);
    const before = (3 * f(1) - 4 * f(1 - h) + f(1 - 2 * h)) / (2 * h);
    const after = (-3 * f(0) + 4 * f(h) - f(2 * h)) / (2 * h);
    expect(after).toBeCloseTo(before, 4);
  });
});

describe('the gait tables', () => {
  it('all share one cycle of GAIT_PHASES keyframes', () => {
    for (const t of [THIGH_DEG, KNEE_FLEX_DEG, ANKLE_FLEX_DEG, UPPER_ARM_DEG, ELBOW_FLEX_DEG]) {
      expect(t).toHaveLength(GAIT_PHASES);
    }
  });
});

describe('solveStride — rigid bones', () => {
  it('keeps every segment at its authored length across the whole cycle', () => {
    for (const p of phases) {
      const s = solveStride(p);
      expect(dist(s.hip, s.shoulder)).toBeCloseTo(TORSO_LEN, 8);
      expect(dist(s.shoulder, s.neck)).toBeCloseTo(NECK_LEN, 8);
      expect(dist(s.neck, s.head)).toBeCloseTo(HEAD_RADIUS, 8);
      for (const side of ['near', 'far'] as const) {
        expect(dist(s.hip, s[`${side}Knee`])).toBeCloseTo(THIGH_LEN, 8);
        expect(dist(s[`${side}Knee`], s[`${side}Ankle`])).toBeCloseTo(SHIN_LEN, 8);
        expect(dist(s[`${side}Ankle`], s[`${side}Toe`])).toBeCloseTo(FOOT_LEN, 8);
        expect(dist(s[`${side}Ankle`], s[`${side}Heel`])).toBeCloseTo(HEEL_LEN, 8);
        expect(dist(s.shoulder, s[`${side}Elbow`])).toBeCloseTo(UPPER_ARM_LEN, 8);
        expect(dist(s[`${side}Elbow`], s[`${side}Wrist`])).toBeCloseTo(FOREARM_LEN, 8);
      }
    }
  });

  it('keeps the foot rigid: heel-to-toe is one fixed sole length', () => {
    const sole = dist(solveStride(0).nearHeel, solveStride(0).nearToe);
    for (const p of phases) {
      const s = solveStride(p);
      expect(dist(s.nearHeel, s.nearToe)).toBeCloseTo(sole, 8);
      expect(dist(s.farHeel, s.farToe)).toBeCloseTo(sole, 8);
    }
  });
});

describe('solveStride — the loop', () => {
  it('phase 1 is phase 0, joint for joint', () => {
    const a = solveStride(0);
    const b = solveStride(1);
    for (const key of Object.keys(a) as (keyof typeof a)[]) {
      const va = a[key];
      const vb = b[key];
      if (typeof va === 'number') expect(vb).toBeCloseTo(va, 8);
      else expect(dist(va, vb as Pt)).toBeCloseTo(0, 8);
    }
  });

  it('the far leg is the near leg half a cycle later, and the near arm swings opposite it', () => {
    for (const p of phases) {
      const now = solveStride(p);
      const later = solveStride(p + 0.5);
      // Legs hang from the same hip, but the hip bobs with period 1/2, so it is at the same
      // height in both frames and the joints can be compared directly.
      expect(dist(now.farKnee, later.nearKnee)).toBeCloseTo(0, 8);
      expect(dist(now.farAnkle, later.nearAnkle)).toBeCloseTo(0, 8);
      expect(dist(now.farToe, later.nearToe)).toBeCloseTo(0, 8);
      expect(dist(now.farElbow, later.nearElbow)).toBeCloseTo(0, 8);
      expect(dist(now.farWrist, later.nearWrist)).toBeCloseTo(0, 8);
    }
  });

  it('bobs the hip subtly, twice per cycle, about its authored height', () => {
    for (const p of phases) {
      expect(Math.abs(solveStride(p).hip[1] - HIP[1])).toBeLessThanOrEqual(BOB_AMPLITUDE + 1e-9);
      expect(hipBob(p)).toBeCloseTo(hipBob(p + 0.5), 8);
    }
  });
});

describe('solveStride — feet and ground', () => {
  const soleY = (p: number) => {
    const s = solveStride(p);
    return Math.max(s.nearHeel[1], s.nearToe[1]);
  };

  it('never puts a foot through the ground', () => {
    for (const p of phases) {
      const s = solveStride(p);
      for (const pt of [s.nearHeel, s.nearToe, s.farHeel, s.farToe]) {
        expect(pt[1]).toBeLessThanOrEqual(GROUND_Y + 1e-9);
      }
    }
  });

  it('lands at initial contact (phase 0) and pushes off at a running toe-off (~35-40%)', () => {
    expect(STANCE.from).toBeCloseTo(0, 2);
    expect(STANCE.to).toBeGreaterThan(0.33);
    expect(STANCE.to).toBeLessThan(0.42);
  });

  it('keeps the planted foot on the ground through the whole stance', () => {
    for (const p of phases.filter((p) => p >= STANCE.from && p <= STANCE.to)) {
      expect(GROUND_Y - soleY(p)).toBeLessThan(0.013);
    }
  });

  it('clears the ground through swing — the foot never drags', () => {
    for (const p of phases.filter((p) => p > STANCE.to + 0.05 && p < 0.95)) {
      expect(GROUND_Y - soleY(p)).toBeGreaterThan(0.015);
    }
  });

  it('moves the ground at the planted foot’s own speed', () => {
    const a = solveStride(STANCE.from).nearAnkle[0];
    const b = solveStride(STANCE.to).nearAnkle[0];
    const footSpeed = (a - b) / (STANCE.to - STANCE.from);
    expect(GROUND_TRAVEL_PER_CYCLE).toBeCloseTo(footSpeed, 8);
    expect(GROUND_TRAVEL_PER_CYCLE).toBeGreaterThan(0);
  });
});

describe('solveStride — PACE-correct form', () => {
  it('never hyperextends a knee or straightens an elbow', () => {
    for (const p of phases) {
      expect(solveStride(p).nearKneeFlexDeg).toBeGreaterThan(0);
      expect(catmullRomPeriodic(ELBOW_FLEX_DEG, p)).toBeGreaterThan(60);
    }
  });

  it('lands compactly: at contact the shin is near-vertical and the foot is under the knee, not out ahead', () => {
    const s = solveStride(0);
    expect(Math.abs(s.nearShinDeg)).toBeLessThan(8);
    // Ankle ahead of the hip by well under a thigh length — a cadence landing, not an overstride.
    expect(s.nearAnkle[0] - s.hip[0]).toBeGreaterThan(0);
    expect(s.nearAnkle[0] - s.hip[0]).toBeLessThan(THIGH_LEN * 0.5);
  });

  it('leans the whole trunk forward as one line, by LEAN_DEG', () => {
    for (const p of phases) {
      const s = solveStride(p);
      const trunk = Math.atan2(s.shoulder[0] - s.hip[0], -(s.shoulder[1] - s.hip[1])) * (180 / Math.PI);
      const neck = Math.atan2(s.head[0] - s.shoulder[0], -(s.head[1] - s.shoulder[1])) * (180 / Math.PI);
      expect(trunk).toBeCloseTo(LEAN_DEG, 6);
      expect(neck).toBeCloseTo(LEAN_DEG, 6);
    }
  });
});

describe('strideLayers', () => {
  it('serialises every layer as a non-empty SVG path, in viewBox units', () => {
    const layers = strideLayers(REST_PHASE);
    for (const d of Object.values(layers)) {
      expect(d).toMatch(/^M-?\d/);
      // Nothing outside the 0-100 figure box (allowing the odd decimal past an edge is not
      // needed: the figure is authored well inside it).
      for (const n of d.match(/-?\d+(\.\d+)?/g) ?? []) {
        expect(Math.abs(Number(n))).toBeLessThanOrEqual(100);
      }
    }
  });

  it('changes shape across the cycle — the figure moves, not just its position', () => {
    const a = strideLayers(0).near;
    const b = strideLayers(0.5).near;
    expect(a).not.toEqual(b);
  });
});
