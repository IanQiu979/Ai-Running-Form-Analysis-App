/**
 * V23-06 · Sign-up / sign-in (2026-09-13) — the last screen of the entry flow (hero → pillars
 * story → here; since 2026-09-20 the first two are one scroll in `welcome`), rebuilt to the
 * captain-approved Claude Design page on the V23-01 theme sheet. One screen, two modes: sign-up
 * is the default (the story's "Get started" sends new users here; the page's first artboard),
 * and the footer link flips to sign-in for a returning user.
 *
 * The page draws: eyebrow + Display title, two 56 pt fields, a 12 pt consent checkbox with a
 * line of fine print, a white primary button, a bordered secondary "Continue with Google", and a
 * one-line footer that switches mode. Since 2026-09-20 the sign-up artboard also carries the AGE
 * CHOICE above that consent line (`components/age-band-choice.tsx`: "18 or older" / "13–17 — my
 * parent or guardian agrees", the latter revealing the guardian attestation) — the page's single
 * "I am 16+ and agree…" line became two facts recorded separately: the band, sent to
 * `signup-with-captcha` and persisted server-side, and the Terms + Privacy agreement, required
 * for every band. Captain's plan, approved 2026-09-20, mirroring V2.2 (IanQiu979/
 * Ai-Customized-Running-Plan-App#123). Its third artboard is the error state — a `danger` border
 * on the offending field with the message beneath it, the one place the sheet's chromatic value
 * is allowed. Nothing else is decorated; the only motion is the page transition's 12 pt rise.
 *
 * WHAT THE PAGE DOES NOT DRAW BUT THE SCREEN KEEPS, each for a working reason:
 *   - the Turnstile widget in sign-up mode (a captcha token is required server-side by
 *     supabase/functions/signup-with-captcha; without the widget nobody can ever create an
 *     account) and its honest no-key notice (Known Issue #12);
 *   - "Forgot password?" in sign-in mode — dropping it would re-open issue #81's dead end, where
 *     a locked-out email user had no way back in;
 *   - the password rule (issue #9), carried as the field's `accessibilityHint` rather than as
 *     visible text.
 * And what the page draws that is deliberately inert: the underlined "Terms" / "Privacy Policy"
 * in the consent line are the page's styling, not links — the Terms are unpublished, and the
 * Privacy Policy (published 2026-09-19; the Settings screen opens it via `PRIVACY_POLICY_URL`)
 * sits inside the checkbox's own tap target, so a link there would need its own control and
 * certified copy. A link to nothing is worse than an underline.
 *
 * AUTH BEHAVIOUR IS UNCHANGED from the screen this replaced: validation → length pre-check →
 * HIBP breach check → captcha token → `signUpWithCaptcha` → `applySignupSession`; sign-in →
 * `signInWithPassword`; Google → `signInWithGoogle`. Every comment on those paths below is the
 * original's, because every reason still holds.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Polyline } from 'react-native-svg';

import { AgeBandChoiceGroup, selectionOf } from '@/components/age-band-choice';
import { TurnstileWidget, type TurnstileWidgetHandle } from '@/components/turnstile-widget';
import { SquareButton } from '@/components/ui/square-button';
import { TextField } from '@/components/ui/text-field';
import { PASSWORD_MIN_LENGTH } from '@/constants/auth';
import { Copy } from '@/constants/copy';
import { ContentWidth } from '@/constants/theme';
import { Ink, Layout, Motion, Space, Type } from '@/constants/v23-theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { signInWithGoogle } from '@/lib/auth';
import { mapAuthError, mapSignupWithCaptchaError, validateSignInForm } from '@/lib/auth-errors';
import { checkPasswordBreached } from '@/lib/hibp';
import { useSession } from '@/lib/session-provider';
import { applySignupSession, signUpWithCaptcha } from '@/lib/signup-with-captcha';
import { supabase } from '@/lib/supabase';
import { resolveTurnstileConfig } from '@/lib/turnstile-config';
import { useAnnounce } from '@/lib/use-announce';
import type { AgeBand } from '@shared/age-band';

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

/** Which field a validation message belongs under. Anything not listed is a form-level error. */
type ErrorField = 'email' | 'password' | 'form';

