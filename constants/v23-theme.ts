/**
 * V23-01 · Theme sheet — the design tokens of the 2026-09-13 redesign, transcribed from the
 * captain-approved Claude Design page (`V23-01 Theme sheet.dc.html`). Every value here is the
 * page's own; where the page and the older `design-animation-spec-2026-09-12.md` disagree, the
 * page wins.
 *
 * ONE SCHEME. This system is dark only — "everything is built on the black of the hero"
 * (spec A.0). There is no light palette to derive and no `useColorScheme` branch to take: a
 * screen on these tokens paints `Ink.bg` and is done. That is also why the file is flat
 * (`Ink.bg`, not `Colors.dark.background`) — there is nothing to index by.
 *
 * WHY A SEPARATE FILE FROM `constants/theme.ts`. That file is the Cold Read system every
 * currently-shipping screen is built on, and its exports (`Gradient`, `Glass`, `Score`, `Radius.pill`,
 * the three Cold Read families) encode a different visual language: page washes, frosted glass,
 * rounded pills, colour-coded score bands. This redesign has none of those — square corners, one
 * flat black, no chromatic accent — so replacing `theme.ts` in place would have broken every
 * screen at once while lane 2 (Home / Result / History / Capture / Paywall / Settings) had not yet
 * been re-cut. Screens migrate one at a time: the entry flow (hero, details, sign-up) and the
 * analyzing screen consume this file now; lane 2 moves the rest. Once nothing imports
 * `constants/theme.ts` it is deleted and this file takes its name.
 *
 * CONTRAST is proven, not asserted, in `constants/__tests__/v23-theme-contrast.test.ts`:
 * `ink` / `ink2` clear 4.5:1 on both surfaces, `ink3` is a placeholder/disabled tone and is
 * deliberately UNDER 4.5:1 (it must never carry copy the user has to read), `line` is decorative
 * and stays under 3:1, and `danger` clears 4.5:1 as text on both surfaces.
 *
 * Naming is by role, never by appearance, so a value can move without a call site changing.
 */
import type { TextStyle } from 'react-native';

// -------------------------------------------------------------------------------------------
// Colour — the page's eight swatches, in its order. Black, white and grey only; `danger` is the
// single chromatic value in the system and is for errors only.
// -------------------------------------------------------------------------------------------

export const Ink = {
  /** App background. The hero's black. */
  bg: '#0A0A0A',
  /** Cards, pillar boxes, sheets, input fills. */
  bgRaised: '#141414',
  /** 1 px hairlines and box borders. Decorative — under 3:1 on both surfaces by design. */
  line: '#2A2A2A',
  /** Primary text. */
  ink: '#F5F5F5',
  /** Secondary text, labels, metric units. */
  ink2: '#9A9A9A',
  /** Disabled controls and placeholders ONLY — under 4.5:1, so never body copy. */
  ink3: '#5C5C5C',
  /** The one accent: the primary CTA fill and the live metric highlight. Pure white. */
  accent: '#FFFFFF',
  /** The only legal text colour on an `accent` fill. */
  onAccent: '#0A0A0A',
  /** Errors only. */
  danger: '#E5484D',
} as const;

// -------------------------------------------------------------------------------------------
// Type — two families, five weights, loaded in `app/_layout.tsx`'s `useFonts`:
//   Barlow Condensed 700 / 800  — display, headings, metrics, the analyzing clock
//   Inter Tight 400 / 500 / 600 — body, labels, controls
// -------------------------------------------------------------------------------------------

export const Font = {
  condensed: {
    bold: 'BarlowCondensed_700Bold',
    extraBold: 'BarlowCondensed_800ExtraBold',
  },
  tight: {
    regular: 'InterTight_400Regular',
    medium: 'InterTight_500Medium',
    semiBold: 'InterTight_600SemiBold',
  },
} as const;

/**
 * The page's type scale, each role a complete `TextStyle` so a call site spreads it and adds
 * only a colour: `[Type.label, { color: Ink.ink2 }]`. Sizes and line heights are the page's
 * `size/line` pairs verbatim; `letterSpacing` is the page's em tracking resolved to points at
 * that size (RN takes points, not em), so it holds only at the role's own size.
 *
 * Uppercase is a property of exactly two roles — `display` and `label` — and nothing else.
 */
