/**
 * The reference's top-bar control: a perfect circle, one glyph, nothing else. Every screen in the
 * redesign uses this for back/close/settings instead of an underlined text link, which is what
 * "Settings" and "Cancel" used to be.
 *
 * IT IS GLASS AGAIN (2026-08-02, captain's decision). It shipped opaque in the redesign because the
 * old `Glass` contract banned glass from being a control's fill; the captain overrode that. The
 * override is affordable because a control's fill and its boundary are independent: the frosted
 * `Glass.control` fill still cannot pay WCAG 1.4.11's 3:1 (nothing translucent can, against this
 * page gradient), so the `control.border` ring pays it instead — retuned in the same pass and
 * proven at >=3:1 against both the wash outside the circle and the frost inside it. Same reasoning,
 * same trade-off, as `<PillButton>`'s `secondary`; its header states the cost in full.
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

import { GlassFrost } from '@/components/ui/glass-frost';
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
          { borderColor: colors.control.border },
          disabled && styles.disabled,
          pressed && !disabled && styles.pressed,
        ]}>
        <GlassFrost tone="control" testID={testID ? `${testID}-frost` : undefined} />
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
    // Clips `<GlassFrost>` to the circle. Without it the frost renders as a square behind a round
    // ring, which is the one way this control can look broken rather than merely wrong.
    overflow: 'hidden',
    width: ControlHeight.circle,
  },
  disabled: {
    opacity: Opacity.disabled,
  },
  pressed: {
    opacity: Opacity.pressed,
  },
});
