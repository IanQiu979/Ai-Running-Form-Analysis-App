/**
 * Locks for the optional pillar introductions (`pillars.tsx`, 2026-10-05): the four pillar
 * sections the entry scroll used to carry, in their own paged view, opened from Get started's
 * link. It must draw every pillar and no intro, reveal each section as it is scrolled to, and
 * offer two ways back to Get started — the top bar's Back and the last pillar's "Get started" —
 * both `router.back()`, falling through to the entry flow when there is nothing beneath (a deep
 * link). Reanimated does not advance under Jest (CLAUDE.md § Testing): a rise is asserted at its
 * first frame or, under reduced motion, in place.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import PillarsScreen from '../pillars';
import { Copy } from '@/constants/copy';
import { Motion } from '@/constants/v23-theme';
import { PACE_PILLARS } from '@shared/pace';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn(() => true);
jest.mock('expo-router', () => ({
  router: {
    back: () => mockBack(),
    replace: (...args: unknown[]) => mockReplace(...args),
    canGoBack: () => mockCanGoBack(),
    push: jest.fn(),
  },
}));

// The story is the real one (its own locks are in components/__tests__/pillar-story.test.tsx),
// wrapped so the reveal count the screen hands it can be read back.
const mockRevealedCounts: number[] = [];
jest.mock('@/components/pillar-story', () => {
  const actual = jest.requireActual('@/components/pillar-story');
  return {
    ...actual,
    PillarStory: (props: { revealedCount: number }) => {
      mockRevealedCounts.push(props.revealedCount);
      return <actual.PillarStory {...props} />;
    },
  };
});

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

const hidden = { includeHiddenElements: true } as const;
const H = 800;
/** The rise wrapping a pillar's box. */
const boxRise = (id: string) => StyleSheet.flatten(screen.getByTestId(`pillar-box-${id}`, hidden).parent!.props.style);

beforeEach(() => {
  mockBack.mockClear();
  mockRevealedCounts.length = 0;
  mockReplace.mockClear();
  mockCanGoBack.mockReturnValue(true);
  mockUseReducedMotion.mockReturnValue(false);
});

describe('pillar introductions', () => {
  it('draws the four pillar sections in order, a section tall each, and no intro', async () => {
    await render(<PillarsScreen />);
    await act(async () => {
      fireEvent(screen.getByTestId('pillars-scroll', hidden), 'layout', {
        nativeEvent: { layout: { height: H, width: 393, x: 0, y: 0 } },
      });
    });

    const ids = screen.getAllByTestId(/^story-section-/, hidden).map((node) => node.props.testID);
    expect(ids).toEqual(PACE_PILLARS.map((id) => `story-section-${id}`));
    for (const id of PACE_PILLARS) {
      expect(StyleSheet.flatten(screen.getByTestId(`story-section-${id}`, hidden).props.style).height).toBe(H);
    }
    expect(screen.queryByTestId('story-section-intro', hidden)).toBeNull();
    expect(screen.getByTestId('pillars-scroll', hidden).props.pagingEnabled).toBe(true);
  });

  it('shows the first pillar at once and reveals the rest as each is scrolled to', async () => {
    await render(<PillarsScreen />);
    const scroll = screen.getByTestId('pillars-scroll', hidden);
    await act(async () => {
      fireEvent(scroll, 'layout', { nativeEvent: { layout: { height: H, width: 393, x: 0, y: 0 } } });
    });

    // The first section is on screen from mount; the second is held at its first frame.
    expect(mockRevealedCounts[mockRevealedCounts.length - 1]).toBe(1);
    expect(boxRise(PACE_PILLARS[0]).opacity).toBe(1);
    expect(boxRise(PACE_PILLARS[1]).opacity).toBe(0);
    expect(boxRise(PACE_PILLARS[1]).transform).toEqual([{ translateY: Motion.pageShift }]);

    // Half a section in, the second arrives; at the end, every one has; back up hides nothing.
    await act(async () => {
      fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { y: H * 0.5, x: 0 } } });
    });
    expect(mockRevealedCounts[mockRevealedCounts.length - 1]).toBe(2);
    await act(async () => {
      fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { y: H * (PACE_PILLARS.length - 1), x: 0 } } });
    });
    expect(mockRevealedCounts[mockRevealedCounts.length - 1]).toBe(PACE_PILLARS.length);
    await act(async () => {
      fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { y: 0, x: 0 } } });
    });
    expect(mockRevealedCounts[mockRevealedCounts.length - 1]).toBe(PACE_PILLARS.length);
  });

  it('goes back to Get started from the top bar', async () => {
    await render(<PillarsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: Copy.entry.pillars.back, ...hidden }));
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('goes back to Get started from the end of the last pillar', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    await render(<PillarsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: Copy.entry.pillars.backToStart }));
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('falls through to the entry flow when opened with nothing beneath it', async () => {
    mockCanGoBack.mockReturnValue(false);
    await render(<PillarsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: Copy.entry.pillars.back, ...hidden }));
    });
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/welcome');
  });

  it('renders every pillar in place under reduced motion, with the boxes tappable', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    await render(<PillarsScreen />);

    for (const id of PACE_PILLARS) {
      expect(boxRise(id).opacity).toBe(1);
      expect(boxRise(id).transform).toEqual([{ translateY: 0 }]);
      expect(screen.getByRole('button', { name: Copy.entry.details.pillar[id].name })).toBeTruthy();
    }
    expect(screen.getByText(Copy.entry.details.hint)).toBeTruthy();
  });
});
