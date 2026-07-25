import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Copy } from '@/constants/copy';
import {
  Accent,
  Colors,
  ContentWidth,
  ControlHeight,
  ControlWidth,
  FontFamily,
  FontSize,
  HitTarget,
  Opacity,
  Radius,
  Spacing,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { checkPendingAnalysis } from '@/lib/pending-analysis';
import {
  describeQuota,
  isPrimaryCtaEnabled,
  primaryCtaAccessibilityHint,
  primaryCtaKind,
  primaryCtaLabel,
  quotaStatusClient,
  type QuotaStatus,
} from '@/lib/quota';
import { useSession } from '@/lib/session-provider';
import { useAnnounce } from '@/lib/use-announce';

type QuotaState =
  | { status: 'loading' }
  | { status: 'error'; lastKnown: QuotaStatus | null }
  | ({ status: 'ready' } & QuotaStatus);

/** One of these is minted per focus (see the `useFocusEffect` below) and threaded into every
 * `fetchQuota` call started while it's current. Its cleanup flips `active` to false the moment
 * that focus ends, so a call that started under an older focus — or after the screen unmounted
 * entirely (e.g. mid-fetch sign-out) — can tell it's stale and skip `setQuota` instead of
 * overwriting a newer, correct result or firing on an unmounted component. */
type ActiveFlag = { active: boolean };

/** Pulls the last successful quota reading (if any) out of whatever state we're currently in,
 * so a fetch failure can keep showing it alongside the stale caption instead of just replacing
 * it — see the `error` branch's render below. */
function lastKnownFrom(state: QuotaState): QuotaStatus | null {
  if (state.status === 'ready') {
    return {
      tier: state.tier,
      used: state.used,
      limit: state.limit,
      remaining: state.remaining,
      frameCap: state.frameCap,
      isLifetime: state.isLifetime,
      periodStart: state.periodStart,
      periodEnd: state.periodEnd,
      blocked: state.blocked,
      blockedReason: state.blockedReason,
      blockedUntil: state.blockedUntil,
    };
  }
  if (state.status === 'error') return state.lastKnown;
  return null;
}

export default function HomeScreen() {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { session } = useSession();
  const userId = session?.user.id;
  const [quota, setQuota] = useState<QuotaState>({ status: 'loading' });
  // Holds whichever ActiveFlag the most recent focus minted, so the Retry button — which calls
  // fetchQuota directly, outside useFocusEffect — can pass a flag too instead of racing unguarded.
  const activeFlagRef = useRef<ActiveFlag>({ active: false });

  // Issue #140: an analysis whose Analyzing screen was killed mid-wait. Non-null only for the
  // one outcome Home has to SHOW something for — `released` (the server gave up on it while
  // nothing was watching); see `pendingReleased`'s render block below for why. A `delivered`
  // outcome never sets this: it's routed straight to `/result/[id]` with no interstitial, same
  // as a normal in-session success.
  const [pendingReleased, setPendingReleased] = useState<{ analysisId: string } | null>(null);

  // Runs exactly once per cold start (the ref guard, not the effect's dependency array, is what
  // enforces "once" — Home stays mounted for the tab navigator's whole lifetime, so a plain
  // `useEffect(() => {...}, [])` alone would still only ever run once per process anyway; the
  // ref additionally protects against `userId` becoming available a render or two after mount,
  // e.g. immediately after sign-in), never on every later focus like `fetchQuota` above — this is
  // a STARTUP check ("did something finish while the app was dead"), not a live poll.
  // `lib/pending-analysis.ts`'s `checkPendingAnalysis` never throws and never blocks quota from
  // loading in parallel.
  const startupCheckedRef = useRef(false);

  useEffect(() => {
    if (startupCheckedRef.current || !userId) return;
    startupCheckedRef.current = true;

    checkPendingAnalysis(userId).then((outcome) => {
      if (outcome.kind === 'delivered') {
        // Same destination and `justAnalyzed` trigger `app/analyzing.tsx`'s own succeeded-effect
        // uses (docs/design/motion-consult.md item 3) — this device is genuinely seeing this
        // result for the first time, even though it finished while the app was dead.
        router.replace({
          pathname: '/result/[id]',
          params: { id: outcome.analysisId, justAnalyzed: '1' },
        } as Href);
        return;
      }
      if (outcome.kind === 'released') {
        setPendingReleased({ analysisId: outcome.analysisId });
      }
      // 'none' and 'pending' need no UI — see checkPendingAnalysis's own doc comment for why
      // leaving 'pending' alone (rather than erroring or clearing) is correct, not incomplete.
    });
  }, [userId]);

  const fetchQuota = useCallback(async (active: ActiveFlag) => {
    if (!userId) return;

    // Issues #54/#15: ONE call to the quota-status edge function (issue #50) — no counting
    // logic here at all. This used to run its own two-query mirror of `reserve_analysis`'s
    // counting rules (only `status = 'active'` subscriptions count; only `'reserved'`/
    // `'delivered'` analyses count) directly against `subscriptions`/`analyses`, which
    // CLAUDE.md's "no business rules in the client" rule forbids and which could never even be
    // completed for Pro/Elite — their quota is period-based and `pace_current_period`'s EXECUTE
    // is revoked from `authenticated`. `pace_quota_status` (server-side) now owns that counting
    // exactly once; this file only renders what it returns. See `lib/quota.ts`'s header for the
    // full contract, including the caveat that the endpoint is not deployed to the live project
    // yet — a failure here is expected until it is, and is handled by the `error` branch below,
    // never papered over with a guessed quota.
    const result = await quotaStatusClient.fetch();

    if (!active.active) return;

    if (!result.ok) {
      setQuota((current) => ({ status: 'error', lastKnown: lastKnownFrom(current) }));
      return;
    }

    setQuota({ status: 'ready', ...result.data });
  }, [userId]);

  // Home is the screen that's focused the instant it exists (Stack.Protected only renders
  // (tabs) once signed in), so this both loads the quota on first mount and refetches on every
  // later focus — a transient fetch failure self-heals just by revisiting the tab instead of
  // sticking until the app restarts. Also wired to the error state's Retry action below.
  //
  // Nothing sequences or cancels calls across focuses/Retry taps, so a slow, older call can
  // still resolve after a newer one. The ActiveFlag minted here (see its type doc above) is
  // what keeps that from corrupting state: it's live only for this focus, flips off the instant
  // the screen blurs or unmounts, and every fetchQuota call — this one and Retry's — checks its
  // own flag before ever calling setQuota.
  useFocusEffect(
    useCallback(() => {
      const active: ActiveFlag = { active: true };
      activeFlagRef.current = active;
      fetchQuota(active);
      return () => {
        active.active = false;
      };
    }, [fetchQuota])
  );

  // The primary CTA's label/enabled/hint, all derived from `quota` — never computed twice with
  // a chance to disagree with the caption above it (issue #15's root complaint: the old code
  // could show an "available" caption over a CTA whose own, separately-computed disabled state
  // didn't agree). Loading and error states deliberately default to the same treatment the
  // original M1 build used: enabled, plain "Analyze my form" label, no hint — refusing on a
  // quota we are unsure about would lock out a user who is actually fine, and `reserve_analysis`
  // re-checks server-side regardless (it, not this screen, is the authority — CLAUDE.md).
  const ctaKind = quota.status === 'ready' ? primaryCtaKind(quota) : 'analyze';
  const ctaLabel = primaryCtaLabel(ctaKind);
  const ctaEnabled = quota.status === 'ready' ? isPrimaryCtaEnabled(quota) : true;
  const ctaHint = quota.status === 'ready' ? primaryCtaAccessibilityHint(quota) : null;
  // Computed once here (not inline in the JSX below) so the primary caption Text and the CTA's
  // hint above can both read the same `QuotaCaption` object rather than each recomputing it.
  const readyCaption = quota.status === 'ready' ? describeQuota(quota) : null;

  // Issue #11. The three quota captions below carry `accessibilityLiveRegion="polite"`, which is
  // an ANDROID-ONLY prop — a no-op on iOS, the platform this ships to first. Without this hook a
  // VoiceOver user gets no announcement at all when quota resolves or fails. The prop stays for
  // Android; this is the iOS complement, not a replacement. One derived message covers all three
  // states so the announcement always matches whichever caption is actually on screen.
  const liveQuotaMessage =
    quota.status === 'loading'
      ? Copy.home.quota.loading
      : readyCaption
        ? readyCaption.primary
        : Copy.home.quota.error.failed;
  useAnnounce(liveQuotaMessage);
  // Same iOS/Android split as `liveQuotaMessage` above, for the one other piece of dynamic status
  // text this screen can show (issue #140) — the banner's own `accessibilityLiveRegion="polite"`
  // already covers Android.
  useAnnounce(pendingReleased ? Copy.home.pending.released.title : null);

  return (
    // edges excludes 'bottom' (issue #63): this screen renders under the tab bar, and
    // @react-navigation/bottom-tabs already pads the tab bar itself by the device's bottom
    // safe-area inset (verified in node_modules/@react-navigation/bottom-tabs's own
    // BottomTabBar — its height calculation adds `insets.bottom`) — a SafeAreaView here with the
    // default all-edges set would apply that same inset a second time, opening a dead gap
    // between this screen's content and the tab bar's top edge.
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Same ScrollView + flexGrow:1 pattern as app/(auth)/sign-in.tsx: the content still
          centers when there is room, but at the largest Dynamic Type sizes it scrolls instead
          of clipping (design brief §7: layouts reflow, never clip). */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.header}>{Copy.home.title}</Text>
          {/* Sign-out USED to live here as an M1 stub. Issue #53 moved it to Settings — its real
              home, alongside delete-account — and this link is now the entry point to that screen.
              Issue #27 (sign-out was fire-and-forget, so a failed global token revoke was silent)
              is fixed there, once, rather than twice: see lib/sign-out.ts. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Copy.settings.title}
            onPress={() => {
              router.push('/settings');
            }}
            style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}>
            <Text style={styles.settingsText}>{Copy.settings.title}</Text>
          </Pressable>
        </View>

        {/* Issue #140: surfaced once, at most, per reconciled analysis — `checkPendingAnalysis`
            has already cleared the marker by the time this renders, so dismissing (or simply
            navigating away) never re-shows it on a later focus, and a later cold start can never
            resurrect it either. Home is not a dead end underneath this: the primary CTA and
            Settings link above stay fully usable while this is showing. Same calm, non-alarmed
            treatment `app/analyzing.tsx`'s own ErrorPanel documents for itself — plain
            text.primary/text.secondary, no Semantic.error red. */}
        {pendingReleased && (
          <View style={styles.pendingReleasedBanner}>
            <Text style={styles.pendingReleasedTitle} accessibilityLiveRegion="polite">
              {Copy.home.pending.released.title}
            </Text>
            <Text style={styles.pendingReleasedBody}>{Copy.home.pending.released.body}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={Copy.home.pending.released.dismiss}
              onPress={() => setPendingReleased(null)}
              style={({ pressed }) => [styles.pendingReleasedDismiss, pressed && styles.pressed]}>
              <Text style={styles.pendingReleasedDismissText}>{Copy.home.pending.released.dismiss}</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.centerBlock}>
          {quota.status === 'loading' && (
            <View style={styles.loadingBlock}>
              <ActivityIndicator color={colors.text.secondary} />
              <Text style={styles.quotaCaption} accessibilityLiveRegion="polite">
                {Copy.home.quota.loading}
              </Text>
            </View>
          )}

          {quota.status === 'ready' && readyCaption && (
            <View style={styles.quotaReadyBlock}>
              <Text style={styles.quotaCaption} accessibilityLiveRegion="polite">
                {readyCaption.primary}
              </Text>
              {/* Pro/Elite's "Renews {date}" secondary line, or issue #6's anti-farm "blocked"
                  notice — never both; see lib/quota.ts's `describeQuota`. */}
              {readyCaption.secondary !== null && (
                <Text style={styles.quotaStaleCaption}>{readyCaption.secondary}</Text>
              )}
            </View>
          )}

          {quota.status === 'error' && (
            <View style={styles.quotaErrorBlock}>
              <Text style={styles.quotaCaption} accessibilityLiveRegion="polite">
                {quota.lastKnown ? describeQuota(quota.lastKnown).primary : Copy.home.quota.error.failed}
              </Text>
              {/* Only pair the "last known" caption with an actual last-known value — showing
                  it next to the plain failure line above would imply a cached value exists
                  when there isn't one. */}
              {quota.lastKnown !== null && (
                <Text style={styles.quotaStaleCaption}>{Copy.home.quota.error.stale}</Text>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={Copy.home.quota.error.retry}
                onPress={() => {
                  fetchQuota(activeFlagRef.current);
                }}
                style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
                <Text style={styles.retryText}>{Copy.home.quota.error.retry}</Text>
              </Pressable>
            </View>
          )}

          {/* Wired into the capture flow by M2 (issue #36): source picker -> camera/library ->
              frames.ts. This is the entry point to the product's only job, so without it #86's
              MVP gate ("a stranger can go sign-up -> analysis -> result with no dead end")
              cannot pass.

              Issues #54/#15: the label, enabled state, and a11y hint above are all derived from
              the SAME `quota` this screen fetched — the caption and the CTA can no longer
              disagree with each other the way the old client-side mirror sometimes could.
              Gating is still a display decision, not a business rule: `reserve_analysis`
              re-checks server-side regardless and stays the sole authority (CLAUDE.md).

              An exhausted user is routed to the Paywall (issue #52) rather than left on a dead
              button — that dead button, sitting under an offer of a free analysis, WAS issue #15.
              The Paywall takes no params: it re-reads quota itself, so it stays honest however it
              was reached. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
            accessibilityHint={ctaHint ?? undefined}
            accessibilityState={{ disabled: !ctaEnabled }}
            disabled={!ctaEnabled}
            onPress={() => {
              if (ctaKind === 'upgradeToAnalyze' || ctaKind === 'upgradeForMore') {
                router.push('/paywall');
              } else {
                router.push('/capture');
              }
            }}
            style={({ pressed }) => [
              styles.primaryButton,
              !ctaEnabled && styles.primaryButtonDisabled,
              pressed && ctaEnabled && styles.pressed,
            ]}>
            <Text style={styles.primaryButtonText}>{ctaLabel}</Text>
          </Pressable>

          <Text style={styles.emptyCaption}>{Copy.home.empty.caption}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    // Centers the (width-capped) content container within the ScrollView's own viewport — a
    // no-op on any phone (see ContentWidth's own comment), and what keeps a tablet's readable
    // column from sitting flush against the left edge instead of centered (issue #63).
    scroll: {
      flex: 1,
      alignItems: 'center',
    },
    content: {
      // flexGrow (not flex) — this is a ScrollView contentContainerStyle now: it fills the
      // viewport when the content is short, and grows past it when Dynamic Type makes it tall.
      flexGrow: 1,
      width: '100%',
      maxWidth: ContentWidth.readable,
      padding: Spacing.xl,
      gap: Spacing.xxl,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    header: {
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.xl,
      color: colors.text.primary,
    },
    settingsButton: {
      minHeight: HitTarget.min,
      minWidth: HitTarget.min,
      paddingHorizontal: Spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    settingsText: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
      textDecorationLine: 'underline',
    },
    // Issue #140. Same neutral-surface treatment `components/partial-result-banner.tsx` (issue
    // #56) uses for its own honesty disclosure — a bordered `surface.raised` card, not
    // `Semantic.error`, matching that component's own reasoning: this is a "here's what
    // happened" notice, not a system failure or a low score.
    pendingReleasedBanner: {
      backgroundColor: colors.surface.raised,
      borderColor: colors.hairline,
      borderRadius: Radius.card,
      borderWidth: 1,
      gap: Spacing.xs,
      padding: Spacing.lg,
    },
    pendingReleasedTitle: {
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.md,
      color: colors.text.primary,
    },
    pendingReleasedBody: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      lineHeight: FontSize.sm * 1.4,
      color: colors.text.secondary,
    },
    pendingReleasedDismiss: {
      alignSelf: 'flex-start',
      minHeight: HitTarget.min,
      justifyContent: 'center',
      paddingVertical: Spacing.xs,
    },
    pendingReleasedDismissText: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      color: colors.text.primary,
      textDecorationLine: 'underline',
    },
    centerBlock: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xl,
    },
    loadingBlock: {
      alignItems: 'center',
      gap: Spacing.md,
    },
    quotaCaption: {
      fontFamily: FontFamily.mono.regular,
      fontSize: FontSize.md,
      color: colors.text.secondary,
      textAlign: 'center',
    },
    quotaReadyBlock: {
      alignItems: 'center',
      gap: Spacing.xs,
    },
    quotaErrorBlock: {
      alignItems: 'center',
      gap: Spacing.xs,
    },
    quotaStaleCaption: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.xs,
      color: colors.text.secondary,
      textAlign: 'center',
    },
    retryButton: {
      // The 44x44 floor design-brief §7 calls non-negotiable — padding alone left this at
      // ~28pt around 15pt text. `signOutButton` above already uses the same token.
      minHeight: HitTarget.min,
      minWidth: HitTarget.min,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: Spacing.xs,
      paddingHorizontal: Spacing.sm,
    },
    /** The one pressed-state dim shared by every touchable on this screen. */
    pressed: {
      opacity: Opacity.pressed,
    },
    // Not Accent — that's the primary CTA's color and only the primary CTA's (theme.ts). This
    // is a small underlined text action; `text.primary` + underline reads as the more
    // prominent of this screen's two links, next to `signOutText` below at `text.secondary` +
    // underline, without spending the accent on it (issue #21).
    retryText: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      color: colors.text.primary,
      textDecorationLine: 'underline',
    },
    primaryButton: {
      minHeight: ControlHeight.standard,
      minWidth: ControlWidth.primaryButton,
      borderRadius: Radius.card,
      backgroundColor: Accent.value,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Spacing.xl,
    },
    primaryButtonDisabled: {
      opacity: Opacity.disabled,
    },
    primaryButtonText: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.md,
      color: Accent.onAccent,
    },
    emptyCaption: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
      textAlign: 'center',
    },
  });
}
