/**
 * The Art. 9 consent gate (issue #68) — shown once, before a user's first upload.
 *
 * The primary CTA is disabled until the checkbox is ticked, and that is the entire point: an
 * affirmative, unbundled opt-in is what separates explicit consent from a "by continuing" notice.
 * The deck's copy names the health processing and Anthropic by name for the same reason. Do not
 * soften either.
 *
 * This is a component, not a route. M2 owns whether it presents as a modal or a screen, and where
 * it intercepts the source-picker → capture handoff.
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Copy } from '@/constants/copy';
import {
  Accent,
  CheckboxSize,
  Colors,
  ControlHeight,
  FontFamily,
  FontSize,
  HitTarget,
  Opacity,
  Radius,
  Spacing,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { grantConsent, UPLOAD_HEALTH_CONSENT } from '@/lib/consent';

type Props = {
  /** Consent is recorded and the caller may proceed into capture/upload. */
  onConsented: () => void;
  /** Dismissed without consenting. Nothing was recorded and nothing may be uploaded. */
  onCancel: () => void;
};

export function ConsentGate({ onConsented, onCancel }: Props) {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canProceed = checked && !pending;

  async function handleConsent() {
    if (!canProceed) return;

    setPending(true);
    setError(null);

    try {
      await grantConsent(UPLOAD_HEALTH_CONSENT);
      onConsented();
    } catch {
      // Fail closed: the gate stays up, nothing is uploaded, and we say so plainly. We do not
      // advance on the assumption the write probably worked — an unprovable consent is no consent.
      setError(Copy.consent.upload.error.record);
      setPending(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{Copy.consent.upload.title}</Text>
      <Text style={styles.body}>{Copy.consent.upload.body}</Text>

      <Pressable
        testID="consent-checkbox"
        onPress={() => setChecked((value) => !value)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={Copy.consent.upload.checkbox}
        style={styles.checkboxRow}
        hitSlop={Spacing.sm}>
        <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
          {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
        </View>
        <Text style={styles.checkboxLabel}>{Copy.consent.upload.checkbox}</Text>
      </Pressable>

      <Text style={styles.privacyLink}>{Copy.consent.upload.link.privacy}</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        testID="consent-cta-primary"
        onPress={handleConsent}
        disabled={!canProceed}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canProceed }}
        style={[styles.primaryCta, !canProceed && styles.primaryCtaDisabled]}>
        {pending ? (
          <ActivityIndicator color={Accent.onAccent} />
        ) : (
          <Text style={styles.primaryCtaLabel}>{Copy.consent.upload.cta.primary}</Text>
        )}
      </Pressable>

      <Pressable
        testID="consent-cta-secondary"
        onPress={onCancel}
        accessibilityRole="button"
        style={styles.secondaryCta}>
        <Text style={styles.secondaryCtaLabel}>{Copy.consent.upload.cta.secondary}</Text>
      </Pressable>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      backgroundColor: colors.surface.base,
      borderRadius: Radius.sheet,
      gap: Spacing.lg,
      padding: Spacing.xl,
    },
    title: {
      color: colors.text.primary,
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.xl,
    },
    body: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
    },
    checkboxRow: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: Spacing.md,
      minHeight: HitTarget.min,
    },
    checkbox: {
      alignItems: 'center',
      borderColor: colors.hairline,
      borderRadius: Radius.card,
      borderWidth: CheckboxSize.border,
      height: CheckboxSize.box,
      justifyContent: 'center',
      width: CheckboxSize.box,
    },
    checkboxChecked: {
      backgroundColor: Accent.value,
      borderColor: Accent.value,
    },
    checkboxMark: {
      color: Accent.onAccent,
      fontFamily: FontFamily.body.bold,
      fontSize: FontSize.xs,
    },
    checkboxLabel: {
      color: colors.text.primary,
      flex: 1,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
    },
    privacyLink: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.xs,
    },
    error: {
      color: colors.text.primary,
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
    },
    primaryCta: {
      alignItems: 'center',
      backgroundColor: Accent.value,
      borderRadius: Radius.card,
      height: ControlHeight.standard,
      justifyContent: 'center',
    },
    primaryCtaDisabled: {
      opacity: Opacity.disabled,
    },
    primaryCtaLabel: {
      color: Accent.onAccent,
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.md,
    },
    secondaryCta: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: HitTarget.min,
    },
    secondaryCtaLabel: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
    },
  });
}
