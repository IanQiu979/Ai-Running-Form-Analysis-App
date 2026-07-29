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

describe('DuotoneFrame — moment 3 annotations (spec 2026-07-26 §4, Phase 2 plan Task 5)', () => {
  it('renders no annotation lines when annotate is not set — every screen before this plan', async () => {
    await render(<DuotoneFrame uri="file:///frame-01.jpg" accessibilityLabel="frame" testID="frame" />);
    expect(screen.queryByTestId('frame-annotations-ground', { includeHiddenElements: true })).toBeNull();
  });

  it('renders all three fixed-geometry lines, already fully drawn, when annotate is set but playAnnotation is not', async () => {
    await render(<DuotoneFrame uri="file:///frame-01.jpg" accessibilityLabel="frame" testID="frame" annotate />);
    expect(screen.getByTestId('frame-annotations-ground', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('frame-annotations-posture', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('frame-annotations-landing', { includeHiddenElements: true })).toBeTruthy();
  });

  it('calls onAnnotationComplete once the draw finishes when playAnnotation is set', async () => {
    jest.useFakeTimers();
    const onAnnotationComplete = jest.fn();
    await render(
      <DuotoneFrame
        uri="file:///frame-01.jpg"
        accessibilityLabel="frame"
        testID="frame"
        annotate
        playAnnotation
        onAnnotationComplete={onAnnotationComplete}
      />
    );
    jest.advanceTimersByTime(3000);
    await Promise.resolve();
    expect(onAnnotationComplete).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
