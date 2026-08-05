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
 * tells the user their state.
 *
 * M4 (v23-ux-audit-r1): this used to render as an absolutely-positioned overlay above the Stack,
 * which meant it covered every screen's own top row — on `/capture/extracting` it sat directly
 * over the screen's own "PREPARING YOUR ANALYSIS" title. It is now a normal-flow sibling rendered
 * BEFORE `<Stack>` in `app/_layout.tsx`'s column, so while it's visible it pushes the Stack (and
 * therefore every screen's content) down by its own height instead of drawing over it, and while
 * it's hidden (`isOffline: false`) it contributes nothing to layout, same as before.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Copy } from '@/constants/copy';
import {
  Colors,
  FontFamily,
  FontSize,
  Radius,
  Spacing,
  Tracking,
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
    <View style={styles.container}>
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
      // Normal flow, not an overlay (M4, v23-ux-audit-r1) — rendered before `<Stack>` in
      // `app/_layout.tsx`'s column, so it pushes screen content down instead of drawing over it.
      backgroundColor: colors.surface.raised,
      // Rounded at the BOTTOM only, so the banner reads as a strip that has slid down from the
      // device's own edge rather than as a slab welded across the top. Same relationship the
      // result screen's hero has with the top of its screen.
      borderBottomLeftRadius: Radius.card,
      borderBottomRightRadius: Radius.card,
      borderColor: colors.hairline,
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderTopWidth: 0,
      paddingTop: topInset + Spacing.sm,
      paddingBottom: Spacing.md,
      paddingHorizontal: Spacing.lg,
    },
    text: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.xs,
      letterSpacing: Tracking.eyebrow,
      textAlign: 'center',
      textTransform: 'uppercase',
    },
  });
}
