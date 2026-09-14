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
 * `busy` swaps the label for a spinner at the same height so the form does not jump mid-submit
 * (the same contract `components/ui/pill-button.tsx` documents). It is a display state, not a
 * gate — callers still pass `disabled`.
 */
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { Ink, Layout, Type } from '@/constants/v23-theme';

export type SquareButtonVariant = 'primary' | 'secondary' | 'link';

type SquareButtonProps = {
  label: string;
  onPress: () => void;
  variant?: SquareButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  accessibilityHint?: string;
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
  busy = false,
  accessibilityHint,
  style,
  testID,
}: SquareButtonProps) {
  const labelColor = variant === 'primary' ? Ink.onAccent : Ink.ink;

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
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={labelColor} />
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
  disabled: {
    opacity: DISABLED_OPACITY,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
});
