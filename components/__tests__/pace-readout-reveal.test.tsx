/**
 * Reveal-mode locks for <PaceReadout /> — issue #61's motion pass, re-cut for V23-08.
 *
 * `components/pace-readout.tsx` animates exactly one thing, and only on a fresh analysis with
 * Reduce Motion off: each pillar's 2 px bar fill grows from empty to its score width. Every other
 * render (a re-open from Past Analyses, or a first reveal under Reduce Motion) draws the fill at
 * its final width from the first frame with nothing scheduled. Every way that can break is
 * silent:
 *
 *   - lose the `reduceMotion` branch and a user who asked the OS for less motion gets the
 *     staggered fill. Nothing throws, nothing looks wrong on a developer's machine;
 *   - lose the `firstReveal` branch and re-opening an old result re-animates it, which is the
 *     exact V2.2 mistake `docs/design/motion-consult.md` item 3 exists to prevent;
 *   - animate `width` instead of a transform and every frame of the reveal is a layout pass.
 *
 * WHAT THESE TESTS DO NOT ASSERT, and why: Reanimated's animations do not advance under Jest in
 * this setup (a `withTiming` shared value stays at its start value however far fake timers are
 * wound), so no test here can prove an animation *finished*. What is provable — and what actually
 * regresses — is the FIRST FRAME each mode renders and the structural invariant that the fill's
 * layout width never moves (only its `scaleX` can). That is what is locked below.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { PaceReadout } from '../pace-readout';
import { photoResult, proTierVideoResult } from '@/lib/pace-fixtures';

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

// Every row mounts its (closed) detail modal, which pads by the live safe-area insets.
jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

const HIDDEN = { includeHiddenElements: true } as const;
const container = () => screen.getByTestId('pace-readout');
/** The fill is decorative (hidden from the a11y tree). Its style is the first frame. */
const fillStyle = (pillar: string) => StyleSheet.flatten(screen.getByTestId(`pillar-bar-${pillar}`, HIDDEN).props.style);
const fillScaleX = (pillar: string) => {
  const transform = fillStyle(pillar).transform as { scaleX?: number }[] | undefined;
  return transform?.find((t) => 'scaleX' in t)?.scaleX;
};

/** `proTierVideoResult`'s Posture score, as the fill width a finished bar must render. */
const POSTURE_WIDTH = '78%';

beforeEach(() => {
  mockUseReducedMotion.mockReturnValue(false);
});

describe('instant — re-opening a stored result from Past Analyses', () => {
  it('renders finished, with no reveal trigger attached at all', async () => {
    await render(<PaceReadout result={proTierVideoResult} />);

    // No `onLayout` means there is no trigger to fire and therefore nothing that could animate:
    // the "re-opening from history renders finished, instantly" rule, structurally.
    expect(container().props.onLayout).toBeUndefined();
  });

  it('renders every fill at its final width from the first frame', async () => {
    await render(<PaceReadout result={proTierVideoResult} />);

    expect(fillStyle('posture').width).toBe(POSTURE_WIDTH);
    expect(fillScaleX('posture')).toBe(1);
  });

  it('ignores the OS Reduce Motion setting — a re-open has no motion to reduce', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    await render(<PaceReadout result={proTierVideoResult} />);

    // Identical to the non-reduced re-open above: still no trigger, still a finished fill.
    expect(container().props.onLayout).toBeUndefined();
    expect(fillScaleX('posture')).toBe(1);
  });
});

describe('animate — a genuine first reveal, motion allowed', () => {
  it('gates the reveal on first layout, not on mount (motion-consult item 4)', async () => {
    await render(<PaceReadout result={proTierVideoResult} firstReveal />);

    expect(typeof container().props.onLayout).toBe('function');
  });

  it('starts each fill empty, by transform, never by animating its width', async () => {
    await render(<PaceReadout result={proTierVideoResult} firstReveal />);

    // Motion-consult item 1's "scaleX, never width", stated two ways: the first frame is an
    // unscaled fill, and its layout width is already the score it will show when the animation
    // finishes. No frame of this reveal triggers a layout pass.
    expect(fillScaleX('posture')).toBe(0);
    expect(fillStyle('posture').width).toBe(POSTURE_WIDTH);
    expect(fillStyle('posture').transformOrigin).toBe('left');
  });

  it('leaves a not-assessed pillar out of the reveal entirely', async () => {
    await render(<PaceReadout result={photoResult} firstReveal />);

    // There is no fill to grow, so there is nothing to animate — and nothing that could land at a
    // visible zero partway through the reveal.
    expect(screen.queryByTestId('pillar-bar-cadence', HIDDEN)).toBeNull();
  });

  it('renders the overall numeral as plain text at its true value — the page has no count-up', async () => {
    await render(<PaceReadout result={proTierVideoResult} firstReveal />);

    const numeral = screen.getByTestId('overall-score');
    expect(numeral.props.children).toBe(proTierVideoResult.overall.score);
    expect(numeral.props.editable).toBeUndefined();
  });
});

describe('a first reveal with the OS Reduce Motion setting on', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(true);
  });

  it('renders finished at once — no trigger, no stagger, no crossfade', async () => {
    await render(<PaceReadout result={proTierVideoResult} firstReveal />);

    // If this goes red, reduced motion is getting the staggered fill it asked not to have — a fill
    // would start at scale 0 instead of its finished 1.
    expect(container().props.onLayout).toBeUndefined();
    expect(StyleSheet.flatten(container().props.style).opacity).toBeUndefined();
    for (const pillar of ['posture', 'armSwing', 'cadence', 'elasticity']) {
      expect(fillScaleX(pillar)).toBe(1);
    }
  });
});

describe('the reveal waits for the screen to say it is ready', () => {
  it('still mounts the whole readout while `revealReady` is false — content is never withheld', async () => {
    await render(<PaceReadout result={proTierVideoResult} firstReveal revealReady={false} />);

    // The gate delays the ANIMATION, never the content: the score, every band word and every bar
    // are in the tree from the first frame, so a stalled screen can only ever cost the animation.
    expect(screen.getByTestId('overall-score').props.children).toBe(proTierVideoResult.overall.score);
    expect(screen.getByTestId('pillar-band-posture')).toBeTruthy();
    expect(fillStyle('posture').width).toBe(POSTURE_WIDTH);
  });
});
