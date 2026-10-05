/**
 * V23-07 / V23-09's tab bar: a 64 pt strip, 16 pt in from each side, ruled 1 px in `line`, with
 * Home and History as two equal cells — a 22 pt line glyph over an 11/12 uppercase label, 6 pt
 * apart, `ink` for the selected tab and `ink2` for the other. Square. Nothing bounces.
 *
 * FLOATING, on both tabs — V23-07 Home's drawing: `position:absolute`, its bottom edge on the
 * bottom safe-area line, filled `rgba(20,20,20,.85)` over a 16 pt backdrop blur so the content
 * scrolling under it stays faintly visible. V23-09 drew an inline, opaque variant at the end of
 * History's scroll; the captain's 2026-10-03 device test put it back where Home has it, so that
 * variant is gone and the navigator (`app/(tabs)/_layout.tsx`) mounts this one bar for both tabs.
 *
 * Presentational: it takes which tab is active and two callbacks; the navigator adapter in
 * `app/(tabs)/_layout.tsx` wires them to React Navigation.
 *
 * The labels are the tabs' own titles from `constants/copy.ts` — the same strings the routes
 * register as their `title`, so a screen reader and the bar agree on the name.
 */
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { HistoryIcon, HomeIcon } from '@/components/ui/v23-icons';
import { Copy } from '@/constants/copy';
import { Chrome, Ink, Layout, Type } from '@/constants/v23-theme';
import { useScreenBlurTarget } from '@/hooks/use-screen-blur-target';

export type V23Tab = 'home' | 'history';

type V23TabBarProps = {
  active: V23Tab;
  onPressHome: () => void;
  onPressHistory: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Glyph over label, 6 pt apart — the pages' `gap:6px`. */
const CELL_GAP = 6;
const PRESSED_OPACITY = 0.6;

export function V23TabBar({ active, onPressHome, onPressHistory, style, testID }: V23TabBarProps) {
  const blurTarget = useScreenBlurTarget();
  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      style={[styles.bar, styles.floating, style]}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <BlurView
          intensity={Chrome.tabBarBlur}
          tint="dark"
          blurTarget={blurTarget}
          blurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
          style={StyleSheet.absoluteFill}
        />
        <View style={[StyleSheet.absoluteFill, styles.floatingFill]} />
      </View>
      <TabCell label={Copy.home.title} selected={active === 'home'} onPress={onPressHome} testID={testID ? `${testID}-home` : undefined}>
        <HomeIcon color={active === 'home' ? Ink.ink : Ink.ink2} />
      </TabCell>
      <TabCell
        label={Copy.history.title}
        selected={active === 'history'}
        onPress={onPressHistory}
        testID={testID ? `${testID}-history` : undefined}>
        <HistoryIcon color={active === 'history' ? Ink.ink : Ink.ink2} />
      </TabCell>
    </View>
  );
}

function TabCell({
  label,
  selected,
  onPress,
  children,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPressIn={() => {
        if (process.env.EXPO_OS === 'ios') {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      }}
      onPress={onPress}
      style={({ pressed }) => [styles.cell, pressed && styles.pressed]}>
      {children}
      <Text style={[Type.tab, { color: selected ? Ink.ink : Ink.ink2 }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: Layout.tabBar.height,
    flexDirection: 'row',
    borderWidth: Layout.hairline,
    borderColor: Ink.line,
    borderRadius: Layout.radius,
    overflow: 'hidden',
  },
  floating: {
    position: 'absolute',
    // `start`/`end`, not `left`/`right` — see components/__tests__/v23-tab-bar.test.tsx.
    start: Layout.tabBar.inset,
    end: Layout.tabBar.inset,
  },
  floatingFill: {
    backgroundColor: Chrome.tabBar,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: CELL_GAP,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
});
