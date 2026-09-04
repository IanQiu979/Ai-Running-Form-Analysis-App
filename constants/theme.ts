/**
 * V2.3 design tokens — "COLD READ" (2026-09-04): a near-monochrome, cool-scientific system on a
 * graphite/bone base, with ONE bright icy-cyan highlight reserved for the primary call to action.
 *
 * THIS IS A FULL VISUAL SYSTEM REPLACEMENT of the espresso/clay "Cadence Arcs" scheme, and of the
 * Calm blue/violet scheme before it. What changed, and every one of these is re-proven (not
 * asserted) in `constants/__tests__/theme-contrast.test.ts`:
 *
 *   - `Colors`, `Gradient`, `Glass`, `Score`, `Semantic`, `Accent` are all re-solved on a cool
 *     near-neutral base (hue ~206-212°, saturation 9-25%). The espresso/clay family is gone.
 *   - `Accent` is icy cyan and its label colour is now the INK, not white — see that token.
 *   - `Arc` is RETIRED. The concentric-ripple motif is not part of this system; the redesign's
 *     signature gesture is the entry animation, not a recoloured ornament. Its one load-bearing
 *     job — drawing the geometry a score fill sits inside — moves to `Meter`, which is a smaller,
 *     honest role, not a rename. See both tokens.
 *   - `FontFamily`, `Radius`, `Spacing`, `FontSize`, `Tracking`, `LineHeight`, `Elevation`,
 *     `ControlHeight`, `ContentWidth`, `TabBar`, `HitTarget`, `CheckboxSize`, `Opacity` and
 *     `Motion` are UNCHANGED. This pass is a COLOUR pass; the geometry, type and pacing the app
 *     is built against were not what the captain asked to change, and re-cutting them would be
 *     churn on top of a large diff.
 *
 * METHOD, unchanged from every pass before it: hold a hue and its saturation, move ONLY lightness
 * until the target ratio clears, and solve each role to a COMMON target rather than to the bare
 * minimum, so a family of tokens reads as one scale instead of as four accidents. Every ratio
 * quoted in a comment below was computed against these exact exports.
 *
 * -------------------------------------------------------------------------------------------
 * HISTORY — the constraints these blocks name are still live; only the hues moved. Read them
 * before changing a value, because several of them explain why a value CANNOT simply be brightened.
 *
 * "The Gait Plate" (2026-07-26) was a warm-neutral clinical plate: sharp corners, Archivo/Inter/
 * IBM Plex Mono, no gradient, no glass. The Calm swap (2026-08-02) replaced its palette with a
 * blue/violet wash and added the two structural ideas this file still has — `Gradient.page` (a
 * full-bleed page wash, because Calm has no flat page anywhere) and `Glass` (translucent panels
 * sitting on it, which opaque `surface.*` cannot express). That same day, pass 3 widened the
 * `Glass` contract on the captain's explicit decision: glass may be an interactive control's FILL,
 * provided a proven `control.border` ring carries WCAG 1.4.11 for it, and one canvas-tinted tone
 * (`chrome`) carries BOTH text roles so the floating tab bar can be translucent. "Cadence Arcs"
 * (2026-09-01) then swapped the palette again — espresso ink, clay accent — and added the `Arc`
 * motif this pass retires.
 *
 * Three constraints survive all of that and bind this pass too:
 *   1. `Colors.dark.surface.raised` is dark mode's lightest surface, so it is the binding
 *      constraint for every lightened foreground in this file, and the >=3:1 non-text floor the
 *      accent owes it is what caps how light the dark surface stack may go.
 *   2. The page wash must be LIFTED off `background`. A wash at the canvas's own lightness is not
 *      a wash — `<ScreenGradient>` would draw nothing — and, more importantly, a near-black wash
 *      quietly deletes the `Glass` contract's measured failure (note 1 at `Glass`).
 *   3. `hairline` is decorative and must stay UNDER 3:1; `control.border` is the interactive
 *      boundary and must clear 3:1 against surfaces, wash stops, and every glass tone over them.
 *
 * Naming is by role ("text.secondary", "score.mid.fill"), never by appearance ("gray600" or
 * "amber"), so a rebrand only ever touches a value, never a call site. No hardcoded colors,
 * spacing, radii, or fonts belong in components — import from here (CLAUDE.md § Code
 * conventions).
 */

