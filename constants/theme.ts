/**
 * V2.3 design tokens — "CADENCE ARCS" (2026-09-01), a warm espresso/clay system built on the
 * concentric-arc motif: ripples radiating from a footstrike.
 *
 * THIS IS A FULL VISUAL SYSTEM REPLACEMENT, not a recolor of the Calm scheme below it. What
 * changed, and every one of these is re-proven (not asserted) in
 * `constants/__tests__/theme-contrast.test.ts`:
 *
 *   - `Colors`, `Gradient`, `Glass`, `Score`, `Semantic`, `Accent` are all re-solved on an
 *     espresso base (`#17120E` ink) with a clay accent. The blue/violet Calm palette is gone.
 *   - `FontFamily` moves to Bricolage Grotesque (display), Manrope (body/UI) and Space Mono
 *     (metrics). Newsreader survives untouched as the `prose` role — see that token.
 *   - `Arc` is new: the motif's own two roles (the drawn ornament and the ring track).
 *   - `Radius`, `Spacing`, `FontSize`, `Tracking`, `LineHeight`, `Elevation`, `ControlHeight`,
 *     `ContentWidth`, `TabBar`, `HitTarget`, `CheckboxSize`, `Opacity` and `Motion` are UNCHANGED.
 *     The redesign is a colour/type/motif pass; the geometry and pacing the app is built against
 *     were not the problem and re-cutting them would have been churn.
 *
 * METHOD, unchanged from every pass before it: hold a hue and its saturation, move ONLY lightness
 * until the target ratio clears, and solve each role to a COMMON target rather than to the bare
 * minimum, so a family of tokens reads as one scale instead of as four accidents. Every ratio
 * quoted in a comment below was computed against these exact exports.
 *
 * -------------------------------------------------------------------------------------------
 * HISTORY (kept: these blocks explain why several values are shaped the way they are, and the
 * constraints they name are still live — only the hues moved).
 * -------------------------------------------------------------------------------------------
 *
 * V2.3 design tokens — "The Gait Plate", on the Calm colour scheme (palette swapped 2026-08-02).
 *
 * Source of truth: `docs/design/frontend-design-brief.md` §2. Every value below is either lifted
 * verbatim from the brief, or — where §2 explicitly requires WCAG AA verification and the
 * intent value failed — computed here to the target ratio, following the same rule V2.2 used:
 * same hue/saturation family, only lightness moved until the target contrast cleared. Every
 * adjustment is commented at its token and proven (not just asserted) in
 * `constants/__tests__/theme-contrast.test.ts`, which computes ratios from these exact exports.
 *
 * THE MOVE ONTO CALM HAPPENED IN TWO PASSES, both on 2026-08-02:
 *
 *   Pass 1 — colour only. `Colors`, `Score`, `Semantic`, `Accent`, and the new `Gradient` were
 *   resampled from the Calm reference capture rather than from the brief's original warm-neutral
 *   table, and §2 was rewritten to match so the "source of truth" line above stays true. Shape,
 *   type, spacing and motion were deliberately left alone. That pass shipped as a recolor.
 *
 *   Pass 2 — shape, type, spacing, component and motion layer (this one). A recolor was not the
 *   whole ask: the reference's design language is as much its softness, its type hierarchy, its
 *   glass, and its pacing as it is its blue. This pass therefore reverses `Radius.card` from 0 to
 *   24 (see that token's own block comment — it is the single biggest reversal here, and a
 *   deliberate one), and adds `Glass`, `Tracking`, `LineHeight`, `Elevation`, `Radius.tile`/
 *   `.hero`, `ControlHeight.pill`/`.circle`, and a longer expressive register on `Motion`
 *   (`duration.gentle`/`.epic`/`.cinematic`, `curve.calm`/`.morph`/`.linear`, `stagger.*`).
 *
 * NOTHING PROVEN WAS WEAKENED. Every existing contrast guarantee still holds and is still computed
 * (not asserted) in `constants/__tests__/theme-contrast.test.ts`; the new `Glass` alphas are
 * composited over every backdrop they may legally sit on and proven there too. `Colors`, `Score`,
 * `Semantic`, `Accent`, `Gradient`, `FontFamily`, `FontSize`, `Spacing`, `ControlWidth`,
 * `ContentWidth`, `HitTarget`, `CheckboxSize`, `Opacity` and `SystemFont` are untouched by pass 2,
 * as are `Motion`'s original three durations and two curves.
 *
 *   Pass 3 — the bold pass, also 2026-08-02, on the captain's explicit decision after pass 2
 *   reported what it had declined. Only two things in this file moved, and each carries its own
 *   block comment saying so at the token: `Glass` gains a `control` tone (so a control can be
 *   genuinely frosted) and a canvas-tinted `chrome` tone (so the floating tab bar can be
 *   translucent and still carry `text.secondary`), and `Colors.*.control.border` is RETUNED in
 *   both schemes. The retune strengthens a guarantee rather than relaxing one: the old ring was
 *   proven only against the opaque surfaces and measured as low as 1.43:1 against the page wash it
 *   has actually sat on since pass 2. The one guarantee that genuinely changed shape is `Glass`'s
 *   own contract — read it at the token; it names what the decision cost.
 *
 * Naming is by role ("text.secondary", "score.mid.fill"), never by appearance ("gray600" or
 * "amber"), so a rebrand only ever touches a value, never a call site. No hardcoded colors,
 * spacing, radii, or fonts belong in components — import from here (CLAUDE.md § Code
 * conventions).
 */

import { Platform } from 'react-native';

export type ColorScheme = 'light' | 'dark';

