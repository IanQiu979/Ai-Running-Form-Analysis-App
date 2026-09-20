/**
 * V23-01 · Theme sheet — the design tokens of the 2026-09-13 redesign, transcribed from the
 * captain-approved Claude Design page (`V23-01 Theme sheet.dc.html`). Every value here is the
 * page's own; where the page and the older `design-animation-spec-2026-09-12.md` disagree, the
 * page wins. Both are out-of-repo Claude Design handoff artifacts — they live in the captain's
 * external handoff folder beside the V23 pages and screenshots, not in this repository — so
 * neither is a file to look for here; the "spec A.x" citations below point into that document.
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
 *
 * ONE HAND-SYNCED COPY EXISTS OUTSIDE THE APP: `docs/privacy-policy-theme/style.css` transcribes
 * `Ink`/`Type`/`Font` for the published privacy-policy page (no shared build step reaches a
 * static Jekyll page). An edit here that could visibly drift the two is re-checked there.
 */
import { Platform, type TextStyle } from 'react-native';

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
  /** The one card that is "this one" among siblings — V23-11's current-plan card. A half step
   *  above `bgRaised`; still a surface, never a text tone. */
  bgSelected: '#1A1A1A',
  /** A box waiting for an image (V23-09's frame deck before its signed URLs land). Sits above a
   *  `bgRaised` card so the empty cell still reads as a cell. Decorative only. */
  bgPlaceholder: '#1E1E1E',
} as const;

/**
 * The two translucent values the lane-2 pages draw (V23-07's floating tab bar and V23-09/12's
 * dimmed backdrop under a confirm dialog). Kept OUT of `Ink` on purpose: `Ink` is the sheet's
 * eight opaque swatches and the contrast test reads every entry as a hex triplet. Neither of
 * these ever carries text of its own — the tab bar's labels are proven on the opaque `bgRaised`
 * the blur resolves toward, and a dialog's text sits on its own `bgRaised` card.
 */
