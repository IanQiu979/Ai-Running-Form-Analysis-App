/**
 * The low-poly mark. The locks below are about honesty rather than about the animation:
 *
 *   1. IT IS DECORATION AND MUST STAY OUT OF THE A11Y TREE. It carries no information a screen
 *      reader needs, and it sits on the Analyzing wait — a screen where an unlabelled decorative
 *      node getting focus would be actively confusing.
 *   2. IT MUST STILL RENDER UNDER REDUCED MOTION, AS THE ABSTRACT DEFAULT — NOT A RUNNER FRAME.
 *      The reduced-motion contract here is "stop moving", not "disappear", and the still frame
 *      must be the abstract mark (never a held gait-cycle instant, which would misleadingly
 *      imply an in-progress motion) at its own real geometry — asserted at vertex level, so "it
 *      rendered" cannot pass while the mark is an empty box.
 *   3. THE RUNNER GAIT KEYFRAMES MUST GENUINELY DIFFER IN SHAPE FROM EACH OTHER AND FROM THE
 *      DEFAULT — this is still a per-vertex morph (2026-08-02), and a pose set that only
 *      translated facets around would silently undo the point of that rebuild.
 *   4. EVERY POSE SHIPS EXACTLY `FACET_COUNT` FACETS OF EXACTLY THREE VERTICES EACH, since every
 *      facet is indexed by facet index and a short pose would be an undefined read at animation
 *      time rather than a render-time error.
 */
import { render, screen } from '@testing-library/react-native';
import TestRenderer from 'react-test-renderer';
import { Path, Polygon } from 'react-native-svg';

import {
  DEFAULT_POSE,
  FACET_COUNT,
  LowPolyField,
  RUNNER_KEYFRAMES,
  type Facet,
  type Pose,
} from '../low-poly-field';

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

/** `react-native-svg` compiles a `<Polygon points>` down to an `RNSVGPath` with a `d` attribute,
 *  so the geometry has to be read back out of that rather than off the prop that was passed in.
 *  Pulling the raw numbers keeps the assertion about the SHAPE and not about the library's chosen
 *  path syntax, which is not this component's contract to lock. */
function renderedVertices(testID: string): number[] {
  const d = screen.getByTestId(testID, { includeHiddenElements: true }).props.d as string;
  return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

/** The same facet's vertices scaled into the SVG viewBox, for comparison against the above. */
function expectedVertices(facet: Facet): number[] {
  return facet.points.flatMap(([x, y]) => [x * 100, y * 100]);
}

function sideLengths(facet: Facet): number[] {
  const [p, q, r] = facet.points;
  const d = (a: readonly [number, number], b: readonly [number, number]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]);
  return [d(p, q), d(q, r), d(r, p)].sort((a, b) => a - b);
}

/** Congruent triangles (same sorted side lengths up to a uniform scale) are what a
 *  position/scale/rotation-only build could produce. Proving the ratio of sorted sides differs
 *  proves the facet genuinely reshapes, not just moves. */
function shapeRatio(facet: Facet): [number, number] {
  const [s0, s1, s2] = sideLengths(facet);
  return [s0 / s2, s1 / s2];
}

