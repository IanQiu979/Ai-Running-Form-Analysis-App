import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
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
import { LowPolyField, POSES } from '@/components/low-poly-field';
import { PillButton } from '@/components/ui/pill-button';
import { ScreenGradient } from '@/components/ui/screen-gradient';
import { SurfaceCard } from '@/components/ui/surface-card';
import { PASSWORD_MIN_LENGTH } from '@/constants/auth';
import { Copy } from '@/constants/copy';
import {
  Colors,
  ContentWidth,
  ControlHeight,
  FontFamily,
  FontSize,
  LineHeight,
  Motion,
  Opacity,
  Radius,
  Semantic,
  Spacing,
  Tracking,
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
    <ScreenGradient>
      <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          {/* THE SPLASH-SCALE HEADER. The reference's own first screen is one line of type on a
              wash and nothing else; the wordmark here takes that scale (xxl -> display) and
              assembles word by word on arrival. The low-poly mark sits behind it as atmosphere,
              the same relationship Home's hero uses, so the two first screens a new user sees
              are recognisably one design. */}
          <View style={styles.header}>
            <LowPolyField
              poses={[POSES.scatter, POSES.gather]}
              color={colors.text.primary}
              size={SPLASH_MARK_SIZE}
              style={styles.headerMark}
            />
            <KineticText
              accessibilityRole="header"
              staggerMs={Motion.stagger.line}
              style={styles.wordmark}
              containerStyle={styles.wordmarkRow}>
              {Copy.auth.wordmark}
            </KineticText>
            <Text style={styles.valueProp}>{Copy.auth.valueProp}</Text>
          </View>

          <View style={styles.actions}>
            {/* Issue #20: the primary CTA, per Ian's decision — Google is the lowest-friction
                path and the one most likely to succeed, so it's the one control on first paint
                carrying `Accent.value`. "Continue with email" below stays secondary. */}
            <PillButton
              label={Copy.auth.cta.google}
              onPress={handleGoogleSignIn}
              disabled={isBusy}
              busy={pendingAction === 'google'}
            />

            {!showEmailForm && (
              <PillButton
                variant="secondary"
                label={Copy.auth.cta.email}
                onPress={() => setShowEmailForm(true)}
                disabled={isBusy}
              />
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
                  <PillButton
                    variant="ghost"
                    label={Copy.auth.reset.cta.forgotPassword}
                    onPress={() => router.push('/reset-password')}
                    disabled={isBusy}
                    style={styles.inlineLink}
                  />
                )}
                <PillButton
                  label={mode === 'signUp' ? Copy.auth.signUp.submit : Copy.auth.signIn.submit}
                  onPress={handleEmailSubmit}
                  disabled={isBusy}
                  busy={pendingAction === 'email'}
                />
              </View>
            )}

            {/* The error sits on an OPAQUE card, not on the wash. `Semantic.error` is proven
                against `background`/`surface.base`/`surface.raised` (theme-contrast.test.ts) and
                deliberately NOT against the page gradient — see `Gradient`'s contract in
                constants/theme.ts. This card is what keeps that promise true now that the screen
                behind it is a gradient. */}
            {displayedError !== null && (
              <SurfaceCard padding={Spacing.lg}>
                <Text style={styles.errorText} accessibilityLiveRegion="polite">
                  {displayedError}
                </Text>
              </SurfaceCard>
            )}
          </View>

          <PillButton
            variant="ghost"
            label={mode === 'signIn' ? Copy.auth.signUp.link : Copy.auth.signIn.link}
            onPress={toggleMode}
            disabled={isBusy}
            block
          />
        </ScrollView>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenGradient>
  );
}

/** The splash mark's drawn size — atmosphere behind the wordmark, same role Home's hero uses. */
const SPLASH_MARK_SIZE = 260;

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
    header: {
      alignItems: 'center',
      gap: Spacing.md,
      justifyContent: 'center',
    },
    headerMark: {
      // Behind the wordmark, adding no height — so a small device still fits the form without
      // the mark pushing the CTAs off-screen.
      position: 'absolute',
      opacity: Opacity.disabled,
    },
    wordmarkRow: {
      justifyContent: 'center',
    },
    wordmark: {
      fontFamily: FontFamily.display.bold,
      // xxl -> display (32 -> 64). This is the first screen anyone sees and the app's name is the
      // subject of it; at 32pt it read as a page heading rather than as a mark.
      fontSize: FontSize.display,
      letterSpacing: Tracking.hero,
      lineHeight: FontSize.display * LineHeight.hero,
      color: colors.text.primary,
      textAlign: 'center',
    },
    valueProp: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.md,
      lineHeight: FontSize.md * LineHeight.body,
      // Raised from `text.secondary`: this line sits directly on the page gradient, which is
      // proven for `text.primary` only (`Gradient`'s contract, constants/theme.ts). The hierarchy
      // it used to get from being a lighter tone now comes from the 64pt wordmark above it.
      color: colors.text.primary,
      textAlign: 'center',
    },
    actions: {
      gap: Spacing.md,
    },
    // Pressed and disabled/busy are two different states and must not render at the same
    // opacity. Both now live inside `<PillButton>`, which owns every button on this screen —
    // the hand-rolled `primaryButton`/`secondaryButton`/`buttonPressed`/`buttonDisabled` styles
    // this file used to carry are gone with them.
    emailForm: {
      gap: Spacing.md,
    },
    input: {
      minHeight: ControlHeight.standard,
      // `Radius.pill`, not `Radius.card`: a 52pt field at the card's 24pt corner reads as a
      // not-quite-pill, which is the one shape the reference never uses. Committing to the pill
      // makes the field and the button below it obviously the same family.
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: colors.control.border,
      backgroundColor: colors.surface.base,
      paddingHorizontal: Spacing.xl,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.md,
      color: colors.text.primary,
    },
    // Small, secondary, quiet — the proactive password rule (issue #9), sign-up mode only. Sits
    // on the wash, so `text.primary` at the smallest step rather than `text.secondary`.
    passwordHint: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.xs,
      color: colors.text.primary,
      opacity: Opacity.pressed,
      paddingHorizontal: Spacing.lg,
    },
    inlineLink: {
      alignSelf: 'center',
    },
    // AA-proven against every surface in both themes — see
    // constants/__tests__/theme-contrast.test.ts. Kept on an opaque `<SurfaceCard>` for exactly
    // that reason; see the render site's comment.
    errorText: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      lineHeight: FontSize.sm * LineHeight.body,
      color: Semantic.error[scheme],
      textAlign: 'center',
    },
  });
}
