/**
 * Locks the arc motif's structural invariants — the ones whose failure is SILENT.
 *
 * Per CLAUDE.md § Testing: Reanimated animations do not advance under Jest here, so nothing below
 * asserts that a sweep finished. It asserts the FIRST FRAME and which node tree each mode mounts,
 * which is exactly where this component's dangerous bugs live:
 *
 *   - a not-assessed ring that mounts a fill arc would render `null` as a visible zero, the one
 *     failure `components/pace-readout.tsx` has existed to prevent since issue #56;
 *   - a non-animating ring whose first frame is an empty arc would show a re-opened result
 *     briefly reading 0 before settling;
 *   - a reduced-motion loader that still schedules its spin would animate at a user who asked the
 *     OS not to.
 *
 * `includeHiddenElements` is required throughout: every node here is correctly hidden from the
 * a11y tree (see each component's header), and RNTL excludes hidden elements by default.
 */
import { render, screen } from '@testing-library/react-native';

import { ArcLoader } from '@/components/arc-loader';
import { ArcRing } from '@/components/ui/arc-ring';
import { CornerArcs } from '@/components/ui/corner-arcs';
import { Meter, Score } from '@/constants/theme';

const HIDDEN = { includeHiddenElements: true } as const;

/** The circumference `<ArcRing>` computes for a given size/stroke — duplicated here on purpose so
 *  the expected dash offsets are derived from the geometry, not copied from an observed run. */
function circumferenceFor(size: number, strokeWidth: number) {
  return 2 * Math.PI * ((size - strokeWidth) / 2);
}

describe('<ArcRing> — not assessed is a different picture, never a zero', () => {
  it('mounts NO fill arc when the fraction is null', async () => {
    await render(
      <ArcRing testID="ring" size={120} strokeWidth={8} fraction={null} color={Score.good.dark.fill} />
    );

    expect(screen.getByTestId('ring-track', HIDDEN)).toBeTruthy();
    expect(screen.queryByTestId('ring-fill', HIDDEN)).toBeNull();
  });

  // One render per test throughout this file. Rendering twice inside a single `it` triggers
  // RNTL's "overlapping act() calls" and the second tree comes back incomplete — which surfaces as
  // a testID that "doesn't exist", not as an error about the render.
  it('dashes the track when not assessed', async () => {
    await render(
      <ArcRing testID="empty" size={120} strokeWidth={8} fraction={null} color={Score.good.dark.fill} />
    );

    expect(screen.getByTestId('empty-track', HIDDEN).props.strokeDasharray).toEqual([5, 5]);
  });

  it('leaves the track solid when the pillar WAS assessed', async () => {
    await render(
      <ArcRing testID="full" size={120} strokeWidth={8} fraction={0.5} color={Score.good.dark.fill} />
    );

    expect(screen.getByTestId('full-track', HIDDEN).props.strokeDasharray).toBeUndefined();
  });
});

