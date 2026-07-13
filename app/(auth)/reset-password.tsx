/**
 * Screen 1b — Reset password (request), issue #81. Reached from the "Forgot password?" link on
 * app/(auth)/sign-in.tsx (added by that screen's owning agent per this change's HANDOFF — see
 * the PR/commit that shipped this file for the exact snippet). Collects an email and calls
 * `requestPasswordReset` (lib/password-reset.ts), which wraps
 * `supabase.auth.resetPasswordForEmail`.
 *
 * Enumeration safety (issue #81's hard requirement): the "we sent you an email" response must be
 * identical whether or not the address has an account. This screen only ever renders ONE success
 * state (`Copy.auth.reset.request.success`) on `{ status: 'sent' }` — see
 * lib/password-reset.ts's `requestPasswordReset` for why that status is itself guaranteed
 * enumeration-safe (Supabase's own API doesn't distinguish "sent to a real account" from "sent to
 * nothing" at the wire level, so there is nothing for this screen to leak even if it wanted to).
 * `rateLimited`/`error` are genuine operational states, not existence-correlated (see that
 * function's header), so they're allowed to render distinct, honest copy without reopening the
 * gap.
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Copy } from '@/constants/copy';
import {
  Accent,
  Colors,
  ControlHeight,
  FontFamily,
  FontSize,
  Opacity,
  Radius,
  Semantic,
  Spacing,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { requestPasswordReset, validateResetEmail } from '@/lib/password-reset';
import { useAnnounce } from '@/lib/use-announce';

type Status = 'idle' | 'submitting' | 'sent';

export default function ResetPasswordScreen() {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors, scheme), [colors, scheme]);

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isBusy = status === 'submitting';
  // Issue #11: `accessibilityLiveRegion="polite"` below is Android-only — this is the iOS
  // complement, same pattern as app/(auth)/sign-in.tsx. Two independent messages: the "sent"
  // success body (its own render branch, below) and the form's own validation/request error.
  useAnnounce(status === 'sent' ? Copy.auth.reset.request.success.body.replace('{email}', email.trim()) : null);
  useAnnounce(errorMessage);

  async function handleSubmit() {
    const trimmedEmail = email.trim();
    // Purely local check, run BEFORE any network call — same guarantee as
    // lib/auth-errors.ts's validateSignInForm: never implies a request was actually sent.
    const validationError = validateResetEmail(trimmedEmail);
    if (validationError !== null) {
      setErrorMessage(validationError);
      return;
    }

    setErrorMessage(null);
    setStatus('submitting');
    const result = await requestPasswordReset(trimmedEmail);
    if (result.status === 'sent') {
      // The only success branch — see the file header on why this can never be conditioned on
      // whether the account actually exists.
      setStatus('sent');
      return;
    }
    setErrorMessage(
      result.status === 'rateLimited'
        ? Copy.auth.reset.request.error.rateLimited
        : Copy.auth.reset.request.error.generic
    );
    setStatus('idle');
  }

  if (status === 'sent') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.scrollContent}>
          <View style={styles.header}>
            <Text style={styles.title}>{Copy.auth.reset.request.success.title}</Text>
            <Text style={styles.body} accessibilityLiveRegion="polite">
              {Copy.auth.reset.request.success.body.replace('{email}', email.trim())}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.toggleLink, pressed && styles.buttonPressed]}>
            <Text style={styles.toggleLinkText}>{Copy.auth.reset.request.cta.backToSignIn}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.title}>{Copy.auth.reset.request.title}</Text>
            <Text style={styles.body}>{Copy.auth.reset.request.body}</Text>
          </View>

          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder={Copy.auth.email.placeholder}
              accessibilityLabel={Copy.auth.email.placeholder}
              placeholderTextColor={colors.text.secondary}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              editable={!isBusy}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={Copy.auth.reset.request.cta.send}
              onPress={handleSubmit}
              disabled={isBusy}
              style={({ pressed }) => [
                styles.primaryButton,
                isBusy && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}>
              {isBusy ? (
                <ActivityIndicator color={Accent.onAccent} />
              ) : (
                <Text style={styles.primaryButtonText}>{Copy.auth.reset.request.cta.send}</Text>
              )}
            </Pressable>

            {errorMessage !== null && (
              <Text style={styles.errorText} accessibilityLiveRegion="polite">
                {errorMessage}
              </Text>
            )}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            disabled={isBusy}
            style={({ pressed }) => [styles.toggleLink, pressed && styles.buttonPressed]}>
            <Text style={styles.toggleLinkText}>{Copy.auth.reset.request.cta.backToSignIn}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors, scheme: ColorScheme) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    flex: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: Spacing.xl,
      gap: Spacing.xxl,
    },
    header: {
      alignItems: 'center',
      gap: Spacing.md,
    },
    title: {
      fontFamily: FontFamily.display.bold,
      fontSize: FontSize.xl,
      color: colors.text.primary,
      textAlign: 'center',
    },
    body: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.md,
      lineHeight: FontSize.md * 1.4,
      color: colors.text.secondary,
      textAlign: 'center',
    },
    form: {
      gap: Spacing.md,
    },
    input: {
      minHeight: ControlHeight.standard,
      borderRadius: Radius.card,
      borderWidth: 1,
      borderColor: colors.control.border,
      backgroundColor: colors.surface.base,
      paddingHorizontal: Spacing.lg,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.md,
      color: colors.text.primary,
    },
    primaryButton: {
      minHeight: ControlHeight.standard,
      borderRadius: Radius.card,
      backgroundColor: Accent.value,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Spacing.lg,
    },
    primaryButtonText: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.md,
      color: Accent.onAccent,
    },
    buttonPressed: {
      opacity: Opacity.pressed,
    },
    buttonDisabled: {
      opacity: Opacity.disabled,
    },
    // AA-proven against every surface in both themes — see
    // constants/__tests__/theme-contrast.test.ts.
    errorText: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      color: Semantic.error[scheme],
      textAlign: 'center',
    },
    toggleLink: {
      alignItems: 'center',
      paddingVertical: Spacing.lg,
    },
    toggleLinkText: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
      textDecorationLine: 'underline',
    },
  });
}
