/**
 * One Past Analyses row, recomposed for Cadence Arcs. Extracted out of `app/(tabs)/history.tsx`
 * (where it was a local `HistoryRow` sharing the screen's whole stylesheet) so the row's own
 * geometry lives next to the row rather than inside a 600-line screen.
 *
 * THE COMPOSITION, and what changed:
 *
 *   - THE ROW LEADS WITH A RING. The score used to be a bare numeral in a text column. It is now
 *     an `<ArcRing>` at the same diameter and stroke `components/pace-readout.tsx` gives a PILLAR
 *     ring, which is the point: a history row and a pillar row are the same object at the same
 *     scale, so scanning this list feels like scanning the result screen it leads to. The score is
 *     encoded three ways here now (arc length, arc colour, numeral) instead of one.
 *   - THE FRAME STRIP IS A DECK. It used to be N thumbnails laid out edge to edge, which at six
 *     frames simply ran out of row. They now overlap into a shallow deck, capped at
 *     `MAX_VISIBLE_FRAMES`, each ringed in `hairline` so the stack separates. This says "there are
 *     several stored frames" in a fixed width, which is what the row actually needs to say —
 *     Ruling 1's frames-only storage is the product fact worth surfacing, not the exact count.
 *   - DELETE MOVED TO ITS OWN LINE, under a hairline. It is still a PERSISTENT, VISIBLY LABELLED
 *     control (Ian's decision, `docs/design/copy-deck.md` Screen 8 — never swipe, never
 *     long-press, never an unlabelled glyph on an irreversible action). What it is not any more is
 *     a fourth column fighting the ring and the deck for a phone's row width and losing at large
 *     Dynamic Type sizes. Same behaviour, same a11y label, more room.
 *
 * A NOT-ASSESSED ROW keeps the dashed, unfilled ring `<ArcRing fraction={null}>` draws and states
 * the reason in words — never a zero, never a stringified null. Same rule the readout enforces.
 *
 * SURFACE CONTRACT: the row is an opaque `surface.base` card, which is what lets it carry
 * `text.secondary` and `Score[band].text` at all (`Gradient.page` carries `text.primary` only —
 * CLAUDE.md § Code conventions). It is drawn here rather than with `<SurfaceCard>` because the row
 * is a `Pressable` composition with an internal divider, not a passive panel.
 *
 * NO BUSINESS LOGIC: it renders one `HistoryListItem` and emits two intents (open, delete).
 */
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ArcRing } from '@/components/ui/arc-ring';
import { Copy } from '@/constants/copy';
import {
  Arc,
  Colors,
  FontFamily,
  FontSize,
  HitTarget,
  Opacity,
  Radius,
  Score,
  ScoreBandLabel,
  Spacing,
  Tracking,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  formatHistoryDate,
  formatHistoryItemA11yLabel,
  formatHistoryItemDeleteA11yLabel,
  type HistoryListItem,
} from '@/lib/history';

/** The row's score ring — deliberately identical to `pace-readout.tsx`'s `PILLAR_RING_SIZE` /
 *  `PILLAR_RING_STROKE`. See this file's header on why the match is the design. */
const ROW_RING_SIZE = 64;
const ROW_RING_STROKE = 6;

/** The frame deck. `OVERLAP` is how far each tile sits under the one before it, so the deck's
 *  width is bounded no matter how many frames a row stored. */
