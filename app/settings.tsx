/**
 * Screen 11 — Settings (issue #53; also closes #27), re-cut to V23-12 (2026-09-14): the
 * captain-approved page's "Account / Plan / Privacy" artboard and its "Delete account · confirm"
 * artboard. Back and "SETTINGS" on the top row; three labelled sections, each a card of 56 pt
 * rows ruled apart in `line` (label left in `ink`, value right in `ink2` or an uppercase action);
 * and the ruled `danger` "Delete account" control pushed to the foot of the page.
 *
 * ROUTE PLACEMENT: a top-level pushed route (`/settings`), NOT a tab. `docs/architecture.md`'s
 * route tree already made this call — it lists `paywall, settings` at root, alongside
 * `capture/` / `analyzing` / `result/[id]`, while nesting `(tabs)/history` as a tab. Product-wise
 * that is right: the tab bar is for co-equal primary surfaces (Home, History), and Settings is a
 * rare destination you push into and back out of.
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
 *   - Email / plan — real reads. The plan is DISPLAY-ONLY: the whole `QuotaStatus` the server
 *     returns is held so the Plan card can show the tier, the quota caption and the renewal date
 *     the page draws, but nothing here computes any of it. CLAUDE.md — "the client may display
 *     tier/quota state but is never the authority for it."
 *   - Delete account — a REAL `supabase.functions.invoke('delete-account')` call (fixed 2026-07-13,
 *     finding F1). `delete-account`'s edge function (#58/#121) has been deployed to the live
 *     project since 2026-07-26 — see `lib/delete-account.ts`'s header — so this screen reaches it
 *     end to end. As of issue #124, the server can also reject the call with
 *     `code: 'reauth_required'` — a valid session is no longer enough on its own for this one
 *     destructive action. This screen handles that by prompting the user to re-present their
 *     credential (a password modal, or a re-run of Google sign-in) and retrying ONCE — see
 *     `beginReauthFlow` below.
 *
 * CONFIRMATIONS AND NOTICES ARE ONE `<ConfirmDialog>`, driven by the `dialog` state union below —
 * the page's own pattern ("re-auth step-up and consent-withdraw dialogs not drawn; same dialog
 * pattern as the delete confirm"), replacing the native `Alert` every one of them used to be.
 * `tone="danger"` is spent only on the two destructive confirms (delete account, withdraw
 * consent). ONE CONSEQUENCE TO KNOW: a dialog is local state, so it cannot outlive this screen
 * the way a native alert could. The one path that relied on that — `globalRevokeFailed`, where
 * auth-js has already cleared the local session and the route guard is unmounting the screen as
 * the result lands — now sets state on a component that is going away, which React treats as a
 * no-op; the notice is not shown on that path.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SquareButton } from '@/components/ui/square-button';
import { SquareCard } from '@/components/ui/square-card';
import { SquareIconButton } from '@/components/ui/square-icon-button';
import { TextField } from '@/components/ui/text-field';
import { TopBar } from '@/components/ui/top-bar';
import { ArrowRightIcon, BackIcon } from '@/components/ui/v23-icons';
import { Copy } from '@/constants/copy';
import { PRIVACY_POLICY_URL } from '@/constants/links';
import { Ink, Layout, Space, Type } from '@/constants/v23-theme';
import {
  FUTURE_UPLOADS_ATTESTATION_CONSENT,
  grantConsent,
  readConsentState,
  UPLOAD_HEALTH_CONSENT,
  withdrawConsent,
  type ConsentState as ConsentRecordState,
} from '@/lib/consent';
import {
  deleteAccountClient,
  getReauthProvider,
  reauthenticateWithGoogle,
  reauthenticateWithPassword,
  type DeleteAccountErrorCode,
  type DeleteAccountResult,
  type DeleteAccountSuccessOutcome,
} from '@/lib/delete-account';
import { describeQuota } from '@/lib/quota';
import { useSession } from '@/lib/session-provider';
import { signOut, type SignOutResult } from '@/lib/sign-out';
import { formatRenewalDate, getQuotaStatus, type QuotaStatus, type SubscriptionTier } from '@/lib/subscription';
import { useAnnounce } from '@/lib/use-announce';

/** Mirrors Home's own quota states. Loading and error are real states, not decoration: a tier we
 *  failed to read must never silently render as "Free" — that would be the client quietly
 *  inventing a plan, which is exactly what CLAUDE.md forbids it from being the authority on. The
 *  ready state keeps the WHOLE server reading: the page's Plan card draws the tier, the quota
 *  caption and the renewal date, and all three come off this one object. */
