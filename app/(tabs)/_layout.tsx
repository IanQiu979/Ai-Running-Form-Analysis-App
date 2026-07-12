import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Copy } from '@/constants/copy';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Single Home tab for M1. The template's Explore tab is removed rather than left as dead
// scaffolding; architecture.md's planned route tree adds (tabs)/history back in once M6
// (Past Analyses) builds it — this file gets a second Tabs.Screen then, not before.
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
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: Copy.home.title,
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
