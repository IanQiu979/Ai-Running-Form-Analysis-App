/**
 * V2.3 design tokens — "The Gait Plate" (distinct-but-related to V2.2's "Instrument & Matter").
 *
 * Source of truth: `docs/design/frontend-design-brief.md` §2. Every value below is either lifted
 * verbatim from the brief, or — where §2 explicitly requires WCAG AA verification and the
 * intent value failed — computed here to the target ratio, following the same rule V2.2 used:
 * same hue/saturation family, only lightness moved until the target contrast cleared. Every
 * adjustment is commented at its token and proven (not just asserted) in
 * `constants/__tests__/theme-contrast.test.ts`, which computes ratios from these exact exports.
 *
 * Naming is by role ("text.secondary", "score.mid.fill"), never by appearance ("gray600" or
 * "amber"), so a rebrand only ever touches a value, never a call site. No hardcoded colors,
 * spacing, radii, or fonts belong in components — import from here (CLAUDE.md § Code
 * conventions).
 */

import { Platform } from 'react-native';

export type ColorScheme = 'light' | 'dark';

// -------------------------------------------------------------------------------------------
// Base — brief §2 "Base (warm neutral, distinct from V2.2's cool set)".
//
// The brief gives dark `background` as "#17150F… slate-warm ~#1A1712" (a described range, not
// one hex); resolved to #1A1712, the value it names explicitly.
//
// Every text/surface pair below clears AA with wide margin (6.6:1+ — see the contrast test), so
// none needed adjustment. `hairline` is a decorative/structural rule (dividers, ticks, and the
// annotation lines drawn over a captured frame) — not text and not a UI-component boundary — so
// WCAG 1.4.11 non-text contrast does not apply to it. V2.2 gave its own hairline the same
// treatment (an even-lower-contrast rgba overlay); left at the brief's intent value, unchanged.
// -------------------------------------------------------------------------------------------

export const Colors = {
  light: {
    background: '#F4F1EA', // bone
    surface: {
      base: '#FBF9F3', // cards, sheets
      raised: '#FFFFFF', // the one raised element per screen
    },
    text: {
      primary: '#1E1B15', // headlines, scores — 15.22:1 on background, 17.17:1 on surface.raised
      secondary: '#5A5347', // labels, captions — 6.74:1 on background, 7.60:1 on surface.raised
    },
    hairline: '#DAD3C4', // rules, ticks, annotations — decorative, see note above
  },
  dark: {
    background: '#1A1712',
    surface: {
      base: '#221E17',
      raised: '#2B2620',
    },
    text: {
      primary: '#F3EEE3', // 15.44:1 on background, 12.96:1 on surface.raised
      secondary: '#B3AC9C', // 7.91:1 on background, 6.64:1 on surface.raised
    },
    hairline: '#3A342A',
  },
} as const;

export type ThemeColors = (typeof Colors)[ColorScheme];

// -------------------------------------------------------------------------------------------
// The score scale — brief §2 "The score scale" + §7 "The score hues especially — they carry
// meaning, so they must clear 3:1 as non-text and their band text 4.5:1."
//
// Each band carries two roles, not one hue, because a color needs its full ramp: a bar fill and
// colored text on the same background are different lightnesses of the same hue.
//   - `fill` — the bar/progress color (brief §3: "bar: fill LENGTH and COLOR both encode the
//     score") and any decorative swatch. A non-text graphic that carries meaning, so >=3:1
//     against both `background` and `surface.base`.
//   - `text` — the color when a band word or numeral is rendered IN the score hue (e.g. a
//     colored "Solid" label). Text, so >=4.5:1 against both `background` and `surface.base`.
// A colored band chip (e.g. Past Analyses' band badge) is built from a neutral
// `surface.raised` pill + the `text` role for its label + `hairline` for its border — never
// colored text directly on a solid colored fill, a pairing this scale does not promise to pass
// (proven, not assumed: see the "fill as a solid chip background" note in the contrast test).
// This also matches the family's flat, hairline-structured aesthetic better than a saturated
// filled badge would.
//
// Every value's contrast is computed and asserted in theme-contrast.test.ts. Adjustments below
// (brief intent -> shipped value) are the minimal lightness move, same hue/saturation, needed to
// clear the threshold for that role:
// -------------------------------------------------------------------------------------------

