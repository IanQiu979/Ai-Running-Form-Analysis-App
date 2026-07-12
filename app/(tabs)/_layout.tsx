import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Copy } from '@/constants/copy';
import { Accent } from '@/constants/theme';

// Single Home tab for M1. The template's Explore tab is removed rather than left as dead
// scaffolding; architecture.md's planned route tree adds (tabs)/history back in once M6
// (Past Analyses) builds it — this file gets a second Tabs.Screen then, not before.
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        // Accent is theme-invariant (brief §2: "the primary CTA and *only* the primary CTA" —
        // reused here for the active tab, the closest scaffold equivalent to a highlight color).
        tabBarActiveTintColor: Accent.value,
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
