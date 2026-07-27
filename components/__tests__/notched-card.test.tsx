/**
 * The result container is a notched rectangle, not a rounded card (spec 2026-07-26 §3.6).
 * Shape is the identity signal, so the notches are asserted present and asserted decorative —
 * they must never appear in the accessibility tree (brief §7).
 */
import { StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { NotchedCard } from '../ui/notched-card';
import { Colors } from '@/constants/theme';

describe('NotchedCard', () => {
  it('renders its children', async () => {
    await render(
      <NotchedCard testID="card">
        <Text>Posture 72</Text>
      </NotchedCard>
    );
    expect(screen.getByText('Posture 72')).toBeTruthy();
  });

  it('renders two notches', async () => {
    await render(
      <NotchedCard testID="card">
        <Text>Posture 72</Text>
      </NotchedCard>
    );
    expect(screen.getByTestId('card-notch-left', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('card-notch-right', { includeHiddenElements: true })).toBeTruthy();
  });

  it('hides the notches from assistive technology — they are decoration', async () => {
    await render(
      <NotchedCard testID="card">
        <Text>Posture 72</Text>
      </NotchedCard>
    );
    expect(screen.getByTestId('card-notch-left', { includeHiddenElements: true }).props.accessibilityElementsHidden).toBe(
      true
    );
    expect(
      screen.getByTestId('card-notch-right', { includeHiddenElements: true }).props.accessibilityElementsHidden
    ).toBe(true);
  });

  // The measured reason this assertion exists: `background` on `surface.base` is 1.07:1 (light)
  // and on `surface.raised` 1.13:1 — imperceptible. A fill-only notch is invisible on every
  // surface this card can sit on, so the stroke is the whole shape signal (spec §3.6), not a
  // finishing touch. If someone drops the border to "simplify", the notch silently disappears
  // and only this test notices.
  it('strokes the cut edge — a fill-only notch is invisible against the card', async () => {
    await render(
      <NotchedCard testID="card">
        <Text>Posture 72</Text>
      </NotchedCard>
    );

    const notch = screen.getByTestId('card-notch-left', { includeHiddenElements: true });
    const style = StyleSheet.flatten(notch.props.style);

    expect(style.borderWidth).toBeGreaterThan(0);
    expect(style.borderColor).toBe(Colors.light.hairline);
  });

  // `overflow: 'hidden'` is what turns a circle straddling the edge into an arc bitten out of
  // the card. Without it the same View reads as a whole circle sitting on top.
  it('clips its children, so a straddling notch reads as a cut and not a dot', async () => {
    await render(
      <NotchedCard testID="card">
        <Text>Posture 72</Text>
      </NotchedCard>
    );

    expect(StyleSheet.flatten(screen.getByTestId('card').props.style).overflow).toBe('hidden');
  });
});