export type ScoreBand = 'low' | 'mid' | 'good' | 'strong';

export const ScoreBandOrder: readonly ScoreBand[] = ['low', 'mid', 'good', 'strong'];

export const ScoreBandLabel: Record<ScoreBand, string> = {
  low: 'Needs work',
  mid: 'Developing',
  good: 'Solid',
  strong: 'Strong',
};

export const ScoreBandRange: Record<ScoreBand, readonly [number, number]> = {
  low: [0, 49],
  mid: [50, 69],
  good: [70, 84],
  strong: [85, 100],
};

export const Score: Record<
  ScoreBand,
  { light: { fill: string; text: string }; dark: { fill: string; text: string } }
> = {
  low: {
    // fill: intent #C2603F unchanged — already 3.69:1 (bg) / 3.96:1 (surface.base), clears 3:1.
    // text: intent #C2603F fails 4.5:1 (3.69:1 bg). Darkened to #AC5437 -> 4.57:1 (bg) / 4.89:1
    // (surface.base) / 5.15:1 (surface.raised).
    light: { fill: '#C2603F', text: '#AC5437' },
    // fill: intent #C2603F unchanged — already 4.29:1 (bg) / 3.98:1 (surface.base), clears 3:1.
    // text: intent #C2603F fails 4.5:1 against every dark surface, worst at surface.raised
    // (4.12:1 — surface.raised is dark mode's *lightest* surface, so it's the binding
    // constraint for a light-tinted foreground). Lightened to #CB785B -> 5.43:1 (bg) / 5.04:1
    // (surface.base) / 4.55:1 (surface.raised).
    dark: { fill: '#C2603F', text: '#CB785B' },
  },
  mid: {
    // fill: intent #C08A2E fails 3:1 (2.69:1 bg / 2.88:1 surface.base). Darkened to #B3812B ->
    // 3.06:1 / 3.27:1. text: darkened further to #8F6622 -> 4.55:1 (bg) / 4.87:1 (surface.base)
    // / 5.13:1 (surface.raised).
    light: { fill: '#B3812B', text: '#8F6622' },
    // Both roles: intent #C08A2E unchanged — already 5.88:1 (bg) / 5.46:1 (surface.base) /
    // 4.94:1 (surface.raised), clears both the 3:1 fill floor and the 4.5:1 text floor as-is.
    dark: { fill: '#C08A2E', text: '#C08A2E' },
  },
  good: {
    // fill: intent #4E9A7C fails 3:1 (2.98:1 bg / 3.20:1 surface.base). Darkened to #4D987B ->
    // 3.06:1 / 3.27:1. text: darkened further to #3D7861 -> 4.59:1 (bg) / 4.92:1 (surface.base)
    // / 5.18:1 (surface.raised).
    light: { fill: '#4D987B', text: '#3D7861' },
    // fill: intent #4E9A7C unchanged — already 5.31:1 (bg) / 4.93:1 (surface.base), clears 3:1.
    // text: intent #4E9A7C fails 4.5:1 against surface.raised specifically (4.45:1 — dark
    // mode's lightest surface is again the binding constraint). Lightened to #4F9C7D -> 5.43:1
    // (bg) / 5.04:1 (surface.base) / 4.56:1 (surface.raised).
    dark: { fill: '#4E9A7C', text: '#4F9C7D' },
  },
  strong: {
    // fill: intent #2E7D5B unchanged — already 4.43:1 (bg) / 4.75:1 (surface.base), clears 3:1.
    // text: intent #2E7D5B fails 4.5:1 by a hair against bg (4.43:1). Nudged darker to #2D7B59
    // -> 4.55:1 (bg) / 4.88:1 (surface.base) / 5.14:1 (surface.raised).
    light: { fill: '#2E7D5B', text: '#2D7B59' },
    // fill: intent #2E7D5B unchanged — already 3.57:1 (bg) / 3.32:1 (surface.base), clears 3:1.
    // text: intent #2E7D5B fails 4.5:1 against every dark surface, worst at surface.raised
    // (4.15:1). Lightened to #3A9F73 -> 5.43:1 (bg) / 5.04:1 (surface.base) / 4.56:1
    // (surface.raised).
    dark: { fill: '#2E7D5B', text: '#3A9F73' },
  },
} as const;