export const Type = {
  /** Display 40/44 · Barlow Condensed 800 · uppercase · +2 % (0.8 pt). Screen titles. */
  display: {
    fontFamily: Font.condensed.extraBold,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  /** H1 28/32 · Barlow Condensed 700 · sentence case. */
  h1: {
    fontFamily: Font.condensed.bold,
    fontSize: 28,
    lineHeight: 32,
  },
  /** H2 20/24 · Inter Tight 600 · sentence case. An open pillar box's name. */
  h2: {
    fontFamily: Font.tight.semiBold,
    fontSize: 20,
    lineHeight: 24,
  },
  /** Body 16/24 · Inter Tight 400. Paragraphs, inputs, status lines. */
  body: {
    fontFamily: Font.tight.regular,
    fontSize: 16,
    lineHeight: 24,
  },
  /** Label 13/16 · Inter Tight 500 · uppercase · +6 % (0.78 pt). Eyebrows, button labels, the
   *  pillar name under a letter, the hero's callout names. */
  label: {
    fontFamily: Font.tight.medium,
    fontSize: 13,
    lineHeight: 16,
    letterSpacing: 0.78,
    textTransform: 'uppercase',
  },
  /** Small 13/16 · Inter Tight 400 · sentence case. Footer links, inline field errors, an open
   *  pillar box's healthy range, the hero's callout sub-lines. Same size as `label`, never
   *  tracked or uppercased — it is running text, not a signpost. */
  small: {
    fontFamily: Font.tight.regular,
    fontSize: 13,
    lineHeight: 16,
  },
  /** Fine print 11/14 · Inter Tight 400. The sign-up consent line. */
  fine: {
    fontFamily: Font.tight.regular,
    fontSize: 11,
    lineHeight: 14,
  },
  /** Metric 32/36 · Barlow Condensed 700 · tabular figures. A number with its unit beside it in
   *  `body` + `ink2` (see `Type.metricUnit`). */
  metric: {
    fontFamily: Font.condensed.bold,
    fontSize: 32,
    lineHeight: 36,
    fontVariant: ['tabular-nums'],
  },
  /** The unit set beside a metric — Body 16/24 in `ink2`, baseline-aligned to the number. */
  metricUnit: {
    fontFamily: Font.tight.regular,
    fontSize: 16,
    lineHeight: 24,
  },
  /** The analyzing screen's stopwatch: 48/52 · Barlow Condensed 800 · tabular · +2 % (0.96 pt).
   *  The one size on the sheet that is not on the type-scale column — it is set on the V23-05
   *  page itself. */
  clock: {
    fontFamily: Font.condensed.extraBold,
    fontSize: 48,
    lineHeight: 52,
    letterSpacing: 0.96,
    fontVariant: ['tabular-nums'],
  },
} as const satisfies Record<string, TextStyle>;

// -------------------------------------------------------------------------------------------
// Space — the 8 pt grid. `Layout` names the handful of fixed dimensions the pages repeat
// verbatim so a screen never re-types them.
// -------------------------------------------------------------------------------------------

export const Space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  section: 40,
  xxxl: 48,
} as const;

export const Layout = {
  /** Page gutter, left and right. */
  gutter: 24,
  /** Between sections on a page (spec: "section gap 40 pt"). */
  sectionGap: 40,
  /** Primary and secondary buttons, text inputs. */
  controlHeight: 56,
  /** Padding inside a card or pillar box. */
  cardPadding: 16,
  /** The 2 x 2 pillar grid's gap. */
  gridGap: 8,
  /** Minimum tappable square for a text-only or icon-only control (the open box's close). */
  hitTarget: 44,
  /** The sign-up consent checkbox: a 12 pt drawn square (the row around it is `hitTarget`). */
  checkbox: 12,
  /** The design canvas the pages were drawn on — iPhone 15/16 class, safe areas 59 / 34. The
   *  hero is composed against this frame and centred on anything larger; every other screen
   *  reads its live insets and uses these only as the design's minimum top/bottom breathing room. */
  canvas: { width: 393, height: 852, safeTop: 59, safeBottom: 34 },
  /** Square corners everywhere. Named so a call site can say so explicitly. */
  radius: 0,
  /** Hairline weight. */
  hairline: 1,
} as const;

// -------------------------------------------------------------------------------------------
// Motion — the page's Motion block, verbatim. Durations in ms; curves as cubic-bezier control
// points for `Easing.bezier(...)`. Nothing bounces.
// -------------------------------------------------------------------------------------------

export const Motion = {
  curve: {
    /** Anything arriving. */
    arrive: [0.16, 1, 0.3, 1],
    /** Anything moving in place. */
    move: [0.65, 0, 0.35, 1],
    /** Progress only. */
    linear: [0, 0, 1, 1],
  },
  duration: {
    /** The arrive range's floor and ceiling; a single element arrives inside it. */
    arriveMin: 400,
    arriveMax: 700,
    /** The details page's rise-and-fade per item. */
    rise: 600,
    /** A pillar box opening or closing. */
    expand: 320,
    /** A page transition: fade plus a 12 pt vertical shift. */
    page: 250,
    /** The hero's cue and the analyzing laser both fade over this. */
    fade: 300,
  },
  /** Sibling stagger, ms. */
  stagger: { min: 40, item: 60, max: 80 },
  /** The page transition's vertical shift. */
  pageShift: 12,
} as const;

/** Every foreground role that is allowed to carry text a user must read. Exported so the
 *  contrast test iterates exactly this set. */
export const ReadableInk = ['ink', 'ink2', 'danger'] as const;

/** The two opaque surfaces text may sit on. */
export const Surfaces = ['bg', 'bgRaised'] as const;
