/**
 * Per-pillar detail (V23-08's third artboard — the "tap the info icon" panel
 * `components/pace-readout.tsx`'s `PillarRow` opens). A full-screen, opaque, `animationType="slide"`
 * RN `<Modal>` painted `Ink.bg`, with `onRequestClose` (the Android back button) wired to the same
 * dismiss handler as its own close control — the same full-screen modal shape `app/settings.tsx`'s
 * step-up re-auth uses, rather than a bottom sheet or a third-party sheet library.
 *
 * THIS IS THE ONLY PLACE FLAGS AND DRILLS RENDER. The page's result rows carry a score, a band
 * word, a bar and one line of coaching prose; the risk flags and drills a Pro/Elite pillar carries
 * are read here, at length, under their own labels.
 *
 * WHAT THIS DOES NOT DO: it renders exactly the `PacePillarResult` it is handed — the same
 * score/band/feedback/flags/drills/notAssessedReason fields `<PillarRow>` already renders, just
 * with room to read them. It never fabricates additional explanatory copy the `@shared/pace`
 * contract doesn't carry, and it upholds the same rule `pace-readout.tsx`'s own header states:
 * `score: null` renders NO numeral, ever — only the honest not-assessed reason. Business logic
 * (tier, quota, which fields a Free vs. Pro/Elite result carries) stays out of this file too — it
 * renders whichever `flags`/`drills` arrays it's given, and never an empty "Risk flags"/"Drills"
 * label.
 *
 * ACCESSIBILITY: unlike the not-assessed reason inside `<PillarRow>` (which is deliberately hidden
 * from the a11y tree — `accessibilityElementsHidden` — because the row's own header already speaks
 * it aloud via `pillarA11yLabel`), nothing in here is hidden. This modal has no duplicate
 * announcement standing in for its own not-assessed text, its score/band, or its coaching prose,
 * so all of it must be independently reachable by a screen reader. The close control carries a
 * real `accessibilityLabel`, and the pillar name is `accessibilityRole="header"` — both are how a
 * screen-reader user finds and leaves this view without relying on touch.
 */
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SquareCard } from '@/components/ui/square-card';
import { SquareIconButton } from '@/components/ui/square-icon-button';
import { Copy } from '@/constants/copy';
import { ScoreBandLabel } from '@/constants/theme';
import { Font, Ink, Layout, Space, Type } from '@/constants/v23-theme';
import { notAssessedCopy, pillarLabel, pillarLetter } from '@/lib/pace-readout';
import type { PacePillarId, PacePillarResult } from '@shared/pace';

/** The page's close glyph: `400 22px/1 'Inter Tight'`, a text "×" rather than an icon. */
const CLOSE_GLYPH = '×';
const CLOSE_GLYPH_SIZE = 22;

type Props = {
  visible: boolean;
  onDismiss: () => void;
  pillarId: PacePillarId;
  pillar: PacePillarResult;
};

