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

/** WCAG 1.4.3 — normal text minimum. */
export const AA_TEXT = 4.5;

/** WCAG 1.4.11 — non-text/graphical objects required to understand content (e.g. a score bar
 * fill, a button boundary). Also the floor the brief accepts for large text. */
export const AA_NON_TEXT = 3;
