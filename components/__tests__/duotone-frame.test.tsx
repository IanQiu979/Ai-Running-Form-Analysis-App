/**
 * Locks the two rules that make DuotoneFrame safe on real bodies: the grade is a low-opacity
 * wash of the page's black, never a hue shift of the subject; and the frame always carries a
 * text alternative. The annotation marks and the vignette are the result screen's own layers
 * now, not this component's, so there is nothing about them to lock here.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { DuotoneFrame } from '../duotone-frame';
import { Ink } from '@/constants/v23-theme';

describe('DuotoneFrame', () => {
  it('renders the supplied image', async () => {
    await render(<DuotoneFrame uri="file:///frame-01.jpg" accessibilityLabel="your running frame" testID="frame" />);
    expect(screen.getByTestId('frame')).toBeTruthy();
  });

  it('carries the text alternative the hero requires', async () => {
    await render(<DuotoneFrame uri="file:///frame-01.jpg" accessibilityLabel="your running frame" testID="frame" />);
    expect(screen.getByLabelText('your running frame')).toBeTruthy();
  });

  it('grades toward the page’s black with a light wash rather than recolouring the subject', async () => {
    await render(<DuotoneFrame uri="file:///frame-01.jpg" accessibilityLabel="your running frame" testID="frame" />);
    const overlay = screen.getByTestId('frame-grade', { includeHiddenElements: true });
    const style = StyleSheet.flatten(overlay.props.style);
    expect(style.backgroundColor).toBe(Ink.bg);
    // A grade heavy enough to tint the interface, light enough to leave skin readable.
    expect(style.opacity).toBeLessThanOrEqual(0.2);
    expect(overlay.props.accessibilityElementsHidden).toBe(true);
  });

  it('draws no annotation marks of its own — those are the hero box’s layers', async () => {
    await render(<DuotoneFrame uri="file:///frame-01.jpg" accessibilityLabel="frame" testID="frame" />);
    expect(screen.queryByTestId('frame-annotations-ground', { includeHiddenElements: true })).toBeNull();
  });
});
