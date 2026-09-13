/**
 * Structural lock for `components/laser-sweep.tsx` (V23-05). Reanimated does not advance under
 * Jest (CLAUDE.md § Testing), so this asserts what a first frame proves: the sweep is decorative
 * and hidden from assistive tech, waits for a measured height before it draws anything, and then
 * draws the core `ink` line with the page's three glow layers around it.
 */
import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { LaserSweep } from '@/components/laser-sweep';
import { Ink } from '@/constants/v23-theme';

const HIDDEN = { includeHiddenElements: true } as const;

describe('LaserSweep', () => {
  it('is hidden from the accessibility tree and inert to touch', async () => {
    await render(<LaserSweep testID="laser" />);

    const root = screen.getByTestId('laser', HIDDEN);
    expect(root.props.accessibilityElementsHidden).toBe(true);
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(root.props.pointerEvents).toBe('none');
    expect(screen.queryByTestId('laser')).toBeNull();
  });

  it('draws nothing until the container has been measured, then the ink core line', async () => {
    await render(<LaserSweep testID="laser" />);

    expect(screen.queryByTestId('laser-core', HIDDEN)).toBeNull();

    await act(async () => {
      screen
        .getByTestId('laser', HIDDEN)
        .props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 393, height: 852 } } });
    });

    const core = screen.getByTestId('laser-core', HIDDEN);
    expect(StyleSheet.flatten(core.props.style)).toMatchObject({ backgroundColor: Ink.ink });
  });
});
