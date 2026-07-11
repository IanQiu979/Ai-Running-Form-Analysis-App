import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Copy } from '@/constants/copy';
import {
  Accent,
  Colors,
  FontFamily,
  FontSize,
  Radius,
  Spacing,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSession } from '@/lib/session-provider';
import { supabase } from '@/lib/supabase';

type SubscriptionTier = 'free' | 'pro' | 'elite';

type QuotaState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; tier: SubscriptionTier; hasUsedFreeAnalysis: boolean };

export default function HomeScreen() {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { session } = useSession();
  const [quota, setQuota] = useState<QuotaState>({ status: 'loading' });

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;

    let isMounted = true;
    setQuota({ status: 'loading' });

    async function loadQuota() {
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

      if (!isMounted) return;

      if (subscriptionError || countError) {
        setQuota({ status: 'error' });
        return;
      }

      const tier: SubscriptionTier = subscription?.tier ?? 'free';
      setQuota({
        status: 'ready',
        tier,
        hasUsedFreeAnalysis: tier === 'free' && (count ?? 0) >= 1,
      });
    }

    loadQuota().catch(() => {
      if (isMounted) setQuota({ status: 'error' });
    });

    return () => {
      isMounted = false;
    };
  }, [session?.user.id]);

  function handleSignOut() {
    // onAuthStateChange (lib/session-provider.tsx) flips `session` to null, and the
    // root layout's Stack.Protected guard routes back to (auth) automatically.
    supabase.auth.signOut();
  }

  const quotaCaption = describeQuota(quota);

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
          {quota.status === 'loading' ? (
            <ActivityIndicator color={colors.text.secondary} />
          ) : (
            <Text style={styles.quotaCaption} accessibilityLiveRegion="polite">
              {quotaCaption}
            </Text>
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

function describeQuota(quota: QuotaState): string {
  if (quota.status === 'loading') return Copy.home.quota.loading;
  if (quota.status === 'error') return Copy.home.quota.error.stale;
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
      minHeight: 44,
      minWidth: 44,
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
    primaryButton: {
      minHeight: 52,
      minWidth: 220,
      borderRadius: Radius.card,
      backgroundColor: Accent.value,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Spacing.xl,
    },
    primaryButtonDisabled: {
      opacity: 0.4,
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