// -------------------------------------------------------------------------------------------
// Semantic roles — not in the brief (it predates this need); added for issue #24. Until now,
// `app/(auth)/sign-in.tsx` painted auth errors with `Score.low[scheme].text`, the "Needs work"
// SCORE-BAND hue — a defensible stopgap (a token, not a hardcoded hex) but semantically wrong,
// and actively confusing on the M6 Result screen where a low pillar score and a system error
// would otherwise read as the same colour with different meanings, in an app whose product IS
// colour-coded scoring. `error` is therefore a distinct hue family from `score.low`, not just a
// different lightness of it: a true/cool crimson (hue ~350°, i.e. past pure red toward magenta)
// vs. score.low's clay red-orange (hue ~15°, leaning toward amber) — a ~335° hue separation, so
// the two cannot be mistaken for each other even color-blind-adjacent. Saturation (~53%) stays
// in the same muted family every other token here uses — no generic, fully-saturated Material
// red (e.g. #F44336, sat ~90%) — to match the palette's restrained, "caution not alarm" register
// (brief §2's line for score.low applies just as well to a system error: this app doesn't scold).
//
// Same hue/saturation family across both themes, only lightness moved, exactly like the score
// bands: intent #C23B52 (hue 349.8°, sat 53.4%, L 49.6%) already clears 4.5:1 against every light
// surface unchanged -> 4.61:1 (bg) / 4.94:1 (surface.base) / 5.20:1 (surface.raised). That same
// value fails badly in dark mode (a mid-tone color has too little contrast against a near-black
// background) so, per the file's established method, lightened along the same hue/sat to #D47383
// (hue 350.1°, sat 53.0%, L 64.1%) -> 5.60:1 (bg) / 5.20:1 (surface.base) / 4.70:1
// (surface.raised) — surface.raised is dark mode's *lightest* surface, so again the binding
// constraint for a light-tinted foreground, cleared with real margin rather than shaved to the
// wire.
//
// `error` is a foreground/text role only (parallel to `text.primary`/`text.secondary` and each
// score band's `text`), proven as text (>=4.5:1) against all three surfaces in both themes below
// — see theme-contrast.test.ts. No non-text `fill` role is defined: nothing today paints a solid
// error-colored graphic (bar, chip fill) the way the score scale does, so adding one would be an
// unproven, speculative token. `success`/`warning` roles are deliberately NOT added here either —
// no screen in this codebase has a real near-term consumer for either (grepped: none), and this
// file's own rule is to prove AA before shipping a token, not get ahead of a need. Add them, with
// their own proof, when a real consumer shows up.
// -------------------------------------------------------------------------------------------

export type SemanticRole = 'error';

export const Semantic: Record<SemanticRole, { light: string; dark: string }> = {
  error: {
    light: '#C23B52',
    dark: '#D47383',
  },
} as const;

// -------------------------------------------------------------------------------------------
// The accent — brief §2 "One accent (reserved, single-use)". Theme-invariant: the CTA reads the
// same whether the screen is light or dark, so — like V2.2's `Accent` — it is never nested
// under `Colors`. Intent value #2F6BEB unchanged: it clears every pair it's used in (white CTA
// label on accent 4.75:1 text; accent as a non-text button/tint boundary on every background/
// surface in both themes, 3.49:1-4.51:1) — see theme-contrast.test.ts.
// -------------------------------------------------------------------------------------------

export const Accent = {
  /** The primary CTA, and only the primary CTA — never a score, never decoration. */
  value: '#2F6BEB',
  /** The only legal label color on an accent fill. */
  onAccent: '#FFFFFF',
} as const;

// -------------------------------------------------------------------------------------------
// Type — brief §2 "Type". Three families, each isolated to its role: Archivo (grotesque) for
// display/numerals — distinct from V2.2's Barlow Condensed; Inter for body/UI, shared with the
// family; IBM Plex Mono for measured readouts, the "instrument" signal carried over from V2.2.
// Installed via `npx expo install @expo-google-fonts/archivo @expo-google-fonts/inter
// @expo-google-fonts/ibm-plex-mono expo-font` — not yet wired into `app/_layout.tsx` (that's a
// frontend-builder task); these are the family/weight name exports it will call `useFonts` with.
// -------------------------------------------------------------------------------------------

