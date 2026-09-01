/**
 * The reveal primitive for the PACE readout's "one earned moment" (design brief §6, issue #61).
 *
 * `components/pace-readout.tsx` mounts these ONLY when it is rendering a genuine first reveal
 * (its `firstReveal` prop, keyed off the `justAnalyzed` nav param — motion-consult.md item 3).
 * Every other render — re-opening a result from history — uses that file's ordinary static
 * `Text`/`View` nodes and never imports anything from here, matching the brief's "re-opening
 * from history renders finished, instantly — no re-animation" rule and V2.2's repeated-motion
 * lesson it cites.
 *
 * ONE primitive now, `docs/design/motion-consult.md`'s "Implementation notes" item 2 verbatim:
 * `AnimatedOverallNumeral` — "useAnimatedProps on a disabled TextInput driven by a shared value +
 * withTiming — off the JS thread. Never per-frame setState." `text` is a real, directly-settable
 * native TextInput prop (not part of the public `TextInputProps` TS surface, hence the narrow cast
 * below) that Reanimated can patch on the UI thread without a React re-render per frame.
 *
 * ITEM 1'S `AnimatedPillarBarFill` WAS RETIRED by the 2026-09-01 Cadence Arcs redesign. Its rule
 * — "Pillar bar fill = scaleX, never width", i.e. animate a transform and never a dimension —
 * outlived the primitive: the pillar bars are now arc rings, and `components/ui/arc-ring.tsx`
 * keeps the same discipline in the form a ring allows (the layout box is fixed at mount; only the
 * stroke's dash offset animates, which likewise never triggers a layout pass). Nothing regressed
 * to a width animation; the shape that had a width stopped existing.
 *
 * Reduced motion never reaches this: `components/pace-readout.tsx` uses a single crossfade over
 * the whole readout instead (brief §6 / motion-consult.md's reduced-motion map), so this component
 * is only ever mounted in the non-reduced-motion, first-reveal case.
 */
import { useEffect } from 'react';
import { StyleSheet, TextInput, type StyleProp, type TextStyle } from 'react-native';
import Animated, { Easing, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';

import { Motion } from '@/constants/theme';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

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
  numeralInputReset: {
    // TextInput carries its own default padding on Android; the Text node it replaces had none.
    padding: 0,
  },
});
