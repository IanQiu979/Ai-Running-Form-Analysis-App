/**
 * Locks for the details screen (V23-03): its copy is on screen, one pillar box opens at a time
 * with the open card taking the grid's first slot, and "Continue" is a tap to sign-up. Rendered
 * with reduced motion where content must be visible — the arrival stagger mounts every item at
 * opacity 0 and Reanimated never advances it under Jest (CLAUDE.md § Testing). A press's
 * re-render lands asynchronously under Reanimated's animated components (the same note
 * `sign-in.test.tsx` records), so every state change below is awaited with `waitFor`.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { Copy } from '@/constants/copy';

import DetailsScreen from '../details';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), replace: jest.fn(), back: jest.fn() },
}));

const mockUseReducedMotion = jest.fn(() => true);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));


const pillars = Copy.entry.details.pillar;

beforeEach(() => {
  mockPush.mockClear();
  mockUseReducedMotion.mockReturnValue(true);
});

describe('details screen', () => {
  it('renders the page copy and the four closed pillar boxes', async () => {
    await render(<DetailsScreen />);

    expect(screen.getByRole('header', { name: Copy.entry.details.title })).toBeTruthy();
    expect(screen.getByText(Copy.entry.details.lede)).toBeTruthy();
    expect(screen.getByText(Copy.entry.details.reads.label)).toBeTruthy();
    expect(screen.getByText(Copy.entry.details.reads.body)).toBeTruthy();
    for (const id of ['posture', 'armSwing', 'cadence', 'elasticity'] as const) {
      expect(screen.getByRole('button', { name: pillars[id].name })).toBeTruthy();
      expect(screen.queryByText(pillars[id].desc)).toBeNull();
    }
  });

  it('opens one box at a time, the open card first in the grid', async () => {
    await render(<DetailsScreen />);

    fireEvent.press(screen.getByRole('button', { name: pillars.cadence.name }));
    await waitFor(() => expect(screen.getByText(pillars.cadence.desc)).toBeTruthy());
    expect(screen.getByText(pillars.cadence.metric)).toBeTruthy();

    // The open card is the grid's first child (the page's `order: -1`).
    const grid = screen.getByTestId('details-pillar-grid');
    const firstSlot = grid.children[0];
    expect(typeof firstSlot === 'object' && firstSlot.props.style).toEqual({ width: '100%' });
    expect(screen.getByTestId('pillar-box-cadence').props.accessibilityState).toEqual({ expanded: true });

    fireEvent.press(screen.getByRole('button', { name: pillars.posture.name }));
    await waitFor(() => expect(screen.getByText(pillars.posture.desc)).toBeTruthy());
    expect(screen.queryByText(pillars.cadence.desc)).toBeNull();
    // The closed cadence square is back, beneath.
    expect(screen.getByRole('button', { name: pillars.cadence.name })).toBeTruthy();
  });

  it('closes the open card from its close control', async () => {
    await render(<DetailsScreen />);

    fireEvent.press(screen.getByRole('button', { name: pillars.elasticity.name }));
    await waitFor(() => expect(screen.getByText(pillars.elasticity.desc)).toBeTruthy());
    fireEvent.press(screen.getByRole('button', { name: Copy.entry.details.close }));

    await waitFor(() => expect(screen.queryByText(pillars.elasticity.desc)).toBeNull());
    expect(screen.getByRole('button', { name: pillars.elasticity.name })).toBeTruthy();
  });

  it('continues to sign-up on tap', async () => {
    await render(<DetailsScreen />);

    fireEvent.press(screen.getByRole('button', { name: Copy.entry.details.cue }));
    expect(mockPush).toHaveBeenCalledWith('/sign-in');
  });

  it('mounts every item with motion on, each at the first frame of its rise', async () => {
    mockUseReducedMotion.mockReturnValue(false);
    await render(<DetailsScreen />);

    // Present in the tree at opacity 0 and 12 pt low — see the file header.
    expect(screen.getByText(Copy.entry.details.title, { includeHiddenElements: true })).toBeTruthy();
    const box = screen.getByTestId('pillar-box-elasticity', { includeHiddenElements: true });
    const style = StyleSheet.flatten(box.props.style);
    expect(style.opacity).toBe(0);
    expect(style.transform).toEqual([{ translateY: 12 }]);
  });
});
