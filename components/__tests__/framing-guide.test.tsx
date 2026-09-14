/**
 * Structural lock for `components/framing-guide.tsx` (V23-10, third artboard): the page's own
 * SVG — a dashed target box and a solid ground line on the 393 x 852 canvas, stretched to the
 * viewfinder — hidden from the a11y tree. The exact geometry is asserted because it IS the spec:
 * the box is where the runner has to be for the pillars to be assessable, and a guide that
 * quietly moved would send clips to "not assessed" with no test noticing.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { FramingGuide } from '../framing-guide';
import { Ink, Layout } from '@/constants/v23-theme';

const HIDDEN = { includeHiddenElements: true } as const;

describe('<FramingGuide>', () => {
  it('is decorative: hidden from the a11y tree and never a touch target', async () => {
    await render(<FramingGuide />);

    expect(screen.queryByTestId('framing-guide')).toBeNull();
    const svg = screen.getByTestId('framing-guide', HIDDEN);
    expect(svg.props.accessibilityElementsHidden).toBe(true);
    expect(svg.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(svg.props.pointerEvents).toBe('none');
  });

  it("draws on the page's canvas, stretched to the viewfinder, in 1 pt `ink` at 70 %", async () => {
    await render(<FramingGuide />);

    // `react-native-svg` resolves `viewBox` into `vbWidth`/`vbHeight`, `preserveAspectRatio`
    // into `align`, and moves `opacity` onto the host's style, so the assertions read the
    // resolved props rather than the JSX attributes.
    const svg = screen.getByTestId('framing-guide', HIDDEN);
    expect(svg.props.vbWidth).toBe(Layout.canvas.width);
    expect(svg.props.vbHeight).toBe(Layout.canvas.height);
    expect(svg.props.align).toBe('none');
    expect(svg.props.stroke).toBe(Ink.ink);
    expect(svg.props.strokeWidth).toBe(1);
    expect(svg.props.fill).toBe('none');
    expect(StyleSheet.flatten(svg.props.style).opacity).toBe(0.7);
  });

  it("draws the page's dashed 200 x 500 target box and the solid ground line at y = 680", async () => {
    await render(<FramingGuide />);

    const box = screen.getByTestId('framing-guide-box', HIDDEN);
    expect(box.props).toMatchObject({ x: 96, y: 180, width: 200, height: 500 });
    expect(box.props.strokeDasharray).toEqual(['4', '6']);

    const ground = screen.getByTestId('framing-guide-ground', HIDDEN);
    expect(ground.props).toMatchObject({ x1: Layout.gutter, y1: 680, x2: Layout.canvas.width - Layout.gutter, y2: 680 });
    expect(ground.props.strokeDasharray).toBeUndefined();
  });
});
