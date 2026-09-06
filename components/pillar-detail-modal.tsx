/**
 * Per-pillar detail (the "tap the info icon" panel `components/pace-readout.tsx`'s `PillarRow`
 * opens). Reuses `app/settings.tsx`'s step-up-reauth `Modal` pattern verbatim — the only
 * full-screen modal precedent in this codebase — rather than inventing a bottom sheet or pulling
 * in a third-party sheet library: a full-screen, opaque-per-frame, `animationType="slide"` RN
 * `<Modal>` wrapping `<ScreenGradient>` + `SafeAreaView` + `ScrollView`, with `onRequestClose`
 * (the Android back button) wired to the same dismiss handler as its own close control.
 *
 * WHAT THIS DOES NOT DO: it renders exactly the `PacePillarResult` it is handed — the same
 * score/band/feedback/flags/drills/notAssessedReason fields `<PillarRow>` already renders, just
 * with room to read them at length. It never fabricates additional explanatory copy the
 * `@shared/pace` contract doesn't carry, and it upholds the same rule `pace-readout.tsx`'s own
 * header states: `score: null` renders NO numeral, ever — only the honest not-assessed reason.
 * Business logic (tier, quota, which fields a Free vs. Pro/Elite result carries) stays out of
 * this file too — it renders whichever `flags`/`drills` arrays it's given.
 *
 * ACCESSIBILITY: unlike the not-assessed reason inside `<PillarRow>` (which is deliberately hidden
 * from the a11y tree — `accessibilityElementsHidden` — because the row's own header already speaks
 * it aloud via `pillarA11yLabel`), nothing in here is hidden. This modal has no duplicate
 * announcement standing in for its own not-assessed text, its score/band, or its coaching prose,
 * so all of it must be independently reachable by a screen reader. The close control carries a
 * real `accessibilityLabel`, and the pillar name is `accessibilityRole="header"` — both are how a
 * screen-reader user finds and leaves this view without relying on touch.
 */
