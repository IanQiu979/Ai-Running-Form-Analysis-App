import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RecentAnalysis, type RecentAnalysisState } from '@/components/home/recent-analysis';
import { Marquee } from '@/components/marquee';
import { SquareButton } from '@/components/ui/square-button';
import { SquareCard } from '@/components/ui/square-card';
import { SquareIconButton } from '@/components/ui/square-icon-button';
import { TopBar } from '@/components/ui/top-bar';
import { ArrowRightIcon, SettingsIcon } from '@/components/ui/v23-icons';
import { Copy } from '@/constants/copy';
import { Font, Ink, Layout, Space, Type } from '@/constants/v23-theme';
import { fetchHistoryList, type HistoryListItem } from '@/lib/history';
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

/** The page's ticker strip is `margin: 0 -24px 128px`. 128 is the bottom safe area (34, already
 *  paid by the content padding) + the floating tab bar (64) + 30 pt of air between the strip and
 *  the bar; the bar's height and this air are what the content pads below the strip, and the safe
 *  area is paid once, by the scroll container's `paddingBottom`. */
const TICKER_AIR_ABOVE_TAB_BAR = 30;
const TICKER_STRIP_HEIGHT = 40;
/** The page's ticker type: `700 20px/24px Barlow Condensed`, +6 % (1.2 pt at 20), uppercase.
 *  Not a `Type` role — the sheet has no 20 pt condensed uppercase — so the page's numbers stand
 *  here, on the one screen that draws them. */
const TICKER_FONT_SIZE = 20;
const TICKER_LINE_HEIGHT = 24;
const TICKER_LETTER_SPACING = 1.2;
const TICKER_OPACITY = 0.5;