type PlanState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; quota: QuotaStatus };

/** `readConsentState` THROWS on any query failure and deliberately does not guess (lib/consent.ts
 *  fails closed). So "we don't know" is a first-class state here, distinct from "withdrawn" — and
 *  so is `none`: an account with no row at all (it predates the sign-up consent, or its grant was
 *  dropped) is not one that withdrew, must not read as if it had, and is healed silently by
 *  capture / the age-band gate rather than asked here. */
type ConsentState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; state: ConsentRecordState };

/**
 * Every dialog this screen can have up, one at a time. The confirms and the Google prompt carry no
 * payload — their copy is fixed; a `notice` carries its own title/body (the delete and reauth
 * failures have several) and an optional action to run on dismiss (the orphans-remaining success
 * signs out on OK). `null` is "nothing up".
 */
type Dialog =
  | { kind: 'signOutConfirm' }
  | { kind: 'stillSignedIn' }
  | { kind: 'deleteConfirm' }
  | { kind: 'googleReauth' }
  | { kind: 'withdrawConfirm' }
  | { kind: 'notice'; title: string; body: string; onDismiss?: () => void }
  | null;

const TIER_LABEL: Record<SubscriptionTier, string> = {
  free: Copy.tier.free,
  pro: Copy.tier.pro,
  elite: Copy.tier.elite,
};

const PRESSED_OPACITY = 0.6;
const DISABLED_OPACITY = 0.4;

// --- The page's row grammar ---------------------------------------------------------------------

/** A 56 pt settings row: a label on the left in `ink`, and whatever the caller puts on the right —
 *  a `<RowValue>`, a `<RowAction>`, or a spinner. `label` may be a node for the one row whose left
 *  side is a spinner (the plan read in flight). */
function Row({ label, children, testID }: { label: ReactNode; children?: ReactNode; testID?: string }) {
  return (
    <View style={styles.row} testID={testID}>
      {typeof label === 'string' ? <Text style={styles.rowLabel}>{label}</Text> : label}
      {children}
    </View>
  );
}

/** A row's right-hand value: `body` in `ink2`, right-aligned, shrinking before the label does. */
function RowValue({ children, live, testID }: { children: string; live?: boolean; testID?: string }) {
  return (
    <Text style={styles.rowValue} accessibilityLiveRegion={live ? 'polite' : undefined} testID={testID}>
      {children}
    </Text>
  );
}

type RowActionProps = {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  busyTestID?: string;
};

/** A row's right-hand action: the page's uppercase `label` in `ink`, a 44 pt target, a plain
 *  opacity dip on press. `busy` swaps the word for a spinner at the same height. */
function RowAction({ label, onPress, accessibilityLabel, disabled = false, busy = false, busyTestID }: RowActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.rowAction, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      {busy ? <ActivityIndicator color={Ink.ink} testID={busyTestID} /> : <Text style={styles.rowActionLabel}>{label}</Text>}
    </Pressable>
  );
}

/** The 1 px `line` rule between rows. Inside the card's 16 pt side padding, so it never meets the
 *  card's own border — exactly as the page draws it. */
