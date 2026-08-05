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
import { DarkTheme, DefaultTheme, ThemeProvider, type Theme } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import 'react-native-reanimated';

import { FirstRunIntro } from '@/components/first-run-intro';
import { LaunchIntro } from '@/components/launch-intro';
import { OfflineBanner } from '@/components/offline-banner';
import { Accent, Colors, Semantic, type ColorScheme } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { hasSeenFirstRun } from '@/lib/first-run';
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

  // True only once `SplashScreen.hideAsync()` has actually resolved — see the effect below. Not
  // the same as `isReady`: `isReady` firing is what TRIGGERS the hide call, but the call and
  // LaunchIntro used to mount in the same commit, racing the native splash's own removal (a
  // real device showed the ground rule drawing while the splash was still visibly fading over
  // it). Gating LaunchIntro on the hide actually settling turns that race into a sequence.
  const [splashHidden, setSplashHidden] = useState(false);

  // Moment 2 (Phase 2 plan Task 4): 'checking' while the AsyncStorage read below is in flight,
  // 'show' if it resolved false, 'done' once shown (or if it resolved true, or never resolved —
  // see the effect below for why "never resolved" also means "done": this must never gate
  // reaching sign-in by waiting on a slow read).
  const [firstRunPhase, setFirstRunPhase] = useState<'checking' | 'show' | 'done'>('checking');

  useEffect(() => {
    let cancelled = false;
    // Kicked off in parallel with moment 1's own <=400ms animation, not after it — by the time
    // launchDone flips, this read (a single AsyncStorage.getItem) has almost always already
    // resolved. If it somehow hasn't, `firstRunPhase` is still 'checking' when launchDone flips;
    // the render logic below treats that the same as 'done' rather than blocking on it.
    hasSeenFirstRun().then((seen) => {
      if (!cancelled) setFirstRunPhase(seen ? 'done' : 'show');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isReady) return;
    let cancelled = false;
    SplashScreen.hideAsync()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSplashHidden(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isReady]);

  if (!isReady) {
    // Splash screen is still on top (preventAutoHideAsync above) — nothing renders under it.
    return null;
  }

  return (
    <ThemeProvider value={navigationTheme(colorScheme === 'dark' ? 'dark' : 'light')}>
      <View style={styles.stackAndBannerContainer}>
        {/* Global connectivity notice (issue #93), moved ahead of `<Stack>` in this column
            (M4, v23-ux-audit-r1): normal flow, not an absolute overlay, so it pushes the Stack
            down instead of drawing over every screen's own top row. Renders nothing while
            online; see components/offline-banner.tsx's header for the layout rationale. */}
        <OfflineBanner />
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
        {/* Moments 1 and 2 sit visually above the Stack (and above the session/auth guard it
            already applies), which has already mounted underneath — neither delays isReady's own
            fonts/session gate or the Stack's own routing, they only overlay on top of it once
            that gate has already passed. Sequenced: moment 1 first, and only once the native
            splash has actually finished hiding (splashHidden), then moment 2 only if it hasn't
            been seen — 'checking' is treated the same as 'done' (skip), never a wait. */}
        {splashHidden && !launchDone && <LaunchIntro onDone={() => setLaunchDone(true)} />}
        {launchDone && firstRunPhase === 'show' && (
          <FirstRunIntro onDone={() => setFirstRunPhase('done')} />
        )}
      </View>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

/**
 * React Navigation's own palette, rebuilt from this app's tokens — the follow-up
 * `app/(tabs)/_layout.tsx`'s issue-#12 comment names ("a full `NavigationTheme` both layouts
 * consume is the eventual answer"), done here because the Calm redesign forced it.
 *
 * Until now the navigator carried stock `DefaultTheme`/`DarkTheme`, which was survivable while
 * every screen painted an opaque `colors.background` edge to edge: the navigator's card colour was
 * never visible. It is not survivable now. Every screen renders a `<ScreenGradient>` over a
 * TRANSPARENT SafeAreaView, and the navigator's card sits directly behind that — so on the light
 * scheme, stock `DefaultTheme`'s `#fff` card flashed white underneath a blue-violet wash on every
 * push transition, and `DarkTheme`'s neutral `rgb(1,1,1)` read as a cold hole on the dark one.
 *
 * Only `background`/`card` genuinely matter today (this app renders no React Navigation headers and
 * no built-in borders), but the whole object is filled from real roles rather than spread over a
 * stock theme, so a future header or badge inherits the design system instead of inheriting
 * whatever React Navigation last shipped. `notification` maps to `Semantic.error` — it is the badge
 * colour, i.e. an alarm role, not a score band.
 */
function navigationTheme(scheme: ColorScheme): Theme {
  const c = Colors[scheme];
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark: scheme === 'dark',
    colors: {
      background: c.background,
      card: c.background,
      text: c.text.primary,
      border: c.hairline,
      primary: Accent.value,
      notification: Semantic.error[scheme],
    },
  };
}

const styles = StyleSheet.create({
  // Column flex: `<OfflineBanner>` (normal flow, M4) then `<Stack>`, so the banner pushes the
  // Stack down while visible instead of overlaying it.
  stackAndBannerContainer: {
    flex: 1,
  },
});