import { Platform } from 'react-native';

export type ColorScheme = 'light' | 'dark';

// -------------------------------------------------------------------------------------------
// COLD READ BASE (2026-09-04) — near-monochrome, cool, and deliberately almost hueless.
//
// The whole system hangs off ONE hue family, ~206-212° (a cool blue-grey), at saturations between
// 9% and 25%. That is low enough that no surface reads as "blue" and high enough that nothing
// reads as a dead neutral grey — the base has a temperature, it just does not have a colour. This
// is what makes a single saturated accent (see `Accent`) legible as the only chromatic event on a
// screen: on the espresso base the canvas itself was chromatic and the accent had to shout over
// it; here the canvas is quiet and the accent can simply be the one bright thing.
//
// DARK IS THE PRIMARY SCHEME. Its `background` is a near-black `#0B0D0F` (hue 210°, sat 15.4%,
// L 5.1%) — darker than any canvas this app has shipped. The two surfaces are the same hue lifted
// to L 9.2% / 13.1%, held that dark for the reason constraint 1 above names.
//
// LIGHT IS DERIVED, not invented: the same hue family, inverted lightness — a cool bone canvas
// (`#F4F5F7`, hue 220°, L 96.3%) with graphite text — so daylight reads as the same design
// language rather than as a second, unrelated theme. `surface.raised` is pure white, the one
// place in either scheme where a hue is absent on purpose: it is the single raised element per
// screen and reading as "brighter than the page" is its whole job.
//
// `text.primary` is a cool bone in dark (`#EDF1F4`), not pure white, for the same reason Cadence
// Arcs' was a warm bone: a foreground with no relation to its canvas reads as a hole punched in
// it. It costs nothing — 17.14:1 / 15.72:1 / 14.12:1 on the three dark surfaces.
//
// `hairline` keeps its exact role (decorative rules, ticks, and the annotation lines drawn over a
// captured frame) and its exact constraint: deliberately UNDER 3:1, guarded in
// theme-contrast.test.ts so it can never quietly double as a control boundary.
//   light #E1E5E9 -> 1.16 / 1.22 / 1.27      dark #262C31 -> 1.38 / 1.26 / 1.14
//
// `control.border` (issue #96) keeps its role and its full post-2026-08-02 proof obligation:
// >=3:1 against all three surfaces AND `background` AND every `Gradient.page` stop AND every one
// of those seen through each translucent `Glass` tone. Solved over that whole set, not over the
// surfaces alone, and solved to a COMMON worst case rather than to each scheme's bare minimum so
// the ring has the same visual weight in both:
//   light #76828C (hue 207.3°, sat 8.7%, L 50.6%) — worst case 3.42:1, against the bare wash's
//     last stop (its next-worst is 3.53:1, that same stop seen through `chrome`).
//   dark  #A8B4BE (hue 207.3°, sat 14.5%, L 70.2%) — worst case 3.43:1, against a `control`-tone
//     glass fill over that same last stop.
// Dark still has to go LIGHT rather than darker: the wash it sits on is lifted off the canvas
// (constraint 2), so a darker ring has no headroom against what is behind it.
// -------------------------------------------------------------------------------------------

