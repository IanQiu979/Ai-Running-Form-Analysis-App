/**
 * Locks for `<PillarStory>` (2026-09-20): one section per pillar in `PACE_PILLARS` order after
 * the intro, each a screen tall; the tap hint above the first box only; one box open at a time,
 * with the section's description stepping aside for the open card; the sign-up entry at the end
 * of the last section. Rendered with reduced motion where content must be visible — every item
 * mounts at the first frame of its rise and Reanimated never advances it under Jest (CLAUDE.md
 * § Testing). A press's re-render lands asynchronously under Reanimated's animated components,
 * so every state change below is awaited with `waitFor`.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { PillarStory, STORY_SECTION_COUNT } from '../pillar-story';
import { Copy } from '@/constants/copy';
import { Motion } from '@/constants/v23-theme';
import { PACE_PILLARS } from '@shared/pace';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

const pillars = Copy.entry.details.pillar;
const hidden = { includeHiddenElements: true } as const;
const H = 800;

function renderStory(props: Partial<React.ComponentProps<typeof PillarStory>> = {}) {
  const onSignUp = jest.fn();
  const utils = render(
    <PillarStory
      sectionHeight={H}
      revealedCount={STORY_SECTION_COUNT}
      reduceMotion
      onSignUp={onSignUp}
      {...props}
    />
  );
  return { onSignUp, utils };
}

describe('pillar story — sections', () => {
  it('renders the intro and one section per pillar, in order, each a section tall', async () => {
    await renderStory().utils;

    expect(STORY_SECTION_COUNT).toBe(1 + PACE_PILLARS.length);
    const intro = screen.getByTestId('story-section-intro');
    expect(StyleSheet.flatten(intro.props.style).height).toBe(H);
    expect(screen.getByRole('header', { name: Copy.entry.details.title })).toBeTruthy();
    expect(screen.getByText(Copy.entry.details.lede)).toBeTruthy();
    expect(screen.getByText(Copy.entry.details.reads)).toBeTruthy();

    for (const id of PACE_PILLARS) {
      const section = screen.getByTestId(`story-section-${id}`);
      expect(StyleSheet.flatten(section.props.style).height).toBe(H);
      expect(screen.getByRole('button', { name: pillars[id].name })).toBeTruthy();
      // The description line sits under the closed box; the open card's copy is not shown.
      expect(screen.getByText(pillars[id].desc)).toBeTruthy();
      expect(screen.queryByText(pillars[id].metric)).toBeNull();
    }

    // Sections are siblings in pillar order after the intro.
    const ids = screen.getAllByTestId(/^story-section-/).map((node) => node.props.testID);
    expect(ids).toEqual(['story-section-intro', ...PACE_PILLARS.map((id) => `story-section-${id}`)]);
  });

  it('shows the tap hint above the first pillar box only', async () => {
    await renderStory().utils;

    expect(screen.getAllByText(Copy.entry.details.hint)).toHaveLength(1);
    // The hint lives in the first pillar's section, above its box (first in the tree).
    const first = within(screen.getByTestId(`story-section-${PACE_PILLARS[0]}`));
    expect(first.getByTestId('story-hint')).toBeTruthy();
    const nodes = screen.getAllByTestId(/^(story-hint|pillar-box-)/).map((node) => node.props.testID);
    expect(nodes[0]).toBe('story-hint');
    expect(nodes[1]).toBe(`pillar-box-${PACE_PILLARS[0]}`);
    for (const id of PACE_PILLARS.slice(1)) {
      expect(within(screen.getByTestId(`story-section-${id}`)).queryByTestId('story-hint')).toBeNull();
    }
  });

  it('ends the last section with the sign-up entry and nothing else carries one', async () => {
    const { onSignUp } = renderStory();
    await waitFor(() => expect(screen.getByTestId('entry-sign-up')).toBeTruthy());

    expect(screen.getAllByRole('button', { name: Copy.entry.details.cue })).toHaveLength(1);
    const last = within(screen.getByTestId(`story-section-${PACE_PILLARS[PACE_PILLARS.length - 1]}`));
    expect(last.getByTestId('entry-sign-up')).toBeTruthy();
    // Nothing above the last section carries the entry.
    for (const id of PACE_PILLARS.slice(0, -1)) {
      expect(within(screen.getByTestId(`story-section-${id}`)).queryByTestId('entry-sign-up')).toBeNull();
    }

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: Copy.entry.details.cue }));
    });
    expect(onSignUp).toHaveBeenCalledTimes(1);
  });
});

describe('pillar story — one box open at a time', () => {
  it('opens a box in place, hides that section description, and swaps to another on tap', async () => {
    await renderStory().utils;

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: pillars.cadence.name }));
    });
    await waitFor(() => expect(screen.getByText(pillars.cadence.metric)).toBeTruthy());
    expect(screen.getByTestId('pillar-box-cadence').props.accessibilityState).toEqual({ expanded: true });
    // The card carries the sentence now; the section's own line has stepped aside.
    expect(screen.getAllByText(pillars.cadence.desc)).toHaveLength(1);
    // The other sections are untouched.
    expect(screen.getByText(pillars.posture.desc)).toBeTruthy();
    expect(screen.queryByText(pillars.posture.metric)).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: pillars.posture.name }));
    });
    await waitFor(() => expect(screen.getByText(pillars.posture.metric)).toBeTruthy());
    expect(screen.queryByText(pillars.cadence.metric)).toBeNull();
    expect(screen.getByRole('button', { name: pillars.cadence.name })).toBeTruthy();
  });

  it('closes the open card from its close control and brings the description back', async () => {
    await renderStory().utils;

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: pillars.elasticity.name }));
    });
    await waitFor(() => expect(screen.getByText(pillars.elasticity.metric)).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: Copy.entry.details.close }));
    });

    await waitFor(() => expect(screen.queryByText(pillars.elasticity.metric)).toBeNull());
    expect(screen.getByRole('button', { name: pillars.elasticity.name })).toBeTruthy();
    expect(screen.getByText(pillars.elasticity.desc)).toBeTruthy();
  });
});

describe('pillar story — reveal', () => {
  it('holds every item at the first frame of its rise until its section is reached', async () => {
    await renderStory({ reduceMotion: false, revealedCount: 0 }).utils;

    // Present in the tree at opacity 0 and 12 pt low — see the file header.
    const title = screen.getByText(Copy.entry.details.title, hidden);
    expect(title).toBeTruthy();
    const box = screen.getByTestId('pillar-box-elasticity', hidden);
    const slot = box.parent;
    expect(slot).not.toBeNull();
    const style = StyleSheet.flatten(slot!.props.style);
    expect(style.opacity).toBe(0);
    expect(style.transform).toEqual([{ translateY: Motion.pageShift }]);
  });

  it('sizes the closed box from the section height, capped by the column', async () => {
    await renderStory({ reduceMotion: false, revealedCount: 0 }).utils;

    const slot = screen.getByTestId('pillar-box-posture', hidden).parent!;
    expect(StyleSheet.flatten(slot.props.style).width).toBe(Math.round(H * 0.42));
  });

  it('renders everything in place under reduced motion, whatever the reveal count says', async () => {
    await renderStory({ reduceMotion: true, revealedCount: 0 }).utils;

    const slot = screen.getByTestId('pillar-box-posture').parent!;
    const style = StyleSheet.flatten(slot.props.style);
    expect(style.opacity).toBe(1);
    expect(style.transform).toEqual([{ translateY: 0 }]);
    expect(screen.getByText(Copy.entry.details.hint)).toBeTruthy();
  });
});

/**
 * A direct switch between open pillars (and a switch during a collapse) must land on a FRESH
 * card, keyed by pillar: the new card starts unmeasured at its first expand frame rather than
 * inheriting the previous pillar's measured height and finished tween, and the previous card's
 * collapse — which runs to completion under real timers — hands back scoped to ITS pillar, so it
 * cannot close the card the user opened in the meantime. Reanimated's Jest path exposes the live
 * animated values on `props.jestAnimatedStyle`.
 */
