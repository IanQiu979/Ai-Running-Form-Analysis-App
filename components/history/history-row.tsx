/**
 * One History row, cut to V23-09 (2026-09-14). Extracted out of `app/(tabs)/history.tsx` so the
 * row's own geometry lives next to the row rather than inside the screen's state machine.
 *
 * THE COMPOSITION, verbatim from the page's card:
 *
 *   - THE ROW LEADS WITH THE NUMERAL. `Type.displayFigure` in `ink`, `minWidth: 56` so the band
 *     word and date start on the same column whether the score is "7" or "100". A not-assessed
 *     overall draws an em dash in `ink3` — the placeholder tone, which is exactly what a missing
 *     value is — never a zero, never a stringified null.
 *   - BAND WORD + DATE beside it: the app's real `ScoreBandLabel[band]` in `Type.label` (the one
 *     import this file still takes from `constants/theme.ts`, because it is copy, not a token), or
 *     `Copy.result.pillar.notAssessed.generic` in `Type.note` when there is no band; the date in
 *     `Type.mono` — a measured value's timestamp, set the way every measured value on the sheet is.
 *   - THE FRAME DECK IS THREE CELLS, ALWAYS. `Layout.frameDeck`: 44 pt squares, each overlapping
 *     the previous by half, ruled 2 pt in the card's own fill so the overlap reads as a stack. A
 *     cell shows its signed frame when the URL has resolved and `bgPlaceholder` otherwise, so a
 *     still-signing row, a row with fewer than three frames, and a row whose media is gone all
 *     keep the same silhouette and the list's right edge stays a straight line.
 *   - DELETE STAYS A VISIBLE WORD under an edge-to-edge hairline. It is a PERSISTENT, VISIBLY
 *     LABELLED control (`docs/design/copy-deck.md` Screen 8 — never swipe, never long-press, never
 *     an unlabelled glyph on an irreversible action). The page pulls it up 8 and out 16 on the
 *     right so its 44 pt target reaches the card's edge while the underlined word sits on the
 *     content column.
 *
 * NO BUSINESS LOGIC: it renders one `HistoryListItem` and emits two intents (open, delete).
 */
import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { SquareCard } from '@/components/ui/square-card';
import { Copy } from '@/constants/copy';
import { ScoreBandLabel } from '@/constants/theme';
import { Ink, Layout, Space, Type } from '@/constants/v23-theme';
import {
  formatHistoryDate,
  formatHistoryItemA11yLabel,
  formatHistoryItemDeleteA11yLabel,
  type HistoryListItem,
} from '@/lib/history';

/** The page draws exactly three cells; a fourth stored frame is not shown. */
const FRAME_DECK_CELLS = 3;
/** The page's "—" for a not-assessed overall. */
const NOT_ASSESSED_FIGURE = '—';
/** The numeral's column (page: `min-width:56px`), so the band word and date start on the same
 *  x whether the score is one digit or three. Not a `Layout` token: nothing else on the sheet
 *  shares this width for this reason. */
const FIGURE_COLUMN_WIDTH = 56;

const PRESSED_OPACITY = 0.6;
const DISABLED_OPACITY = 0.4;

