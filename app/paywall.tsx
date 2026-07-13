/**
 * Screen 10 — Paywall (dummy) (issue #52).
 *
 * Reached two ways, and this screen does not need to tell them apart: (1) voluntarily, from
 * Settings' "See plans" (`settings.plan.cta` — not yet wired; see this file's HANDOFF note in the
 * PR/report), or (2) via a quota-exhausted CTA tap on Home (`home.cta.upgradeToAnalyze` /
 * `.upgradeForMore`, issue #54) or a swallowed `402 quota_exceeded` from `analyze-form` (issue
 * #46's contract; wiring that specific catch is issue #44/#80's territory — see this file's
 * HANDOFF note). Either way, this screen independently re-reads the caller's CURRENT quota via
 * `getQuotaStatus()` on mount and derives the gate banner (`copy-deck.md`'s
 * `paywall.gate.free.*` / `.gate.paid.*`) from that fresh, server-authoritative read — never from
 * a route param a caller could get wrong or a client-held guess. A free user with
 * `remaining === 0` sees the free-gate banner regardless of how they got here, which is the
 * honest reading of the deck's "Shows when" column (a true CURRENT STATE, not a one-time event).
 *
 * ⚠️ COSMETIC ONLY — CLAUDE.md / issue #52's non-negotiable rule: nothing on this screen enforces
 * anything. `getQuotaStatus()`/`purchaseTier()` (`lib/subscription.ts`) only ever read/request —
 * `reserve_analysis` and `pace_purchase_tier` are the only things that actually decide quota or
 * grant a tier. No limit/frame-cap number is hardcoded anywhere below; every number shown (the
 * gate banner's `{limit}`/renewal date) comes straight off the live `QuotaStatus` response.
 *
 * STATES BUILT: plan loading / ready / error+retry (mirrors `app/settings.tsx`'s identical Plan
 * section); the optional gate banner; three tier cards, each independently able to show "Current
 * plan", an "Upgrade to X" CTA, or (Free only) neither; a per-card purchase-pending spinner; and a
 * purchase result — reported via native `Alert` (same rationale `app/settings.tsx`'s header gives
 * for using `Alert` over an in-screen sheet: an alert survives underneath whatever this screen's
 * state does next, and it's the established idiom this codebase already uses for confirmations).
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Copy } from '@/constants/copy';
import {
  Colors,
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
  formatRenewalDate,
  getQuotaStatus,
  purchaseTier,
  type PurchasableTier,
  type PurchaseErrorCode,
  type QuotaStatus,
} from '@/lib/subscription';
import { useAnnounce } from '@/lib/use-announce';

type PlanState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: QuotaStatus };

type PurchaseState = { status: 'idle' } | { status: 'pending'; tier: PurchasableTier };

/** Derives the optional gate banner purely from a fresh `QuotaStatus` — see this file's header
 *  for why that beats trusting a route param. `null` means: no banner, this is a voluntary visit
 *  (or the read hasn't resolved yet) with quota still available. */
function gateBannerFor(plan: PlanState): { title: string; body: string } | null {
  if (plan.status !== 'ready') return null;
  const { tier, remaining, limit, periodEnd } = plan.data;
  if (remaining > 0) return null;

  if (tier === 'free') {
    return { title: Copy.paywall.gate.free.title, body: Copy.paywall.gate.free.body };
  }
  // periodEnd is documented non-null for a paid tier (lib/subscription.ts's QuotaStatus doc
  // comment) — the '—' fallback is defensive only, never expected to render.
  const renewsOn = periodEnd ? formatRenewalDate(periodEnd) : '—';
  return { title: Copy.paywall.gate.paid.title, body: Copy.paywall.gate.paid.body(limit, renewsOn) };
}

type TierCardCta =
  | { kind: 'none' }
  | { kind: 'current' }
  | { kind: 'upgrade'; label: string; busy: boolean; disabled: boolean; onPress: () => void };

function ctaForPurchasableTier(
  tierKey: PurchasableTier,
  plan: PlanState,
  purchase: PurchaseState,
  onUpgrade: (tier: PurchasableTier) => void
): TierCardCta {
  if (plan.status === 'ready' && plan.data.tier === tierKey) {
    return { kind: 'current' };
  }
  return {
    kind: 'upgrade',
    label: Copy.paywall.cta.upgrade[tierKey],
    busy: purchase.status === 'pending' && purchase.tier === tierKey,
    disabled: purchase.status === 'pending',
    onPress: () => onUpgrade(tierKey),
  };
}

/** Free has no purchase path (see lib/subscription.ts's `PurchasableTier` — 'free' is excluded at
 *  the type level), so its only possible CTA states are "Current plan" or nothing at all. */
function ctaForFree(plan: PlanState): TierCardCta {
  if (plan.status === 'ready' && plan.data.tier === 'free') return { kind: 'current' };
  return { kind: 'none' };
}