// The page's consent line is 12 pt fine print pulled 12 pt into the 32 pt gaps either side of
// it, so it reads as a footnote to the fields rather than as a section of its own.
const CONSENT_PULL = -Space.md;
// The footer sits 8 pt closer to the buttons than the page's 32 pt rhythm.
const FOOTER_PULL = -Space.sm;

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  // Sign-up is the default (the story's "Get started" sends new users here). `?mode=signIn`
  // seeds the other mode for a caller who knows the user already has an account and has no
  // sign-in screen beneath it — update-password's "Back to sign in", reached by deep link — so
  // an expired-recovery-link user does not land on "Create account". Any other value keeps the
  // default.
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<Mode>(params.mode === 'signIn' ? 'signIn' : 'signUp');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const isBusy = pendingAction !== null;
  // Focus-chaining target for the email field's `onSubmitEditing` (issue #28) — the return key
  // advances email -> password instead of dead-ending the keyboard.
  const passwordInputRef = useRef<TextInput>(null);

  // V23-06's Terms + Privacy consent. A second gate on "Create account" alongside the captcha
  // token below: a box the user can leave unticked and still submit would be decoration. The row
  // is drawn in sign-up mode; in sign-in mode it stays off the artboard until "Continue with
  // Google" needs it (see `handleGoogleSignIn`), and once revealed it stays. The tick itself is
  // shared across modes, so it survives the footer toggle.
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentRevealed, setConsentRevealed] = useState(false);

  // The age choice (2026-09-20) — drawn in sign-up mode only. `ageBand` starts unpicked and the
  // guardian attestation starts unticked; like the consent tick above, both survive a footer
  // toggle (the widget's token is the only thing a round trip drops, see `toggleMode`).
  // `ageSelection` is the one rule shared with the submit gate: null until the choice is complete
  // (a band, plus the attestation when the band is 13–17). Google is NOT gated on it here: an OAuth account is
  // minted inside the browser exchange, where no body of ours travels, so it is asked once on
  // first use instead (`components/age-band-gate.tsx`).
  const [ageBand, setAgeBand] = useState<AgeBand | null>(null);
  const [guardianConsent, setGuardianConsent] = useState(false);
  const ageSelection = selectionOf(ageBand, guardianConsent);

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

  // V23-06's error artboard puts the message under the field it is about. Only the purely
  // local validation strings (issue #17) name a field; a server answer, a captcha failure or a
  // session-context error is about the attempt as a whole and renders under the fields block.
  const errorField: ErrorField = fieldForError(displayedError);

  function clearErrors() {
    setErrorMessage(null);
    clearDeepLinkAuthError();
    clearCorruptedSessionError();
  }

  function toggleMode() {
    setMode((current) => (current === 'signIn' ? 'signUp' : 'signIn'));
    // The widget unmounts in sign-in mode, so a token issued before the toggle can expire with
    // nobody to report it; dropping it here means the widget re-solves on the way back rather
    // than "Create account" enabling against a dead token.
    setCaptchaToken(null);
    clearErrors();
  }

  async function handleGoogleSignIn() {
    // Same gate as the email path, in BOTH modes: Supabase OAuth creates a brand-new account for
    // a Google identity it has never seen, regardless of which mode this screen is in — so
    // "Continue with Google" from sign-in mode is an account creation the sign-up gate would
    // otherwise never see. In sign-in mode the tap reveals the consent row (same row, same place
    // as sign-up mode) instead of launching OAuth; a returning Google user pays one tick.
    if (!consentChecked) {
      setConsentRevealed(true);
      setErrorMessage(Copy.auth.error.consentRequired);
      return;
    }
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
    // The consent gate belongs HERE as well as on the button. The password field's return key
    // (`onSubmitEditing`) calls this handler directly, with the button still disabled — so a
    // button-only gate would let sign-up proceed with the box unticked (security audit,
    // 2026-09-14). Local and before any network call, like the validation above.
    if (mode === 'signUp' && !consentChecked) {
      setErrorMessage(Copy.auth.error.consentRequired);
      return;
    }
    // Same shape of gate for the age choice, in the same place, for the same return-key reason.
    // Two messages, not one: "pick a band" and "tick the attestation" are different actions, and
    // the server's own refusals (`age_band_required` / `guardian_consent_required`) are split the
    // same way, so a client that somehow skipped this block would read the same two sentences.
    if (mode === 'signUp' && ageSelection === null) {
      setErrorMessage(
        ageBand === null ? Copy.auth.error.ageBandRequired : Copy.auth.error.guardianConsentRequired
      );
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
        // `ageSelection` is non-null here: the local gate above returned early otherwise. The
        // check is repeated for the type system, not for the user.
        if (ageSelection === null) {
          setErrorMessage(Copy.auth.error.ageBandRequired);
          return;
        }
        const signupResult = await signUpWithCaptcha(trimmedEmail, password, captchaToken, ageSelection);
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

  const isSignUp = mode === 'signUp';

  // The page-transition token: 250 ms fade with a 12 pt rise. The native stack supplies the
  // fade (app/_layout.tsx); the rise is this screen's own, and is skipped under Reduce Motion.
  // A shared value rather than an `entering` layout animation: the layout-animation path leaks
  // across RNTL renders in this repo's jest setup (every test after the first mounts an empty
  // tree), and the plain timing path is the one CLAUDE.md's motion-test convention covers.
  const arrival = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) {
      arrival.value = 1;
      return;
    }
    arrival.value = withTiming(1, {
      duration: Motion.duration.page,
      easing: bezier(Motion.curve.arrive),
    });
  }, [arrival, reduceMotion]);
  const arrivalStyle = useAnimatedStyle(() => ({
    opacity: arrival.value,
    transform: [{ translateY: Motion.pageShift * (1 - arrival.value) }],
  }));

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingTop: Math.max(insets.top, Layout.canvas.safeTop),
              paddingBottom: Math.max(insets.bottom, Layout.canvas.safeBottom),
            },
          ]}
          keyboardShouldPersistTaps="handled">
          <Animated.View style={[styles.column, arrivalStyle]}>
            <View style={styles.header}>
              <Text style={styles.eyebrow}>{Copy.auth.eyebrow}</Text>
              {/* The role sits on the Text itself: a non-accessible wrapper View with a role
                  never reaches VoiceOver's Headings rotor. */}
              <Text style={styles.title} accessibilityRole="header">
                {Copy.auth.title}
              </Text>
            </View>

            <View style={styles.fields}>
              <TextField
                placeholder={Copy.auth.email.placeholder}
                accessibilityLabel={Copy.auth.email.placeholder}
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
                error={errorField === 'email' ? displayedError : null}
              />
              <TextField
                ref={passwordInputRef}
                placeholder={Copy.auth.password.placeholder}
                accessibilityLabel={Copy.auth.password.placeholder}
                // The password rule (issue #9), sign-up mode only — noise in sign-in mode, where it
                // does not apply to an existing password. The page draws no visible hint, so the
                // rule travels as the hint a screen reader gets and as the inline error a sighted
                // user gets on submit.
                accessibilityHint={isSignUp ? Copy.auth.password.hint : undefined}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                textContentType={isSignUp ? 'newPassword' : 'password'}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                returnKeyType="go"
                onSubmitEditing={handleEmailSubmit}
                editable={!isBusy}
                error={errorField === 'password' ? displayedError : null}
              />
              {displayedError !== null && errorField === 'form' && (
                <Text style={styles.formError} accessibilityLiveRegion="polite">
                  {displayedError}
                </Text>
              )}
            </View>

            {/* The age choice (2026-09-20), sign-up mode only — above the Terms line so the
                form reads top-down as "who you are, what you agree to". The sign-in artboard
                never draws it: a returning Google user is asked on first use by the gate, an
                email user already answered at sign-up (or pre-dates the question). */}
            {isSignUp && (
              <AgeBandChoiceGroup
                value={ageBand}
                onChange={(band) => {
                  setAgeBand(band);
                  // Switching bands drops the attestation: it belongs to the 13–17 answer only.
                  if (band !== '13_17') setGuardianConsent(false);
                  clearErrors();
                }}
                guardianConsent={guardianConsent}
                onToggleGuardianConsent={() => setGuardianConsent((checked) => !checked)}
                disabled={isBusy}
                testIDPrefix="signup-age"
              />
            )}

            {(isSignUp || consentRevealed) && (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={Copy.auth.consent.a11yLabel}
                accessibilityState={{ checked: consentChecked, disabled: isBusy }}
                disabled={isBusy}
                onPress={() => setConsentChecked((checked) => !checked)}
                style={styles.consentRow}
                testID="signup-consent">
                <View style={[styles.checkbox, consentChecked && styles.checkboxChecked]}>
                  {consentChecked && (
                    <Svg width={CHECK_WIDTH} height={CHECK_HEIGHT} viewBox="0 0 12 9">
                      <Polyline
                        points="1,4.5 4.5,8 11,1"
                        fill="none"
                        stroke={Ink.onAccent}
                        strokeWidth={CHECK_STROKE}
                      />
                    </Svg>
                  )}
                </View>
                {/* The underlines are the page's styling, not links: the Terms are unpublished,
                    and the Privacy Policy — published, opened from Settings via
                    `PRIVACY_POLICY_URL` — is nested inside this checkbox's tap target, so wiring
                    it needs a control of its own (see the header). A tap that goes nowhere would
                    be a dead end dressed as help. */}
                {/* One line at the page's size; wraps rather than truncates at large Dynamic Type —
                    legal text must never end in an ellipsis. */}
                <Text style={styles.consentText}>
                  {Copy.auth.consent.prefix}
                  <Text style={styles.underlined}>{Copy.auth.consent.terms}</Text>
                  {Copy.auth.consent.and}
                  <Text style={styles.underlined}>{Copy.auth.consent.privacy}</Text>
                </Text>
              </Pressable>
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
            {isSignUp &&
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
                // Not `danger`: nothing the user did failed, and painting a build-configuration
                // fact in the error colour would read as "you broke it". `accessibilityLiveRegion`
                // is the Android half; iOS gets the same fact through the submit button's hint.
                <View
                  style={styles.notice}
                  testID="signup-unavailable-notice"
                  accessibilityLiveRegion="polite">
                  <Text style={styles.noticeTitle}>{Copy.auth.signUp.unavailable.title}</Text>
                  <Text style={styles.noticeBody}>{Copy.auth.signUp.unavailable.body}</Text>
                </View>
              ))}

            <View style={styles.actions}>
              <SquareButton
                label={isSignUp ? Copy.auth.signUp.submit : Copy.auth.signIn.submit}
                onPress={handleEmailSubmit}
                testID="auth-email-submit"
                disabled={isBusy || (isSignUp && (!captchaToken || !consentChecked || ageSelection === null))}
                // Only when the button can NEVER become enabled. A missing token with a key
                // present is the ordinary "solve the challenge" wait, which the visible widget
                // already explains — hinting there would nag on every render.
                accessibilityHint={
                  isSignUp && !TURNSTILE_CONFIG ? Copy.auth.signUp.unavailable.a11yHint : undefined
                }
                busy={pendingAction === 'email'}
              />
              <SquareButton
                variant="secondary"
                label={Copy.auth.cta.google}
                onPress={handleGoogleSignIn}
                disabled={isBusy}
                busy={pendingAction === 'google'}
              />
              {/* Issue #81 — sign-in mode only: there is no password to recover during sign-up.
                  The page does not draw this link; keeping it is what stands between a locked-out
                  email user and having no way back into their account at all. */}
              {!isSignUp && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={Copy.auth.reset.cta.forgotPassword}
                  accessibilityState={{ disabled: isBusy }}
                  disabled={isBusy}
                  onPress={() => router.push('/reset-password')}
                  style={styles.textLink}>
                  <Text style={styles.textLinkLabel}>{Copy.auth.reset.cta.forgotPassword}</Text>
                </Pressable>
              )}
            </View>

            <View style={styles.footer}>
              <Text style={styles.footerPrompt}>
                {isSignUp ? Copy.auth.signIn.switchPrompt : Copy.auth.signUp.switchPrompt}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isSignUp ? Copy.auth.signIn.switchLink : Copy.auth.signUp.switchLink}
                accessibilityState={{ disabled: isBusy }}
                disabled={isBusy}
                onPress={toggleMode}
                style={styles.footerLink}>
                <Text style={styles.footerLinkLabel}>
                  {isSignUp ? Copy.auth.signIn.switchLink : Copy.auth.signUp.switchLink}
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** The local validation strings are the only ones that name a field (`validateSignInForm` and
 *  the sign-up pre-checks in `handleEmailSubmit` are their only producers); everything else is a
 *  form-level answer. Compared by value against the copy, which is how the strings are made. */
