/**
 * V23-04 · Pillar box — one of the four P / A / C / E squares on the details page
 * (now one per section of `components/pillar-story.tsx`), in its two states, transcribed from
 * the captain-approved page.
 *
 * CLOSED is a 1:1 `bgRaised` square with a 1 px `line` border: the pillar's single letter in
 * Display top-left, its name in Label bottom-left, nothing else. OPEN is the same surface at full
 * width, holding the name (H2), the app's one-sentence description (Body, `ink2`), and the metric
 * it reports beside its healthy range (Metric + Small). A 44 pt "×" in the top-right closes it.
 * Which of the two mounts, and where in the grid, is the parent's decision — this component only
 * draws the state it is given.
 *
 * THE OPENING MOTION is the page's `v23expand`: 320 ms on the arrive curve, opacity 0.5 → 1 while
 * the content clips in from the top — `clip-path: inset(0 0 45% 0) → inset(0)`. React Native has
 * no `clip-path`, so the same picture is drawn with the one clip it does have: an
 * `overflow: 'hidden'` box whose HEIGHT runs from 55 % of the measured content height to 100 %.
 * The content itself never moves or resizes — it is laid out once at full size and the box reveals
 * it from the top down, which is exactly what an inset clip shrinking to zero looks like. The
 * content's height comes from its own `onLayout`; until that first measurement lands the box is
 * unclipped so nothing ever flashes empty. Closing runs the same tween in reverse and only then
 * tells the parent, so the square does not snap back while the card is still mid-collapse.
 *
 * THE ARRIVAL is not this component's. Since the 2026-09-20 story (`components/pillar-story.tsx`)
 * each box is revealed by the scroll that brings its section into view, and the section owns
 * that rise; the closed box mounts at rest. (The 2026-09-13 grid's per-box `delayMs` stagger came
 * off with the grid.)
 *
 * Reduced motion mounts either state directly, at rest.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Copy } from '@/constants/copy';
import { Font, Ink, Layout, Motion, Space, Type } from '@/constants/v23-theme';
import { pillarLetter } from '@/lib/pace-readout';
import type { PacePillarId } from '@shared/pace';

/** The page's mid-expansion frame clips the bottom 45 % of the card, i.e. the reveal starts with
 *  55 % of the content showing. */
const EXPAND_START_FRACTION = 0.55;
/** `v23expand` starts the card at half opacity. */
const EXPAND_START_OPACITY = 0.5;
/** The close glyph: `font: 400 22px/1 'Inter Tight'` on the page. Not a scale role — it is one
 *  glyph, sized to sit optically level with the H2 beside it. */
const CLOSE_GLYPH_SIZE = 22;
/** The close hit target is a 44 pt square pulled 14 pt up and out into the card's 16 pt padding
 *  (page: `margin:-14px -14px 0 0`), so the glyph lands in the corner while the tappable square
 *  clears the a11y floor. */
const CLOSE_OUTSET = 14;
/** A pressed control's dip — the sheet draws no pressed state, so it is a plain opacity, the same
 *  value `components/ui/square-button.tsx` uses. */
const PRESSED_OPACITY = 0.6;

type PillarBoxProps = {
  id: PacePillarId;
  open: boolean;
  /** Fired by the square (to open) and by the "×" (to close, after its reverse tween). */
  onToggle: () => void;
  reduceMotion?: boolean;
  testID?: string;
};

export function PillarBox({ id, open, onToggle, reduceMotion = false, testID }: PillarBoxProps) {
  return open ? (
    <OpenBox id={id} onClose={onToggle} reduceMotion={reduceMotion} testID={testID} />
  ) : (
    <ClosedBox id={id} onOpen={onToggle} testID={testID} />
  );
}

type ClosedBoxProps = {
  id: PacePillarId;
  onOpen: () => void;
  testID?: string;
};

function ClosedBox({ id, onOpen, testID }: ClosedBoxProps) {
  const copy = Copy.entry.details.pillar[id];

  return (
    <View style={styles.square} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.name}
        accessibilityState={{ expanded: false }}
        onPress={onOpen}
        style={({ pressed }) => [styles.squareInner, pressed && styles.pressed]}>
        <Text style={styles.letter}>{pillarLetter(id)}</Text>
        <Text style={styles.name}>{copy.name}</Text>
      </Pressable>
    </View>
  );
}

type OpenBoxProps = {
  id: PacePillarId;
  onClose: () => void;
  reduceMotion: boolean;
  testID?: string;
};

