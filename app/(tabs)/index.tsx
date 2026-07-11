import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
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

  const fetchQuota = useCallback(async () => {
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
        setQuota((current) => ({ status: 'error', lastKnown: lastKnownFrom(current) }));
        return;
      }

      const tier: SubscriptionTier = subscription?.tier ?? 'free';
      setQuota({
        status: 'ready',
        tier,
        hasUsedFreeAnalysis: tier === 'free' && (count ?? 0) >= 1,
      });
    } catch {
      setQuota((current) => ({ status: 'error', lastKnown: lastKnownFrom(current) }));
    }
  }, [userId]);

  // Home is the screen that's focused the instant it exists (Stack.Protected only renders
  // (tabs) once signed in), so this both loads the quota on first mount and refetches on every
  // later focus — a transient fetch failure self-heals just by revisiting the tab instead of
  // sticking until the app restarts. Also wired to the error state's Retry action below.
  useFocusEffect(
    useCallback(() => {
      fetchQuota();
    }, [fetchQuota])
  );

  function handleSignOut() {
    // onAuthStateChange (lib/session-provider.tsx) flips `session` to null, and the
    // root layout's Stack.Protected guard routes back to (auth) automatically.
    supabase.auth.signOut();
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.header}>Home</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Copy.settings.signOut.cta}
            onPress={handleSignOut}
            style={styles.signOutButton}>
            <Text style={styles.signOutText}>{Copy.settings.signOut.cta}</Text>
          </Pressable>
        </View>

        <View style={styles.centerBlock}>
          {quota.status === 'loading' && <ActivityIndicator color={colors.text.secondary} />}

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
                  fetchQuota();
                }}
                style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}>
                <Text style={styles.retryText}>{Copy.home.quota.error.retry}</Text>
              </Pressable>
            </View>
          )}

          {/* Disabled stub for M1 — M2 wires this into the capture flow (source picker ->
              camera/library -> frames.ts). Tier/quota-gated CTA relabeling (per copy deck's
              "Ambiguities" #1: "Upgrade to analyze" etc.) is deferred to M5, which is where
              paywall routing itself gets built — relabeling a CTA that goes nowhere yet would
              be its own small honesty gap. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Copy.home.cta.analyze}
            accessibilityState={{ disabled: true }}
            disabled
            style={[styles.primaryButton, styles.primaryButtonDisabled]}>
            <Text style={styles.primaryButtonText}>{Copy.home.cta.analyze}</Text>
          </Pressable>

          <Text style={styles.emptyCaption}>{Copy.home.empty.caption}</Text>
        </View>
      </View>
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
  const tierName = quota.tier === 'pro' ? 'Pro' : 'Elite';
  return `${tierName} plan`;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      flex: 1,
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
      paddingVertical: Spacing.xs,
      paddingHorizontal: Spacing.sm,
    },
    retryButtonPressed: {
      opacity: Opacity.pressed,
    },
    retryText: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      color: Accent.value,
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
