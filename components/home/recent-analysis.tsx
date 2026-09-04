/**
 * Home's hero slot — the Cadence Arcs composition of "the last thing you did", and Home's entry
 * point back into it (design brief §4.2: "once there's history, the most recent gait-plate
 * thumbnail"; Home previously had no route to a past result at all, so the only way back to a
 * finished analysis was the History tab).
 *
 * WHY A RING RATHER THAN A THUMBNAIL. The brief predates the redesign and asked for a stored frame
 * here. The motif answers the same need better: an arc ring is the shape this app already uses for
 * a score everywhere else (`components/pace-readout.tsx`'s overall ring, `app/(tabs)/history.tsx`'s
 * row rings), so the thing Home leads with is recognisably the same object the result screen
 * ended on, one size up. A 56pt frame crop of a runner, at Home scale, carries no information the
 * score does not — and Past Analyses is where the frames genuinely belong.
 *
 * FOUR STATES, and the split between the last two is the honest one. `empty` says "nothing
 * analyzed yet" — a claim. `unavailable` is what a failed read gets: the ring still draws (the
 * composition survives) but NOTHING claims the user has no history, because we do not know. Home
 * is fully usable in either: the quota block and the primary CTA below this are untouched by it.
 *
 * The `empty` and `unavailable` rings are drawn with `<ArcRing fraction={null}>` — the dashed,
 * unfilled track that means "nothing to report" everywhere else in the app. That is deliberate
 * reuse of the motif's own vocabulary rather than a new picture for a new screen: a user who has
 * seen a not-assessed pillar already knows what a dashed ring means.
 *
 * SURFACE CONTRACT (CLAUDE.md § Code conventions). The ready state sits on an opaque
 * `<SurfaceCard>` because it carries `text.secondary` (the date) and `Score[band].text` (the band
 * word), neither of which `Gradient.page` is proven for. The empty state carries `text.primary`
 * only, so it may sit directly on the wash — which is what lets it stay a big, airy hero instead
 * of a card announcing that there is nothing in it.
 *
 * NO BUSINESS LOGIC. This component renders whichever state it is handed and emits one intent
 * (open this analysis). It does not fetch, does not decide what "recent" means, and does not read
 * tier or quota.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { KineticText } from '@/components/kinetic-text';
import { ArcLoader } from '@/components/arc-loader';
import { ArcRing } from '@/components/ui/arc-ring';
import { Eyebrow } from '@/components/ui/eyebrow';
import { SurfaceCard } from '@/components/ui/surface-card';
import { Copy } from '@/constants/copy';
import {
  Meter,
  Colors,
  FontFamily,
  FontSize,
  LineHeight,
  Motion,
  Opacity,
  Score,
  ScoreBandLabel,
  Spacing,
  Tracking,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatHistoryDate, formatHistoryItemA11yLabel, type HistoryListItem } from '@/lib/history';

/** The hero ring's geometry. Composition, not tokens — same call `components/pace-readout.tsx`
 *  makes for its own two ring sizes, and for the same reason: a ring's diameter expresses this
 *  screen's hierarchy, not a reusable scale step. Deliberately a little smaller than the result
 *  screen's 208pt overall ring, so arriving at a result still feels like a step up. */
