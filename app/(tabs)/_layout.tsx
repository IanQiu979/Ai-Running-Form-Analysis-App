import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Copy } from '@/constants/copy';
import { Colors, FontFamily } from '@/constants/theme';
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
        tabBarStyle: {
          backgroundColor: colors.surface.base,
          borderTopColor: colors.hairline,
        },
        // Issue #12: the tab label otherwise inherits the nav theme's system font — the one
        // always-on-screen text in the app sitting outside its own type system.
        tabBarLabelStyle: {
          fontFamily: FontFamily.body.medium,
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
