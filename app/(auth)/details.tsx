/**
 * V23-03 · Details — "what the app does", the second screen of the signed-out entry flow
 * (hero → details → sign-up), transcribed from the captain-approved page. Same black as the hero;
 * this is where the words are.
 *
 * CONTENT, in the page's order: the Display title and one H2 sentence; the "What it reads"
 * label and its Body paragraph, plain text with no box; the four pillar boxes (V23-04,
 * `components/pillar-box.tsx`) in a 2 x 2 grid; 40 pt of deliberate air where the removed
 * "what a photo can / can't tell you" block used to sit; and the "Continue" cue, a tap (not a
 * scroll) to sign-up, pinned to the bottom of the page.
 *
 * ARRIVAL is the page's `v23rise`: every item fades in and rises 12 pt over 600 ms on the arrive
 * curve, staggered — header at 0, "What it reads" at 60 ms, then the grid's boxes at 120 + 60·i in
 * reading order (the boxes run their own rise; see `PillarBox`'s `delayMs`). The whole arrival is
 * under 700 ms and nothing else on the page moves. Reduced motion renders everything in place.
 *
 * ONE BOX OPEN AT A TIME, AND THE OPEN ONE GOES FIRST. The page's open card is
 * `grid-column: 1/-1; order: -1` — it takes the full width and moves to the TOP of the grid, with
 * the other three reflowing beneath it as a 2-column grid. That ordering is what keeps the open
 * card's text from landing under the fold when the fourth box is the one tapped, so the grid here
 * is built the same way: the open pillar (if any) rendered first at full width, then the remaining
 * three as wrapped squares, rather than an in-place expansion. Only a `PacePillarId | null` is
 * held; the boxes own their own open/close motion.
 */
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PillarBox } from '@/components/pillar-box';
import { SquareButton } from '@/components/ui/square-button';
import { Copy } from '@/constants/copy';
import { Ink, Layout, Motion, Space, Type } from '@/constants/v23-theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { PACE_PILLARS, type PacePillarId } from '@shared/pace';

/** The page's stagger: header at 0, the paragraph one `item` later, the grid two `item`s in and
 *  then one more per box. */
const HEADER_DELAY_MS = 0;
const READS_DELAY_MS = Motion.stagger.item;
const GRID_DELAY_MS = 2 * Motion.stagger.item;
/** When the last box has finished rising: the fourth box's delay plus one rise. */
const ARRIVAL_TOTAL_MS =
  GRID_DELAY_MS + Motion.stagger.item * (PACE_PILLARS.length - 1) + Motion.duration.rise;

/** A closed square's width before the grid has measured itself: two per row with one `gridGap`
 *  between them, as a percentage that leaves room for the gap. Replaced by the exact
 *  `(width - gap) / 2` the moment `onLayout` reports the grid's width — the page's
 *  `grid-template-columns: 1fr 1fr` is exact, and a lone third square must not grow to fill its
 *  row. */
const SQUARE_BASIS_FALLBACK = '48%';

export default function DetailsScreen() {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState<PacePillarId | null>(null);
  const [gridWidth, setGridWidth] = useState<number | null>(null);
  // The arrival plays ONCE, on first mount. A square that remounts later (after its card is
  // closed) must land in place, so the stagger is withheld once the last box has arrived.
  const [arrived, setArrived] = useState(reduceMotion);

  useEffect(() => {
    if (arrived) return;
    const handle = setTimeout(() => setArrived(true), ARRIVAL_TOTAL_MS);
    return () => clearTimeout(handle);
  }, [arrived]);

  const closed = PACE_PILLARS.filter((id) => id !== open);
  const squareWidth =
    gridWidth === null ? SQUARE_BASIS_FALLBACK : (gridWidth - Layout.gridGap) / 2;

  function measureGrid(event: LayoutChangeEvent) {
    const next = event.nativeEvent.layout.width;
    if (next > 0 && next !== gridWidth) setGridWidth(next);
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top, Layout.canvas.safeTop),
            paddingBottom: Math.max(insets.bottom, Layout.canvas.safeBottom),
          },
        ]}>
        <Rise delayMs={HEADER_DELAY_MS} reduceMotion={reduceMotion} style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            {Copy.entry.details.title}
          </Text>
          <Text style={styles.lede}>{Copy.entry.details.lede}</Text>
        </Rise>

        <Rise delayMs={READS_DELAY_MS} reduceMotion={reduceMotion} style={styles.reads}>
          <Text style={styles.readsLabel}>{Copy.entry.details.reads.label}</Text>
          <Text style={styles.readsBody}>{Copy.entry.details.reads.body}</Text>
        </Rise>

        <View style={styles.grid} onLayout={measureGrid} testID="details-pillar-grid">
          {open !== null && (
            <View style={styles.openSlot}>
              <PillarBox
                id={open}
                open
                onToggle={() => setOpen(null)}
                reduceMotion={reduceMotion}
                testID={`pillar-box-${open}`}
              />
            </View>
          )}
          {closed.map((id) => (
            <View key={id} style={{ width: squareWidth }}>
              <PillarBox
                id={id}
                open={false}
                onToggle={() => setOpen(id)}
                // Reading order is the pillar's own index; withheld after the first arrival.
                delayMs={
                  arrived ? undefined : GRID_DELAY_MS + Motion.stagger.item * PACE_PILLARS.indexOf(id)
                }
                reduceMotion={reduceMotion}
                testID={`pillar-box-${id}`}
              />
            </View>
          ))}
        </View>

        {/* The air left where the removed "what a photo can / can't tell you" block sat. */}
        <View style={styles.air} />

        <SquareButton
          variant="link"
          label={Copy.entry.details.cue}
          onPress={() => router.push('/sign-in')}
          style={styles.cue}
          testID="details-continue"
        />
      </ScrollView>
    </View>
  );
}

type RiseProps = {
  delayMs: number;
  reduceMotion: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/** The page's `v23rise` for one item: fade in and rise 12 pt over 600 ms, after `delayMs`. */
function Rise({ delayMs, reduceMotion, style, children }: RiseProps) {
  const progress = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(
      delayMs,
      withTiming(1, { duration: Motion.duration.rise, easing: Easing.bezier(...Motion.curve.arrive) })
    );
  }, [delayMs, reduceMotion, progress]);

  const riseStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: Motion.pageShift * (1 - progress.value) }],
  }));

  return <Animated.View style={[style, riseStyle]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Ink.bg,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: Layout.gutter,
    gap: Layout.sectionGap,
  },
  header: {
    gap: Space.lg,
  },
  title: {
    ...Type.display,
    color: Ink.ink,
  },
  lede: {
    ...Type.h2,
    color: Ink.ink,
  },
  reads: {
    gap: Space.sm,
  },
  readsLabel: {
    ...Type.label,
    color: Ink.ink2,
  },
  readsBody: {
    ...Type.body,
    color: Ink.ink,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Layout.gridGap,
  },
  openSlot: {
    width: '100%',
  },
  air: {
    height: Layout.sectionGap,
  },
  cue: {
    marginTop: 'auto',
  },
});