export function HistoryRow({
  item,
  thumbnailUris,
  isDeleting,
  onPress,
  onDelete,
}: {
  item: HistoryListItem;
  thumbnailUris: string[];
  isDeleting: boolean;
  onPress: () => void;
  onDelete: () => void;
}) {
  const dateLabel = formatHistoryDate(item.createdAt);
  const { overall } = item.outcome.result;
  const assessed = overall.score !== null && overall.band !== null;
  // Always three cells (see the header); `undefined` past the end of the strip is a placeholder.
  const cells = Array.from({ length: FRAME_DECK_CELLS }, (_, index) => thumbnailUris[index]);

  return (
    <SquareCard style={styles.card} testID={`history-row-${item.id}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={formatHistoryItemA11yLabel(item, dateLabel)}
        onPress={onPress}
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
        {assessed ? (
          <Text style={styles.figure} testID={`history-score-${item.id}`}>
            {overall.score}
          </Text>
        ) : (
          <Text style={[styles.figure, styles.figureNotAssessed]} testID={`history-score-${item.id}`}>
            {NOT_ASSESSED_FIGURE}
          </Text>
        )}

        <View style={styles.rowInfo}>
          {assessed && overall.band !== null ? (
            <Text style={styles.bandWord}>{ScoreBandLabel[overall.band]}</Text>
          ) : (
            <Text style={styles.notAssessedText}>{Copy.result.pillar.notAssessed.generic}</Text>
          )}
          <Text style={styles.dateText}>{dateLabel}</Text>
        </View>

        <View style={styles.frameDeck} testID={`history-frame-strip-${item.id}`}>
          {cells.map((uri, index) =>
            uri ? (
              <Image
                key={`${item.id}-${index}`}
                source={{ uri }}
                style={[styles.cell, index > 0 && styles.cellOverlap]}
                contentFit="cover"
                testID={`history-frame-${item.id}-${index}`}
              />
            ) : (
              // Covers BOTH the "still resolving" moment and the real "no thumbnail" outcome
              // (short media_paths, or a failed signed-URL attempt) with one placeholder cell —
              // never a broken image, never a crash (see `lib/history.ts`'s header).
              <View
                key={`${item.id}-${index}`}
                style={[styles.cell, styles.cellPlaceholder, index > 0 && styles.cellOverlap]}
                testID={`history-frame-placeholder-${item.id}-${index}`}
              />
            )
          )}
        </View>
      </Pressable>

      <View style={styles.rule} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={formatHistoryItemDeleteA11yLabel(item, dateLabel)}
        accessibilityState={{ disabled: isDeleting, busy: isDeleting }}
        disabled={isDeleting}
        onPress={onDelete}
        style={({ pressed }) => [
          styles.deleteButton,
          pressed && !isDeleting && styles.pressed,
          isDeleting && styles.disabled,
        ]}
        testID={`history-delete-${item.id}`}>
        {isDeleting ? (
          <ActivityIndicator color={Ink.ink2} testID={`history-delete-busy-${item.id}`} />
        ) : (
          <Text style={styles.deleteText}>{Copy.history.item.deleteCta}</Text>
        )}
      </Pressable>
    </SquareCard>
  );
}

const styles = StyleSheet.create({
  // Page: `padding:16px; gap:12px` — `SquareCard`'s default padding is the 16.
  card: {
    gap: Space.md,
  },
  rowMain: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.lg,
  },
  figure: {
    ...Type.displayFigure,
    color: Ink.ink,
    minWidth: FIGURE_COLUMN_WIDTH,
  },
  figureNotAssessed: {
    color: Ink.ink3,
  },
  rowInfo: {
    flex: 1,
    gap: Space.xs,
  },
  bandWord: {
    ...Type.label,
    color: Ink.ink,
  },
  notAssessedText: {
    ...Type.note,
    color: Ink.ink2,
  },
  dateText: {
    ...Type.mono,
    color: Ink.ink2,
  },
  frameDeck: {
    flexDirection: 'row',
  },
  cell: {
    width: Layout.frameDeck.size,
    height: Layout.frameDeck.size,
    // Ruled in the card's own fill so the overlap reads as one frame sitting on the next.
    borderWidth: Layout.frameDeck.border,
    borderColor: Ink.bgRaised,
    borderRadius: Layout.radius,
  },
  cellPlaceholder: {
    backgroundColor: Ink.bgPlaceholder,
  },
  cellOverlap: {
    marginLeft: -Layout.frameDeck.overlap,
  },
  // Page: `height:1px; margin:0 -16px` — edge to edge inside the card.
  rule: {
    height: Layout.hairline,
    backgroundColor: Ink.line,
    marginHorizontal: -Layout.cardPadding,
  },
  // Page: `min-height:44px; margin:-8px -16px -12px 0; padding:0 16px` — the target reaches the
  // card's edge and eats the card's bottom padding, the word sits on the content column.
  deleteButton: {
    alignSelf: 'flex-end',
    minHeight: Layout.hitTarget,
    justifyContent: 'center',
    marginTop: -Space.sm,
    marginRight: -Layout.cardPadding,
    marginBottom: -Space.md,
    paddingHorizontal: Layout.cardPadding,
  },
  // Sentence case and underlined, NOT the uppercase label register the band word uses. The
  // underline is the affordance — nothing else in this row is underlined.
  deleteText: {
    ...Type.bodySmMedium,
    color: Ink.ink2,
    textDecorationLine: 'underline',
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  disabled: {
    opacity: DISABLED_OPACITY,
  },
});