export const Chrome = {
  /** V23-07's tab bar: `rgba(20,20,20,.85)` over a 16 pt backdrop blur, ruled in `line`. */
  tabBar: 'rgba(20,20,20,0.85)',
  tabBarBlur: 16,
  /** What sits over a screen while a confirm dialog is up. The pages draw it as
   *  `filter: brightness(.4)` on the content; a 60 % black scrim over the same content lands on
   *  the same luminance without a filter primitive RN does not have. */
  scrim: 'rgba(10,10,10,0.6)',
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
  /** The pages' `ui-monospace, Menlo, monospace` — the platform's own mono, nothing loaded.
   *  Dates, quota counts, prices, the recording clock: a measured value reads in mono. */
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }),
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
  /** Score 96/96 · Barlow Condensed 800 · tabular · +2 % (1.92 pt). The overall numeral on
   *  Home's recent card and the result's Overall block (V23-07 / V23-08). */
  score: {
    fontFamily: Font.condensed.extraBold,
    fontSize: 96,
    lineHeight: 96,
    letterSpacing: 1.92,
    fontVariant: ['tabular-nums'],
  },
  /** Score 64/64 · Barlow Condensed 800 · tabular · +2 % (1.28 pt). The pillar detail modal's
   *  numeral (V23-08, third artboard). */
  scoreMd: {
    fontFamily: Font.condensed.extraBold,
    fontSize: 64,
    lineHeight: 64,
    letterSpacing: 1.28,
    fontVariant: ['tabular-nums'],
  },
  /** Display 40/44 · Barlow Condensed 800 · uppercase · +2 % (0.8 pt). Screen titles. */
  display: {
    fontFamily: Font.condensed.extraBold,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  /** Display, one step down: 32/36 · Barlow Condensed 800 · uppercase · +2 % (0.64 pt). The
   *  consent gate's "Before you upload" and the paywall's "Choose a plan" (V23-10 / V23-11). */
  displaySm: {
    fontFamily: Font.condensed.extraBold,
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: 0.64,
    textTransform: 'uppercase',
  },
  /** Display numeral 40/44 · Barlow Condensed 800 · tabular · +2 % (0.8 pt). `display` without
   *  the uppercase: a pillar's letter on the result rows and the history row's overall numeral
   *  (V23-08 / V23-09). */
  displayFigure: {
    fontFamily: Font.condensed.extraBold,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: 0.8,
    fontVariant: ['tabular-nums'],
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
  /** Pillar letter 28/32 · Barlow Condensed 800. Home's P / A / C / E row (V23-07). */
  letter: {
    fontFamily: Font.condensed.extraBold,
    fontSize: 28,
    lineHeight: 32,
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
  /** Body, small: 14/20 · Inter Tight 400. The consent gate's checkbox lines (V23-10). */
  bodySm: {
    fontFamily: Font.tight.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  /** 14/20 · Inter Tight 500. The history row's underlined "Delete" word (V23-09). */
  bodySmMedium: {
    fontFamily: Font.tight.medium,
    fontSize: 14,
    lineHeight: 20,
  },
  /** 14/20 · Inter Tight 600. A risk flag's or drill's name in the pillar detail (V23-08). */
  bodySmSemi: {
    fontFamily: Font.tight.semiBold,
    fontSize: 14,
    lineHeight: 20,
  },
  /** Note 13/18 · Inter Tight 400. A card's supporting sentence — the source picker's
   *  subtitles, a tier's detail, a not-assessed reason, the privacy body (V23-08..12). Same size
   *  as `small`, two points more leading, because it runs to several lines. */
  note: {
    fontFamily: Font.tight.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  /** Mono 13/16 · the platform mono, 400. Dates, quota captions, prices, the record clock. */
  mono: {
    fontFamily: Font.mono,
    fontSize: 13,
    lineHeight: 16,
  },
  /** Footnote 12/18 · Inter Tight 400. The result disclaimer, the framing tip, the paywall's
   *  closing line (V23-08 / V23-10 / V23-11). */
  footnote: {
    fontFamily: Font.tight.regular,
    fontSize: 12,
    lineHeight: 18,
  },
  /** Tab label 11/12 · Inter Tight 500 · uppercase · +6 % (0.66 pt). The tab bar only. */
  tab: {
    fontFamily: Font.tight.medium,
    fontSize: 11,
    lineHeight: 12,
    letterSpacing: 0.66,
    textTransform: 'uppercase',
  },
  /** Fine print 11/14 · Inter Tight 400. The sign-up consent line. */
  fine: {
    fontFamily: Font.tight.regular,
    fontSize: 11,
    lineHeight: 14,
  },
  /** Metric, small: 20/24 · Barlow Condensed 700 · tabular. The four pillar scores under their
   *  letters on Home's recent card (V23-07). */
  metricSm: {
    fontFamily: Font.condensed.bold,
    fontSize: 20,
    lineHeight: 24,
    fontVariant: ['tabular-nums'],
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
  /** The larger card padding the lane-2 pages use for a screen's lead card (Home's recent
   *  analysis, the result's Overall card, a tier card, a source card, a confirm dialog). */
  cardPaddingLg: 24,
  /** A screen's top chrome row (V23-07..12): the title line, the back / settings control. */
  topBarHeight: 44,
  /** A 44 pt icon control hangs 12 pt past the gutter so its GLYPH, not its box, aligns with
   *  the column (`margin-right:-12px` on every page). */
  iconBleed: 12,
  /** A settings row (V23-12): label left, value or action right. */
  rowHeight: 56,
  /** The tab bar (V23-07 / V23-09): 64 pt tall, 16 pt in from each side, above the bottom inset. */
  tabBar: { height: 64, inset: 16 },
  /** The consent gate's checkbox (V23-10): a 20 pt drawn square. Larger than the sign-up
   *  line's 12 pt `checkbox` because these lines are the screen, not a footer. */
  consentCheckbox: 20,
  /** The record screen's stop control (V23-10, third artboard): a 72 pt ring, 2 pt `ink`
   *  border, with a 28 pt `danger` square inside. */
  recordButton: { size: 72, border: 2, stop: 28 },
  /** The source picker's icon badge (V23-10): a 56 pt square ruled in `line`. */
  sourceBadge: 56,
  /** V23-09's frame deck: three 44 pt squares, each overlapping the previous by half, ruled 2 pt
   *  in the card's own fill so the overlap reads. */
  frameDeck: { size: 44, overlap: 22, border: 2 },
  /** The 2 pt score bar under a result pillar row (V23-08). */
  scoreBar: 2,
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
    /** The entry flow's scroll-driven story (2026-09-20, captain's device test): each section's
     *  items rise over this — deliberately slower than `rise`, so the flow reads as calm. Kept
     *  under the ~1.2 s per item the captain set as the ceiling. */
    storyRise: 1000,
    /** The hero's "Scroll down" cue fades in over this — the story's slower register, not
     *  `fade`, which the analyzing laser keeps. */
    storyFade: 500,
  },
  /** Sibling stagger, ms. `story` is the entry flow's, twice `item` so the stagger is felt. */
  stagger: { min: 40, item: 60, max: 80, story: 120 },
  /** The page transition's vertical shift. */
  pageShift: 12,
  /** Home's pillar ticker: one full loop of the strip every 18 s, linear, forever (V23-07). */
  marqueeLoop: 18000,
} as const;

/** Every foreground role that is allowed to carry text a user must read. Exported so the
 *  contrast test iterates exactly this set. */
export const ReadableInk = ['ink', 'ink2', 'danger'] as const;

/** The two opaque surfaces text may sit on. */
export const Surfaces = ['bg', 'bgRaised'] as const;
