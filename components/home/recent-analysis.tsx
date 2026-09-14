/**
 * Home's lead card — the user's most recent analysis, and Home's entry point back into it
 * (design brief §4.2: "once there's history, the most recent gait-plate thumbnail"; Home
 * previously had no route to a past result at all, so the only way back to a finished analysis
 * was the History tab). Transcribed from V23-07's first and third artboards.
 *
 * WHAT IT DRAWS. A 24 pt `<SquareCard>`: the "Overall" label and the date on one baseline; the
 * overall numeral (`Type.score`, 96 pt) with the band word beside it; a hairline; then the four
 * pillar letters over their scores, one column each. The page's own note: "the app's arc-ring
 * score is replaced by the V2.3 numeral + P/A/C/E row". A null pillar score is the page's "—"
 * (third artboard, C), never a zero.
 *
 * FOUR STATES, and the split between the last two is the honest one. `empty` says "nothing
 * analyzed yet" — a claim, and the page's dashed box with its title and sentence. `unavailable`
 * is what a failed read gets: the same dashed box, but NOTHING inside it claims the user has no
 * history, because we do not know. Home is fully usable in either: the quota card and the primary
 * CTA below this are untouched by it. `loading` is the dashed box at the same padding with a
 * quiet indicator, so nothing jumps when the read lands.
 *
 * NOT-ASSESSED OVERALL is a state the page does not draw. The numeral's slot holds "—" in the
 * disabled tone and the band word's slot holds the readout's own not-assessed sentence — the
 * same rule `components/pace-readout.tsx` is built around: `null` is a first-class state, never
 * a stringified null and never a zero.
 *
 * NO BUSINESS LOGIC. This component renders whichever state it is handed and emits one intent
 * (open this analysis). It does not fetch, does not decide what "recent" means, and does not read
 * tier or quota.
 */
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { SquareCard } from '@/components/ui/square-card';
import { Copy } from '@/constants/copy';
// Copy, not a visual token: the band word ("Solid", "Strong") is the app's one band vocabulary
// and lives beside the band type. The only import this file takes from the old theme file.
import { ScoreBandLabel } from '@/constants/theme';
import { Ink, Layout, Space, Type } from '@/constants/v23-theme';
import { formatHistoryDate, formatHistoryItemA11yLabel, type HistoryListItem } from '@/lib/history';
import { pillarLetter } from '@/lib/pace-readout';
import { PACE_PILLARS } from '@shared/pace';

/** The page's hairline sits `margin: 20px 0 16px` — 20 above is off the 8 pt grid and is the
 *  page's own number, so it is named here rather than rounded to a `Space` step. */
const RULE_MARGIN_TOP = 20;

/** The page's "—" for a pillar that carries no score (V23-07, third artboard). A glyph, not a
 *  word, so it is not copy. */
const NO_SCORE_GLYPH = '—';

const PRESSED_OPACITY = 0.6;

export type RecentAnalysisState =
  | { status: 'loading' }
  /** The read succeeded and there is genuinely nothing yet. */
  | { status: 'empty' }
  /** The read failed. See this file's header — this state claims nothing. */
  | { status: 'unavailable' }
  | { status: 'ready'; item: HistoryListItem };

export function RecentAnalysis({
  state,
  onOpen,
}: {
  state: RecentAnalysisState;
  onOpen: (item: HistoryListItem) => void;
}) {
  if (state.status === 'loading') {
    return (
      <SquareCard dashed style={styles.dashedBox}>
        <ActivityIndicator color={Ink.ink2} testID="home-recent-loading" />
      </SquareCard>
    );
  }

  if (state.status === 'empty') {
    return (
      <SquareCard dashed style={styles.dashedBox}>
        <Text style={styles.emptyTitle} testID="home-hero-line">
          {Copy.home.empty.caption}
        </Text>
        <Text style={styles.emptyBody}>{Copy.home.empty.body}</Text>
      </SquareCard>
    );
  }

  if (state.status === 'unavailable') {
    // The outline survives, so the composition does; the words do not, because the only words
    // this box has would tell a user with a full history that they have none.
    return <SquareCard dashed style={styles.dashedBox} testID="home-recent-unavailable" />;
  }

  const { item } = state;
  const { overall, pillars } = item.outcome.result;
  const dateLabel = formatHistoryDate(item.createdAt);
  const assessed = overall.score !== null && overall.band !== null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={formatHistoryItemA11yLabel(item, dateLabel)}
      onPress={() => onOpen(item)}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
      testID="home-recent">
      <SquareCard padding={Layout.cardPaddingLg}>
        <View style={styles.headerRow}>
          <Text style={styles.overallLabel}>{Copy.result.overall.label}</Text>
          <Text style={styles.date}>{dateLabel}</Text>
        </View>

        <View style={styles.scoreRow}>
          {assessed && overall.band !== null ? (
            <>
              <Text testID="home-recent-score" style={styles.score} numberOfLines={1}>
                {overall.score}
              </Text>
              <Text style={styles.bandWord}>{ScoreBandLabel[overall.band]}</Text>
            </>
          ) : (
            <>
              <Text style={styles.scoreAbsent} numberOfLines={1}>
                {NO_SCORE_GLYPH}
              </Text>
              <Text style={styles.notAssessed}>{Copy.result.pillar.notAssessed.generic}</Text>
            </>
          )}
        </View>

        <View style={styles.rule} />

        <View style={styles.pillarRow}>
          {PACE_PILLARS.map((id) => {
            const score = pillars[id].score;
            return (
              <View key={id} style={styles.pillarCell}>
                <Text style={styles.pillarLetter}>{pillarLetter(id)}</Text>
                <Text style={styles.pillarScore} testID={`home-recent-pillar-${id}`}>
                  {score === null ? NO_SCORE_GLYPH : score}
                </Text>
              </View>
            );
          })}
        </View>
      </SquareCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The page's empty box: `padding: 40px 24px`, centred, 16 pt between its two lines. Loading
  // and unavailable share it so the slot holds one height across all three.
  dashedBox: {
    paddingVertical: Space.section,
    paddingHorizontal: Space.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.lg,
  },
  emptyTitle: {
    ...Type.display,
    color: Ink.ink,
    textAlign: 'center',
  },
  emptyBody: {
    ...Type.body,
    color: Ink.ink2,
    textAlign: 'center',
  },
  pressable: {
    alignSelf: 'stretch',
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  overallLabel: {
    ...Type.label,
    color: Ink.ink2,
  },
  date: {
    ...Type.mono,
    color: Ink.ink2,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Space.md,
    marginTop: Space.lg,
  },
  score: {
    ...Type.score,
    color: Ink.ink,
  },
  // The not-assessed numeral slot: the same 96 pt glyph box in the disabled tone, so the card
  // keeps the page's height and the dash reads as an absence rather than a value.
  scoreAbsent: {
    ...Type.score,
    color: Ink.ink3,
  },
  bandWord: {
    ...Type.label,
    color: Ink.ink,
  },
  notAssessed: {
    ...Type.note,
    color: Ink.ink2,
    flexShrink: 1,
  },
  rule: {
    height: Layout.hairline,
    backgroundColor: Ink.line,
    marginTop: RULE_MARGIN_TOP,
    marginBottom: Space.lg,
  },
  // `grid-template-columns: repeat(4, 1fr); gap: 8px` — four equal columns.
  pillarRow: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  pillarCell: {
    flex: 1,
  },
  pillarLetter: {
    ...Type.letter,
    color: Ink.ink,
  },
  pillarScore: {
    ...Type.metricSm,
    color: Ink.ink,
  },
});
