/**
 * V23-05's laser sweep — the analyzing screen's one piece of motion (2026-09-13). A 2 pt `ink`
 * line the full width of the screen, glowing, that travels top to bottom over 3.2 s and repeats
 * while the analysis is in flight. The page draws it as:
 *
 *   height: 2px; background: #F5F5F5;
 *   box-shadow: 0 0 10px 1px rgba(245,245,245,.7), 0 0 36px 6px rgba(245,245,245,.22),
 *               0 0 90px 18px rgba(245,245,245,.08);
 *   animation: v23laser 3.2s cubic-bezier(.65,0,.35,1) infinite;
 *   @keyframes v23laser { 0% { translateY(-4px); opacity: 0 } 4% { opacity: 1 }
 *                         96% { opacity: 1 } 100% { translateY(852px); opacity: 0 } }
 *
 * THE GLOW IS GRADIENT BANDS, NOT SHADOWS. iOS can draw a box-shadow-like glow with `shadow*`
 * props, Android cannot (its `elevation` is a directional drop shadow), and a glow that only exists
 * on one platform is not the design. Each of the page's three shadow layers becomes a pair of
 * `expo-linear-gradient` strips above and below the core line — a strip's height is the layer's
 * blur radius plus its spread, its peak alpha the layer's alpha, fading to transparent at the far
 * edge. Stacked, that reads as the same soft halo the CSS composites.
 *
 * THE SWEEP HEIGHT IS MEASURED, not the page's 852. The page's frame is an iPhone 15/16 canvas;
 * the line must leave the bottom of whatever screen it is actually on, so the parent's height
 * arrives via `onLayout` and the travel distance follows it.
 *
 * REDUCED MOTION: deliberately NOT gated. `app/analyzing.tsx`'s header records the standing
 * reading of docs/design/motion-consult.md — wait-state signalling is functional state, not a
 * vestibular trigger, and is exempt from suppression. One slow line moving at a constant, gentle
 * pace is exactly that kind of signal, so it plays under Reduce Motion too.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Ink, Motion } from '@/constants/v23-theme';

/** The page's `v23laser` duration. */
const SWEEP_DURATION_MS = 3200;

/** The page's keyframes: opacity is 0 at 0 %, 1 by 4 %, 1 until 96 %, 0 at 100 %. */
const FADE_IN_END = 0.04;
const FADE_OUT_START = 0.96;

/** `translateY(-4px)` at 0 % — the line starts just above the frame. */
const START_OFFSET = -4;

/** The core line: `height: 2px`. */
const LINE_HEIGHT = 2;

/**
 * The page's three box-shadow layers, `0 0 <blur> <spread> rgba(245,245,245,<alpha>)`, each
 * rendered as a band whose height is blur + spread and whose peak alpha is the layer's alpha.
 */
const GLOW_LAYERS = [
  { blur: 10, spread: 1, alpha: 0.7 },
  { blur: 36, spread: 6, alpha: 0.22 },
  { blur: 90, spread: 18, alpha: 0.08 },
] as const;

/** `#F5F5F5` (`Ink.ink`) as an rgba prefix, so a layer's alpha can be appended. */
const GLOW_RGB = '245, 245, 245';

function glowColor(alpha: number): string {
  return `rgba(${GLOW_RGB}, ${alpha})`;
}

type LaserSweepProps = {
  testID?: string;
};

export function LaserSweep({ testID }: LaserSweepProps) {
  // The parent's height, read from layout; the sweep does not start until it is known.
  const [travel, setTravel] = useState<number | null>(null);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (travel === null) return;
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, {
        duration: SWEEP_DURATION_MS,
        easing: Easing.bezier(...Motion.curve.move),
      }),
      -1,
      false
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- progress is a stable shared value
  }, [travel]);

  const lineStyle = useAnimatedStyle(() => {
    const end = travel ?? 0;
    return {
      opacity: interpolate(
        progress.value,
        [0, FADE_IN_END, FADE_OUT_START, 1],
        [0, 1, 1, 0]
      ),
      transform: [{ translateY: interpolate(progress.value, [0, 1], [START_OFFSET, end]) }],
    };
  });

  function handleLayout(event: LayoutChangeEvent) {
    setTravel(event.nativeEvent.layout.height);
  }

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={handleLayout}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}>
      {travel !== null && (
        <Animated.View style={[styles.line, { height: LINE_HEIGHT }, lineStyle]}>
          {GLOW_LAYERS.map((layer) => {
            const height = layer.blur + layer.spread;
            return (
              <View key={layer.blur} style={StyleSheet.absoluteFill} pointerEvents="none">
                {/* Above the line: transparent at the top edge, peak alpha at the line. */}
                <LinearGradient
                  colors={[glowColor(0), glowColor(layer.alpha)]}
                  style={[styles.band, { height, top: -height }]}
                />
                {/* Below the line: the mirror. */}
                <LinearGradient
                  colors={[glowColor(layer.alpha), glowColor(0)]}
                  style={[styles.band, { height, top: LINE_HEIGHT }]}
                />
              </View>
            );
          })}
          {/* The core line, drawn last so it sits over every band. */}
          <View style={styles.core} testID={testID ? `${testID}-core` : undefined} />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  core: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: Ink.ink,
  },
});