function fieldForError(message: string | null): ErrorField {
  if (message === null) return 'form';
  if (message === Copy.auth.error.emailRequired || message === Copy.auth.error.emailInvalid) {
    return 'email';
  }
  if (
    message === Copy.auth.error.passwordRequired ||
    message === Copy.auth.error.passwordTooShort ||
    message === Copy.auth.error.passwordBreached
  ) {
    return 'password';
  }
  return 'form';
}

/** Reanimated's `Easing.bezier` takes four numbers; the token stores them as one tuple. */
function bezier([x1, y1, x2, y2]: readonly [number, number, number, number]) {
  return Easing.bezier(x1, y1, x2, y2);
}

// The page's check glyph: a 7 x 5 tick inside the 12 pt box, drawn on a 12 x 9 viewBox.
const CHECK_WIDTH = 7;
const CHECK_HEIGHT = 5;
const CHECK_STROKE = 1.5;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Ink.bg,
  },
  flex: {
    flex: 1,
  },
  // `flex` ONLY on the ScrollView's own style; child layout lives here. The readable column is
  // centred by `alignSelf` so an iPad does not stretch a phone form edge to edge (issue #63).
  scrollContent: {
    flexGrow: 1,
    width: '100%',
    maxWidth: ContentWidth.readable,
    alignSelf: 'center',
    paddingHorizontal: Layout.gutter,
    justifyContent: 'center',
  },
  column: {
    gap: Space.xxl,
  },
  header: {
    alignItems: 'center',
    gap: Space.sm,
  },
  eyebrow: {
    ...Type.label,
    color: Ink.ink2,
    textAlign: 'center',
  },
  title: {
    ...Type.display,
    color: Ink.ink,
    textAlign: 'center',
  },
  fields: {
    gap: Space.md,
  },
  formError: {
    ...Type.small,
    color: Ink.danger,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    minHeight: Layout.hitTarget,
    marginVertical: CONSENT_PULL,
  },
  checkbox: {
    width: Layout.checkbox,
    height: Layout.checkbox,
    borderWidth: Layout.hairline,
    borderColor: Ink.line,
    backgroundColor: Ink.bgRaised,
    borderRadius: Layout.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    borderColor: Ink.ink,
    backgroundColor: Ink.ink,
  },
  consentText: {
    ...Type.fine,
    // `ink3` is the page's choice for this line. It is under 4.5:1 by the sheet's own contract —
    // flagged for the captain rather than silently raised; the checkbox's accessibility label
    // carries the full sentence regardless.
    color: Ink.ink3,
    flexShrink: 1,
  },
  underlined: {
    textDecorationLine: 'underline',
  },
  notice: {
    backgroundColor: Ink.bgRaised,
    borderWidth: Layout.hairline,
    borderColor: Ink.line,
    borderRadius: Layout.radius,
    padding: Layout.cardPadding,
    gap: Space.xs,
  },
  noticeTitle: {
    ...Type.body,
    color: Ink.ink,
  },
  noticeBody: {
    ...Type.small,
    color: Ink.ink2,
  },
  actions: {
    gap: Space.lg,
  },
  textLink: {
    alignSelf: 'center',
    minHeight: Layout.hitTarget,
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
  },
  textLinkLabel: {
    ...Type.small,
    color: Ink.ink2,
    textDecorationLine: 'underline',
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
    marginTop: FOOTER_PULL,
  },
  footerPrompt: {
    ...Type.small,
    color: Ink.ink2,
  },
  footerLink: {
    minHeight: Layout.hitTarget,
    justifyContent: 'center',
  },
  footerLinkLabel: {
    ...Type.small,
    color: Ink.ink,
    textDecorationLine: 'underline',
  },
});