// -------------------------------------------------------------------------------------------
// Base — brief §2 "Base (Calm-derived blue/violet)".
//
// Re-derived 2026-08-02 from the Calm reference screens (five-screen capture, preserved at
// `docs/design/`-adjacent asset `V2.3-Calm-Design-References-calm-screens.png`); every hex below
// was sampled from that image or computed from a sampled value. The previous warm graphite/bone
// base is gone — this is a palette swap only, so type, spacing, radius and motion below are
// byte-identical to what they were.
//
// WHAT THE REFERENCE ACTUALLY HAS — Calm ships TWO registers, not one:
//   1. A blue->periwinkle->violet page gradient that carries most screens. Sampled off the
//      content screens (home, content detail): #306393 -> #2D4F8A -> #472E86. That is the
//      `Gradient.page` role at the bottom of the colour section, NOT `background`.
//   2. A near-black night canvas for the audio-player and index screens: sampled #0F0F12 /
//      #070709 / #161616, with translucent-white glass sitting on it (#3B3B3C for a secondary
//      pill, #495770 for a glass circle button).
// `background`/`surface.*` are this file's flat, contrast-bearing roles, so they take register 2
// — Calm's night canvas — given the periwinkle cast the gradient establishes (hue ~228-231°,
// versus Calm's literally neutral #0F0F12). The gradient is a separate, additive token. This is
// the faithful reading: both registers ship, each in the role that fits it.
//
// WHY NOT PUT THE BRIGHT GRADIENT BLUE IN `background`: it does not survive the surface stack.
// `surface.raised` is dark mode's lightest surface and therefore the binding constraint for every
// lightened foreground in this file. With `background` at Calm's mid-gradient #2D4F8A, a 12-18%
// white glass `surface.raised` lands near L_rel 0.17, which pushes the >=4.5:1 floor for every
// score-band `text` up to L_rel >= 0.71 — brighter than pure #00FF00 — so four *distinguishable*
// band hues become arithmetically impossible. Register 2 is both Calm-accurate and the only one
// that leaves the score scale room to exist.
//
// Light is DERIVED, not invented (Calm has no light mode): same blue/violet hue family, inverted
// lightness. Surfaces are tinted toward Calm's sky blue (hue ~217-219°) and text sits in the same
// deep blue-violet as dark mode's canvas (hue ~230°), so daylight reads as the same design
// language rather than a second, unrelated theme.
//
// `hairline` is a decorative/structural rule (dividers, ticks, and the annotation lines drawn
// over a captured frame) — not text and not a UI-component boundary — so WCAG 1.4.11 non-text
// contrast does not apply to it. It maps to Calm's ~15%-white glass hairline.
//
// `control.border` (issue #96) is the role `hairline` is explicitly NOT: an actual interactive-
// boundary color, for the edge of a non-accent button/input/checkbox — anything whose fill alone
// (`surface.base`/`surface.raised`, both near-invisible against `background` at ~1.1-1.2:1) is
// not enough to read as a tappable control. Proven >=3:1 (WCAG 1.4.11's floor) against all three
// surfaces, both schemes, in `theme-contrast.test.ts` — including a guard that hairline itself
// stays under 3:1, so this role can never quietly collapse back into decorative hairline.
//
// RETUNED 2026-08-02 (captain's decision to make `Glass` genuinely translucent — see the `Glass`
// block below). Both values moved, and this is a WIDENED guarantee, not a restyle. The previous
// pair (light #7986A6 / dark #6B77A0) was proven only against the three OPAQUE surfaces. Since the
// Calm redesign every control actually sits on `Gradient.page`, and measured against the wash the
// old pair was nowhere near the 3:1 floor it advertised: dark #6B77A0 read 1.43 / 1.83 / 2.38
// against the three stops, and light #7986A6 read 2.94 / 2.85 / 2.86. That was a real, shipped gap
// — a control ring that met WCAG on a backdrop the control was no longer on. The new values are
// solved against the FULL set a control edge can touch: three surfaces + flat `background` + all
// three `Gradient.page` stops + every one of those seen through each translucent `Glass` tone.
// Method unchanged from the rest of this file: hold hue and saturation, move only lightness.
//   light #6C7A9D (hue 222.7°, sat 20.2%, L 52.0%) — worst case 3.35:1 (over glass on stop 1).
//   dark  #D4D7E3 (hue 226.4°, sat 21.8%, L 86.0%) — worst case 3.29:1 (over glass on stop 0).
// Dark had to go LIGHT, not darker, and that direction is forced: the only darker colour that
// clears 3:1 against the darkest stop (#472E86) is pure black, at exactly 3.00:1 with no margin.
// A pale rim on a blue wash is also what the reference itself draws. Every pair is computed in
// theme-contrast.test.ts, never asserted from this comment.
// -------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------
// CADENCE ARCS BASE (2026-09-01) — everything below this line replaces the Calm blue/violet
// values the block comment above describes. The RULES that comment states all still bind; only
// the hue family moved, from periwinkle (~228°) to espresso (~27°).
//
// The single fixed point is `dark.background` = `#17120E`, the approved "ink" — hue 26.7°, sat
// 24.3%, L 7.3%. Every other espresso-family value here is that hue held and its lightness moved:
// the two dark surfaces are the same hue lifted to L 11.5% / 15.0%, and dark `text.secondary`,
// `hairline` and `control.border` are the same hue in a slightly wider saturation register.
//
// DARK IS THE PRIMARY SCHEME and the one the design was drawn for. Light is DERIVED, exactly as
// Calm's was: the same hue journey, inverted lightness — a warm bone canvas (hue 30°) with
// espresso text (hue 24°), so daylight reads as the same design language rather than as a second,
// unrelated theme.
//
// `dark.text.primary` is a WARM BONE (`#F7EFE7`), not pure white, and that is deliberate. Pure
// white on an espresso canvas reads as a blue-cast hole punched in a warm surface — it is the one
// place the old palette's value could not simply be carried over. It costs nothing: 16.34:1 on
// background / 14.61:1 on surface.base / 13.19:1 on surface.raised.
//
// `hairline` keeps its exact old role — decorative rules, ticks, and the annotation lines drawn
// over a captured frame — and its exact old constraint: deliberately UNDER 3:1, guarded in
// theme-contrast.test.ts so it can never quietly double as a control boundary.
//
// `control.border` keeps its role and its (wider, post-2026-08-02) proof obligation: >=3:1
// against all three surfaces AND every `Gradient.page` stop AND every one of those stops seen
// through each translucent `Glass` tone. Solved over that full set, not over the surfaces alone.
//   dark  #BDAB9B (hue 28.0°, sat 20.2%, L 67.5%) — worst case 3.11:1.
//   light #967760 (hue 26.0°, sat 22.0%, L 48.3%) — worst case 3.11:1.
// Dark still has to go LIGHT rather than darker, for the same reason it did on Calm: the wash it
// sits on is mid-lightness, so a darker ring has no headroom against the canvas behind it.
// -------------------------------------------------------------------------------------------

