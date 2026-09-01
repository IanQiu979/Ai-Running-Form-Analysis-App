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
import { photoResult, proTierVideoResult } from '@/lib/pace-fixtures';

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

/** The container animates its own opacity in `crossfade` mode, so it must be queried with hidden
 * elements included — its first frame is `opacity: 0`. See CLAUDE.md § Testing. */
const container = () => screen.getByTestId('pace-readout', { includeHiddenElements: true });
const containerStyle = () => StyleSheet.flatten(container().props.style);
const numeral = () => screen.getByTestId('overall-score', { includeHiddenElements: true });

/** The ring geometry `<PaceReadout>` renders a pillar at, re-derived rather than observed. */
const PILLAR_CIRCUMFERENCE = 2 * Math.PI * ((64 - 6) / 2);
/** How far a ring still has to sweep. This — not a width — is what the reveal now moves, so it is
 *  what every mode below is asserted against. */
const sweepRemaining = (pillar: string) =>
  screen.getByTestId(`pillar-ring-${pillar}-fill`, { includeHiddenElements: true }).props
    .strokeDashoffset as number;
/** The ring's own layout box. Load-bearing for the "never animates a dimension" invariant below. */
const ringStyle = (pillar: string) =>
  StyleSheet.flatten(screen.getByTestId(`pillar-ring-${pillar}`, { includeHiddenElements: true }).props.style);

/** `proTierVideoResult`'s Posture score, as the arc offset a finished ring must render. */
const POSTURE_SWEEP_REMAINING = PILLAR_CIRCUMFERENCE * 0.22;

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

  it('renders each ring already at its final sweep, with nothing left to resolve', async () => {
    await render(<PaceReadout result={proTierVideoResult} />);

    expect(sweepRemaining('posture')).toBeCloseTo(POSTURE_SWEEP_REMAINING, 4);
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

  it('sweeps each ring from empty, never by animating a dimension', async () => {
    await render(<PaceReadout result={proTierVideoResult} firstReveal />);

    // The successor of motion-consult item 1's "scaleX, never width". A ring has no width to
    // animate — the arc's LENGTH is a stroke property — so the invariant is stated two ways:
    // the first frame is a fully-unswept arc, and the ring's layout box is the same fixed size it
    // will be when the animation finishes. No frame of this reveal triggers a layout pass.
    expect(sweepRemaining('posture')).toBeCloseTo(PILLAR_CIRCUMFERENCE, 4);
    expect(ringStyle('posture').width).toBe(64);
    expect(ringStyle('posture').height).toBe(64);
  });

  it('leaves a not-assessed pillar’s ring out of the reveal entirely', async () => {
    await render(<PaceReadout result={photoResult} firstReveal />);

    // There is no arc to sweep, so there is nothing to animate — and nothing that could land at a
    // visible zero partway through the reveal.
    expect(screen.queryByTestId('pillar-ring-cadence-fill', { includeHiddenElements: true })).toBeNull();
  });

  it('mounts the count-up numeral seeded with the true score, not a zero', async () => {
    await render(<PaceReadout result={proTierVideoResult} firstReveal />);

    // motion-consult item 2: a disabled TextInput Reanimated patches on the UI thread. Its
    // `defaultValue` is the safety net — if that patch never lands, the user still sees the real
    // score rather than a stuck 0.
    expect(numeral().props.editable).toBe(false);
    expect(numeral().props.defaultValue).toBe(String(proTierVideoResult.overall.score));
  });

  it('does not crossfade the container — the reveal is the rings, not the block', async () => {
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

  it('drops the stagger: every ring is drawn at its final sweep from the first frame', async () => {
    await render(<PaceReadout result={proTierVideoResult} firstReveal />);

    // If this goes red, reduced motion is getting the staggered spring sweep it asked not to have
    // — each ring would start at a full unswept circumference instead of its finished offset.
    for (const pillar of ['posture', 'armSwing', 'cadence', 'elasticity']) {
      expect(sweepRemaining(pillar)).toBeLessThan(PILLAR_CIRCUMFERENCE);
    }
    expect(sweepRemaining('posture')).toBeCloseTo(POSTURE_SWEEP_REMAINING, 4);
  });
});

describe('the reveal waits for the hero to finish before it starts', () => {
  it('still mounts the whole readout while `revealReady` is false — content is never withheld', async () => {
    await render(<PaceReadout result={proTierVideoResult} firstReveal revealReady={false} />);

    // The gate delays the ANIMATION, never the content: the score and every ring are in the tree
    // from the first frame, so a stalled hero can only ever cost the animation, not the result.
    expect(numeral().props.defaultValue).toBe(String(proTierVideoResult.overall.score));
    expect(screen.getByTestId('pillar-ring-posture', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('pillar-band-posture', { includeHiddenElements: true })).toBeTruthy();
  });
});
