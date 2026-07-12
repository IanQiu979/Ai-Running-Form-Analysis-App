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
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Copy } from '@/constants/copy';
import {
  Colors,
  FontFamily,
  FontSize,
  Radius,
  Score,
  ScoreBandLabel,
  Spacing,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { notAssessedCopy, overallA11yLabel, pillarA11yLabel, pillarLabel, pillarLetter } from '@/lib/pace-readout';
import { PACE_PILLARS, type PacePillarId, type PacePillarResult, type PaceResult } from '@shared/pace';

type Props = {
  result: PaceResult;
};

export function PaceReadout({ result }: Props) {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors), [colors]);

  const { overall } = result;

  return (
    <View style={styles.container}>
      <View
        style={styles.overallBlock}
        accessible
        accessibilityLabel={overallA11yLabel(overall)}>
        <Text style={styles.overallLabel}>{Copy.result.overall.label}</Text>
        {overall.score !== null && overall.band !== null ? (
          <View style={styles.overallScoreRow}>
            <Text testID="overall-score" style={styles.overallNumeral}>
              {overall.score}
            </Text>
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
        {PACE_PILLARS.map((id) => (
          <PillarRow key={id} pillarId={id} pillar={result.pillars[id]} colors={colors} scheme={scheme} />
        ))}
      </View>
    </View>
  );
}

function PillarRow({
  pillarId,
  pillar,
  colors,
  scheme,
}: {
  pillarId: PacePillarId;
  pillar: PacePillarResult;
  colors: ThemeColors;
  scheme: ColorScheme;
}) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const label = pillarLabel(pillarId);

  return (
    <View
      testID={`pillar-row-${pillarId}`}
      style={styles.pillarRow}
      accessible
      accessibilityLabel={pillarA11yLabel(label, pillar)}>
      <View style={styles.pillarHeaderRow}>
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
          <View
            testID={`pillar-bar-fill-${pillarId}`}
            style={[styles.barFill, { width: `${pillar.score}%`, backgroundColor: Score[pillar.band][scheme].fill }]}
          />
        ) : null}
      </View>

      {pillar.score === null || pillar.band === null ? (
        <Text testID={`pillar-not-assessed-${pillarId}`} style={styles.notAssessedText}>
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
    },
    overallNumeral: {
      color: colors.text.primary,
      fontFamily: FontFamily.display.bold,
      fontSize: FontSize.xxl,
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
      width: Spacing.xl,
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
      fontFamily: FontFamily.body.regular,
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
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.xs,
      lineHeight: FontSize.xs * 1.4,
    },
  });
}