export const Colors = {
  light: {
    /** Cool bone (hue 220.0°, sat 15.8%, L 96.3%) — the daylight end of the graphite family. */
    background: '#F4F5F7',
    surface: {
      base: '#FAFBFC', // cards, sheets — same family, lifted to L 98.4%
      raised: '#FFFFFF', // the one raised element per screen; deliberately hueless
    },
    text: {
      // Graphite (hue 206.7°, sat 20.0%, L 8.8%) — the same family as dark mode's canvas, so the
      // two schemes are one palette. 16.54:1 (bg) / 17.41:1 (base) / 18.04:1 (raised).
      primary: '#12171B',
      // Same family desaturated (hue 210.0°, sat 10.1%) — 5.61:1 / 5.91:1 / 6.12:1.
      secondary: '#59636D',
    },
    /** Rules, ticks, annotations — decorative. Deliberately under the 3:1 control-boundary floor. */
    hairline: '#E1E5E9',
    control: {
      /** The interactive-boundary role (issue #96), solved over the full backdrop set named
       *  above. Binding case: this ring over a translucent control on the wash's last stop. */
      border: '#76828C',
    },
  },
  dark: {
    /** Near-black (hue 210.0°, sat 15.4%, L 5.1%). The one fixed point of this scheme. */
    background: '#0B0D0F',
    surface: {
      // The same hue lifted to L 9.2% / 13.1%. Held this dark for the reason constraint 1 names:
      // anything lighter breaks the accent's >=3:1 floor against `raised`.
      base: '#14181B',
      raised: '#1D2226',
    },
    text: {
      // Cool bone, not pure white — see the block above. 17.14:1 / 15.72:1 / 14.12:1.
      primary: '#EDF1F4',
      // The same family at L 64.7% (hue 207.3°, sat 12.2%) — 7.84:1 / 7.19:1 / 6.46:1.
      secondary: '#9AA6B0',
    },
    /** Decorative rule. 1.38:1 / 1.26:1 / 1.14:1 — under 3:1 by design. */
    hairline: '#262C31',
    control: {
      border: '#A8B4BE',
    },
  },
} as const;

export type ThemeColors = (typeof Colors)[ColorScheme];

// -------------------------------------------------------------------------------------------
// The score scale — brief §2 "The score scale" + §7 "The score hues especially — they carry
// meaning, so they must clear 3:1 as non-text and their band text 4.5:1."
//
// Each band carries two roles, not one hue, because a colour needs its full ramp: a bar fill and
// coloured text on the same background are different lightnesses of the same hue.
//   - `fill` — the bar/ring/progress colour and any decorative swatch. A non-text graphic that
//     carries meaning, so >=3:1 against both `background` and `surface.base`.
//   - `text` — the colour when a band word or numeral is rendered IN the score hue. Text, so
//     >=4.5:1 against all three surfaces.
// A coloured band chip is built from a neutral `surface.raised` pill + the `text` role + a
// `hairline` border — never coloured text directly on a solid coloured fill, a pairing this scale
// does not promise to pass.
//
// RE-CUT COOLER FOR THE COLD READ BASE (2026-09-04), on the captain's explicit call: the old ramp
// was drawn against espresso and its coral/gold end read as a warm leftover on graphite. The
// re-cut is constrained by one hard new fact, stated plainly rather than buried —
// THE ACCENT IS NOW CYAN, at hue 189.8°, which closes the 160-220° window the old ramp's `good`
// (teal, 195°) lived in. A teal top band and an icy-cyan CTA cannot both exist at >=30° apart.
// So the ramp vacates cyan and re-lands as:
//
//   low 350° (rose)  ->  mid 45° (amber)  ->  good 118° (green)  ->  strong 156° (jade)
//
// That is an improvement the old ramp could not get: it is MONOTONIC in band order. The espresso
// ramp ran 352° -> 52° -> 195°(good) -> 152°(strong), i.e. it doubled back between the top two
// bands, so "further up the scale" and "further round the wheel" disagreed. Here bad -> good and
// warm -> cool are the same journey, in band order, with no reversal.
//
// Every pairwise separation in the palette, INCLUDING against the two non-score hues, is >=30°,
// and this is PROVEN in theme-contrast.test.ts (`hue separation` block) rather than asserted here:
//   low<->mid 55°   mid<->good 73°   good<->strong 38°   strong<->accent 34°   accent<->low 160°
//   error 308° <-> low 42°   error <-> accent 118°   ...tightest pair anywhere: 33.6°.
// That tightest pair sits BETWEEN the espresso ramp's 30° and the Calm ramp's 38°: better than an
// orange accent could manage, short of what a violet one did. Cyan is a mid-wheel accent, and a
// narrower worst pair than 38° is the honest cost of putting the highlight there.
//
// SATURATION comes down across the board (55/52/42/44% versus the espresso ramp's 50-58% with two
// bands at the top of that range). On a canvas that is itself 9-25% saturated, a fully-vivid band
// reads as an alert; these sit one register quieter, which is what "cooler" buys in practice
// alongside the hue rotation.
//
// The per-role COMMON targets are UNCHANGED from every ramp before this one, so the four bands
// still read as one scale rather than four separately-shaved minimums:
//   dark  `fill` -> 6.50:1 on `surface.base`   ·   dark  `text` -> 5.00:1 on `surface.raised`
//   light `fill` -> 3.20:1 on `background`     ·   light `text` -> 4.75:1 on `background`
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