function Rule() {
  return <View style={styles.rule} />;
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const userId = session?.user.id;
  const email = session?.user.email;

  const [plan, setPlan] = useState<PlanState>({ status: 'loading' });
  const [consent, setConsent] = useState<ConsentState>({ status: 'loading' });
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [isRestoringConsent, setIsRestoringConsent] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  // Issue #124's step-up reauthentication flow. `passwordReauthVisible` gates the password modal
  // (email/password accounts only — Google's reauth is a dialog + browser flow, no modal needed).
  // `isReauthenticating` is scoped to the modal's own Confirm-button busy state; the outer
  // `isDeleting` stays true through the whole reauth detour so the delete control keeps reading
  // "Deleting account…" and the rest of the screen stays disabled via `isBusy`.
  const [passwordReauthVisible, setPasswordReauthVisible] = useState(false);
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthPasswordError, setReauthPasswordError] = useState<string | null>(null);
  const [isReauthenticating, setIsReauthenticating] = useState(false);

  // Issue #11: the dynamic status Texts below carry `accessibilityLiveRegion="polite"`, which is
  // Android-only — these are the iOS complements, same pattern as app/(tabs)/index.tsx. One
  // derived message per section, matching whichever caption is actually on screen for that section.
  useAnnounce(
    plan.status === 'loading'
      ? Copy.settings.plan.loading
      : plan.status === 'error'
        ? Copy.settings.plan.error
        : plan.status === 'ready'
          ? TIER_LABEL[plan.quota.tier]
          : null
  );
  useAnnounce(
    consent.status === 'loading'
      ? Copy.settings.consent.status.loading
      : consent.status === 'error'
        ? Copy.settings.consent.status.error
        : consent.status === 'ready'
          ? Copy.settings.consent.status[consent.state]
          : null
  );
  useAnnounce(isDeleting ? Copy.settings.deleteAccountState.pending : null);
  useAnnounce(reauthPasswordError);

  // This screen unmounts the instant `session` flips to null (the route guard), which happens
  // mid-flight for sign-out and for a successful delete. Any `setState` after that point is a
  // no-op at best and a warning at worst, so every async handler checks this first — the same
  // guard `components/age-band-gate.tsx` uses, for the same reason.
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

    // Read the same server-authoritative status Home and Paywall use, rather than deriving tier
    // from `subscriptions` locally.
    const result = await getQuotaStatus();
    if (!isMountedRef.current) return;
    setPlan(result.ok ? { status: 'ready', quota: result.data } : { status: 'error' });
  }, [userId]);

  const fetchConsent = useCallback(async () => {
    setConsent({ status: 'loading' });
    try {
      const state = await readConsentState(UPLOAD_HEALTH_CONSENT);
      if (!isMountedRef.current) return;
      setConsent({ status: 'ready', state });
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

  const isBusy = isSigningOut || isDeleting || isWithdrawing || isRestoringConsent;

  function closeDialog() {
    setDialog(null);
  }

  function showNotice(title: string, body: string, onDismiss?: () => void) {
    setDialog({ kind: 'notice', title, body, onDismiss });
  }

  // --- Sign out (issue #27) ------------------------------------------------------------------

  function confirmSignOut() {
    setDialog({ kind: 'signOutConfirm' });
  }

  async function handleSignOut() {
    if (isBusy) return;
    setIsSigningOut(true);

    // Never rejects (lib/sign-out.ts), so no try/catch here by design.
    const result = await signOut();

    // Deliberately NOT guarded by isMountedRef, as before: on `stillSignedIn` the screen is NOT
    // unmounting (the session is untouched), so the dialog opens normally. On `globalRevokeFailed`
    // the session has flipped to null and the route guard is unmounting this screen right now —
    // see this file's header for what that means for the notice.
    if (!result.ok) {
      showSignOutFailureDialog(result);
    }

    if (isMountedRef.current) setIsSigningOut(false);
  }

  /**
   * Exhaustively switches on `SignOutResult`'s failure `reason` so that if `lib/sign-out.ts` ever
   * grows a fourth state, this fails to COMPILE rather than silently falling through to the wrong
   * copy — the exact class of bug finding F3 caught here (a real third state the original two-way
   * model couldn't represent at all).
   */
  function showSignOutFailureDialog(result: Extract<SignOutResult, { ok: false }>) {
    // Bound to a local before switching, not `switch (result.reason)` directly: TypeScript's
    // exhaustiveness narrowing to `never` in the `default` branch doesn't propagate through a
    // property-access discriminant the way it does through a plain variable — a real compiler
    // quirk, verified in isolation, not a mistake to "simplify" back to `result.reason`.
    const reason = result.reason;
    switch (reason) {
      case 'globalRevokeFailed':
        showNotice(
          Copy.settings.signOutError.globalRevokeFailed.title,
          Copy.settings.signOutError.globalRevokeFailed.body
        );
        return;
      case 'stillSignedIn':
        // Unlike globalRevokeFailed, retrying here is real — the local session a retry would
        // authenticate with is still fully intact (see lib/sign-out.ts's header).
        setDialog({ kind: 'stillSignedIn' });
        return;
      default: {
        const exhaustive: never = reason;
        throw new Error(`Unhandled SignOutResult reason: ${String(exhaustive)}`);
      }
    }
  }

  // --- Delete account (#58's real edge function, via lib/delete-account.ts) ------------------

  function confirmDeleteAccount() {
    setDialog({ kind: 'deleteConfirm' });
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
   * skew, or a second concurrent stale request), this falls through to the ordinary failure notice
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
    showDeleteAccountFailureDialog(result.error.code);
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
      // A dialog first, matching this screen's idiom for every other destructive/step-up
      // confirmation — the browser sheet Google reauth opens shouldn't appear with no warning.
      setDialog({ kind: 'googleReauth' });
      return;
    }

    // No reauthentication flow exists for this provider today — say so plainly rather than
    // silently doing nothing or guessing at a flow that isn't built.
    if (isMountedRef.current) setIsDeleting(false);
    showNotice(Copy.settings.reauth.unsupportedProvider.title, Copy.settings.reauth.unsupportedProvider.body);
  }

  async function handleGoogleReauth() {
    setIsReauthenticating(true);
    const reauth = await reauthenticateWithGoogle();
    if (!isMountedRef.current) return;
    setIsReauthenticating(false);

    if (!reauth.ok) {
      setIsDeleting(false);
      if (reauth.cancelled) return; // the user closed the browser sheet — not an error to report
      showNotice(Copy.settings.reauth.error.title, reauth.error ?? Copy.settings.reauth.error.genericBody);
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
      // Shown INSIDE the modal, under the field — the user can correct and retry immediately.
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
        showNotice(
          Copy.settings.deleteAccountState.success.orphansRemaining.title,
          Copy.settings.deleteAccountState.success.orphansRemaining.body,
          () => {
            void signOut();
          }
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
  function showDeleteAccountFailureDialog(code: DeleteAccountErrorCode) {
    switch (code) {
      case 'purge_failed':
      case 'rows_failed':
      case 'auth_delete_failed':
      case 'unknown':
        showNotice(Copy.settings.deleteAccountState.error.title, Copy.settings.deleteAccountState.error.body);
        return;
      case 'reauth_required':
        showNotice(Copy.settings.reauth.error.stillRequired.title, Copy.settings.reauth.error.stillRequired.body);
        return;
      default: {
        const exhaustive: never = code;
        throw new Error(`Unhandled DeleteAccountErrorCode: ${String(exhaustive)}`);
      }
    }
  }

  // --- The published privacy policy (issue #202) ---------------------------------------------

  function openPrivacyPolicy() {
    // A rejected `openURL` (no browser can take an https URL) is not worth a dialog: the
    // certified disclosure at the top of the Privacy card is already on screen.
    Linking.openURL(PRIVACY_POLICY_URL).catch(() => undefined);
  }

  // --- Consent withdrawal (issue #68) ---------------------------------------------------------

  function confirmWithdrawConsent() {
    setDialog({ kind: 'withdrawConfirm' });
  }

  async function handleWithdrawConsent() {
    if (isBusy) return;
    setIsWithdrawing(true);

    try {
      // Symmetric with the sign-up grant and `handleRestoreConsent`: one tick granted both keys,
      // so one withdrawal revokes both. Withdrawals are append-only, so a retry is always safe.
      await Promise.all([
        withdrawConsent(UPLOAD_HEALTH_CONSENT),
        withdrawConsent(FUTURE_UPLOADS_ATTESTATION_CONSENT),
      ]);
      if (!isMountedRef.current) return;
      setConsent({ status: 'ready', state: 'withdrawn' });
    } catch {
      if (!isMountedRef.current) return;
      // Two writes may half-land, so the copy asks for a retry rather than flipping the status
      // to "withdrawn" on writes we cannot prove landed.
      showNotice(Copy.settings.consent.withdraw.error.title, Copy.settings.consent.withdraw.error.body);
    } finally {
      if (isMountedRef.current) setIsWithdrawing(false);
    }
  }

  // Giving consent again after a withdrawal. The only place a withdrawn key is ever re-granted:
  // capture deliberately refuses to repair a `withdrawn` state (app/capture/index.tsx) and sends
  // the user here, where the card's summary restates the disclosure being consented to.
  async function handleRestoreConsent() {
    if (isBusy) return;
    setIsRestoringConsent(true);

    try {
      await Promise.all([
        grantConsent(UPLOAD_HEALTH_CONSENT),
        grantConsent(FUTURE_UPLOADS_ATTESTATION_CONSENT),
      ]);
      if (!isMountedRef.current) return;
      setConsent({ status: 'ready', state: 'granted' });
    } catch {
      if (!isMountedRef.current) return;
      showNotice(Copy.settings.consent.restore.error.title, Copy.settings.consent.restore.error.body);
    } finally {
      if (isMountedRef.current) setIsRestoringConsent(false);
    }
  }

  // --- The one dialog --------------------------------------------------------------------------

  /** Every `dialog` kind resolved to the one `<ConfirmDialog>`'s props. Each primary closes the
   *  dialog and then runs the same handler the native alert's button used to, in that order. */
  function renderDialog() {
    if (dialog === null) return null;
    switch (dialog.kind) {
      case 'signOutConfirm':
        return (
          <ConfirmDialog
            visible
            title={Copy.settings.signOut.confirm.title}
            body={Copy.settings.signOut.confirm.body}
            primary={{
              label: Copy.settings.signOut.confirm.cta.primary,
              onPress: () => {
                closeDialog();
                void handleSignOut();
              },
            }}
            secondary={{ label: Copy.settings.signOut.confirm.cta.secondary, onPress: closeDialog }}
            testID="settings-dialog"
          />
        );
      case 'stillSignedIn':
        return (
          <ConfirmDialog
            visible
            title={Copy.settings.signOutError.stillSignedIn.title}
            body={Copy.settings.signOutError.stillSignedIn.body}
            primary={{
              label: Copy.settings.signOutError.stillSignedIn.cta.primary,
              onPress: () => {
                closeDialog();
                void handleSignOut();
              },
            }}
            secondary={{ label: Copy.settings.signOutError.stillSignedIn.cta.secondary, onPress: closeDialog }}
            testID="settings-dialog"
          />
        );
      case 'deleteConfirm':
        return (
          <ConfirmDialog
            visible
            tone="danger"
            title={Copy.settings.deleteAccount.confirm.title}
            body={Copy.settings.deleteAccount.confirm.body}
            primary={{
              label: Copy.settings.deleteAccount.confirm.cta.primary,
              onPress: () => {
                closeDialog();
                void handleDeleteAccount();
              },
            }}
            secondary={{ label: Copy.settings.deleteAccount.confirm.cta.secondary, onPress: closeDialog }}
            testID="settings-dialog"
          />
        );
      case 'googleReauth':
        return (
          <ConfirmDialog
            visible
            title={Copy.settings.reauth.googlePrompt.title}
            body={Copy.settings.reauth.googlePrompt.body}
            primary={{
              label: Copy.settings.reauth.googlePrompt.cta.primary,
              onPress: () => {
                closeDialog();
                void handleGoogleReauth();
              },
            }}
            secondary={{
              label: Copy.settings.reauth.googlePrompt.cta.secondary,
              onPress: () => {
                closeDialog();
                if (isMountedRef.current) setIsDeleting(false);
              },
            }}
            testID="settings-dialog"
          />
        );
      case 'withdrawConfirm':
        return (
          <ConfirmDialog
            visible
            tone="danger"
            title={Copy.settings.consent.withdraw.confirm.title}
            body={Copy.settings.consent.withdraw.confirm.body}
            primary={{
              label: Copy.settings.consent.withdraw.confirm.cta.primary,
              onPress: () => {
                closeDialog();
                void handleWithdrawConsent();
              },
            }}
            secondary={{ label: Copy.settings.consent.withdraw.confirm.cta.secondary, onPress: closeDialog }}
            testID="settings-dialog"
          />
        );
      case 'notice': {
        const { title, body, onDismiss } = dialog;
        return (
          <ConfirmDialog
            visible
            title={title}
            body={body}
            primary={{
              label: Copy.settings.alertDismiss,
              onPress: () => {
                closeDialog();
                onDismiss?.();
              },
            }}
            testID="settings-dialog"
          />
        );
      }
      default: {
        const exhaustive: never = dialog;
        throw new Error(`Unhandled dialog: ${String(exhaustive)}`);
      }
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top, Layout.canvas.safeTop),
            paddingBottom: Math.max(insets.bottom, Layout.canvas.safeBottom),
          },
        ]}>
        <TopBar
          align="leading"
          title={Copy.settings.title}
          leading={
            <SquareIconButton
              accessibilityLabel={Copy.settings.back}
              bleed="left"
              onPress={() => {
                router.back();
              }}>
              <BackIcon />
            </SquareIconButton>
          }
        />

        {/* --- Account ------------------------------------------------------------------- */}
        <View style={styles.section}>
          <Text style={styles.sectionHeading} accessibilityRole="header">
            {Copy.settings.section.account}
          </Text>
          <SquareCard padding={0} style={styles.card}>
            <Row label={Copy.settings.account.email.label}>
              <RowValue>{email ?? Copy.settings.account.email.unknown}</RowValue>
            </Row>
            <Rule />
            {/* The page shows the word twice: as the row's label and as its action. */}
            <Row label={Copy.settings.signOut.cta}>
              <RowAction
                label={Copy.settings.signOut.cta}
                disabled={isBusy}
                busy={isSigningOut}
                busyTestID="settings-sign-out-busy"
                onPress={confirmSignOut}
              />
            </Row>
          </SquareCard>
        </View>

        {/* --- Plan (display-only; the server is the authority) -------------------------- */}
        <View style={styles.section}>
          <Text style={styles.sectionHeading} accessibilityRole="header">
            {Copy.settings.section.plan}
          </Text>
          <SquareCard padding={0} style={styles.card}>
            {plan.status === 'loading' && (
              <Row label={<ActivityIndicator color={Ink.ink2} testID="settings-plan-loading" />}>
                <RowValue live>{Copy.settings.plan.loading}</RowValue>
              </Row>
            )}

            {plan.status === 'ready' && (
              <>
                {/* The tier and the same quota caption Home draws, off the same reading. */}
                <Row label={TIER_LABEL[plan.quota.tier]}>
                  <RowValue live>{describeQuota(plan.quota).primary}</RowValue>
                </Row>
                {/* Only a paid tier renews. Free is lifetime (`periodEnd` null) — the page's own
                    note: no downgrade offered, and a lifetime plan has no renewal — so the row is
                    absent rather than blank. */}
                {plan.quota.periodEnd !== null && (
                  <>
                    <Rule />
                    <Row label={Copy.settings.plan.renews}>
                      <RowValue>{formatRenewalDate(plan.quota.periodEnd)}</RowValue>
                    </Row>
                  </>
                )}
                <Rule />
                {/* Issue #52. Settings is the only place a user who is NOT out of quota can go
                    looking for their plan options — Home's upgrade CTA only appears once they
                    are exhausted. Without this, a Free user who simply wants to upgrade has
                    nowhere to do it. */}
                <Row label={Copy.settings.plan.cta}>
                  <RowAction
                    label={Copy.settings.plan.cta}
                    onPress={() => {
                      router.push('/paywall');
                    }}
                  />
                </Row>
              </>
            )}

            {plan.status === 'error' && (
              <Row
                label={
                  <Text style={styles.rowLabel} accessibilityLiveRegion="polite">
                    {Copy.settings.plan.error}
                  </Text>
                }>
                <RowAction
                  label={Copy.settings.plan.retry}
                  accessibilityLabel={Copy.settings.plan.retryA11yLabel}
                  onPress={() => {
                    void fetchPlan();
                  }}
                />
              </Row>
            )}
          </SquareCard>
        </View>

        {/* --- Privacy (the #68 restatement + withdrawal + the policy) -------------------- */}
        <View style={styles.section}>
          <Text style={styles.sectionHeading} accessibilityRole="header">
            {Copy.settings.section.privacy}
          </Text>
          <SquareCard padding={0} style={styles.card}>
            <Text style={styles.paragraph}>{Copy.settings.privacy.summary}</Text>
            <Rule />

            <Row label={Copy.settings.consent.label}>
              {consent.status === 'loading' && (
                <View style={styles.rowValueGroup}>
                  <ActivityIndicator color={Ink.ink2} testID="settings-consent-loading" />
                  <RowValue live>{Copy.settings.consent.status.loading}</RowValue>
                </View>
              )}

              {consent.status === 'error' && (
                <View style={styles.rowValueStack}>
                  <RowValue live>{Copy.settings.consent.status.error}</RowValue>
                  <RowAction
                    label={Copy.settings.consent.status.retry}
                    accessibilityLabel={Copy.settings.consent.status.retryA11yLabel}
                    onPress={() => {
                      void fetchConsent();
                    }}
                  />
                </View>
              )}

              {/* Only offered when there is a live consent to withdraw. Art. 7(3) requires
                  withdrawal to be as easy as giving it — one tap, right here, no support email. */}
              {consent.status === 'ready' && consent.state === 'granted' && (
                <RowAction
                  label={Copy.settings.consent.withdraw.cta}
                  disabled={isBusy}
                  busy={isWithdrawing}
                  busyTestID="settings-withdraw-busy"
                  onPress={confirmWithdrawConsent}
                />
              )}
              {consent.status === 'ready' && consent.state === 'none' && (
                <RowValue live>{Copy.settings.consent.status.none}</RowValue>
              )}
              {consent.status === 'ready' && consent.state === 'withdrawn' && (
                <View style={styles.rowValueStack}>
                  <RowValue live>{Copy.settings.consent.status.withdrawn}</RowValue>
                  <RowAction
                    label={Copy.settings.consent.restore.cta}
                    disabled={isBusy}
                    busy={isRestoringConsent}
                    busyTestID="settings-restore-consent-busy"
                    onPress={() => {
                      void handleRestoreConsent();
                    }}
                  />
                </View>
              )}
            </Row>

            <Rule />
            {/* Not on the page, but a live disclosure: a row that opens the published policy
                (`PRIVACY_POLICY_URL`; issue #202, captain-certified 2026-09-19). The whole row is
                the link target — the page's row grammar has no second string to spend on a
                right-hand action, so the arrow is the affordance. `Linking.openURL` hands the
                URL to the system browser; a rejection (no handler) is swallowed because the
                certified disclosure at the top of this card already stands on its own. */}
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={Copy.settings.privacyPolicy.label}
              onPress={openPrivacyPolicy}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              testID="settings-privacy-policy">
              <Text style={styles.rowLabel}>{Copy.settings.privacyPolicy.label}</Text>
              <ArrowRightIcon color={Ink.ink2} />
            </Pressable>
          </SquareCard>
        </View>

        {/* --- Delete account: the page's ruled `danger` control, pushed to the foot ------- */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={Copy.settings.deleteAccount.cta}
          accessibilityState={{ disabled: isBusy, busy: isDeleting }}
          disabled={isBusy}
          onPress={confirmDeleteAccount}
          style={({ pressed }) => [styles.deleteButton, isBusy && styles.disabled, pressed && !isBusy && styles.pressed]}>
          {isDeleting ? (
            <View style={styles.deleteBusy}>
              <ActivityIndicator color={Ink.danger} testID="settings-delete-busy" />
              <Text style={styles.deleteLabel} accessibilityLiveRegion="polite">
                {Copy.settings.deleteAccountState.pending}
              </Text>
            </View>
          ) : (
            <Text style={styles.deleteLabel}>{Copy.settings.deleteAccount.cta}</Text>
          )}
        </Pressable>
      </ScrollView>

      {renderDialog()}

      {/* Issue #124's step-up reauthentication for password accounts. Not drawn on the page: a
          full `Ink.bg` Modal in the same column as the screen, the sheet's own fade. `onRequestClose`
          (the Android back button) is wired to the same cancel path as the Cancel button, not a
          silent dismiss. */}
      <Modal visible={passwordReauthVisible} animationType="fade" onRequestClose={cancelPasswordReauth}>
        <KeyboardAvoidingView style={styles.reauthFill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={[
              styles.reauthContent,
              {
                paddingTop: Math.max(insets.top, Layout.canvas.safeTop),
                paddingBottom: Math.max(insets.bottom, Layout.canvas.safeBottom),
              },
            ]}
            keyboardShouldPersistTaps="handled">
            <Text style={styles.reauthTitle} accessibilityRole="header">
              {Copy.settings.reauth.passwordPrompt.title}
            </Text>
            <Text style={styles.reauthBody}>{Copy.settings.reauth.passwordPrompt.body}</Text>
            <TextField
              placeholder={Copy.settings.reauth.passwordPrompt.placeholder}
              accessibilityLabel={Copy.settings.reauth.passwordPrompt.placeholder}
              value={reauthPassword}
              onChangeText={setReauthPassword}
              secureTextEntry
              autoCapitalize="none"
              textContentType="password"
              // Same pair issue #28 established on sign-in: `textContentType` covers iOS only,
              // so `autoComplete` is what lets an Android password manager fill this step-up
              // prompt. `returnKeyType="go"` + `onSubmitEditing` submits from the keyboard —
              // this field is `autoFocus`ed, so the keyboard is already up and the button is
              // the only thing standing between a filled password and the reauth.
              autoComplete="current-password"
              returnKeyType="go"
              onSubmitEditing={() => {
                void handlePasswordReauthSubmit();
              }}
              editable={!isReauthenticating}
              autoFocus
              error={reauthPasswordError}
            />
            <SquareButton
              label={Copy.settings.reauth.passwordPrompt.cta.primary}
              disabled={isReauthenticating}
              busy={isReauthenticating}
              onPress={() => {
                void handlePasswordReauthSubmit();
              }}
            />
            <SquareButton
              variant="link"
              label={Copy.settings.reauth.passwordPrompt.cta.secondary}
              disabled={isReauthenticating}
              onPress={cancelPasswordReauth}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Ink.bg,
  },
  scroll: {
    flex: 1,
  },
  // flexGrow, not flex — reflow and scroll at the largest text sizes, never clip. The page is a
  // single column at the gutter (`padding:59px 24px 34px; gap:32px`); the vertical insets are the
  // live ones with the canvas's as minimums, applied inline. `flexGrow: 1` is also what lets the
  // delete control's `marginTop: 'auto'` reach the foot of a short page.
  content: {
    flexGrow: 1,
    paddingHorizontal: Layout.gutter,
    gap: Space.xxl,
  },
  section: {
    gap: Space.sm,
  },
  sectionHeading: {
    ...Type.label,
    color: Ink.ink2,
  },
  // The page's `padding:0 16px`: rows run edge to edge vertically and the rules sit inside the
  // side padding.
  card: {
    paddingHorizontal: Layout.cardPadding,
  },
  row: {
    minHeight: Layout.rowHeight,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Space.lg,
  },
  rowLabel: {
    ...Type.body,
    color: Ink.ink,
  },
  rowValue: {
    ...Type.body,
    color: Ink.ink2,
    textAlign: 'right',
    flexShrink: 1,
  },
  /** A spinner beside a value, on one line. */
  rowValueGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    flexShrink: 1,
  },
  /** A value with an action beneath it (the consent read's error state), right-aligned. */
  rowValueStack: {
    alignItems: 'flex-end',
    flexShrink: 1,
  },
  rowAction: {
    minHeight: Layout.hitTarget,
    justifyContent: 'center',
  },
  rowActionLabel: {
    ...Type.label,
    color: Ink.ink,
  },
  rule: {
    height: Layout.hairline,
    backgroundColor: Ink.line,
  },
  paragraph: {
    ...Type.note,
    color: Ink.ink2,
    paddingVertical: Layout.cardPadding,
  },
  deleteButton: {
    marginTop: 'auto',
    minHeight: Layout.controlHeight,
    borderWidth: Layout.hairline,
    borderColor: Ink.danger,
    borderRadius: Layout.radius,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Layout.cardPadding,
  },
  deleteBusy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  deleteLabel: {
    ...Type.label,
    color: Ink.danger,
  },
  disabled: {
    opacity: DISABLED_OPACITY,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  // --- issue #124: the step-up password reauthentication Modal --------------------------------
  reauthFill: {
    flex: 1,
    backgroundColor: Ink.bg,
  },
  reauthContent: {
    flexGrow: 1,
    paddingHorizontal: Layout.gutter,
    gap: Space.xl,
  },
  reauthTitle: {
    ...Type.h2,
    color: Ink.ink,
  },
  reauthBody: {
    ...Type.body,
    color: Ink.ink2,
  },
});
