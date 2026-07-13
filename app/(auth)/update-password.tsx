/**
 * Screen 1c — Set a new password, issue #81. Reached only via the deep link
 * `resetPasswordForEmail` sends (lib/password-reset.ts's `passwordResetRedirectTo`,
 * `paceanalysisai://update-password`) — there is no in-app entry point to this screen.
 *
 * ARCHITECTURE CAVEAT — read before assuming this "just works" end to end:
 *
 * Supabase's recovery flow requires an active *session* before `updateUser({ password })` can
 * run (there's no combined "verify recovery code and set password" call) — the official pattern
 * (supabase-js's own GoTrueClient doc comment on `resetPasswordForEmail`) is to listen for the
 * `PASSWORD_RECOVERY` auth event and prompt for a new password once it fires. This screen does
 * exactly that. The session that event confirms is EXCHANGED from the recovery link's PKCE code
 * by lib/session-provider.tsx's existing global `Linking` listener (which already runs
 * `createSessionFromUrl`, lib/auth.ts, against every incoming deep link — no new exchange logic
 * needed here) — but as of this change, `app/_layout.tsx`'s root guard
 * (`Stack.Protected guard={!!session}`) cannot tell a recovery session apart from a normal signed
 * -in one. The instant that exchange resolves, `session` goes non-null, and the guard routes the
 * user into `(tabs)` — which also removes the ENTIRE `(auth)` group, this screen included, from
 * the navigator, per expo-router's Stack.Protected semantics (a `guard=false` screen isn't
 * hidden, it's excluded from the tree). Both `app/_layout.tsx` and `lib/session-provider.tsx` are
 * outside this change's file lane, so the fix (exposing an `isPasswordRecovery` flag from
 * `useSession()` and folding it into both guards) is handed off rather than applied here — see
 * this change's HANDOFF block. Everything in this file is written to work correctly the moment
 * that lands; until then, a user who is slow to submit the form after the link opens may get
 * bounced to `(tabs)` before finishing.
 *
 * Handles the expired/consumed-link case (issue #81 scope item 5) via three independent signals,
 * combined rather than any single one trusted alone:
 *   1. A session already present at mount (covers the exchange having finished before this
 *      screen's own listeners attached).
 *   2. A live `PASSWORD_RECOVERY` event (the documented success signal).
 *   3. `deepLinkAuthError` from useSession() (lib/session-provider.tsx) going non-null before
 *      either of the above — signals the shared exchange machinery threw (expired token, reused
 *      code, network failure). Its exact mapped string is NOT shown here on purpose: mapAuthError
 *      (lib/auth-errors.ts) is tuned for OAuth semantics (e.g. `access_denied` -> "Sign-in was
 *      cancelled"), which would misdescribe an expired recovery link. Only used as a signal;
 *      `Copy.auth.reset.update.error.expiredLink` supplies the honest wording.
 *   4. A bounded wait (no fake progress, no spinner-forever — same rule `analyzing.longWait`
 *      follows): if none of the above resolve within a few seconds, there was likely no recovery
 *      attempt in progress at all (e.g. this screen opened directly, not via the emailed link),
 *      which is honestly the same actionable dead end as an expired link.
 */
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
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
import { mapAuthError } from '@/lib/auth-errors';
import { updateRecoveryPassword } from '@/lib/password-reset';
import { useSession } from '@/lib/session-provider';
import { supabase } from '@/lib/supabase';

// One PKCE exchange round-trip's worth of patience — same order of magnitude as
// lib/hibp.ts's own TOTAL_TIMEOUT_MS for a single network call, not an arbitrary guess.
const RECOVERY_WAIT_TIMEOUT_MS = 4000;

type LinkPhase = 'checking' | 'ready' | 'expired';
type SubmitStatus = 'idle' | 'submitting' | 'success';