describe('<ArcRing> — the first painted frame', () => {
  it('renders a static ring already at its final sweep (nothing to settle on re-open)', async () => {
    const size = 120;
    const strokeWidth = 8;
    const circumference = circumferenceFor(size, strokeWidth);

    await render(
      <ArcRing testID="ring" size={size} strokeWidth={strokeWidth} fraction={0.75} color={Score.good.dark.fill} />
    );

    const fill = screen.getByTestId('ring-fill', HIDDEN);
    expect(fill.props.strokeDashoffset).toBeCloseTo(circumference * 0.25, 5);
  });

  it('renders an animating ring at ZERO sweep on its first frame', async () => {
    const size = 120;
    const strokeWidth = 8;
    const circumference = circumferenceFor(size, strokeWidth);

    await render(
      <ArcRing
        testID="ring"
        size={size}
        strokeWidth={strokeWidth}
        fraction={0.75}
        animate
        color={Score.good.dark.fill}
      />
    );

    // The whole circumference still to sweep — the correct pre-animation state, not a wrong one.
    expect(screen.getByTestId('ring-fill', HIDDEN).props.strokeDashoffset).toBeCloseTo(circumference, 5);
  });

  it('clamps a fraction above 1 rather than drawing past the ring', async () => {
    await render(<ArcRing testID="over" size={100} strokeWidth={6} fraction={1.4} color={Score.good.dark.fill} />);

    // react-native-svg normalises a zero offset to `null` on the native prop, so this asserts
    // "nothing left to sweep" rather than the literal 0 the component computes. Either way the
    // regression it guards is the same: an unclamped 1.4 would produce a NEGATIVE offset, which
    // draws the arc past its own start point and back over itself.
    expect(screen.getByTestId('over-fill', HIDDEN).props.strokeDashoffset ?? 0).toBe(0);
  });

  it('clamps a negative fraction to an empty sweep rather than a reversed one', async () => {
    await render(<ArcRing testID="under" size={100} strokeWidth={6} fraction={-0.3} color={Score.good.dark.fill} />);

    expect(screen.getByTestId('under-fill', HIDDEN).props.strokeDashoffset).toBeCloseTo(
      circumferenceFor(100, 6),
      5
    );
  });

  // The regression this guards is silent and was real: a static ring seeded its swept value once
  // at mount, so the frame-extraction ring — whose fraction moves while the screen is open — would
  // have sat frozen at its first value while the count beside it climbed.
  it('follows a fraction that changes after mount', async () => {
    const circumference = circumferenceFor(120, 8);
    const { rerender } = await render(
      <ArcRing testID="ring" size={120} strokeWidth={8} fraction={0.25} color={Score.good.dark.fill} />
    );
    expect(screen.getByTestId('ring-fill', HIDDEN).props.strokeDashoffset).toBeCloseTo(circumference * 0.75, 5);

    await rerender(<ArcRing testID="ring" size={120} strokeWidth={8} fraction={0.9} color={Score.good.dark.fill} />);

    expect(screen.getByTestId('ring-fill', HIDDEN).props.strokeDashoffset).toBeCloseTo(circumference * 0.1, 5);
  });

  it('insets the radius by half the stroke so the ring’s outer edge lands on `size`', async () => {
    await render(<ArcRing testID="ring" size={200} strokeWidth={20} fraction={1} color={Score.good.dark.fill} />);

    // r + strokeWidth/2 === size/2. A radius of size/2 would draw half the stroke outside the box.
    expect(screen.getByTestId('ring-track', HIDDEN).props.r).toBe(90);
  });
});

describe('<CornerArcs>', () => {
  it('draws `count` concentric arcs, each fainter than the one inside it', async () => {
    await render(<CornerArcs testID="arcs" radius={200} count={4} />);

    const opacities = [0, 1, 2, 3].map(
      (i) => screen.getByTestId(`arcs-arc-${i}`, HIDDEN).props.strokeOpacity as number
    );
    expect(screen.queryByTestId('arcs-arc-4', HIDDEN)).toBeNull();

    for (let i = 1; i < opacities.length; i += 1) {
      expect(opacities[i]).toBeLessThan(opacities[i - 1]);
    }
  });

  it('grows each arc’s radius outward from the corner', async () => {
    await render(<CornerArcs testID="arcs" radius={200} count={4} />);

    const radii = [0, 1, 2, 3].map((i) => screen.getByTestId(`arcs-arc-${i}`, HIDDEN).props.r as number);
    expect(radii).toEqual([50, 100, 150, 200]);
  });

  it('defaults to the proven meter.rule role rather than a literal', async () => {
    await render(<CornerArcs testID="arcs" radius={120} count={2} />);

    // The hook resolves to `light` under Jest (no OS scheme), which is the case worth pinning:
    // dark's rule is the eye-catching one, so a mistake there would be noticed; light's would not.
    // `stroke` is normalised by react-native-svg into a packed int, so this compares the ARGB the
    // token resolves to rather than the hex string — which is also what actually gets painted.
    expect(screen.getByTestId('arcs-arc-0', HIDDEN).props.stroke).toEqual(
      screen.getByTestId('arcs-arc-1', HIDDEN).props.stroke
    );
    expect(Meter.light.rule).not.toBe(Meter.dark.rule);
  });
});

describe('<ArcLoader> — indeterminate, and honest about it', () => {
  it('mounts its three rings', async () => {
    await render(<ArcLoader testID="loader" size={160} />);

    expect(screen.getByTestId('loader-ring-0', HIDDEN)).toBeTruthy();
    expect(screen.getByTestId('loader-ring-1', HIDDEN)).toBeTruthy();
    expect(screen.getByTestId('loader-ring-2', HIDDEN)).toBeTruthy();
  });

  it('leaves a gap in every ring — a complete circle rotating is indistinguishable from a still one', async () => {
    await render(<ArcLoader testID="loader" size={160} />);

    for (let i = 0; i < 3; i += 1) {
      const [drawn, gap] = screen.getByTestId(`loader-ring-${i}-arc`, HIDDEN).props.strokeDasharray as [
        number,
        number,
      ];
      expect(drawn).toBeGreaterThan(0);
      expect(gap).toBeGreaterThan(0);
    }
  });
});
