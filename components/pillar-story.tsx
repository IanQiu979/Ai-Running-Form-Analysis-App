/**
 * The pillars story — the signed-out entry flow's words, rebuilt on 2026-09-20 (captain's
 * device-test decision) as ONE PILLAR PER SCREEN-HEIGHT SECTION, revealed by scrolling, and
 * split on 2026-10-05 (the captain's next device test: the four pillar screens "waste the
 * user's time" at the start). Two pieces, used in two places:
 *
 *   - `<StoryIntro>` — the page's Display title, its H2 sentence and its one paragraph. It stays
 *     in the main entry scroll (`app/(auth)/welcome.tsx`): hero -> intro -> Get started.
 *   - `<PillarStory>` — the four pillars in `PACE_PILLARS` order, now OPTIONAL: an understated
 *     link on Get started opens them in their own paged view (`app/(auth)/pillars.tsx`). A
 *     pillar section is the pillar's box (V23-04, `components/pillar-box.tsx`) large and centred
 *     with its one-line description beneath; the first carries the "Tap a pillar for details"
 *     hint above its box, and the last ends with the way back to Get started.
 *
 * Every section is exactly `sectionHeight` tall so the page snap lands on one at a time, and
 * holds at most three type sizes. `<StorySection>` and `<Reveal>` are exported so the entry
 * scroll's Get started section arrives with the same rise.
 *
 * REVEAL. Every item mounts at the first frame of `v23rise` (opacity 0, 12 pt low) and rises
 * once its section has scrolled far enough into view — `lib/entry-story.ts` decides when, the
 * screen counts. Items in a section rise on the arrive curve over `Motion.duration.storyRise`,
 * staggered `Motion.stagger.story` in reading order. A revealed section stays revealed. Reduced
 * motion renders everything in place.
 *
 * ONE BOX OPEN AT A TIME. The box's own open card (name, description, metric and range, with a
 * close control) is the pillar's details, expanding in place; the section's description line
 * steps aside while the card is open, since the card says the same sentence. Only a
 * `PacePillarId | null` is held; the boxes own their open/close motion.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PillarBox } from '@/components/pillar-box';
import { SquareButton } from '@/components/ui/square-button';
import { Copy } from '@/constants/copy';
import { Ink, Layout, Motion, Space, Type } from '@/constants/v23-theme';
import { PACE_PILLARS, type PacePillarId } from '@shared/pace';

/** One section per pillar. */
export const PILLAR_SECTION_COUNT = PACE_PILLARS.length;

/** The closed box's side, as a share of the section height: large, and still clear of the
 *  hint above and the description beneath on a 667 pt phone. Capped by the column's width. */
const BOX_HEIGHT_FRACTION = 0.42;
/** The story column: the design canvas less its gutters, centred on anything wider. */
const COLUMN_WIDTH = Layout.canvas.width - 2 * Layout.gutter;

type PillarStoryProps = {
  /** One section's height — the scroll viewport's, measured by the screen. */
  sectionHeight: number;
  /** How many pillar sections, from the first, have had their reveal reached. */
  revealedCount: number;
  reduceMotion: boolean;
  /** The way back to Get started, at the end of the last pillar section. */
  onBack: () => void;
};

export function PillarStory({ sectionHeight, revealedCount, reduceMotion, onBack }: PillarStoryProps) {
  const [open, setOpen] = useState<PacePillarId | null>(null);

  return (
    <>
      {PACE_PILLARS.map((id, index) => (
        <PillarSection
          key={id}
          id={id}
          sectionHeight={sectionHeight}
          revealed={revealedCount > index}
          reduceMotion={reduceMotion}
          hint={index === 0}
          open={open === id}
          onToggle={() => setOpen((current) => (current === id ? null : id))}
          onBack={index === PACE_PILLARS.length - 1 ? onBack : undefined}
        />
      ))}
    </>
  );
}

type SectionProps = {
  sectionHeight: number;
  revealed: boolean;
  reduceMotion: boolean;
};

/** The story's intro: the first section after the hero in the entry scroll. */
export function StoryIntro({ sectionHeight, revealed, reduceMotion }: SectionProps) {
  return (
    <StorySection sectionHeight={sectionHeight} testID="story-section-intro">
      <Reveal order={0} revealed={revealed} reduceMotion={reduceMotion}>
        <Text style={styles.title} accessibilityRole="header">
          {Copy.entry.details.title}
        </Text>
      </Reveal>
      <Reveal order={1} revealed={revealed} reduceMotion={reduceMotion}>
        <Text style={styles.lede}>{Copy.entry.details.lede}</Text>
      </Reveal>
      <Reveal order={2} revealed={revealed} reduceMotion={reduceMotion}>
        <Text style={styles.reads}>{Copy.entry.details.reads}</Text>
      </Reveal>
    </StorySection>
  );
}

