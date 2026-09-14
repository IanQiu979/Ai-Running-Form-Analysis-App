/**
 * The lane-2 pages' confirm dialog (V23-09 "Delete confirm", V23-12 "Delete account · confirm"):
 * the screen behind dims to 40 % brightness, and a `bgRaised` card sits centred between the
 * gutters — title in H2, body in `ink2`, then a 56 pt primary and a 44 pt Cancel link 12 pt
 * apart. The primary is `danger`-filled with a white label ONLY for a destructive action
 * ("danger used on the destructive action only", V23-09's own caption); anything else takes the
 * `accent` fill. V23-12's note — "re-auth step-up and consent-withdraw dialogs not drawn; same
 * dialog pattern as the delete confirm" — is why every native `Alert` the lane-2 screens used to
 * raise now comes through here: one shape, drawn once.
 *
 * A one-button notice (a purchase result, a failed sign-out) passes no `secondary`; the primary
 * then reads as the dismiss. `onRequestClose` (Android back) routes to the secondary when there
 * is one and to the primary otherwise, so the hardware button never strands a busy dialog.
 *
 * Motion is the sheet's page transition: a 250 ms fade (RN's own `Modal` fade, which is the only
 * entrance the pages draw for an overlay — nothing slides).
 */
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { SquareButton } from '@/components/ui/square-button';
import { SquareCard } from '@/components/ui/square-card';
import { Chrome, Ink, Layout, Space, Type } from '@/constants/v23-theme';

export type ConfirmDialogAction = {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
};

type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  body: string;
  primary: ConfirmDialogAction;
  /** The Cancel link. Omit for a one-button notice. */
  secondary?: ConfirmDialogAction;
  /** `danger` fills the primary red — destructive actions only. */
  tone?: 'primary' | 'danger';
  testID?: string;
};

const PRESSED_OPACITY = 0.6;
const DISABLED_OPACITY = 0.4;

export function ConfirmDialog({ visible, title, body, primary, secondary, tone = 'primary', testID }: ConfirmDialogProps) {
  const requestClose = secondary ?? primary;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!requestClose.disabled && !requestClose.busy) requestClose.onPress();
      }}
      testID={testID}>
      <View style={styles.scrim} accessibilityViewIsModal>
        <SquareCard padding={Layout.cardPaddingLg} style={styles.card} testID={testID ? `${testID}-card` : undefined}>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <Text style={styles.body}>{body}</Text>
          <View style={styles.actions}>
            {tone === 'danger' ? (
              <Pressable
                testID={testID ? `${testID}-primary` : undefined}
                accessibilityRole="button"
                accessibilityLabel={primary.label}
                accessibilityState={{ disabled: !!primary.disabled, busy: !!primary.busy }}
                disabled={primary.disabled || primary.busy}
                onPress={primary.onPress}
                style={({ pressed }) => [
                  styles.danger,
                  (primary.disabled || primary.busy) && styles.disabled,
                  pressed && !primary.disabled && !primary.busy && styles.pressed,
                ]}>
                <Text style={styles.dangerLabel}>{primary.label}</Text>
              </Pressable>
            ) : (
              <SquareButton
                testID={testID ? `${testID}-primary` : undefined}
                label={primary.label}
                onPress={primary.onPress}
                disabled={primary.disabled}
                busy={primary.busy}
              />
            )}
            {secondary ? (
              <SquareButton
                testID={testID ? `${testID}-secondary` : undefined}
                variant="link"
                label={secondary.label}
                onPress={secondary.onPress}
                disabled={secondary.disabled}
                style={styles.cancel}
              />
            ) : null}
          </View>
        </SquareCard>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: Chrome.scrim,
    justifyContent: 'center',
    paddingHorizontal: Layout.gutter,
  },
  card: {
    gap: Space.lg,
  },
  title: {
    ...Type.h2,
    color: Ink.ink,
  },
  body: {
    ...Type.body,
    color: Ink.ink2,
  },
  actions: {
    marginTop: Space.sm,
    gap: Space.md,
  },
  danger: {
    minHeight: Layout.controlHeight,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Layout.cardPadding,
    backgroundColor: Ink.danger,
    borderRadius: Layout.radius,
  },
  dangerLabel: {
    ...Type.label,
    color: Ink.accent,
    textAlign: 'center',
  },
  cancel: {
    minHeight: Layout.hitTarget,
  },
  disabled: {
    opacity: DISABLED_OPACITY,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
});