import { useMemo } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ScreenGradient } from '@/components/ui/screen-gradient';
import { SurfaceCard } from '@/components/ui/surface-card';
import { Copy } from '@/constants/copy';
import {
  Colors,
  ContentWidth,
  FontFamily,
  FontSize,
  LineHeight,
  Score,
  ScoreBandLabel,
  Semantic,
  Spacing,
  Tracking,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { notAssessedCopy, pillarLabel, pillarLetter, safetyNote } from '@/lib/pace-readout';
import type { PacePillarId, PacePillarResult } from '@shared/pace';

type Props = {
  visible: boolean;
  onDismiss: () => void;
  pillarId: PacePillarId;
  pillar: PacePillarResult;
};

export function PillarDetailModal({ visible, onDismiss, pillarId, pillar }: Props) {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const label = pillarLabel(pillarId);
  const hasFlagsOrDrills = pillar.flags.length > 0 || pillar.drills.length > 0;
  // THE SAME READ the readout's `<PillarRow>` makes — one helper, one structured field
  // (`pillar.safety`), so the two surfaces cannot disagree about what the warning is or whether
  // there is one. Neither ever parses it back out of `feedback`.
  const note = safetyNote(pillar);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
      testID={`pillar-detail-modal-${pillarId}`}>
      <ScreenGradient>
        <SafeAreaView style={styles.safeArea}>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.headerRow}>
              {/* Letter + name as one accessible heading — the letter alone ("P") carries no
                  useful spoken content on its own, so it's a leading child of the same Text node
                  a screen reader announces as one sentence, not a separately-hidden decoration. */}
              <Text testID={`pillar-detail-heading-${pillarId}`} accessibilityRole="header" style={styles.heading}>
                <Text style={styles.headingLetter}>{pillarLetter(pillarId)}  </Text>
                {label}
              </Text>
              <CircleIconButton
                testID={`pillar-detail-close-${pillarId}`}
                accessibilityLabel={Copy.result.pillar.detail.close}
                onPress={onDismiss}>
                <IconSymbol name="xmark" size={FontSize.md} color={colors.text.primary} />
              </CircleIconButton>
            </View>

            {/* `SurfaceCard`'s own `style` prop lands on its OUTER shadow-owning node, not the
                inner one its children actually render into (see that component's header on why
                the shadow/clip split is two nodes) — so the vertical rhythm between this card's
                own children needs its own wrapping `View`, not a `style` passed to the card. */}
            <SurfaceCard tone="raised" testID={`pillar-detail-card-${pillarId}`}>
              <View style={styles.card}>
                {pillar.score !== null && pillar.band !== null ? (
                  <View style={styles.scoreRow}>
                    <Text testID={`pillar-detail-score-${pillarId}`} style={styles.scoreNumeral}>
                      {pillar.score}
                    </Text>
                    <Text
                      testID={`pillar-detail-band-${pillarId}`}
                      style={[styles.bandWord, { color: Score[pillar.band][scheme].text }]}>
                      {ScoreBandLabel[pillar.band]}
                    </Text>
                  </View>
                ) : (
                  // Same honesty rule as `<PillarRow>`: no numeral, ever, for a not-assessed
                  // pillar — only the reason, and it's reachable here (not hidden, see this
                  // file's header on why the modal's copy of it can't take the row's shortcut).
                  <Text testID={`pillar-detail-not-assessed-${pillarId}`} style={styles.notAssessedText}>
                    {notAssessedCopy(pillar.notAssessedReason)}
                  </Text>
                )}

                {/* The stop-running note, above the coaching and visibly not part of it — same
                    element, same source field, same order as `<PillarRow>`. `Semantic.error` is
                    proven as text against `surface.raised`, which is this card's tone. */}
                {note ? (
                  <View style={styles.safetyBlock} testID={`pillar-detail-safety-${pillarId}`}>
                    <Text style={[styles.safetyLabel, { color: Semantic.error[scheme] }]}>
                      {Copy.result.pillar.safetyLabel}
                    </Text>
                    <Text
                      testID={`pillar-detail-safety-note-${pillarId}`}
                      style={[styles.safetyNoteText, { color: Semantic.error[scheme] }]}>
                      {note}
                    </Text>
                  </View>
                ) : null}

                {/* The coach's own writing — same `FontFamily.prose` convention as
                    `pace-readout.tsx`'s `feedbackText` (spec 2026-07-26 §3.2: coaching prose is
                    never set in the UI-chrome family). Static here — no per-word reveal, this is
                    a detail view opened well after the readout's own reveal has already played. */}
                {pillar.feedback ? (
                  <Text testID={`pillar-detail-feedback-${pillarId}`} style={styles.feedbackText}>
                    {pillar.feedback}
                  </Text>
                ) : null}

                {hasFlagsOrDrills ? <View style={styles.divider} /> : null}

                {pillar.flags.length > 0 ? (
                  <View style={styles.subList} testID={`pillar-detail-flags-${pillarId}`}>
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
                  <View style={styles.subList} testID={`pillar-detail-drills-${pillarId}`}>
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
            </SurfaceCard>
          </ScrollView>
        </SafeAreaView>
      </ScreenGradient>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      // Transparent — `<ScreenGradient>` behind it owns the fill, same convention as every other
      // screen's `SafeAreaView` (e.g. `app/result/[id].tsx`'s own `safeArea`).
      backgroundColor: 'transparent',
    },
    content: {
      alignSelf: 'center',
      flexGrow: 1,
      gap: Spacing.xl,
      maxWidth: ContentWidth.readable,
      padding: Spacing.xl,
      width: '100%',
    },
    headerRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: Spacing.sm,
      justifyContent: 'space-between',
    },
    heading: {
      color: colors.text.primary,
      flex: 1,
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.xl,
      letterSpacing: Tracking.display,
    },
    headingLetter: {
      color: colors.text.secondary,
    },
    card: {
      gap: Spacing.lg,
    },
    scoreRow: {
      alignItems: 'baseline',
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    scoreNumeral: {
      color: colors.text.primary,
      fontFamily: FontFamily.mono.bold,
      fontSize: FontSize.xxl,
    },
    bandWord: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.md,
    },
    notAssessedText: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.md,
      lineHeight: FontSize.md * LineHeight.body,
    },
    // Colour is applied at the call site — `Semantic.error` is theme-keyed and this factory only
    // receives the resolved `colors`. Mirrors `pace-readout.tsx`'s own safety block.
    safetyBlock: {
      gap: Spacing.xs,
    },
    safetyLabel: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.xs,
      letterSpacing: Tracking.eyebrow,
      textTransform: 'uppercase',
    },
    safetyNoteText: {
      fontFamily: FontFamily.prose.regular,
      fontSize: FontSize.md,
      lineHeight: FontSize.md * LineHeight.body,
    },
    feedbackText: {
      color: colors.text.secondary,
      fontFamily: FontFamily.prose.regular,
      fontSize: FontSize.md,
      lineHeight: FontSize.md * LineHeight.body,
    },
    divider: {
      backgroundColor: colors.hairline,
      height: StyleSheet.hairlineWidth,
    },
    subList: {
      gap: Spacing.sm,
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
      fontFamily: FontFamily.prose.regular,
      fontSize: FontSize.xs,
      lineHeight: FontSize.xs * 1.4,
    },
  });
}
