/**
 * Reveal-mode locks for <PaceReadout /> — issue #61's motion pass, the half with no coverage.
 *
 * `components/pace-readout.tsx` picks one of three mutually exclusive reveal modes and mounts a
 * DIFFERENT node tree for each (`instant` | `animate` | `crossfade`, see that file's `RevealMode`).
 * That selection is the entire deliverable of the issue's "reduced-motion variants" scope, and
 * every way it can break is silent:
 *
 *   - lose the `reduceMotion` branch and a user who asked the OS for less motion gets the full
 *     staggered fill + count-up. Nothing throws, nothing looks wrong on a developer's machine;
 *   - lose the `firstReveal` branch and re-opening an old result re-animates it, which is the
 *     exact V2.2 mistake `docs/design/motion-consult.md` item 3 exists to prevent;
 *   - lose the `crossfade` opacity and the readout is mounted at `opacity: 0` with nothing left
 *     to raise it — the worst of the three, because the content is simply *gone*.
 *
 * WHAT THESE TESTS DO NOT ASSERT, and why: Reanimated's animations do not advance under Jest in
 * this setup (a `withTiming`/`withSpring` shared value stays at its start value however far fake
 * timers are wound), so no test here can prove an animation *finished*. What is provable — and
 * what actually regresses — is which tree each mode mounts and what its first frame is. That is
 * what is locked below.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { PaceReadout } from '../pace-readout';
import { proTierVideoResult } from '@/lib/pace-fixtures';

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

/** The container animates its own opacity in `crossfade` mode, so it must be queried with hidden
 * elements included — its first frame is `opacity: 0`. See CLAUDE.md § Testing. */
const container = () => screen.getByTestId('pace-readout', { includeHiddenElements: true });
const containerStyle = () => StyleSheet.flatten(container().props.style);
const fillStyle = (pillar: string) =>
  StyleSheet.flatten(screen.getByTestId(`pillar-bar-fill-${pillar}`, { includeHiddenElements: true }).props.style);
const numeral = () => screen.getByTestId('overall-score', { includeHiddenElements: true });

/** `proTierVideoResult`'s Posture score, i.e. the fill width every mode must render. */
const POSTURE_SCORE = '78%';

beforeEach(() => {
  mockUseReducedMotion.mockReturnValue(false);
});

describe('instant — re-opening a stored result from Past Analyses', () => {
  it('renders finished, with no reveal trigger attached at all', async () => {
    await render(<PaceReadout result={proTierVideoResult} />);

    // No `onLayout` means there is no trigger to fire and therefore nothing that could animate:
    // the brief's "re-opening from history renders finished, instantly" rule, structurally.
    expect(container().props.onLayout).toBeUndefined();
    expect(containerStyle().opacity).toBeUndefined();
  });

  it('renders the real numeral as plain text, never the count-up input', async () => {
    await render(<PaceReadout result={proTierVideoResult} />);

    expect(numeral().props.children).toBe(proTierVideoResult.overall.score);
    expect(numeral().props.editable).toBeUndefined();
  });

  it('renders each bar at its final width with no transform to resolve', async () => {
    await render(<PaceReadout result={proTierVideoResult} />);

    expect(fillStyle('posture').width).toBe(POSTURE_SCORE);
    expect(fillStyle('posture').transform).toBeUndefined();
    expect(fillStyle('posture').transformOrigin).toBeUndefined();
  });

  it('ignores the OS Reduce Motion setting — a re-open has no motion to reduce', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    await render(<PaceReadout result={proTierVideoResult} />);

    // Identical to the non-reduced re-open above: still no trigger, still no crossfade opacity.
    expect(container().props.onLayout).toBeUndefined();
    expect(containerStyle().opacity).toBeUndefined();
  });
});

describe('animate — a genuine first reveal, motion allowed', () => {
  it('gates the reveal on first layout, not on mount (motion-consult item 4)', async () => {
    await render(<PaceReadout result={proTierVideoResult} firstReveal />);

    expect(typeof container().props.onLayout).toBe('function');
  });

  it('grows each bar with scaleX from a statically-sized fill, never by animating width', async () => {
    await render(<PaceReadout result={proTierVideoResult} firstReveal />);

    // motion-consult item 1. The width is the FINAL width from the first frame on — only the
    // transform moves, so no frame of this reveal ever triggers a layout pass.
    const style = fillStyle('posture');
    expect(style.width).toBe(POSTURE_SCORE);
    expect(style.transformOrigin).toBe('left');
    expect(style.transform).toEqual([{ scaleX: 0 }]);
  });

  it('mounts the count-up numeral seeded with the true score, not a zero', async () => {
    await render(<PaceReadout result={proTierVideoResult} firstReveal />);

    // motion-consult item 2: a disabled TextInput Reanimated patches on the UI thread. Its
    // `defaultValue` is the safety net — if that patch never lands, the user still sees the real
    // score rather than a stuck 0.
    expect(numeral().props.editable).toBe(false);
    expect(numeral().props.defaultValue).toBe(String(proTierVideoResult.overall.score));
  });

  it('does not crossfade the container — the reveal is the bars, not the block', async () => {
    await render(<PaceReadout result={proTierVideoResult} firstReveal />);

    expect(containerStyle().opacity).toBeUndefined();
  });
});

describe('crossfade — a first reveal with the OS Reduce Motion setting on', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(true);
  });

  it('replaces the reveal with a single opacity animation over the whole readout', async () => {
    await render(<PaceReadout result={proTierVideoResult} firstReveal />);

    // Brief §6's reduced-motion variant: one crossfade. It still waits for first layout, so the
    // content is not raised before it has anywhere to be.
    expect(containerStyle().opacity).toBe(0);
    expect(typeof container().props.onLayout).toBe('function');
  });

  it('drops the count-up: the numeral is plain text at its final value', async () => {
    await render(<PaceReadout result={proTierVideoResult} firstReveal />);

    expect(numeral().props.children).toBe(proTierVideoResult.overall.score);
    expect(numeral().props.editable).toBeUndefined();
  });

  it('drops the stagger: every bar is a static fill with no per-bar transform', async () => {
    await render(<PaceReadout result={proTierVideoResult} firstReveal />);

    // If this goes red, reduced motion is getting the staggered spring fill it asked not to have.
    for (const pillar of ['posture', 'armSwing', 'cadence', 'elasticity']) {
      expect(fillStyle(pillar).transform).toBeUndefined();
      expect(fillStyle(pillar).transformOrigin).toBeUndefined();
    }
    expect(fillStyle('posture').width).toBe(POSTURE_SCORE);
  });
});

describe('the reveal waits for the hero to finish before it starts', () => {
  it('still mounts the whole readout while `revealReady` is false — content is never withheld', async () => {
    await render(<PaceReadout result={proTierVideoResult} firstReveal revealReady={false} />);

    // The gate delays the ANIMATION, never the content: the score and every bar are in the tree
    // from the first frame, so a stalled hero can only ever cost the animation, not the result.
    expect(numeral().props.defaultValue).toBe(String(proTierVideoResult.overall.score));
    expect(fillStyle('posture').width).toBe(POSTURE_SCORE);
  });
});
