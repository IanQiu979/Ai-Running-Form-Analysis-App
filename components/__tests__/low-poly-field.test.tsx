/**
 * The low-poly field. The locks below are about honesty rather than about the animation:
 *
 *   1. IT IS DECORATION AND MUST STAY OUT OF THE A11Y TREE. It carries no information a screen
 *      reader needs, and it sits on the Analyzing wait — a screen where an unlabelled decorative
 *      node getting focus would be actively confusing.
 *   2. IT MUST STILL RENDER UNDER REDUCED MOTION. The reduced-motion contract here is "stop
 *      moving", not "disappear" — the mark is composition, and a wait screen that empties itself
 *      for a user with Reduce Motion on is a worse screen, not a safer one. Since 2026-08-02 that
 *      is asserted at the geometry, not just at the root node: the still frame must be pose 0's
 *      actual vertices, so "it rendered" cannot pass while the mark is an empty box.
 *   3. IT MUST GENUINELY MORPH. Added 2026-08-02, when the captain lifted the `react-native-svg`
 *      ban and this component was rebuilt from CSS border-triangles (which can only move, scale and
 *      rotate) onto per-vertex polygons. The locks are structural — that every pose is three
 *      independent vertices, and that consecutive poses actually differ in SHAPE rather than only
 *      in placement. A pose set that had merely been translated would satisfy the old build and
 *      silently undo the point of this one.
 *
 * Also locks the pose shape, since every facet is indexed by facet index and a short pose would be
 * an undefined read at animation time rather than a render-time error.
 */
import { render, screen } from '@testing-library/react-native';

import { FACET_COUNT, LowPolyField, POSES, type Facet } from '../low-poly-field';

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

/** Side lengths, sorted. Two triangles with the same sorted side lengths are congruent — so if a
 *  pose only moved/rotated/scaled a facet uniformly this would be proportional, and if it genuinely
 *  reshaped it, the proportions differ. Used to prove the morph is a morph. */
/** `react-native-svg` compiles a `<Polygon points>` down to an `RNSVGPath` with a `d` attribute, so
 *  the geometry has to be read back out of that rather than off the prop that was passed in.
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

describe('LowPolyField', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(false);
  });

  it('is hidden from assistive tech — it is decoration, not content', async () => {
    await render(
      <LowPolyField poses={[POSES.scatter, POSES.gather]} color="#FFFFFF" size={100} testID="field" />
    );

    const field = screen.getByTestId('field', { includeHiddenElements: true });
    expect(field.props.accessibilityElementsHidden).toBe(true);
    expect(field.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('takes no pointer events, so it can never swallow a tap meant for something behind it', async () => {
    await render(
      <LowPolyField poses={[POSES.scatter, POSES.gather]} color="#FFFFFF" size={100} testID="field" />
    );

    expect(screen.getByTestId('field', { includeHiddenElements: true }).props.pointerEvents).toBe('none');
  });

  it('still renders under reduced motion — it stops moving, it does not vanish', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    await render(
      <LowPolyField poses={[POSES.scatter, POSES.gather]} color="#FFFFFF" size={100} testID="field" />
    );

    expect(screen.getByTestId('field', { includeHiddenElements: true })).toBeTruthy();
  });

  it('renders every facet at pose 0 geometry under reduced motion — a STILL mark, not an empty one', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    await render(
      <LowPolyField poses={[POSES.scatter, POSES.gather]} color="#FFFFFF" size={100} testID="field" />
    );

    for (let i = 0; i < FACET_COUNT; i++) {
      const drawn = renderedVertices(`field-facet-${i}`);
      const expected = expectedVertices(POSES.scatter[i]);
      expect(drawn).toHaveLength(expected.length);
      drawn.forEach((value, v) => expect(value).toBeCloseTo(expected[v], 1));
      expect(screen.getByTestId(`field-facet-${i}`, { includeHiddenElements: true }).props.opacity).toBe(
        POSES.scatter[i].opacity
      );
    }
  });

  it('renders a single static mark when given one pose, with nothing to animate', async () => {
    await render(<LowPolyField poses={[POSES.gather]} color="#FFFFFF" size={100} testID="field" />);

    expect(screen.getByTestId('field', { includeHiddenElements: true })).toBeTruthy();
    renderedVertices('field-facet-0').forEach((value, v) =>
      expect(value).toBeCloseTo(expectedVertices(POSES.gather[0])[v], 1)
    );
  });

  it('ships every pose at exactly FACET_COUNT facets — a short pose is an undefined read at runtime', () => {
    for (const [name, pose] of Object.entries(POSES)) {
      expect({ name, length: pose.length }).toEqual({ name, length: FACET_COUNT });
    }
  });

  it('gives every facet exactly three independent vertices, all inside the normalised 0-1 box', () => {
    for (const pose of Object.values(POSES)) {
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

  it('changes each facet SHAPE between poses, not just its placement — this is a morph', () => {
    // Congruent triangles (same sorted side lengths up to a uniform scale) are what the previous
    // CSS-border build could produce, and only that. Proving the ratio of sorted sides differs
    // between consecutive poses proves each facet genuinely reshapes.
    const sequence = [POSES.scatter, POSES.stride, POSES.gather];

    for (let p = 0; p < sequence.length; p++) {
      const from = sequence[p];
      const to = sequence[(p + 1) % sequence.length];

      for (let i = 0; i < FACET_COUNT; i++) {
        const a = sideLengths(from[i]);
        const b = sideLengths(to[i]);
        // Shape, scale-free: the two smaller sides as fractions of the longest.
        const shapeA = [a[0] / a[2], a[1] / a[2]];
        const shapeB = [b[0] / b[2], b[1] / b[2]];
        const drift = Math.hypot(shapeA[0] - shapeB[0], shapeA[1] - shapeB[1]);

        expect({ pose: p, facet: i, reshaped: drift > 0.02 }).toEqual({
          pose: p,
          facet: i,
          reshaped: true,
        });
      }
    }
  });
});
