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
import { useSession } from '@/lib/session-provider';
import { supabase } from '@/lib/supabase';

type SubscriptionTier = 'free' | 'pro' | 'elite';

type ReadyQuota = { tier: SubscriptionTier; hasUsedFreeAnalysis: boolean };

type QuotaState =
  | { status: 'loading' }
  | { status: 'error'; lastKnown: ReadyQuota | null }
  | ({ status: 'ready' } & ReadyQuota);

/** One of these is minted per focus (see the `useFocusEffect` below) and threaded into every
 * `fetchQuota` call started while it's current. Its cleanup flips `active` to false the moment
 * that focus ends, so a call that started under an older focus — or after the screen unmounted
 * entirely (e.g. mid-fetch sign-out) — can tell it's stale and skip `setQuota` instead of
 * overwriting a newer, correct result or firing on an unmounted component. */
type ActiveFlag = { active: boolean };

/** Pulls the last successful quota reading (if any) out of whatever state we're currently in,
 * so a fetch failure can keep showing it alongside the stale caption instead of just replacing
 * it — see the `error` branch's render below. */
function lastKnownFrom(state: QuotaState): ReadyQuota | null {
  if (state.status === 'ready') return { tier: state.tier, hasUsedFreeAnalysis: state.hasUsedFreeAnalysis };
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

    try {
      // Mirrors reserve_analysis's own server-side counting rules (see
      // supabase/migrations/20260711150400_quota_reserve_settle_release.sql) so this
      // display can't disagree with what the RPC will actually enforce: a
      // subscriptions row only counts while status = 'active' (a canceled one means
      // free, same as no row), and an analyses row only counts toward "used" while
      // 'reserved' or 'delivered' — a 'released' row (a failed/fallback attempt whose
      // quota was refunded per gate #4) must NOT make a free user look like they've
      // used their one lifetime analysis when they haven't.
      const [{ data: subscription, error: subscriptionError }, { count, error: countError }] =
        await Promise.all([
          supabase
            .from('subscriptions')
            .select('tier')
            .eq('user_id', userId)
            .eq('status', 'active')
            .maybeSingle(),
          supabase
            .from('analyses')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .in('status', ['reserved', 'delivered']),
        ]);

      if (subscriptionError || countError) {
        if (!active.active) return;
        setQuota((current) => ({ status: 'error', lastKnown: lastKnownFrom(current) }));
        return;
      }

      if (!active.active) return;
      const tier: SubscriptionTier = subscription?.tier ?? 'free';
      setQuota({
        status: 'ready',
        tier,
        hasUsedFreeAnalysis: tier === 'free' && (count ?? 0) >= 1,
      });
    } catch {
      if (!active.active) return;
      setQuota((current) => ({ status: 'error', lastKnown: lastKnownFrom(current) }));
    }
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

  // Disable the CTA ONLY when we positively know a free user has already spent their one
  // lifetime analysis. Loading and error states deliberately leave it enabled: refusing on a
  // quota we are unsure about would lock out a user who is actually fine, and reserve_analysis
  // re-checks server-side anyway (it, not this, is the authority — CLAUDE.md).
  const isOutOfQuota =
    quota.status === 'ready' && quota.tier === 'free' && quota.hasUsedFreeAnalysis;

  function handleSignOut() {
    // onAuthStateChange (lib/session-provider.tsx) flips `session` to null, and the
    // root layout's Stack.Protected guard routes back to (auth) automatically — that happens
    // even if the network call below fails, because auth-js clears the local session either way.
    // The `{ error }` this returns is intentionally discarded, not just forgotten: on a failed
    // *global* revoke the local sign-out still succeeds, so the user isn't stuck, but the
    // server-side refresh tokens survive and nobody is told. Surfacing that failure needs
    // copy-deck text that doesn't exist yet — tracked separately by issue #27, which this does
    // NOT close. `void` + `.catch` only makes the discard explicit and keeps the rejection from
    // becoming an unhandled promise rejection.
    void supabase.auth.signOut().catch(() => {});
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Same ScrollView + flexGrow:1 pattern as app/(auth)/sign-in.tsx: the content still
          centers when there is room, but at the largest Dynamic Type sizes it scrolls instead
          of clipping (design brief §7: layouts reflow, never clip). */}
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.header}>{Copy.home.title}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Copy.settings.signOut.cta}
            onPress={handleSignOut}
            style={({ pressed }) => [styles.signOutButton, pressed && styles.pressed]}>
            <Text style={styles.signOutText}>{Copy.settings.signOut.cta}</Text>
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

          {quota.status === 'ready' && (
            <Text style={styles.quotaCaption} accessibilityLiveRegion="polite">
              {describeReadyQuota(quota)}
            </Text>
          )}

          {quota.status === 'error' && (
            <View style={styles.quotaErrorBlock}>
              <Text style={styles.quotaCaption} accessibilityLiveRegion="polite">
                {quota.lastKnown ? describeReadyQuota(quota.lastKnown) : Copy.home.quota.error.failed}
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

              Gated on a KNOWN-exhausted free quota only. That is a display decision, not a
              business rule: the server re-checks in reserve_analysis regardless, and it stays
              the sole authority (CLAUDE.md). We disable rather than let an out-of-quota user
              film a clip and only then be refused — that wastes their effort to tell them
              something we already knew. When quota is loading or errored we leave the CTA
              ENABLED: refusing on a state we are unsure of would lock out a user who is
              actually fine, and the server would have caught it anyway.

              Tier/quota CTA relabeling ("Upgrade to analyze", copy deck Ambiguities #1) is
              still M5's, since that is where the paywall it would route to gets built. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Copy.home.cta.analyze}
            accessibilityState={{ disabled: isOutOfQuota }}
            disabled={isOutOfQuota}
            onPress={() => {
              router.push('/capture');
            }}
            style={({ pressed }) => [
              styles.primaryButton,
              isOutOfQuota && styles.primaryButtonDisabled,
              pressed && !isOutOfQuota && styles.pressed,
            ]}>
            <Text style={styles.primaryButtonText}>{Copy.home.cta.analyze}</Text>
          </Pressable>

          <Text style={styles.emptyCaption}>{Copy.home.empty.caption}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function describeReadyQuota(quota: ReadyQuota): string {
  if (quota.tier === 'free') {
    return quota.hasUsedFreeAnalysis
      ? Copy.home.quota.exhausted.free
      : Copy.home.quota.free.available;
  }
  // Pro/Elite period-based quota copy ("{remaining} of {limit} analyses left this period")
  // needs the quota-status edge function and currentPeriod() read — M5's `purchase-tier`/
  // `quota-status` wiring, not yet built. This branch is unreachable today (subscriptions
  // can only hold 'pro'/'elite' once that RPC exists), but a plain tier-name fallback beats
  // either crashing or fabricating a free-tier caption for a paid user.
  const tierName = quota.tier === 'pro' ? Copy.home.quota.tier.pro : Copy.home.quota.tier.elite;
  return `${tierName} plan`;
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
    signOutButton: {
      minHeight: HitTarget.min,
      minWidth: HitTarget.min,
      paddingHorizontal: Spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    signOutText: {
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
