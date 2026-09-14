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
import { LowPolyField } from '@/components/low-poly-field';
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
import { mapAuthError } from '@/lib/auth-errors';
import { updateRecoveryPassword } from '@/lib/password-reset';
import { useSession } from '@/lib/session-provider';
import { supabase } from '@/lib/supabase';
import { useAnnounce } from '@/lib/use-announce';

// One PKCE exchange round-trip's worth of patience — same order of magnitude as
// lib/hibp.ts's own TOTAL_TIMEOUT_MS for a single network call, not an arbitrary guess.
const RECOVERY_WAIT_TIMEOUT_MS = 4000;

/** The waiting field's drawn size — same value every other wait state in the app uses
 * (`app/capture/extracting.tsx`'s own `WAIT_MARK_SIZE`), L4 (v23-ux-audit-r1). */
const WAIT_MARK_SIZE = 200;

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
  // Issue #11: `accessibilityLiveRegion="polite"` on the error Text below is Android-only — this
  // is the iOS complement, same pattern as app/(auth)/sign-in.tsx.
  useAnnounce(errorMessage);

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
      <ScreenGradient>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.centered}>
            {/* L4 (v23-ux-audit-r1): every other wait in the app shows this mark
                (`app/analyzing.tsx`, `app/capture/extracting.tsx`) — this one was text-only. */}
            <LowPolyField color={colors.text.primary} size={WAIT_MARK_SIZE} testID="update-password-checking-mark" />
            <Text style={styles.body}>{Copy.auth.reset.update.checking}</Text>
          </View>
        </SafeAreaView>
      </ScreenGradient>
    );
  }

  if (phase === 'expired') {
    return (
      <ScreenGradient>
        <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <KineticText
            accessibilityRole="header"
            staggerMs={Motion.stagger.line}
            style={styles.title}
            containerStyle={styles.titleRow}>
            {Copy.auth.reset.update.error.expiredLink.title}
          </KineticText>
          <Text style={styles.body}>{Copy.auth.reset.update.error.expiredLink.body}</Text>
          <PillButton
            label={Copy.auth.reset.update.error.expiredLink.cta}
            onPress={() => router.replace('/reset-password')}
            style={styles.centeredButton}
          />
          {/* L3 (v23-ux-audit-r1): this used to be the only control on this state, so a user who
              simply remembers their password had to make a two-hop trip through the reset flow.
              `router.replace`, not `router.back()`: this screen's own header notes it has "no
              in-app entry point" — it is reached only via an emailed deep link, so there is no
              back-stack entry to return to. */}
          <PillButton
            variant="ghost"
            label={Copy.auth.reset.request.cta.backToSignIn}
            onPress={() => router.replace({ pathname: '/sign-in', params: { mode: 'signIn' } })}
          />
        </View>
        </SafeAreaView>
      </ScreenGradient>
    );
  }

  if (submitStatus === 'success') {
    return (
      <ScreenGradient>
        <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <KineticText
            accessibilityRole="header"
            staggerMs={Motion.stagger.line}
            style={styles.title}
            containerStyle={styles.titleRow}>
            {Copy.auth.reset.update.success.title}
          </KineticText>
          <Text style={styles.body}>{Copy.auth.reset.update.success.body}</Text>
          {/* Releases the recovery hold (issue #81). No router.replace() is needed or wanted:
              the password is already committed, so the session is now an ordinary signed-in one,
              and dropping the flag flips app/_layout.tsx's guard — expo-router then routes into
              (tabs) on its own, exactly as sign-in does. Calling replace('/') here instead would
              be a no-op, because (tabs) is still excluded from the navigator until the flag
              clears. */}
          <PillButton
            label={Copy.auth.reset.update.cta.continue}
            onPress={clearPasswordRecovery}
            style={styles.centeredButton}
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
              {Copy.auth.reset.update.title}
            </KineticText>
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
              // Same pair issue #28 established on sign-in, and the same reason: `textContentType`
              // is the iOS half only, so without `autoComplete` Android's autofill never offers to
              // generate or save the new password this screen exists to set. One field, so the
              // return key submits rather than chaining.
              autoComplete="new-password"
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
              editable={!isBusy}
            />
            {/* Same proactive rule as sign-up (issue #9) — this is a candidate password too. */}
            <Text nativeID="update-password-hint" style={styles.passwordHint}>
              {Copy.auth.password.hint}
            </Text>
            <PillButton
              label={Copy.auth.reset.update.cta.submit}
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
    scrollContent: {
      flexGrow: 1,
      width: '100%',
      maxWidth: ContentWidth.readable,
      alignSelf: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
      gap: Spacing.xxl,
    },
    // Same readable-column cap as scrollContent above — this style backs the plain (non-scroll)
    // checking/expired/success states, each already centered vertically by `flex: 1,
    // justifyContent: 'center'`; width/maxWidth/alignSelf caps and centers them horizontally too.
    centered: {
      flex: 1,
      width: '100%',
      maxWidth: ContentWidth.readable,
      alignSelf: 'center',
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
    passwordHint: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.xs,
      // On the wash — `text.primary` only, at full opacity (H3, v23-ux-audit-r1: opacity here
      // dropped this below WCAG AA). Quietness comes from the xs size alone.
      color: colors.text.primary,
      paddingHorizontal: Spacing.lg,
    },
    errorText: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      color: Semantic.error[scheme],
      textAlign: 'center',
    },
  });
}
