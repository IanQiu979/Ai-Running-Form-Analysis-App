/**
 * The signed-out entry flow — V23-02 Hero, then the pillars story, then sign-up — as ONE PAGED
 * SCROLL (2026-09-20, the captain's device-test decision). Nothing here is tapped until the
 * final action: the hero is the first screen-height section, scrolling down reveals the story
 * (`components/pillar-story.tsx`, one pillar per section) and the last section ends with the
 * sign-up entry. This replaced the 2026-09-13 flow's two "Continue" taps and its separate
 * `(auth)/details` route.
 *
 * THE HERO is unchanged: no heading, no logo, nothing but the drawn runner
 * (`components/stride-hero.tsx`) on the theme sheet's black until its 3.2 s timeline settles.
 *
 * THE CUE. 0.8 s after the timeline settles (`HERO_CUE_T` = 4 s from mount) "Scroll down" fades
 * in at the bottom safe area over `Motion.duration.storyFade`, with a one-line chevron beneath it
 * pulsing 1 -> 0.4 -> 1 opacity every 1.4 s. Until then it does not exist AND the scroll is
 * locked, so the story cannot be dragged over the still-drawing runner (spec §0) and the cue
 * never sits over moving content. The cue is a hint, not a control — the scroll is the action.
 *
 * THE SCROLL is paged: every section is exactly the viewport tall (measured from the scroll
 * view's own layout, the window's height until then), so a swipe lands on one section at a
 * time. Its offset is read on the JS thread and folded through `lib/entry-story.ts` into how
 * many sections have scrolled far enough to arrive; that count only ever grows, and the story
 * reveals each section's items once from it.
 *
 * REDUCED MOTION. The hero shows its end frame, the cue is visible at once with a still
 * chevron, the scroll is free from the first frame, and the story renders in place.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
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

import { PillarStory } from '@/components/pillar-story';
import { StrideHero } from '@/components/stride-hero';
import { Copy } from '@/constants/copy';
import { Ink, Layout, Motion, Type } from '@/constants/v23-theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { revealedSectionCount } from '@/lib/entry-story';

/** The cue's box: 64 pt tall, label over chevron, 10 pt between them — the page's values. */
const CUE_HEIGHT = 64;
const CUE_GAP = 10;
/** The chevron: a 14 x 8 one-pixel polyline. */
const CHEVRON = { width: 14, height: 8, points: '1,1 7,7 13,1' } as const;
/** The chevron's pulse: 1 -> 0.4 -> 1 over 1.4 s, ease-in-out each way. */
const PULSE_MS = 1400;
const PULSE_LOW = 0.4;
/** The hero is the scroll's one section before the story. */
const HERO_SECTIONS = 1;
/** Scroll events at frame rate: the reveal count is what needs them, and it only re-renders
 *  when it changes. */
const SCROLL_THROTTLE_MS = 16;

export default function HeroScreen() {
  const reduceMotion = useReducedMotion();
  const window = useWindowDimensions();
  // Whether the flow may be scrolled and the cue shown. Initialised from `reduceMotion` so the
  // poster never has a frame without its cue; otherwise flipped by the hero itself when ITS
  // clock reaches the hold (see `StrideHero`'s `onHold` for why the screen runs no timer).
  const [cueReady, setCueReady] = useState(reduceMotion);
  // One section's height: the scroll view's measured height, the window's until it reports.
  const [sectionHeight, setSectionHeight] = useState(window.height);
  // How many sections (the hero first) have scrolled far enough to arrive. Never decreases.
  const [revealedCount, setRevealedCount] = useState(HERO_SECTIONS);

  const onHold = useCallback(() => setCueReady(true), []);

  function measure(event: LayoutChangeEvent) {
    const next = event.nativeEvent.layout.height;
    if (next > 0 && next !== sectionHeight) setSectionHeight(next);
  }

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const reached = revealedSectionCount(event.nativeEvent.contentOffset.y, sectionHeight);
    setRevealedCount((current) => (reached > current ? reached : current));
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        onLayout={measure}
        onScroll={onScroll}
        scrollEventThrottle={SCROLL_THROTTLE_MS}
        scrollEnabled={cueReady}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        testID="entry-scroll">
        <View style={{ height: sectionHeight }} testID="entry-hero-section">
          <StrideHero
            reduceMotion={reduceMotion}
            onHold={onHold}
            style={StyleSheet.absoluteFill}
            testID="entry-hero"
          />
          {cueReady && <ScrollCue reduceMotion={reduceMotion} />}
        </View>
        <PillarStory
          sectionHeight={sectionHeight}
          revealedCount={revealedCount - HERO_SECTIONS}
          reduceMotion={reduceMotion}
          onSignUp={() => router.push('/sign-in')}
        />
      </ScrollView>
    </View>
  );
}

/** "Scroll down" over a pulsing chevron, against the live bottom inset (never less than the
 *  design's 34 pt) so it clears the home indicator on every device. Mounted only once the hero
 *  has held, and fades in from nothing on mount. */
function ScrollCue({ reduceMotion }: { reduceMotion: boolean }) {
  const insets = useSafeAreaInsets();
  const cueOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const chevronOpacity = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      cueOpacity.value = 1;
      chevronOpacity.value = 1;
      return;
    }
    cueOpacity.value = withTiming(1, {
      duration: Motion.duration.storyFade,
      easing: Easing.bezier(...Motion.curve.arrive),
    });
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
    <Animated.View
      style={[styles.cue, { bottom: Math.max(insets.bottom, Layout.canvas.safeBottom) }, cueStyle]}
      accessible
      accessibilityLabel={Copy.entry.hero.cue}
      testID="entry-hero-cue">
      <Text style={[Type.label, styles.cueLabel]}>{Copy.entry.hero.cue}</Text>
      <Animated.View style={chevronStyle}>
        <Svg width={CHEVRON.width} height={CHEVRON.height} viewBox={`0 0 ${CHEVRON.width} ${CHEVRON.height}`}>
          <Polyline points={CHEVRON.points} fill="none" stroke={Ink.ink} strokeWidth={1} />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Ink.bg,
  },
  scroll: {
    flex: 1,
  },
  cue: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: CUE_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: CUE_GAP,
  },
  cueLabel: {
    color: Ink.ink,
  },
});
