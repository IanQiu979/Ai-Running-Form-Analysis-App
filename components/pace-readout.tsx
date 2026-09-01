/**
 * The PACE readout (issue #56) — the four-pillar score block that is the product's payload
 * (design brief §3: "this four-row block ... is the app's signature screen element").
 *
 * CADENCE ARCS (2026-09-01): THE BARS ARE NOW RINGS. The overall score is one large arc ring and
 * each pillar carries its own small one, drawn by `components/ui/arc-ring.tsx`. This is a
 * presentation change and ONLY a presentation change — it reads the exact same `PaceResult` shape
 * it always has (`overall.score`/`overall.band` and each pillar's `score`/`band`), converts a
 * 0-100 score to a 0-1 sweep at the point of render, and sends nothing new to the server. The API
 * contract is untouched.
 *
 * A ring is a better carrier for this data than a bar was, for a reason specific to the payload:
 * a bar's length is only readable against the length of the bars around it, so four bars in a
 * column invite comparison between pillars, which is precisely the reading PACE does not want
 * (the four pillars are not a leaderboard). A ring is read against its own full circle, so each
 * pillar is judged against 100, not against Posture.
 *
 * THE RULE THIS FILE MUST NEVER BREAK: `score: null` is a first-class, common state (every photo
 * submission reports two pillars this way — motion-over-time pillars a single frame cannot
 * show), not an error. A not-assessed pillar renders NO numeral, NO band word, and NO swept arc
 * — only a hollow, DASHED ring track and a plain-language reason. It must never read as a zero,
 * and never as a greyed-out fake score. `<PillarRow>` below enforces this by construction: the
 * numeral/band-word elements are only ever mounted when `pillar.score !== null`, and `<ArcRing>`
 * independently enforces the same thing for the arc itself (it mounts no fill at all for a `null`
 * fraction — see its header). There is no code path that stringifies `null` into "0", and there
 * is no code path that turns it into a 0% sweep.
 *
 * Tier gating (Free: scores + one line, no drills, no flags; Pro/Elite: fuller feedback + flags
 * + drills) is never re-derived here (CLAUDE.md: no business rules in the client) — the server
 * already ships `flags: []` / `drills: []` for Free and not-assessed pillars, so this component
 * just renders whichever arrays it's given and never shows an empty "Flags"/"Drills" heading.
 *
 * No hero-frame annotation overlay (ground rule / posture line / landing marker per design brief
 * §1) is drawn here — `PaceResult` carries no coordinate data for one, and inventing overlay
 * geometry the contract doesn't provide would be exactly the kind of fabrication this file exists
 * to refuse. `app/result/[id].tsx` renders the stored frame plainly instead.
 *
 * MOTION (issue #61): `firstReveal` is the only thing that switches this file off its default,
 * static render. False (the overwhelmingly common case — every re-open from Past Analyses) renders
 * every ring already at its final sweep with nothing scheduled. True (set by `app/result/[id].tsx`
 * only when the `justAnalyzed` nav param is present, motion-consult.md item 3) switches to one of
 * two reveal modes, chosen by `useReducedMotion()`: `animate` (the staggered scaleX fill +
 * numeral count-up, `components/pace-reveal.tsx`) or `crossfade` (brief §6: reduced motion gets
 * "a single crossfade, no stagger, no count-up" — implemented here as one opacity animation over
 * the whole readout, still showing the exact same final static content `instant` mode does).
 * Either reveal mode waits for `onLayout` before starting (motion-consult.md item 4: "first-
 * visible, not on-mount" — the same trigger indirection a future scroll-linked reveal would need,
 * so swapping this for real viewability later is additive, not a container change).
 *
 * That three-way choice is the whole of #61's reduced-motion scope and every way it can break is
 * SILENT — a lost `reduceMotion` branch animates at a user who asked the OS not to, a lost
 * `firstReveal` branch re-animates history, and a lost crossfade leaves the block at `opacity: 0`
 * with nothing to raise it. So the container carries `testID="pace-readout"` purely so
 * `components/__tests__/pace-readout-reveal.test.tsx` can prove which mode is live from the tree
 * that actually mounted; the primitives' own invariants are locked in `pace-reveal.test.tsx`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { KineticText } from '@/components/kinetic-text';
import { AnimatedOverallNumeral } from '@/components/pace-reveal';
import { PillarDetailModal } from '@/components/pillar-detail-modal';
import { ArcRing } from '@/components/ui/arc-ring';
import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Copy } from '@/constants/copy';
import {
  Arc,
  Colors,
  FontFamily,
  FontSize,
  LineHeight,
  Motion,
  Radius,
  Score,
  ScoreBandLabel,
  Spacing,
  Tracking,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import {
  isRevealTriggered,
  notAssessedCopy,
  overallA11yLabel,
  pillarA11yLabel,
  pillarDetailA11yLabel,
  pillarLabel,
  pillarLetter,
} from '@/lib/pace-readout';
import { PACE_PILLARS, type PacePillarId, type PacePillarResult, type PaceResult } from '@shared/pace';

type Props = {
  result: PaceResult;
  /** True only on the fresh-analysis nav (`justAnalyzed=1`) — see this file's header. Defaults to
   * false, i.e. every call site that doesn't pass it renders exactly as before #61. */
  firstReveal?: boolean;
  /** Moment 3 sequencing (Phase 2 plan Task 5, spec 2026-07-26 §4): "annotations draw, THEN the
   * bars fill." Defaults to `true` — every call site from before this prop existed keeps its
   * exact behavior (reveal starts the instant layout fires). `app/result/[id].tsx` is the one
   * caller that passes `false` while the hero's annotation lines are still drawing. See
   * `lib/pace-readout.ts`'s `isRevealTriggered` for the actual gate. */
  revealReady?: boolean;
};

