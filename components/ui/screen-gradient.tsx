/**
 * The page backdrop — the single most load-bearing piece of the Calm redesign.
 *
 * `Gradient.page` has existed since the palette swap but had no consumer: no screen could paint it,
 * because React Native has no gradient primitive and the token would otherwise have had to arrive
 * as hardcoded hexes inside a component, which CLAUDE.md § Code conventions forbids. This file is
 * that consumer, and `expo-linear-gradient` (a first-party Expo SDK 54 module, added with it) is
 * the only reason it can exist. Every screen in the app now sits on this instead of on a flat
 * `colors.background`.
 *
 * DRIFT: the reference's wash is static, but a still gradient under an otherwise kinetic app reads
 * as a flat backdrop rather than as atmosphere. `drift` (default on) slowly translates and scales
 * the gradient by a few percent, forever, on `Motion.duration.cinematic`. It is ambient, sub-
 * perceptual per frame, and — critically — it is NOT state signaling, so it is exactly the category
 * `useReducedMotion()` exists to suppress: under reduced motion the gradient is rendered dead
 * still, with no animation scheduled at all (not merely paused).
 *
 * WHY THE DRIFT IS A TRANSFORM AND NOT ANIMATED COLOUR STOPS: animating `colors` on a
 * LinearGradient re-renders the native view every frame on the JS thread. A `transform` on an
 * oversized child runs on the UI thread through Reanimated and never touches layout — the same
 * "transform, never width" discipline `components/pace-reveal.tsx` and `components/annotation-
 * lines.tsx` already document. The gradient is drawn 20% larger than the screen so the drift can
 * never expose an unpainted edge.
 *
 * CONTRAST CONTRACT: unchanged from `Gradient`'s own token comment — this surface carries
 * `text.primary` only. Secondary text, score text, score fills and coaching prose belong on an
 * opaque `surface.*` or inside a `<GlassCard>`. Nothing here relaxes that.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Colors, Gradient, Motion } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

/** How far past the viewport the gradient is drawn, so drift never exposes an unpainted edge. */
const OVERDRAW = 1.2;
/** Peak drift travel, as a fraction of the overdraw margin. Deliberately small — this must never
 *  be perceptible as movement, only as the surface not being dead. */
const DRIFT_FRACTION = 0.35;

type ScreenGradientProps = {
  children?: ReactNode;
  /** Ambient drift. Default true; always fully disabled under reduced motion regardless. */
  drift?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function ScreenGradient({ children, drift = true, style, testID }: ScreenGradientProps) {
  const scheme = useColorScheme() ?? 'light';
  const reduceMotion = useReducedMotion();
  const animate = drift && !reduceMotion;

  const t = useSharedValue(0);

  useEffect(() => {
    if (!animate) {
      t.value = 0;
      return;
    }
    t.value = withRepeat(
      withSequence(
        withTiming(1, {
          duration: Motion.duration.cinematic * 4,
          easing: Easing.bezier(...Motion.curve.morph),
        }),
        withTiming(0, {
          duration: Motion.duration.cinematic * 4,
          easing: Easing.bezier(...Motion.curve.morph),
        })
      ),
      -1,
      false
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is a stable shared value
  }, [animate]);

  // Travel is computed in POINTS from the real viewport, not as a percentage string. Percentage
  // transforms are supported on modern React Native, but resolving them inside a worklet on every
  // frame is a needless dependency on that support — a number is unambiguous on every platform,
  // including web. The window is the right measure here because this component is always a
  // full-screen backdrop.
  const { width, height } = useWindowDimensions();
  const travelX = ((OVERDRAW - 1) / 2) * DRIFT_FRACTION * width;
  const travelY = ((OVERDRAW - 1) / 2) * DRIFT_FRACTION * height;

  const driftStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -travelY + t.value * travelY * 2 },
      { translateX: (travelX / 2) * (1 - t.value * 2) },
    ],
  }));

  return (
    <View
      style={[styles.root, { backgroundColor: Colors[scheme].background }, style]}
      testID={testID}>
      <Animated.View
        style={[styles.overdraw, animate && driftStyle]}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <LinearGradient
          testID={testID ? `${testID}-wash` : undefined}
          // Spread to a mutable array: LinearGradient's prop type is not readonly, and the token is
          // `as const`. Copying is also what keeps a consumer from mutating the shared token array.
          colors={[...Gradient.page[scheme]] as [string, string, ...string[]]}
          // Slightly off-vertical. A perfectly vertical wash reads as a CSS default; the reference's
          // own is subtly raked, which is what makes it read as light rather than as a fill.
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // `backgroundColor` is applied inline from the active scheme — belt-and-braces behind the wash,
    // so a single frame before the gradient paints (or a platform that fails to draw it at all)
    // never flashes a white screen on the dark scheme.
    overflow: 'hidden',
  },
  overdraw: {
    position: 'absolute',
    left: `${-((OVERDRAW - 1) / 2) * 100}%`,
    top: `${-((OVERDRAW - 1) / 2) * 100}%`,
    width: `${OVERDRAW * 100}%`,
    height: `${OVERDRAW * 100}%`,
  },
});
