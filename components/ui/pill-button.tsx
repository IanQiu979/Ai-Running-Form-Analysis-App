/**
 * Every button in the redesigned app. The Calm reference has exactly one button shape — a fully
 * rounded pill — in three weights, and this file is those three.
 *
 *   `primary`   — the accent fill. One per screen, the same rule `Accent` in constants/theme.ts
 *                 already states ("the primary CTA, and only the primary CTA").
 *   `secondary` — genuinely frosted `Glass.control` over `<GlassFrost>`, with a `control.border`
 *                 ring. CHANGED 2026-08-02 on the captain's decision: this variant shipped OPAQUE
 *                 in the redesign because the old `Glass` contract banned glass from being a
 *                 control's fill. That ban conflated two independent things. The fill genuinely
 *                 cannot carry WCAG 1.4.11's 3:1 non-text floor — an 8-13% wash reads ~1.1:1
 *                 against the page gradient — but it never had to: the RING carries it, and
 *                 `control.border` was retuned in the same pass so it clears 3:1 against both the
 *                 wash outside the pill and the frosted fill inside it (proven in
 *                 `constants/__tests__/theme-contrast.test.ts`). So the pill is translucent AND
 *                 bounded. The cost, stated rather than hidden: the label falls from 15.81:1 on the
 *                 old opaque fill to 4.72:1 worst case — still AA, no longer AAA.
 *   `ghost`     — text only, no fill, no ring. For the tertiary exit ("Cancel", "Not now") that
 *                 must be reachable but must not compete. Still `HitTarget.min` tall.
 *
 * PRESS FEEDBACK is a scale-down, not only an opacity dim. A 56pt pill that merely fades reads as
 * disabled rather than pressed; the reference's own controls depress. Runs on `Motion.duration.
 * quick` — press feedback stays in the short register even though the rest of the redesign moved
 * to a longer one. Under reduced motion the scale is skipped and `Opacity.pressed` alone carries
 * the state, which is the correct fallback: the feedback must survive, only the movement goes.
 *
 * ACCESSIBILITY: `accessibilityRole="button"` and the label are set here so no call site can forget
 * them; `accessibilityState.disabled` is derived from `disabled` rather than passed separately, so
 * the two can never disagree. Minimum height is `ControlHeight.pill` (56) for primary/secondary and
 * `HitTarget.min` (44) for ghost — both at or above the 44pt floor the design brief §7 calls
 * non-negotiable.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { GlassFrost } from '@/components/ui/glass-frost';
import {
  Accent,
  Colors,
  ControlHeight,
  FontFamily,
  FontSize,
  HitTarget,
  Motion,
  Opacity,
  Radius,
  Spacing,
  type ColorScheme,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

const PRESSED_SCALE = 0.96;

export type PillVariant = 'primary' | 'secondary' | 'ghost';

type PillButtonProps = {
  label: string;
  onPress: () => void;
  variant?: PillVariant;
  disabled?: boolean;
  /** Swaps the label for a spinner and sets `accessibilityState.busy`. The pill keeps its exact
   *  height while busy — a control that shrinks to spinner-size mid-submit makes the whole form
   *  jump, which is what the auth screens' hand-rolled version used to do. Callers must still pass
   *  `disabled` if the control should not be re-tappable; `busy` is a display state, not a gate,
   *  and conflating the two would let a caller accidentally leave a submitting button live. */
  busy?: boolean;
  /** Grow to fill the row. Default true for primary/secondary, false for ghost — the reference's
   *  primary pills span their column and its ghost actions hug their text. */
  block?: boolean;
  /** Rendered before the label, inside the pill — the reference pairs a small glyph with "Play". */
  icon?: ReactNode;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function PillButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  block,
  icon,
  accessibilityHint,
  style,
  testID,
}: PillButtonProps) {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);

  const isBlock = block ?? variant !== 'ghost';

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  function setPressed(pressed: boolean) {
    if (reduceMotion) return;
    scale.value = withTiming(pressed ? PRESSED_SCALE : 1, {
      duration: Motion.duration.quick,
      easing: Easing.bezier(...Motion.curve.easeOut),
    });
  }

  // `secondary`'s fill is a real frosted layer, not a colour — see this file's header. Its
  // `backgroundColor` therefore stays transparent and `<GlassFrost>` below paints the material.
  const fill = variant === 'primary' ? Accent.value : 'transparent';
  const labelColor =
    variant === 'primary' ? Accent.onAccent : colors.text.primary;

  return (
    <Animated.View style={[isBlock && styles.block, !reduceMotion && animatedStyle, style]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled, busy }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={({ pressed }) => [
          styles.base,
          variant === 'ghost' ? styles.ghostSize : styles.pillSize,
          { backgroundColor: fill },
          variant === 'secondary' && {
            borderWidth: 1,
            borderColor: colors.control.border,
            // Clips the frost to the pill's own radius. Only `secondary` needs it — the other two
            // variants have no layer to clip, and `overflow: 'hidden'` would pointlessly force a
            // masked layer on them.
            overflow: 'hidden',
          },
          disabled && styles.disabled,
          pressed && !disabled && styles.pressed,
        ]}>
        {variant === 'secondary' ? <GlassFrost tone="control" testID={testID ? `${testID}-frost` : undefined} /> : null}
        {busy ? (
          <ActivityIndicator color={labelColor} />
        ) : (
          <>
            {icon ? <View style={styles.icon}>{icon}</View> : null}
            <Text
              style={[
                styles.label,
                { color: labelColor },
                variant === 'ghost' && styles.ghostLabel,
              ]}
              // Dynamic Type guard (design brief §7: reflow, never clip). A long label at the
              // largest text size wraps to a second line and the pill grows, rather than the label
              // truncating.
              numberOfLines={2}>
              {label}
            </Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  block: {
    alignSelf: 'stretch',
  },
  base: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'center',
  },
  pillSize: {
    minHeight: ControlHeight.pill,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  ghostSize: {
    minHeight: HitTarget.min,
    minWidth: HitTarget.min,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  label: {
    fontFamily: FontFamily.body.semiBold,
    fontSize: FontSize.md,
    textAlign: 'center',
  },
  ghostLabel: {
    fontFamily: FontFamily.body.medium,
    fontSize: FontSize.sm,
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: Opacity.disabled,
  },
  pressed: {
    opacity: Opacity.pressed,
  },
});
