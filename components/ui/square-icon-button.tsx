/**
 * The lane-2 pages' icon control: a 44 pt square hit target with a glyph centred in it and NO
 * drawn boundary — the pages' top-bar Settings / Back controls and the result rows' info button
 * are all `width:44px;height:44px;display:flex;align-items:center;justify-content:center` and
 * nothing else. A press is a plain opacity dip, same as `<SquareButton>`.
 *
 * `bleed` hangs the box 12 pt past the gutter on the named side (the pages' `margin-right:-12px`
 * / `margin-left:-12px`) so the GLYPH lands on the column edge while the target stays 44 pt.
 */
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';

import { Layout } from '@/constants/v23-theme';

type SquareIconButtonProps = {
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
  children: ReactNode;
  bleed?: 'left' | 'right';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const PRESSED_OPACITY = 0.6;

export function SquareIconButton({
  accessibilityLabel,
  accessibilityHint,
  onPress,
  children,
  bleed,
  disabled = false,
  style,
  testID,
}: SquareIconButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        bleed === 'left' && styles.bleedLeft,
        bleed === 'right' && styles.bleedRight,
        pressed && !disabled && styles.pressed,
        style,
      ]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: Layout.hitTarget,
    height: Layout.hitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bleedLeft: {
    marginLeft: -Layout.iconBleed,
  },
  bleedRight: {
    marginRight: -Layout.iconBleed,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
});