export const Score: Record<
  ScoreBand,
  { light: { fill: string; text: string }; dark: { fill: string; text: string } }
> = {
  // Rose — hue 350°, sat 55%. The warm end of the ramp, and the furthest band from the accent
  // (160° away), so "needs work" can never be misread as "the button colour, but a score".
  low: {
    // fill L 61.6% -> 3.22:1 (bg) / 3.39:1 (surface.base).
    // text L 46.5% -> 4.76:1 (bg) / 5.01:1 (surface.base) / 5.19:1 (surface.raised).
    light: { fill: '#D36779', text: '#C43950' },
    // fill L 68.6% -> 7.11:1 (bg) / 6.52:1 (surface.base).
    // text L 64.5% -> 6.11:1 (bg) / 5.60:1 (surface.base) / 5.03:1 (surface.raised) —
    // surface.raised is dark mode's *lightest* surface, so it is the binding constraint for a
    // light-tinted foreground, here and in every band below.
    dark: { fill: '#DB8391', text: '#D67282' },
  },
  // Amber — hue 45°, sat 52%. Held warm on purpose: it is the one band that must not be mistakable
  // for either neighbour, and a cool "mid" would collapse toward the green end.
  mid: {
    // fill L 41.8% -> 3.21:1 (bg) / 3.38:1 (surface.base).
    // text L 33.1% -> 4.80:1 (bg) / 5.05:1 (surface.base) / 5.23:1 (surface.raised).
    light: { fill: '#A28633', text: '#806A29' },
    // fill L 47.5% -> 7.10:1 (bg) / 6.51:1 (surface.base).
    // text L 43.9% -> 6.09:1 (bg) / 5.59:1 (surface.base) / 5.02:1 (surface.raised).
    dark: { fill: '#B8993A', text: '#AA8D36' },
  },
  // Green — hue 118°, sat 42%. This is the band the cyan accent displaced (it was teal 195°), and
  // it lands here rather than anywhere cooler because 118° is the furthest a green can sit from
  // both amber (73°) and the accent (72°) while leaving `strong` its own 38°.
  good: {
    // fill L 42.7% -> 3.21:1 (bg) / 3.38:1 (surface.base).
    // text L 33.7% -> 4.78:1 (bg) / 5.03:1 (surface.base) / 5.21:1 (surface.raised).
    light: { fill: '#439B3F', text: '#357B32' },
    // fill L 48.8% -> 7.13:1 (bg) / 6.54:1 (surface.base).
    // text L 44.9% -> 6.10:1 (bg) / 5.59:1 (surface.base) / 5.03:1 (surface.raised).
    dark: { fill: '#4CB148', text: '#46A342' },
  },
  // Jade — hue 156°, sat 44%. The coolest band, and the closest one to the accent at 34°. It is
  // also the least saturated end of the ramp: "Strong" is the resting state, and a loud green
  // would read as an alert rather than an all-clear.
  strong: {
    // fill L 41.8% -> 3.21:1 (bg) / 3.38:1 (surface.base).
    // text L 33.1% -> 4.80:1 (bg) / 5.05:1 (surface.base) / 5.24:1 (surface.raised).
    light: { fill: '#3C9974', text: '#2F795C' },
    // fill L 47.6% -> 7.15:1 (bg) / 6.56:1 (surface.base).
    // text L 43.7% -> 6.10:1 (bg) / 5.59:1 (surface.base) / 5.03:1 (surface.raised).
    dark: { fill: '#44AF84', text: '#3EA179' },
  },
} as const;

