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
 *   - the accent: its `onAccent` label colour on the accent fill — text, >=4.5:1; the accent fill
 *     itself on every surface — non-text button/tint boundary, >=3:1. `onAccent` is the INK, not
 *     white, since the Cold Read pass (2026-09-04) — the pair is computed, so a revert to white
 *     fails here rather than shipping a 3.53:1 CTA label.
 *   - `Semantic.error` on every surface, both themes — text, >=4.5:1 (issue #24); also asserted
 *     distinct from `Score.low.text` in both themes, the issue's actual requirement — a system
 *     error must not be mistakable for the "Needs work" score band it used to borrow from.
 *   - `Colors[scheme].control.border` on every surface, both themes — non-text UI-component
 *     boundary (a non-accent button/input/checkbox edge), >=3:1 (issue #96). Also asserts, per
 *     scheme, that `hairline` itself stays BELOW 3:1 against every surface — the regression this
 *     guards against is `control.border` being set equal to (or as weak as) `hairline`, which
 *     would silently reintroduce the exact bug #96 filed. That assertion is computed from the
 *     live `hairline` export, not a hardcoded ratio, so it tracks the token if it ever moves.
 *     EXTENDED 2026-08-02 (pass 3): the same ring is now also proven against every `Gradient.page`
 *     stop and against every one of those stops seen through every `Glass` tone. Since the Calm
 *     redesign a control does not sit on an opaque surface at all — it sits on the page wash — and
 *     proving the ring only against surfaces was proving it against a backdrop it had left. Both
 *     schemes' `control.border` values moved to satisfy the wider set; see theme.ts.
 *   - every stop of `Gradient.page` against that scheme's `text.primary` — text, >=4.5:1
 *     (2026-08-02, added with the token). A full-bleed page backdrop is something headlines get
 *     drawn straight onto, so shipping its stops unproven would be exactly the "assume it passes"
 *     the brief forbids. `text.secondary` is deliberately NOT asserted here: the gradient's
 *     contract is primary-text-only, for the reason documented at the token in theme.ts, and
 *     asserting a pair the token does not promise would be asserting a lie.
 *
 *   - HUE SEPARATION between every chromatic role (2026-09-04, the Cold Read palette). Contrast is
 *     not the only thing a colour-coded scoring app owes its user: two bands that clear AA
 *     individually are still useless if they are the same colour, and a band that sits on top of
 *     the CTA's hue makes "the accent means act on this" a lie. `theme.ts` has claimed a >=30
 *     degree floor across three successive palettes and had only ever WRITTEN it in a comment.
 *     It is computed here now, from the exports, per scheme.
 *
 * `hairline` is intentionally not asserted to clear either AA floor on its own — see the comment
 * on it in theme.ts: it's a decorative structural rule, not text or a UI-component boundary, so
 * WCAG 1.4.11 does not apply to it. It IS asserted to stay under 3:1 above, precisely because
 * `control.border` must not be allowed to collapse back into it.
 */

import {
  AA_NON_TEXT,
  AA_TEXT,
  contrastRatio,
  hue,
  hueSeparation,
  MIN_HUE_SEPARATION,
  type Hex,
} from '../contrast';
import {
  Accent,
  Colors,
  type ColorScheme,
  Glass,
  Gradient,
  Meter,
  Score,
  ScoreBandOrder,
  Semantic,
  WhiteTintedGlassTones,
} from '../theme';

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
const controlBorderPairs: Pair[] = [];
const hairlineBelowControlFloorPairs: Pair[] = [];
const gradientTextPairs: Pair[] = [];
// Cold Read (2026-09-04) — `Meter`'s two roles, which replace the retired `Arc`. `rule` takes the
// same >=3:1 non-text obligation a score fill does, and `track` takes `hairline`'s mirror
// obligation (stay UNDER 3:1); see the `Meter` token in theme.ts for why a decorative line is held
// to a floor WCAG would not impose on it.
const meterRulePairs: Pair[] = [];
const meterTrackBelowFloorPairs: Pair[] = [];

for (const scheme of SCHEMES) {
  const c = Colors[scheme];
  const surfaces = surfacesFor(scheme);

  // Everything an opaque non-text mark can be drawn on: the three surfaces plus every page-wash
  // stop. Taken from the exports, so a stop added to `Gradient.page` is proven the moment it ships.
  //
  // THE ACCENT BELONGS IN THIS SET, and leaving it out was a real hole (found 2026-09-04): a
  // primary `<PillButton>` is an accent FILL with no border ring — the fill IS its WCAG 1.4.11
  // boundary — and primary CTAs render straight onto `<ScreenGradient>`, not inside a card. Proving
  // the accent against the three opaque surfaces alone therefore proved it against backdrops it is
  // frequently not on; the light wash's last stop is darker than any of them.
  const nonTextBackdrops: [string, string][] = [
    ...surfaces,
    ...Gradient.page[scheme].map((stop, i) => [`gradient.page[${i}]`, stop] as [string, string]),
  ];
  for (const [backdropName, backdropHex] of nonTextBackdrops) {
    meterRulePairs.push({
      label: `${scheme} meter.rule on ${backdropName}`,
      fg: Meter[scheme].rule,
      bg: backdropHex,
    });
    meterTrackBelowFloorPairs.push({
      label: `${scheme} meter.track on ${backdropName} (must stay quieter than the fill drawn over it)`,
      fg: Meter[scheme].track,
      bg: backdropHex,
    });
    accentNonTextPairs.push({
      label: `${scheme} accent on ${backdropName}`,
      fg: Accent.value,
      bg: backdropHex,
    });
  }

  for (const [surfaceName, surfaceHex] of surfaces) {
    textPairs.push({ label: `${scheme} text.primary on ${surfaceName}`, fg: c.text.primary, bg: surfaceHex });
    textPairs.push({
      label: `${scheme} text.secondary on ${surfaceName}`,
      fg: c.text.secondary,
      bg: surfaceHex,
    });
    controlBorderPairs.push({
      label: `${scheme} control.border on ${surfaceName}`,
      fg: c.control.border,
      bg: surfaceHex,
    });
    // The regression guard (issue #96): computed from the live `hairline` export, so it fails
    // the instant `control.border` is set back to `hairline` (or anything else this weak) — not
    // a hardcoded "1.3:1" that would silently stop meaning anything once the underlying hex moves.
    hairlineBelowControlFloorPairs.push({
      label: `${scheme} hairline on ${surfaceName} (must stay a decorative rule, not a control boundary)`,
      fg: c.hairline,
      bg: surfaceHex,
    });
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

  // Every stop of every gradient role, iterated from the export rather than listed, so a stop
  // added to `Gradient.page` (or a new role added beside it) is proven the moment it ships.
  for (const [role, perScheme] of Object.entries(Gradient)) {
    perScheme[scheme].forEach((stop, i) => {
      gradientTextPairs.push({
        label: `${scheme} text.primary on gradient.${role}[${i}]`,
        fg: c.text.primary,
        bg: stop,
      });
    });
  }
}

accentTextPairs.push({ label: 'onAccent (the ink) on accent', fg: Accent.onAccent, bg: Accent.value });

// ---------------------------------------------------------------------------------------------
// Glass — added with the 2026-08-02 shape/type/motion redesign.
//
// `Glass.*.fill`/`.raised` are `rgba()` strings, so unlike every other token in this file they
// have no single contrast ratio: what they read as depends on what is behind them. The whole
// point of proving them is therefore to prove the COMPOSITE, over every backdrop a glass panel is
// legally allowed to sit on — all three `Gradient.page` stops plus the flat `background`.
//
// `composite()` below is the standard source-over blend in sRGB space, which is exactly what the
// platform does when it draws a translucent view: result = alpha*fg + (1 - alpha)*bg, per channel.
// Nothing here trusts a comment or a hand-computed number; the alpha is parsed out of the token
// itself, so editing `Glass` in theme.ts and forgetting to re-derive anything is caught here.
//
// WHAT IS PROVEN, and this list CHANGED on 2026-08-02 by the captain's decision to make glass
// genuinely translucent on controls (see the revised contract at `Glass` in constants/theme.ts):
//
//   1. `text.primary` on every WHITE-TINTED glass tone (`fill`, `raised`, and the new `control`),
//      >= 4.5:1. Unchanged in kind, wider in coverage. Iterated from the `WhiteTintedGlassTones`
//      export rather than a literal list, so a tone added to `Glass` cannot slip past this.
//   2. BOTH text roles on the new canvas-tinted `chrome` tone, >= 4.5:1. This is a genuinely NEW
//      guarantee, not a relaxed one — `chrome` is the tab bar's tone and the tab bar renders
//      inactive items in `text.secondary`.
//   3. `control.border` >= 3:1 against every glass tone over every legal backdrop (below, with the
//      other non-text pairs). This is what lets clause 3 of the contract be honest: the frosted
//      fill never carries the boundary, the ring does.
//
// The counter-guard further down is UNCHANGED IN SUBSTANCE and still fails-by-design: white-tinted
// glass genuinely cannot carry `text.secondary` over the wash, and proving that is what stops the
// primary-only half of the contract being quietly widened. It is now scoped to the white-tinted
// tones explicitly, because `chrome` is the measured exception rather than a loophole.
// ---------------------------------------------------------------------------------------------

/** Parses `rgba(r, g, b, a)` into channels + alpha. Only the form `Glass` actually uses. */
function parseRgba(value: string): { rgb: [number, number, number]; alpha: number } {
  const match = value.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/);
  if (!match) throw new Error(`Not an rgba() string: ${value}`);
  return {
    rgb: [Number(match[1]), Number(match[2]), Number(match[3])],
    alpha: Number(match[4]),
  };
}

function hexToRgb(hex: Hex): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Source-over blend of a translucent `rgba()` layer onto an opaque hex backdrop. */
function composite(layer: string, backdropHex: Hex): Hex {
  const { rgb, alpha } = parseRgba(layer);
  const backdrop = hexToRgb(backdropHex);
  const blended = rgb.map((channel, i) => Math.round(alpha * channel + (1 - alpha) * backdrop[i]));
  return `#${blended.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const glassTextPairs: Pair[] = [];
const glassSecondaryFailurePairs: Pair[] = [];
const glassChromeTextPairs: Pair[] = [];
const controlRingOnGlassPairs: Pair[] = [];
const controlRingOnWashPairs: Pair[] = [];

for (const scheme of SCHEMES) {
  const c = Colors[scheme];
  const glass = Glass[scheme];
  // Every backdrop a glass panel may legally sit on. The gradient stops come from the export, so
  // a stop added to `Gradient.page` is proven under glass the moment it ships.
  const backdrops: [string, Hex][] = [
    ['background', c.background],
    ...Gradient.page[scheme].map((stop, i) => [`gradient.page[${i}]`, stop] as [string, Hex]),
  ];

  // The ring's OUTER neighbour: the page wash itself. Before 2026-08-02 this was never asserted,
  // and both schemes' rings failed it outright — see the header note on `control.border`.
  for (const [backdropName, backdropHex] of backdrops) {
    controlRingOnWashPairs.push({
      label: `${scheme} control.border on ${backdropName}`,
      fg: c.control.border,
      bg: backdropHex,
    });
  }

  for (const tone of WhiteTintedGlassTones) {
    for (const [backdropName, backdropHex] of backdrops) {
      const composited = composite(glass[tone], backdropHex);
      glassTextPairs.push({
        label: `${scheme} text.primary on glass.${tone} over ${backdropName}`,
        fg: c.text.primary,
        bg: composited,
      });
      glassSecondaryFailurePairs.push({
        label: `${scheme} text.secondary on glass.${tone} over ${backdropName}`,
        fg: c.text.secondary,
        bg: composited,
      });
    }
  }

  // `chrome` — the canvas-tinted exception, proven for BOTH text roles. Iterated separately from
  // the white-tinted tones on purpose: the two sets have genuinely different contracts, and
  // collapsing them into one loop is how a future edit would lose track of which is which.
  for (const [backdropName, backdropHex] of backdrops) {
    const composited = composite(glass.chrome, backdropHex);
    glassChromeTextPairs.push({
      label: `${scheme} text.primary on glass.chrome over ${backdropName}`,
      fg: c.text.primary,
      bg: composited,
    });
    glassChromeTextPairs.push({
      label: `${scheme} text.secondary on glass.chrome over ${backdropName}`,
      fg: c.text.secondary,
      bg: composited,
    });
  }

  // The ring's INNER neighbour: the frosted fill it encircles. Every tone, not just `control` —
  // a `<GlassCard>` that ever gains an interactive edge must find this already proven, and the
  // binding case is whichever tone lands closest in luminance to the ring, which is not something
  // a call site should have to reason about.
  for (const tone of [...WhiteTintedGlassTones, 'chrome'] as const) {
    for (const [backdropName, backdropHex] of backdrops) {
      controlRingOnGlassPairs.push({
        label: `${scheme} control.border on glass.${tone} over ${backdropName}`,
        fg: c.control.border,
        bg: composite(glass[tone], backdropHex),
      });
    }
  }
}

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

  test.each(gradientTextPairs)('$label', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test.each(glassTextPairs)('$label', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // The new dual-role tone (2026-08-02, captain's decision). `text.secondary` appearing in a
  // passing AA list is the whole point of `chrome` existing — see contract note 2 in theme.ts.
  test.each(glassChromeTextPairs)('$label', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe('the Glass contract is a real constraint, not a preference', () => {
  // The mirror of `hairlineBelowControlFloorPairs` below: proving a token FAILS where its contract
  // says it must not be used is what stops the contract being quietly widened later. `Glass`
  // (constants/theme.ts) says WHITE-TINTED glass carries `text.primary` ONLY. If someone raises the
  // alpha to match the reference's heavier ~0.15-0.18 wash, or drops secondary text onto a
  // white-tinted glass panel, this is what breaks.
  //
  // KEPT DELIBERATELY THROUGH THE 2026-08-02 CAPTAIN'S DECISION. That decision widened the contract
  // in two directions — glass may now be a control's FILL (clause 3), and one canvas-tinted tone
  // (`chrome`) now carries both text roles (clause 2) — but it did NOT touch the thing this guard
  // pins, and the numbers say so: `text.secondary` on white-tinted glass over the gradient still
  // measures 2.92-4.40:1 in dark mode under the Cold Read palette — every pair short of the 4.5:1
  // floor, so the failure this guard asserts is as real as it was on the espresso wash, and the
  // headroom it leaves is what pins that wash's minimum lightness. It now iterates
  // `WhiteTintedGlassTones` (which includes the NEW `control` tone) rather than a hardcoded pair,
  // so the frosted control fill is covered by it too.
  //
  // Scoped to DARK GLASS OVER THE GRADIENT, and both halves of that scope are load-bearing:
  //
  //   - Light-mode glass is white over already-light stops and clears AA for secondary text with
  //     room to spare. Asserting a failure there would be asserting something untrue.
  //   - Dark glass over the flat `background` ALSO clears it — a white wash over the near-black
  //     canvas still leaves a dark surface. The constraint is specifically about glass over the
  //     bright end of the page wash.
  //
  // So the contract is deliberately WIDER than the measured failure: `Glass` says primary-only
  // everywhere, not "primary-only when you happen to be over a gradient". That is on purpose — a
  // component cannot know what is behind it, and a rule that holds only sometimes is a rule that
  // will be broken. This guard pins the case that actually fails so the alpha cannot drift up.
  const constrainedPairs = glassSecondaryFailurePairs.filter(
    (p) => p.label.startsWith('dark ') && p.label.includes('gradient.page')
  );

  it('has pairs to check at all (guards against the filter silently matching nothing)', () => {
    expect(constrainedPairs.length).toBeGreaterThan(0);
  });

  test.each(constrainedPairs)(
    '$label falls short of AA — which is why the contract excludes it',
    ({ fg, bg }) => {
      expect(contrastRatio(fg, bg)).toBeLessThan(AA_TEXT);
    }
  );
});

describe('theme contrast — non-text pairs clear AA (>=3:1)', () => {
  test.each(scoreFillPairs)('$label', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  test.each(accentNonTextPairs)('$label', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  test.each(controlBorderPairs)('$label', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  // Added 2026-08-02 with the captain's translucent-glass decision. These two blocks are what make
  // a frosted control honest: the fill cannot carry WCAG 1.4.11 (an 8-13% wash reads ~1.1:1 and no
  // alpha that clears 3:1 is still translucent), so the RING carries it, on both of its sides —
  // against the page wash outside it and against the frosted fill inside it.
  test.each(controlRingOnWashPairs)('$label', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  test.each(controlRingOnGlassPairs)('$label', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  // The meter rule (2026-09-04). Held to the non-text floor even though a decorative line is
  // formally exempt, because the same token draws the ring a score's fill sits inside — a reader
  // who cannot see the ring cannot see where the fill starts.
  test.each(meterRulePairs)('$label', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

describe('the meter track stays a track — 2026-09-04', () => {
  // The mirror of the `hairline` guard below: `Meter.*.track` is the UNFILLED remainder of a score
  // ring, and its whole job is to be quieter than the `Score.*.fill` arc drawn over it. If this
  // starts failing, the track has been strengthened into something that competes with the score
  // it is supposed to be the backdrop for — at which point a ring's fill length stops reading.
  test.each(meterTrackBelowFloorPairs)('$label', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeLessThan(AA_NON_TEXT);
  });

  // The rule and the track are two roles, not one value at two opacities.
  test.each(SCHEMES)('%s: meter.rule !== meter.track', (scheme) => {
    expect(Meter[scheme].rule).not.toBe(Meter[scheme].track);
  });
});

describe('the interactive-boundary regression guard — issue #96', () => {
  // Proves the bug this token fixes still exists in the token it fixes it FROM: every non-accent
  // button/input/checkbox that painted its boundary with `hairline` alone was, and remains,
  // below the WCAG 1.4.11 floor. If this ever starts failing, `hairline` was strengthened enough
  // to accidentally double as a control boundary — which would mean `control.border` is no
  // longer proven distinct from it, and the guard below (which checks they're different values)
  // would need to be revisited too.
  test.each(hairlineBelowControlFloorPairs)('$label', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeLessThan(AA_NON_TEXT);
  });

  // The direct regression case: if `control.border` were ever set back to `hairline` (or any
  // value this weak), the `controlBorderPairs` assertions above would fail on their own — but
  // asserting the two tokens are literally distinct, per scheme, catches the mistake even before
  // that, and documents that this is a genuinely new role, not a re-tune of the old one.
  test.each(SCHEMES)('%s: control.border !== hairline', (scheme) => {
    expect(Colors[scheme].control.border).not.toBe(Colors[scheme].hairline);
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
    expect(contrastRatio(Accent.value, Accent.value)).toBeCloseTo(1, 5);
  });
});

describe('hue separation — no chromatic role may collide with another', () => {
  // WHY THIS EXISTS, and why it is not redundant with the contrast blocks above: contrast measures
  // a colour against its BACKGROUND, and every band in this palette clears its floor. What no
  // contrast assertion can catch is two bands, or a band and the accent, landing on the same hue —
  // at which point "Solid" and "Strong" are the same picture, or a score reads as a button. The
  // >=30 degree floor is `theme.ts`'s own long-standing rule (see MIN_HUE_SEPARATION in
  // contrast.ts for why 30 and not 20), and it is what forced the 2026-09-04 ramp to vacate teal
  // when the accent became cyan. Computed per scheme from the shipped hexes, so a "small" tweak to
  // one band that quietly walks it into a neighbour fails here rather than in someone's eyes.
  const chromaticRoles = (scheme: ColorScheme): { name: string; hex: string }[] => [
    ...ScoreBandOrder.map((band) => ({ name: `score.${band}.fill`, hex: Score[band][scheme].fill })),
    { name: 'accent', hex: Accent.value },
    { name: 'semantic.error', hex: Semantic.error[scheme] },
  ];

  test.each(SCHEMES)('%s: every role is genuinely chromatic (a grey has no hue to separate)', (scheme) => {
    for (const { name, hex } of chromaticRoles(scheme)) {
      expect({ name, hue: hue(hex) }).not.toEqual({ name, hue: null });
    }
  });

  const pairs = SCHEMES.flatMap((scheme) => {
    const roles = chromaticRoles(scheme);
    return roles.flatMap((a, i) =>
      roles.slice(i + 1).map((b) => ({ label: `${scheme}: ${a.name} vs ${b.name}`, a, b }))
    );
  });

  it('has pairs to check at all (guards against the generator silently producing none)', () => {
    expect(pairs.length).toBeGreaterThan(0);
  });

  test.each(pairs)('$label', ({ a, b }) => {
    const [hueA, hueB] = [hue(a.hex), hue(b.hex)];
    // Non-null is asserted above; this narrows for TypeScript and fails loudly rather than
    // silently passing a comparison against a null.
    expect(hueA).not.toBeNull();
    expect(hueB).not.toBeNull();
    expect(hueSeparation(hueA as number, hueB as number)).toBeGreaterThanOrEqual(MIN_HUE_SEPARATION);
  });

  // The score ramp's ORDERING claim, which the Cold Read re-cut is the first palette to satisfy:
  // bad -> good and warm -> cool are the same journey, with no doubling back between bands. The
  // espresso ramp put `good` at 195 degrees and `strong` at 152, so moving UP the scale moved
  // BACKWARDS round the wheel between the top two bands. Measured from `low` as the origin so the
  // wrap at 360 (low sits at ~350) does not turn a monotonic ramp into a false failure.
  test.each(SCHEMES)('%s: the ramp runs one way round the wheel, in band order', (scheme) => {
    const origin = hue(Score.low[scheme].fill) as number;
    const fromLow = ScoreBandOrder.map((band) => {
      const h = hue(Score[band][scheme].fill) as number;
      return (h - origin + 360) % 360;
    });
    expect(fromLow).toEqual([...fromLow].sort((x, y) => x - y));
  });
});
