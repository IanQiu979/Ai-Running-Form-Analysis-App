/**
 * The "not medical advice" disclaimer (issue #68) — rendered on EVERY result, every tier, no
 * exceptions (copy-deck.md § Disclaimer).
 *
 * The full text is `Copy.result.disclaimer.footer`, from the copy deck — NOT the differently-worded
 * version in `knowledge/injury_flags.md`, which is prompt content for the model. Issue #68 points
 * at the knowledge file; it is wrong.
 *
 * FOLDED BY DEFAULT (captain's 2026-10-03 device test, approved 2026-10-05). V23-08 set the full
 * paragraph as bare footnote text; it now reads as one short line —
 * `Copy.result.disclaimer.summary` beside a down chevron — and a tap anywhere on it opens the full
 * `footer` beneath, unchanged word for word; a second tap folds it. It is one button whose
 * `expanded` state is announced, and whose label is the text it is showing, so a screen reader
 * reads the whole disclaimer once it is open. Folding hides the text; it never removes the
 * disclaimer itself, which still mounts on every result.
 *
 * THE MOTION is `Motion.duration.expand` on the `move` curve ("anything moving in place"): the
 * full text sits in an `overflow: 'hidden'` box whose height runs from 0 to the text's measured
 * height while it fades in, so the button below slides down with it rather than jumping. The text
 * is laid out `absolute` inside that box, so it can be measured at full width before the box has
 * any height of its own. Folding runs the same tween back and only then unmounts the text.
 * Reduced motion opens and folds at once, with no clip.
 *
 * This is a component, not a route; `app/result/[id].tsx` owns where it sits.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ChevronDownIcon } from '@/components/ui/v23-icons';
import { Copy } from '@/constants/copy';
import { Ink, Layout, Motion, Space, Type } from '@/constants/v23-theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

/** A pressed control's dip — the same value `components/ui/square-button.tsx` uses. */
const PRESSED_OPACITY = 0.6;

type ResultDisclaimerProps = {
  /** Overrides the OS setting; tests pass it, the screen does not. */
  reduceMotion?: boolean;
};

export function ResultDisclaimer({ reduceMotion: reduceMotionOverride }: ResultDisclaimerProps = {}) {
  const systemReduceMotion = useReducedMotion();
  const reduceMotion = reduceMotionOverride ?? systemReduceMotion;
  const [expanded, setExpanded] = useState(false);
  // The full text stays mounted while it folds, so the collapse can play before it goes.
  const [textMounted, setTextMounted] = useState(false);
  // The full text's natural height, once measured; until then the box stays at 0.
  const [textHeight, setTextHeight] = useState<number | null>(null);
  // 0 = folded, 1 = open.
  const progress = useSharedValue(0);

  function toggle() {
    const timing = { duration: Motion.duration.expand, easing: Easing.bezier(...Motion.curve.move) };
    if (!expanded) {
      setExpanded(true);
      setTextMounted(true);
      progress.value = reduceMotion ? 1 : withTiming(1, timing);
      return;
    }
    setExpanded(false);
    if (reduceMotion) {
      progress.value = 0;
      setTextMounted(false);
      return;
    }
    progress.value = withTiming(0, timing, (finished) => {
      // An interrupted fold (a re-open mid-collapse) reports `finished: false` and keeps the text.
      if (finished) runOnJS(setTextMounted)(false);
    });
  }

  const clipStyle = useAnimatedStyle(
    () => ({ height: (textHeight ?? 0) * progress.value, opacity: progress.value }),
    [textHeight]
  );
  const chevronStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${180 * progress.value}deg` }] }));

  function measure(event: LayoutChangeEvent) {
    const next = event.nativeEvent.layout.height;
    if (next > 0 && next !== textHeight) setTextHeight(next);
  }

  const fullText = (
    <Text testID="result-disclaimer-text" style={[Type.footnote, styles.text, styles.full]}>
      {Copy.result.disclaimer.footer}
    </Text>
  );

  return (
    <Pressable
      testID="result-disclaimer"
      accessibilityRole="button"
      accessibilityLabel={expanded ? Copy.result.disclaimer.footer : Copy.result.disclaimer.summary}
      accessibilityState={{ expanded }}
      onPress={toggle}
      style={({ pressed }) => pressed && styles.pressed}>
      <View style={styles.row}>
        <Text style={[Type.footnote, styles.text, styles.summary]}>{Copy.result.disclaimer.summary}</Text>
        <Animated.View style={chevronStyle}>
          <ChevronDownIcon />
        </Animated.View>
      </View>
      {textMounted ? (
        reduceMotion ? (
          fullText
        ) : (
          <Animated.View testID="result-disclaimer-clip" style={[styles.clip, clipStyle]}>
            <View style={styles.measure} onLayout={measure}>
              {fullText}
            </View>
          </Animated.View>
        )
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The one line is the whole hit target, so it is held to the a11y floor.
  row: {
    minHeight: Layout.hitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  text: {
    color: Ink.ink2,
  },
  summary: {
    flexShrink: 1,
  },
  full: {
    paddingBottom: Space.sm,
  },
  clip: {
    overflow: 'hidden',
  },
  measure: {
    position: 'absolute',
    top: 0,
    start: 0,
    end: 0,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
});
