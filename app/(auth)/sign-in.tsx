import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedRef,
  useAnimatedStyle,
  useScrollViewOffset,
  useSharedValue,
} from 'react-native-reanimated';

import { KineticText } from '@/components/kinetic-text';
import { LowPolyField } from '@/components/low-poly-field';
import { TurnstileWidget, type TurnstileWidgetHandle } from '@/components/turnstile-widget';
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
  Radius,
  Semantic,
  Spacing,
  Tracking,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { signInWithGoogle } from '@/lib/auth';
import { mapAuthError, mapSignupWithCaptchaError, validateSignInForm } from '@/lib/auth-errors';
import { checkPasswordBreached } from '@/lib/hibp';
import { useSession } from '@/lib/session-provider';
import { applySignupSession, signUpWithCaptcha } from '@/lib/signup-with-captcha';
import { supabase } from '@/lib/supabase';
import { resolveTurnstileConfig } from '@/lib/turnstile-config';
import { useAnnounce } from '@/lib/use-announce';

// The "cool zoom" reveal (see the mark section below): `Motion.curve.calm` is this app's
// expressive-arrival curve ("used for kinetic text, hero reveals, aperture opens" — its own
// doc comment in constants/theme.ts), the correct register for a section resolving into view
// rather than `curve.morph` (a shape transforming in place) or `curve.linear` (a loop). Built
// once at module scope, same as `constants/theme.ts`'s own curves, since `Easing.bezier`'s
// returned function is itself a worklet callable from the UI-thread style below.
const markRevealEasing = Easing.bezier(...Motion.curve.calm).factory();

// The site key is Cloudflare's own public identifier for this Turnstile widget — safe to inline
// into the client bundle by design (only the SECRET key, used server-side in
// supabase/functions/signup-with-captcha, verifies anything). See CLAUDE.md's "Secrets & env".
//
// A key ALONE is not enough: Turnstile widgets are hostname-bound and a real site key rendered
// under `about:blank` fails with Cloudflare's 110200 no matter how correct the key is, so the
// base URL the challenge loads under is resolved alongside it and both are gated together.
// `lib/turnstile-config.ts` owns that resolution and documents the whole failure mode. Read at
// module scope with static dot access, per the expo/no-dynamic-env-var rule.
const TURNSTILE_CONFIG = resolveTurnstileConfig(
  process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY,
  process.env.EXPO_PUBLIC_TURNSTILE_HOSTNAME,
  process.env.EXPO_PUBLIC_SUPABASE_URL
);

type Mode = 'signIn' | 'signUp';
type PendingAction = 'google' | 'email' | null;

