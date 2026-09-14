/**
 * Locks V23-02's timeline at the instants the page itself freezes (t = 1.0, 2.0, the end frame)
 * — the same instants the design's artboards were cut at — so a retuned constant shows up here
 * as a wrong number rather than as a hero that "looks a bit off" on a device.
 */
import {
  HEAD_CIRCUMFERENCE,
  HERO_CALLOUTS,
  HERO_END_T,
  dashOffsetFor,
  eo,
  heroFrame,
  polylineLength,
  skeletonAt,
} from '@/lib/stride-hero';

const FINAL_VALUES = [6, 90, 176, 230];

describe('stride hero — easing', () => {
  it('eo is the page ease-out, clamped at both ends', () => {
    expect(eo(-1)).toBe(0);
    expect(eo(0)).toBe(0);
    expect(eo(0.5)).toBeCloseTo(1 - 0.5 ** 4, 10);
    expect(eo(1)).toBe(1);
    expect(eo(3)).toBe(1);
  });
});

describe('stride hero — t = 0', () => {
  const f = heroFrame(0);

  it('has drawn nothing of the figure yet', () => {
    expect(f.main.draw).toBe(0);
    expect(f.main.headDraw).toBe(0);
    expect(f.main.jointOpacity).toBe(0);
    expect(f.groundOpacity).toBe(0);
    expect(dashOffsetFor(f.main.length, f.main.draw)).toBeCloseTo(f.main.length, 6);
    expect(dashOffsetFor(HEAD_CIRCUMFERENCE, f.main.headDraw)).toBeCloseTo(HEAD_CIRCUMFERENCE, 6);
  });

  it('shows no callout and no ghost', () => {
    for (const c of f.callouts) {
      expect(c.leader).toBe(0);
      expect(c.labelOpacity).toBe(0);
      expect(c.metricOpacity).toBe(0);
      expect(c.value).toBe(0);
    }
    expect(f.ghosts[0].opacity).toBe(0);
    expect(f.ghosts[1].opacity).toBe(0);
  });
});

describe('stride hero — t = 1.0, figure fully drawn', () => {
  const f = heroFrame(1.0);

  it('has finished the draw-on and marked the joints', () => {
    expect(f.main.draw).toBeGreaterThanOrEqual(0.999);
    expect(f.main.headDraw).toBe(1);
    expect(f.main.jointOpacity).toBe(1);
    expect(f.main.joints).toHaveLength(13);
    expect(f.groundOpacity).toBeGreaterThanOrEqual(0.999);
  });

  it('has the ghosts a quarter of the way in (0.9-1.3 s fade)', () => {
    expect(f.ghosts[0].opacity).toBeCloseTo(0.14 * 0.25, 6);
    expect(f.ghosts[1].opacity).toBeCloseTo(0.3 * 0.25, 6);
    expect(f.ghosts[0].draw).toBe(1);
    expect(f.ghosts[0].joints).toHaveLength(0);
  });

  it('has not started a single callout', () => {
    for (const c of f.callouts) expect(c.leader).toBe(0);
  });
});

describe('stride hero — t = 2.0, posture and arm swing landed, cadence arriving', () => {
  const f = heroFrame(2.0);

  it('has posture counted up and arm swing labelled, its count-up just about to start', () => {
    expect(f.callouts[0].value).toBe(6);
    expect(f.callouts[0].labelOpacity).toBe(1);
    expect(f.callouts[0].leader).toBe(1);
    // Arm swing starts at 1.55 s; its count-up begins at 2.0 s exactly, so the page's own t = 2.0
    // artboard shows the label landed and the number still at 0.
    expect(f.callouts[1].leader).toBe(1);
    expect(f.callouts[1].labelOpacity).toBe(1);
    expect(f.callouts[1].value).toBe(0);
    expect(heroFrame(2.4).callouts[1].value).toBe(90);
  });

  it('has cadence drawing its leader and elasticity not yet started', () => {
    expect(f.callouts[2].leader).toBeGreaterThan(0);
    expect(f.callouts[2].value).toBe(0);
    expect(f.callouts[3].leader).toBe(0);
  });

  it('has not dimmed anything yet', () => {
    expect(f.callouts[0].dim).toBe(1);
  });
});

describe('stride hero — the hold', () => {
  const f = heroFrame(HERO_END_T);

  it('shows every callout at its final value, dimmed to 0.65', () => {
    f.callouts.forEach((c, i) => {
      expect(c.value).toBe(FINAL_VALUES[i]);
      expect(c.leader).toBe(1);
      expect(c.labelOpacity).toBe(1);
      expect(c.metricOpacity).toBe(1);
      expect(c.dim).toBeCloseTo(0.65, 10);
      expect(c.anchorOpacity).toBeCloseTo(0.65, 10);
    });
  });

  it('has both ghosts at their full trail opacity', () => {
    expect(f.ghosts[0].opacity).toBeCloseTo(0.14, 10);
    expect(f.ghosts[1].opacity).toBeCloseTo(0.3, 10);
  });

  it('keeps the runner running — the pose still changes after the hold begins', () => {
    const later = heroFrame(HERO_END_T + 0.1);
    expect(later.main.d).not.toBe(f.main.d);
    expect(later.groundDashOffset).not.toBe(f.groundDashOffset);
  });
});

describe('stride hero — geometry', () => {
  it('reports positive, finite stroke lengths', () => {
    const f = heroFrame(0.5);
    expect(Number.isFinite(f.main.length)).toBe(true);
    expect(f.main.length).toBeGreaterThan(0);
    for (const c of f.callouts) expect(c.leaderLength).toBeGreaterThan(0);
    expect(HEAD_CIRCUMFERENCE).toBeCloseTo(2 * Math.PI * 21, 10);
  });

  it('sums straight segments for a polyline length', () => {
    expect(polylineLength([[0, 0], [3, 4], [3, 10]])).toBe(11);
  });

  it('builds the figure from five stroke runs and thirteen joints', () => {
    const s = skeletonAt(0);
    expect(s.segments).toHaveLength(5);
    expect(s.joints).toHaveLength(13);
    // The hip is the first joint and sits on the figure's centre line.
    expect(s.joints[0][0]).toBe(196);
  });

  it('carries the four callouts in the page order with the page values', () => {
    expect(HERO_CALLOUTS.map((c) => c.id)).toEqual(['posture', 'armSwing', 'cadence', 'elasticity']);
    expect(HERO_CALLOUTS.map((c) => c.value)).toEqual(FINAL_VALUES);
  });
});
