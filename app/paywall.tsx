/**
 * Screen 10 — Paywall (dummy) (issue #52), re-cut to V23-11 (2026-09-14): the captain-approved
 * page's two artboards — "Gated · Free exhausted" (back, "CHOOSE A PLAN", the gate card, three
 * tier cards, the footnote) and "Voluntary · Pro current · no downgrade offered" (the same with no
 * gate card, Pro selected, and the Free card carrying no control). One black column at the
 * gutter on `Ink.bg`; nothing animates.
 *
 * Reached two ways, and this screen does not need to tell them apart: (1) voluntarily, from
 * Settings' "See plans" (`settings.plan.cta`), or (2) via a quota-exhausted CTA tap on Home
 * (`home.cta.upgradeToAnalyze` / `.upgradeForMore`, issue #54) or a swallowed `402 quota_exceeded`
 * from `analyze-form` (issue #46's contract). Either way, this screen independently re-reads the
 * caller's CURRENT quota via `getQuotaStatus()` on mount and derives the gate banner
 * (`paywall.gate.free.*` / `.gate.paid.*`) from that fresh, server-authoritative read — never from
 * a route param a caller could get wrong or a client-held guess. A free user with
 * `remaining === 0` sees the free-gate banner regardless of how they got here, which is the
 * honest reading of the deck's "Shows when" column (a true CURRENT STATE, not a one-time event).
 *
 * ⚠️ COSMETIC ONLY — CLAUDE.md / issue #52's non-negotiable rule: nothing on this screen enforces
 * anything. `getQuotaStatus()`/`purchaseTier()` (`lib/subscription.ts`) only ever read/request —
 * `reserve_analysis` and `pace_purchase_tier` are the only things that actually decide quota or
 * grant a tier. The tier cards' Pro 10 / Elite 30 totals are cosmetic display copies of the
 * server contract, never enforcement inputs; the gate banner's account-specific `{limit}` and
 * renewal date come straight off the live `QuotaStatus` response. No frame cap is stated here.
 *
 * STATES BUILT: plan loading / ready / error+retry (mirrors `app/settings.tsx`'s identical Plan
 * section); the optional gate banner; three tier cards, each independently able to show "Current
 * plan", an "Upgrade to X" CTA, or (Free only) neither; a per-card purchase-pending spinner; and a
 * purchase result — a one-button `<ConfirmDialog>` notice, the page's own dialog pattern, in place
 * of the native `Alert` this screen used to raise. The dialog is local state (`notice`), so a
 * purchase settling after the screen has been popped simply never opens it (the mounted guard).
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TierCard, type TierCardCta } from '@/components/paywall/tier-card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SquareButton } from '@/components/ui/square-button';
import { SquareCard } from '@/components/ui/square-card';
import { SquareIconButton } from '@/components/ui/square-icon-button';
import { TopBar } from '@/components/ui/top-bar';
import { BackIcon } from '@/components/ui/v23-icons';
import { Copy } from '@/constants/copy';
import { Font, Ink, Layout, Space, Type } from '@/constants/v23-theme';
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

/** The one-button notice a purchase result opens. `null` is "no dialog up". */
type Notice = { title: string; body: string } | null;

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
  return {
    title: Copy.paywall.gate.paid.title,
    body: Copy.paywall.gate.paid.body(limit ?? 0, renewsOn),
  };
}

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
 * it is a CONFIRMED paid tier (the page's Voluntary artboard: Pro current, Free with no control). */
function ctaForFree(plan: PlanState): TierCardCta {
  if (plan.status === 'ready' && plan.data.tier !== 'free') return { kind: 'none' };
  return { kind: 'current' };
}

type TierKey = 'free' | 'pro' | 'elite';

/** The mark count is a property of the TIER, not of where its card renders — see
 *  `orderedTierKeys` below. */
const TIER_MARKS: Record<TierKey, number> = { free: 1, pro: 2, elite: 3 };

/** Captain's 2026-09-20 polish pass, item 5: "current plan on top". The ladder always lists
 *  free, pro, elite in that order UNLESS the plan read has confirmed a tier — then that tier's
 *  card moves to the front, and the rest follow in their usual order. Unresolved or errored
 *  reads keep the plain ladder order, matching `ctaForFree`'s own "no confirmed tier, no
 *  reordering either" caution. */
function orderedTierKeys(plan: PlanState): readonly TierKey[] {
  const LADDER: readonly TierKey[] = ['free', 'pro', 'elite'];
  if (plan.status !== 'ready') return LADDER;
  const current = plan.data.tier;
  return [current, ...LADDER.filter((key) => key !== current)];
}

export default function PaywallScreen() {
  const insets = useSafeAreaInsets();

  const [plan, setPlan] = useState<PlanState>({ status: 'loading' });
  const [purchase, setPurchase] = useState<PurchaseState>({ status: 'idle' });
  const [notice, setNotice] = useState<Notice>(null);

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
      setNotice({
        title: Copy.paywall.purchase.success.title(Copy.paywall.tier[result.data.tier].name),
        body: Copy.paywall.purchase.success.body,
      });
      return;
    }

    setNotice(purchaseFailureNotice(result.error.code));
  }

  /** Every `PurchaseErrorCode` `lib/subscription.ts` can return, switched exhaustively so a sixth
   *  code added there fails this to COMPILE rather than silently falling through to the wrong
   *  copy — same discipline `app/settings.tsx`'s `deleteAccountFailureNotice` uses.
   *  `unauthorized` / `purchase_unavailable` / `unknown` share the same generic, retryable copy —
   *  see `Copy.paywall.purchase.error.generic`'s own comment for why they don't each need their
   *  own string. */
  function purchaseFailureNotice(code: PurchaseErrorCode): Notice {
    switch (code) {
      case 'not_found':
        return {
          title: Copy.paywall.purchase.error.unavailable.title,
          body: Copy.paywall.purchase.error.unavailable.body,
        };
      case 'rate_limited':
        return {
          title: Copy.paywall.purchase.error.rateLimited.title,
          body: Copy.paywall.purchase.error.rateLimited.body,
        };
      case 'unauthorized':
      case 'purchase_unavailable':
      case 'unknown':
        return {
          title: Copy.paywall.purchase.error.generic.title,
          body: Copy.paywall.purchase.error.generic.body,
        };
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
        {/* The page's top row: the back glyph hung 12 pt past the gutter, then "CHOOSE A PLAN" in
            the small display role, set 4 pt down so its cap height sits level with the glyph —
            `<TopBar titleRole="displaySm">` owns that alignment. The control's a11y label carries
            the same word the visible label used to. */}
        <TopBar
          align="leading"
          titleRole="displaySm"
          title={Copy.paywall.title}
          leading={
            <SquareIconButton
              accessibilityLabel={Copy.paywall.back}
              bleed="left"
              onPress={() => {
                router.back();
              }}>
              <BackIcon />
            </SquareIconButton>
          }
        />

        {/* Calm, not alarmed: running out of analyses is an expected, non-alarming state, not a
            system failure — a plain card, the title in `ink`, the body in `ink2`, never `danger`. */}
        {gateBanner && (
          <SquareCard style={styles.gateBanner} accessibilityLiveRegion="polite">
            {/* A full sentence, so it stays a sentence — deliberately NOT the uppercase `label`
                register. The page sets it 600 16/24, which is not on the type scale. */}
            <Text style={styles.gateTitle}>{gateBanner.title}</Text>
            <Text style={styles.gateBody}>{gateBanner.body}</Text>
          </SquareCard>
        )}

        {/* Not drawn on the page: a quiet spinner and caption on one line, in `ink2`. The
            live-region caption beside it is what says what is happening. */}
        {plan.status === 'loading' && (
          <View style={styles.inlineRow}>
            <ActivityIndicator color={Ink.ink2} testID="paywall-plan-loading" />
            <Text style={styles.planStatusText} accessibilityLiveRegion="polite">
              {Copy.paywall.plan.loading}
            </Text>
          </View>
        )}

        {/* Not drawn on the page: the same card every other error state on the lane-2 screens
            takes — `note` copy in `ink2` and a link-variant Retry. */}
        {plan.status === 'error' && (
          <SquareCard style={styles.planErrorCard} accessibilityLiveRegion="polite">
            <Text style={styles.planErrorText}>{Copy.paywall.plan.error}</Text>
            <SquareButton
              variant="link"
              label={Copy.paywall.plan.retry}
              accessibilityHint={Copy.paywall.plan.retryA11yLabel}
              onPress={() => {
                void fetchPlan();
              }}
            />
          </SquareCard>
        )}

        {/* The three cards, each wearing one more rule than the free tier — see
            components/paywall/tier-card.tsx for why that is the honest picture of a tier ladder
            whose own footnote says the higher tiers are "more of it, not different". The mark
            counts are ornament, never a quota or an entitlement. Render ORDER is
            `orderedTierKeys`'s call, not the ladder's: a confirmed tier's card leads, the rest
            follow — the mark count stays fixed to the tier itself so a reordered card still
            wears its own rung, not the position it's rendered in. */}
        <View style={styles.cards}>
          {orderedTierKeys(plan).map((key) => (
            <TierCard
              key={key}
              testID={`paywall-tier-${key}`}
              name={Copy.paywall.tier[key].name}
              price={Copy.paywall.tier[key].price}
              detail={Copy.paywall.tier[key].detail}
              marks={TIER_MARKS[key]}
              cta={key === 'free' ? ctaForFree(plan) : ctaForPurchasableTier(key, plan, purchase, handleUpgrade)}
            />
          ))}
        </View>

        <Text style={styles.footnote}>{Copy.paywall.footnote}</Text>
      </ScrollView>

      {/* The purchase result. One dialog, driven by `notice`; the primary is its only button and
          reads as the dismiss (`<ConfirmDialog>`'s one-button contract). */}
      <ConfirmDialog
        visible={notice !== null}
        title={notice?.title ?? ''}
        body={notice?.body ?? ''}
        primary={{
          label: Copy.paywall.alertDismiss,
          onPress: () => {
            setNotice(null);
          },
        }}
        testID="paywall-notice"
      />
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
  // single column at the gutter (`padding:59px 24px 34px; gap:24px`); the vertical insets are the
  // live ones with the canvas's as minimums, applied inline.
  content: {
    flexGrow: 1,
    paddingHorizontal: Layout.gutter,
    gap: Space.xl,
  },
  gateBanner: {
    gap: Space.xs,
  },
  /** The page's `600 16px/24px` — Body's size and leading at the semiBold weight, a role the
   *  sheet does not name, so it is composed here from `Type.body` and the family token. */
  gateTitle: {
    ...Type.body,
    fontFamily: Font.tight.semiBold,
    color: Ink.ink,
  },
  gateBody: {
    ...Type.note,
    color: Ink.ink2,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  planStatusText: {
    ...Type.small,
    color: Ink.ink2,
  },
  planErrorCard: {
    gap: Space.sm,
    alignItems: 'flex-start',
  },
  planErrorText: {
    ...Type.note,
    color: Ink.ink2,
  },
  // The three cards' own type, spacing and CTA treatment live in
  // `components/paywall/tier-card.tsx` with the card itself — this screen owns only the ladder's
  // spacing (the page's `gap:16px`).
  cards: {
    gap: Space.lg,
  },
  footnote: {
    ...Type.footnote,
    color: Ink.ink,
    textAlign: 'center',
  },
});
