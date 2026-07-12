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
  Feedback,
  FontFamily,
  FontSize,
  Opacity,
  Radius,
  Spacing,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { PASSWORD_MIN_LENGTH } from '@/constants/validation';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { signInWithGoogle } from '@/lib/auth';
import { checkPasswordBreached } from '@/lib/hibp';
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
  if (m.includes('password should be at least')) {
    return Copy.auth.error.passwordTooShort;
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
        // UX pre-check only, run BEFORE the breach check below — not a business rule the
        // client owns. `PASSWORD_MIN_LENGTH` (constants/validation.ts) mirrors
        // `minimum_password_length` in supabase/config.toml, the ONLY authority on this; if
        // that value ever changes, the constant (and Copy.auth.password.rule /
        // Copy.auth.error.passwordTooShort, both templated off it) must change with it or
        // they'll silently drift. `mapAuthError`'s "password should be at least" branch stays
        // as the server-side backstop regardless of what this pre-check does.
        //
        // Why it has to run first: a password like "1234" is both too short AND breached.
        // Without this check, the breach check below would return first and the user would
        // only ever be told "breached" — never the real, fixable problem — so they'd pick
        // another short password and hit "breached" again, never learning the length rule.
        // It also saves a pointless HIBP round-trip on a password that can never be accepted.
        if (password.length < PASSWORD_MIN_LENGTH) {
          setErrorMessage(Copy.auth.error.passwordTooShort);
          return;
        }

        // Issue #70: Supabase's server-side leaked-password check (HaveIBeenPwned) is
        // Pro-plan-gated (402 on this project's free plan), so it's reimplemented here
        // client-side via HIBP's keyless range API — see lib/hibp.ts for the full mitigation
        // list. Runs on submit only (never onChangeText, which would hammer HIBP into a
        // rate-limit/challenge that degrades to always-`safe`) and strictly before
        // supabase.auth.signUp, so no account is ever created with a breached password.
        // `unavailable` (timeout, network error, third-party outage) fails open — a bypassable
        // client-side check must never block signup on its own unavailability.
        const breachCheck = await checkPasswordBreached(password);
        if (breachCheck.status === 'breached') {
          setErrorMessage(Copy.auth.error.passwordBreached);
          return;
        }

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
            <Text style={styles.wordmark}>{Copy.app.name}</Text>
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
                isBusy && styles.buttonDisabled,
                pressed && styles.buttonPressed,
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
                  // surface.base, not surface.raised — theme.ts documents surface.raised as
                  // "the one raised element per screen," and Google above already claims it as
                  // the recommended path (issue #25). The label stays text.primary and legible;
                  // the button's own boundary relies on the hairline, which is below WCAG
                  // 1.4.11's 3:1 control-boundary floor on this surface — pre-existing across
                  // secondaryButton and input (Google on surface.raised is equally under it),
                  // not introduced here, and tracked separately.
                  styles.emailButtonSurface,
                  isBusy && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
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
                <View style={styles.passwordField}>
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
                  {/* Sign-up only — the rule is irrelevant once an account already exists
                      (issue #9). Discloses it before submit instead of only after a failed
                      attempt. */}
                  {mode === 'signUp' && (
                    <Text style={styles.passwordRuleText}>{Copy.auth.password.rule}</Text>
                  )}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    mode === 'signUp' ? Copy.auth.signUp.submit : Copy.auth.signIn.submit
                  }
                  onPress={handleEmailSubmit}
                  disabled={isBusy}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    isBusy && styles.buttonDisabled,
                    pressed && styles.buttonPressed,
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
            style={({ pressed }) => [styles.toggleLink, pressed && styles.buttonPressed]}>
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
    // Overrides secondaryButton's background only — see the emailButtonSurface call site's
    // comment for why (issue #25).
    emailButtonSurface: {
      backgroundColor: colors.surface.base,
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
    // Pressed and disabled/busy are two different states and must not render at the same
    // opacity — a disabled button was previously indistinguishable from a pressed one here,
    // and Home already used the 0.4 disabled token for the same meaning.
    buttonPressed: {
      opacity: Opacity.pressed,
    },
    buttonDisabled: {
      opacity: Opacity.disabled,
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
    // Tighter than emailForm's Spacing.md between fields — the rule text belongs to the
    // password input directly above it, not a sibling of equal weight.
    passwordField: {
      gap: Spacing.xs,
    },
    passwordRuleText: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.xs,
      color: colors.text.secondary,
    },
    errorText: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      color: Feedback[scheme].error,
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
