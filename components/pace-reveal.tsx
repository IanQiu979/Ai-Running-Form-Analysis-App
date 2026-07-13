/**
 * Reveal primitives for the PACE readout's "one earned moment" (design brief §6, issue #61).
 *
 * `components/pace-readout.tsx` mounts these ONLY when it is rendering a genuine first reveal
 * (its `firstReveal` prop, keyed off the `justAnalyzed` nav param — motion-consult.md item 3).
 * Every other render — re-opening a result from history — uses that file's ordinary static
 * `Text`/`View` nodes and never imports anything from here, matching the brief's "re-opening
 * from history renders finished, instantly — no re-animation" rule and V2.2's repeated-motion
 * lesson it cites.
 *
 * Two primitives, both `docs/design/motion-consult.md`'s "Implementation notes" verbatim:
 *
 * 1. `AnimatedPillarBarFill` (item 1) — "Pillar bar fill = scaleX, never width." The fill view's
 *    `width` is set ONCE, statically, to the pillar's final score-proportional width (exactly
 *    what the non-animated bar already renders) — it never changes over time, so nothing here
 *    ever triggers a layout pass. Only `transform: scaleX` animates, 0 -> 1, growing from the
 *    left edge (`transformOrigin: 'left'`) via `withDelay(index * 50, withSpring(...))` — the
 *    brief's "~50ms stagger P->A->C->E, one spring settle", using `Motion.spring.reveal`
 *    (constants/theme.ts: dampingRatio 0.8, reserved for exactly this).
 * 2. `AnimatedOverallNumeral` (item 2) — "useAnimatedProps on a disabled TextInput driven by a
 *    shared value + withTiming — off the JS thread. Never per-frame setState." `text` is a real,
 *    directly-settable native TextInput prop (not part of the public `TextInputProps` TS surface,
 *    hence the narrow cast below) that Reanimated can patch on the UI thread without a React
 *    re-render per frame.
 *
 * Reduced motion never reaches either of these: `components/pace-readout.tsx` uses a single
 * crossfade over the whole readout instead (brief §6 / motion-consult.md's reduced-motion map),
 * so these two components are only ever mounted in the non-reduced-motion, first-reveal case.
 */
import { useEffect } from 'react';
import { StyleSheet, TextInput, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Motion } from '@/constants/theme';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

// motion-consult.md item 1: "~50ms stagger P->A->C->E".
const PILLAR_STAGGER_MS = 50;

type AnimatedPillarBarFillProps = {
  testID?: string;
  /** Position in `PACE_PILLARS` (P=0, A=1, C=2, E=3) — the stagger delay's only input. */
  index: number;
  /** 0-100. The fill's static target width; never re-assigned once mounted. */
  score: number;
  /** Gates the animation start (the "first-visible, not on-mount" trigger, item 4) — false until
   * the readout's container has laid out at least once. Before that, the fill sits at scaleX 0,
   * which is also its correct pre-mount-paint state, so there is nothing to jump when it flips. */
  triggered: boolean;
  /** `pillarRow`'s existing `barFill` + band-color style — untouched, just extended with the
   * static width and the animated transform. */
  style: StyleProp<ViewStyle>;
};

export function AnimatedPillarBarFill({ testID, index, score, triggered, style }: AnimatedPillarBarFillProps) {
  const scaleX = useSharedValue(0);

  useEffect(() => {
    if (!triggered) return;
    scaleX.value = withDelay(index * PILLAR_STAGGER_MS, withSpring(1, Motion.spring.reveal));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scaleX is a stable shared value
  }, [triggered, index]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: scaleX.value }],
  }));

  return (
    <Animated.View
      testID={testID}
      style={[style, styles.fillTransformOrigin, { width: `${score}%` }, animatedStyle]}
    />
  );
}

type AnimatedOverallNumeralProps = {
  testID?: string;
  /** The real, final overall score — the count-up's endpoint, never its live source of truth
   * (the numeral this replaces already gets `overall.score` straight from the server). */
  value: number;
  /** Same trigger as `AnimatedPillarBarFill` — see that prop's doc comment. */
  triggered: boolean;
  style: StyleProp<TextStyle>;
};

/** Native `TextInput` prop Reanimated writes directly on the UI thread — real, but not part of
 * the public `TextInputProps` TS surface (see this file's header). */
type NativeTextProp = { text: string };

export function AnimatedOverallNumeral({ testID, value, triggered, style }: AnimatedOverallNumeralProps) {
  const displayed = useSharedValue(0);

  useEffect(() => {
    if (!triggered) return;
    // Standard duration, ease-out (constants/theme.ts convention: "anything arriving"; the
    // count-up is the numeral's one arrival, first reveal only).
    displayed.value = withTiming(value, {
      duration: Motion.duration.standard,
      easing: Easing.bezier(...Motion.curve.easeOut),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- displayed is a stable shared value
  }, [triggered, value]);

  const animatedProps = useAnimatedProps<NativeTextProp>(() => ({
    text: `${Math.round(displayed.value)}`,
  }));

  return (
    <AnimatedTextInput
      testID={testID}
      style={[style, styles.numeralInputReset]}
      // Purely decorative — never a real input. `defaultValue` is a safety-net paint only: the
      // `animatedProps` `text` patch applies on native mount and immediately supersedes it (with
      // `displayed`'s own start-of-animation value, 0 — the correct first frame, not a wrong one)
      // on every environment where the UI-thread prop write actually reaches the native view.
      defaultValue={`${value}`}
      editable={false}
      focusable={false}
      showSoftInputOnFocus={false}
      underlineColorAndroid="transparent"
      animatedProps={animatedProps as never}
    />
  );
}

const styles = StyleSheet.create({
  fillTransformOrigin: {
    transformOrigin: 'left',
  },
  numeralInputReset: {
    // TextInput carries its own default padding on Android; the Text node it replaces had none.
    padding: 0,
  },
});