const HERO_RING_SIZE = 176;
const HERO_RING_STROKE = 12;

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
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = createStyles(colors);

  if (state.status === 'loading') {
    // The motif's own wait state, at the exact diameter the ring that replaces it will occupy —
    // so the hero does not resize when the read lands. Indeterminate by construction; see
    // `<ArcLoader>`'s header on why it can never be read as progress.
    return (
      <View style={styles.heroBlock}>
        <ArcLoader size={HERO_RING_SIZE} testID="home-recent-loading" />
      </View>
    );
  }

  if (state.status !== 'ready') {
    return (
      <View style={styles.heroBlock}>
        <ArcRing
          testID="home-recent-empty-ring"
          size={HERO_RING_SIZE}
          strokeWidth={HERO_RING_STROKE}
          fraction={null}
          color={Meter[scheme].rule}
        />
        {/* Only the genuinely-empty branch gets to say so — the failed-read branch shows the ring
            and stays silent rather than telling a user with a full history that they have none. */}
        {state.status === 'empty' ? (
          <KineticText
            style={styles.emptyLine}
            containerStyle={styles.emptyLineRow}
            staggerMs={Motion.stagger.line}
            testID="home-hero-line">
            {Copy.home.empty.caption}
          </KineticText>
        ) : null}
      </View>
    );
  }

  const { item } = state;
  const { overall } = item.outcome.result;
  const dateLabel = formatHistoryDate(item.createdAt);
  const assessed = overall.score !== null && overall.band !== null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={formatHistoryItemA11yLabel(item, dateLabel)}
      onPress={() => onOpen(item)}
      style={({ pressed }) => [styles.recentPressable, pressed && styles.pressed]}
      testID="home-recent">
      <SurfaceCard tone="raised" style={styles.recentCard}>
        <View style={styles.recentInner}>
          <Eyebrow>{Copy.result.overall.label}</Eyebrow>
          <ArcRing
            testID="home-recent-ring"
            size={HERO_RING_SIZE}
            strokeWidth={HERO_RING_STROKE}
            fraction={overall.score !== null ? overall.score / 100 : null}
            color={overall.band !== null ? Score[overall.band][scheme].fill : Meter[scheme].rule}>
            {assessed && overall.band !== null ? (
              <View style={styles.scoreStack}>
                {/* Home's ONE display-or-larger element (spec 2026-07-26 §3.1). The empty state's
                    kinetic line is `xxl`, so the rule holds in both branches. `adjustsFontSizeToFit`
                    for the same Dynamic Type reason the readout's own numeral carries it. */}
                <Text
                  testID="home-recent-score"
                  style={styles.numeral}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.5}>
                  {overall.score}
                </Text>
                <Text style={[styles.bandWord, { color: Score[overall.band][scheme].text }]}>
                  {ScoreBandLabel[overall.band]}
                </Text>
              </View>
            ) : null}
          </ArcRing>
          {/* A not-assessed overall keeps the dashed ring and states the reason below it, exactly
              as `components/pace-readout.tsx` does — never a stringified null, never a zero. */}
          {assessed ? (
            <Text style={styles.dateLine}>{dateLabel}</Text>
          ) : (
            <Text style={styles.notAssessed}>{Copy.result.pillar.notAssessed.generic}</Text>
          )}
        </View>
      </SurfaceCard>
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    heroBlock: {
      alignItems: 'center',
      alignSelf: 'stretch',
      gap: Spacing.xl,
    },
    emptyLineRow: {
      justifyContent: 'center',
      paddingHorizontal: Spacing.xl,
    },
    emptyLine: {
      color: colors.text.primary,
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.xxl,
      letterSpacing: Tracking.display,
      lineHeight: FontSize.xxl * LineHeight.display,
      textAlign: 'center',
    },
    recentPressable: {
      alignSelf: 'stretch',
    },
    recentCard: {
      alignSelf: 'stretch',
    },
    recentInner: {
      alignItems: 'center',
      gap: Spacing.lg,
    },
    scoreStack: {
      alignItems: 'center',
      gap: Spacing.xs,
    },
    numeral: {
      color: colors.text.primary,
      fontFamily: FontFamily.display.bold,
      fontSize: FontSize.display,
      letterSpacing: Tracking.hero,
      lineHeight: FontSize.display * LineHeight.hero,
      textAlign: 'center',
    },
    bandWord: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.sm,
      letterSpacing: Tracking.eyebrow,
      textAlign: 'center',
      textTransform: 'uppercase',
    },
    // The date is metadata about a measurement, so it takes the metrics face — the same register
    // the quota caption below it uses, which is what makes the two read as one column of facts.
    dateLine: {
      color: colors.text.secondary,
      fontFamily: FontFamily.mono.regular,
      fontSize: FontSize.xs,
      textAlign: 'center',
    },
    notAssessed: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      textAlign: 'center',
    },
    pressed: {
      opacity: Opacity.pressed,
    },
  });
}
