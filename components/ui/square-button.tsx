/**
 * V23-01's buttons — the theme sheet's "Components · 345 pt width" column:
 *
 *   primary    56 pt · `accent` fill · `onAccent` label      "Create account", "Sign in"
 *   secondary  56 pt · 1 px `line` border · `ink` label       "Continue with Google"
 *   link       56 pt · no fill, no border · `ink` label       the details page's "Continue"
 *
 * All three carry the Label style (13/16, uppercase, +6 %) and are square-cornered
 * (`Layout.radius`, which is 0). The sheet draws no hover/pressed state and nothing bounces, so a
 * press is a plain opacity dip; disabled dims to the sheet's `ink3` register.
 *
 * `disabledTone` names HOW a disabled primary reads. The default, `'dim'`, is the entry flow's
 * 40 % opacity dip. `'fill'` is V23-10's consent gate, whose disabled "I consent — continue" is
 * drawn as a solid `ink3` block with an `onAccent` label at full opacity
 * (`background:#5C5C5C;color:#0A0A0A`) — the button stays a button, it is just not lit yet.
 * Only a primary has a fill to swap; the other variants ignore the prop and dim as before.
 *
 * `busy` swaps the label for a spinner at the same height so the form does not jump mid-submit
 * (the same contract `components/ui/pill-button.tsx` documents). It is a display state, not a
 * gate — callers still pass `disabled`.
 *
 * `trailing` is V23-07's "Start analysis →": a glyph 8 pt after the label, on the same row. The
 * lane-2 pages are the only ones that draw it; the entry flow's buttons pass nothing and render
 * exactly as before.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Ink, Layout, Space, Type } from '@/constants/v23-theme';

export type SquareButtonVariant = 'primary' | 'secondary' | 'link';

type SquareButtonProps = {
  label: string;
  onPress: () => void;
  variant?: SquareButtonVariant;
  disabled?: boolean;
  /** How a disabled PRIMARY reads: dimmed (default) or a solid `ink3` fill at full opacity. */
  disabledTone?: 'dim' | 'fill';
  busy?: boolean;
  accessibilityHint?: string;
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const PRESSED_OPACITY = 0.6;
const DISABLED_OPACITY = 0.4;

export function SquareButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  disabledTone = 'dim',
  busy = false,
  accessibilityHint,
  trailing,
  style,
  testID,
}: SquareButtonProps) {
  const labelColor = variant === 'primary' ? Ink.onAccent : Ink.ink;
  const disabledFill = disabled && variant === 'primary' && disabledTone === 'fill';

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        disabledFill ? styles.disabledFill : disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={labelColor} />
      ) : trailing ? (
        <View style={styles.labelRow}>
          <Text style={[Type.label, { color: labelColor }, styles.label]} numberOfLines={2}>
            {label}
          </Text>
          {trailing}
        </View>
      ) : (
        <Text style={[Type.label, { color: labelColor }, styles.label]} numberOfLines={2}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: Layout.controlHeight,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Layout.cardPadding,
    borderRadius: Layout.radius,
  },
  primary: {
    backgroundColor: Ink.accent,
  },
  secondary: {
    borderWidth: Layout.hairline,
    borderColor: Ink.line,
  },
  label: {
    textAlign: 'center',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
  },
  disabled: {
    opacity: DISABLED_OPACITY,
  },
  disabledFill: {
    backgroundColor: Ink.ink3,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
});
