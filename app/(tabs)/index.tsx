import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KineticText } from '@/components/kinetic-text';
import { LowPolyField } from '@/components/low-poly-field';
import { Marquee } from '@/components/marquee';
import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { PillButton } from '@/components/ui/pill-button';
import { ScreenGradient } from '@/components/ui/screen-gradient';
import { SurfaceCard } from '@/components/ui/surface-card';
import { Copy } from '@/constants/copy';
import {
  Accent,
  Colors,
  ContentWidth,
  FontFamily,
  FontSize,
  LineHeight,
  Opacity,
  Spacing,
  TabBar,
  Tracking,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { pillarLabel } from '@/lib/pace-readout';
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
import { PACE_PILLARS } from '@shared/pace';

/** The four pillar names, in fixed order, for the standing ticker at the foot of the screen. Read
 * from the SAME `PACE_PILLARS` / `pillarLabel` pair the result readout uses, never re-typed here —
 * a marquee that named a fifth pillar, or named one differently from the readout, would be a
 * product lie rather than a styling bug. */
const PILLAR_TICKER = PACE_PILLARS.map(pillarLabel);

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
      unlimited: state.unlimited,
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
    // full contract. The endpoint has been deployed to the live project since 2026-07-26; any
    // failure here is still handled by the `error` branch below, never papered over with a
    // guessed quota.
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
    <ScreenGradient>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {/* Same ScrollView + flexGrow:1 pattern as app/(auth)/sign-in.tsx: the content still
          centers when there is room, but at the largest Dynamic Type sizes it scrolls instead
          of clipping (design brief §7: layouts reflow, never clip). */}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* The top bar: a tracked-out wordmark and one circular glass control — replacing the old
            "big heading + underlined text link" row. `Copy.home.title` is unchanged and still
            carries `accessibilityRole="header"`; only its type role moved, from a 24pt display
            heading to the eyebrow register, because on this screen the heading is chrome and the
            CTA block is the subject. */}
        <View style={styles.topBar}>
          <Eyebrow tone="primary" style={styles.wordmark} testID="home-title">
            {Copy.home.title}
          </Eyebrow>
          {/* Sign-out USED to live here as an M1 stub. Issue #53 moved it to Settings — its real
              home, alongside delete-account — and this link is now the entry point to that screen.
              Issue #27 (sign-out was fire-and-forget, so a failed global token revoke was silent)
              is fixed there, once, rather than twice: see lib/sign-out.ts. */}
          <CircleIconButton
            accessibilityLabel={Copy.settings.title}
            onPress={() => {
              router.push('/settings');
            }}
            testID="home-settings">
            <MaterialIcons name="tune" size={20} color={colors.text.primary} />
          </CircleIconButton>
        </View>

        {/* Issue #140: surfaced once, at most, per reconciled analysis — `checkPendingAnalysis`
            has already cleared the marker by the time this renders, so dismissing (or simply
            navigating away) never re-shows it on a later focus, and a later cold start can never
            resurrect it either. Home is not a dead end underneath this: the primary CTA and
            Settings link above stay fully usable while this is showing. Same calm, non-alarmed
            treatment `app/analyzing.tsx`'s own ErrorPanel documents for itself — plain
            text.primary/text.secondary, no Semantic.error red. */}
        {pendingReleased && (
          <SurfaceCard tone="raised" style={styles.pendingReleasedBanner}>
            <Text style={styles.pendingReleasedTitle} accessibilityLiveRegion="polite">
              {Copy.home.pending.released.title}
            </Text>
            <Text style={styles.pendingReleasedBody}>{Copy.home.pending.released.body}</Text>
            <PillButton
              variant="ghost"
              label={Copy.home.pending.released.dismiss}
              onPress={() => setPendingReleased(null)}
              style={styles.bannerDismiss}
            />
          </SurfaceCard>
        )}

        <View style={styles.centerBlock}>
          {/* The hero. A large, ambient low-poly mark sits behind the empty-state line, so a
              user with nothing analyzed yet still lands on a composed screen rather than on a
              caption and a button floating in space. It is decorative and hidden from the a11y
              tree (see LowPolyField), and it renders — statically — under reduced motion too:
              the composition is the point, the movement is the enhancement. */}
          <View style={styles.heroBlock}>
            <LowPolyField
              color={colors.text.primary}
              size={HERO_MARK_SIZE}
              style={styles.heroMark}
              testID="home-hero-mark"
            />
            {/* The screen's ONE oversized element (spec 2026-07-26 §3.1's "at most one
                display-or-larger element per screen", still honoured). Assembles word by word on
                arrival — the app's signature type behaviour. */}
            <KineticText
              style={styles.heroLine}
              containerStyle={styles.heroLineRow}
              staggerMs={90}
              testID="home-hero-line">
              {Copy.home.empty.caption}
            </KineticText>
          </View>

          {/* Quota lives on an OPAQUE card, never directly on the wash: these captions are
              `text.secondary`, and `Gradient`'s own contract (constants/theme.ts) proves the wash
              for `text.primary` only. That rule is why this block gained a card in the redesign
              rather than being left as bare text over the gradient. */}
          <SurfaceCard style={styles.quotaCard} testID="home-quota-card">
            {quota.status === 'loading' && (
              <View style={styles.quotaBlock}>
                <ActivityIndicator color={colors.text.secondary} />
                <Text style={styles.quotaCaption} accessibilityLiveRegion="polite">
                  {Copy.home.quota.loading}
                </Text>
              </View>
            )}

            {quota.status === 'ready' && readyCaption && (
              <View style={styles.quotaBlock}>
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
              <View style={styles.quotaBlock}>
                <Text style={styles.quotaCaption} accessibilityLiveRegion="polite">
                  {quota.lastKnown ? describeQuota(quota.lastKnown).primary : Copy.home.quota.error.failed}
                </Text>
                {/* Only pair the "last known" caption with an actual last-known value — showing
                    it next to the plain failure line above would imply a cached value exists
                    when there isn't one. */}
                {quota.lastKnown !== null && (
                  <Text style={styles.quotaStaleCaption}>{Copy.home.quota.error.stale}</Text>
                )}
                <PillButton
                  variant="ghost"
                  label={Copy.home.quota.error.retry}
                  onPress={() => {
                    fetchQuota(activeFlagRef.current);
                  }}
                  style={styles.quotaRetry}
                />
              </View>
            )}
          </SurfaceCard>

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
          <PillButton
            label={ctaLabel}
            accessibilityHint={ctaHint ?? undefined}
            disabled={!ctaEnabled}
            onPress={() => {
              if (ctaKind === 'upgradeToAnalyze' || ctaKind === 'upgradeForMore') {
                router.push('/paywall');
              } else {
                router.push('/capture');
              }
            }}
            icon={<MaterialIcons name="arrow-forward" size={20} color={Accent.onAccent} />}
            testID="home-primary-cta"
          />
        </View>

        {/* The standing ticker. It names the four things this app measures, which is the only
            place a user who has not yet submitted anything can learn them. Sourced from the same
            PACE_PILLARS the readout renders — see PILLAR_TICKER at the top of this file. */}
        <Marquee
          items={PILLAR_TICKER}
          textStyle={styles.tickerText}
          separatorStyle={styles.tickerSeparator}
          style={styles.ticker}
          testID="home-pillar-ticker"
        />
        </ScrollView>
      </SafeAreaView>
    </ScreenGradient>
  );
}

