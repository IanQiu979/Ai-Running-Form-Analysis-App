import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Copy } from '@/constants/copy';
import {
  Colors,
  Elevation,
  FontFamily,
  FontSize,
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
        // The fill stays OPAQUE `surface.base` rather than becoming glass: the tab bar carries
        // `text.secondary` on its inactive items, and the `Glass` contract (constants/theme.ts)
        // proves translucency for `text.primary` only. An opaque bar is also the only way the
        // inactive tint keeps the contrast it was tuned for while content scrolls beneath it.
        //
        // Screens are responsible for their own bottom padding under this bar — it no longer
        // occupies layout space, so a screen that ends flush at the bottom would otherwise have
        // its last element sitting beneath it. `TabBar.clearance` (constants/theme.ts) is that
        // space, and every tab screen pads its scroll content by it.
        tabBarStyle: {
          backgroundColor: colors.surface.base,
          borderTopWidth: 0,
          borderRadius: Radius.sheet,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.hairline,
          bottom: TabBar.inset,
          height: TabBar.height,
          left: TabBar.inset,
          paddingBottom: Spacing.sm,
          paddingTop: Spacing.sm,
          position: 'absolute',
          right: TabBar.inset,
          ...Elevation.floating,
        },
        // Issue #12: the tab label otherwise inherits the nav theme's system font — the one
        // always-on-screen text in the app sitting outside its own type system. Now also tracked
        // and uppercased into the eyebrow register, matching the reference's own tab labels.
        tabBarLabelStyle: {
          fontFamily: FontFamily.body.semiBold,
          fontSize: FontSize.xs,
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
