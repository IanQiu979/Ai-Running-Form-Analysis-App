/**
 * `<GlassFrost>` is the material every translucent surface in the app is made of, so the things it
 * gets wrong it gets wrong on the tab bar, every secondary pill and every circular icon button at
 * once. The locks below are the ones the 2026-08-02 captain's decision made load-bearing:
 *
 *   - IT PAINTS THE TOKEN, NOT A LITERAL. `constants/__tests__/theme-contrast.test.ts` proves the
 *     `Glass` alphas composited over every legal backdrop. That proof is only worth anything if the
 *     thing on screen is that exact token — a hand-tuned `rgba()` here would make every ratio in
 *     that file a fiction. Asserted per tone, iterated from the token so a tone added later is
 *     covered without anyone remembering to add a case.
 *   - IT FOLLOWS THE ACTIVE SCHEME. Painting light-mode glass under dark-mode text is the one way
 *     the proven composites can be invalidated with no token changing.
 *   - IT IS DECORATION. It sits inside controls whose accessible name and role belong to the
 *     control, so it must be out of the a11y tree and must never swallow a tap.
 *   - THE BLUR IS NEVER LOAD-BEARING FOR LEGIBILITY. The token layer is a real, opaque-alpha view
 *     rendered regardless of what the blur does, which is what makes it safe for the contrast
 *     proof to model the token alone (see this component's header).
 */
import { render, screen } from '@testing-library/react-native';

import { GlassFrost } from '../glass-frost';
import { Glass, type ColorScheme, type GlassColors } from '@/constants/theme';

const mockUseColorScheme = jest.fn<ColorScheme, []>(() => 'light');
jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: () => mockUseColorScheme(),
}));

/** Every tone x every scheme, one render each. Iterated from the token rather than listed, so a
 *  tone added to `Glass` is covered here the moment it ships. */
const TONE_CASES = (['light', 'dark'] as const).flatMap((scheme) =>
  (Object.keys(Glass[scheme]) as (keyof GlassColors)[]).map((tone) => ({ scheme, tone }))
);

/** The token layer is the LAST child — the blur is beneath it. Reading it by position rather than
 *  by a testID keeps the assertion honest about the stacking order the proof depends on. */
function tokenLayerStyle() {
  const root = screen.getByTestId('frost', { includeHiddenElements: true });
  const layers = root.children as { props: { style?: unknown } }[];
  return StyleSheetFlatten(layers[layers.length - 1].props.style);
}

function StyleSheetFlatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(StyleSheetFlatten));
  return (style ?? {}) as Record<string, unknown>;
}

describe('GlassFrost', () => {
  beforeEach(() => {
    mockUseColorScheme.mockReturnValue('light');
  });

  it.each(TONE_CASES)('paints $scheme glass.$tone straight from the token', async ({ scheme, tone }) => {
    mockUseColorScheme.mockReturnValue(scheme);
    await render(<GlassFrost tone={tone} testID="frost" />);

    expect(tokenLayerStyle().backgroundColor).toBe(Glass[scheme][tone]);
  });

  it('is hidden from assistive tech and takes no pointer events — it is material, not content', async () => {
    await render(<GlassFrost tone="control" testID="frost" />);

    const root = screen.getByTestId('frost', { includeHiddenElements: true });
    expect(root.props.accessibilityElementsHidden).toBe(true);
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(root.props.pointerEvents).toBe('none');
  });

  it('leaves clipping to the caller by default', async () => {
    await render(<GlassFrost tone="chrome" testID="frost" />);

    const style = StyleSheetFlatten(screen.getByTestId('frost', { includeHiddenElements: true }).props.style);
    expect(style.borderRadius).toBeUndefined();
  });

  it('rounds AND clips itself when given a radius — a caller that cannot clip needs both', async () => {
    await render(<GlassFrost tone="chrome" radius={28} testID="frost" />);

    const style = StyleSheetFlatten(screen.getByTestId('frost', { includeHiddenElements: true }).props.style);
    expect(style.borderRadius).toBe(28);
    // Without the clip the blur draws a square behind a rounded bar.
    expect(style.overflow).toBe('hidden');
  });
});