describe('pillar story — switching between open pillars', () => {
  const animatedStyle = (testID: string) =>
    screen.getByTestId(testID, hidden).props.jestAnimatedStyle.value as {
      opacity: number;
      height?: number;
    };
  const expectExpanded = (testID: string) =>
    expect(screen.getByTestId(testID, hidden).props.accessibilityState).toEqual({ expanded: true });

  it('mounts a fresh card for the new pillar, and a finishing collapse cannot close it', async () => {
    await renderStory({ reduceMotion: false }).utils;

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: pillars.cadence.name, ...hidden }));
    });
    await waitFor(() => expectExpanded('pillar-box-cadence'));
    expect(animatedStyle('pillar-box-cadence').height).toBeUndefined();

    // The card measures itself (`fireEvent` climbs from the text to the card's `onLayout`); the
    // clip box then gets a height and starts revealing.
    fireEvent(screen.getByText(pillars.cadence.metric, hidden), 'layout', {
      nativeEvent: { layout: { height: 200 } },
    });
    await waitFor(() => expect(animatedStyle('pillar-box-cadence').height).toBeGreaterThan(0));

    // Close cadence — its reverse tween starts — and open posture before it has finished.
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: Copy.entry.details.close, ...hidden }));
    });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: pillars.posture.name, ...hidden }));
    });

    await waitFor(() => expectExpanded('pillar-box-posture'));
    expect(animatedStyle('pillar-box-posture').height).toBeUndefined();
    expect(screen.queryByText(pillars.cadence.metric, hidden)).toBeNull();
    expect(screen.getByRole('button', { name: pillars.cadence.name, ...hidden })).toBeTruthy();

    // Let cadence's collapse tween run out: posture must still be the open card.
    await act(() => new Promise((resolve) => setTimeout(resolve, Motion.duration.expand * 2)));
    expectExpanded('pillar-box-posture');
    expect(screen.getByText(pillars.posture.metric, hidden)).toBeTruthy();
  });
});