/** The ambient hero mark's drawn size. Fixed points rather than a percentage: it must stay the
 *  same optical weight on a small phone and a tablet, where the readable column is capped anyway
 *  (`ContentWidth.readable`), and a percentage-sized decorative mark would balloon on the latter. */
const HERO_MARK_SIZE = 220;

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      // Transparent, NOT `colors.background`: this screen now sits on `<ScreenGradient>`, and an
      // opaque SafeAreaView here would paint the wash out entirely. The gradient component carries
      // the opaque fallback fill behind itself instead.
      backgroundColor: 'transparent',
    },
    // `flex` ONLY. Child-layout props (alignItems/justifyContent/...) are ILLEGAL in a
    // ScrollView's `style` and throw at render: "ScrollView child layout must be applied
    // through the contentContainerStyle prop." The readable column is therefore centred by
    // `alignSelf: 'center'` on the contentContainerStyle below, not from here (issue #63).
    scroll: {
      flex: 1,
    },
    content: {
      // flexGrow (not flex) — this is a ScrollView contentContainerStyle now: it fills the
      // viewport when the content is short, and grows past it when Dynamic Type makes it tall.
      flexGrow: 1,
      width: '100%',
      maxWidth: ContentWidth.readable,
      alignSelf: 'center',
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.lg,
      // The tab bar floats now and reserves no layout space — see `TabBar` in constants/theme.ts.
      // Without this the ticker would sit under the bar.
      paddingBottom: TabBar.clearance,
      gap: Spacing.xxl,
    },
    topBar: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: Spacing.md,
      justifyContent: 'space-between',
    },
    wordmark: {
      // Takes the middle of the row so the two flanking controls stay pinned to the edges,
      // matching the reference's centred wordmark.
      flex: 1,
      textAlign: 'center',
    },
    // Issue #140. Same neutral-surface treatment `components/partial-result-banner.tsx` (issue
    // #56) uses for its own honesty disclosure — a `surface.raised` card, not `Semantic.error`,
    // matching that component's own reasoning: this is a "here's what happened" notice, not a
    // system failure or a low score. Now a `<SurfaceCard>`, so its corner comes from `Radius.card`
    // like every other panel rather than being restated here.
    pendingReleasedBanner: {
      gap: Spacing.xs,
    },
    pendingReleasedTitle: {
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.lg,
      color: colors.text.primary,
    },
    pendingReleasedBody: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      lineHeight: FontSize.sm * LineHeight.body,
      color: colors.text.secondary,
    },
    bannerDismiss: {
      alignSelf: 'flex-start',
      marginLeft: -Spacing.lg, // cancel the ghost pill's own padding so its label aligns with the body
    },
    centerBlock: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xl,
    },
    heroBlock: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroMark: {
      // Behind the line, not above it — the mark is atmosphere. Absolute so it never adds height
      // and can therefore never push the CTA below the fold on a small device.
      position: 'absolute',
      opacity: Opacity.disabled,
    },
    heroLineRow: {
      justifyContent: 'center',
      // Room for the mark to breathe around the words it sits behind.
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.xxxl,
    },
    heroLine: {
      color: colors.text.primary,
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.xxl,
      letterSpacing: Tracking.display,
      lineHeight: FontSize.xxl * LineHeight.display,
      textAlign: 'center',
    },
    quotaCard: {
      alignSelf: 'stretch',
    },
    quotaBlock: {
      alignItems: 'center',
      gap: Spacing.xs,
    },
    quotaCaption: {
      fontFamily: FontFamily.mono.regular,
      fontSize: FontSize.md,
      color: colors.text.secondary,
      textAlign: 'center',
    },
    quotaStaleCaption: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.xs,
      color: colors.text.secondary,
      textAlign: 'center',
    },
    quotaRetry: {
      marginTop: Spacing.xs,
    },
    ticker: {
      // Bleeds past the readable column's padding so the strip runs edge to edge, which is what
      // makes it read as a ticker rather than as a centred caption.
      marginHorizontal: -Spacing.xl,
      opacity: Opacity.disabled,
      paddingVertical: Spacing.sm,
    },
    tickerText: {
      color: colors.text.primary,
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.lg,
      letterSpacing: Tracking.eyebrow,
      textTransform: 'uppercase',
    },
    tickerSeparator: {
      color: colors.text.primary,
      fontFamily: FontFamily.display.regular,
      fontSize: FontSize.lg,
    },
  });
}
