/**
 * Screen 11 — Settings (issue #53; also closes #27).
 *
 * ROUTE PLACEMENT: a top-level pushed route (`/settings`), NOT a tab. `docs/architecture.md`'s
 * route tree already made this call — it lists `paywall, settings` at root, alongside
 * `capture/` / `analyzing` / `result/[id]`, while explicitly nesting `(tabs)/history` as the tab
 * that M6 adds. Product-wise that is right: the tab bar is for co-equal primary surfaces (Home,
 * and later History), and Settings is a rare destination you push into and back out of. Giving it
 * a permanent third of the tab bar would crowd out History before History even ships.
 *
 * ⚠️ Because it is a root route, it MUST be declared inside `app/_layout.tsx`'s
 * `Stack.Protected guard={!!session}` block — an *undeclared* route file renders as an
 * always-available, UNGUARDED top-level screen (see that file's own comment). This screen hosts
 * sign-out and account deletion; reachable while signed out is not an option. It is declared.
 *
 * WHAT IS REAL AND WHAT IS NOT, TODAY:
 *   - Sign out — real, and correct against all THREE states a security audit found here (#27,
 *     finding F3; see `lib/sign-out.ts`'s header for why two states was wrong).
 *   - Consent withdrawal — real, writes to `public.consents` via `lib/consent.ts`.
 *   - Email / tier — real reads. Tier is DISPLAY-ONLY: read from `subscriptions`, never computed
 *     here. CLAUDE.md — "the client may display tier/quota state but is never the authority for it."
 *   - Delete account — a REAL `supabase.functions.invoke('delete-account')` call (fixed 2026-07-13,
 *     finding F1: the original mock binding had no owner to swap it for a real one, so it would
 *     have shipped silently lying about erasure). `delete-account`'s edge function (#58/#121) has
 *     been deployed to the live project since 2026-07-26 — see `lib/delete-account.ts`'s header —
 *     so this screen reaches it end to end.
 *     As of issue #124, the server can also reject the call with `code: 'reauth_required'` — a
 *     valid session is no longer enough on its own for this one destructive action. This screen
 *     handles that by prompting the user to re-present their credential (a password modal, or a
 *     re-run of Google sign-in) and retrying ONCE — see `beginReauthFlow` below. That gate is
 *     enforced server-side regardless of whether this screen calls these helpers at all; they
 *     exist purely so a real user hitting it gets a real path forward instead of a dead end.
 *
 * CONFIRMATIONS USE NATIVE `Alert`, NOT AN IN-SCREEN SHEET. That is a correctness requirement for
 * sign-out, not a style preference: the moment sign-out resolves, the session flips to null and the
 * route guard unmounts this screen — an inline error would render into a dying tree and never be
 * read. `Alert` outlives the screen. Delete and withdraw use it too, so all three destructive
 * confirmations read identically and get the OS's own accessibility and focus handling for free.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
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
  HitTarget,
  Opacity,
  Radius,
  Semantic,
  Spacing,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { hasConsented, UPLOAD_HEALTH_CONSENT, withdrawConsent } from '@/lib/consent';
import {
  deleteAccountClient,
  getReauthProvider,
  reauthenticateWithGoogle,
  reauthenticateWithPassword,
  type DeleteAccountErrorCode,
  type DeleteAccountResult,
  type DeleteAccountSuccessOutcome,
} from '@/lib/delete-account';
import { useSession } from '@/lib/session-provider';
import { signOut, type SignOutResult } from '@/lib/sign-out';
import { supabase } from '@/lib/supabase';
import { useAnnounce } from '@/lib/use-announce';

type SubscriptionTier = 'free' | 'pro' | 'elite';

/** Mirrors Home's own quota states. Loading and error are real states, not decoration: a tier we
 *  failed to read must never silently render as "Free" — that would be the client quietly
 *  inventing a plan, which is exactly what CLAUDE.md forbids it from being the authority on. */
type PlanState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; tier: SubscriptionTier };

/** `hasConsented` THROWS on any query failure and deliberately does not guess (lib/consent.ts
 *  fails closed). So "we don't know" is a first-class state here, distinct from "withdrawn". */
type ConsentState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; granted: boolean };

