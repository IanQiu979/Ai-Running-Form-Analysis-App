import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
} from '@expo-google-fonts/archivo';
import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
} from '@expo-google-fonts/ibm-plex-mono';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import {
  Newsreader_400Regular,
  Newsreader_400Regular_Italic,
  Newsreader_600SemiBold,
} from '@expo-google-fonts/newsreader';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import 'react-native-reanimated';

import { LaunchIntro } from '@/components/launch-intro';
import { OfflineBanner } from '@/components/offline-banner';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { SessionProvider, useSession } from '@/lib/session-provider';

// Held until both the design-system fonts (brief §2: Archivo/Inter/IBM Plex Mono, plus the
// Newsreader prose role added by spec 2026-07-26 §3.2) and the
// initial auth check (SessionProvider's getSession()) are ready — see RootLayoutNav below —
// so the very first frame the user sees is never a system-font flash or a route flicker
// between the auth and tabs groups.
// Both splash calls can reject (e.g. "already hidden" if the OS got there first). A rejection
// here is not actionable and must not surface as an unhandled rejection, so both are caught —
// the same treatment the rejected session read already gets in lib/session-provider.tsx.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  return (
    <SessionProvider>
      <RootLayoutNav />
    </SessionProvider>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const reduceMotion = useReducedMotion();
  const { session, isLoading: isSessionLoading, isPasswordRecovery } = useSession();
  const [fontsLoaded, fontError] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
    Newsreader_400Regular,
    Newsreader_400Regular_Italic,
    Newsreader_600SemiBold,
  });

  const isReady = (fontsLoaded || !!fontError) && !isSessionLoading;

  // Moment 1 (spec 2026-07-26 §4, Phase 2 plan Task 3): the ground rule alone, on every cold
  // start. `launchDone` starts false and is flipped exactly once per process lifetime — this
  // component tree does not remount across background/foreground, so there is nothing to
  // persist for "warm starts are not cold starts" (see components/launch-intro.tsx's header).
  const [launchDone, setLaunchDone] = useState(false);

  useEffect(() => {
    if (isReady) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [isReady]);

  if (!isReady) {
    // Splash screen is still on top (preventAutoHideAsync above) — nothing renders under it.
    return null;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <View style={styles.stackAndBannerContainer}>
        {/* The only animation that exists in this app today is expo-router's default stack
            push/pop transition (the auth <-> tabs swap below) — gated behind the OS Reduce
            Motion setting (issue #29), per docs/design/motion-consult.md's reduced-motion map:
            "Android: forced animation: 'fade' via useReducedMotion(); iOS: native automatic
            (iOS keys this to 'Prefer Cross-Fade Transitions', a distinct setting)". So the
            override below only ever applies on Android — iOS always gets the native-stack
            default and lets UIKit's own cross-fade preference govern it, rather than this
            screen re-deciding that from a different OS setting (Reduce Motion) than the one iOS
            actually uses for it. No new motion is introduced here either way. */}
        <Stack
          screenOptions={{
            animation: Platform.OS === 'android' && reduceMotion ? 'fade' : 'default',
          }}>
          {/* Stack.Protected omits its screen from the navigator entirely (not just hides it)
              while its guard is false, so a signed-out user's Stack literally has no route
              at (tabs) to navigate to, and vice versa — this is what makes sign-in/sign-out
              redirect automatically the instant `session` changes, with no manual
              router.replace() call anywhere in sign-in.tsx or the sign-out handler. */}
          {/* Issue #81: `!!session` alone is not the right guard. A password-recovery session is
              a real session, so the moment the emailed link's exchange resolves this guard would
              flip, exclude (auth) from the navigator, and eject the user into (tabs) before they
              had set a new password — making the reset screen unreachable at precisely the moment
              it is needed. `isPasswordRecovery` (lib/session-provider.tsx) holds them in (auth)
              until the new password is committed, at which point it clears and this resolves to
              the ordinary signed-in case with no manual navigation. */}
          <Stack.Protected guard={!!session && !isPasswordRecovery}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            {/* The core flow, in the order the user walks it: capture -> analyzing -> result.
                All three are top-level routes rather than tabs (each is full-screen with no tab
                bar), and all three sit inside this session-guarded group. That guard placement is
                load-bearing, not stylistic: expo-router only excludes a route from the Stack when
                it is named inside a Protected block whose guard is false — an *undeclared* route
                file would render as an always-available, unguarded top-level screen regardless of
                session. */}

            {/* Capture flow (design brief screens 3-5, issue #36) — record or pick, then extract. */}
            <Stack.Screen name="capture" options={{ headerShown: false }} />
            {/* Screen 6 — Analyzing (issue #80) — the wait on analyze-form. */}
            <Stack.Screen name="analyzing" options={{ headerShown: false }} />
            {/* result/[id] — the PACE readout (issue #56) — the payload. */}
            <Stack.Screen name="result/[id]" options={{ headerShown: false }} />
            {/* Screen 11 — Settings (issue #53). A pushed top-level route, not a tab, per
                docs/architecture.md's route tree ("paywall, settings"), which nests only
                (tabs)/history. Declaring it INSIDE this guard is load-bearing for exactly the reason
                the comment above says: an undeclared route file would be an always-available,
                unguarded top-level screen — and this one hosts sign-out and account deletion. */}
            <Stack.Screen name="settings" options={{ headerShown: false }} />
            {/* Screen 8 — Paywall (issue #52). Declared here for the same load-bearing reason as
                settings above: an undeclared route file is an always-available, unguarded
                top-level screen. It was reachable via file-based routing the moment #52 landed;
                this is what actually puts it behind the session. */}
            <Stack.Screen name="paywall" options={{ headerShown: false }} />
            {/* Screen 9 — Compare (issue #60). Declared inside this guard for the same
                load-bearing reason as settings/paywall above: an undeclared route file is an
                always-available, unguarded top-level screen, and this one reads the user's own
                stored analyses. */}
            <Stack.Screen name="compare" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={!session || isPasswordRecovery}>
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          </Stack.Protected>
        </Stack>
        {/* Global connectivity notice (issue #93) — mounted once here rather than per-screen so
            it's honest everywhere, not just on the two screens the copy deck names. Renders
            nothing while online; see components/offline-banner.tsx's header for why an overlay,
            not a gate. */}
        <OfflineBanner />
        {/* Moment 1 sits visually above the Stack, which has already mounted underneath — this
            never delays isReady's own fonts/session gate, it only overlays on top of it once
            that gate has already passed. */}
        {!launchDone && <LaunchIntro onDone={() => setLaunchDone(true)} />}
      </View>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  // Default `position: 'relative'` — this is what OfflineBanner's `position: 'absolute'` resolves
  // against, so it overlays whichever screen the Stack is currently showing rather than the
  // ThemeProvider or the window.
  stackAndBannerContainer: {
    flex: 1,
  },
});
