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
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KineticText } from '@/components/kinetic-text';
import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { PillButton } from '@/components/ui/pill-button';
import { ScreenGradient } from '@/components/ui/screen-gradient';
import { SurfaceCard } from '@/components/ui/surface-card';
import { Copy } from '@/constants/copy';
import {
  Colors,
  FontFamily,
  FontSize,
  HitTarget,
  LineHeight,
  Motion,
  Opacity,
  Radius,
  Spacing,
  Tracking,
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
  const { tier, remaining, limit, periodEnd, unlimited } = plan.data;
  if (unlimited || remaining === null || remaining > 0) return null;

  if (tier === 'free') {
    return { title: Copy.paywall.gate.free.title, body: Copy.paywall.gate.free.body };
  }
  // periodEnd is documented non-null for a paid tier (lib/subscription.ts's QuotaStatus doc
  // comment) — the '—' fallback is defensive only, never expected to render.
  const renewsOn = periodEnd ? formatRenewalDate(periodEnd) : '—';
  return {
    title: Copy.paywall.gate.paid.title,
    body: Copy.paywall.gate.paid.body(limit ?? 0, renewsOn),
  };
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
  if (plan.status === 'ready') {
    if (plan.data.tier === tierKey) return { kind: 'current' };
    // Never offer a downgrade as an "Upgrade". An Elite account used to see an active
    // "Upgrade to Pro" control, which was both false copy and a route into the lower-tier
    // purchase RPC. Purchase mechanics remain untouched; the impossible CTA is simply absent.
    if (plan.data.tier === 'elite' && tierKey === 'pro') return { kind: 'none' };
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
 *  the type level), so its only possible CTA states are "Current plan" or nothing at all.
 *
 * M7 (v23-ux-audit-r1): this used to show `{ kind: 'current' }` ONLY once the plan fetch had
 * confirmed `tier === 'free'`, and `{ kind: 'none' }` (a blank card, no control at all)
 * otherwise — including while `plan.status` is still `'loading'` or came back `'error'`, which
 * is the common case, not an edge case. That left Free the only card with nothing to look at
 * while Pro/Elite already showed real "Upgrade" buttons. Free is every account's default
 * baseline, so showing "Current plan" is the safe default; the only state that should suppress
 * it is a CONFIRMED paid tier. */
function ctaForFree(plan: PlanState): TierCardCta {
  if (plan.status === 'ready' && plan.data.tier !== 'free') return { kind: 'none' };
  return { kind: 'current' };
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
    <ScreenGradient>
      <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Back is now the redesign's circular control rather than a word. The old comment here
            argued for a text button over "a chevron glyph" on Dynamic Type grounds — that concern
            was about a glyph SIZED IN TEXT POINTS. `<CircleIconButton>` is a fixed 44pt target
            with a fixed 20pt glyph inside it, so it neither grows nor shrinks with text size and
            the objection does not transfer. Its `accessibilityLabel` carries the same word the
            visible label used to. */}
        <View style={styles.headerRow}>
          <CircleIconButton
            accessibilityLabel={Copy.paywall.back}
            onPress={() => {
              router.back();
            }}>
            <MaterialIcons name="arrow-back" size={20} color={colors.text.primary} />
          </CircleIconButton>
          <View style={styles.titleBlock}>
            <KineticText
              accessibilityRole="header"
              staggerMs={Motion.stagger.line}
              style={styles.title}>
              {Copy.paywall.title}
            </KineticText>
          </View>
        </View>

        {gateBanner && (
          <SurfaceCard style={styles.gateBanner} padding={Spacing.lg} accessibilityLiveRegion="polite">
            <Text style={styles.gateTitle}>{gateBanner.title}</Text>
            <Text style={styles.gateBody}>{gateBanner.body}</Text>
          </SurfaceCard>
        )}

        {plan.status === 'loading' && (
          <View style={styles.inlineRow}>
            <ActivityIndicator color={colors.text.primary} />
            <Text style={styles.planStatusText} accessibilityLiveRegion="polite">
              {Copy.paywall.plan.loading}
            </Text>
          </View>
        )}

        {/* M8 (v23-ux-audit-r1): this used to be a bare View with no card, no theme spacing, and
            no alignment with the rest of the screen — it read as debug output. `<SurfaceCard>` +
            `<PillButton>` matches every other error state's own treatment (e.g. `analyzing.tsx`'s
            `ErrorPanel`). */}
        {plan.status === 'error' && (
          <SurfaceCard style={styles.planErrorCard} padding={Spacing.lg} accessibilityLiveRegion="polite">
            <Text style={styles.planStatusText}>{Copy.paywall.plan.error}</Text>
            <PillButton
              variant="ghost"
              label={Copy.paywall.plan.retry}
              accessibilityHint={Copy.paywall.plan.retryA11yLabel}
              onPress={() => {
                void fetchPlan();
              }}
            />
          </SurfaceCard>
        )}

        <View style={styles.cards}>
          <TierCard
            name={Copy.paywall.tier.free.name}
            price={Copy.paywall.tier.free.price}
            detail={Copy.paywall.tier.free.detail}
            cta={ctaForFree(plan)}
            styles={styles}
          />
          <TierCard
            name={Copy.paywall.tier.pro.name}
            price={Copy.paywall.tier.pro.price}
            detail={Copy.paywall.tier.pro.detail}
            cta={ctaForPurchasableTier('pro', plan, purchase, handleUpgrade)}
            styles={styles}
          />
          <TierCard
            name={Copy.paywall.tier.elite.name}
            price={Copy.paywall.tier.elite.price}
            detail={Copy.paywall.tier.elite.detail}
            cta={ctaForPurchasableTier('elite', plan, purchase, handleUpgrade)}
            styles={styles}
          />
        </View>

        <Text style={styles.footnote}>{Copy.paywall.footnote}</Text>
      </ScrollView>
      </SafeAreaView>
    </ScreenGradient>
  );
}

