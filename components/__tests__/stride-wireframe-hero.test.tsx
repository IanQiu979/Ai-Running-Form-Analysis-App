/**
 * <StrideWireframeHero /> — structural locks. Reanimated animations do not advance under Jest
 * here (CLAUDE.md § Testing), so nothing below asserts that the loop ran; what is provable, and
 * what actually regresses, is WHICH tree each mode mounts and what its first frame is:
 *
 *   1. IT IS DECORATION AND STAYS OUT OF THE A11Y TREE by default — and becomes a labelled image
 *      only when the caller asks for one.
 *   2. IT IS CYAN ON NEAR-BLACK REGARDLESS OF COLOUR SCHEME. The brief's one bold moment; a
 *      themed background here would be the whole point lost.
 *   3. REDUCED MOTION MOUNTS THE STILL TREE: plain paths at `REST_PHASE`, no animated nodes, no
 *      trails, a static knee angle — and it still renders the figure at real geometry.
 *   4. ANIMATED MODE MOUNTS THE LOOP TREE, whose first painted frame is that same still pose, so
 *      the two modes can never disagree about what the hero looks like at rest.
 *   5. THE LAYER SWITCHES DO WHAT THEY SAY (`chrome`, `trails`, `readouts`).
 *   6. IT RENDERS NOTHING UNTIL MEASURED — it sizes itself to its box, so a zero-size layout must
 *      not mount an SVG at 0x0 that then never remeasures.
 */
import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet, processColor } from 'react-native';

import {
  STRIDE_WIREFRAME_PALETTE,
  StrideWireframeHero,
  computeViewBox,
  computeStageLayout,
  frameFor,
  rulerScaleFor,
  RULER_SCALE_MAX,
  FRAME,
  cycleDurationMs,
} from '../stride-wireframe-hero';
import { FIGURE_EXTENT, GROUND_Y, REST_PHASE, strideLayers } from '@/lib/stride-wireframe';

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

const mockUseColorScheme = jest.fn<'light' | 'dark', []>(() => 'light');
jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: () => mockUseColorScheme(),
}));

const HIDDEN = { includeHiddenElements: true } as const;

/** `react-native-svg` hands its host view a processed colour, not the string it was given. */
const svgColor = (hex: string) => ({ type: 0, payload: processColor(hex) });

/** Lay the hero out at a size, the way the host's layout pass would. */
async function layout(width = 300, height = 400) {
  const node = screen.getByTestId('hero', HIDDEN);
  await act(async () => {
    node.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height } } });
  });
}

beforeEach(() => {
  mockUseReducedMotion.mockReturnValue(false);
  mockUseColorScheme.mockReturnValue('light');
});