export default function PaywallScreen() {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [plan, setPlan] = useState<PlanState>({ status: 'loading' });
  const [purchase, setPurchase] = useState<PurchaseState>({ status: 'idle' });

  // Same guard app/settings.tsx uses: an async read/write settling after this screen has been
  // popped must not call setState on an unmounted component.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchPlan = useCallback(async () => {
    setPlan({ status: 'loading' });
    const result = await getQuotaStatus();
    if (!isMountedRef.current) return;
    setPlan(result.ok ? { status: 'ready', data: result.data } : { status: 'error' });
  }, []);

  useEffect(() => {
    void fetchPlan();
  }, [fetchPlan]);

  async function handleUpgrade(tier: PurchasableTier) {
    if (purchase.status === 'pending') return;
    setPurchase({ status: 'pending', tier });

    const result = await purchaseTier(tier);

    if (!isMountedRef.current) return;
    setPurchase({ status: 'idle' });

    if (result.ok) {
      // Re-derive the true state from the server rather than fabricating a full QuotaStatus from
      // the purchase response (which carries only tier/periodStart/periodEnd, not used/remaining/
      // limit/frameCap) — see this file's header on never guessing quota client-side.
      void fetchPlan();
      Alert.alert(
        Copy.paywall.purchase.success.title(Copy.paywall.tier[result.data.tier].name),
        Copy.paywall.purchase.success.body,
        [{ text: Copy.paywall.alertDismiss }]
      );
      return;
    }

    showPurchaseFailureAlert(result.error.code);
  }

  /** Every `PurchaseErrorCode` `lib/subscription.ts` can return, switched exhaustively so a sixth
   *  code added there fails this to COMPILE rather than silently falling through to the wrong
   *  copy — same discipline `app/settings.tsx`'s `showDeleteAccountFailureAlert` uses.
   *  `unauthorized` / `purchase_unavailable` / `unknown` share the same generic, retryable copy —
   *  see `Copy.paywall.purchase.error.generic`'s own comment for why they don't each need their
   *  own string. */
  function showPurchaseFailureAlert(code: PurchaseErrorCode) {
    switch (code) {
      case 'not_found':
        Alert.alert(Copy.paywall.purchase.error.unavailable.title, Copy.paywall.purchase.error.unavailable.body, [
          { text: Copy.paywall.alertDismiss },
        ]);
        return;
      case 'rate_limited':
        Alert.alert(Copy.paywall.purchase.error.rateLimited.title, Copy.paywall.purchase.error.rateLimited.body, [
          { text: Copy.paywall.alertDismiss },
        ]);
        return;
      case 'unauthorized':
      case 'purchase_unavailable':
      case 'unknown':
        Alert.alert(Copy.paywall.purchase.error.generic.title, Copy.paywall.purchase.error.generic.body, [
          { text: Copy.paywall.alertDismiss },
        ]);
        return;
      default: {
        const exhaustive: never = code;
        throw new Error(`Unhandled PurchaseErrorCode: ${String(exhaustive)}`);
      }
    }
  }

  const gateBanner = gateBannerFor(plan);
  // Issue #11: the gate banner and plan status Texts below carry `accessibilityLiveRegion="polite"`,
  // which is Android-only — these are the iOS complements, same pattern as app/(tabs)/index.tsx.
  useAnnounce(gateBanner ? `${gateBanner.title} ${gateBanner.body}` : null);
  useAnnounce(
    plan.status === 'loading' ? Copy.paywall.plan.loading : plan.status === 'error' ? Copy.paywall.plan.error : null
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          {/* Text button, not a chevron glyph — matches app/settings.tsx's back button exactly
              (see its own comment on why: Dynamic Type + no icon-font mapping to rely on). */}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              router.back();
            }}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <Text style={styles.backText}>{Copy.paywall.back}</Text>
          </Pressable>
          <Text style={styles.title} accessibilityRole="header">
            {Copy.paywall.title}
          </Text>
        </View>

        {gateBanner && (
          <View style={styles.gateBanner} accessibilityLiveRegion="polite">
            <Text style={styles.gateTitle}>{gateBanner.title}</Text>
            <Text style={styles.gateBody}>{gateBanner.body}</Text>
          </View>
        )}

        {plan.status === 'loading' && (
          <View style={styles.inlineRow}>
            <ActivityIndicator color={colors.text.secondary} />
            <Text style={styles.planStatusText} accessibilityLiveRegion="polite">
              {Copy.paywall.plan.loading}
            </Text>
          </View>
        )}

        {plan.status === 'error' && (
          <View style={styles.planErrorBlock}>
            <Text style={styles.planStatusText} accessibilityLiveRegion="polite">
              {Copy.paywall.plan.error}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={Copy.paywall.plan.retryA11yLabel}
              onPress={() => {
                void fetchPlan();
              }}
              style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}>
              <Text style={styles.textActionLabel}>{Copy.paywall.plan.retry}</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.cards}>
          <TierCard
            name={Copy.paywall.tier.free.name}
            price={Copy.paywall.tier.free.price}
            detail={Copy.paywall.tier.free.detail}
            cta={ctaForFree(plan)}
            styles={styles}
            colors={colors}
          />
          <TierCard
            name={Copy.paywall.tier.pro.name}
            price={Copy.paywall.tier.pro.price}
            detail={Copy.paywall.tier.pro.detail}
            cta={ctaForPurchasableTier('pro', plan, purchase, handleUpgrade)}
            styles={styles}
            colors={colors}
          />
          <TierCard
            name={Copy.paywall.tier.elite.name}
            price={Copy.paywall.tier.elite.price}
            detail={Copy.paywall.tier.elite.detail}
            cta={ctaForPurchasableTier('elite', plan, purchase, handleUpgrade)}
            styles={styles}
            colors={colors}
          />
        </View>

        <Text style={styles.footnote}>{Copy.paywall.footnote}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof createStyles>;

