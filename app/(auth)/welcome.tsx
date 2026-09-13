/**
 * V23-02 Hero — the entry screen, and the first thing anyone sees (2026-09-13 redesign, page
 * `V23-02 Hero.dc.html`). No heading, no logo, nothing but the drawn runner
 * (`components/stride-hero.tsx`) on the theme sheet's black until its 3.2 s timeline settles.
 *
 * THE CUE. 0.8 s after the timeline settles (`HERO_CUE_T` = 4 s from mount) "CONTINUE" fades in at
 * the bottom safe area over 300 ms with a one-line chevron beneath it pulsing 1 -> 0.4 -> 1
 * opacity every 1.4 s. Until then it is invisible AND inert — a tap on the black does nothing —
 * so the cue never sits over moving content (spec §0). Tapping it goes to V23-03 Details.
 *
 * REDUCED MOTION. The hero shows its end frame, and the cue is visible at once with a still
 * chevron: the screen is the poster plus a button, nothing waits on an animation.
 *
 * The hero fills the whole screen and centres its 393 x 852 composition on anything larger; the
 * cue is placed against the LIVE bottom inset (never less than the design's 34 pt), so it clears
 * the home indicator on every device rather than only the one the page was drawn for.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Polyline } from 'react-native-svg';

import { StrideHero } from '@/components/stride-hero';
import { Copy } from '@/constants/copy';
import { Ink, Layout, Motion, Type } from '@/constants/v23-theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

/** The cue's box: 64 pt tall, label over chevron, 10 pt between them — the page's values. */
const CUE_HEIGHT = 64;
const CUE_GAP = 10;
/** The chevron: a 14 x 8 one-pixel polyline. */
const CHEVRON = { width: 14, height: 8, points: '1,1 7,7 13,1' } as const;
/** The chevron's pulse: 1 -> 0.4 -> 1 over 1.4 s, ease-in-out each way. */
const PULSE_MS = 1400;
const PULSE_LOW = 0.4;

export default function HeroScreen() {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  // Whether the cue may be tapped. Initialised from `reduceMotion` so the poster never has a
  // frame with an inert cue; otherwise flipped by the hero itself when ITS clock reaches the hold
  // (see `StrideHero`'s `onHold` for why the screen does not run a timer of its own).
  const [cueReady, setCueReady] = useState(reduceMotion);

  const cueOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const chevronOpacity = useSharedValue(1);

  const onHold = useCallback(() => {
    setCueReady(true);
    // The 300 ms arrive is what the page transitions the cue's opacity with.
    cueOpacity.value = withTiming(1, {
      duration: Motion.duration.fade,
      easing: Easing.bezier(...Motion.curve.arrive),
    });
  }, [cueOpacity]);

  useEffect(() => {
    if (reduceMotion) {
      cueOpacity.value = 1;
      chevronOpacity.value = 1;
      return;
    }
    // The pulse runs from the moment the cue exists, as the page's CSS animation does.
    chevronOpacity.value = withRepeat(
      withSequence(
        withTiming(PULSE_LOW, { duration: PULSE_MS / 2, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: PULSE_MS / 2, easing: Easing.inOut(Easing.ease) })
      ),
      -1
    );
    // Shared values are stable handles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const cueStyle = useAnimatedStyle(() => ({ opacity: cueOpacity.value }));
  const chevronStyle = useAnimatedStyle(() => ({ opacity: chevronOpacity.value }));

  return (
    <View style={styles.screen}>
      <StrideHero
        reduceMotion={reduceMotion}
        onHold={onHold}
        style={StyleSheet.absoluteFill}
        testID="entry-hero"
      />
      <Animated.View
        style={[styles.cue, { bottom: Math.max(insets.bottom, Layout.canvas.safeBottom) }, cueStyle]}
        pointerEvents={cueReady ? 'auto' : 'none'}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={Copy.entry.hero.cue}
          accessibilityState={{ disabled: !cueReady }}
          disabled={!cueReady}
          onPress={() => router.push('/details')}
          style={styles.cuePressable}
          testID="entry-hero-cue">
          <Text style={[Type.label, styles.cueLabel]}>{Copy.entry.hero.cue}</Text>
          <Animated.View style={chevronStyle}>
            <Svg width={CHEVRON.width} height={CHEVRON.height} viewBox={`0 0 ${CHEVRON.width} ${CHEVRON.height}`}>
              <Polyline points={CHEVRON.points} fill="none" stroke={Ink.ink} strokeWidth={1} />
            </Svg>
          </Animated.View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Ink.bg,
  },
  cue: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: CUE_HEIGHT,
  },
  cuePressable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: CUE_GAP,
  },
  cueLabel: {
    color: Ink.ink,
  },
});
