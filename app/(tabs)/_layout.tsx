/**
 * The signed-in tab navigator: Home and History (issue #55 added the second tab; the template's
 * Explore tab stayed removed rather than left as dead scaffolding). History is a co-equal primary
 * surface with Home, not a rare pushed destination like Settings, so it belongs in the bar.
 *
 * V23 (2026-09-14, lane 2): the bar is now `components/v23-tab-bar.tsx` drawn by this file's own
 * `tabBar` renderer rather than React Navigation's stock `BottomTabBar` restyled through
 * `tabBarStyle`. Two reasons, both on the pages:
 *
 *   1. V23-07 draws the bar FLOATING over Home — absolute, its bottom edge on the bottom safe-area
 *      line, translucent over a backdrop blur — while V23-09 draws it INLINE at the end of
 *      History's scroll ("tab bar sits at the end of the scroll, not floating"). A stock bar is
 *      one or the other for every tab. So the navigator's bar renders on Home only, and History
 *      lays the same component out itself as the last item of its list.
 *   2. Square corners, `line` rule, a 22 pt line glyph over an 11/12 label — none of which the
 *      stock bar's `tabBarIcon`/`tabBarLabelStyle` slots compose the way the page composes them.
 *
 * `start`/`end` (not `left`/`right`) still position the floating bar, for the reason
 * lib/__tests__/tab-bar-style-contract.test.ts spells out — the property now lives in the bar
 * component's own stylesheet, and that test reads it there.
 *
 * Every tab screen pads its own bottom to clear the floating bar (Home) or ends with the inline
 * bar (History); the navigator reserves no layout space for it.
 */
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Tabs } from 'expo-router';
import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { V23TabBar, type V23Tab } from '@/components/v23-tab-bar';
import { Copy } from '@/constants/copy';
import { Layout } from '@/constants/v23-theme';

const ROUTE_TO_TAB: Record<string, V23Tab> = { index: 'home', history: 'history' };

/** The navigator's bar: V23-07's floating strip, mounted on Home only. */
function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const focused = state.routes[state.index];
  const active = ROUTE_TO_TAB[focused.name] ?? 'home';
  // History draws the bar inline itself (see this file's header) — nothing floats over it.
  if (active === 'history') return null;

  function go(routeName: string) {
    const route = state.routes.find((candidate) => candidate.name === routeName);
    if (!route) return;
    // React Navigation's own tab-press contract: emit first so a screen may `preventDefault`,
    // then navigate unless it did (or unless the tab is already focused).
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (route.key !== focused.key && !event.defaultPrevented) {
      navigation.navigate(route.name, route.params);
    }
  }

  return (
    <V23TabBar
      testID="tab-bar"
      active={active}
      mode="floating"
      onPressHome={() => go('index')}
      onPressHistory={() => go('history')}
      style={{ bottom: Math.max(insets.bottom, Layout.canvas.safeBottom) }}
    />
  );
}

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}>
      <Tabs.Screen name="index" options={{ title: Copy.home.title }} />
      <Tabs.Screen name="history" options={{ title: Copy.history.title }} />
    </Tabs>
  );
}