type Styles = ReturnType<typeof createStyles>;

type TierCardProps = {
  name: string;
  price: string;
  detail: string;
  cta: TierCardCta;
  styles: Styles;
};

function TierCard({ name, price, detail, cta, styles }: TierCardProps) {
  return (
    <SurfaceCard style={styles.card} padding={Spacing.xl}>
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

      {/* `secondary`, deliberately not `primary`: this screen offers a parallel choice between
          two upgrade paths and has no single primary action, so spending `Accent` here would
          break the "one accent, one CTA" rule constants/theme.ts states. The pill's secondary
          variant is the same `surface.raised` + `control.border` treatment this button already
          had — the shape changed, the restraint did not. */}
      {cta.kind === 'upgrade' && (
        <PillButton
          variant="secondary"
          label={cta.label}
          accessibilityHint={cta.busy ? Copy.paywall.purchase.pending : undefined}
          disabled={cta.disabled}
          busy={cta.busy}
          onPress={cta.onPress}
          style={styles.upgradeButton}
        />
      )}
    </SurfaceCard>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      // Transparent — `<ScreenGradient>` behind it owns the fill.
      backgroundColor: 'transparent',
    },
    content: {
      flexGrow: 1,
      padding: Spacing.xl,
      gap: Spacing.xl,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.lg,
    },
    titleBlock: {
      flex: 1,
      // Optically centres the title against the 44pt circular button beside it.
      paddingTop: Spacing.xs,
    },
    title: {
      fontFamily: FontFamily.display.bold,
      // xl -> xxl. The screen's largest element, and the only heading on it.
      fontSize: FontSize.xxl,
      letterSpacing: Tracking.display,
      lineHeight: FontSize.xxl * LineHeight.display,
      color: colors.text.primary,
    },
    // Calm, not alarmed — same "coach, not scold" treatment app/analyzing.tsx's ErrorPanel uses
    // (plain text.primary/text.secondary on a surface card, never Semantic.error): running out of
    // analyses is an expected, non-alarming state, not a system failure.
    gateBanner: {
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
      lineHeight: FontSize.sm * LineHeight.body,
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
      // On the wash — `text.primary` only (`Gradient`'s contract, constants/theme.ts).
      color: colors.text.primary,
    },
    planErrorCard: {
      gap: Spacing.sm,
      alignItems: 'flex-start',
    },
    cards: {
      gap: Spacing.lg,
    },
    card: {
      gap: Spacing.sm,
    },
    cardHeaderRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
    },
    cardName: {
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.xl,
      letterSpacing: Tracking.display,
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
      lineHeight: FontSize.sm * LineHeight.body,
      color: colors.text.secondary,
    },
    // A non-interactive label, not a disabled button — "Current plan" names a fact about this
    // card, not a control the user could have pressed (copy deck: "Disabled-state label").
    currentPlanBadge: {
      minHeight: HitTarget.min,
      alignItems: 'center',
      justifyContent: 'center',
      // `Radius.pill` and a hairline, not `control.border`: this is explicitly NOT a control (see
      // the comment above), and giving it the same 3:1 interactive boundary the upgrade pill has
      // is precisely what would make it look tappable. A quiet chip reads as a status.
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
      marginTop: Spacing.sm,
      paddingHorizontal: Spacing.lg,
    },
    currentPlanText: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.xs,
      letterSpacing: Tracking.eyebrow,
      textTransform: 'uppercase',
      color: colors.text.secondary,
    },
    // NOT Accent — theme.ts reserves that for "the primary CTA, and only the primary CTA," and
    // this screen has no single primary action (it's a parallel choice between two upgrade
    // paths, unlike Home's one CTA). Same bordered "secondary button" treatment
    // app/(auth)/sign-in.tsx uses for its own non-sole actions (Google/email sign-in): the
    // interactive-boundary `control.border` (issue #96) is what marks this as tappable, not fill
    // color.
    upgradeButton: {
      marginTop: Spacing.sm,
    },
    footnote: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.xs,
      lineHeight: FontSize.xs * LineHeight.body,
      // On the wash — `text.primary` only, at full opacity (the gradient does not prove
      // anything dimmer; H3, v23-ux-audit-r1: opacity here dropped this below WCAG AA).
      color: colors.text.primary,
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
