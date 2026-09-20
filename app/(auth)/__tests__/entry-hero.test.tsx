/**
 * Locks for the signed-out entry flow (`welcome.tsx`, 2026-09-20): hero, story and sign-up in
 * one paged scroll. The scroll must be locked and the "Scroll down" cue absent until the hero
 * reports that its own timeline has reached the hold (`StrideHero`'s `onHold`); the scroll's
 * offset must drive the story's reveal count, monotonically, through `lib/entry-story.ts`; the
 * story's sign-up entry must push the sign-up screen; and under reduced motion the whole flow
 * must be usable at once, because the poster is all the hero ever shows there. Reanimated does
 * not advance under Jest (CLAUDE.md § Testing), so the cue's fade is not asserted — its
 * presence, the scroll lock and the wiring are.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import HeroScreen from '../welcome';
import { Copy } from '@/constants/copy';
import { PACE_PILLARS } from '@shared/pace';

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

// The story is the real one (its own locks are in components/__tests__/pillar-story.test.tsx),
// wrapped so the props the screen hands it — the reveal count and the section height — can be
// read back; nothing in the rendered tree exposes a count.
type StoryProps = { sectionHeight: number; revealedCount: number; reduceMotion: boolean };
const mockStoryProps: StoryProps[] = [];
jest.mock('@/components/pillar-story', () => {
  const actual = jest.requireActual('@/components/pillar-story');
  return {
    ...actual,
    PillarStory: (props: StoryProps) => {
      mockStoryProps.push(props);
      return <actual.PillarStory {...props} />;
    },
  };
});

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

const hidden = { includeHiddenElements: true } as const;
const cue = () => screen.queryByTestId('entry-hero-cue', hidden);
const scroll = () => screen.getByTestId('entry-scroll', hidden);
const lastStoryProps = () => mockStoryProps[mockStoryProps.length - 1];
const H = 800;

async function reachHold() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('mock-hero-hold', hidden));
  });
}

function layoutScroll(height: number) {
  fireEvent(scroll(), 'layout', { nativeEvent: { layout: { height, width: 393, x: 0, y: 0 } } });
}

async function scrollTo(y: number) {
  await act(async () => {
    fireEvent.scroll(scroll(), { nativeEvent: { contentOffset: { y, x: 0 } } });
  });
}

beforeEach(() => {
  mockPush.mockClear();
  mockStoryProps.length = 0;
  mockUseReducedMotion.mockReturnValue(false);
});

describe('entry flow — animated', () => {
  it('locks the scroll and withholds the cue until the hero reports the hold', async () => {
    await render(<HeroScreen />);

    expect(screen.getByTestId('entry-hero', hidden)).toBeTruthy();
    expect(cue()).toBeNull();
    expect(scroll().props.scrollEnabled).toBe(false);
    expect(scroll().props.pagingEnabled).toBe(true);

    await reachHold();

    expect(cue()).toBeTruthy();
    expect(screen.getByText(Copy.entry.hero.cue, hidden)).toBeTruthy();
    expect(scroll().props.scrollEnabled).toBe(true);
  });

  it('never labels the cue "Continue", and no such label is anywhere in the flow', async () => {
    await render(<HeroScreen />);
    await reachHold();

    expect(Copy.entry.hero.cue).toBe('Scroll down');
    expect(screen.queryByText('Continue', hidden)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue', ...hidden })).toBeNull();
  });

  it('hands the story the measured section height and a reveal count that only grows', async () => {
    await render(<HeroScreen />);
    await reachHold();
    await act(async () => layoutScroll(H));

    // The hero is the only section reached at the top; the story has none.
    expect(lastStoryProps().sectionHeight).toBe(H);
    expect(lastStoryProps().revealedCount).toBe(0);

    // Half a section in: the intro begins to arrive.
    await scrollTo(H * 0.5);
    expect(lastStoryProps().revealedCount).toBe(1);

    // Snapped to the intro, nothing more is reached; a section and a half in, the first pillar is.
    await scrollTo(H);
    expect(lastStoryProps().revealedCount).toBe(1);
    await scrollTo(H * 1.5);
    expect(lastStoryProps().revealedCount).toBe(2);

    // Scrolling back up hides nothing.
    await scrollTo(0);
    expect(lastStoryProps().revealedCount).toBe(2);

    // The far end reaches every story section.
    await scrollTo(H * PACE_PILLARS.length + H);
    expect(lastStoryProps().revealedCount).toBe(1 + PACE_PILLARS.length);
  });

  it('gives every section the scroll viewport height, and the hero the same', async () => {
    await render(<HeroScreen />);
    await act(async () => layoutScroll(H));

    expect(screen.getByTestId('entry-hero-section', hidden).props.style).toEqual({ height: H });
    expect(lastStoryProps().sectionHeight).toBe(H);
  });
});

describe('entry flow — reduced motion', () => {
  it('shows the cue at once, frees the scroll, renders the story in place and reaches sign-up', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    await render(<HeroScreen />);

    expect(cue()).toBeTruthy();
    expect(scroll().props.scrollEnabled).toBe(true);
    expect(lastStoryProps().reduceMotion).toBe(true);
    for (const id of PACE_PILLARS) {
      expect(screen.getByTestId(`story-section-${id}`)).toBeTruthy();
    }
    expect(screen.getByText(Copy.entry.details.hint)).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: Copy.entry.details.cue }));
    });
    expect(mockPush).toHaveBeenCalledWith('/sign-in');
  });
});
