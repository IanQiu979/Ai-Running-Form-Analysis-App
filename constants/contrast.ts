/**
 * WCAG 2.x relative-luminance / contrast-ratio math.
 *
 * Exists to prove `theme.ts`'s foreground/background pairs clear AA before shipping — the
 * design brief (`docs/design/frontend-design-brief.md` §2, §7) requires this, not just asserts
 * it. Pure and framework-free (no React Native import) so `constants/__tests__/theme-contrast
 * .test.ts` can run it against the real exported tokens, and so any future contrast check
 * (e.g. an accessibility-reviewer pass) can reuse it without pulling in RN.
 */

export type Hex = string;

function hexToRgb(hex: Hex): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '');
  const value = parseInt(normalized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance: 0 (black) to 1 (white). */
export function relativeLuminance(hex: Hex): number {
  const { r, g, b } = hexToRgb(hex);
  return (
    0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b)
  );
}

/** WCAG contrast ratio between two colors: 1 (no contrast) to 21 (black on white). */
export function contrastRatio(a: Hex, b: Hex): number {
  const luminanceA = relativeLuminance(a);
  const luminanceB = relativeLuminance(b);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The colour's HUE in degrees (0-360), from the standard HSL conversion. A grey (max === min)
 * has no hue at all and returns `null` rather than a misleading 0 — "red" and "no colour" must
 * not be the same answer, because the whole point of the caller below is to measure how far apart
 * two hues are.
 *
 * Exists for the same reason `contrastRatio` does: `constants/theme.ts` makes a load-bearing claim
 * about hue separation (every chromatic role >=30 degrees from every other, so a score band can
 * never be mistaken for the accent or for its neighbour), and that claim was previously only
 * written in a comment. `theme-contrast.test.ts` now computes it.
 */
export function hue(hex: Hex): number | null {
  const { r, g, b } = hexToRgb(hex);
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  if (delta === 0) return null;
  const raw =
    max === rn ? (gn - bn) / delta + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / delta + 2 : (rn - gn) / delta + 4;
  return raw * 60;
}

/**
 * The shortest distance between two hues on the colour wheel, in degrees (0-180). Wrapping is the
 * whole point: 350 degrees and 10 degrees are 20 apart, not 340.
 */
export function hueSeparation(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** The palette's own floor for how close two CHROMATIC roles may sit. Not a WCAG number — WCAG has
 * nothing to say about hue — but the constraint `constants/theme.ts` has held across three
 * palettes, because two hues closer than roughly 20-25 degrees start to be confusable and a
 * scoring app whose bands blur into each other (or into its CTA) has lost the thing it sells. */
export const MIN_HUE_SEPARATION = 30;

/** WCAG 1.4.3 — normal text minimum. */
export const AA_TEXT = 4.5;

/** WCAG 1.4.11 — non-text/graphical objects required to understand content (e.g. a score bar
 * fill, a button boundary). Also the floor the brief accepts for large text. */
export const AA_NON_TEXT = 3;
