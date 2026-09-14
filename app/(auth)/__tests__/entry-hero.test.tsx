/**
 * Locks for the V23-02 hero screen's one control. The cue must be inert until the hero reports
 * that its own timeline has reached the hold (`StrideHero`'s `onHold`), and must go to V23-03
 * Details when tapped; under reduced motion it must be usable at once, because the poster is all
 * the screen ever shows there. Reanimated does not advance under Jest (CLAUDE.md § Testing), so
 * the fade itself is not asserted — the `disabled` state and the navigation are.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import HeroScreen from '../welcome';
import { Copy } from '@/constants/copy';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), replace: jest.fn(), back: jest.fn() },
}));

// The hero has its own structural test (components/__tests__/stride-hero.test.tsx). Here it is a
// stub that exposes the one thing the screen depends on — the `onHold` callback its clock fires —
// as a pressable, so the test can reach the hold without a UI-thread clock.
jest.mock('@/components/stride-hero', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable, View } = require('react-native');
  return {
    StrideHero: ({ testID, onHold }: { testID?: string; onHold?: () => void }) => (
      <View testID={testID}>
        <Pressable testID="mock-hero-hold" onPress={() => onHold?.()} />
      </View>
    ),
  };
});

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

const cue = () => screen.getByRole('button', { name: Copy.entry.hero.cue, includeHiddenElements: true });

beforeEach(() => {
  mockPush.mockClear();
  mockUseReducedMotion.mockReturnValue(false);
});

describe('hero screen — animated', () => {
  it('mounts the hero and keeps the cue inert until the hero reports the hold', async () => {
    await render(<HeroScreen />);

    expect(screen.getByTestId('entry-hero', { includeHiddenElements: true })).toBeTruthy();
    expect(cue()).toBeDisabled();

    fireEvent.press(cue());
    expect(mockPush).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByTestId('mock-hero-hold', { includeHiddenElements: true }));
    });
    expect(cue()).toBeEnabled();

    fireEvent.press(cue());
    expect(mockPush).toHaveBeenCalledWith('/details');
  });
});

describe('hero screen — reduced motion', () => {
  it('shows the cue at once and goes to Details when tapped', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    await render(<HeroScreen />);

    expect(cue()).toBeEnabled();
    fireEvent.press(cue());
    expect(mockPush).toHaveBeenCalledWith('/details');
  });
});