export default function SignInScreen() {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors, scheme), [colors, scheme]);

  const reduceMotion = useReducedMotion();
  const { height: windowHeight } = useWindowDimensions();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useScrollViewOffset(scrollRef);
  // Set from the mark section's own `onLayout` (below) — its content-relative y offset, so the
  // reveal threshold tracks wherever the section actually lands regardless of device/font size,
  // rather than a guessed pixel constant.
  const markOffsetY = useSharedValue(0);

  const markAnimatedStyle = useAnimatedStyle(() => {
    if (reduceMotion) {
      // Reduced-motion contract: no scroll-triggered transform, the mark just sits at rest in
      // its own section — same "still, not hidden" reading `LowPolyField` itself documents.
      return { opacity: 1, transform: [{ scale: 1 }] };
    }
    // The zoom completes over the scroll distance between the section's top entering the bottom
    // of the viewport (progress 0) and it having travelled ~60% of the way up the screen
    // (progress 1) — a natural "approaching, then resolving" window tied to scroll position,
    // not a fixed timer.
    const revealStart = markOffsetY.value - windowHeight;
    const revealEnd = markOffsetY.value - windowHeight * 0.4;
    const progress = interpolate(scrollY.value, [revealStart, revealEnd], [0, 1], Extrapolation.CLAMP);
    const eased = markRevealEasing(progress);
    return {
      opacity: eased,
      transform: [{ scale: interpolate(eased, [0, 1], [MARK_REVEAL_START_SCALE, 1]) }],
    };
  });

  function handleMarkSectionLayout(event: LayoutChangeEvent) {
    markOffsetY.value = event.nativeEvent.layout.y;
  }

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

  // Issue #12/Known Issue #12 — sign-up only, never rendered in signIn mode. Holds a Turnstile
  // token good for exactly one `signUpWithCaptcha` attempt: the token is single-use (see
  // components/turnstile-widget.tsx's header), so it's cleared and the widget reset after every
  // submit attempt, success or failure, and submit stays disabled until a fresh one arrives.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);

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

        // Issue #12/Known Issue #12: `captchaToken` is required to reach this point — the submit
        // button stays disabled without one (see the render below), so this is a defensive
        // fail-safe, not the primary gate.
        if (!captchaToken) {
          setErrorMessage(Copy.auth.error.captchaLoadFailed);
          return;
        }

        // Calls `supabase/functions/signup-with-captcha` instead of `supabase.auth.signUp`
        // directly — see lib/signup-with-captcha.ts's header for why (Supabase's native
        // `auth.captcha` is project-wide and would gate sign-in too). The token is single-use
        // regardless of outcome, so it's cleared and the widget reset unconditionally right
        // after this call, success or failure.
        const signupResult = await signUpWithCaptcha(trimmedEmail, password, captchaToken);
        setCaptchaToken(null);
        turnstileRef.current?.reset();

        if (!signupResult.ok) {
          setErrorMessage(mapSignupWithCaptchaError(signupResult.code));
          return;
        }

        // Hydrates the on-device session from the one the edge function already established.
        // `lib/session-provider.tsx`'s onAuthStateChange treats this identically to a session
        // from `signInWithPassword` — flips `session`, and the root layout's Stack.Protected
        // guard routes to (tabs) automatically. No manual navigation here.
        await applySignupSession(signupResult.session);
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
        <Animated.ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}>
          {/* THE SPLASH-SCALE HEADER. The reference's own first screen is one line of type on a
              wash and nothing else; the wordmark here takes that scale (xxl -> display) and
              assembles word by word on arrival. This is the whole first screenful now — the
              low-poly mark gets its own section below instead of sharing this one as atmosphere,
              since it no longer needs to fit alongside the wordmark on first paint. */}
          <View style={[styles.header, { minHeight: windowHeight * 0.6 }]}>
            <KineticText
              accessibilityRole="header"
              staggerMs={Motion.stagger.line}
              style={styles.wordmark}
              containerStyle={styles.wordmarkRow}>
              {Copy.auth.wordmark}
            </KineticText>
            <Text style={styles.valueProp}>{Copy.auth.valueProp}</Text>
          </View>

          {/* THE ZOOM REVEAL. `LowPolyField` is mounted unconditionally here — never gated behind
              a scroll threshold or unmounted when scrolled past — so its own internal shatter/gait
              loop (started once, in its own `useEffect`) keeps running regardless of scroll
              position, exactly the "never stops" contract this section needs. Only the wrapping
              `Animated.View`'s opacity/scale respond to scroll, via `markAnimatedStyle` above,
              which is what makes this read as a reveal rather than the mark simply always being
              there. Decorative and inert either way — `LowPolyField` itself hides its facets from
              the accessibility tree, so this section carries no accessibility role of its own. */}
          <Animated.View
            style={[styles.markSection, { minHeight: windowHeight * 0.55 }, markAnimatedStyle]}
            onLayout={handleMarkSectionLayout}
            pointerEvents="none">
            <LowPolyField
              color={colors.text.primary}
              size={MARK_SIZE}
              testID="sign-in-mark"
            />
          </Animated.View>

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
                {/* Issue #12/Known Issue #12 — sign-up only. `TURNSTILE_CONFIG` is only null in a
                    misconfigured environment (see .env.example), but "misconfigured" was shipped:
                    the v23-launch-audit-r1 audit found the key empty in every environment it could
                    read, and this branch used to render NOTHING — no widget, therefore no token,
                    therefore a permanently disabled "Create account" button with no explanation.
                    That is the silent dead end this else-branch exists to remove. It does not make
                    sign-up work (only a real key can; the token is verified server-side by
                    supabase/functions/signup-with-captcha), it makes the failure HONEST — the same
                    degrade-visibly contract `paywall.purchase.error.unavailable` already follows.
                    Keep this as a ternary, not two separate guards: the two states are mutually
                    exclusive by construction and a future edit that drops the else-branch would
                    silently restore the dead end. */}
                {mode === 'signUp' &&
                  (TURNSTILE_CONFIG ? (
                    <TurnstileWidget
                      ref={turnstileRef}
                      siteKey={TURNSTILE_CONFIG.siteKey}
                      baseUrl={TURNSTILE_CONFIG.baseUrl}
                      onToken={(token) => {
                        setCaptchaToken(token);
                        clearErrors();
                      }}
                      onExpire={() => {
                        setCaptchaToken(null);
                        setErrorMessage(Copy.auth.error.captchaExpired);
                      }}
                      onError={() => {
                        setCaptchaToken(null);
                        setErrorMessage(Copy.auth.error.captchaLoadFailed);
                      }}
                    />
                  ) : (
                    // OPAQUE card, not the wash: `text.secondary` (the body below) is only proven
                    // against `surface.*`, never against `Gradient.page` — constants/theme.ts's
                    // token contract, enforced by constants/__tests__/theme-contrast.test.ts.
                    // `accessibilityLiveRegion` matches the error card below it (Android); iOS gets
                    // the same fact through the submit button's `accessibilityHint`.
                    <SurfaceCard
                      padding={Spacing.lg}
                      testID="signup-unavailable-notice"
                      accessibilityLiveRegion="polite">
                      <Text style={styles.noticeTitle}>
                        {Copy.auth.signUp.unavailable.title}
                      </Text>
                      <Text style={styles.noticeBody}>{Copy.auth.signUp.unavailable.body}</Text>
                    </SurfaceCard>
                  ))}
                <PillButton
                  label={mode === 'signUp' ? Copy.auth.signUp.submit : Copy.auth.signIn.submit}
                  onPress={handleEmailSubmit}
                  disabled={isBusy || (mode === 'signUp' && !captchaToken)}
                  // Only when the button can NEVER become enabled. A missing token with a key
                  // present is the ordinary "solve the challenge" wait, which the visible widget
                  // already explains — hinting there would nag on every render.
                  accessibilityHint={
                    mode === 'signUp' && !TURNSTILE_CONFIG
                      ? Copy.auth.signUp.unavailable.a11yHint
                      : undefined
                  }
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
        </Animated.ScrollView>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenGradient>
  );
}

