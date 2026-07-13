/**
 * The offline banner (issue #93) — `Copy.offline.banner`, "Persistent light banner while offline"
 * (`docs/design/copy-deck.md` § Cross-cutting — Offline). Mounted once, globally, in
 * `app/_layout.tsx` — the deck names "Source picker / Capture screens" as where it's needed, but
 * a banner that only watches connectivity on two of many screens would just move the "confusing
 * hang" this issue exists to close from those two screens onto every other one; a single global
 * mount is the honest version of "persistent" the deck actually describes. Renders nothing at all
 * while online — never a disabled/empty banner shell, the same discipline
 * `components/partial-result-banner.tsx` uses (only ever mounted when there's something true to
 * say).
 *
 * This is a passive NOTICE, not a gate: its own copy says so ("capture still works"). The gate is
 * `lib/connectivity.ts`'s `checkConnectivity()`, called at the specific network-dependent call
 * sites this issue's report hands off — this component never blocks anything itself, it only
 * tells the user their state. `pointerEvents="none"` below is what makes that literal: the
 * overlay never intercepts a tap meant for the screen underneath it.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Copy } from '@/constants/copy';
import {
  Colors,
  FontFamily,
  FontSize,
  Spacing,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useIsOffline } from '@/lib/connectivity';
import { useAnnounce } from '@/lib/use-announce';

export function OfflineBanner() {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  // expo-router's root wraps the whole app in a SafeAreaProvider (ExpoRoot.js), so this resolves
  // real insets from anywhere under app/ with no provider of its own to set up here.
  const insets = useSafeAreaInsets();
  const isOffline = useIsOffline();
  // Issue #11: `accessibilityLiveRegion="polite"` on the Text below is Android-only — this is the
  // iOS complement, same pattern as app/(auth)/sign-in.tsx. Called before the early return below
  // (React's hook-order rule), so it always runs; `null` while online is a no-op.
  useAnnounce(isOffline ? Copy.offline.banner : null);

  if (!isOffline) {
    return null;
  }

  const styles = createStyles(colors, insets.top);

  return (
    <View style={styles.container} pointerEvents="none">
      <Text
        testID="offline-banner-text"
        style={styles.text}
        accessibilityRole="text"
        accessibilityLiveRegion="polite">
        {Copy.offline.banner}
      </Text>
    </View>
  );
}

function createStyles(colors: ThemeColors, topInset: number) {
  return StyleSheet.create({
    container: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      // Above the Stack's screens, below nothing else — this is the only global overlay in the
      // app today, so there is no competing z-index to reconcile against.
      zIndex: 10,
      backgroundColor: colors.surface.raised,
      borderBottomColor: colors.hairline,
      borderBottomWidth: 1,
      paddingTop: topInset + Spacing.xs,
      paddingBottom: Spacing.xs,
      paddingHorizontal: Spacing.lg,
    },
    text: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.xs,
      textAlign: 'center',
    },
  });
}
