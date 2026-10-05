/**
 * V23-06 · Sign-up / sign-in as a standalone route. Since 2026-10-05 the Get started form itself
 * lives in `components/auth-form.tsx` and is drawn twice: as the last section of the signed-out
 * entry scroll (`app/(auth)/welcome.tsx` — how a new user reaches it, by scrolling) and here.
 * This route is what everything that NAVIGATES to the form still lands on: update-password's
 * "Back to sign in" (by deep link, with `?mode=signIn`), reset-password's way back, and any
 * caller that pushes `/sign-in`. One screen, two modes, as before: sign-up is the default and
 * the footer link flips to sign-in for a returning user.
 *
 * This screen owns only what a host owns — the scroll, keyboard avoidance, the safe areas and
 * the page transition's 12 pt rise. Every gate, field and auth call is the form's.
 */
import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { AuthForm } from '@/components/auth-form';
import { ContentWidth } from '@/constants/theme';
import { Ink, Layout, Motion } from '@/constants/v23-theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  // Sign-up is the default. `?mode=signIn` seeds the other mode for a caller who knows the user
  // already has an account and has no sign-in screen beneath it — update-password's "Back to
  // sign in", reached by deep link — so an expired-recovery-link user does not land on "Create
  // account". Any other value keeps the default.
  const params = useLocalSearchParams<{ mode?: string }>();

  // The page-transition token: 250 ms fade with a 12 pt rise. The native stack supplies the
  // fade (app/_layout.tsx); the rise is this screen's own, and is skipped under Reduce Motion.
  // A shared value rather than an `entering` layout animation: the layout-animation path leaks
  // across RNTL renders in this repo's jest setup (every test after the first mounts an empty
  // tree), and the plain timing path is the one CLAUDE.md's motion-test convention covers.
  const arrival = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) {
      arrival.value = 1;
      return;
    }
    arrival.value = withTiming(1, {
      duration: Motion.duration.page,
      easing: bezier(Motion.curve.arrive),
    });
  }, [arrival, reduceMotion]);
  const arrivalStyle = useAnimatedStyle(() => ({
    opacity: arrival.value,
    transform: [{ translateY: Motion.pageShift * (1 - arrival.value) }],
  }));

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingTop: Math.max(insets.top, Layout.canvas.safeTop),
              paddingBottom: Math.max(insets.bottom, Layout.canvas.safeBottom),
            },
          ]}
          keyboardShouldPersistTaps="handled">
          <Animated.View style={arrivalStyle}>
            <AuthForm initialMode={params.mode === 'signIn' ? 'signIn' : 'signUp'} />
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Reanimated's `Easing.bezier` takes four numbers; the token stores them as one tuple. */
function bezier([x1, y1, x2, y2]: readonly [number, number, number, number]) {
  return Easing.bezier(x1, y1, x2, y2);
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Ink.bg,
  },
  flex: {
    flex: 1,
  },
  // `flex` ONLY on the ScrollView's own style; child layout lives here. The readable column is
  // centred by `alignSelf` so an iPad does not stretch a phone form edge to edge (issue #63).
  scrollContent: {
    flexGrow: 1,
    width: '100%',
    maxWidth: ContentWidth.readable,
    alignSelf: 'center',
    paddingHorizontal: Layout.gutter,
    justifyContent: 'center',
  },
});