type PillarSectionProps = SectionProps & {
  id: PacePillarId;
  /** The first pillar section carries the tap hint above its box. */
  hint: boolean;
  open: boolean;
  onToggle: () => void;
  /** Present on the last pillar section only: the way back to Get started at its end. */
  onBack?: () => void;
};

function PillarSection({
  id,
  sectionHeight,
  revealed,
  reduceMotion,
  hint,
  open,
  onToggle,
  onBack,
}: PillarSectionProps) {
  const copy = Copy.entry.details.pillar[id];
  const boxSide = Math.min(COLUMN_WIDTH, Math.round(sectionHeight * BOX_HEIGHT_FRACTION));
  // Reading order: the hint (when there is one), the box, the description, the way back.
  const boxOrder = hint ? 1 : 0;
  const descOrder = boxOrder + 1;
  const entryOrder = descOrder + 1;

  return (
    <StorySection
      sectionHeight={sectionHeight}
      testID={`story-section-${id}`}
      footer={
        onBack && (
          <Reveal order={entryOrder} revealed={revealed} reduceMotion={reduceMotion} style={styles.entry}>
            <SquareButton
              variant="link"
              label={Copy.entry.pillars.backToStart}
              onPress={onBack}
              testID="pillars-back-to-start"
            />
          </Reveal>
        )
      }>
      {hint && (
        <Reveal order={0} revealed={revealed} reduceMotion={reduceMotion}>
          <Text style={styles.hint} testID="story-hint">
            {Copy.entry.details.hint}
          </Text>
        </Reveal>
      )}
      <Reveal
        order={boxOrder}
        revealed={revealed}
        reduceMotion={reduceMotion}
        // The closed square is `boxSide` wide; the open card takes the column.
        style={open ? styles.openSlot : [styles.closedSlot, { width: boxSide }]}>
        <PillarBox id={id} open={open} onToggle={onToggle} reduceMotion={reduceMotion} testID={`pillar-box-${id}`} />
      </Reveal>
      {!open && (
        <Reveal order={descOrder} revealed={revealed} reduceMotion={reduceMotion}>
          <Text style={styles.desc}>{copy.desc}</Text>
        </Reveal>
      )}
    </StorySection>
  );
}

type SectionShellProps = {
  sectionHeight: number;
  testID: string;
  children: ReactNode;
  /** Pinned to the section's end, under the centred column. */
  footer?: ReactNode;
};

/** One screen-height section: the live safe areas (never less than the design's), the gutter,
 *  and a centred column that holds its items in the middle of the height. */
export function StorySection({ sectionHeight, testID, children, footer }: SectionShellProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.section,
        {
          height: sectionHeight,
          paddingTop: Math.max(insets.top, Layout.canvas.safeTop),
          paddingBottom: Math.max(insets.bottom, Layout.canvas.safeBottom),
        },
      ]}
      testID={testID}>
      <View style={styles.column}>{children}</View>
      {footer}
    </View>
  );
}

type RevealProps = {
  /** The item's place in its section's reading order; its delay is `order` staggers. */
  order: number;
  revealed: boolean;
  reduceMotion: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/** One item's `v23rise`, held at its first frame until the section is revealed, then run once.
 *  An item that mounts into an already-revealed section (the description line returning after
 *  its card closes) lands in place — the arrival belongs to the scroll, not to a remount. */
export function Reveal({ order, revealed, reduceMotion, style, children }: RevealProps) {
  const progress = useSharedValue(reduceMotion || revealed ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1;
      return;
    }
    if (!revealed || progress.value === 1) return;
    progress.value = withDelay(
      order * Motion.stagger.story,
      withTiming(1, { duration: Motion.duration.storyRise, easing: Easing.bezier(...Motion.curve.arrive) })
    );
  }, [revealed, reduceMotion, order, progress]);

  const riseStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: Motion.pageShift * (1 - progress.value) }],
  }));

  return <Animated.View style={[styles.item, style, riseStyle]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: Layout.gutter,
  },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: COLUMN_WIDTH,
    alignSelf: 'center',
    justifyContent: 'center',
    gap: Space.xl,
  },
  item: {
    alignSelf: 'stretch',
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
    ...Type.body,
    color: Ink.ink,
  },
  hint: {
    ...Type.label,
    color: Ink.ink2,
    textAlign: 'center',
  },
  closedSlot: {
    alignSelf: 'center',
    maxWidth: '100%',
  },
  openSlot: {
    width: '100%',
  },
  desc: {
    ...Type.body,
    color: Ink.ink2,
    textAlign: 'center',
  },
  entry: {
    width: '100%',
    maxWidth: COLUMN_WIDTH,
    alignSelf: 'center',
  },
});
