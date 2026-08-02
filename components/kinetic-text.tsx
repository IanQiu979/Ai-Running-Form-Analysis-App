/**
 * Per-word reveal — the midlife.engineering move, and the redesign's signature type behaviour.
 *
 * A headline does not fade in as a block; each word rises and resolves on a short stagger, so the
 * sentence assembles itself. Used for every screen title and for the result screen's coaching
 * prose, which is the one place in the app where the words are the product.
 *
 * HOW IT IS BUILT, and why this shape:
 *  - The string is split on whitespace and each word rendered as its own `Animated.Text` inside a
 *    `flexWrap` row. That is the only way to move words independently in React Native, and it means
 *    native line-breaking still applies BETWEEN words (the row wraps) but never WITHIN one. A single
 *    word longer than the column would overflow rather than hyphenate — acceptable, because every
 *    caller passes copy-deck prose, and guarded anyway by the parent's Dynamic Type reflow.
 *  - Movement is `translateY` + `opacity` only: transforms and opacity are the two properties
 *    Reanimated drives on the UI thread without a layout pass, the same discipline
 *    `components/pace-reveal.tsx` and `components/annotation-lines.tsx` already document.
 *  - Trailing spaces are preserved by rendering the separator as part of each word rather than as a
 *    gap, so wrapped lines break exactly where the text would have broken unanimated.
 *
 * ACCESSIBILITY — this is the part that would be easy to get wrong. Split into per-word `Text`
 * nodes, a screen reader would announce a headline one word at a time, which is strictly worse than
 * the plain `Text` this replaces. So the container is a single accessible node carrying the WHOLE
 * string as its label with `accessibilityRole="text"`, and every word node is hidden from the a11y
 * tree. What a screen reader gets is therefore byte-identical to the unanimated version.
 *
 * REDUCED MOTION: no stagger, no rise. The whole block does one opacity crossfade — exactly the
 * fallback `components/pace-readout.tsx` documents for its own reveal ("a single crossfade, no
 * stagger, no count-up"), reused rather than reinvented. `onComplete` still fires, so a caller
 * sequencing off it is never left hanging.
 *
 * `play={false}` renders every word already at rest with no animation scheduled at all — the
 * re-open/static case, same contract as `<AnnotationLines>`.
 */
import { useEffect, useMemo } from 'react';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { Motion } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

/** How far each word rises, in points. Small on purpose — this is a resolve, not a slide-in. */
const RISE = 14;

type KineticTextProps = {
  children: string;
  /** Animate on mount. False renders the finished state with nothing scheduled. */
  play?: boolean;
  /** Delay before the first word starts, for sequencing one block after another. */
  delayMs?: number;
  /** Per-word delay. Defaults to `Motion.stagger.word`; pass `Motion.stagger.line` for a slower,
   *  more deliberate assembly on a hero headline. */
  staggerMs?: number;
  /** Applied to every word. Pass the same style the plain `<Text>` would have had. */
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  /** Fires once, after the last word settles (or immediately under reduced motion). */
  onComplete?: () => void;
  /** Defaults to `children`. Override only when the visible string is not what should be read. */
  accessibilityLabel?: string;
  accessibilityRole?: 'text' | 'header';
  /** Android-only live-region announcement, passed through to the single accessible container.
   *  Needed because several call sites replaced a plain `<Text accessibilityLiveRegion="polite">`
   *  with this component, and dropping the prop would have silently removed the announcement on
   *  Android — iOS is covered separately by those screens' own `useAnnounce` calls. */
  accessibilityLiveRegion?: 'none' | 'polite' | 'assertive';
  testID?: string;
};

export function KineticText({
  children,
  play = true,
  delayMs = 0,
  staggerMs = Motion.stagger.word,
  style,
  containerStyle,
  onComplete,
  accessibilityLabel,
  accessibilityRole = 'text',
  accessibilityLiveRegion,
  testID,
}: KineticTextProps) {
  const reduceMotion = useReducedMotion();
  // Split on runs of whitespace, keeping a single trailing space on every word but the last so
  // wrapping matches what an unsplit `<Text>` would have done.
  const words = useMemo(() => children.split(/\s+/).filter(Boolean), [children]);

  const blockOpacity = useSharedValue(play && reduceMotion ? 0 : 1);

  useEffect(() => {
    if (!play || !reduceMotion) return;
    blockOpacity.value = withTiming(
      1,
      { duration: Motion.duration.standard, easing: Easing.bezier(...Motion.curve.easeOut) },
      (finished) => {
        'worklet';
        if (finished && onComplete) runOnJS(onComplete)();
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- blockOpacity is a stable shared value
  }, [play, reduceMotion]);

  const blockStyle = useAnimatedStyle(() => ({ opacity: blockOpacity.value }));

  return (
    <Animated.View
      testID={testID}
      style={[styles.row, containerStyle, reduceMotion && blockStyle]}
      accessible
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityLiveRegion={accessibilityLiveRegion}>
      {words.map((word, index) => (
        <Word
          // Index is a safe key here: the word list is derived from an immutable prop and is only
          // ever rebuilt wholesale when `children` changes, which remounts the block anyway.
          key={`${word}-${index}`}
          word={index === words.length - 1 ? word : `${word} `}
          style={style}
          play={play && !reduceMotion}
          delay={delayMs + index * staggerMs}
          isLast={index === words.length - 1}
          onComplete={onComplete}
          // Word nodes are hidden from the a11y tree (the container speaks for them), which also
          // makes them unreachable by RNTL's text queries. A derived testID keeps them
          // addressable, so a test can still assert what a word is actually styled with rather
          // than having to trust that the container's layout style is the whole story.
          testID={testID ? `${testID}-word-${index}` : undefined}
        />
      ))}
    </Animated.View>
  );
}

function Word({
  word,
  style,
  play,
  delay,
  isLast,
  onComplete,
  testID,
}: {
  word: string;
  style: StyleProp<TextStyle>;
  play: boolean;
  delay: number;
  isLast: boolean;
  onComplete?: () => void;
  testID?: string;
}) {
  const progress = useSharedValue(play ? 0 : 1);

  useEffect(() => {
    if (!play) return;
    progress.value = withDelay(
      delay,
      withTiming(
        1,
        { duration: Motion.duration.gentle, easing: Easing.bezier(...Motion.curve.calm) },
        (finished) => {
          'worklet';
          if (finished && isLast && onComplete) runOnJS(onComplete)();
        }
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- progress is a stable shared value
  }, [play, delay]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * RISE }],
  }));

  return (
    <Animated.Text
      testID={testID}
      style={[style, animatedStyle]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {word}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
