import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { GlassFrost } from '@/components/ui/glass-frost';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Copy } from '@/constants/copy';
import {
  Colors,
  Elevation,
  FontFamily,
  FontSize,
  LineHeight,
  Radius,
  Spacing,
  TabBar,
  Tracking,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Two tabs as of issue #55 (M6, Past Analyses) — the template's Explore tab stayed removed
// rather than left as dead scaffolding; this is the second Tabs.Screen the header comment above
// used to say would land "then, not before." History is a co-equal primary surface with Home
// (not a rare, pushed destination like Settings — see app/settings.tsx's own routing note), so
// it belongs in the tab bar rather than behind a link.
//
// Issue #12 (tab bar chrome): the icon for History below is rendered directly via
// `@expo/vector-icons/MaterialIcons` rather than through `components/ui/icon-symbol.tsx`'s
// SF-Symbol-name mapping — that mapping file is shared, out of this change's file lane, and
// adding a name to it is a one-line, low-risk change but still someone else's file to own. The
// practical effect is Android/web are visually identical either way (IconSymbol already falls
// back to MaterialIcons there); only iOS's Home tab uses a true SF Symbol while History uses a
// Material glyph directly. Worth folding into IconSymbol's MAPPING in a follow-up that owns that
// file.
export default function TabLayout() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  // Issue #63 (M7 tablet pass): the floating bar's left/right offsets are derived from the LIVE
  // viewport width, not from a flat token, so on an iPad the bar caps at the same
  // `ContentWidth.readable` column every screen's content already caps at instead of stretching
  // the full ~1024pt. Reading the width through the hook (rather than `Dimensions.get` once) is
  // what makes it follow an iPad rotation or a Split View resize. See `TabBar.sideInset`.
  const { width: windowWidth } = useWindowDimensions();
  const barSideInset = TabBar.sideInset(windowWidth);
  // Issue #63: the bar's BOTTOM offset has to clear Android's system navigation bar. React
  // Navigation does not pay that inset for us here — this file's own `tabBarStyle` overrides it,
  // twice over. `TabBar.bottomOffset` carries the evidence and the iOS/Android split.
  const insets = useSafeAreaInsets();
  const barBottom = TabBar.bottomOffset(insets.bottom);

  return (
    <Tabs
      screenOptions={{
        // Not Accent — theme.ts reserves that for the primary CTA only (issue #21). The
        // active/inactive tab tint is a neutral text-role pair instead, same as every other
        // "which text link is more prominent" call this screen family makes elsewhere.
        tabBarActiveTintColor: colors.text.primary,
        tabBarInactiveTintColor: colors.text.secondary,
        headerShown: false,
        tabBarButton: HapticTab,
        // Issue #12: React Navigation's stock tab bar (cool-gray background/border) sat directly
        // beneath this app's warm Gait Plate background/hairline tokens — invisible with one tab,
        // glaring the moment a second tab made the bar itself a real, always-visible piece of
        // chrome. `surface.base` + `hairline` here are the SAME token pair the issue's own fix
        // direction names (`card`/`border` in its sketch of a full React Navigation `Theme`
        // object) — scoped to what this file alone controls. The root `ThemeProvider`'s
        // `DefaultTheme`/`DarkTheme` (`app/_layout.tsx`) still carries React Navigation's stock
        // palette for screen-transition backgrounds and any future header chrome outside
        // `(tabs)`; that file is outside this change's file lane (see this issue's own note that
        // a full `NavigationTheme` "both layouts consume" is the eventual answer) and is a
        // separate follow-up.
        // REDESIGNED (2026-08-02 shape pass): the reference's tab bar does not sit in a slab
        // welded to the bottom edge — it FLOATS, as a rounded, inset bar with content scrolling
        // underneath it. That is the single most recognisable piece of its chrome, so this is
        // `position: 'absolute'` with a margin, `Radius.sheet`, no top border, and
        // `Elevation.floating` to lift it off the wash.
        //
        // TRANSLUCENT AGAIN (2026-08-02, captain's decision). The redesign shipped this bar opaque
        // and said why: it carries `text.secondary` on its inactive items, and `Glass` proved
        // translucency for `text.primary` only. Both halves of that were true, and the second half
        // is why a white-tinted glass bar is still impossible here — a dimmed white inactive tint
        // over the bright end of the page wash tops out near 3.7:1, short of AA for a 13pt label.
        // The fix is not to lower the bar but to change the material: `Glass.chrome` is tinted
        // toward the scheme's own `background` rather than toward white, so it darkens (dark) /
        // lightens (light) the wash toward the surface `text.secondary` was tuned against instead of
        // washing it out. Both text roles are now proven on it, per stop, in
        // `constants/__tests__/theme-contrast.test.ts`. The bar is genuinely see-through — content
        // scrolling under it is visible — and no tint lost its contrast to get there.
        //
        // `backgroundColor: 'transparent'` plus `tabBarBackground` is the required shape: React
        // Navigation paints `tabBarStyle.backgroundColor` OVER the `tabBarBackground` element, so
        // leaving a solid colour there would hide the frost entirely.
        //
        // Screens are responsible for their own bottom padding under this bar — it no longer
        // occupies layout space, so a screen that ends flush at the bottom would otherwise have
        // its last element sitting beneath it. `TabBar.clearance` (constants/theme.ts) is that
        // space, and every tab screen pads its scroll content by it.
        // The frost rounds ITSELF rather than the bar clipping it. `overflow: 'hidden'` on
        // `tabBarStyle` would clip the bar's own `Elevation.floating` shadow too (iOS compiles it
        // to `masksToBounds`, which masks the layer's shadow as well as its children — the same
        // trap `components/ui/surface-card.tsx` documents and splits two nodes to avoid).
        // Issue #63: pin the icon-over-label composition instead of letting React Navigation pick.
        // Its `shouldUseHorizontalLabels` heuristic (`views/BottomTabBar.js`) keys off the WINDOW
        // width, not the bar's: at >=768pt it switches to icon-BESIDE-label if the tabs fit. So on
        // an iPad the bar we just capped to a phone-width column would still have laid its two
        // items out the tablet way — a composition nobody drew, and now an inconsistent one. An
        // explicit value short-circuits the heuristic entirely. Exactly what a phone already
        // resolves to on its own (portrait, <768pt), so this changes nothing there.
        tabBarLabelPosition: 'below-icon',
        tabBarBackground: () => <GlassFrost tone="chrome" radius={Radius.sheet} testID="tab-bar-frost" />,
        tabBarStyle: {
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          borderRadius: Radius.sheet,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.hairline,
          bottom: barBottom,
          height: TabBar.height,
          // `start`/`end`, NOT `left`/`right` — and this is load-bearing, not a style preference.
          // `@react-navigation/bottom-tabs`'s own base style for a bottom bar
          // (`views/BottomTabBar.js`, `styles.bottom`) sets `start: 0, end: 0`, and Yoga resolves
          // the writing-direction properties with HIGHER precedence than physical `left`/`right`.
          // Our `left`/`right` were therefore silently discarded, which is why the bar has been
          // drawing full-bleed to both screen edges rather than as the inset floating bar the
          // redesign specified — on every device, since the redesign. Setting the same logical
          // properties the library used is what actually moves it. Verified on an iPad simulator,
          // and locked by lib/__tests__/tab-bar-style-contract.test.ts.
          start: barSideInset,
          end: barSideInset,
          paddingBottom: Spacing.sm,
          paddingTop: Spacing.sm,
          position: 'absolute',
          ...Elevation.floating,
        },
        // Issue #12: the tab label otherwise inherits the nav theme's system font — the one
        // always-on-screen text in the app sitting outside its own type system. Now also tracked
        // and uppercased into the eyebrow register, matching the reference's own tab labels.
        tabBarLabelStyle: {
          fontFamily: FontFamily.body.semiBold,
          fontSize: FontSize.xs,
          // M6 (v23-ux-audit-r1): with no explicit lineHeight the label's tight default clipped
          // "HOME"/"HISTORY" at the bottom. `FontSize.xs * LineHeight.body` is the same ratio
          // every other body-scale label in the app uses.
          lineHeight: FontSize.xs * LineHeight.body,
          letterSpacing: Tracking.eyebrow,
          textTransform: 'uppercase',
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: Copy.home.title,
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: Copy.history.title,
          tabBarIcon: ({ color }) => <MaterialIcons size={28} name="history" color={color} />,
        }}
      />
    </Tabs>
  );
}
