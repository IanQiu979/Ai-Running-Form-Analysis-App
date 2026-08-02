/**
 * The low-poly field. Two locks, both about honesty rather than about the animation:
 *
 *   1. IT IS DECORATION AND MUST STAY OUT OF THE A11Y TREE. It carries no information a screen
 *      reader needs, and it sits on the Analyzing wait — a screen where an unlabelled decorative
 *      node getting focus would be actively confusing.
 *   2. IT MUST STILL RENDER UNDER REDUCED MOTION. The reduced-motion contract here is "stop
 *      moving", not "disappear" — the mark is composition, and a wait screen that empties itself
 *      for a user with Reduce Motion on is a worse screen, not a safer one.
 *
 * Also locks the pose shape, since `FacetView` indexes every pose by facet index and a short pose
 * would be an undefined read at animation time rather than a render-time error.
 */
import { render, screen } from '@testing-library/react-native';

import { FACET_COUNT, LowPolyField, POSES } from '../low-poly-field';

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

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

  it('renders a single static mark when given one pose, with nothing to animate', async () => {
    await render(<LowPolyField poses={[POSES.gather]} color="#FFFFFF" size={100} testID="field" />);

    expect(screen.getByTestId('field', { includeHiddenElements: true })).toBeTruthy();
  });

  it('ships every pose at exactly FACET_COUNT facets — a short pose is an undefined read at runtime', () => {
    for (const [name, pose] of Object.entries(POSES)) {
      expect({ name, length: pose.length }).toEqual({ name, length: FACET_COUNT });
    }
  });

  it('keeps every facet inside the normalised 0-1 field box', () => {
    for (const pose of Object.values(POSES)) {
      for (const facet of pose) {
        expect(facet.x).toBeGreaterThanOrEqual(0);
        expect(facet.x).toBeLessThanOrEqual(1);
        expect(facet.y).toBeGreaterThanOrEqual(0);
        expect(facet.y).toBeLessThanOrEqual(1);
        expect(facet.opacity).toBeGreaterThan(0);
        expect(facet.opacity).toBeLessThanOrEqual(1);
      }
    }
  });
});