/** The mark's drawn size, now that it fills its own section rather than sitting small and
 * translucent behind the wordmark — bumped up from the old 160 (H2, v23-ux-audit-r1) since it no
 * longer has to leave room for the wordmark/value-prop sharing its box. */
const MARK_SIZE = 220;

/** The zoom's starting scale — how "far away" the mark reads before the reveal resolves it to
 * its resting size. Chosen by feel, the same way `kinetic-text.tsx`'s `RISE` is: small enough to
 * read as a genuine zoom, not so small the shape is illegible mid-reveal. */
const MARK_REVEAL_START_SCALE = 0.62;

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
      padding: Spacing.xl,
      gap: Spacing.xxl,
    },
    // Given a `minHeight` of most of the viewport at the render site (it needs `useWindowDimensions`,
    // which a `StyleSheet.create` module can't read) so this reads as its own first screenful and
    // scrolling is required to reach the mark section below it — the deliberate scroll-reveal this
    // screen is now built around, replacing the old single-screen layout.
    header: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.md,
    },
    // The zoom-reveal section (see `markAnimatedStyle` at the render site). Also given a
    // `minHeight` inline so it reads as its own screenful rather than a cramped strip between the
    // header and the actions.
    markSection: {
      alignItems: 'center',
      justifyContent: 'center',
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
    // H3 (v23-ux-audit-r1): no `opacity` here — `text.primary` at full opacity is the only pair
    // the gradient proves. Quietness comes from the xs size alone.
    passwordHint: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.xs,
      color: colors.text.primary,
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
    // The missing-Turnstile-key notice. Deliberately NOT `Semantic.error` — nothing the user did
    // failed, and painting a build-configuration fact in error red would read as "you broke it".
    // Both tones are legal here only because the notice sits on an opaque `<SurfaceCard>`; on the
    // page gradient, `text.secondary` below would be an invisible-text bug (constants/theme.ts).
    noticeTitle: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.sm,
      lineHeight: FontSize.sm * LineHeight.body,
      color: colors.text.primary,
      textAlign: 'center',
    },
    noticeBody: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      lineHeight: FontSize.sm * LineHeight.body,
      color: colors.text.secondary,
      textAlign: 'center',
      marginTop: Spacing.xs,
    },
  });
}