const TIER_LABEL: Record<SubscriptionTier, string> = {
  free: Copy.tier.free,
  pro: Copy.tier.pro,
  elite: Copy.tier.elite,
};

export default function SettingsScreen() {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors, scheme), [colors, scheme]);
  const { session } = useSession();
  const userId = session?.user.id;
  const email = session?.user.email;

  const [plan, setPlan] = useState<PlanState>({ status: 'loading' });
  const [consent, setConsent] = useState<ConsentState>({ status: 'loading' });
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  // Issue #124's step-up reauthentication flow. `passwordReauthVisible` gates the password modal
  // (email/password accounts only — Google's reauth is a native Alert + browser flow, no modal
  // needed). `isReauthenticating` is scoped to the modal's own Confirm-button busy state; the
  // outer `isDeleting` stays true through the whole reauth detour so the account-action row keeps
  // reading "Deleting your account…" and the rest of the screen stays disabled via `isBusy`.
  const [passwordReauthVisible, setPasswordReauthVisible] = useState(false);
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthPasswordError, setReauthPasswordError] = useState<string | null>(null);
  const [isReauthenticating, setIsReauthenticating] = useState(false);

  // Issue #11: every dynamic status Text below (`rowValueMuted`/`rowValue`/`errorText`/
  // `destructiveLabel`) carries `accessibilityLiveRegion="polite"`, which is Android-only — these
  // are the iOS complements, same pattern as app/(tabs)/index.tsx. One derived message per
  // section, matching whichever caption is actually on screen for that section.
  useAnnounce(
    plan.status === 'loading'
      ? Copy.settings.plan.loading
      : plan.status === 'error'
        ? Copy.settings.plan.error
        : plan.status === 'ready'
          ? TIER_LABEL[plan.tier]
          : null
  );
  useAnnounce(
    consent.status === 'loading'
      ? Copy.settings.consent.status.loading
      : consent.status === 'error'
        ? Copy.settings.consent.status.error
        : consent.status === 'ready'
          ? (consent.granted ? Copy.settings.consent.status.granted : Copy.settings.consent.status.withdrawn)
          : null
  );
  useAnnounce(isDeleting ? Copy.settings.deleteAccountState.pending : null);
  useAnnounce(reauthPasswordError);

  // This screen unmounts the instant `session` flips to null (the route guard), which happens
  // mid-flight for sign-out and for a successful delete. Any `setState` after that point is a
  // no-op at best and a warning at worst, so every async handler checks this first — the same
  // guard `components/consent-gate.tsx` uses, for the same reason.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchPlan = useCallback(async () => {
    if (!userId) return;
    setPlan({ status: 'loading' });

    try {
      // Same read as Home's: a subscriptions row only counts while `status = 'active'` (a canceled
      // one means free, same as no row). Read, never computed — the server is the authority.
      const { data, error } = await supabase
        .from('subscriptions')
        .select('tier')
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();

      if (!isMountedRef.current) return;
      if (error) {
        setPlan({ status: 'error' });
        return;
      }
      setPlan({ status: 'ready', tier: data?.tier ?? 'free' });
    } catch {
      if (!isMountedRef.current) return;
      setPlan({ status: 'error' });
    }
  }, [userId]);

  const fetchConsent = useCallback(async () => {
    setConsent({ status: 'loading' });
    try {
      const granted = await hasConsented(UPLOAD_HEALTH_CONSENT);
      if (!isMountedRef.current) return;
      setConsent({ status: 'ready', granted });
    } catch {
      // Fail closed and SAY SO. Rendering "withdrawn" here would be indistinguishable from a user
      // who genuinely never consented, which hides the outage — the exact bug class lib/consent.ts
      // was written to avoid.
      if (!isMountedRef.current) return;
      setConsent({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    void fetchPlan();
  }, [fetchPlan]);

  useEffect(() => {
    void fetchConsent();
  }, [fetchConsent]);

  const isBusy = isSigningOut || isDeleting || isWithdrawing;

  // --- Sign out (issue #27) ------------------------------------------------------------------

  function confirmSignOut() {
    Alert.alert(Copy.settings.signOut.confirm.title, Copy.settings.signOut.confirm.body, [
      { text: Copy.settings.signOut.confirm.cta.secondary, style: 'cancel' },
      {
        text: Copy.settings.signOut.confirm.cta.primary,
        onPress: () => {
          void handleSignOut();
        },
      },
    ]);
  }

  async function handleSignOut() {
    if (isBusy) return;
    setIsSigningOut(true);

    // Never rejects (lib/sign-out.ts), so no try/catch here by design.
    const result = await signOut();

    // Deliberately NOT guarded by isMountedRef: on a `globalRevokeFailed` result the session has
    // flipped to null and the route guard is unmounting this screen right now — the alert is a
    // native, screen-independent surface, which is exactly why the failure is reported through
    // one rather than inline. On `stillSignedIn` the screen is NOT unmounting (the session is
    // untouched), so this alert is just an ordinary one either way.
    if (!result.ok) {
      showSignOutFailureAlert(result);
    }

    if (isMountedRef.current) setIsSigningOut(false);
  }

  /**
   * Exhaustively switches on `SignOutResult`'s failure `reason` so that if `lib/sign-out.ts` ever
   * grows a fourth state, this fails to COMPILE rather than silently falling through to the wrong
   * copy — the exact class of bug finding F3 caught here (a real third state the original two-way
   * model couldn't represent at all).
   */
  function showSignOutFailureAlert(result: Extract<SignOutResult, { ok: false }>) {
    // Bound to a local before switching, not `switch (result.reason)` directly: TypeScript's
    // exhaustiveness narrowing to `never` in the `default` branch doesn't propagate through a
    // property-access discriminant the way it does through a plain variable — a real compiler
    // quirk, verified in isolation, not a mistake to "simplify" back to `result.reason`.
    const reason = result.reason;
    switch (reason) {
      case 'globalRevokeFailed':
        Alert.alert(
          Copy.settings.signOutError.globalRevokeFailed.title,
          Copy.settings.signOutError.globalRevokeFailed.body,
          [{ text: Copy.settings.alertDismiss }]
        );
        return;
      case 'stillSignedIn':
        // Unlike globalRevokeFailed, retrying here is real — the local session a retry would
        // authenticate with is still fully intact (see lib/sign-out.ts's header).
        Alert.alert(
          Copy.settings.signOutError.stillSignedIn.title,
          Copy.settings.signOutError.stillSignedIn.body,
          [
            { text: Copy.settings.signOutError.stillSignedIn.cta.secondary, style: 'cancel' },
            {
              text: Copy.settings.signOutError.stillSignedIn.cta.primary,
              onPress: () => {
                void handleSignOut();
              },
            },
          ]
        );
        return;
      default: {
        const exhaustive: never = reason;
        throw new Error(`Unhandled SignOutResult reason: ${String(exhaustive)}`);
      }
    }
  }

  // --- Delete account (#58's real edge function, via lib/delete-account.ts) ------------------

  function confirmDeleteAccount() {
    Alert.alert(
      Copy.settings.deleteAccount.confirm.title,
      Copy.settings.deleteAccount.confirm.body,
      [
        { text: Copy.settings.deleteAccount.confirm.cta.secondary, style: 'cancel' },
        {
          text: Copy.settings.deleteAccount.confirm.cta.primary,
          style: 'destructive',
          onPress: () => {
            void handleDeleteAccount();
          },
        },
      ]
    );
  }

  /** The one place that calls the client, with the one documented fallback for a thrown
   *  `submit()` (no connectivity, unexpected error) — reused by both the initial attempt and the
   *  post-reauth retry below, so the two paths can never drift on how a failure is folded. */
  async function submitDeleteAccount(): Promise<DeleteAccountResult> {
    try {
      return await deleteAccountClient.submit();
    } catch {
      // A thrown client is the same user-facing truth as the generic documented failure: the
      // account was not confirmed deleted. See lib/delete-account.ts's DeleteAccountClient contract.
      return { ok: false, error: { error: 'The account could not be deleted.', code: 'unknown' } };
    }
  }

  async function handleDeleteAccount() {
    if (isBusy) return;
    setIsDeleting(true);

    const result = await submitDeleteAccount();
    await handleDeleteAccountResult(result, false);
  }

  /**
   * Shared by the initial attempt and the post-reauth retry. `isRetryAfterReauth` bounds the
   * reauth detour to exactly ONE loop: if the retry ALSO comes back `reauth_required` (clock
   * skew, or a second concurrent stale request), this falls through to the ordinary failure alert
   * instead of prompting for a credential a second time — see `Copy.settings.reauth.error.stillRequired`.
   */
  async function handleDeleteAccountResult(result: DeleteAccountResult, isRetryAfterReauth: boolean) {
    if (result.ok) {
      // `outcome` distinguishes two DIFFERENT successes (audit finding F2) — both mean the account
      // is gone, but only one of them needs its own copy. See handleDeleteAccountSuccess below.
      handleDeleteAccountSuccess(result.data.outcome);
      // No setState after this: the account is deleted either way, so the local session is about
      // to be cleared and the route guard is about to unmount this screen.
      return;
    }

    if (result.error.code === 'reauth_required' && !isRetryAfterReauth) {
      // Issue #124: the server refused before touching anything — no storage list, no row, no
      // auth-user delete (see supabase/functions/_shared/delete-account.ts's "REAUTHENTICATION
      // FRESHNESS" section). `isDeleting` deliberately stays true here: from the user's
      // standpoint this IS still the same delete request, just gated on one more step.
      beginReauthFlow();
      return;
    }

    if (!isMountedRef.current) return;
    setIsDeleting(false);
    showDeleteAccountFailureAlert(result.error.code);
  }

  /** Decides which credential to ask the user to re-present, based on the CURRENT session's
   *  provider, and kicks off that flow. Called only when the server has just said
   *  `reauth_required` — never speculatively. */
  function beginReauthFlow() {
    const provider = getReauthProvider(session);

    if (provider === 'password') {
      setReauthPassword('');
      setReauthPasswordError(null);
      setPasswordReauthVisible(true);
      return;
    }

    if (provider === 'google') {
      // A native Alert first, matching this screen's own established idiom for every other
      // destructive/step-up confirmation — the browser sheet Google reauth opens shouldn't appear
      // with no warning.
      Alert.alert(Copy.settings.reauth.googlePrompt.title, Copy.settings.reauth.googlePrompt.body, [
        {
          text: Copy.settings.reauth.googlePrompt.cta.secondary,
          style: 'cancel',
          onPress: () => {
            if (isMountedRef.current) setIsDeleting(false);
          },
        },
        {
          text: Copy.settings.reauth.googlePrompt.cta.primary,
          onPress: () => {
            void handleGoogleReauth();
          },
        },
      ]);
      return;
    }

    // No reauthentication flow exists for this provider today — say so plainly rather than
    // silently doing nothing or guessing at a flow that isn't built.
    if (isMountedRef.current) setIsDeleting(false);
    Alert.alert(Copy.settings.reauth.unsupportedProvider.title, Copy.settings.reauth.unsupportedProvider.body, [
      { text: Copy.settings.alertDismiss },
    ]);
  }

  async function handleGoogleReauth() {
    setIsReauthenticating(true);
    const reauth = await reauthenticateWithGoogle();
    if (!isMountedRef.current) return;
    setIsReauthenticating(false);

    if (!reauth.ok) {
      setIsDeleting(false);
      if (reauth.cancelled) return; // the user closed the browser sheet — not an error to report
      Alert.alert(Copy.settings.reauth.error.title, reauth.error ?? Copy.settings.reauth.error.genericBody, [
        { text: Copy.settings.alertDismiss },
      ]);
      return;
    }

    const result = await submitDeleteAccount();
    await handleDeleteAccountResult(result, true);
  }

  async function handlePasswordReauthSubmit() {
    if (!email) {
      setReauthPasswordError(Copy.settings.reauth.error.genericBody);
      return;
    }

    setIsReauthenticating(true);
    setReauthPasswordError(null);
    const reauth = await reauthenticateWithPassword(email, reauthPassword);
    if (!isMountedRef.current) return;
    setIsReauthenticating(false);

    if (!reauth.ok) {
      // Shown INSIDE the modal, not a separate Alert — the user can correct and retry immediately.
      setReauthPasswordError(reauth.error ?? Copy.settings.reauth.error.genericBody);
      return;
    }

    setPasswordReauthVisible(false);
    setReauthPassword('');
    const result = await submitDeleteAccount();
    await handleDeleteAccountResult(result, true);
  }

  function cancelPasswordReauth() {
    setPasswordReauthVisible(false);
    setReauthPassword('');
    setReauthPasswordError(null);
    if (isMountedRef.current) setIsDeleting(false);
  }

  /**
   * `'deleted'` — the ordinary case: sign out immediately and silently, same as before this fix.
   * `'orphansRemaining'` — ALSO a success (the account IS gone, irreversibly), but the user is
   * told so explicitly rather than just vanishing into the sign-in screen, and — deliberately —
   * is NOT offered a retry: there is no account left to retry deleting.
   *
   * Exhaustively switched so a third success outcome, if `delete-account` ever grows one, fails
   * to compile here rather than silently taking the "no news" `deleted` path.
   */
  function handleDeleteAccountSuccess(outcome: DeleteAccountSuccessOutcome) {
    switch (outcome) {
      case 'deleted':
        // We ignore the sign-out result on purpose: a failed *global* revoke is moot when the
        // user it would revoke has just been deleted server-side.
        void signOut();
        return;
      case 'orphansRemaining':
        Alert.alert(
          Copy.settings.deleteAccountState.success.orphansRemaining.title,
          Copy.settings.deleteAccountState.success.orphansRemaining.body,
          [
            {
              text: Copy.settings.alertDismiss,
              onPress: () => {
                void signOut();
              },
            },
          ]
        );
        return;
      default: {
        const exhaustive: never = outcome;
        throw new Error(`Unhandled DeleteAccountSuccessOutcome: ${String(exhaustive)}`);
      }
    }
  }

  /**
   * The three purge-phase codes the server documents plus this client's own 'unknown' bucket
   * (lib/delete-account.ts) all currently render the SAME honest, retryable copy (audit finding
   * F2: a per-code claim about exactly what survived would be true for some codes and false for
   * others). `reauth_required` gets its OWN copy — reached here only when `handleDeleteAccountResult`
   * already tried the reauth-and-retry loop once (issue #124) and the retry was ALSO rejected as
   * stale, which is a materially different, more specific situation than a generic purge failure.
   * Still switched exhaustively, not defaulted, so a sixth code added later forces a conscious
   * decision here instead of silently inheriting one of these.
   */
  function showDeleteAccountFailureAlert(code: DeleteAccountErrorCode) {
    switch (code) {
      case 'purge_failed':
      case 'rows_failed':
      case 'auth_delete_failed':
      case 'unknown':
        Alert.alert(
          Copy.settings.deleteAccountState.error.title,
          Copy.settings.deleteAccountState.error.body,
          [{ text: Copy.settings.alertDismiss }]
        );
        return;
      case 'reauth_required':
        Alert.alert(
          Copy.settings.reauth.error.stillRequired.title,
          Copy.settings.reauth.error.stillRequired.body,
          [{ text: Copy.settings.alertDismiss }]
        );
        return;
      default: {
        const exhaustive: never = code;
        throw new Error(`Unhandled DeleteAccountErrorCode: ${String(exhaustive)}`);
      }
    }
  }

  // --- Consent withdrawal (issue #68) ---------------------------------------------------------

  function confirmWithdrawConsent() {
    Alert.alert(
      Copy.settings.consent.withdraw.confirm.title,
      Copy.settings.consent.withdraw.confirm.body,
      [
        { text: Copy.settings.consent.withdraw.confirm.cta.secondary, style: 'cancel' },
        {
          text: Copy.settings.consent.withdraw.confirm.cta.primary,
          style: 'destructive',
          onPress: () => {
            void handleWithdrawConsent();
          },
        },
      ]
    );
  }

  async function handleWithdrawConsent() {
    if (isBusy) return;
    setIsWithdrawing(true);

    try {
      await withdrawConsent(UPLOAD_HEALTH_CONSENT);
      if (!isMountedRef.current) return;
      setConsent({ status: 'ready', granted: false });
    } catch {
      if (!isMountedRef.current) return;
      // Nothing was recorded, so nothing changed — and we say exactly that rather than optimistically
      // flipping the status to "withdrawn" on a write we can't prove landed.
      Alert.alert(
        Copy.settings.consent.withdraw.error.title,
        Copy.settings.consent.withdraw.error.body,
        [{ text: Copy.settings.alertDismiss }]
      );
    } finally {
      if (isMountedRef.current) setIsWithdrawing(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          {/* A text button, not a chevron glyph: `components/ui/icon-symbol.tsx` has no
              `chevron.left` mapping, and real text scales with Dynamic Type and reads correctly to
              a screen reader without an accessibilityLabel that duplicates it. Matches the text-link
              idiom every other secondary action in this app already uses. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              router.back();
            }}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <Text style={styles.backText}>{Copy.settings.back}</Text>
          </Pressable>
          <Text style={styles.title} accessibilityRole="header">
            {Copy.settings.title}
          </Text>
        </View>

        {/* --- Account ------------------------------------------------------------------- */}
        <View style={styles.section}>
          <Text style={styles.sectionHeading} accessibilityRole="header">
            {Copy.settings.section.account}
          </Text>
          <View style={styles.card}>
            <Text style={styles.rowLabel}>{Copy.settings.account.email.label}</Text>
            <Text style={styles.rowValue}>{email ?? Copy.settings.account.email.unknown}</Text>
          </View>
        </View>

        {/* --- Plan (display-only; the server is the authority) -------------------------- */}
        <View style={styles.section}>
          <Text style={styles.sectionHeading} accessibilityRole="header">
            {Copy.settings.section.plan}
          </Text>
          <View style={styles.card}>
            {plan.status === 'loading' && (
              <View style={styles.inlineRow}>
                <ActivityIndicator color={colors.text.secondary} />
                <Text style={styles.rowValueMuted} accessibilityLiveRegion="polite">
                  {Copy.settings.plan.loading}
                </Text>
              </View>
            )}

            {plan.status === 'ready' && (
              <>
                <Text style={styles.rowValue} accessibilityLiveRegion="polite">
                  {TIER_LABEL[plan.tier]}
                </Text>
                {/* Issue #52. Settings is the only place a user who is NOT out of quota can go
                    looking for their plan options — Home's upgrade CTA only appears once they
                    are exhausted. Without this, a Free user who simply wants to upgrade has
                    nowhere to do it. */}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    router.push('/paywall');
                  }}
                  style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}>
                  <Text style={styles.textActionLabel}>{Copy.settings.plan.cta}</Text>
                </Pressable>
              </>
            )}

            {plan.status === 'error' && (
              <View style={styles.errorBlock}>
                <Text style={styles.errorText} accessibilityLiveRegion="polite">
                  {Copy.settings.plan.error}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={Copy.settings.plan.retryA11yLabel}
                  onPress={() => {
                    void fetchPlan();
                  }}
                  style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}>
                  <Text style={styles.textActionLabel}>{Copy.settings.plan.retry}</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>

        {/* --- Privacy (the #68 restatement + withdrawal + the policy) -------------------- */}
        <View style={styles.section}>
          <Text style={styles.sectionHeading} accessibilityRole="header">
            {Copy.settings.section.privacy}
          </Text>
          <View style={styles.card}>
            <Text style={styles.bodyText}>{Copy.settings.privacy.body}</Text>
            <Text style={styles.bodyTextMuted}>{Copy.settings.privacy.deleteNote}</Text>

            <View style={styles.divider} />

            {consent.status === 'loading' && (
              <View style={styles.inlineRow}>
                <ActivityIndicator color={colors.text.secondary} />
                <Text style={styles.rowValueMuted} accessibilityLiveRegion="polite">
                  {Copy.settings.consent.status.loading}
                </Text>
              </View>
            )}

            {consent.status === 'error' && (
              <View style={styles.errorBlock}>
                <Text style={styles.errorText} accessibilityLiveRegion="polite">
                  {Copy.settings.consent.status.error}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={Copy.settings.consent.status.retryA11yLabel}
                  onPress={() => {
                    void fetchConsent();
                  }}
                  style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}>
                  <Text style={styles.textActionLabel}>{Copy.settings.consent.status.retry}</Text>
                </Pressable>
              </View>
            )}

            {consent.status === 'ready' && (
              <>
                <Text style={styles.bodyText} accessibilityLiveRegion="polite">
                  {consent.granted
                    ? Copy.settings.consent.status.granted
                    : Copy.settings.consent.status.withdrawn}
                </Text>
                {/* Only offered when there is a live consent to withdraw. Art. 7(3) requires
                    withdrawal to be as easy as giving it — one tap, right here, no support email. */}
                {consent.granted && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={Copy.settings.consent.withdraw.cta}
                    accessibilityState={{ disabled: isBusy, busy: isWithdrawing }}
                    disabled={isBusy}
                    onPress={confirmWithdrawConsent}
                    style={({ pressed }) => [
                      styles.textAction,
                      isBusy && styles.disabled,
                      pressed && !isBusy && styles.pressed,
                    ]}>
                    {isWithdrawing ? (
                      <ActivityIndicator color={colors.text.primary} />
                    ) : (
                      <Text style={styles.textActionLabel}>
                        {Copy.settings.consent.withdraw.cta}
                      </Text>
                    )}
                  </Pressable>
                )}
              </>
            )}

            <View style={styles.divider} />

            {/* The policy is drafted but NOT published (docs/privacy-policy.md's DO NOT PUBLISH
                guard: the data-controller identity is unresolved). There is no URL to link to and
                inventing one is not an option, so this renders as an honest pending state — not a
                dead link, and not the draft itself, which would show users placeholder legal
                identity and rights promises they could not exercise. The certified disclosure is
                the summary directly above. */}
            <Text style={styles.rowLabel}>{Copy.settings.privacyPolicy.label}</Text>
            <Text style={styles.bodyTextMuted}>{Copy.settings.privacyPolicy.pending}</Text>
          </View>
        </View>

        {/* --- Account actions ----------------------------------------------------------- */}
        <View style={styles.section}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Copy.settings.signOut.cta}
            accessibilityState={{ disabled: isBusy, busy: isSigningOut }}
            disabled={isBusy}
            onPress={confirmSignOut}
            style={({ pressed }) => [
              styles.actionRow,
              isBusy && styles.disabled,
              pressed && !isBusy && styles.pressed,
            ]}>
            {isSigningOut ? (
              <ActivityIndicator color={colors.text.primary} />
            ) : (
              <Text style={styles.actionRowLabel}>{Copy.settings.signOut.cta}</Text>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Copy.settings.deleteAccount.cta}
            accessibilityState={{ disabled: isBusy, busy: isDeleting }}
            disabled={isBusy}
            onPress={confirmDeleteAccount}
            style={({ pressed }) => [
              styles.actionRow,
              isBusy && styles.disabled,
              pressed && !isBusy && styles.pressed,
            ]}>
            {isDeleting ? (
              <View style={styles.inlineRow}>
                <ActivityIndicator color={Semantic.error[scheme]} />
                <Text style={styles.destructiveLabel} accessibilityLiveRegion="polite">
                  {Copy.settings.deleteAccountState.pending}
                </Text>
              </View>
            ) : (
              <Text style={styles.destructiveLabel}>{Copy.settings.deleteAccount.cta}</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>

      {/* Issue #124's step-up reauthentication for password accounts. A full-opaque-screen Modal
          rather than a translucent-backdrop sheet — this repo has no scrim/overlay color token
          (constants/theme.ts), and CLAUDE.md's "theme tokens only" rule means one isn't invented
          here; a full page using the same background/surface tokens as the rest of this screen
          reads as a natural continuation of it instead. `onRequestClose` (the Android back button)
          is wired to the same cancel path as the Cancel button, not a silent dismiss. */}
      <Modal
        visible={passwordReauthVisible}
        animationType="slide"
        onRequestClose={cancelPasswordReauth}>
        <SafeAreaView style={styles.reauthSafeArea}>
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.reauthContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.title} accessibilityRole="header">
                {Copy.settings.reauth.passwordPrompt.title}
              </Text>
              <Text style={styles.bodyText}>{Copy.settings.reauth.passwordPrompt.body}</Text>
              <TextInput
                style={styles.input}
                placeholder={Copy.settings.reauth.passwordPrompt.placeholder}
                accessibilityLabel={Copy.settings.reauth.passwordPrompt.placeholder}
                placeholderTextColor={colors.text.secondary}
                value={reauthPassword}
                onChangeText={setReauthPassword}
                secureTextEntry
                autoCapitalize="none"
                textContentType="password"
                editable={!isReauthenticating}
                autoFocus
              />
              {reauthPasswordError !== null && (
                <Text style={styles.errorText} accessibilityLiveRegion="polite">
                  {reauthPasswordError}
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={Copy.settings.reauth.passwordPrompt.cta.primary}
                accessibilityState={{ disabled: isReauthenticating, busy: isReauthenticating }}
                disabled={isReauthenticating}
                onPress={() => {
                  void handlePasswordReauthSubmit();
                }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  isReauthenticating && styles.disabled,
                  pressed && !isReauthenticating && styles.pressed,
                ]}>
                {isReauthenticating ? (
                  <ActivityIndicator color={Accent.onAccent} />
                ) : (
                  <Text style={styles.primaryButtonText}>{Copy.settings.reauth.passwordPrompt.cta.primary}</Text>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={isReauthenticating}
                onPress={cancelPasswordReauth}
                style={({ pressed }) => [
                  styles.textAction,
                  isReauthenticating && styles.disabled,
                  pressed && !isReauthenticating && styles.pressed,
                ]}>
                <Text style={styles.textActionLabel}>{Copy.settings.reauth.passwordPrompt.cta.secondary}</Text>
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors, scheme: ColorScheme) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      // flexGrow, not flex — the same Dynamic Type rule every other screen here follows: reflow
      // and scroll at the largest text sizes, never clip (design brief §7).
      flexGrow: 1,
      padding: Spacing.xl,
      gap: Spacing.xl,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    backButton: {
      minHeight: HitTarget.min,
      minWidth: HitTarget.min,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backText: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
    },
    title: {
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.xl,
      color: colors.text.primary,
    },
    section: {
      gap: Spacing.md,
    },
    sectionHeading: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.xs,
      color: colors.text.secondary,
      textTransform: 'uppercase',
    },
    card: {
      backgroundColor: colors.surface.base,
      borderRadius: Radius.card,
      padding: Spacing.lg,
      gap: Spacing.md,
    },
    rowLabel: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.xs,
      color: colors.text.secondary,
    },
    rowValue: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.md,
      color: colors.text.primary,
    },
    rowValueMuted: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
    },
    bodyText: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      color: colors.text.primary,
    },
    bodyTextMuted: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.xs,
      color: colors.text.secondary,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.hairline,
    },
    inlineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    errorBlock: {
      gap: Spacing.xs,
      alignItems: 'flex-start',
    },
    errorText: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      color: Semantic.error[scheme],
    },
    /** A text-only action (Retry, Withdraw consent). The 44pt floor is non-negotiable (brief §7) —
     *  padding alone would leave these well under it. */
    textAction: {
      minHeight: HitTarget.min,
      justifyContent: 'center',
    },
    textActionLabel: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      color: colors.text.primary,
      textDecorationLine: 'underline',
    },
    actionRow: {
      backgroundColor: colors.surface.base,
      borderRadius: Radius.card,
      minHeight: HitTarget.min,
      paddingVertical: Spacing.lg,
      paddingHorizontal: Spacing.lg,
      justifyContent: 'center',
    },
    actionRowLabel: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.md,
      color: colors.text.primary,
    },
    // Semantic.error, not Score.low — a destructive action is a system state, not a score band
    // (see the Semantic role's note in constants/theme.ts).
    destructiveLabel: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.md,
      color: Semantic.error[scheme],
    },
    disabled: {
      opacity: Opacity.disabled,
    },
    pressed: {
      opacity: Opacity.pressed,
    },
    // --- issue #124: the step-up password reauthentication Modal --------------------------------
    flex: {
      flex: 1,
    },
    reauthSafeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    reauthContent: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: Spacing.xl,
      gap: Spacing.lg,
    },
    // Mirrors app/(auth)/sign-in.tsx's own `input` style (not imported/shared — that screen is
    // outside this fix's file lane) so the password field this modal reuses for reauthentication
    // looks and behaves identically to the one at sign-in.
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
  });
}
