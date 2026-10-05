/**
 * The signed-out entry flow — V23-02 Hero, the story's intro, then Get started — as ONE SCROLL
 * of screen-height sections. 2026-09-20 made hero and story one paged scroll ending in a "Get
 * started" link; 2026-10-05 (the captain's next device test) took the four pillar sections out
 * of it ("not necessary, wastes the user's time") and replaced the link with the form itself:
 * hero -> intro -> Get started, every step a scroll, the same reveal on each. The pillar
 * introductions are now optional, one tap away from Get started (`app/(auth)/pillars.tsx`).
 *
 * THE HERO is unchanged: no heading, no logo, nothing but the drawn runner
 * (`components/stride-hero.tsx`) on the theme sheet's black until its 3.2 s timeline settles.
 *
 * THE CUE. 0.8 s after the timeline settles (`HERO_CUE_T` = 4 s from mount) "Scroll down" fades
 * in at the bottom safe area over `Motion.duration.storyFade`, with a one-line chevron beneath it
 * pulsing 1 -> 0.4 -> 1 opacity every 1.4 s. Until then it does not exist AND the scroll is
 * locked, so the intro cannot be dragged over the still-drawing runner (spec §0) and the cue
 * never sits over moving content. The cue is a hint, not a control — the scroll is the action.
 *
 * THE SCROLL SNAPS, one section per swipe, to the top of each of the three sections (every
 * section is the viewport tall, measured from the scroll view's own layout, the window's height
 * until then). It is NOT `pagingEnabled`, because the last section is a form that outgrows the
 * viewport the moment its sign-up rows appear, and must ride above the keyboard: past the top of
 * Get started the scroll is free (`snapToEnd={false}`), so the form can be read to its end and
 * a focused field can be lifted clear of the keyboard (`automaticallyAdjustKeyboardInsets`, which
 * insets the content rather than resizing the view — a resize would re-measure every section).
 * A programmatic scroll never snaps, so focusing a field never pages away. WHILE A KEYBOARD IS UP
 * THERE ARE NO SNAP POINTS AT ALL: React Native's iOS snapping clamps every drag to the content's
 * height less the viewport and ignores the keyboard's inset, so with snap points set the bottom
 * of the form — the consent rows and Create account — could never be dragged out from under the
 * keyboard (seen on a 667 pt simulator, 2026-10-05). The scroll is a plain inset-aware scroll
 * until the keyboard goes, then snaps again. Its offset is read
 * on the JS thread and folded through `lib/entry-story.ts` into how many sections have scrolled
 * far enough to arrive; that count only ever grows, and each section reveals its items once.
 *
 * REDUCED MOTION. The hero shows its end frame, the cue is visible at once with a still
 * chevron, the scroll is free from the first frame, and every section renders in place.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Keyboard,
  ScrollView,
  TextInput,
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

import { AuthForm } from '@/components/auth-form';
import { Reveal, StoryIntro } from '@/components/pillar-story';
import { StrideHero } from '@/components/stride-hero';
import { Copy } from '@/constants/copy';
import { Ink, Layout, Motion, Space, Type } from '@/constants/v23-theme';
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
/** The scroll's sections, in order: the hero, the story's intro, Get started. */
const SECTION = { hero: 0, intro: 1, getStarted: 2 } as const;
/** The form's column: the design canvas less its gutters, centred on anything wider — the
 *  story's column, so the intro and the form share one measure. */
const FORM_WIDTH = Layout.canvas.width - 2 * Layout.gutter;
/** Scroll events at frame rate: the reveal count is what needs them, and it only re-renders
 *  when it changes. */
const SCROLL_THROTTLE_MS = 16;

/** Whether any text field has focus. react-native-web's `TextInput.State` has no
 *  `currentlyFocusedInput` (only `currentlyFocusedField`, which native deprecates), so the
 *  native call alone threw on every web resize. */
function fieldFocused(): boolean {
  const state = TextInput.State;
  if (typeof state.currentlyFocusedInput === 'function') return state.currentlyFocusedInput() != null;
  return state.currentlyFocusedField?.() != null;
}

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
  const [revealedCount, setRevealedCount] = useState(SECTION.hero + 1);

  const onHold = useCallback(() => setCueReady(true), []);
  const keyboardShown = useKeyboardShown();

  function measure(event: LayoutChangeEvent) {
    const next = event.nativeEvent.layout.height;
    // A keyboard that resizes the window (Android's adjustResize) shrinks this view while a
    // field has focus; re-measuring then would shrink every section under the user's thumb and
    // move every snap point. The app is portrait-only, so a shrink with a field focused is
    // always the keyboard.
    if (next < sectionHeight && fieldFocused()) return;
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
        snapToOffsets={
          keyboardShown
            ? undefined
            : [SECTION.hero, SECTION.intro, SECTION.getStarted].map((index) => index * sectionHeight)
        }
        snapToEnd={false}
        decelerationRate="fast"
        disableIntervalMomentum
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
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
        <StoryIntro
          sectionHeight={sectionHeight}
          revealed={revealedCount > SECTION.intro}
          reduceMotion={reduceMotion}
        />
        <GetStartedSection
          sectionHeight={sectionHeight}
          revealed={revealedCount > SECTION.getStarted}
          announceErrors={reduceMotion || revealedCount > SECTION.getStarted}
          reduceMotion={reduceMotion}
        />
      </ScrollView>
    </View>
  );
}

/** Whether a keyboard is on screen or on its way: iOS sends the `Will` events first, Android only
 *  the `Did` ones, so both are heard. */
function useKeyboardShown() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const subscriptions = [
      Keyboard.addListener('keyboardWillShow', () => setShown(true)),
      Keyboard.addListener('keyboardDidShow', () => setShown(true)),
      Keyboard.addListener('keyboardWillHide', () => setShown(false)),
      Keyboard.addListener('keyboardDidHide', () => setShown(false)),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);
  return shown;
}

/** Get started: the form (`components/auth-form.tsx`), arriving with the story's rise. At least
 *  a section tall so the snap to its top fills the screen, and free to grow past that once the
 *  sign-up rows appear. Top-aligned, not centred like the story's sections: centring would move
 *  the field the user just focused when the rows below it appear. */
function GetStartedSection({
  sectionHeight,
  revealed,
  announceErrors,
  reduceMotion,
}: {
  sectionHeight: number;
  revealed: boolean;
  announceErrors: boolean;
  reduceMotion: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.getStarted,
        {
          minHeight: sectionHeight,
          paddingTop: Math.max(insets.top, Layout.canvas.safeTop) + Space.xxl,
          paddingBottom: Math.max(insets.bottom, Layout.canvas.safeBottom),
        },
      ]}
      testID="entry-get-started">
      <Reveal order={0} revealed={revealed} reduceMotion={reduceMotion} style={styles.form}>
        <AuthForm announceErrors={announceErrors} testID="entry-get-started-form" />
      </Reveal>
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
  getStarted: {
    paddingHorizontal: Layout.gutter,
  },
  form: {
    width: '100%',
    maxWidth: FORM_WIDTH,
    alignSelf: 'center',
  },
});
