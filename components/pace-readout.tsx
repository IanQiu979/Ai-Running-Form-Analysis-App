/**
 * The PACE readout (issue #56) — the four-pillar score block that is the product's payload
 * (design brief §3: "this four-row block ... is the app's signature screen element").
 *
 * THE RULE THIS FILE MUST NEVER BREAK: `score: null` is a first-class, common state (every photo
 * submission reports two pillars this way — motion-over-time pillars a single frame cannot
 * show), not an error. A not-assessed pillar renders NO numeral, NO band word, and NO filled bar
 * — only a hollow, bordered track and a plain-language reason. It must never read as a zero, and
 * never as a greyed-out fake score. `<PillarRow>` below enforces this by construction: the
 * numeral/band-word/bar-fill elements are only ever mounted when `pillar.score !== null` — there
 * is no code path that stringifies `null` into "0".
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
 * static render. False (the overwhelmingly common case — every re-open from Past Analyses) keeps
 * every node below byte-identical to the pre-#61 implementation: a plain `Text`/`View` bar at its
 * final width, no Reanimated import in the render path at all. True (set by `app/result/[id].tsx`
 * only when the `justAnalyzed` nav param is present, motion-consult.md item 3) switches to one of
 * two reveal modes, chosen by `useReducedMotion()`: `animate` (the staggered scaleX fill +
 * numeral count-up, `components/pace-reveal.tsx`) or `crossfade` (brief §6: reduced motion gets
 * "a single crossfade, no stagger, no count-up" — implemented here as one opacity animation over
 * the whole readout, still showing the exact same final static content `instant` mode does).
 * Either reveal mode waits for `onLayout` before starting (motion-consult.md item 4: "first-
 * visible, not on-mount" — the same trigger indirection a future scroll-linked reveal would need,
 * so swapping this for real viewability later is additive, not a container change).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { AnimatedOverallNumeral, AnimatedPillarBarFill } from '@/components/pace-reveal';
import { Copy } from '@/constants/copy';
import {
  Colors,
  FontFamily,
  FontSize,
  Motion,
  Radius,
  Score,
  ScoreBandLabel,
  Spacing,
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
      style={[styles.container, revealMode === 'crossfade' && crossfadeStyle]}
      onLayout={revealMode !== 'instant' ? handleFirstLayout : undefined}>
      <View
        style={styles.overallBlock}
        accessible
        accessibilityLabel={overallA11yLabel(overall)}>
        <Text style={styles.overallLabel}>{Copy.result.overall.label}</Text>
        {overall.score !== null && overall.band !== null ? (
          <View style={styles.overallScoreRow}>
            {revealMode === 'animate' ? (
              <AnimatedOverallNumeral
                testID="overall-score"
                style={styles.overallNumeral}
                value={overall.score}
                triggered={revealed}
              />
            ) : (
              // Dynamic Type guard (brief §7: never hard-clip the score readout). At
              // FontSize.hero a scaled-up numeral would otherwise run off the edge, so it
              // shrinks to fit its line instead of clipping.
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
        ) : (
          <Text testID="overall-not-assessed" style={styles.overallNotAssessed}>
            {Copy.result.pillar.notAssessed.generic}
          </Text>
        )}
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

  return (
    <View testID={`pillar-row-${pillarId}`} style={styles.pillarRow}>
      <View
        testID={`pillar-header-${pillarId}`}
        style={styles.pillarHeaderRow}
        accessible
        accessibilityLabel={pillarA11yLabel(label, pillar)}>
        <Text style={styles.pillarLetter}>{pillarLetter(pillarId)}</Text>
        <Text style={styles.pillarName}>{label}</Text>
        {pillar.score !== null && pillar.band !== null ? (
          <View style={styles.scoreRow}>
            <Text testID={`pillar-score-${pillarId}`} style={styles.scoreNumeral}>
              {pillar.score}
            </Text>
            <Text testID={`pillar-band-${pillarId}`} style={[styles.bandWord, { color: Score[pillar.band][scheme].text }]}>
              {ScoreBandLabel[pillar.band]}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.barTrack}>
        {pillar.score !== null && pillar.band !== null ? (
          revealMode === 'animate' ? (
            <AnimatedPillarBarFill
              testID={`pillar-bar-fill-${pillarId}`}
              index={index}
              score={pillar.score}
              triggered={triggered}
              style={[styles.barFill, { backgroundColor: Score[pillar.band][scheme].fill }]}
            />
          ) : (
            <View
              testID={`pillar-bar-fill-${pillarId}`}
              style={[styles.barFill, { width: `${pillar.score}%`, backgroundColor: Score[pillar.band][scheme].fill }]}
            />
          )
        ) : null}
      </View>

      {pillar.score === null || pillar.band === null ? (
        <Text
          testID={`pillar-not-assessed-${pillarId}`}
          style={styles.notAssessedText}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          {notAssessedCopy(pillar.notAssessedReason)}
        </Text>
      ) : null}

      {pillar.feedback ? (
        <Text testID={`pillar-feedback-${pillarId}`} style={styles.feedbackText}>
          {pillar.feedback}
        </Text>
      ) : null}

      {/* Tier gating without re-deriving tier rules: the server already ships `flags: []` for
          Free and every not-assessed pillar (`pace.ts`'s own doc comment), so an empty array is
          simply nothing to render — never an empty "Flags" heading. */}
      {pillar.flags.length > 0 ? (
        <View style={styles.subList} testID={`pillar-flags-${pillarId}`}>
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
      gap: Spacing.xs,
    },
    overallLabel: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    overallScoreRow: {
      alignItems: 'baseline',
      flexDirection: 'row',
      gap: Spacing.sm,
      // Brief §7 forbids clipping the score readout. At FontSize.hero the numeral and the band
      // word cannot share one line once Dynamic Type scales up, so the row wraps and the band
      // word drops beneath the numeral rather than being pushed off the edge.
      flexWrap: 'wrap',
      justifyContent: 'center',
    },
    overallNumeral: {
      color: colors.text.primary,
      // Family and colour unchanged; only the step moves — the screen's ONE hero-scale element
      // (spec 2026-07-26 §3.1: at most one `display`-or-larger element per screen).
      fontFamily: FontFamily.display.bold,
      fontSize: FontSize.hero,
    },
    overallBand: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.lg,
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
      borderRadius: Radius.card,
      gap: Spacing.xs,
      padding: Spacing.lg,
    },
    pillarHeaderRow: {
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
    scoreRow: {
      alignItems: 'baseline',
      flexDirection: 'row',
      gap: Spacing.xs,
    },
    scoreNumeral: {
      color: colors.text.primary,
      fontFamily: FontFamily.mono.medium,
      fontSize: FontSize.md,
    },
    bandWord: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.sm,
    },
    barTrack: {
      backgroundColor: colors.surface.raised,
      borderColor: colors.hairline,
      borderRadius: Radius.pill,
      borderWidth: 1,
      height: Spacing.sm,
      overflow: 'hidden',
    },
    barFill: {
      borderRadius: Radius.pill,
      height: '100%',
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
      fontSize: FontSize.sm,
    },
    subList: {
      gap: Spacing.sm,
      marginTop: Spacing.xs,
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
