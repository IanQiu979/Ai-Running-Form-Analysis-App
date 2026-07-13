import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Copy } from '@/constants/copy';
import {
  Accent,
  Colors,
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

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Same ScrollView + flexGrow:1 pattern as app/(auth)/sign-in.tsx: the content still
          centers when there is room, but at the largest Dynamic Type sizes it scrolls instead
          of clipping (design brief §7: layouts reflow, never clip). */}
      <ScrollView contentContainerStyle={styles.content}>
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
    content: {
      // flexGrow (not flex) — this is a ScrollView contentContainerStyle now: it fills the
      // viewport when the content is short, and grows past it when Dynamic Type makes it tall.
      flexGrow: 1,
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