// -------------------------------------------------------------------------------------------
// Semantic roles — added for issue #24. `error` is a distinct hue FAMILY from `score.low`, not a
// different lightness of it: a system error and a "Needs work" pillar must not read as the same
// colour in an app whose product IS colour-coded scoring.
//
// RE-CUT 2026-09-04 for the Cold Read base. The requirement is unchanged; the ramp rotated, so
// `error` rotated with it and stays in magenta: hue 307.9° against `low`'s 350° — 42° apart, and
// 118° from the icy-cyan accent. Saturation ~52%, the same restrained register the bands moved
// into; no fully-saturated Material red (this app doesn't scold). Same shared per-role targets as
// the bands, so an error never out-shouts or under-shouts one sitting beside it:
//   light #B339A3 (L 46.3%) -> 4.78:1 (bg) / 5.03:1 (surface.base) / 5.21:1 (surface.raised).
//   dark  #D06BC3 (L 61.8%) -> 6.09:1 (bg) / 5.59:1 (surface.base) / 5.02:1 (surface.raised).
//
// `error` is a foreground/text role only, proven as text (>=4.5:1) against all three surfaces in
// both themes. No non-text `fill` role, and no `success`/`warning` roles: this file's rule is to
// prove AA before shipping a token, not to get ahead of a need.
// -------------------------------------------------------------------------------------------

export type SemanticRole = 'error';

export const Semantic: Record<SemanticRole, { light: string; dark: string }> = {
  error: {
    light: '#B339A3',
    dark: '#D06BC3',
  },
} as const;

// -------------------------------------------------------------------------------------------
// The accent — brief §2 "One accent (reserved, single-use)". Theme-invariant: the CTA reads the
// same whether the screen is light or dark, so it is never nested under `Colors`.
//
// COLD READ (2026-09-04): the accent is ICY CYAN, and it is the SECOND TIER of a deliberately
// two-tier system. Near-black/graphite carries essentially all of the UI; this is the one bright,
// saturated value in the file, and it is reserved for the TRUE PRIMARY call to action —
// at most ONE per screen. Never a score, never a decorative ornament, never a second button on
// the same screen. That reservation is the only thing that makes a monochrome app legible: if two
// things are cyan, neither is the action.
//
// TWO FLOORS SQUEEZE THIS TOKEN FROM OPPOSITE SIDES, and the shipped value is what fits between
// them — it is forced, not preferred:
//   - the fill must clear 3:1 as a non-text boundary against `Colors.light.background`
//     (`#F4F5F7`) — light mode's DARKEST surface, and the binding one for a mid-lightness accent,
//     which caps it at L_rel <= 0.267.
//   - the fill must also clear 3:1 against `Colors.dark.surface.raised`, dark mode's LIGHTEST
//     surface, which floors it at L_rel >= 0.142.
// Holding hue 189.8° and sat 89.6% and moving only lightness, `#0A9AB6` (L 37.6%, L_rel 0.264)
// lands inside that band: 3.05 / 3.21 / 3.33:1 on the light surfaces and 5.85 / 5.37 / 4.82:1 on
// the dark ones. A paler, "icier" cyan is arithmetically impossible for a THEME-INVARIANT accent —
// anything lighter fails its own boundary against a white-ish page. That >=3:1 against
// `surface.raised` is also what caps the dark surface stack (constraint 1 in the header).
//
// `onAccent` CHANGES FROM WHITE TO THE INK, and that is the honest consequence of a bright accent
// rather than a restyle. White on `#0A9AB6` is 3.33:1 and fails AA outright; the ink `#0B0D0F` on
// it is 5.85:1. Dark-on-bright is also simply what a cyan CTA wants to be. Every call site already
// reads `Accent.onAccent` rather than a literal, so this is a value change, not a call-site change
// — and `theme-contrast.test.ts` proves the pair, so a revert to white fails the build.
// -------------------------------------------------------------------------------------------

export const Accent = {
  /** The primary CTA, and only the primary CTA — never a score, never decoration, never twice on
   *  one screen. */
  value: '#0A9AB6',
  /** The only legal label/glyph colour on an accent fill. The ink, not white — see the block. */
  onAccent: '#0B0D0F',
} as const;

