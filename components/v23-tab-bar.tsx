/**
 * V23-07 / V23-09's tab bar: a 64 pt strip, 16 pt in from each side, ruled 1 px in `line`, with
 * Home and History as two equal cells — a 22 pt line glyph over an 11/12 uppercase label, 6 pt
 * apart, `ink` for the selected tab and `ink2` for the other. Square. Nothing bounces.
 *
 * TWO MODES, because the two pages draw it two ways:
 *
 *   floating  V23-07 Home — `position:absolute`, its bottom edge on the bottom safe-area line,
 *             filled `rgba(20,20,20,.85)` over a 16 pt backdrop blur so the ticker scrolling
 *             under it stays faintly visible. This is what the navigator mounts.
 *   inline    V23-09 History — "tab bar sits at the end of the scroll, not floating": an opaque
 *             `bgRaised` strip laid out as the LAST item of the history list (or pinned under
 *             the empty state), 24 pt below the rows and 34 pt above the bottom. The navigator
 *             hides its own bar on that tab (`app/(tabs)/_layout.tsx`) so the two never stack.
 *
 * Presentational: it takes which tab is active and two callbacks. The navigator adapter in
 * `app/(tabs)/_layout.tsx` wires the floating one to React Navigation; History wires the inline
 * one to `router.navigate`. One drawing, two hosts.
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
  mode?: 'floating' | 'inline';
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Glyph over label, 6 pt apart — the pages' `gap:6px`. */
const CELL_GAP = 6;
const PRESSED_OPACITY = 0.6;

export function V23TabBar({ active, onPressHome, onPressHistory, mode = 'floating', style, testID }: V23TabBarProps) {
  const blurTarget = useScreenBlurTarget();
  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      style={[styles.bar, mode === 'inline' ? styles.inline : styles.floating, style]}>
      {mode === 'floating' ? (
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
      ) : null}
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
    // `start`/`end`, not `left`/`right` — see lib/__tests__/tab-bar-style-contract.test.ts.
    start: Layout.tabBar.inset,
    end: Layout.tabBar.inset,
  },
  floatingFill: {
    backgroundColor: Chrome.tabBar,
  },
  inline: {
    backgroundColor: Ink.bgRaised,
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
