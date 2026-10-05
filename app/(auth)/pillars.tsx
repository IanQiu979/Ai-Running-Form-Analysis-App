/**
 * The pillar introductions — OPTIONAL since 2026-10-05. The captain's device test found the four
 * pillar screens in the entry scroll "not necessary, wastes the user's time", so they left it
 * (`app/(auth)/welcome.tsx` is now hero -> intro -> Get started) and live here, one understated
 * link away from the Get started form ("About the four pillars", `components/auth-form.tsx`).
 *
 * Same visuals as before: one pillar per screen-height section in a paged scroll, each item
 * rising as its section arrives (`components/pillar-story.tsx`, counted through
 * `lib/entry-story.ts`), the tappable boxes opening in place, one at a time. Two ways back to
 * Get started, both `router.back()` so the form keeps what was typed and ticked: the top bar's
 * Back, always on screen, and a "Get started" link at the end of the last pillar. A deep link
 * here has nothing beneath it, so back falls through to the entry flow instead.
 *
 * Reduced motion renders every section in place.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PillarStory } from '@/components/pillar-story';
import { SquareIconButton } from '@/components/ui/square-icon-button';
import { TopBar } from '@/components/ui/top-bar';
import { BackIcon } from '@/components/ui/v23-icons';
import { Copy } from '@/constants/copy';
import { Ink, Layout } from '@/constants/v23-theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { revealedSectionCount } from '@/lib/entry-story';

/** Scroll events at frame rate, as the entry scroll reads them. */
const SCROLL_THROTTLE_MS = 16;

function backToGetStarted() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/welcome');
  }
}

export default function PillarsScreen() {
  const reduceMotion = useReducedMotion();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [sectionHeight, setSectionHeight] = useState(window.height);
  // The first pillar is on screen at mount; the rest arrive as they are scrolled to.
  const [revealedCount, setRevealedCount] = useState(1);

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
        pagingEnabled
        showsVerticalScrollIndicator={false}
        testID="pillars-scroll">
        <PillarStory
          sectionHeight={sectionHeight}
          revealedCount={revealedCount}
          reduceMotion={reduceMotion}
          onBack={backToGetStarted}
        />
      </ScrollView>
      {/* Over the scroll, under the top safe area: the sections' own top padding is at least
          that inset, and their content is centred, so the bar never covers a pillar. */}
      <View style={[styles.bar, { top: Math.max(insets.top, Layout.canvas.safeTop) }]} pointerEvents="box-none">
        <TopBar
          align="leading"
          leading={
            <SquareIconButton accessibilityLabel={Copy.entry.pillars.back} bleed="left" onPress={backToGetStarted}>
              <BackIcon />
            </SquareIconButton>
          }
          testID="pillars-top-bar"
        />
      </View>
    </View>
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
  bar: {
    position: 'absolute',
    left: Layout.gutter,
    right: Layout.gutter,
  },
});
