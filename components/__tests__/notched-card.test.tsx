/**
 * The result container is a notched rectangle, not a rounded card (spec 2026-07-26 §3.6).
 * Shape is the identity signal, so the notches are asserted present and asserted decorative —
 * they must never appear in the accessibility tree (brief §7).
 */
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { NotchedCard } from '../ui/notched-card';

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
});
