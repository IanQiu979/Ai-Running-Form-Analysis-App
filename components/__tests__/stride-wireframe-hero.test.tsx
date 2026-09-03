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
  cycleDurationMs,
} from '../stride-wireframe-hero';
import { GROUND_Y, REST_PHASE, strideLayers } from '@/lib/stride-wireframe';

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

  it('computes a viewBox that keeps the figure centred, reserves room for the ruler, and extends along the longer axis', () => {
    // The content is 100 wide and taller than 100: the ruler and its captions hang below the
    // ground. Whatever the box, both must fit — the wide case is the one that clipped the ruler.
    const tall = computeViewBox(200, 400, 4);
    expect(tall.w).toBe(108);
    expect(tall.h).toBeCloseTo(216, 8);
    expect(tall.x).toBe(-4);
    expect(tall.y + tall.h).toBeGreaterThan(GROUND_Y * 100 + 14);
    const wide = computeViewBox(400, 200, 4);
    expect(wide.y).toBe(-4);
    expect(wide.y + wide.h).toBeGreaterThan(GROUND_Y * 100 + 14);
    expect(wide.w / wide.h).toBeCloseTo(2, 8);
    expect(wide.x).toBeCloseTo(-(wide.w - 100) / 2, 8);
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
    // The ruler spans x=20..80; the cursor sits REST_PHASE of the way along it.
    expect(cursorX).toBeCloseTo(20 + 60 * REST_PHASE, 1);
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