function OpenBox({ id, onClose, reduceMotion, testID }: OpenBoxProps) {
  const copy = Copy.entry.details.pillar[id];
  // 0 = the mid-collapse start (55 % height, half opacity), 1 = fully open.
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  // The content's natural height, once measured. `null` until the first `onLayout`, during which
  // the box stays unclipped — see the header.
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const closingRef = useRef(false);

  useEffect(() => {
    if (reduceMotion) return;
    progress.value = withTiming(1, {
      duration: Motion.duration.expand,
      easing: Easing.bezier(...Motion.curve.arrive),
    });
  }, [reduceMotion, progress]);

  function releaseClosing() {
    closingRef.current = false;
  }

  function handleClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    if (reduceMotion) {
      onClose();
      return;
    }
    progress.value = withTiming(
      0,
      { duration: Motion.duration.expand, easing: Easing.bezier(...Motion.curve.arrive) },
      (finished) => {
        // An interrupted tween (a re-open mid-collapse, a remount) reports `finished: false`;
        // the guard is released so the next tap can try again rather than wedging the card open.
        runOnJS(finished ? onClose : releaseClosing)();
      }
    );
  }

  const clipStyle = useAnimatedStyle(() => {
    const opacity =
      EXPAND_START_OPACITY + (1 - EXPAND_START_OPACITY) * progress.value;
    // Before the first measurement the box is unclipped (full height) so the content can be
    // measured; with motion on it is also invisible for that one frame, or the card would show
    // fully open and then snap to 55 % as the tween begins. Reduced motion has no tween and
    // simply shows it.
    if (contentHeight === null) return { opacity: reduceMotion ? opacity : 0 };
    const fraction = EXPAND_START_FRACTION + (1 - EXPAND_START_FRACTION) * progress.value;
    // The clip box wears the border, so its full height is the content plus both hairlines.
    const fullHeight = contentHeight + 2 * Layout.hairline;
    return { opacity, height: fullHeight * fraction };
  }, [contentHeight, reduceMotion]);

  function measure(event: LayoutChangeEvent) {
    const next = event.nativeEvent.layout.height;
    if (next > 0 && next !== contentHeight) setContentHeight(next);
  }

  return (
    <Animated.View
      style={[styles.clip, clipStyle]}
      testID={testID}
      accessibilityState={{ expanded: true }}>
      <View style={styles.card} onLayout={measure}>
        <View style={styles.headerRow}>
          <Text style={styles.title} accessibilityRole="header">
            {copy.name}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Copy.entry.details.close}
            onPress={handleClose}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
            <Text style={styles.closeGlyph}>×</Text>
          </Pressable>
        </View>
        <Text style={styles.desc}>{copy.desc}</Text>
        <View style={styles.metricRow}>
          <Text style={styles.metric}>{copy.metric}</Text>
          <Text style={styles.range}>{copy.range}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  square: {
    aspectRatio: 1,
    backgroundColor: Ink.bgRaised,
    borderWidth: Layout.hairline,
    borderColor: Ink.line,
    borderRadius: Layout.radius,
  },
  squareInner: {
    flex: 1,
    padding: Layout.cardPadding,
    justifyContent: 'space-between',
  },
  letter: {
    ...Type.display,
    color: Ink.ink,
  },
  name: {
    ...Type.label,
    color: Ink.ink2,
  },
  // The open card's clipping box. The border sits here, not on the content, so it shrinks with
  // the reveal the way the page's clipped card edge does.
  clip: {
    alignSelf: 'stretch',
    overflow: 'hidden',
    backgroundColor: Ink.bgRaised,
    borderWidth: Layout.hairline,
    borderColor: Ink.line,
    borderRadius: Layout.radius,
  },
  card: {
    padding: Layout.cardPadding,
    gap: Space.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    ...Type.h2,
    color: Ink.ink,
    flexShrink: 1,
  },
  close: {
    width: Layout.hitTarget,
    height: Layout.hitTarget,
    marginTop: -CLOSE_OUTSET,
    marginRight: -CLOSE_OUTSET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: {
    fontFamily: Font.tight.regular,
    fontSize: CLOSE_GLYPH_SIZE,
    lineHeight: CLOSE_GLYPH_SIZE,
    color: Ink.ink2,
  },
  desc: {
    ...Type.body,
    color: Ink.ink2,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  metric: {
    ...Type.metric,
    color: Ink.ink,
  },
  range: {
    ...Type.small,
    color: Ink.ink2,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
});
