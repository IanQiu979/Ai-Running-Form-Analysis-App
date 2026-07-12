/**
 * Proves — not just asserts — that every foreground/background pair `theme.ts` permits clears
 * WCAG AA, computed from the actual exported tokens (not the brief's intent values). If a token
 * changes and a pair regresses, this fails the build; that's the point (brief §2: "Do not assume
 * these pass; prove it").
 *
 * Pairs covered, matching the brief's own accessibility floor (§7):
 *   - text.primary / text.secondary on every surface, both themes — normal text, >=4.5:1.
 *   - each score band's `fill` (the bar) on every surface, both themes — non-text graphic that
 *     carries meaning, >=3:1.
 *   - each score band's `text` (a band word/numeral rendered in the score hue) on every surface,
 *     both themes — text, >=4.5:1.
 *   - the accent: white CTA label on accent — text, >=4.5:1; accent itself on every surface —
 *     non-text button/tint boundary, >=3:1.
 *   - `Semantic.error` on every surface, both themes — text, >=4.5:1 (issue #24); also asserted
 *     distinct from `Score.low.text` in both themes, the issue's actual requirement — a system
 *     error must not be mistakable for the "Needs work" score band it used to borrow from.
 *
 * `hairline` is intentionally not asserted here — see the comment on it in theme.ts: it's a
 * decorative structural rule, not text or a UI-component boundary, so WCAG 1.4.11 does not apply.
 */

import { AA_NON_TEXT, AA_TEXT, contrastRatio } from '../contrast';
import { Accent, Colors, type ColorScheme, Score, ScoreBandOrder, Semantic } from '../theme';

const SCHEMES: readonly ColorScheme[] = ['light', 'dark'];

function surfacesFor(scheme: ColorScheme): readonly [string, string][] {
  const c = Colors[scheme];
  return [
    ['background', c.background],
    ['surface.base', c.surface.base],
    ['surface.raised', c.surface.raised],
  ];
}

type Pair = { label: string; fg: string; bg: string };

const textPairs: Pair[] = [];
const scoreFillPairs: Pair[] = [];
const scoreTextPairs: Pair[] = [];
const accentTextPairs: Pair[] = [];
const accentNonTextPairs: Pair[] = [];
const semanticErrorTextPairs: Pair[] = [];

for (const scheme of SCHEMES) {
  const c = Colors[scheme];
  const surfaces = surfacesFor(scheme);

  for (const [surfaceName, surfaceHex] of surfaces) {
    textPairs.push({ label: `${scheme} text.primary on ${surfaceName}`, fg: c.text.primary, bg: surfaceHex });
    textPairs.push({
      label: `${scheme} text.secondary on ${surfaceName}`,
      fg: c.text.secondary,
      bg: surfaceHex,
    });
    accentNonTextPairs.push({ label: `${scheme} accent on ${surfaceName}`, fg: Accent.value, bg: surfaceHex });
    semanticErrorTextPairs.push({
      label: `${scheme} semantic.error on ${surfaceName}`,
      fg: Semantic.error[scheme],
      bg: surfaceHex,
    });
  }

  for (const band of ScoreBandOrder) {
    const { fill, text } = Score[band][scheme];
    // fill is proven against background and surface.base — the bar sits on the app canvas or a
    // card, never the single "raised" element (brief §2's `surface.raised` is reserved for one
    // element per screen, not score rows).
    for (const [surfaceName, surfaceHex] of surfaces.filter(([name]) => name !== 'surface.raised')) {
      scoreFillPairs.push({ label: `${scheme} score.${band}.fill on ${surfaceName}`, fg: fill, bg: surfaceHex });
    }
    for (const [surfaceName, surfaceHex] of surfaces) {
      scoreTextPairs.push({ label: `${scheme} score.${band}.text on ${surfaceName}`, fg: text, bg: surfaceHex });
    }
  }
}

accentTextPairs.push({ label: 'onAccent (white) on accent', fg: Accent.onAccent, bg: Accent.value });

describe('theme contrast — text pairs clear AA (>=4.5:1)', () => {
  test.each(textPairs)('$label', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test.each(scoreTextPairs)('$label', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test.each(accentTextPairs)('$label', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test.each(semanticErrorTextPairs)('$label', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe('theme contrast — non-text pairs clear AA (>=3:1)', () => {
  test.each(scoreFillPairs)('$label', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  test.each(accentNonTextPairs)('$label', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

describe('semantic.error is not score.low — issue #24', () => {
  // The whole point of adding this token: a system error must not resolve to the same colour as
  // the "Needs work" score band, which the app used to borrow it from (see the comment on
  // `Semantic` in theme.ts). Asserted per-scheme, not just once, since the two tokens are
  // maintained independently and could drift back into collision in only one theme.
  test.each(SCHEMES)('%s: semantic.error !== score.low.text', (scheme) => {
    expect(Semantic.error[scheme]).not.toBe(Score.low[scheme].text);
  });
});

describe('contrast.ts sanity', () => {
  it('rates black on white as the maximum ratio', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });

  it('rates a color against itself as 1', () => {
    expect(contrastRatio('#2F6BEB', '#2F6BEB')).toBeCloseTo(1, 5);
  });
});
