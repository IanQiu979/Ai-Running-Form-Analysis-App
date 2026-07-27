/**
 * Locks the two rules that make DuotoneFrame safe on real bodies (spec 2026-07-26 §3.5):
 * the grade is a warm overlay, never a hue shift of the subject; and the frame always carries
 * a text alternative (brief §7 requires the annotated hero to have one).
 */
import { render, screen } from '@testing-library/react-native';

import { DuotoneFrame } from '../duotone-frame';

describe('DuotoneFrame', () => {
  it('renders the supplied image', async () => {
    await render(<DuotoneFrame uri="file:///frame-01.jpg" accessibilityLabel="your running frame" testID="frame" />);
    expect(screen.getByTestId('frame')).toBeTruthy();
  });

  it('carries the text alternative brief §7 requires', async () => {
    await render(<DuotoneFrame uri="file:///frame-01.jpg" accessibilityLabel="your running frame" testID="frame" />);
    expect(screen.getByLabelText('your running frame')).toBeTruthy();
  });

  it('grades with a warm overlay rather than recolouring the subject', async () => {
    await render(<DuotoneFrame uri="file:///frame-01.jpg" accessibilityLabel="your running frame" testID="frame" />);
    const overlay = screen.getByTestId('frame-grade', { includeHiddenElements: true });
    const style = Array.isArray(overlay.props.style) ? Object.assign({}, ...overlay.props.style) : overlay.props.style;
    // A grade heavy enough to tint the interface, light enough to leave skin readable.
    expect(style.opacity).toBeLessThanOrEqual(0.2);
    expect(overlay.props.accessibilityElementsHidden).toBe(true);
  });
});