export const Colors = {
  light: {
    // Warm bone (hue 30.0°, sat 45.0%) — the daylight end of the espresso family, not a neutral.
    background: '#F7F1EB',
    surface: {
      base: '#FBF7F4', // cards, sheets — same hue family, lifted to L 97.0%
      raised: '#FFFFFF', // the one raised element per screen
    },
    text: {
      // Deep espresso (hue 24.0°, sat 40.0%) — the SAME family as dark mode's `background`, so the
      // two schemes are one palette. 14.67:1 on background / 15.43:1 on surface.base /
      // 16.44:1 on surface.raised.
      primary: '#2B1C12',
      // Same family desaturated (hue 25.5°, sat 18.4%) rather than a separate grey hue —
      // 6.10:1 / 6.42:1 / 6.84:1.
      secondary: '#6A5749',
    },
    // Rules, ticks, annotations — decorative, see note above. Held deliberately weak: 1.22:1
    // (background) / 1.29:1 (surface.base) / 1.37:1 (surface.raised), all far under the 3:1
    // control-boundary floor the guard in theme-contrast.test.ts enforces.
    hairline: '#E7DACF',
    control: {
      // The interactive-boundary role (issue #96), solved over the full backdrop set named in the
      // block comment above. Binding case: this ring against a translucent control sitting on the
      // page wash, at 3.11:1.
      border: '#967760',
    },
  },
  dark: {
    // The approved ink — hue 26.7°, sat 24.3%, L 7.3%. The one value in this file taken verbatim
    // from the design rather than solved.
    background: '#17120E',
    surface: {
      // The same espresso hue lifted to L 11.5% / 15.0%. Held this dark for the same reason the
      // Calm surfaces were: `surface.raised` is dark mode's lightest surface and therefore the
      // binding constraint for every lightened foreground in this file — anything lighter breaks
      // the accent's 3:1 floor against it (see `Accent`).
      base: '#241D17',
      raised: '#2E251E',
    },
    text: {
      // Warm bone, not pure white — see the block comment above. 16.34:1 / 14.61:1 / 13.19:1.
      primary: '#F7EFE7',
      // The same family at a lower lightness (hue 28.3°, sat 20.2%) — a warm taupe, not a neutral
      // grey. 7.83:1 / 7.00:1 / 6.32:1.
      secondary: '#B8A594',
    },
    // Espresso-family rule (hue 28.0°, sat 18.0%). Deliberately quiet: 1.61:1 (background) /
    // 1.44:1 (surface.base) / 1.30:1 (surface.raised) — under 3:1 by design.
    hairline: '#42372E',
    control: {
      border: '#BDAB9B',
    },
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
// RETUNED FOR THE CALM BASE (2026-08-02). The old clay/amber/green ramp was drawn for a
// warm-neutral bone/graphite base and clashes on blue/violet. Each band keeps its semantic hue
// identity but is re-cut for the cool register — saturation pulled into the 50-60% band the rest
// of this palette lives in (no fully-saturated Material hues), and lightness re-solved per scheme
// against the new surfaces. The four bands are NOT collapsed into shades of one hue: this product
// IS colour-coded scoring. Shipped hue separations, all >=30° and every one of them wider than
// what the warm ramp had (its `good`/`strong` sat only 5° apart):
//
//   low 14° (coral) -> mid 44° (gold) -> strong 145° (jade) -> good 178° (teal)
//   ...and against the two non-score hues: accent 252° (periwinkle-violet), error 336° (rose-
//   crimson). Closest pair anywhere in the palette is error 336° <-> low 14°, at 38°.
//
// Warm->cool still maps to bad->good. It is still caution, not alarm (brief §2).
//
// Every value's contrast is computed and asserted in theme-contrast.test.ts. Rather than nudging
// each band to the bare minimum it can clear — which produces four bands of wildly different
// visual weight, since red is naturally dark and gold naturally light — each band is solved to a
// COMMON target ratio per role, holding its own hue/saturation and moving only lightness. That is
// the same "move only lightness" method as before, applied to a shared target so the four bands
// read as one scale:
//   - dark  `fill` -> 6.50:1 on `surface.base` (the vivid bar on the night canvas)
//   - dark  `text` -> 5.00:1 on `surface.raised` (the binding surface — dark mode's lightest)
//   - light `fill` -> 3.20:1 on `background`   (the binding surface — light mode's darkest)
//   - light `text` -> 4.75:1 on `background`
// Each target sits above its WCAG floor (3:1 fill / 4.5:1 text) with real margin, not shaved to
// the wire, so a future rounding change cannot silently drop a band below AA.
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

// RE-CUT FOR THE ESPRESSO BASE (2026-09-01). The four bands keep their semantic identities but
// their hues moved, and the move was forced by one new fact: THE ACCENT IS NOW ORANGE. On the
// Calm palette the accent was periwinkle (252°), a full hemisphere from every band, so the ramp
// could put "needs work" at coral 14° without any risk of a score being mistaken for a CTA. With
// a clay accent at 21.9° that is no longer true, and a coral `low` would have sat 8° from the
// primary action colour. So the whole ramp is rotated off the accent instead:
//
//   low 352° (rose-red) -> mid 52° (amber) -> strong 152° (jade) -> good 195° (teal)
//
// Every pairwise separation in the palette, INCLUDING against the two non-score hues, is >=30°:
//   accent 21.9 <-> low 352 = 30°   ·   accent <-> mid 52 = 30°   ·   low <-> mid = 60°
//   strong <-> good = 43°           ·   error 315 <-> low 352 = 37°   ·   error <-> accent = 67°
// The tightest pair anywhere is 30°, versus the Calm palette's 38° — narrower, and that is the
// honest cost of an orange accent, stated rather than buried. It is still comfortably above the
// ~20-25° at which two hues start to be confusable, and the bands are additionally separated by
// lightness and by never appearing in the same role as the accent (which is CTA-only, never a
// score — see `Accent`).
//
// Warm->cool still maps to bad->good. It is still caution, not alarm.
//
// The per-role COMMON targets are unchanged from the Calm ramp, so the four bands still read as
// one scale rather than four separately-shaved minimums:
//   dark  `fill` -> 6.50:1 on `surface.base`   ·   dark  `text` -> 5.00:1 on `surface.raised`
//   light `fill` -> 3.20:1 on `background`     ·   light `text` -> 4.75:1 on `background`
export const Score: Record<
  ScoreBand,
  { light: { fill: string; text: string }; dark: { fill: string; text: string } }
> = {
  // Rose-red — hue 352°, sat ~58%. Rotated off the accent (see the block above); reads as warning
  // rather than as "the button colour, but a score".
  low: {
    // fill L 61.2% -> 3.20:1 (bg) / 3.37:1 (surface.base).
    // text L 48.8% -> 4.73:1 (bg) / 4.98:1 (surface.base) / 5.30:1 (surface.raised).
    light: { fill: '#D56372', text: '#C53448' },
    // fill L 70.8% -> 7.30:1 (bg) / 6.52:1 (surface.base).
    // text L 66.3% -> 6.19:1 (bg) / 5.53:1 (surface.base) / 4.99:1 (surface.raised) —
    // surface.raised is dark mode's *lightest* surface, so it's the binding constraint for a
    // light-tinted foreground, here and in every band below.
    dark: { fill: '#E08A95', text: '#DB7785' },
  },
  // Amber — hue 52°, sat ~58%. Held warm on purpose: it is the one band that must not be
  // mistakable for either neighbour, and a cool "mid" would collapse toward the teal end.
  mid: {
    // fill L 37.3% -> 3.20:1 (bg) / 3.37:1 (surface.base).
    // text L 29.6% -> 4.74:1 (bg) / 4.99:1 (surface.base) / 5.32:1 (surface.raised).
    light: { fill: '#968828', text: '#776C20' },
    // fill L 44.7% -> 7.28:1 (bg) / 6.51:1 (surface.base).
    // text L 41.1% -> 6.22:1 (bg) / 5.56:1 (surface.base) / 5.02:1 (surface.raised).
    dark: { fill: '#B4A330', text: '#A6962C' },
  },
  // Teal — hue 195°, sat ~55%. The coolest point on the ramp and the furthest thing in the palette
  // from the espresso canvas, which is what makes a top band legible as an all-clear on it.
  good: {
    // fill L 44.7% -> 3.22:1 (bg) / 3.38:1 (surface.base).
    // text L 35.3% -> 4.77:1 (bg) / 5.02:1 (surface.base) / 5.35:1 (surface.raised).
    light: { fill: '#3391B1', text: '#29738C' },
    // fill L 55.9% -> 7.26:1 (bg) / 6.49:1 (surface.base).
    // text L 49.2% -> 6.19:1 (bg) / 5.53:1 (surface.base) / 4.99:1 (surface.raised).
    dark: { fill: '#51ADCC', text: '#39A0C3' },
  },
  // Jade — hue 152°, sat ~50%. The least saturated band: "Strong" is the resting state, and a
  // loud green would read as an alert rather than an all-clear.
  strong: {
    // fill L 39.7% -> 3.21:1 (bg) / 3.38:1 (surface.base).
    // text L 31.6% -> 4.74:1 (bg) / 4.99:1 (surface.base) / 5.32:1 (surface.raised).
    light: { fill: '#339869', text: '#287953' },
    // fill L 47.6% -> 7.25:1 (bg) / 6.48:1 (surface.base).
    // text L 43.8% -> 6.21:1 (bg) / 5.56:1 (surface.base) / 5.01:1 (surface.raised).
    dark: { fill: '#3DB67E', text: '#38A873' },
  },
} as const;

// -------------------------------------------------------------------------------------------
// Semantic roles — not in the brief (it predates this need); added for issue #24. Until now,
// `app/(auth)/sign-in.tsx` painted auth errors with `Score.low[scheme].text`, the "Needs work"
// SCORE-BAND hue — a defensible stopgap (a token, not a hardcoded hex) but semantically wrong,
// and actively confusing on the M6 Result screen where a low pillar score and a system error
// would otherwise read as the same colour with different meanings, in an app whose product IS
// colour-coded scoring. `error` is therefore a distinct hue family from `score.low`, not just a
// different lightness of it: a rose-crimson (hue ~336°, past pure red toward magenta) vs.
// score.low's coral (hue ~14°, leaning toward amber) — 38° apart, WIDER than the 25° the previous
// warm palette shipped, so the two cannot be mistaken for each other even color-blind-adjacent.
// Retuned for the Calm base 2026-08-02: on blue/violet the old 350° crimson sat too near the
// canvas's own violet cast, so the hue moved further into magenta. Saturation (~64%) stays in the
// same restrained family every other token here uses — no generic, fully-saturated Material red
// (e.g. #F44336, sat ~90%) — matching the palette's "caution not alarm" register (brief §2's line
// for score.low applies just as well to a system error: this app doesn't scold).
//
// Same hue/saturation family across both themes, only lightness moved, exactly like the score
// bands, and solved to the same shared per-role targets they use so an error never out-shouts or
// under-shouts a band sitting beside it:
//   light #C22A67 (hue 335.9°, sat 64.4%, L 46.3%) -> 4.76:1 (bg) / 5.12:1 (surface.base) /
//     5.50:1 (surface.raised).
//   dark  #DE6B99 (hue 336.0°, sat 63.5%, L 64.5%) -> 5.86:1 (bg) / 5.45:1 (surface.base) /
//     5.02:1 (surface.raised) — surface.raised is dark mode's *lightest* surface, so again the
//     binding constraint for a light-tinted foreground, cleared with real margin rather than
//     shaved to the wire.
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

// RE-CUT 2026-09-01 for the espresso base. The requirement is unchanged — an error must not be
// mistakable for the "Needs work" score band — but the ramp rotated (see `Score`), so `error`
// rotated with it, further into magenta: hue 315° (sat ~55%) against `low`'s 352°, i.e. 37° apart,
// and 67° from the clay accent. Same shared per-role targets as the bands, so an error never
// out-shouts or under-shouts one sitting beside it:
//   light #B63596 (L 46.1%) -> 4.76:1 (bg) / 5.00:1 (surface.base) / 5.33:1 (surface.raised).
//   dark  #D672BD (L 64.3%) -> 6.20:1 (bg) / 5.54:1 (surface.base) / 5.00:1 (surface.raised).
export const Semantic: Record<SemanticRole, { light: string; dark: string }> = {
  error: {
    light: '#B63596',
    dark: '#D672BD',
  },
} as const;

// -------------------------------------------------------------------------------------------
// The accent — brief §2 "One accent (reserved, single-use)". Theme-invariant: the CTA reads the
// same whether the screen is light or dark, so — like V2.2's `Accent` — it is never nested
// under `Colors`. Re-derived from the Calm reference 2026-08-02: the accent there is the
// violet/periwinkle glow — the streak ring and the active tab pill — sampled at #9988F7 /
// #A9A5F8 / #B1A3F9 (hue ~249°, sat ~87%, L ~75%). Signal blue #2F6BEB is retired: on a blue
// canvas a blue CTA is not an accent.
//
// The sampled value ships at a lower lightness than the reference's, and that is forced, not
// preferential. Two floors squeeze this token from opposite sides and there is only a narrow band
// between them:
//   - `onAccent` (white) on the fill must clear 4.5:1 -> accent L_rel <= 0.1833.
//   - the fill must clear 3:1 as a non-text boundary against `Colors.dark.surface.raised`, dark
//     mode's lightest surface -> accent L_rel >= 0.1492.
// Calm's literal #9988F7 sits at L_rel 0.309 and fails the first outright (white on it is only
// 2.92:1) — Calm puts a small white glyph on that pill and does not meet AA there. Holding its
// hue and saturation and moving only lightness (the method this file uses everywhere), #7558E8
// (hue 252.1°, sat 75.8%, L 62.7%) lands inside the band with margin on both sides:
//   white on accent 4.86:1; accent on light bg/base/raised 4.21:1 / 4.53:1 / 4.86:1;
//   accent on dark bg/base/raised 3.79:1 / 3.53:1 / 3.25:1.
// That >=3:1 against `surface.raised` is also what caps the dark surface stack — see the note on
// `Colors.dark.surface` about why the glass could not be pushed to Calm's full 12-18% white.
// All ten pairs are computed, not asserted, in theme-contrast.test.ts.
// -------------------------------------------------------------------------------------------

// CADENCE ARCS (2026-09-01): the accent is CLAY. The design names `#E8703B`, and that literal
// hex ships — but as `Arc.*.ornament`, the decorative motif colour, NOT here. The reason is the
// same two-sided squeeze the block above describes, and clay loses it at full brightness exactly
// as Calm's periwinkle did:
//   - white on `#E8703B` is 3.08:1 — nowhere near the 4.5:1 a CTA label owes.
//   - so, holding hue 21.9° and sat 79.4% and moving only lightness (57.1% -> 42.0%), the accent
//     ships as `#C05416`: white on accent 4.64:1, and the fill itself 4.00 / 3.58 / 3.23:1 on the
//     dark surfaces and 4.14 / 4.36 / 4.64:1 on the light ones — clearing the >=3:1 non-text floor
//     on `Colors.dark.surface.raised`, dark mode's lightest surface, with 0.23 to spare.
// That >=3:1 is again what caps the dark surface stack — see the note on `Colors.dark.surface`.
// The brand's brighter clay is not lost: it is the arc motif (`Arc`), where WCAG 1.4.3 does not
// apply because nothing there is text.
export const Accent = {
  /** The primary CTA, and only the primary CTA — never a score, never decoration. */
  value: '#C05416',
  /** The only legal label color on an accent fill. */
  onAccent: '#FFFFFF',
} as const;

// -------------------------------------------------------------------------------------------
// Arc — NEW for Cadence Arcs (2026-09-01). The redesign's signature motif is concentric arcs
// radiating from a point, like ripples from a footstrike: corner ornaments on every screen, the
// loading rings on the wait states, and the ring track behind the score readouts. That motif
// needs exactly two colour roles, and neither of the existing ones can play them:
//
//   - `ornament` — a drawn arc. `Accent` is wrong (the accent is reserved for the primary CTA and
//     ONLY the primary CTA; painting every screen's corner with it would retire that reservation),
//     and `hairline` is wrong (it is a 1.2-1.6:1 rule; an arc drawn in it is invisible at the
//     radii this motif uses). This is where the design's literal clay `#E8703B` lives, in dark —
//     the brightest, most brand-forward value in the file, in the one role that can carry it.
//   - `track` — the UNFILLED remainder of a score ring. Structural, decorative, and deliberately
//     quiet: it must not compete with the `Score.*.fill` arc drawn over it.
//
// PROOF OBLIGATION, and it is deliberately STRONGER than WCAG requires. An ornament is decorative,
// so 1.4.11 does not formally apply to it — but `<ArcRing>` also draws the ring geometry that a
// score sits in, and a reader who cannot see the ring cannot see where the fill starts. So
// `ornament` is proven >=3:1 against all three surfaces AND all three `Gradient.page` stops, in
// both schemes, in theme-contrast.test.ts. Dark ships the literal clay (worst case 3.56:1 on the
// brightest wash stop); light holds the same hue/sat and drops lightness to 46.1% for `#D25219`
// (worst case 3.20:1). `track` takes the mirror obligation `hairline` has — proven to stay UNDER
// 3:1 — so it can never quietly become the thing that carries the ring's meaning.
// -------------------------------------------------------------------------------------------

export const Arc = {
  light: {
    /** A drawn arc: corner ornaments, loading rings, the score-ring geometry. */
    ornament: '#D25219',
    /** The unfilled remainder of a score ring. Decorative; no contrast promise. */
    track: '#E4D1C3',
  },
  dark: {
    ornament: '#E8703B',
    track: '#504135',
  },
} as const;

export type ArcColors = (typeof Arc)[ColorScheme];

// -------------------------------------------------------------------------------------------
// The page gradient — new for the Calm palette (2026-08-02). Calm's identity IS the gradient:
// there is no white (or flat) page anywhere in the reference; one continuous sky-blue ->
// periwinkle -> violet wash carries every screen that is not the near-black player. The token
// file had no role for that, so screens had nothing to reach for and the wash could only have
// arrived as hardcoded hexes in a component — exactly what CLAUDE.md § Code conventions forbids.
//
// ONE role only. `page` is the full-bleed screen backdrop, ordered top -> bottom, and it is the
// only gradient any screen in this codebase has a use for today. No `card`, `sheet`, `hero` or
// `overlay` variants are speculated here: this file's rule is to prove a token against AA before
// shipping it, not to publish a catalogue nothing consumes.
//
// Dark stops are sampled straight off the reference's CONTENT screens (home body, content-detail
// sheet), not off the splash. The splash's sky-blue top (#75B1E7) carries white text at 2.28:1 —
// Calm gets away with that because the only thing on it is one line of decorative low-opacity
// copy. The content screens are where Calm actually puts headlines, and they clear comfortably:
//   #2F6394 (hue 209.1°) 6.30:1  ->  #3B4A96 (hue 230.1°) 8.06:1  ->  #472E86 (hue 257.0°)
//   10.48:1, each against `Colors.dark.text.primary`.
// Light stops are derived the same way the light scheme is: identical hue journey (216° -> 235°
// -> 261°), inverted lightness, at L ~92-93% so `Colors.light.text.primary` clears 14.09:1 /
// 13.64:1 / 13.71:1.
//
// CONTRACT — the gradient is proven for `text.primary` ONLY, and that is a design rule, not an
// oversight. `Colors.dark.text.secondary` on the darkest dark stop is 4.17:1 and fails AA, and it
// cannot be fixed from either end: dropping the stops far enough (L_rel <= 0.043) turns the wash
// black and deletes the Calm identity the token exists for, while lifting `text.secondary` far
// enough erases the whole primary/secondary step. This is also how the reference behaves —
// Calm puts one white headline on the gradient and drops everything else (captions, metadata,
// list rows) onto a glass card, i.e. onto `surface.base`/`surface.raised`, which ARE proven for
// both text roles. Secondary text, score fills and score text belong on a surface — or, since
// 2026-08-02's pass 3, on the one canvas-tinted `Glass.*.chrome` tone that is proven for both
// roles — never directly on the wash. Asserted per stop in theme-contrast.test.ts.
//
// EXEMPTION, ruled deliberately (L8, v23-ux-audit-r1): `text.secondary` directly on the wash is
// permitted for a purely DECORATIVE, non-text glyph — e.g. Home's top-bar `<LowPolyField>` mark
// (`app/(tabs)/index.tsx`) — because WCAG 1.4.3 text contrast does not apply to it at all; it
// carries no information a screen reader or a contrast failure could hide. This is narrower than
// H3's rule (which is about TEXT dimmed with `opacity`): do not read this exemption as licence to
// dim actual copy the same way — that is exactly the bug H3 fixed. If a decorative mark like this
// one is ever given `opacity` on top of `text.secondary`/`text.primary`, treat it as landing back
// in H3's failure mode and route it to a surface instead.
// -------------------------------------------------------------------------------------------

// RE-CUT 2026-09-01 for Cadence Arcs. Same role, same one-role-only discipline, same
// primary-text-only contract — a different journey. The wash now travels espresso -> clay, i.e.
// from the canvas the app rests on toward the accent it acts in: hue 26° -> 20° -> 14° in dark,
// mirrored 32° -> 24° -> 16° in light.
//
// THE DARK STOPS ARE MID-LIGHTNESS (L 17% -> 25%), NOT NEAR-BLACK, and that is a deliberate call
// worth naming because the obvious alternative is wrong. A wash whose stops sit at the same
// lightness as `background` (`#17120E`, L 7.3%) is not a wash at all — it is invisible, and every
// screen would read as a flat espresso rectangle with the `<ScreenGradient>` component doing
// nothing. Calm's wash was mid-lightness for the same reason. Lifting the stops is also what keeps
// the `Glass` contract's measured failure REAL: white-tinted glass over a near-black wash would
// comfortably carry `text.secondary`, quietly deleting the constraint the counter-guard in
// theme-contrast.test.ts exists to pin (see that guard, and note 1 at `Glass`).
//
// Dark stops carry `text.primary` at 12.16 / 10.73 / 9.66:1. Light stops (hue-matched, inverted
// lightness, L 89-95%) carry it at 14.92 / 13.72 / 12.43:1.
export const Gradient = {
  /** The full-bleed screen backdrop, ordered top -> bottom. Carries `text.primary` only. */
  page: {
    light: ['#F9F3EC', '#F6E8DF', '#F3DBD3'],
    dark: ['#382A1E', '#4A2F21', '#5D3022'],
  },
} as const;

export type GradientRole = keyof typeof Gradient;

// -------------------------------------------------------------------------------------------
// Glass — added by the 2026-08-02 SHAPE/TYPE/MOTION redesign (the follow-up to the palette-only
// swap above). The Calm reference's second structural idea, after the gradient, is translucent
// white sitting ON that gradient: circular top-bar buttons, the floating tab bar, the panel a
// hero image fades into. `Colors.*.surface.*` cannot express that — they are opaque, so a card
// built from them hides the wash instead of letting it through.
//
// THE CONTRACT — REVISED 2026-08-02 BY THE CAPTAIN'S DECISION. The original version of this block
// forbade glass from ever being an interactive control's fill, so the app's secondary pills, its
// circular icon buttons and its tab bar all shipped OPAQUE and the reference's defining material
// was missing from every control. The captain was told why (see note 2) and asked for the Calm look
// anyway. Rather than trade the boundary away, this revision separates the two things the old rule
// conflated: a control's FILL and a control's BOUNDARY are independent, and only the boundary owes
// WCAG 1.4.11 anything. So the fill is now genuinely frosted and the boundary is still proven.
//
//   1. WHITE-TINTED glass (`fill`, `raised`, `control`) carries `text.primary` ONLY. Proven below
//      against every backdrop glass can legally sit on — all three `Gradient.page` stops plus the
//      flat `background` — in theme-contrast.test.ts, which composites the alpha itself rather
//      than trusting a comment. Dark mode is the binding case: white on `dark.fill` over the
//      BRIGHTEST gradient stop is 5.26:1, on `dark.raised` 4.81:1, on `dark.control` 4.72:1.
//      Anything heavier than ~0.13 white pushes a tone under 4.5:1, which is why these alphas are
//      what they are and not the reference's literal ~0.15-0.18. Text legibility is NOT what the
//      captain's decision traded away, and this is the line that says so: every alpha here is
//      capped by the worst legal backdrop, not chosen for looks.
//
//   2. CANVAS-TINTED glass (`chrome`) carries BOTH text roles, and it is the only tone that does.
//      It is tinted toward this scheme's own `background` rather than toward white, so instead of
//      washing the backdrop out it darkens it (dark) / lightens it (light) toward the surface the
//      full text scale was tuned against. That is what buys `text.secondary` back: 4.99:1 worst
//      case in dark, 5.93:1 in light. It exists because the floating tab bar is the single most
//      recognisable piece of Calm's chrome AND it renders inactive tabs in `text.secondary` — on
//      white-tinted glass those two facts are irreconcilable (a dimmed white over the bright end
//      of the wash tops out around 3.7:1, short of AA at a 13pt label), and this is the tone that
//      reconciles them without going opaque. See the counter-guard in theme-contrast.test.ts: the
//      white-tinted tones still genuinely FAIL for secondary text, and that guard is kept, not
//      loosened.
//
//   3. Glass MAY now be an interactive control's fill — WITH a `control.border` ring. This is the
//      clause the captain's decision changed, and the ring is the whole reason it can change
//      honestly. An 8-13% white wash reads ~1.1:1 against the wash behind it, exactly as the old
//      note said, so the FILL can never carry the 3:1 non-text boundary itself. It does not have
//      to: `Colors.*.control.border` is an opaque, proven ring, and it was retuned in this same
//      pass (see its block above) specifically so it clears 3:1 against every gradient stop AND
//      against every one of those stops seen through each glass tone. So a glass control is
//      frosted AND bounded. WHAT IS ACTUALLY LOST, stated plainly rather than left to the diff: a
//      glass control's affordance now rests on a 1pt ring instead of on a solid fill, and its
//      label's contrast falls from 15.81:1 (white on opaque `surface.raised`) to 4.72:1 worst case
//      — still AA, but AAA is gone for those labels. That is the captain's call, made knowingly.
//      `hairline` here stays decorative and carries no contrast promise, same as
//      `Colors.*.hairline`.
//
// Light mode is far less constrained (white over already-light stops), but takes the same contract
// anyway so a component never has to branch on scheme to know what it may put on glass.
// -------------------------------------------------------------------------------------------

// RE-CUT 2026-09-01 for Cadence Arcs. The contract above is UNCHANGED in every clause — what
// moved is the tint (the canvas-tinted `chrome` and `scrim` follow `background` from periwinkle to
// espresso) and the dark white-tinted alphas, which went UP: 0.08/0.12 -> 0.11/0.14, plus
// `control` 0.13 -> 0.16. That is a change in the honest direction. The old alphas were capped by
// what `text.primary` could survive over Calm's BRIGHT blue wash; the espresso wash is darker, so
// the same heavier glass the reference always wanted (12-18% white) now fits inside the same
// >=4.5:1 obligation with room to spare — worst case is `control` over the brightest wash stop at
// 6.06:1, against Calm's 4.72:1. Both halves of the contract therefore got STRONGER, not looser:
// primary text has more margin, and `text.secondary` on white-tinted glass over the wash still
// genuinely fails (2.90-4.21:1), which is exactly what the counter-guard in theme-contrast.test.ts
// pins so these alphas cannot drift up again.
export const Glass = {
  light: {
    /** The default translucent panel. */
    fill: 'rgba(255, 255, 255, 0.72)',
    /** The one raised/floating glass element per screen (a sticky action bar). */
    raised: 'rgba(255, 255, 255, 0.88)',
    /** An interactive control's frosted fill — a secondary pill, a circular icon button. Always
     *  paired with a `control.border` ring; see contract note 3. Deliberately LIGHTER than `fill`:
     *  a control should let more of the wash through than the panel it sits on, which is what makes
     *  it read as a lens rather than as a lighter card. */
    control: 'rgba(255, 255, 255, 0.55)',
    /** Canvas-tinted chrome that must carry the full text scale — the floating tab bar. The only
     *  glass tone proven for `text.secondary`; see contract note 2. */
    chrome: 'rgba(247, 241, 235, 0.62)',
    /** Decorative edge on a glass panel. No contrast promise — see contract note 3. */
    hairline: 'rgba(43, 28, 18, 0.10)',
    /** Legibility scrim laid over photographic media before text sits on it. */
    scrim: 'rgba(247, 241, 235, 0.55)',
  },
  dark: {
    fill: 'rgba(255, 255, 255, 0.11)',
    raised: 'rgba(255, 255, 255, 0.14)',
    control: 'rgba(255, 255, 255, 0.16)',
    chrome: 'rgba(23, 18, 14, 0.62)',
    hairline: 'rgba(255, 255, 255, 0.16)',
    scrim: 'rgba(23, 18, 14, 0.55)',
  },
} as const;

/** The `Glass` tones that are tinted toward WHITE, and therefore carry `text.primary` only
 *  (contract note 1). Exported so `theme-contrast.test.ts` can iterate exactly this set — and so
 *  the counter-guard proving `text.secondary` fails on them cannot silently stop covering a tone
 *  someone adds later. `chrome` is deliberately absent: it is the canvas-tinted exception. */
export const WhiteTintedGlassTones = ['fill', 'raised', 'control'] as const;

export type GlassColors = (typeof Glass)[ColorScheme];

// -------------------------------------------------------------------------------------------
// Type — brief §2 "Type". Three families, each isolated to its role: Archivo (grotesque) for
// display/numerals — distinct from V2.2's Barlow Condensed; Inter for body/UI, shared with the
// family; IBM Plex Mono for measured readouts, the "instrument" signal carried over from V2.2.
// Installed via `npx expo install @expo-google-fonts/archivo @expo-google-fonts/inter
// @expo-google-fonts/ibm-plex-mono expo-font` — not yet wired into `app/_layout.tsx` (that's a
// frontend-builder task); these are the family/weight name exports it will call `useFonts` with.
// -------------------------------------------------------------------------------------------

// RE-CUT 2026-09-01 for Cadence Arcs. All three of the roles above keep their exact contracts and
// call sites; only the families change, and each swap is chosen for what the redesign asks of it:
//
//   display: Archivo -> BRICOLAGE GROTESQUE. Archivo is a clean, even grotesque — the right
//     neutral for "The Gait Plate", and too neutral for a system whose headline gesture is a
//     radiating arc. Bricolage's flared, slightly irregular terminals share that curve, and it
//     holds together at `FontSize.hero` where a neutral grotesque reads as a placeholder.
//   body: Inter -> MANROPE. A rounder, warmer UI face, which is what stops the espresso canvas
//     reading as a developer tool. Same seven-weight range, so no call site's weight disappears.
//   mono: IBM Plex Mono -> SPACE MONO. The metrics face. Plex Mono is a typewriter; Space Mono's
//     geometric bowls echo the arc motif in the one place numbers are set — the score numerals.
//
// Installed via `npx expo install @expo-google-fonts/bricolage-grotesque @expo-google-fonts/manrope
// @expo-google-fonts/space-mono`; loaded in `app/_layout.tsx`'s `useFonts` call.
export const FontFamily = {
  /** Screen titles and the big score numerals. */
  display: {
    regular: 'BricolageGrotesque_400Regular',
    medium: 'BricolageGrotesque_500Medium',
    semiBold: 'BricolageGrotesque_600SemiBold',
    bold: 'BricolageGrotesque_700Bold',
  },
  /** Body copy and UI chrome. */
  body: {
    regular: 'Manrope_400Regular',
    medium: 'Manrope_500Medium',
    semiBold: 'Manrope_600SemiBold',
    bold: 'Manrope_700Bold',
  },
  /** Measured score readouts and any pace/metric text.
   *
   * TWO WEIGHTS, not three. Space Mono ships only 400 and 700 — there is no 500 or 600 to load,
   * and aliasing `medium`/`semiBold` onto one of the two would be a token that lies about what it
   * renders. The three call sites that asked for `mono.medium` now ask for `mono.bold`, which is
   * what a metric wants at those sizes anyway. */
  mono: {
    regular: 'SpaceMono_400Regular',
    bold: 'SpaceMono_700Bold',
  },
  /** Coaching prose ONLY — per-pillar feedback and drill instructions (spec 2026-07-26 §3.2).
   *
   * DELIBERATELY NOT CHANGED by the 2026-09-01 redesign. The Cadence Arcs direction named three
   * families (display/body/mono) and was silent about a fourth; that silence is not a reason to
   * delete a role that exists for a real, load-bearing reason. Newsreader is what makes the
   * coach's feedback read as writing rather than as a populated field, and it sits at least as
   * well beside Bricolage/Manrope on espresso as it did beside Archivo/Inter on blue.
   * Never UI chrome: buttons, labels, tabs and every other control stay `body` (Inter). The
   * split exists because the feedback is writing by a coach, and rendering it in the same
   * family as a button label is what made it read as generated UI text. */
  prose: {
    regular: 'Newsreader_400Regular',
    italic: 'Newsreader_400Regular_Italic',
    semiBold: 'Newsreader_600SemiBold',
  },
} as const;

/** The brief's six fixed steps: 32 / 24 / 20 / 17 / 15 / 13. Support Dynamic Type — never
 * hard-clip text at these sizes (brief §2).
 *
 * `display` and `hero` are the redesign's addition (spec 2026-07-26 §3.1). The original six
 * spanned 13->32 — a ratio of 2.5x — which is why nothing on screen had real hierarchy. These
 * two exist to be used AT MOST ONCE PER SCREEN; the contrast comes from the gap between 96 and
 * 15, not from many large things. */
export const FontSize = {
  xs: 13,
  sm: 15,
  md: 17,
  lg: 20,
  xl: 24,
  xxl: 32,
  display: 64,
  hero: 96,
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
  /** The single large vertical gap that separates a result's hero from its readout (spec
   * 2026-07-26 §3.4). Not part of the brief's original ramp — use sparingly, once per screen. */
  editorial: 96,
} as const;

// -------------------------------------------------------------------------------------------
// Radius — REVERSED by the 2026-08-02 shape/type/motion redesign.
//
// `card: 0` was spec 2026-07-26 §3.3's deliberate call: "a sharp corner reads as a printed
// document, a rounded one reads as a generic app card." That was the right call for "The Gait
// Plate", whose whole thesis was a clinical printed plate. It is the wrong call for the Calm
// design language this app is now being moved onto, where every single surface in the reference —
// screen corners, hero media, cards, tiles, buttons, the tab bar — is generously rounded, and the
// softness IS the brand. Keeping a 0 here would have left the app reading as a technical readout
// wearing Calm's colours, which is exactly the "recolor, not a redesign" outcome this pass exists
// to correct. Sampled off the reference's own corners and rounded to this ramp.
//
// The counter-argument the old value encoded ("rounded reads as generic") is answered by the rest
// of the system, not by the corner: the hero type scale, the duotone media, the kinetic reveals
// and the low-poly work are what stop this reading as a template. See the report accompanying the
// redesign branch — this is a flagged judgement call, not an accident.
// -------------------------------------------------------------------------------------------

export const Radius = {
  /** Cards and panels. Was 0; see the block comment above for why that reversed. */
  card: 24,
  /** Sheets, modals, and the floating tab bar. */
  sheet: 28,
  /** Small inline tiles — an icon chip, a thumbnail, a chip-sized swatch. */
  tile: 16,
  /** Full-bleed hero media. The largest corner in the system, matching the reference's own
   *  device-corner-adjacent hero crop. */
  hero: 32,
  /** Pills, chips, and every button in the redesign — the reference has no square button. */
  pill: 999,
} as const;

/** Letter-spacing, in points, for the two type registers that need it. The Calm reference leans
 *  hard on a tiny tracked-out uppercase micro-label ("NARRATOR", "AUTHOR") set against very large,
 *  slightly-tightened display type; both need a token or they arrive as magic numbers at call
 *  sites. `normal` exists so a component can name "deliberately untracked" rather than omit. */
export const Tracking = {
  /** The tiny uppercase eyebrow/micro-label. */
  eyebrow: 1.6,
  normal: 0,
  /** Display and hero type. Large type needs negative tracking to hold together. */
  display: -0.6,
  hero: -2,
} as const;

/** Line-height multipliers. Body prose wants air; display type wants to stack tightly so a
 *  two- or three-line headline reads as one shape (the reference's content-detail title). */
export const LineHeight = {
  hero: 0.98,
  display: 1.08,
  heading: 1.2,
  body: 1.5,
} as const;

// -------------------------------------------------------------------------------------------
// Elevation — added with the redesign. The reference floats things (the tab bar, the primary
// pill, the hero card) with a soft, wide, low-opacity shadow rather than a hard edge. Kept as one
// role, not a Material-style 0-24 ramp: this app floats exactly two kinds of thing, and a ramp
// nothing consumes is the same speculative-token mistake the rest of this file refuses.
//
// Deliberately no `shadowColor` per scheme: a shadow is a shadow in both, and on the dark canvas
// it simply reads as a deeper pool rather than disappearing (the gradient behind it is mid-
// lightness, not black). `elevation` is Android's separate channel and must be set alongside.
// -------------------------------------------------------------------------------------------

export const Elevation = {
  /** Anything floating over the page: the tab bar, a sticky action bar, the primary CTA. */
  floating: {
    shadowColor: '#0A0E1C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 8,
  },
  /** A resting card that should lift off the wash without announcing itself. */
  resting: {
    shadowColor: '#0A0E1C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 2,
  },
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
  /** The redesign's primary/secondary action pill. Taller than `standard` because the reference's
   *  pills are the single most prominent control on their screen and read as a slab, not a button
   *  with rounded ends. Inputs deliberately stay at `standard` — a text field that matches the CTA's
   *  height stops the CTA being the loudest thing on the screen. */
  pill: 56,
  /** The circular glass icon button in a screen's top bar. Exactly `HitTarget.min`, not more:
   *  the reference's are visually ~44 and the a11y floor and the drawn size coincide here. */
  circle: 44,
} as const;

export const ControlWidth = {
  /** Home's primary CTA minimum width. */
  primaryButton: 220,
} as const;

// -------------------------------------------------------------------------------------------
// Content width — issue #63 (M7 responsive pass). `app.json`'s `supportsTablet: true` means
// every screen below can render in a viewport as wide as an iPad's ~1024pt, not just a phone's
// ~375-430pt — verified live: on an 11" iPad simulator, sign-in's buttons and body copy stretch
// edge-to-edge into a single ~650pt+ line, which is both an unreadably long line length and not
// a design anyone drew. `readable` caps a screen's outer content column at a phone-native width
// even on a wide viewport (applied as `width: '100%', maxWidth: ContentWidth.readable` on the
// screen's existing outer content container, cross-axis-centered by the screen's existing
// ScrollView/SafeAreaView — never a new wrapper node). Below this width (every real phone) it is
// always a no-op: `100%` stays smaller than the cap, so nothing here changes phone layout at all.
// Not tied to any specific device's point width — this is a readable-column decision, not a
// breakpoint copied from one simulator.
// -------------------------------------------------------------------------------------------

export const ContentWidth = {
  /** The single, app-wide readable-column cap for a screen's outer content — see block comment
   *  above. One value, not a per-screen guess, so every screen caps at the same width. */
  readable: 560,
  /**
   * Is this viewport wide enough that the cap is actually doing something — i.e. is the content
   * column now an INSET column with the wash visible either side of it, rather than the full
   * width of the screen?
   *
   * Almost every screen can ignore this: `width: '100%'` + `maxWidth` is self-resolving, and the
   * result looks right either way. It matters only where a style encodes the assumption that the
   * column touches the device's edges. `app/result/[id].tsx`'s hero frame is that case — it rounds
   * its bottom corners ONLY, because at phone width it bleeds off the top and both sides and reads
   * as a window the page hangs from. Once capped it is a floating card with two square top
   * corners, which reads as unfinished rather than as bleed. Screens use this to switch that
   * treatment, never to change what content exists.
   */
  isCapped(windowWidth: number): boolean {
    return windowWidth > this.readable;
  },
} as const;

// -------------------------------------------------------------------------------------------
// The floating tab bar's geometry. Added with the redesign, and it lives HERE rather than in
// `app/(tabs)/_layout.tsx` for two reasons: it is a layout token that two other screens
// (`(tabs)/index.tsx`, `(tabs)/history.tsx`) have to agree with exactly, and `app/**` files are
// expo-router ROUTE modules — importing one for a constant drags a route's module graph into a
// screen that only wanted a number.
//
// The bar is `position: 'absolute'` (the reference's bar floats, with content scrolling under it),
// which means React Navigation reserves NO layout space for it. Every screen under `(tabs)` must
// therefore pad its own scroll content by `clearance`, or its last element sits beneath the bar.
// -------------------------------------------------------------------------------------------

export const TabBar = {
  /** The bar's own drawn height. */
  height: 64,
  /** Inset from the screen's left/right/bottom edges. */
  inset: Spacing.xl,
  /**
   * The bar's offset from the bottom of the viewport, given the device's live bottom safe-area
   * inset. Android only: on iOS this returns the plain `inset` whatever the inset is, so the
   * signed-off iPhone composition (a floating bar overlapping the 34pt home-indicator strip, which
   * is conventional) is byte-identical to what shipped. The Android branch is where the defect is.
   *
   * CORRECTION, issue #63 (M7 safe-area pass). This token used to say that `<Tabs>` "still applies
   * [the bottom safe-area inset] to the bar itself", and that is NOT true — it stopped being true
   * the moment `app/(tabs)/_layout.tsx` gave `tabBarStyle` an explicit `height` and
   * `paddingBottom`. Both were verified against the installed
   * `@react-navigation/bottom-tabs` source:
   *
   *   - `views/BottomTabBar.js` builds the bar's style as an ARRAY ending in `tabBarStyle`, so our
   *     `paddingBottom: Spacing.sm` overrides the library's own `paddingBottom: insets.bottom`.
   *   - `getTabBarHeight` returns a numeric `height` from the passed style VERBATIM, short-
   *     circuiting the `TABBAR_HEIGHT_UIKIT + inset` branch below it.
   *
   * So nothing was paying the bottom inset. With Android `edgeToEdgeEnabled: true` and 3-button
   * navigation (`insets.bottom ~= 48`), a bar sitting at `bottom: 24` with `height: 64` had its
   * lowest 24pt — including part of its label row — drawn behind the system navigation bar.
   * Gesture navigation (~16-24pt) was already fine, which is why this survived.
   */
  bottomOffset(bottomInset: number): number {
    return Platform.OS === 'android' ? Math.max(this.inset, bottomInset) : this.inset;
  },
  /** What a tab screen must add to its content's bottom padding, for a bar sitting at
   *  `bottomOffset(bottomInset)`. One `inset` of breathing room above the bar's top edge. */
  clearanceFor(bottomInset: number): number {
    return this.bottomOffset(bottomInset) + this.height + this.inset;
  },
  /** The phone default — `clearanceFor(0)`, i.e. the bar at its plain `inset`. Unchanged at 112pt,
   *  and still the right value anywhere a live inset is not available. */
  get clearance() {
    return this.height + this.inset * 2;
  },
  /**
   * The bar's left/right offset for a viewport `windowWidth` points wide — issue #63's tablet
   * pass.
   *
   * The bar is `position: 'absolute'` with `left`/`right` both set, so its width is whatever those
   * two offsets leave behind. A flat `inset` on both sides therefore stretches it to the FULL
   * viewport width, which on an iPad (~1024pt, and wider still in landscape) draws a ~980pt bar
   * holding two ~80pt tab items marooned in the middle of it — while every screen's content
   * column beside it is capped at `ContentWidth.readable`. The bar was the one piece of chrome the
   * readable-column cap never reached, so it was also the one that still announced "this is a
   * phone layout stretched sideways".
   *
   * Capping the bar to the same column and centring it is what makes the two agree. Below the cap
   * — every real phone, and an iPad's narrowest Split View pane — `(windowWidth - readable) / 2`
   * is zero or negative, so `Math.max` returns the plain `inset` and the RESULT of this function is
   * unchanged from the flat token.
   *
   * A PHONE IS STILL AFFECTED, though, and not by this arithmetic. Applying this exposed that the
   * bar's horizontal inset had never worked at all: `app/(tabs)/_layout.tsx` was setting `left`/
   * `right`, and `@react-navigation/bottom-tabs`'s own base style sets `start: 0, end: 0`, which
   * Yoga resolves at higher precedence. The bar has been drawing full-bleed to both screen edges
   * since the redesign, on every device. That file now sets `start`/`end`, so the bar finally sits
   * where the redesign always specified — which IS a visible change on a phone. See its comment.
   *
   * Takes the width as an argument rather than reading it: `constants/theme.ts` is a plain module
   * and cannot call `useWindowDimensions()`. The caller supplies the live value, which is also
   * what makes this react to an iPad rotation or a Split View resize rather than latching the
   * width it first mounted at.
   */
  sideInset(windowWidth: number): number {
    return Math.max(this.inset, (windowWidth - ContentWidth.readable) / 2);
  },
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

// The three original durations/curves below are UNCHANGED — every existing moment (the splash
// handoff, the annotation draw, the pillar-bar fill) keeps its tuned timing exactly. The redesign
// adds a longer, more expressive register alongside them rather than retuning what already ships:
// the reference sites this pass is drawn from (per-word scroll reveals, a morphing low-poly field,
// an aperture rack-focus) move on a scale of half a second to a second and a half, which the
// 160/240/320 ramp simply cannot express. Both registers are legitimate; a control's press
// feedback should still be `quick`, and a headline assembling itself should not.
export const Motion = {
  duration: {
    quick: 160,
    standard: 240,
    slow: 320,
    /** One element arriving expressively — a word in a kinetic headline, a card lifting in. */
    gentle: 480,
    /** A composed, multi-part arrival: an aperture opening, a wireframe assembling. */
    epic: 900,
    /** Ambient, non-blocking, usually looping — the gradient drift, the low-poly morph, the
     *  marquee's travel per screen-width. Nothing the user waits on ever uses this. */
    cinematic: 1600,
  },
  curve: {
    /** Anything arriving. Cubic-bezier control points. */
    easeOut: [0, 0, 0.2, 1],
    /** Anything leaving. */
    easeIn: [0.4, 0, 1, 1],
    /** The redesign's expressive arrival — a long, soft deceleration (an "expo-out" shape).
     *  Used for kinetic text, hero reveals, aperture opens. */
    calm: [0.22, 1, 0.36, 1],
    /** Symmetric in-out, for something that transforms in place rather than arriving: the
     *  low-poly morph between two shapes, a rack focus. */
    morph: [0.65, 0, 0.35, 1],
    /** Constant rate. The only correct curve for a continuous loop — a marquee that eases would
     *  visibly pulse at every seam. */
    linear: [0, 0, 1, 1],
  },
  /** Per-item delay for a staggered group. Named by what is being staggered so a call site reads
   *  as intent rather than as an arbitrary millisecond count. */
  stagger: {
    /** Between words in a kinetic line. Short — a whole line should still land as one gesture. */
    word: 34,
    /** Between lines in a kinetic block. */
    line: 90,
    /** Between rows/cards in a list arrival. */
    item: 60,
    /** Between triangles in a low-poly morph, so the shape assembles rather than snaps. */
    facet: 24,
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