export default function HomeScreen() {
  // Live insets, with the design canvas's safe areas as the floor (the pages were drawn on
  // 59 / 34), same as `app/(auth)/details.tsx`. The bottom inset is what the floating tab bar
  // sits above (`app/(tabs)/_layout.tsx`), so the content pays it once here and the bar's own
  // height plus its air go on the ticker strip below.
  const insets = useSafeAreaInsets();
  const contentStyle = [
    styles.content,
    {
      paddingTop: Math.max(insets.top, Layout.canvas.safeTop),
      paddingBottom: Math.max(insets.bottom, Layout.canvas.safeBottom),
    },
  ];
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

  // Cadence Arcs (2026-09-01): Home's hero is now the user's most recent analysis, and this is
  // the read behind it. Design brief §4.2 always asked for it ("once there's history, the most
  // recent gait-plate thumbnail") — Home shipped without any route back to a finished result, so
  // the only way to reopen one was the History tab.
  //
  // It reuses `lib/history.ts`'s `fetchHistoryList` and takes the first row rather than adding a
  // limit-1 query: that function already orders `created_at desc` and already applies the "which
  // rows are honestly showable" rules (delivered, not soft-deleted, structurally valid), and
  // re-deriving any of that here — in a screen — is exactly the duplication `lib/` exists to
  // prevent. It is a plain RLS-guarded read of the caller's own rows, the same one the History
  // tab makes; no tier, quota or ownership decision is taken here.
  const [recent, setRecent] = useState<RecentAnalysisState>({ status: 'loading' });

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

  // Threaded through the SAME ActiveFlag the quota fetch uses (see its type doc above), so a stale
  // focus's read can never overwrite a newer one. `fetchHistoryList` throws on any query failure
  // (it fails closed on purpose — see its own doc comment), which is why the catch lands on
  // `unavailable` rather than on `empty`: an outage must never be rendered as "you have no
  // analyses". Never blocks or delays the quota fetch; the two are independent.
  const fetchRecent = useCallback(async (active: ActiveFlag) => {
    if (!userId) return;

    let items: HistoryListItem[];
    try {
      items = await fetchHistoryList();
    } catch {
      if (active.active) setRecent({ status: 'unavailable' });
      return;
    }

    if (!active.active) return;
    const newest = items[0];
    setRecent(newest ? { status: 'ready', item: newest } : { status: 'empty' });
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
      // Refetched on every focus for the same reason quota is: returning from a just-finished
      // analysis must show it as the most recent one without an app restart.
      fetchRecent(active);
      return () => {
        active.active = false;
      };
    }, [fetchQuota, fetchRecent])
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
    // The screen paints `Ink.bg` itself — this system has one scheme and no wash. No
    // `SafeAreaView`: the scroll container pays the top and bottom insets directly (see
    // `contentStyle` above), and the floating tab bar is the navigator's, not this screen's — Home
    // only leaves room for it under the ticker.
    <View style={styles.screen}>
      {/* Same ScrollView + flexGrow:1 pattern as app/(auth)/sign-in.tsx: the content still
          centers when there is room, but at the largest Dynamic Type sizes it scrolls instead
          of clipping (design brief §7: layouts reflow, never clip). */}
      <ScrollView style={styles.scroll} contentContainerStyle={contentStyle}>
        {/* The page's top row: a 44 pt spacer, "HOME" centred, and the Settings control bled 12 pt
            past the gutter so its glyph lands on the column. `Copy.home.title` is unchanged and
            `<TopBar>` still gives it `accessibilityRole="header"`. Sign-out USED to live here as an
            M1 stub; issue #53 moved it to Settings — its real home, alongside delete-account — and
            this control is the entry point to that screen (issue #27's silent sign-out failure is
            fixed there, once: see lib/sign-out.ts). */}
        <TopBar
          title={Copy.home.title}
          titleTestID="home-title"
          trailing={
            <SquareIconButton
              accessibilityLabel={Copy.settings.title}
              bleed="right"
              onPress={() => {
                router.push('/settings');
              }}
              testID="home-settings">
              <SettingsIcon />
            </SquareIconButton>
          }
        />

        {/* Issue #140: surfaced once, at most, per reconciled analysis — `checkPendingAnalysis`
            has already cleared the marker by the time this renders, so dismissing (or simply
            navigating away) never re-shows it on a later focus, and a later cold start can never
            resurrect it either. Home is not a dead end underneath this: the primary CTA and
            Settings control above stay fully usable while this is showing. Not drawn on the page;
            a plain card in `ink`/`ink2`, no `danger` — a "here is what happened" notice, not a
            failure. */}
        {pendingReleased && (
          <SquareCard style={styles.pendingReleasedBanner}>
            <Text style={styles.pendingReleasedTitle} accessibilityLiveRegion="polite">
              {Copy.home.pending.released.title}
            </Text>
            <Text style={styles.pendingReleasedBody}>{Copy.home.pending.released.body}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={Copy.home.pending.released.dismiss}
              onPress={() => setPendingReleased(null)}
              style={({ pressed }) => [styles.textLink, pressed && styles.pressed]}>
              <Text style={styles.textLinkLabel}>{Copy.home.pending.released.dismiss}</Text>
            </Pressable>
          </SquareCard>
        )}

        {/* The page's centre block: the recent analysis, the quota card and the primary CTA,
            24 pt apart, centred in whatever height is left between the top row and the ticker. */}
        <View style={styles.centerBlock}>
          {/* The lead card is the user's most recent analysis — the page's "Overall" card with
              the numeral and the P/A/C/E row — and tapping it reopens that result. With no history
              it is the page's dashed empty box. See `components/home/recent-analysis.tsx` for the
              four states and why a failed read is a separate one from "empty". */}
          <RecentAnalysis
            state={recent}
            onOpen={(item) => {
              router.push({ pathname: '/result/[id]', params: { id: item.id } });
            }}
          />

          {/* The quota card: the page's 16 pt card with a centred mono caption and, for a
              period-based plan, the "Renews …" line under it in `ink3` — the page draws that line
              `#5C5C5C`, so this is the one line on the screen the placeholder tone carries. */}
          <SquareCard style={styles.quotaCard} testID="home-quota-card">
            {quota.status === 'loading' && (
              <>
                <ActivityIndicator color={Ink.ink2} testID="home-quota-loading" />
                <Text style={styles.quotaCaption} accessibilityLiveRegion="polite">
                  {Copy.home.quota.loading}
                </Text>
              </>
            )}

            {quota.status === 'ready' && readyCaption && (
              <>
                <Text style={styles.quotaCaption} accessibilityLiveRegion="polite">
                  {readyCaption.primary}
                </Text>
                {/* Pro/Elite's "Renews {date}" secondary line, or issue #6's anti-farm "blocked"
                    notice — never both; see lib/quota.ts's `describeQuota`. */}
                {readyCaption.secondary !== null && (
                  <Text style={styles.quotaSecondary}>{readyCaption.secondary}</Text>
                )}
              </>
            )}

            {quota.status === 'error' && (
              <>
                <Text style={styles.quotaCaption} accessibilityLiveRegion="polite">
                  {quota.lastKnown ? describeQuota(quota.lastKnown).primary : Copy.home.quota.error.failed}
                </Text>
                {/* Only pair the "last known" caption with an actual last-known value — showing
                    it next to the plain failure line above would imply a cached value exists
                    when there isn't one. */}
                {quota.lastKnown !== null && (
                  <Text style={styles.quotaSecondary}>{Copy.home.quota.error.stale}</Text>
                )}
                {/* The page draws no error state; the retry is a quiet text link, 44 pt tall. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={Copy.home.quota.error.retry}
                  onPress={() => {
                    fetchQuota(activeFlagRef.current);
                  }}
                  style={({ pressed }) => [styles.textLink, pressed && styles.pressed]}
                  testID="home-quota-retry">
                  <Text style={styles.textLinkLabel}>{Copy.home.quota.error.retry}</Text>
                </Pressable>
              </>
            )}
          </SquareCard>

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
          <SquareButton
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
            trailing={<ArrowRightIcon />}
            testID="home-primary-cta"
          />
        </View>

        {/* The standing ticker. It names the four things this app measures, which is the only
            place a user who has not yet submitted anything can learn them. Sourced from the same
            PACE_PILLARS the readout renders — see PILLAR_TICKER at the top of this file. */}
        <Marquee
          items={PILLAR_TICKER}
          textStyle={styles.tickerText}
          separatorStyle={styles.tickerText}
          style={styles.ticker}
          testID="home-pillar-ticker"
        />
      </ScrollView>
    </View>
  );
}

const PRESSED_OPACITY = 0.6;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Ink.bg,
  },
  // `flex` ONLY. Child-layout props (alignItems/justifyContent/...) are ILLEGAL in a
  // ScrollView's `style` and throw at render: "ScrollView child layout must be applied
  // through the contentContainerStyle prop."
  scroll: {
    flex: 1,
  },
  content: {
    // flexGrow (not flex) — this is a ScrollView contentContainerStyle: it fills the viewport
    // when the content is short, and grows past it when Dynamic Type makes it tall. The page is
    // a single column at the gutter; the top and bottom insets are applied at the render site.
    flexGrow: 1,
    paddingHorizontal: Layout.gutter,
  },
  // Issue #140. Not on the page; a plain raised card in the body register, the dismiss a text
  // link under it.
  pendingReleasedBanner: {
    gap: Space.xs,
    marginTop: Space.xl,
  },
  pendingReleasedTitle: {
    ...Type.body,
    fontFamily: Font.tight.semiBold,
    color: Ink.ink,
  },
  pendingReleasedBody: {
    ...Type.note,
    color: Ink.ink2,
  },
  // A text-only control: the label register in `ink`, on a 44 pt row so it stays tappable.
  textLink: {
    minHeight: Layout.hitTarget,
    justifyContent: 'center',
  },
  textLinkLabel: {
    ...Type.label,
    color: Ink.ink,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  centerBlock: {
    flex: 1,
    justifyContent: 'center',
    gap: Space.xl,
  },
  quotaCard: {
    alignItems: 'center',
    gap: Space.xs,
  },
  quotaCaption: {
    ...Type.mono,
    color: Ink.ink2,
    textAlign: 'center',
  },
  quotaSecondary: {
    ...Type.small,
    color: Ink.ink3,
    textAlign: 'center',
  },
  // The page's strip: 40 pt tall, bled to the screen edges past the gutter, at half opacity, with
  // the tab bar's height plus its air below it (the safe area is the content's own padding).
  ticker: {
    height: TICKER_STRIP_HEIGHT,
    justifyContent: 'center',
    marginHorizontal: -Layout.gutter,
    marginBottom: Layout.tabBar.height + TICKER_AIR_ABOVE_TAB_BAR,
    opacity: TICKER_OPACITY,
  },
  tickerText: {
    fontFamily: Font.condensed.bold,
    fontSize: TICKER_FONT_SIZE,
    lineHeight: TICKER_LINE_HEIGHT,
    letterSpacing: TICKER_LETTER_SPACING,
    textTransform: 'uppercase',
    color: Ink.ink,
  },
});