const FRAME_THUMBNAIL_SIZE = 44;
const FRAME_OVERLAP = 22;
const MAX_VISIBLE_FRAMES = 3;

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
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = createStyles(colors);

  const dateLabel = formatHistoryDate(item.createdAt);
  const { overall } = item.outcome.result;
  const assessed = overall.score !== null && overall.band !== null;
  const visibleUris = thumbnailUris.slice(0, MAX_VISIBLE_FRAMES);

  return (
    <View style={styles.row} testID={`history-row-${item.id}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={formatHistoryItemA11yLabel(item, dateLabel)}
        onPress={onPress}
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
        <ArcRing
          testID={`history-ring-${item.id}`}
          size={ROW_RING_SIZE}
          strokeWidth={ROW_RING_STROKE}
          fraction={overall.score !== null ? overall.score / 100 : null}
          color={overall.band !== null ? Score[overall.band][scheme].fill : Arc[scheme].ornament}>
          {overall.score !== null ? (
            <Text style={styles.scoreNumeral}>{overall.score}</Text>
          ) : null}
        </ArcRing>

        <View style={styles.rowInfo}>
          {assessed && overall.band !== null ? (
            <Text style={[styles.bandWord, { color: Score[overall.band][scheme].text }]}>
              {ScoreBandLabel[overall.band]}
            </Text>
          ) : (
            <Text style={styles.notAssessedText}>{Copy.result.pillar.notAssessed.generic}</Text>
          )}
          {/* The date is the row's supporting metadata, in the metrics face — a measurement's
              timestamp, set the same way every other measured value in the app is. */}
          <Text style={styles.dateText}>{dateLabel}</Text>
        </View>

        {visibleUris.length > 0 ? (
          <View style={styles.frameDeck} testID={`history-frame-strip-${item.id}`}>
            {visibleUris.map((uri, index) => (
              <Image
                key={`${item.id}-${index}`}
                source={{ uri }}
                style={[styles.thumbnail, index > 0 && { marginLeft: -FRAME_OVERLAP }]}
                contentFit="cover"
              />
            ))}
          </View>
        ) : (
          // Covers BOTH the "still resolving" moment and the real "no thumbnail" outcome (empty
          // media_paths, or every signed-URL attempt failed) with one neutral placeholder — never
          // a broken image, never a crash (see `lib/history.ts`'s header on this exact case).
          <View style={styles.thumbnailPlaceholder} testID={`history-frame-placeholder-${item.id}`} />
        )}
      </Pressable>

      <View style={styles.divider} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={formatHistoryItemDeleteA11yLabel(item, dateLabel)}
        accessibilityState={{ disabled: isDeleting }}
        disabled={isDeleting}
        onPress={onDelete}
        style={({ pressed }) => [
          styles.deleteButton,
          pressed && !isDeleting && styles.pressed,
          isDeleting && styles.disabled,
        ]}
        testID={`history-delete-${item.id}`}>
        {/* A visible word, not a glyph. Delete here is destructive and irreversible — it purges
            the stored frames with the row — and an unlabelled icon would be the one place in this
            redesign where looking tidier costs the user real clarity. */}
        <Text style={styles.deleteText}>{Copy.history.item.deleteCta}</Text>
      </Pressable>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: {
      backgroundColor: colors.surface.base,
      borderColor: colors.hairline,
      borderRadius: Radius.card,
      borderWidth: StyleSheet.hairlineWidth * 2,
      overflow: 'hidden',
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
    },
    rowMain: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: Spacing.lg,
      paddingVertical: Spacing.xs,
    },
    rowInfo: {
      flex: 1,
      gap: Spacing.xs,
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
      letterSpacing: Tracking.eyebrow,
      textTransform: 'uppercase',
    },
    dateText: {
      color: colors.text.secondary,
      fontFamily: FontFamily.mono.regular,
      fontSize: FontSize.xs,
    },
    notAssessedText: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
    },
    frameDeck: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    thumbnail: {
      width: FRAME_THUMBNAIL_SIZE,
      height: FRAME_THUMBNAIL_SIZE,
      // `Radius.tile`, not `Radius.card`: a thumbnail nested inside a 24pt-cornered row needs the
      // tighter inner corner, or the two radii fight.
      borderRadius: Radius.tile,
      backgroundColor: colors.surface.raised,
      // The ring is what keeps an overlapping deck readable as separate frames rather than as one
      // smeared image — without it the tiles blend into each other wherever two frames are similar,
      // which for consecutive frames of the same stride is most of the time.
      borderColor: colors.surface.base,
      borderWidth: 2,
    },
    thumbnailPlaceholder: {
      width: FRAME_THUMBNAIL_SIZE,
      height: FRAME_THUMBNAIL_SIZE,
      borderRadius: Radius.tile,
      backgroundColor: colors.surface.raised,
      borderColor: colors.hairline,
      borderWidth: 1,
    },
    // Full-bleed to the row's own edges (the negative margins cancel `paddingHorizontal`), so it
    // reads as the row splitting in two rather than as a rule floating inside it.
    divider: {
      backgroundColor: colors.hairline,
      height: StyleSheet.hairlineWidth,
      marginHorizontal: -Spacing.lg,
      marginTop: Spacing.md,
    },
    deleteButton: {
      alignItems: 'flex-end',
      justifyContent: 'center',
      minHeight: HitTarget.min,
      // Bleeds into the row's own horizontal padding so the target reaches the row's edge while
      // the label still sits on the content column's right margin.
      marginRight: -Spacing.lg,
      paddingHorizontal: Spacing.lg,
    },
    // Sentence case and underlined, NOT the uppercase eyebrow register the band word above uses.
    // That register is this app's LABEL voice ("this names a value"); borrowing it for a control
    // would make the one destructive action in the list look like a caption. The underline is the
    // affordance — nothing else in this row is underlined.
    deleteText: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      textDecorationLine: 'underline',
    },
    pressed: {
      opacity: Opacity.pressed,
    },
    disabled: {
      opacity: Opacity.disabled,
    },
  });
}
