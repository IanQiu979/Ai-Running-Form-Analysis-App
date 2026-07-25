import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
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

import { PASSWORD_MIN_LENGTH } from '@/constants/auth';
import { Copy } from '@/constants/copy';
import {
  Accent,
  Colors,
  ContentWidth,
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
import { signInWithGoogle } from '@/lib/auth';
import { mapAuthError, validateSignInForm } from '@/lib/auth-errors';
import { checkPasswordBreached } from '@/lib/hibp';
import { useSession } from '@/lib/session-provider';
import { supabase } from '@/lib/supabase';
import { useAnnounce } from '@/lib/use-announce';

type Mode = 'signIn' | 'signUp';
type PendingAction = 'google' | 'email' | null;

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
  // Focus-chaining target for the email field's `onSubmitEditing` (issue #28) — the return key
  // advances email -> password instead of dead-ending the keyboard.
  const passwordInputRef = useRef<TextInput>(null);

  // Two failure channels reach this screen from OUTSIDE its own try/catch, and both have
  // nowhere else to surface — hence both are carried on the session context:
  //
  // - Issue #5: `deepLinkAuthError` — the Linking-listener fallback path, an OAuth redirect that
  //   arrived as a deep link instead of resolving inside signInWithGoogle's own awaited call
  //   below (e.g. the browser sheet was dismissed early because the app got backgrounded
  //   mid-flow).
  // - Issue #38: `corruptedSessionError` — `getSession()`'s initial storage read discarded a
  //   stored session it could not decrypt, which can happen before this screen even mounts
  //   (app/_layout.tsx's Stack.Protected only routes here once `isLoading` flips false).
  //
  // Precedence: local `errorMessage` (this attempt, happening now) → `deepLinkAuthError` (this
  // attempt, arriving by another route) → `corruptedSessionError` (a prior session, already
  // gone). Newest-and-most-actionable first, so the banner never flickers between two different
  // messages. Note #5's two channels CAN race on the very same failure — see lib/auth.ts's
  // in-flight-promise dedupe comment — in which case they carry the same mapped string anyway.
  const { deepLinkAuthError, clearDeepLinkAuthError, corruptedSessionError, clearCorruptedSessionError } =
    useSession();
  const displayedError = errorMessage ?? deepLinkAuthError ?? corruptedSessionError;
  // Issue #11: `accessibilityLiveRegion="polite"` on the error Text below is Android-only — a
  // no-op on iOS. This is the iOS-side complement, firing an explicit VoiceOver announcement
  // whenever the displayed error changes. Keep both; they're complementary, not alternatives.
  useAnnounce(displayedError);

  function clearErrors() {
    setErrorMessage(null);
    clearDeepLinkAuthError();
    clearCorruptedSessionError();
  }

  function toggleMode() {
    setMode((current) => (current === 'signIn' ? 'signUp' : 'signIn'));
    // Issue #16: every other consumer of `mode` lives inside the email form, which is hidden by
    // default — without this, tapping "New here? Create an account" changed exactly one string
    // (this link's own text) and nothing else was visible to move. Opening the form makes the
    // tap do something the user can see.
    setShowEmailForm(true);
    clearErrors();
  }

  async function handleGoogleSignIn() {
    clearErrors();
    setPendingAction('google');
    try {
      // null = the user cancelled/dismissed the browser sheet — not an error, so no message.
      await signInWithGoogle();
    } catch (err) {
      setErrorMessage(mapAuthError(err));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleEmailSubmit() {
    // Issue #17: a purely local check, run BEFORE anything is sent — `validateSignInForm`
    // (lib/auth-errors.ts) is the ONLY source of its return value, and it is guaranteed never
    // to return `Copy.auth.error.generic` or any other string that implies a server was
    // contacted. Nothing below this block runs (no clearErrors(), no pendingAction, no
    // supabase.auth.* call) until the form actually passes, so a validation failure can never
    // be mistaken for an attempted-and-rejected sign-in.
    const trimmedEmail = email.trim();
    const validationError = validateSignInForm(trimmedEmail, password);
    if (validationError !== null) {
      setErrorMessage(validationError);
      return;
    }

    clearErrors();
    setPendingAction('email');
    try {
      if (mode === 'signUp') {
        // UX pre-check only, run BEFORE the breach check below — not a business rule the
        // client owns. `minimum_password_length = 8` in supabase/config.toml is the ONLY
        // authority on this; PASSWORD_MIN_LENGTH (constants/auth.ts) — imported here and by
        // Copy.auth.error.passwordTooShort / Copy.auth.password.hint — must change with it or
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

        // Issue #70: Supabase's server-side leaked-password check (HaveIBeenPwned) is now
        // enabled and is the authority (org on Pro, `password_hibp_enabled = true` since
        // 2026-07-12). This client-side pre-check against HIBP's keyless range API — see
        // lib/hibp.ts for the full mitigation list — stays as a fast, inline pre-check plus
        // defense-in-depth; the server rejection is handled by `mapAuthError` (lib/auth-errors.ts)
        // below via the catch block if this pre-check ever misses one. Runs on submit only
        // (never onChangeText, which would hammer HIBP into a rate-limit/challenge that
        // degrades to always-`safe`) and strictly before supabase.auth.signUp, so a breached
        // password is caught before the round-trip whenever this check is available.
        // `unavailable` (timeout, network error, third-party outage) fails open — a bypassable
        // client-side check must never block signup on its own unavailability; the server-side
        // rejection above is what still catches it.
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
      setErrorMessage(mapAuthError(err));
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
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.wordmark} accessibilityRole="header">
              {Copy.auth.wordmark}
            </Text>
            <Text style={styles.valueProp}>{Copy.auth.valueProp}</Text>
          </View>

          <View style={styles.actions}>
            {/* Issue #20: the primary CTA, per Ian's decision — Google is the lowest-friction
                path and the one most likely to succeed, so it's the one control on first paint
                carrying `Accent.value`. "Continue with email" below stays secondary. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={Copy.auth.cta.google}
              accessibilityState={{ busy: pendingAction === 'google' }}
              onPress={handleGoogleSignIn}
              disabled={isBusy}
              style={({ pressed }) => [
                styles.primaryButton,
                isBusy && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}>
              {pendingAction === 'google' ? (
                <ActivityIndicator color={Accent.onAccent} />
              ) : (
                <Text style={styles.primaryButtonText}>{Copy.auth.cta.google}</Text>
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
                  styles.secondaryButtonBase,
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
                  autoComplete="email"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                  editable={!isBusy}
                />
                <TextInput
                  ref={passwordInputRef}
                  style={styles.input}
                  placeholder={Copy.auth.password.placeholder}
                  accessibilityLabel={Copy.auth.password.placeholder}
                  accessibilityHint={mode === 'signUp' ? Copy.auth.password.hint : undefined}
                  accessibilityLabelledBy={mode === 'signUp' ? 'password-hint' : undefined}
                  placeholderTextColor={colors.text.secondary}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  textContentType={mode === 'signUp' ? 'newPassword' : 'password'}
                  autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
                  returnKeyType="go"
                  onSubmitEditing={handleEmailSubmit}
                  editable={!isBusy}
                />
                {/* Proactive rule, sign-up mode only — noise in sign-in mode, where the rule
                    doesn't apply to an existing password (issue #9). `nativeID` + the
                    TextInput's accessibilityLabelledBy above associates this for a screen
                    reader (Android); accessibilityHint carries it cross-platform too. */}
                {mode === 'signUp' && (
                  <Text nativeID="password-hint" style={styles.passwordHint}>
                    {Copy.auth.password.hint}
                  </Text>
                )}
                {/* Issue #81 — sign-in mode only: there is no password to recover during sign-up,
                    and offering it there would just be noise. Before this existed, a locked-out
                    email user had no way back into their account at all. */}
                {mode === 'signIn' && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push('/reset-password')}
                    disabled={isBusy}
                    style={({ pressed }) => [styles.toggleLink, pressed && styles.buttonPressed]}>
                    <Text style={styles.toggleLinkText}>{Copy.auth.reset.cta.forgotPassword}</Text>
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    mode === 'signUp' ? Copy.auth.signUp.submit : Copy.auth.signIn.submit
                  }
                  accessibilityState={{ busy: pendingAction === 'email' }}
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

            {displayedError !== null && (
              <Text style={styles.errorText} accessibilityLiveRegion="polite">
                {displayedError}
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
    // Centers the (width-capped) content within the ScrollView's own viewport — a no-op on any
    // phone, and what keeps a tablet's readable column centered instead of flush-left (issue
    // #63; see ContentWidth's own comment in constants/theme.ts).
    scroll: {
      flex: 1,
      alignItems: 'center',
    },
    scrollContent: {
      flexGrow: 1,
      width: '100%',
      maxWidth: ContentWidth.readable,
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
      borderColor: colors.control.border,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Spacing.lg,
    },
    // Issue #20 moved Google onto `primaryButton` (Accent-filled) below, as the screen's one
    // primary CTA — "Continue with email" is the only consumer of `secondaryButton` left, kept
    // legible as a control by the shared `control.border` above (issue #25) even though its
    // fill (`surface.base`) is otherwise near-invisible against `background`. That border is
    // `control.border`, not `hairline`: it is the only thing marking this as a control, so WCAG
    // 1.4.11 requires >=3:1 (issue #96).
    secondaryButtonBase: {
      backgroundColor: colors.surface.base,
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
      borderColor: colors.control.border,
      backgroundColor: colors.surface.base,
      paddingHorizontal: Spacing.lg,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.md,
      color: colors.text.primary,
    },
    // Small, secondary, quiet — the proactive password rule (issue #9), sign-up mode only.
    passwordHint: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.xs,
      color: colors.text.secondary,
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