/** `instant`: today's static render (also what a reduced-motion first reveal's own inner content
 * uses — only the outer crossfade differs). `animate`: the staggered fill + count-up. `crossfade`:
 * brief §6's reduced-motion variant. */
type RevealMode = 'instant' | 'animate' | 'crossfade';

// Ring geometry. These are COMPOSITION, not tokens, and they live here rather than in
// `constants/theme.ts` on purpose: a ring's diameter is a decision about this screen's hierarchy —
// how much louder the overall score is than a pillar — not a reusable scale step. `constants/
// theme.ts`'s own rule is to publish a token when a value repeats across screens, and no other
// screen wants these exact two sizes.
//
// The proportion is what carries the meaning: the overall ring is ~3.25x a pillar ring's diameter,
// which is the same order of hierarchy the old layout got from a 96pt numeral over a 12pt bar.
const OVERALL_RING_SIZE = 208;
const OVERALL_RING_STROKE = 14;
const PILLAR_RING_SIZE = 64;
const PILLAR_RING_STROKE = 6;

/** "~50ms stagger P->A->C->E" — motion-consult.md item 1, carried over verbatim from the bar fill
 *  the rings replace. */
const PILLAR_RING_STAGGER_MS = 50;

export function PaceReadout({ result, firstReveal = false, revealReady = true }: Props) {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const reduceMotion = useReducedMotion();
  const revealMode: RevealMode = !firstReveal ? 'instant' : reduceMotion ? 'crossfade' : 'animate';

  // The onLayout-gated reveal trigger (see this file's header), now additionally gated by
  // `revealReady` (Phase 2 plan Task 5) via the pure `isRevealTriggered` — fires once, ever, per
  // mount, and only once both conditions are true. Irrelevant (never attached) in `instant` mode.
  const [hasLaidOut, setHasLaidOut] = useState(false);
  const hasLaidOutRef = useRef(false);
  const handleFirstLayout = useCallback(() => {
    if (hasLaidOutRef.current) return;
    hasLaidOutRef.current = true;
    setHasLaidOut(true);
  }, []);
  const revealed = isRevealTriggered(hasLaidOut, revealReady);

  const crossfadeOpacity = useSharedValue(0);
  useEffect(() => {
    if (revealMode !== 'crossfade' || !revealed) return;
    crossfadeOpacity.value = withTiming(1, {
      duration: Motion.duration.standard,
      easing: Easing.bezier(...Motion.curve.easeOut),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- crossfadeOpacity is a stable shared value
  }, [revealMode, revealed]);
  const crossfadeStyle = useAnimatedStyle(() => ({
    opacity: revealMode === 'crossfade' ? crossfadeOpacity.value : 1,
  }));

  const { overall } = result;

  return (
    <Animated.View
      testID="pace-readout"
      style={[styles.container, revealMode === 'crossfade' && crossfadeStyle]}
      onLayout={revealMode !== 'instant' ? handleFirstLayout : undefined}>
      {/* `accessibilityRole="header"`, not just `accessible`: `app/result/[id].tsx` states in its
          own body comment that this block IS that screen's heading (the copy deck defines no
          `result.title`, so there is deliberately no other title element). Saying so in a comment
          did not put it in VoiceOver's rotor — until this role landed, `/result/[id]` and
          `/result/sample` were the only two screens in the app with ZERO headings, so a screen
          reader user had no way to jump to the score and had to swipe the hero and both banners
          to reach it. The role rides on the existing single accessible node; the spoken label is
          unchanged. */}
      <View
        style={styles.overallBlock}
        accessible
        accessibilityRole="header"
        accessibilityLabel={overallA11yLabel(overall)}>
        <Eyebrow>{Copy.result.overall.label}</Eyebrow>
        {/* THE SIGNATURE ELEMENT. One large ring carrying the four-pillar average, with the
            numeral and band word set inside it. The ring's fill colour is the band's own proven
            `fill` role, so the score is encoded THREE ways — arc length, arc colour, and the
            numeral — which is one more than the bar it replaces managed.
            A not-assessed overall still gets a ring: the same dashed, empty track every
            not-assessed pillar gets, so "we could not score this" looks like the same idea at
            every scale on this screen rather than like a different component. */}
        <ArcRing
          testID="overall-ring"
          size={OVERALL_RING_SIZE}
          strokeWidth={OVERALL_RING_STROKE}
          fraction={overall.score !== null ? overall.score / 100 : null}
          color={overall.band !== null ? Score[overall.band][scheme].fill : Arc[scheme].ornament}
          animate={revealMode === 'animate'}
          // The overall leads; the four pillars follow it (see `PILLAR_RING_STAGGER_MS`), so the
          // headline number lands first and the detail assembles under it.
          delayMs={0}>
          {overall.score !== null && overall.band !== null ? (
            <View style={styles.overallScoreStack}>
              {revealMode === 'animate' ? (
                <AnimatedOverallNumeral
                  testID="overall-score"
                  style={styles.overallNumeral}
                  value={overall.score}
                  triggered={revealed}
                />
              ) : (
                // Dynamic Type guard (brief §7: never hard-clip the score readout). At
                // FontSize.display a scaled-up numeral would otherwise run past the ring, so it
                // shrinks to fit its line instead of clipping. The ring itself never clips its
                // centred content — see `<ArcRing>` — so the worst case is a numeral that grows
                // toward the ring's inner edge, not one that gets cut off by it.
                <Text
                  testID="overall-score"
                  style={styles.overallNumeral}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.5}>
                  {overall.score}
                </Text>
              )}
              <Text testID="overall-band" style={[styles.overallBand, { color: Score[overall.band][scheme].text }]}>
                {ScoreBandLabel[overall.band]}
              </Text>
            </View>
          ) : null}
        </ArcRing>
        {overall.score === null || overall.band === null ? (
          // Set BELOW the ring, not inside it: this is a sentence, not a readout, and a sentence
          // squeezed into a 208pt circle wraps to four words a line.
          <Text testID="overall-not-assessed" style={styles.overallNotAssessed}>
            {Copy.result.pillar.notAssessed.generic}
          </Text>
        ) : null}
      </View>

      <View style={styles.pillarList}>
        {PACE_PILLARS.map((id, index) => (
          <PillarRow
            key={id}
            pillarId={id}
            pillar={result.pillars[id]}
            colors={colors}
            scheme={scheme}
            revealMode={revealMode}
            index={index}
            triggered={revealed}
          />
        ))}
      </View>
    </Animated.View>
  );
}

function PillarRow({
  pillarId,
  pillar,
  colors,
  scheme,
  revealMode,
  index,
  triggered,
}: {
  pillarId: PacePillarId;
  pillar: PacePillarResult;
  colors: ThemeColors;
  scheme: ColorScheme;
  revealMode: RevealMode;
  index: number;
  triggered: boolean;
}) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const label = pillarLabel(pillarId);
  // Owned locally, not lifted to `<PaceReadout>` (only one pillar's modal can be open from one
  // row's own button at a time — no cross-row coordination needed).
  const [detailVisible, setDetailVisible] = useState(false);
  const hasFlagsOrDrills = pillar.flags.length > 0 || pillar.drills.length > 0;

  return (
    <View testID={`pillar-row-${pillarId}`} style={styles.pillarRow}>
      <View style={styles.pillarHeaderRow}>
        {/* The accessible-collapsing group is scoped to JUST the letter/name/score — the info
            button below is a SIBLING, not a child, of this node. Issue #62's own fix nearby
            (`pillar-row-${pillarId}` must not swallow feedback/flags/drills) is the same failure
            mode a button nested inside this `accessible` view would repeat: its own
            accessibilityLabel/role would be dropped in favor of one opaque parent label. */}
        <View
          testID={`pillar-header-${pillarId}`}
          style={styles.pillarHeaderInfo}
          accessible
          accessibilityLabel={pillarA11yLabel(label, pillar)}>
          {/* The pillar's own ring, with its numeral set inside it. Same component, same rules,
              a quarter of the size — which is the whole point of the motif: the overall score and
              a pillar score are the same kind of thing at two scales, not two different charts. */}
          <ArcRing
            testID={`pillar-ring-${pillarId}`}
            size={PILLAR_RING_SIZE}
            strokeWidth={PILLAR_RING_STROKE}
            fraction={pillar.score !== null ? pillar.score / 100 : null}
            color={pillar.band !== null ? Score[pillar.band][scheme].fill : Arc[scheme].ornament}
            animate={revealMode === 'animate'}
            // "~50ms stagger P->A->C->E" (motion-consult.md item 1) — carried over verbatim from
            // the bar fill this replaces, offset one step behind the overall ring's own sweep.
            delayMs={Motion.duration.quick + index * PILLAR_RING_STAGGER_MS}>
            {pillar.score !== null ? (
              <Text testID={`pillar-score-${pillarId}`} style={styles.scoreNumeral}>
                {pillar.score}
              </Text>
            ) : null}
          </ArcRing>
          <View style={styles.pillarNameBlock}>
            <View style={styles.pillarNameRow}>
              <Text style={styles.pillarLetter}>{pillarLetter(pillarId)}</Text>
              <Text style={styles.pillarName}>{label}</Text>
            </View>
            {pillar.band !== null ? (
              <Text testID={`pillar-band-${pillarId}`} style={[styles.bandWord, { color: Score[pillar.band][scheme].text }]}>
                {ScoreBandLabel[pillar.band]}
              </Text>
            ) : null}
          </View>
        </View>
        <CircleIconButton
          testID={`pillar-detail-button-${pillarId}`}
          accessibilityLabel={pillarDetailA11yLabel(label)}
          accessibilityHint={Copy.result.pillar.detail.a11yHint}
          onPress={() => setDetailVisible(true)}>
          <IconSymbol name="info.circle" size={FontSize.lg} color={colors.text.primary} />
        </CircleIconButton>
      </View>

      <PillarDetailModal
        visible={detailVisible}
        onDismiss={() => setDetailVisible(false)}
        pillarId={pillarId}
        pillar={pillar}
      />

      {/* The bar track that used to sit here is gone — the ring in the header row above IS the
          score's visual now, and drawing both would encode it twice in two competing shapes.
          M1 (v23-ux-audit-r1)'s requirement that a not-assessed pillar be structurally distinct
          from "filled at 0%" moved with it, into `<ArcRing>`'s dashed empty track. */}
      {pillar.score === null || pillar.band === null ? (
        <Text
          testID={`pillar-not-assessed-${pillarId}`}
          style={styles.notAssessedText}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          {notAssessedCopy(pillar.notAssessedReason)}
        </Text>
      ) : null}

      {/* THE COACH'S OWN WRITING, revealed word by word. This is the one element in the app where
          the per-word reveal is not decoration: the feedback sentence is what the user paid for,
          and assembling it makes it read as something being said rather than as a field that was
          populated. Gated on the same `revealMode` everything else here is — a re-open from Past
          Analyses (`instant`) renders it as a plain finished block with nothing scheduled, and
          reduced motion gets the single crossfade `KineticText` already falls back to. Staggered
          one step behind the bar fills (`index` offset) so a pillar's number lands before its
          sentence starts, never on top of it. */}
      {pillar.feedback ? (
        <KineticText
          testID={`pillar-feedback-${pillarId}`}
          play={revealMode !== 'instant' && triggered}
          delayMs={index * Motion.stagger.item + Motion.duration.standard}
          style={styles.feedbackText}
          containerStyle={styles.feedbackRow}>
          {pillar.feedback}
        </KineticText>
      ) : null}

      {/* A thin visual break between the coach's feedback and the flags/drills block below it —
          only when there IS a block below, so the divider never leads to nothing. Before this,
          the flags and drills sub-lists rendered back-to-back with byte-identical styling and no
          label distinguishing "this is a risk to watch for" from "this is an exercise to try". */}
      {hasFlagsOrDrills ? <View style={styles.divider} /> : null}

      {/* Tier gating without re-deriving tier rules: the server already ships `flags: []` for
          Free and every not-assessed pillar (`pace.ts`'s own doc comment), so an empty array is
          simply nothing to render — never an empty "Flags" heading. */}
      {pillar.flags.length > 0 ? (
        <View style={styles.subList} testID={`pillar-flags-${pillarId}`}>
          <Eyebrow>{Copy.result.pillar.flagsLabel}</Eyebrow>
          {pillar.flags.map((flag, index) => (
            <View key={`${flag.pattern}-${index}`} style={styles.subListItem}>
              <Text style={styles.subListTitle}>{flag.pattern}</Text>
              <Text style={styles.subListDetail}>{flag.detail}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {pillar.drills.length > 0 ? (
        <View style={styles.subList} testID={`pillar-drills-${pillarId}`}>
          <Eyebrow>{Copy.result.pillar.drillsLabel}</Eyebrow>
          {pillar.drills.map((drill, index) => (
            <View key={`${drill.name}-${index}`} style={styles.subListItem}>
              <Text style={styles.subListTitle}>{drill.name}</Text>
              <Text style={styles.subListDetail}>{drill.instructions}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      gap: Spacing.xl,
    },
    overallBlock: {
      alignItems: 'center',
      gap: Spacing.lg,
    },
    // `overallLabel` is gone — that hand-rolled "uppercase + letterSpacing: 1" style WAS the
    // eyebrow register, written before it had a token. It is now `<Eyebrow>`
    // (components/ui/eyebrow.tsx), so the same micro-label reads identically here and on every
    // other screen instead of each one re-deriving it.
    // The numeral and band word stack INSIDE the ring, rather than sitting side by side as they
    // did beside the bar. A row would have to fit both across the ring's inner diameter (180pt),
    // which the band words do not survive ("Needs work" at FontSize.lg is wider than that once
    // Dynamic Type touches it). Stacked, each has the full inner width to itself.
    overallScoreStack: {
      alignItems: 'center',
      gap: Spacing.xs,
    },
    overallNumeral: {
      color: colors.text.primary,
      // Family and colour unchanged. The step moves from `hero` (96) DOWN to `display` (64),
      // because the ring is now the thing carrying scale on this screen — a 96pt numeral inside a
      // 208pt circle leaves no ring left to read. `display` is still this screen's one
      // display-or-larger element (spec 2026-07-26 §3.1), so the rule that governed the 96 is
      // satisfied by the 64 in exactly the same way.
      fontFamily: FontFamily.display.bold,
      fontSize: FontSize.display,
      letterSpacing: Tracking.hero,
      lineHeight: FontSize.display * LineHeight.hero,
      // Metric numerals in the display face are proportionally spaced; centring the text node
      // keeps a two-digit and a three-digit score on the same optical axis inside the ring.
      textAlign: 'center',
    },
    overallBand: {
      fontFamily: FontFamily.body.semiBold,
      // Stepped down from `lg` with the numeral, for the same reason: it now shares the ring's
      // inner width rather than the full card width.
      fontSize: FontSize.sm,
      letterSpacing: Tracking.eyebrow,
      textAlign: 'center',
      textTransform: 'uppercase',
    },
    overallNotAssessed: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.md,
      textAlign: 'center',
    },
    pillarList: {
      gap: Spacing.lg,
    },
    pillarRow: {
      backgroundColor: colors.surface.base,
      // `Radius.tile`, not `Radius.card`: this row is nested inside a card that already carries
      // the 24pt corner, and repeating it here makes the nesting read as two competing shapes.
      // A tighter inner corner is what reads as "inside" — the same relationship the reference's
      // list rows have with the panel that holds them.
      borderRadius: Radius.tile,
      gap: Spacing.sm,
      padding: Spacing.lg,
    },
    pillarHeaderRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    // The accessible-collapsing group (letter/name/score) — `flex: 1` so it still takes the row's
    // full width minus the info button, matching what `pillarHeaderRow` gave it before the button
    // existed.
    pillarHeaderInfo: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    // The name and its band word stack beside the ring, taking the row's remaining width.
    pillarNameBlock: {
      flex: 1,
      gap: Spacing.xs,
    },
    pillarNameRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    pillarLetter: {
      color: colors.text.primary,
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.lg,
      // minWidth, not width (issue #63): a fixed `width` clips this single-character glyph the
      // moment Dynamic Type scales `FontSize.lg` past what 24pt of column can hold — minWidth
      // keeps the base-size column alignment but lets the glyph grow past it at large text
      // sizes instead of being cut off.
      minWidth: Spacing.xl,
    },
    pillarName: {
      color: colors.text.primary,
      flex: 1,
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.md,
    },
    scoreNumeral: {
      color: colors.text.primary,
      fontFamily: FontFamily.mono.bold,
      fontSize: FontSize.md,
      textAlign: 'center',
    },
    bandWord: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.sm,
    },
    notAssessedText: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
    },
    feedbackText: {
      color: colors.text.secondary,
      // The coach's own writing, not UI chrome (spec 2026-07-26 §3.2) — the ONE place in this
      // file that leaves Inter. Every label, band word, and control stays `body`.
      fontFamily: FontFamily.prose.regular,
      // Stepped up from `sm` to `md` by the redesign: this sentence is the product's payload, and
      // it was previously set smaller than the pillar's own name. Serif prose at reading size,
      // with real leading, is what makes it read as a coach writing to you.
      fontSize: FontSize.md,
      lineHeight: FontSize.md * LineHeight.body,
    },
    feedbackRow: {
      // `<KineticText>` lays its words out in a wrapping row, so the leading that a plain `Text`
      // would get from `lineHeight` alone has to be matched by the row's own cross-axis spacing —
      // without this, wrapped lines of a revealed paragraph sit tighter than an unrevealed one.
      rowGap: FontSize.md * (LineHeight.body - 1),
    },
    // The divider above now owns the gap between the feedback prose and this block — `pillarRow`'s
    // own `gap: Spacing.sm` already spaces every direct child from the last, so the extra
    // `marginTop: Spacing.xs` this used to carry was doubling up on that rhythm rather than adding
    // anything the divider doesn't already provide.
    subList: {
      gap: Spacing.sm,
    },
    // Only rendered when at least one of flags/drills is non-empty (see the render logic above) —
    // never a divider that leads to nothing. `pillarRow`'s `gap: Spacing.sm` spaces it from the
    // feedback prose above and the sub-list block below; no margin of its own is needed.
    divider: {
      backgroundColor: colors.hairline,
      height: StyleSheet.hairlineWidth,
    },
    subListItem: {
      gap: Spacing.xs,
    },
    subListTitle: {
      color: colors.text.primary,
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.sm,
    },
    subListDetail: {
      color: colors.text.secondary,
      // Flag details and drill instructions are the same coaching prose as `feedbackText` —
      // spec 2026-07-26 §3.2 names "per-pillar coaching feedback and the drill instructions"
      // together. The sub-list TITLES stay `body` semiBold: those are labels, not prose.
      fontFamily: FontFamily.prose.regular,
      fontSize: FontSize.xs,
      lineHeight: FontSize.xs * 1.4,
    },
  });
}