export function PillarDetailModal({ visible, onDismiss, pillarId, pillar }: Props) {
  const insets = useSafeAreaInsets();
  const label = pillarLabel(pillarId);
  const hasFlagsOrDrills = pillar.flags.length > 0 || pillar.drills.length > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
      testID={`pillar-detail-modal-${pillarId}`}>
      <View style={styles.screen}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: Math.max(insets.top, Layout.canvas.safeTop),
              paddingBottom: Math.max(insets.bottom, Layout.canvas.safeBottom),
            },
          ]}>
          <View style={styles.headerRow}>
            {/* Letter + name as ONE accessible heading — the letter alone ("A") carries no
                useful spoken content on its own, so the two sit in a single `accessible` node a
                screen reader announces as one sentence, not as a separately-hidden decoration.
                A row `View` rather than nested `Text`: the page sets the two on a shared baseline
                with a 12 pt gap, and a nested `Text` cannot carry that gap. */}
            <View
              testID={`pillar-detail-heading-${pillarId}`}
              accessible
              accessibilityRole="header"
              style={styles.heading}>
              <Text style={[Type.displayFigure, styles.ink2]}>{pillarLetter(pillarId)}</Text>
              <Text style={[Type.h2, styles.ink]}>{label}</Text>
            </View>
            <SquareIconButton
              testID={`pillar-detail-close-${pillarId}`}
              accessibilityLabel={Copy.result.pillar.detail.close}
              onPress={onDismiss}
              bleed="right">
              <Text style={styles.closeGlyph}>{CLOSE_GLYPH}</Text>
            </SquareIconButton>
          </View>

          <SquareCard
            padding={Layout.cardPaddingLg}
            style={styles.card}
            testID={`pillar-detail-card-${pillarId}`}>
            {pillar.score !== null && pillar.band !== null ? (
              <View style={styles.scoreRow}>
                <Text testID={`pillar-detail-score-${pillarId}`} style={[Type.scoreMd, styles.ink]}>
                  {pillar.score}
                </Text>
                <Text testID={`pillar-detail-band-${pillarId}`} style={[Type.label, styles.ink]}>
                  {ScoreBandLabel[pillar.band]}
                </Text>
              </View>
            ) : (
              // Same honesty rule as `<PillarRow>`: no numeral, ever, for a not-assessed
              // pillar — only the reason, and it's reachable here (not hidden, see this
              // file's header on why the modal's copy of it can't take the row's shortcut).
              <Text testID={`pillar-detail-not-assessed-${pillarId}`} style={[Type.body, styles.ink2]}>
                {notAssessedCopy(pillar.notAssessedReason)}
              </Text>
            )}

            {pillar.feedback ? (
              <Text testID={`pillar-detail-feedback-${pillarId}`} style={[Type.body, styles.ink2]}>
                {pillar.feedback}
              </Text>
            ) : null}

            {/* The page's 1 px rule between the prose and the lists — only when there IS a list
                below, so the rule never leads to nothing. */}
            {hasFlagsOrDrills ? <View style={styles.rule} /> : null}

            {pillar.flags.length > 0 ? (
              <View style={styles.list} testID={`pillar-detail-flags-${pillarId}`}>
                <Text style={[Type.label, styles.ink2]}>{Copy.result.pillar.flagsLabel}</Text>
                {pillar.flags.map((flag, index) => (
                  <View key={`${flag.pattern}-${index}`} style={styles.listItem}>
                    <Text style={[Type.bodySmSemi, styles.ink]}>{flag.pattern}</Text>
                    <Text style={[Type.note, styles.ink2]}>{flag.detail}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {pillar.drills.length > 0 ? (
              <View style={styles.list} testID={`pillar-detail-drills-${pillarId}`}>
                <Text style={[Type.label, styles.ink2]}>{Copy.result.pillar.drillsLabel}</Text>
                {pillar.drills.map((drill, index) => (
                  <View key={`${drill.name}-${index}`} style={styles.listItem}>
                    <Text style={[Type.bodySmSemi, styles.ink]}>{drill.name}</Text>
                    <Text style={[Type.note, styles.ink2]}>{drill.instructions}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </SquareCard>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Ink.bg,
  },
  content: {
    flexGrow: 1,
    gap: Space.xl,
    paddingHorizontal: Layout.gutter,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  heading: {
    alignItems: 'baseline',
    flex: 1,
    flexDirection: 'row',
    gap: Space.md,
  },
  closeGlyph: {
    color: Ink.ink2,
    fontFamily: Font.tight.regular,
    fontSize: CLOSE_GLYPH_SIZE,
    lineHeight: CLOSE_GLYPH_SIZE,
  },
  card: {
    gap: Space.xl,
  },
  scoreRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: Space.md,
  },
  ink: {
    color: Ink.ink,
  },
  ink2: {
    color: Ink.ink2,
  },
  rule: {
    backgroundColor: Ink.line,
    height: Layout.hairline,
  },
  list: {
    gap: Space.md,
  },
  listItem: {
    gap: Space.xs,
  },
});