// -------------------------------------------------------------------------------------------
// Meter — REPLACES `Arc` (2026-09-04). Read this before reaching for the old token.
//
// `Arc` had two roles, and they were not equally load-bearing:
//   - `ornament`, a drawn ripple: corner arcs on every screen, the sign-in burst, the concentric
//     loading rings. That was the Cadence Arcs MOTIF, and the motif is retired with the palette.
//     This system's bold gesture is the entry animation, not a decoration repeated in a corner,
//     and a near-monochrome scheme with a ripple stencilled on every screen is neither minimal nor
//     scientific. Those ornaments are deleted, not recoloured.
//   - the geometry a score sits IN: the ring stroke a `Score.*.fill` arc is swept over, and the
//     unfilled remainder behind it. That IS load-bearing — a reader who cannot see the track
//     cannot see where the fill starts — so it survives here, under a name that says what it is.
//
// Two roles, mirroring what the old token proved:
//   - `rule` — a drawn measurement line: the ring's own stroke, a tick, an indeterminate wait
//     mark. Proven >=3:1 against all three surfaces AND all three `Gradient.page` stops, in both
//     schemes, which is STRONGER than WCAG requires of a decorative line, for the reason above.
//     light #7B8693 — worst case 3.22:1 (on wash stop 2).
//     dark  #8F9AA3 — worst case 4.31:1 (on wash stop 2).
//   - `track` — the unfilled remainder of a meter. Takes `hairline`'s mirror obligation: proven to
//     stay UNDER 3:1 on every one of those backdrops, so it can never quietly become the thing
//     that carries the meter's meaning instead of the fill.
//
// NOTE THAT NEITHER ROLE IS CHROMATIC. That is the point of the two-tier system: a meter's
// structure is drawn in the monochrome tier, its VALUE is drawn in `Score.*.fill`, and the accent
// is spent on the CTA. On the espresso palette `Arc.ornament` shipped the brand's literal clay and
// was, in practice, a second accent competing with the first.
// -------------------------------------------------------------------------------------------

export const Meter = {
  light: {
    /** A drawn measurement line: a meter's ring stroke, a tick, an indeterminate wait mark. */
    rule: '#7B8693',
    /** The unfilled remainder of a meter. Decorative; deliberately quieter than the fill. */
    track: '#DDE3E9',
  },
  dark: {
    rule: '#8F9AA3',
    track: '#2C343A',
  },
} as const;

export type MeterColors = (typeof Meter)[ColorScheme];

// -------------------------------------------------------------------------------------------
// The page gradient — one role only. `page` is the full-bleed screen backdrop, ordered
// top -> bottom, and it is the only gradient any screen in this codebase has a use for. No
// `card`/`sheet`/`hero` variants are speculated: this file proves a token against AA before
// shipping it rather than publishing a catalogue nothing consumes.
//
// CONTRACT — the gradient is proven for `text.primary` ONLY, and that is a design rule, not an
// oversight. Secondary text, score fills, score text, coaching prose and `Semantic.error` belong
// on an opaque `surface.*` (usually a `<SurfaceCard>`) — or on the one canvas-tinted
// `Glass.*.chrome` tone, which IS proven for both roles. Asserted per stop in
// theme-contrast.test.ts, where `text.secondary` is deliberately NOT asserted: asserting a pair
// the token does not promise would be asserting a lie.
//
// EXEMPTION, ruled deliberately (L8, v23-ux-audit-r1): `text.secondary` directly on the wash is
// permitted for a purely DECORATIVE, non-text glyph, because WCAG 1.4.3 does not apply to it at
// all. Do not read that as licence to dim actual copy with `opacity` — that is the bug H3 fixed.
//
// COLD READ (2026-09-04): the wash travels from the graphite the app rests on toward the cyan it
// acts in — hue 212° -> 202° -> 194° in dark, mirrored 216° -> 204° -> 196° in light — at
// saturations of 10-30%. It is a temperature shift far more than a colour one, which is the whole
// register of this scheme.
//
// THE DARK STOPS ARE A DEEP CHARCOAL (L 13.5% -> 19.5%), LIFTED OFF THE NEAR-BLACK CANVAS
// (`#0B0D0F`, L 5.1%) — see constraint 2 in the header. They are markedly darker than the espresso
// wash's L 17-25%, which is what makes this scheme read as near-black rather than as graphite; the
// floor on how dark they may go is set by the `Glass` counter-guard, and stop 0 sits just above
// it. Dark stops carry `text.primary` at 14.06 / 12.51 / 10.89:1; light stops (hue-matched,
// inverted lightness, L 93.5-98.5%) carry it at 17.41 / 16.77 / 15.68:1.
// -------------------------------------------------------------------------------------------