type TierCardProps = {
  name: string;
  price: string;
  detail: string;
  cta: TierCardCta;
  styles: Styles;
  colors: ThemeColors;
};

function TierCard({ name, price, detail, cta, styles, colors }: TierCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardName}>{name}</Text>
        <Text style={styles.cardPrice}>{price}</Text>
      </View>
      <Text style={styles.cardDetail}>{detail}</Text>

      {cta.kind === 'current' && (
        <View style={styles.currentPlanBadge}>
          <Text style={styles.currentPlanText}>{Copy.paywall.cta.current}</Text>
        </View>
      )}

      {cta.kind === 'upgrade' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={cta.busy ? Copy.paywall.purchase.pending : cta.label}
          accessibilityState={{ disabled: cta.disabled, busy: cta.busy }}
          disabled={cta.disabled}
          onPress={cta.onPress}
          style={({ pressed }) => [
            styles.upgradeButton,
            cta.disabled && styles.disabled,
            pressed && !cta.disabled && styles.pressed,
          ]}>
          {cta.busy ? (
            <ActivityIndicator color={colors.text.primary} />
          ) : (
            <Text style={styles.upgradeButtonText}>{cta.label}</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
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
    // Calm, not alarmed — same "coach, not scold" treatment app/analyzing.tsx's ErrorPanel uses
    // (plain text.primary/text.secondary on a surface card, never Semantic.error): running out of
    // analyses is an expected, non-alarming state, not a system failure.
    gateBanner: {
      backgroundColor: colors.surface.base,
      borderRadius: Radius.card,
      padding: Spacing.lg,
      gap: Spacing.xs,
    },
    gateTitle: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.md,
      color: colors.text.primary,
    },
    gateBody: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
    },
    inlineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    planStatusText: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
    },
    planErrorBlock: {
      gap: Spacing.xs,
      alignItems: 'flex-start',
    },
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
    cards: {
      gap: Spacing.lg,
    },
    card: {
      backgroundColor: colors.surface.base,
      borderRadius: Radius.card,
      padding: Spacing.lg,
      gap: Spacing.sm,
    },
    cardHeaderRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
    },
    cardName: {
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.lg,
      color: colors.text.primary,
    },
    // Mono — the "measured readouts and any pace/metric text" role (theme.ts's FontFamily.mono
    // doc comment), same treatment Home already gives its quota-count caption.
    cardPrice: {
      fontFamily: FontFamily.mono.regular,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
    },
    cardDetail: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      lineHeight: FontSize.sm * 1.4,
      color: colors.text.secondary,
    },
    // A non-interactive label, not a disabled button — "Current plan" names a fact about this
    // card, not a control the user could have pressed (copy deck: "Disabled-state label").
    currentPlanBadge: {
      minHeight: HitTarget.min,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: Radius.card,
      borderWidth: 1,
      borderColor: colors.control.border,
    },
    currentPlanText: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
    },
    // NOT Accent — theme.ts reserves that for "the primary CTA, and only the primary CTA," and
    // this screen has no single primary action (it's a parallel choice between two upgrade
    // paths, unlike Home's one CTA). Same bordered "secondary button" treatment
    // app/(auth)/sign-in.tsx uses for its own non-sole actions (Google/email sign-in): the
    // interactive-boundary `control.border` (issue #96) is what marks this as tappable, not fill
    // color.
    upgradeButton: {
      minHeight: HitTarget.min,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: Radius.card,
      borderWidth: 1,
      borderColor: colors.control.border,
      backgroundColor: colors.surface.raised,
    },
    upgradeButtonText: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.sm,
      color: colors.text.primary,
    },
    footnote: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.xs,
      color: colors.text.secondary,
      textAlign: 'center',
    },
    disabled: {
      opacity: Opacity.disabled,
    },
    pressed: {
      opacity: Opacity.pressed,
    },
  });
}
