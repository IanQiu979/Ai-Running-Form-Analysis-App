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
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { SessionProvider, useSession } from '@/lib/session-provider';

// Held until both the design-system fonts (brief §2: Archivo/Inter/IBM Plex Mono) and the
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
  const { session, isLoading: isSessionLoading } = useSession();
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
  });

  const isReady = (fontsLoaded || !!fontError) && !isSessionLoading;

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
      {/* The only animation that exists in this app today is expo-router's default stack
          push/pop transition (the auth <-> tabs swap below) — gated behind the OS Reduce
          Motion setting (issue #29). `animation: 'none'` vs. the native-stack default is the
          full extent of the wiring; no new motion is introduced here. */}
      <Stack screenOptions={{ animation: reduceMotion ? 'none' : 'default' }}>
        {/* Stack.Protected omits its screen from the navigator entirely (not just hides it)
            while its guard is false, so a signed-out user's Stack literally has no route
            at (tabs) to navigate to, and vice versa — this is what makes sign-in/sign-out
            redirect automatically the instant `session` changes, with no manual
            router.replace() call anywhere in sign-in.tsx or the sign-out handler. */}
        <Stack.Protected guard={!!session}>
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
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