export const FontFamily = {
  /** Screen titles and the big score numerals. */
  display: {
    regular: 'Archivo_400Regular',
    medium: 'Archivo_500Medium',
    semiBold: 'Archivo_600SemiBold',
    bold: 'Archivo_700Bold',
  },
  /** Body copy and UI chrome. */
  body: {
    regular: 'Inter_400Regular',
    medium: 'Inter_500Medium',
    semiBold: 'Inter_600SemiBold',
    bold: 'Inter_700Bold',
  },
  /** Measured score readouts and any pace/metric text. */
  mono: {
    regular: 'IBMPlexMono_400Regular',
    medium: 'IBMPlexMono_500Medium',
    semiBold: 'IBMPlexMono_600SemiBold',
  },
} as const;

/** The brief's six fixed steps: 32 / 24 / 20 / 17 / 15 / 13. Support Dynamic Type — never
 * hard-clip text at these sizes (brief §2). */
export const FontSize = {
  xs: 13,
  sm: 15,
  md: 17,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

// -------------------------------------------------------------------------------------------
// Spacing / radius — brief §2 "Spacing / radius / motion".
// -------------------------------------------------------------------------------------------

/** The brief's ramp: 4 · 8 · 12 · 16 · 24 · 32 · 48. */
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const Radius = {
  /** Cards. */
  card: 8,
  /** Sheets, modals. */
  sheet: 12,
  /** Pills, chips. */
  pill: 999,
} as const;

// -------------------------------------------------------------------------------------------
// Control sizing / opacity — not part of the brief's explicit spacing/radius ramp, but these
// exact dimensions repeat verbatim across screens (sign-in's buttons/inputs, Home's CTA and
// sign-out link), so CLAUDE.md's "theme tokens only" rule applies just the same: name them
// once here instead of hardcoding the literal at each call site.
// -------------------------------------------------------------------------------------------

export const ControlHeight = {
  /** Buttons and text inputs — sign-in screen's fields/CTAs, Home's primary CTA. */
  standard: 52,
} as const;

export const ControlWidth = {
  /** Home's primary CTA minimum width. */
  primaryButton: 220,
} as const;

export const HitTarget = {
  /** Minimum tappable square for a text-only/icon-only control (e.g. Home's Sign out link). */
  min: 44,
} as const;

export const CheckboxSize = {
  /** The drawn box. The tappable row around it is `HitTarget.min` — the box itself is smaller
   *  than 44pt on purpose; it is the ROW that must meet the target, not the glyph. */
  box: 24,
  border: 2,
} as const;

export const Opacity = {
  /** A disabled control (e.g. Home's primary CTA before capture is wired up). */
  disabled: 0.4,
  /** A pressed/busy control's dimmed state. */
  pressed: 0.6,
} as const;

// -------------------------------------------------------------------------------------------
// Motion — brief §2 + §6 "Motion (light, honest)". Durations distinct from V2.2's
// (160/240/320 vs V2.2's 180/250/350). Curves: ease-out for anything arriving, ease-in for
// anything leaving. One spring, reserved for the score-reveal settle (§6: "one spring settle").
// -------------------------------------------------------------------------------------------

export const Motion = {
  duration: {
    quick: 160,
    standard: 240,
    slow: 320,
  },
  curve: {
    /** Anything arriving. Cubic-bezier control points. */
    easeOut: [0, 0, 0.2, 1],
    /** Anything leaving. */
    easeIn: [0.4, 0, 1, 1],
  },
  spring: {
    /** The result reveal's one spring settle (brief §6) — a crisp, single overshoot, not a
     * bounce. Not brief-specified as an exact damping ratio; chosen consistent with V2.2's
     * "gentle" (0.85) family precedent, slightly snappier since it caps a count-up, not an
     * arrival. Revisit if motion-animation's implementation wants a different feel. */
    reveal: { dampingRatio: 0.8 },
  },
} as const;

// -------------------------------------------------------------------------------------------
// Platform system-font fallback — used only until the brief's fonts (above) are loaded via
// `useFonts` (e.g. a first-paint frame, or if loading fails). Unrelated to the design system's
// type roles; do not use for anything the brief names a family for.
// -------------------------------------------------------------------------------------------

export const SystemFont = Platform.select({
  ios: 'system-ui',
  android: 'sans-serif',
  default: 'system-ui',
}) as string;
