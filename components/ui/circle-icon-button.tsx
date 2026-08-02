/**
 * The reference's top-bar control: a perfect circle, one glyph, nothing else. Every screen in the
 * redesign uses this for back/close/settings instead of an underlined text link, which is what
 * "Settings" and "Cancel" used to be.
 *
 * WHY IT IS NOT GLASS: the reference's version is translucent. This one is an opaque
 * `surface.raised` fill with a `control.border` ring, for the same reason `<PillButton>`'s
 * secondary variant is — see the `Glass` contract in constants/theme.ts. A control's boundary owes
 * WCAG 1.4.11 3:1, and no alpha that still reads as glass can pay it against the page gradient.
 *
 * SIZE: `ControlHeight.circle` (44) is both the drawn diameter and `HitTarget.min`. They coincide
 * deliberately — this is the one control in the system where the visual size is already the
 * accessibility floor, so there is no invisible padding to get wrong.
 *
 * `accessibilityLabel` is REQUIRED, not optional: an icon-only control with no label is invisible
 * to a screen reader, and making it a required prop is the only way that cannot be forgotten.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Colors, ControlHeight, Motion, Opacity, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

const PRESSED_SCALE = 0.9;

type CircleIconButtonProps = {
  /** The glyph. Render it with `colors.text.primary` — that is the tone this fill is proven for. */
  children: ReactNode;
  onPress: () => void;
  /** Required — see this file's header. */
  accessibilityLabel: string;
  accessibilityHint?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function CircleIconButton({
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
  style,
  testID,
}: CircleIconButtonProps) {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  function setPressed(pressed: boolean) {
    if (reduceMotion) return;
    scale.value = withTiming(pressed ? PRESSED_SCALE : 1, {
      duration: Motion.duration.quick,
      easing: Easing.bezier(...Motion.curve.easeOut),
    });
  }

  return (
    <Animated.View style={[!reduceMotion && animatedStyle, style]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={({ pressed }) => [
          styles.circle,
          { backgroundColor: colors.surface.raised, borderColor: colors.control.border },
          disabled && styles.disabled,
          pressed && !disabled && styles.pressed,
        ]}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    height: ControlHeight.circle,
    justifyContent: 'center',
    width: ControlHeight.circle,
  },
  disabled: {
    opacity: Opacity.disabled,
  },
  pressed: {
    opacity: Opacity.pressed,
  },
});
