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
  Score,
  Spacing,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { signInWithGoogle } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

type Mode = 'signIn' | 'signUp';
type PendingAction = 'google' | 'email' | null;

function isValidEmail(value: string): boolean {
  return /\S+@\S+\.\S+/.test(value.trim());
}

// Maps raw Supabase auth-js error messages to the copy deck's fixed strings (screen 1) — kept
// local to this screen since it's the only caller today; hoist to lib/ if a second screen
// (e.g. a future password-reset flow) needs the same mapping.
function mapAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials') || m.includes('invalid credentials')) {
    return Copy.auth.error.invalidCredentials;
  }
  if (m.includes('already registered') || m.includes('already exists') || m.includes('user already')) {
    return Copy.auth.error.emailInUse;
  }
  return Copy.auth.error.generic;
}

export default function SignInScreen() {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors, scheme), [colors, scheme]);

  const [mode, setMode] = useState<Mode>('signIn');
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const isBusy = pendingAction !== null;

  function toggleMode() {
    setMode((current) => (current === 'signIn' ? 'signUp' : 'signIn'));
    setErrorMessage(null);
  }

  async function handleGoogleSignIn() {
    setErrorMessage(null);
    setPendingAction('google');
    try {
      // null = the user cancelled/dismissed the browser sheet — not an error, so no message.
      await signInWithGoogle();
    } catch (err) {
      setErrorMessage(mapAuthError(err instanceof Error ? err.message : String(err)));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleEmailSubmit() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password || !isValidEmail(trimmedEmail)) {
      setErrorMessage(Copy.auth.error.generic);
      return;
    }

    setErrorMessage(null);
    setPendingAction('email');
    try {
      if (mode === 'signUp') {
        const { data, error } = await supabase.auth.signUp({ email: trimmedEmail, password });
        if (error) throw error;
        // Supabase returns { error: null, session: null } for an email that's already
        // registered too — it deliberately doesn't error, to avoid leaking which emails
        // exist. The tell is an empty identities array on the returned user (ported from
        // Echo V1's onboarding.tsx handleSignUp, same check).
        if (!data.session && data.user?.identities?.length === 0) {
          setErrorMessage(Copy.auth.error.emailInUse);
          return;
        }
        if (!data.session) {
          // Email confirmations are disabled live for this MVP (see
          // supabase/config.toml's auth.email note) so this shouldn't happen in
          // practice — fail safe with a message rather than stranding the user with
          // no session and no explanation.
          setErrorMessage(Copy.auth.error.generic);
        }
        // On success, onAuthStateChange (lib/session-provider.tsx) flips `session`, and
        // the root layout's Stack.Protected guard routes to (tabs) automatically — no
        // manual navigation here.
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error) throw error;
      }
    } catch (err) {
      setErrorMessage(mapAuthError(err instanceof Error ? err.message : String(err)));
    } finally {
      setPendingAction(null);
    }
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
            <Text style={styles.wordmark}>Pace AnalysisAI</Text>
            <Text style={styles.valueProp}>{Copy.auth.valueProp}</Text>
          </View>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={Copy.auth.cta.google}
              onPress={handleGoogleSignIn}
              disabled={isBusy}
              style={({ pressed }) => [
                styles.secondaryButton,
                (pressed || isBusy) && styles.buttonDimmed,
              ]}>
              {pendingAction === 'google' ? (
                <ActivityIndicator color={colors.text.primary} />
              ) : (
                <Text style={styles.secondaryButtonText}>{Copy.auth.cta.google}</Text>
              )}
            </Pressable>

            {!showEmailForm && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={Copy.auth.cta.email}
                onPress={() => setShowEmailForm(true)}
                disabled={isBusy}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  (pressed || isBusy) && styles.buttonDimmed,
                ]}>
                <Text style={styles.secondaryButtonText}>{Copy.auth.cta.email}</Text>
              </Pressable>
            )}

            {showEmailForm && (
              <View style={styles.emailForm}>
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
                <TextInput
                  style={styles.input}
                  placeholder={Copy.auth.password.placeholder}
                  accessibilityLabel={Copy.auth.password.placeholder}
                  placeholderTextColor={colors.text.secondary}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  textContentType={mode === 'signUp' ? 'newPassword' : 'password'}
                  editable={!isBusy}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    mode === 'signUp' ? Copy.auth.signUp.submit : Copy.auth.signIn.submit
                  }
                  onPress={handleEmailSubmit}
                  disabled={isBusy}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    (pressed || isBusy) && styles.buttonDimmed,
                  ]}>
                  {pendingAction === 'email' ? (
                    <ActivityIndicator color={Accent.onAccent} />
                  ) : (
                    <Text style={styles.primaryButtonText}>
                      {mode === 'signUp' ? Copy.auth.signUp.submit : Copy.auth.signIn.submit}
                    </Text>
                  )}
                </Pressable>
              </View>
            )}

            {errorMessage !== null && (
              <Text style={styles.errorText} accessibilityLiveRegion="polite">
                {errorMessage}
              </Text>
            )}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={toggleMode}
            disabled={isBusy}
            style={styles.toggleLink}>
            <Text style={styles.toggleLinkText}>
              {mode === 'signIn' ? Copy.auth.signUp.link : Copy.auth.signIn.link}
            </Text>
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
    wordmark: {
      fontFamily: FontFamily.display.bold,
      fontSize: FontSize.xxl,
      color: colors.text.primary,
    },
    valueProp: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.md,
      lineHeight: FontSize.md * 1.4,
      color: colors.text.secondary,
      textAlign: 'center',
    },
    actions: {
      gap: Spacing.md,
    },
    secondaryButton: {
      minHeight: ControlHeight.standard,
      borderRadius: Radius.card,
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.surface.raised,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Spacing.lg,
    },
    secondaryButtonText: {
      fontFamily: FontFamily.body.semiBold,
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
    buttonDimmed: {
      opacity: Opacity.pressed,
    },
    emailForm: {
      gap: Spacing.md,
    },
    input: {
      minHeight: ControlHeight.standard,
      borderRadius: Radius.card,
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.surface.base,
      paddingHorizontal: Spacing.lg,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.md,
      color: colors.text.primary,
    },
    // No dedicated "error"/"danger" token exists in constants/theme.ts yet — score.low's text
    // role (clay red-orange, AA-proven in constants/__tests__/theme-contrast.test.ts) is the
    // closest available token-only "negative" hue, so it's reused here rather than
    // hardcoding a new color. Worth design-system adding a real semantic error token later.
    errorText: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      color: Score.low[scheme].text,
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