describe('accessibility', () => {
  it('is hidden from assistive tech by default', async () => {
    await render(<StrideWireframeHero testID="hero" />);
    const node = screen.getByTestId('hero', HIDDEN);
    expect(node.props.accessibilityElementsHidden).toBe(true);
    expect(node.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('becomes a labelled image when the caller provides a label', async () => {
    await render(<StrideWireframeHero testID="hero" accessibilityLabel="A runner's stride, as a wireframe" />);
    const node = screen.getByTestId('hero');
    expect(node.props.accessibilityRole).toBe('image');
    expect(node.props.accessibilityLabel).toBe("A runner's stride, as a wireframe");
    expect(node.props.accessibilityElementsHidden).toBeUndefined();
  });
});

describe('palette', () => {
  it.each(['light', 'dark'] as const)('paints the pinned near-black in %s mode', async (scheme) => {
    mockUseColorScheme.mockReturnValue(scheme);
    await render(<StrideWireframeHero testID="hero" />);
    const style = StyleSheet.flatten(screen.getByTestId('hero', HIDDEN).props.style);
    expect(style.backgroundColor).toBe(STRIDE_WIREFRAME_PALETTE.background);
  });

  it('draws in the pinned icy cyan', async () => {
    await render(<StrideWireframeHero testID="hero" />);
    await layout();
    expect(screen.getByTestId('hero-near', HIDDEN).props.stroke).toEqual(svgColor(STRIDE_WIREFRAME_PALETTE.line));
  });

  it('lets a caller pass tokens for both colours instead', async () => {
    await render(<StrideWireframeHero testID="hero" lineColor="#123456" backgroundColor="#654321" />);
    await layout();
    expect(screen.getByTestId('hero-near', HIDDEN).props.stroke).toEqual(svgColor('#123456'));
    expect(StyleSheet.flatten(screen.getByTestId('hero', HIDDEN).props.style).backgroundColor).toBe('#654321');
  });
});

describe('sizing', () => {
  it('renders nothing inside until it has been measured', async () => {
    await render(<StrideWireframeHero testID="hero" />);
    expect(screen.queryByTestId('hero-near', HIDDEN)).toBeNull();
    await layout(0, 0);
    expect(screen.queryByTestId('hero-near', HIDDEN)).toBeNull();
    await layout();
    expect(screen.getByTestId('hero-near', HIDDEN)).toBeTruthy();
  });

  it('computes a viewBox that frames the figure’s own extent, reserves room for the ruler, and extends along the longer axis', () => {
    // The frame is the runner's derived reach (not the nominal 0-100 box) plus the ruler and
    // its captions hanging below the ground. Whatever the box, all of it must fit — the wide
    // case is the one that clipped the ruler.
    const tall = computeViewBox(200, 400, 4);
    expect(tall.w).toBeCloseTo(FRAME.w + 8, 8);
    expect(tall.h).toBeCloseTo(tall.w * 2, 8);
    expect(tall.x + tall.w / 2).toBeCloseTo(FRAME.cx, 8);
    expect(tall.y).toBeLessThanOrEqual(FRAME.y0 - 4);
    expect(tall.y + tall.h).toBeGreaterThan(GROUND_Y * 100 + 14);
    const wide = computeViewBox(400, 200, 4);
    expect(wide.h).toBeCloseTo(FRAME.h + 8, 8);
    expect(wide.y).toBeCloseTo(FRAME.y0 - 4, 8);
    expect(wide.y + wide.h).toBeGreaterThan(GROUND_Y * 100 + 14);
    expect(wide.w / wide.h).toBeCloseTo(2, 8);
    expect(wide.x + wide.w / 2).toBeCloseTo(FRAME.cx, 8);
    // The frame is derived from the gait: it hugs the figure rather than the nominal box.
    expect(FRAME.x0).toBeGreaterThan(0);
    expect(FRAME.x1).toBeLessThan(100);
    expect(FRAME.y0).toBeGreaterThan(0);
  });

  // Boxes the hero is really asked for: the shipped sign-in frame (full width on a 393pt device,
  // 8:5), the two the viewBox test uses, and two extremes on either axis.
  const BOXES: readonly (readonly [number, number])[] = [
    [345, 215.6],
    [200, 400],
    [400, 200],
    [600, 150],
    [120, 160],
  ];

  // Boxes too short for the floor to be reachable at all: the ruler scale would have to run away
  // to hundreds or thousands, so these are the cases the cap and the caption drop exist for.
  const SHORT_BOXES: readonly (readonly [number, number])[] = [
    [400, 70],
    [800, 60],
    [300, 50],
  ];

  it('never renders a ruler caption below the 9pt floor the knee readout already uses', () => {
    // LABEL_SIZE is in viewBox units, so the same nominal size is a different point size in every
    // box; at the sign-in frame it lands near 5pt, which reads as a smudge, not an instrument.
    for (const [w, h] of BOXES) {
      const { vb, ruler } = computeStageLayout(w, h, 4);
      const pointsPerUnit = w / vb.w;
      expect(ruler.labels).toBe(true);
      expect(ruler.label * pointsPerUnit).toBeGreaterThanOrEqual(9 - 1e-6);
      expect(ruler.tick * pointsPerUnit).toBeGreaterThan(4);
    }
  });

  it('drops the captions rather than let them outgrow the runner, for every aspect', () => {
    for (const [w, h] of [...BOXES, ...SHORT_BOXES]) {
      const { vb, ruler } = computeStageLayout(w, h, 4);
      const scale = ruler.label / 2.4;
      // The scale stays inside its clamp, so the frame — and the grid built from it — stays sane.
      expect(scale).toBeGreaterThanOrEqual(1);
      expect(scale).toBeLessThanOrEqual(RULER_SCALE_MAX + 1e-9);
      // The ruler stays an annotation: never more than a seventh of the figure's own height.
      expect(ruler.label).toBeLessThan(((GROUND_Y - FIGURE_EXTENT.top) * 100) / 7);
      // A caption is either legible or absent — never rendered under the floor.
      const labelPt = (ruler.label * w) / vb.w;
      expect(ruler.labels).toBe(labelPt >= 9 - 1e-6);
      // And the layout is a true fixed point, not the last iterate of a runaway loop.
      expect(rulerScaleFor(vb.w / w)).toBeCloseTo(scale, 8);
      expect(computeViewBox(w, h, 4, frameFor(scale))).toEqual(vb);
    }
  });

  it('leaves the short boxes without captions and with the figure still framed', () => {
    for (const [w, h] of SHORT_BOXES) {
      const { vb, ruler } = computeStageLayout(w, h, 4);
      expect(ruler.labels).toBe(false);
      // The runner still fills the frame's short axis rather than collapsing to a dot.
      expect(vb.h).toBeLessThanOrEqual(frameFor(RULER_SCALE_MAX).h + 8 + 1e-9);
      // The ruler line and its ticks stay — only the captions yield.
      expect(ruler.tick).toBeGreaterThan(0);
    }
  });

  it('omits the ruler captions from the rendered tree when they cannot be legible', async () => {
    await render(<StrideWireframeHero testID="hero" />);
    await layout(345, 215.6);
    expect(screen.getByTestId('hero-ruler-labels', HIDDEN)).toBeTruthy();
    await layout(300, 50);
    expect(screen.queryByTestId('hero-ruler-labels', HIDDEN)).toBeNull();
    expect(screen.getByTestId('hero-cursor', HIDDEN)).toBeTruthy();
  });

  it('leaves a hero big enough not to need the floor exactly as authored', () => {
    const big = computeStageLayout(900, 1200, 4);
    expect(big.ruler.label).toBeCloseTo(2.4, 8);
    expect(big.ruler.majorTick).toBeCloseTo(2.5, 8);
    expect(big.vb).toEqual(computeViewBox(900, 1200, 4));
  });

  it('reserves room for a floored ruler, so its captions never fall outside the viewBox', () => {
    for (const [w, h] of BOXES) {
      const { vb, ruler } = computeStageLayout(w, h, 4);
      // Baseline plus a generous descender for the lowest caption row (IC / TO).
      expect(ruler.labelY + ruler.label * 0.3).toBeLessThanOrEqual(vb.y + vb.h);
      // And the row above the ruler stays clear of the ground line it hangs under.
      expect(ruler.y - ruler.cursor - 1.2 - ruler.label).toBeGreaterThan(GROUND_Y * 100);
    }
  });

  it('derives the cycle length from cadence and playback rate', () => {
    // 176 spm: one cycle (two steps) is 682ms; at half speed, 1364ms.
    expect(cycleDurationMs(176, 1)).toBeCloseTo(681.8, 1);
    expect(cycleDurationMs(176, 0.5)).toBeCloseTo(1363.6, 1);
  });
});

describe('reduced motion — the still tree', () => {
  beforeEach(() => mockUseReducedMotion.mockReturnValue(true));

  it('mounts the still tree: plain paths at REST_PHASE, no loop, no trails', async () => {
    await render(<StrideWireframeHero testID="hero" />);
    await layout();
    expect(screen.getByTestId('hero-still', HIDDEN)).toBeTruthy();
    expect(screen.queryByTestId('hero-loop', HIDDEN)).toBeNull();
    const still = strideLayers(REST_PHASE);
    for (const [id, d] of [
      ['near', still.near],
      ['far', still.far],
      ['core', still.core],
      ['near-markers', still.nearMarkers],
      ['far-markers', still.farMarkers],
      ['readout', still.readout],
    ] as const) {
      expect(screen.getByTestId(`hero-${id}`, HIDDEN).props.d).toBe(d);
    }
    expect(screen.queryByTestId('hero-trail-0', HIDDEN)).toBeNull();
    expect(screen.queryByTestId('hero-trail-1', HIDDEN)).toBeNull();
  });

  it('shows the still frame’s knee angle as plain text', async () => {
    await render(<StrideWireframeHero testID="hero" />);
    await layout();
    const node = screen.getByTestId('hero-knee-angle', HIDDEN);
    expect(node.props.editable).toBeUndefined();
    expect(node.props.children).toMatch(/^\d+°$/);
  });

  it('parks the ruler cursor at the still phase', async () => {
    await render(<StrideWireframeHero testID="hero" />);
    await layout();
    const cursorX = Number((screen.getByTestId('hero-cursor', HIDDEN).props.d as string).match(/^M(-?[\d.]+)/)?.[1]);
    // The ruler spans the figure's derived reach; the cursor sits REST_PHASE of the way along it.
    const x0 = Math.round(FIGURE_EXTENT.x0 * 100);
    const x1 = Math.round(FIGURE_EXTENT.x1 * 100);
    expect(cursorX).toBeCloseTo(x0 + (x1 - x0) * REST_PHASE, 1);
  });
});

describe('animated — the loop tree', () => {
  it('mounts the loop tree, whose first frame is the same still pose', async () => {
    await render(<StrideWireframeHero testID="hero" />);
    await layout();
    expect(screen.getByTestId('hero-loop', HIDDEN)).toBeTruthy();
    expect(screen.queryByTestId('hero-still', HIDDEN)).toBeNull();
    const still = strideLayers(REST_PHASE);
    for (const [id, d] of [
      ['near', still.near],
      ['far', still.far],
      ['core', still.core],
      ['readout', still.readout],
    ] as const) {
      expect(screen.getByTestId(`hero-${id}`, HIDDEN).props.d).toBe(d);
    }
    // The ghosts trail the live frame, so their first frame is the pose just BEFORE the still.
    expect(screen.getByTestId('hero-trail-0', HIDDEN).props.d).toBe(strideLayers(REST_PHASE - 0.05).nearLeg);
    expect(screen.getByTestId('hero-trail-1', HIDDEN).props.d).toBe(strideLayers(REST_PHASE - 0.1).nearLeg);
    expect(screen.getByTestId('hero-cursor', HIDDEN)).toBeTruthy();
    expect(screen.getByTestId('hero-ground-dashes', HIDDEN)).toBeTruthy();
  });

  it('drives the knee angle through a disabled text input, never a real one', async () => {
    await render(<StrideWireframeHero testID="hero" />);
    await layout();
    const node = screen.getByTestId('hero-knee-angle', HIDDEN);
    expect(node.props.editable).toBe(false);
    expect(node.props.defaultValue).toMatch(/^\d+°$/);
  });

  it('draws the trails behind the figure, dimmer than the far side', async () => {
    await render(<StrideWireframeHero testID="hero" />);
    await layout();
    const far = screen.getByTestId('hero-far', HIDDEN).props.strokeOpacity as number;
    const t0 = screen.getByTestId('hero-trail-0', HIDDEN).props.strokeOpacity as number;
    const t1 = screen.getByTestId('hero-trail-1', HIDDEN).props.strokeOpacity as number;
    expect(t0).toBeLessThan(far);
    expect(t1).toBeLessThan(t0);
  });
});

describe('layer switches', () => {
  it('chrome={false} drops the ground, ruler and cursor', async () => {
    await render(<StrideWireframeHero testID="hero" chrome={false} />);
    await layout();
    expect(screen.queryByTestId('hero-ground-dashes', HIDDEN)).toBeNull();
    expect(screen.queryByTestId('hero-cursor', HIDDEN)).toBeNull();
    expect(screen.getByTestId('hero-near', HIDDEN)).toBeTruthy();
  });

  it('trails={false} drops the ghosts', async () => {
    await render(<StrideWireframeHero testID="hero" trails={false} />);
    await layout();
    expect(screen.queryByTestId('hero-trail-0', HIDDEN)).toBeNull();
  });

  it('readouts={false} drops the knee arc and the live angle', async () => {
    await render(<StrideWireframeHero testID="hero" readouts={false} />);
    await layout();
    expect(screen.queryByTestId('hero-readout', HIDDEN)).toBeNull();
    expect(screen.queryByTestId('hero-knee-angle', HIDDEN)).toBeNull();
  });
});
