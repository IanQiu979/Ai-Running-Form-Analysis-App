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
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KineticText } from '@/components/kinetic-text';
import { PillButton } from '@/components/ui/pill-button';
import { ScreenGradient } from '@/components/ui/screen-gradient';
import { SurfaceCard } from '@/components/ui/surface-card';
import { Copy } from '@/constants/copy';
import {
  Colors,
  ContentWidth,
  ControlHeight,
  FontFamily,
  FontSize,
  LineHeight,
  Motion,
  Radius,
  Semantic,
  Spacing,
  Tracking,
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
      <ScreenGradient>
        <SafeAreaView style={styles.safeArea}>
        <View style={styles.scrollContent}>
          <View style={styles.header}>
            <KineticText
              accessibilityRole="header"
              staggerMs={Motion.stagger.line}
              style={styles.title}
              containerStyle={styles.titleRow}>
              {Copy.auth.reset.request.success.title}
            </KineticText>
            <Text style={styles.body} accessibilityLiveRegion="polite">
              {Copy.auth.reset.request.success.body.replace('{email}', email.trim())}
            </Text>
          </View>
          <PillButton
            variant="ghost"
            label={Copy.auth.reset.request.cta.backToSignIn}
            onPress={() => router.replace({ pathname: '/sign-in', params: { mode: 'signIn' } })}
            block
          />
        </View>
        </SafeAreaView>
      </ScreenGradient>
    );
  }

  return (
    <ScreenGradient>
      <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <KineticText
              accessibilityRole="header"
              staggerMs={Motion.stagger.line}
              style={styles.title}
              containerStyle={styles.titleRow}>
              {Copy.auth.reset.request.title}
            </KineticText>
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
              // `autoComplete` alongside `textContentType`, and a submitting return key: the same
              // pair issue #28 established on sign-in. `textContentType` alone is the iOS half —
              // Android's autofill service reads `autoComplete`, so without it a saved email is
              // never offered here. `returnKeyType="go"` + `onSubmitEditing` means the single
              // field on this screen can be submitted from the keyboard rather than forcing a
              // reach back to the button, which is the whole point of a one-field form.
              autoComplete="email"
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
              editable={!isBusy}
            />
            <PillButton
              label={Copy.auth.reset.request.cta.send}
              onPress={handleSubmit}
              disabled={isBusy}
              busy={isBusy}
            />

            {/* On an OPAQUE card: `Semantic.error` is proven against the surfaces, not against the
                page gradient (`Gradient`'s contract, constants/theme.ts). */}
            {errorMessage !== null && (
              <SurfaceCard padding={Spacing.lg}>
                <Text style={styles.errorText} accessibilityLiveRegion="polite">
                  {errorMessage}
                </Text>
              </SurfaceCard>
            )}
          </View>

          <PillButton
            variant="ghost"
            label={Copy.auth.reset.request.cta.backToSignIn}
            onPress={() => router.replace({ pathname: '/sign-in', params: { mode: 'signIn' } })}
            disabled={isBusy}
            block
          />
        </ScrollView>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenGradient>
  );
}

function createStyles(colors: ThemeColors, scheme: ColorScheme) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      // Transparent — `<ScreenGradient>` behind it owns the fill.
      backgroundColor: 'transparent',
    },
    flex: {
      flex: 1,
    },
    // `flex` ONLY. Child-layout props (alignItems/justifyContent/...) are ILLEGAL in a
    // ScrollView's `style` and throw at render: "ScrollView child layout must be applied
    // through the contentContainerStyle prop." The readable column is therefore centred by
    // `alignSelf: 'center'` on the contentContainerStyle below, not from here (issue #63).
    scroll: {
      flex: 1,
    },
    // alignSelf here covers BOTH this style's uses below: the plain `<View>` on the 'sent'
    // success state (centered by SafeAreaView's own default stretch->override) and the
    // `<ScrollView contentContainerStyle>` on the form state (centered via `scroll` above).
    scrollContent: {
      flexGrow: 1,
      width: '100%',
      maxWidth: ContentWidth.readable,
      alignSelf: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
      gap: Spacing.xxl,
    },
    header: {
      alignItems: 'center',
      gap: Spacing.md,
    },
    titleRow: {
      justifyContent: 'center',
    },
    title: {
      fontFamily: FontFamily.display.bold,
      // xl -> xxl, with the negative tracking and tight leading every display-scale heading in the
      // redesign uses.
      fontSize: FontSize.xxl,
      letterSpacing: Tracking.display,
      lineHeight: FontSize.xxl * LineHeight.display,
      color: colors.text.primary,
      textAlign: 'center',
    },
    body: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.md,
      lineHeight: FontSize.md * LineHeight.body,
      // Raised from `text.secondary`: this sits directly on the page gradient, which is proven for
      // `text.primary` only (`Gradient`'s contract, constants/theme.ts).
      color: colors.text.primary,
      textAlign: 'center',
    },
    form: {
      gap: Spacing.md,
    },
    input: {
      minHeight: ControlHeight.standard,
      // `Radius.pill`, matching app/(auth)/sign-in.tsx's field — see that file's comment on why a
      // 52pt field takes the pill rather than the card corner.
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: colors.control.border,
      backgroundColor: colors.surface.base,
      paddingHorizontal: Spacing.xl,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.md,
      color: colors.text.primary,
    },
    // AA-proven against every surface in both themes — see
    // constants/__tests__/theme-contrast.test.ts.
    errorText: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      color: Semantic.error[scheme],
      textAlign: 'center',
    },

  });
}