describe('LowPolyField', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(false);
  });

  it('is hidden from assistive tech — it is decoration, not content', async () => {
    await render(<LowPolyField color="#FFFFFF" size={100} testID="field" />);

    const field = screen.getByTestId('field', { includeHiddenElements: true });
    expect(field.props.accessibilityElementsHidden).toBe(true);
    expect(field.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('takes no pointer events, so it can never swallow a tap meant for something behind it', async () => {
    await render(<LowPolyField color="#FFFFFF" size={100} testID="field" />);

    expect(screen.getByTestId('field', { includeHiddenElements: true }).props.pointerEvents).toBe('none');
  });

  it('still renders under reduced motion — it stops moving, it does not vanish', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    await render(<LowPolyField color="#FFFFFF" size={100} testID="field" />);

    expect(screen.getByTestId('field', { includeHiddenElements: true })).toBeTruthy();
  });

  it('renders every facet at DEFAULT_POSE geometry under reduced motion — the abstract mark, not a runner frame', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    await render(<LowPolyField color="#FFFFFF" size={100} testID="field" />);

    for (let i = 0; i < FACET_COUNT; i++) {
      const drawn = renderedVertices(`field-facet-${i}`);
      const expected = expectedVertices(DEFAULT_POSE[i]);
      expect(drawn).toHaveLength(expected.length);
      drawn.forEach((value, v) => expect(value).toBeCloseTo(expected[v], 1));
      expect(screen.getByTestId(`field-facet-${i}`, { includeHiddenElements: true }).props.opacity).toBe(
        DEFAULT_POSE[i].opacity
      );
    }
  });

  it('paints its first frame at DEFAULT_POSE geometry even while animating, before the driver ticks', async () => {
    await render(<LowPolyField color="#FFFFFF" size={100} testID="field" />);

    renderedVertices('field-facet-0').forEach((value, v) =>
      expect(value).toBeCloseTo(expectedVertices(DEFAULT_POSE[0])[v], 1)
    );
  });

  it('ships DEFAULT_POSE and every RUNNER_KEYFRAMES pose at exactly FACET_COUNT facets — a short pose is an undefined read at runtime', () => {
    expect(DEFAULT_POSE).toHaveLength(FACET_COUNT);
    for (const pose of RUNNER_KEYFRAMES) {
      expect(pose).toHaveLength(FACET_COUNT);
    }
  });

  it('has more than one runner gait keyframe — a continuous cycle, not a static held pose', () => {
    expect(RUNNER_KEYFRAMES.length).toBeGreaterThan(2);
  });

  it('gives every facet, in every pose, exactly three independent vertices inside the normalised 0-1 box', () => {
    const allPoses: readonly Pose[] = [DEFAULT_POSE, ...RUNNER_KEYFRAMES];
    for (const pose of allPoses) {
      for (const facet of pose) {
        expect(facet.points).toHaveLength(3);
        for (const [x, y] of facet.points) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(1);
        }
        expect(facet.opacity).toBeGreaterThan(0);
        expect(facet.opacity).toBeLessThanOrEqual(1);
      }
    }
  });

  it('changes each facet SHAPE between consecutive gait keyframes, not just its placement — this is a morph', () => {
    // Not every facet has to reshape by a lot on every single step (a foot mid-swing can hold
    // for a beat), but SOME facet must move every step, or the "cycle" is static — the fault
    // this whole redesign exists to rule out (see the file's own header, point 3).
    for (let p = 0; p < RUNNER_KEYFRAMES.length; p++) {
      const from = RUNNER_KEYFRAMES[p];
      const to = RUNNER_KEYFRAMES[(p + 1) % RUNNER_KEYFRAMES.length];

      const anyReshaped = Array.from({ length: FACET_COUNT }, (_, i) => {
        const [a0, a1] = shapeRatio(from[i]);
        const [b0, b1] = shapeRatio(to[i]);
        return Math.hypot(a0 - b0, a1 - b1) > 0.01;
      }).some(Boolean);
      expect({ pose: p, anyReshaped }).toEqual({ pose: p, anyReshaped: true });
    }
  });

  it('builds the animating facets on react-native-svg Path, never Polygon — Polygon only turns `points` into the `d` its native view draws inside its own JS render()/setNativeProps, and Reanimated writes animated props straight to the native view on the UI thread under Fabric, bypassing both, so an animated `points` prop is silently inert (this froze the mark on every screen it renders on until this fix)', () => {
    // `@testing-library/react-native`'s own `render` (used everywhere else in this file) collapses
    // composite elements down to host nodes, which erases exactly the Path-vs-Polygon distinction
    // this test exists to lock — both compile to the same host SVG node either way. The classic
    // `react-test-renderer` keeps the composite tree intact, so `findAllByType` can tell them apart.
    let instance: TestRenderer.ReactTestRenderer;
    TestRenderer.act(() => {
      instance = TestRenderer.create(<LowPolyField color="#FFFFFF" size={100} testID="field" />);
    });

    expect(instance!.root.findAllByType(Path)).toHaveLength(FACET_COUNT);
    expect(instance!.root.findAllByType(Polygon)).toHaveLength(0);
  });

  it('shatters between DEFAULT_POSE and the runner — most facets genuinely differ in shape across the boundary, not just position', () => {
    // "Most", not "every": both pose systems build thin tapered wedges, so one facet's
    // proportions occasionally landing close by coincidence doesn't mean the boundary itself
    // is a rigid transform — the property under test is that the mark as a whole reshapes.
    const firstRunnerFrame = RUNNER_KEYFRAMES[0];
    const reshapedCount = Array.from({ length: FACET_COUNT }, (_, i) => {
      const [a0, a1] = shapeRatio(DEFAULT_POSE[i]);
      const [b0, b1] = shapeRatio(firstRunnerFrame[i]);
      return Math.hypot(a0 - b0, a1 - b1) > 0.02;
    }).filter(Boolean).length;
    expect(reshapedCount).toBeGreaterThan(FACET_COUNT * 0.8);
  });
});
