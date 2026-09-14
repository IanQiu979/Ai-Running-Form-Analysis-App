/**
 * The result hero's three fixed annotation marks (V23-08). Locks: it renders exactly the page's
 * three marks in the page's own coordinates, they scale with the hero box rather than letterbox
 * inside it, and they are hidden from the a11y tree (purely decorative — the frame's alt text
 * already names them). Nothing here animates, so there is no first-frame invariant to lock.
 */
import { render, screen } from '@testing-library/react-native';

import { AnnotationLines } from '../annotation-lines';
import { Ink } from '@/constants/v23-theme';

const HIDDEN = { includeHiddenElements: true } as const;

describe('AnnotationLines', () => {
  it('draws the page’s three marks: ground rule, dashed posture line, landing marker', async () => {
    await render(<AnnotationLines testID="lines" />);

    const ground = screen.getByTestId('lines-ground', HIDDEN);
    expect(ground.props).toEqual(expect.objectContaining({ x1: 24, y1: 440, x2: 369, y2: 440 }));

    const posture = screen.getByTestId('lines-posture', HIDDEN);
    expect(posture.props).toEqual(expect.objectContaining({ x1: 200, y1: 60, x2: 182, y2: 440 }));
    // react-native-svg hands its host the page's `stroke-dasharray="3 5"` as a split list.
    expect(posture.props.strokeDasharray).toEqual(['3', '5']);

    const landing = screen.getByTestId('lines-landing', HIDDEN);
    expect(landing.props).toEqual(expect.objectContaining({ cx: 182, cy: 440, r: 5 }));
  });

  it('scales with the 3:4 hero box instead of letterboxing inside it', async () => {
    await render(<AnnotationLines testID="lines" />);

    // react-native-svg resolves `viewBox` / `preserveAspectRatio` into these host props.
    const svg = screen.getByTestId('lines', HIDDEN);
    expect(svg.props).toEqual(expect.objectContaining({ minX: 0, minY: 0, vbWidth: 393, vbHeight: 524 }));
    expect(svg.props.align).toBe('none');
    expect(svg.props.stroke).toBe(Ink.ink);
    expect(svg.props.fill).toBe('none');
  });

  it('hides every mark from assistive technology — purely decorative', async () => {
    await render(<AnnotationLines testID="lines" />);

    expect(screen.getByTestId('lines', HIDDEN).props.accessibilityElementsHidden).toBe(true);
    expect(screen.queryByTestId('lines')).toBeNull();
  });
});