export default function UpdatePasswordScreen() {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors, scheme), [colors, scheme]);

  const { session, deepLinkAuthError, clearDeepLinkAuthError, clearPasswordRecovery } =
    useSession();

  const [phase, setPhase] = useState<LinkPhase>(() => (session ? 'ready' : 'checking'));
  const [password, setPassword] = useState('');
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isBusy = submitStatus === 'submitting';

  // Signal 1: a session already existed by the time this screen mounted — the exchange (run by
  // lib/session-provider.tsx's own Linking listener, not duplicated here) already finished.
  useEffect(() => {
    if (session) setPhase('ready');
  }, [session]);

  // Signal 2: the documented success event — fires the moment ANY caller's exchange resolves
  // with this code's recovery flag set, regardless of which listener (this one or
  // session-provider's) actually ran it.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setPhase('ready');
    });
    return () => subscription.unsubscribe();
  }, []);

  // Signal 3: the shared exchange machinery reported a failure. Only acted on before this screen
  // has already confirmed a recovery session — a stale error from some earlier, unrelated deep
  // link must never override an already-successful recovery.
  useEffect(() => {
    if (deepLinkAuthError !== null && phase !== 'ready') {
      setPhase('expired');
      clearDeepLinkAuthError();
    }
  }, [deepLinkAuthError, phase, clearDeepLinkAuthError]);

  // Signal 4: bounded wait, so "no link was ever opened" doesn't spin forever.
  useEffect(() => {
    if (phase !== 'checking') return;
    const timer = setTimeout(() => {
      setPhase((current) => (current === 'checking' ? 'expired' : current));
    }, RECOVERY_WAIT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  async function handleSubmit() {
    if (!password) {
      setErrorMessage(Copy.auth.error.passwordRequired);
      return;
    }

    setErrorMessage(null);
    setSubmitStatus('submitting');
    try {
      const outcome = await updateRecoveryPassword(password);
      if (outcome.status === 'tooShort') {
        setErrorMessage(Copy.auth.error.passwordTooShort);
        setSubmitStatus('idle');
        return;
      }
      if (outcome.status === 'breached') {
        setErrorMessage(Copy.auth.error.passwordBreached);
        setSubmitStatus('idle');
        return;
      }
      setSubmitStatus('success');
    } catch (err) {
      setErrorMessage(mapAuthError(err));
      setSubmitStatus('idle');
    }
  }

  if (phase === 'checking') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.text.secondary} />
          <Text style={styles.body}>{Copy.auth.reset.update.checking}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'expired') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.title}>{Copy.auth.reset.update.error.expiredLink.title}</Text>
          <Text style={styles.body}>{Copy.auth.reset.update.error.expiredLink.body}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/reset-password')}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.buttonPressed,
              styles.centeredButton,
            ]}>
            <Text style={styles.primaryButtonText}>
              {Copy.auth.reset.update.error.expiredLink.cta}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (submitStatus === 'success') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.title}>{Copy.auth.reset.update.success.title}</Text>
          <Text style={styles.body}>{Copy.auth.reset.update.success.body}</Text>
          {/* Releases the recovery hold (issue #81). No router.replace() is needed or wanted:
              the password is already committed, so the session is now an ordinary signed-in one,
              and dropping the flag flips app/_layout.tsx's guard — expo-router then routes into
              (tabs) on its own, exactly as sign-in does. Calling replace('/') here instead would
              be a no-op, because (tabs) is still excluded from the navigator until the flag
              clears. */}
          <Pressable
            accessibilityRole="button"
            onPress={clearPasswordRecovery}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.buttonPressed,
              styles.centeredButton,
            ]}>
            <Text style={styles.primaryButtonText}>{Copy.auth.reset.update.cta.continue}</Text>
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
            <Text style={styles.title}>{Copy.auth.reset.update.title}</Text>
          </View>

          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder={Copy.auth.reset.update.password.placeholder}
              accessibilityLabel={Copy.auth.reset.update.password.placeholder}
              accessibilityHint={Copy.auth.password.hint}
              accessibilityLabelledBy="update-password-hint"
              placeholderTextColor={colors.text.secondary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              textContentType="newPassword"
              editable={!isBusy}
            />
            {/* Same proactive rule as sign-up (issue #9) — this is a candidate password too. */}
            <Text nativeID="update-password-hint" style={styles.passwordHint}>
              {Copy.auth.password.hint}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={Copy.auth.reset.update.cta.submit}
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
                <Text style={styles.primaryButtonText}>{Copy.auth.reset.update.cta.submit}</Text>
              )}
            </Pressable>

            {errorMessage !== null && (
              <Text style={styles.errorText} accessibilityLiveRegion="polite">
                {errorMessage}
              </Text>
            )}
          </View>
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
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
      gap: Spacing.md,
    },
    centeredButton: {
      marginTop: Spacing.md,
      alignSelf: 'stretch',
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
    passwordHint: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.xs,
      color: colors.text.secondary,
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
    errorText: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      color: Semantic.error[scheme],
      textAlign: 'center',
    },
  });
}