export const Gradient = {
  /** The full-bleed screen backdrop, ordered top -> bottom. Carries `text.primary` only. */
  page: {
    light: ['#FAFBFC', '#F4F7F9', '#EAF0F3'],
    dark: ['#1F2226', '#242C30', '#27373C'],
  },
} as const;

export type GradientRole = keyof typeof Gradient;

// -------------------------------------------------------------------------------------------
// Glass — translucent panels sitting ON the page wash: circular top-bar buttons, the floating tab
// bar, the panel a hero fades into. `Colors.*.surface.*` cannot express that — they are opaque,
// so a card built from them hides the wash instead of letting it through.
//
// THE CONTRACT IS UNCHANGED BY THE 2026-09-04 PALETTE PASS. Every clause below is the one the
// captain settled on 2026-08-02; only the tints and alphas moved.
//
//   1. WHITE-TINTED glass (`fill`, `raised`, `control`) carries `text.primary` ONLY. Proven
//      against every backdrop glass may legally sit on — all three `Gradient.page` stops plus the
//      flat `background` — in theme-contrast.test.ts, which composites the alpha itself rather
//      than trusting a comment. Dark mode is the binding case: `text.primary` on `dark.control`
//      over the brightest wash stop is 6.39:1, on `dark.raised` 6.82:1, on `dark.fill` 7.49:1.
//
//   2. CANVAS-TINTED glass (`chrome`) carries BOTH text roles, and it is the only tone that does.
//      Tinted toward this scheme's own `background` rather than toward white, so instead of
//      washing the backdrop out it darkens it (dark) / lightens it (light) toward the surface the
//      full text scale was tuned against. That is what buys `text.secondary` back: 6.87:1 worst
//      case in dark, 5.49:1 in light. It exists because the floating tab bar renders inactive tabs
//      in `text.secondary`. See the counter-guard in theme-contrast.test.ts: the white-tinted
//      tones still genuinely FAIL for secondary text, and that guard is kept, not loosened.
//
//   3. Glass MAY be an interactive control's fill — WITH a `control.border` ring. An 8-17% white
//      wash reads ~1.1:1 against what is behind it, so the FILL can never carry WCAG 1.4.11's 3:1
//      itself. It does not have to: `Colors.*.control.border` is an opaque, proven ring, solved
//      against the wash outside it AND every glass tone inside it (worst case 3.42:1 light /
//      3.43:1 dark). What is LOST, stated plainly: a glass control's affordance rests on a 1pt
//      ring rather than a solid fill, and its label's contrast falls from ~15:1 (white on opaque
//      `surface.raised`) to 6.39:1 worst case — still AA, and on this darker wash considerably
//      better than the 4.72:1 the Calm palette shipped. `hairline` here stays decorative.
//
// Light mode is far less constrained (white over already-light stops) but takes the same contract
// anyway, so a component never has to branch on scheme to know what it may put on glass.
//
// THE DARK ALPHAS WENT UP AGAIN (0.11/0.14/0.16 -> 0.12/0.15/0.17), and that is the honest
// direction. Alpha here is capped by what `text.primary` can survive over the BRIGHTEST wash stop;
// this wash is darker than the espresso one, so the reference's heavier 12-18% glass now fits
// inside the same >=4.5:1 obligation with a large margin. Both halves of the contract got
// STRONGER, not looser: primary text has more room, and `text.secondary` on white-tinted glass
// over the wash still genuinely fails (2.92-4.40:1), which is exactly what the counter-guard pins
// so these alphas cannot drift up further.
// -------------------------------------------------------------------------------------------

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
    chrome: 'rgba(244, 245, 247, 0.62)',
    /** Decorative edge on a glass panel. No contrast promise — see contract note 3. */
    hairline: 'rgba(18, 23, 27, 0.10)',
    /** Legibility scrim laid over photographic media before text sits on it. */
    scrim: 'rgba(244, 245, 247, 0.55)',
  },
  dark: {
    fill: 'rgba(255, 255, 255, 0.12)',
    raised: 'rgba(255, 255, 255, 0.15)',
    control: 'rgba(255, 255, 255, 0.17)',
    chrome: 'rgba(11, 13, 15, 0.62)',
    hairline: 'rgba(255, 255, 255, 0.14)',
    scrim: 'rgba(11, 13, 15, 0.55)',
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
