/**
 * result/[id] — the PACE readout (issue #56). "This is the product's payload. Everything else
 * in the app exists to get the user here."
 *
 * Renders BOTH a fresh M4 result and a re-opened stored one with the SAME code path: this screen
 * always fetches its own `analyses` row by `id` and renders from that — a freshly-delivered
 * analysis is just a row whose insert happened moments ago (`analyze-form` (#44, deployed since
 * issue #128) already persists the row before returning `{ result, analysisId, isFallback }` to
 * the client — see `docs/architecture.md`'s "Current — `analyze-form` edge function" section),
 * so there is no second, parallel "render whatever the API call just returned" path to keep in
 * sync with this one.
 *
 * Business logic this screen deliberately does NOT contain (CLAUDE.md: "No business rules in the
 * client"): it never re-derives tier, quota, or which fields a Free vs. Pro/Elite result should
 * carry — `<PaceReadout>` renders exactly the `flags`/`drills` arrays it's given, and the server
 * is what ships them empty or full.
 *
 * `readAnalysisRow` (`lib/analysis-result.ts`) is the pure, tested half of the state machine
 * below; this file is the thin I/O glue around it (Supabase fetch + hero-frame signed URL),
 * which is why the logic worth proving lives in `lib/`, not here (screens aren't unit-tested by
 * convention).
 *
 * THE HERO (V23-08): the stored frame is the first thing on the screen — full-bleed, edge to
 * edge, reaching the very top of the device with no safe-area inset above it, at the page's 3:4
 * box — graded through `<DuotoneFrame>`, with an inset vignette drawn over it. The drawn
 * annotation marks (`components/annotation-lines.tsx`) were removed 2026-09-20 (captain's phone
 * test: "completely removed") — the component and its tests are gone, not just unmounted. When
 * there is no image the page's placeholder gradient takes the frame's place and the vignette
 * still draws over it; while a signed URL is in flight the same box holds a quiet spinner, so the
 * readout below never jumps when the image lands.
 *
 * MOTION (issue #61): `justAnalyzed` is read straight off the route params and forwarded to
 * `<PaceReadout>` as `firstReveal` — nothing else on this screen branches on it. Both writers of
 * this param (`app/analyzing.tsx`'s success effect and `app/(tabs)/index.tsx`'s cold-start
 * reconciliation) already match motion-consult.md item 3's example verbatim: "ephemeral only — a
 * nav param ... set immediately after the analyze call succeeds ... never derived from
 * AsyncStorage or a DB field, so it can't replay after relaunch nor suppress a genuine first
 * view." A plain re-open from Past Analyses never sets it, so `firstReveal` defaults to false
 * there and `<PaceReadout>` renders its ordinary static, finished state. The page is otherwise
 * static: the bar fill in the readout is the only motion on it, and the hero does not animate.
 *
 * MOTION (issue #61) — the scroll container: motion-consult.md item 5, "build on Reanimated's
 * `Animated.ScrollView` + `useAnimatedRef` from day one (zero effects wired now) so the post-MVP
 * scroll-driven phase is additive, not a container swap." `scrollRef` below has no reader yet —
 * this is that plumbing, not new visible motion.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedRef } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { DuotoneFrame } from '@/components/duotone-frame';
import { PartialResultBanner } from '@/components/partial-result-banner';
import { PaceReadout } from '@/components/pace-readout';
import { ResultDisclaimer } from '@/components/result-disclaimer';
import { SquareButton } from '@/components/ui/square-button';
import { SquareCard } from '@/components/ui/square-card';
import { Copy } from '@/constants/copy';
import { Ink, Layout, Space, Type } from '@/constants/v23-theme';
import { readAnalysisRow, type AnalysisRow } from '@/lib/analysis-result';
import { countAssessedPillars } from '@/lib/pace-readout';
import {
  takePendingAnalysisResult,
  type PendingAnalysisResult,
} from '@/lib/pending-analysis-result';
import { supabase } from '@/lib/supabase';
import { useAnnounce } from '@/lib/use-announce';
import type { PaceAnalysisOutcome } from '@shared/pace';

// The private frame bucket (`supabase/migrations/20260711150500_media_storage_bucket.sql`) —
// there are no public URLs, only owner-scoped signed reads (CLAUDE.md § Secrets & env).
const MEDIA_BUCKET = 'media';
// "~1h, regenerated on open" per docs/architecture.md's "Current — media pipeline".
const HERO_SIGNED_URL_TTL_SECONDS = 60 * 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The page's hero box: `aspect-ratio: 3/4` at full width. `<DuotoneFrame>` renders at the same
 *  ratio, so the frame fills the box exactly and the placeholder, the pending spinner and the real
 *  image all occupy one identical box — nothing below the hero moves when the image lands. */
const HERO_ASPECT_RATIO = 3 / 4;

/** The page's vignette: `box-shadow: inset 0 0 120px 40px rgba(10,10,10,.75)` — clear at the
 *  centre, `Ink.bg` at 75 % at the edges. Drawn as a radial gradient over the hero box; the ids
 *  are page-unique so two `<Defs>` in one screen can never collide. */
const VIGNETTE_ID = 'result-hero-vignette';
const VIGNETTE_EDGE_OPACITY = 0.75;
/** Where the falloff begins, as a fraction of the gradient radius. The page's shadow has a 40 px
 *  spread and a 120 px blur inside a 393 x 524 box, so the middle of the frame stays clear and
 *  the darkening lives in the outer third. */
const VIGNETTE_CLEAR_STOP = 0.55;
const VIGNETTE_RADIUS = '72%';
/** The page's no-image placeholder: `linear-gradient(180deg, #1E1E1E 0%, #101010 100%)` —
 *  `Ink.bgPlaceholder` at the top to `Ink.bg` at the bottom, the closest token pair. */
const PLACEHOLDER_ID = 'result-hero-placeholder';

type ScreenState =
  | { status: 'loading' }
  | { status: 'loadFailed' }
  | { status: 'unavailable' }
  | {
      status: 'ready';
      outcome: PaceAnalysisOutcome;
      heroUri: string | null;
      /** True only while a `heroPath` exists and its signed-URL resolution is still in flight —
       * distinguished from "resolved to null" (no image at all) so the hero box can hold a
       * spinner for an image on its way in and the placeholder gradient for one that never comes. */
      heroPending: boolean;
      /** M3 (v23-ux-audit-r1): threaded through to `<PartialResultBanner>` so its copy can say
       * "photo" instead of always "clip". */
      mediaType: 'photo' | 'video';
    };

/** Mirrors `app/(tabs)/index.tsx`'s own `ActiveFlag` pattern: minted per fetch attempt, flipped
 * off on unmount/re-fetch, so a slow or stale request can never overwrite a newer one's state. */
type ActiveFlag = { active: boolean };

/**
 * Ends a row lookup that produced no readable analysis (review r7-4).
 *
 * WITH a handoff, the failure only means there is no hero frame to add — the result itself is
 * already on screen and stays there, because the server computed it and sent it to us. WITHOUT
 * one, the fallback is unchanged: the screen says it could not load or could not find the
 * analysis, which is still the whole truth for a re-open from Past Analyses.
 */
function settleWithoutHero(
  handoff: PendingAnalysisResult | null,
  setState: (updater: (current: ScreenState) => ScreenState) => void,
  fallback: ScreenState
): void {
  if (!handoff) {
    setState(() => fallback);
    return;
  }
  setState((current) =>
    current.status === 'ready' ? { ...current, heroUri: null, heroPending: false } : current
  );
}

async function resolveHeroImageUri(path: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, HERO_SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    // Best-effort only: a hero image that fails to resolve is a "no image" state, not a reason
    // to fail the whole result — the PACE readout itself is still real and still renders.
    return null;
  }
}

export default function ResultScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[]; justAnalyzed?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  // Motion-consult.md item 3's own example param name and value, verbatim — see this file's
  // header. Read once per mount; a later re-render (e.g. the hero image resolving) never flips it.
  const justAnalyzed = (Array.isArray(params.justAnalyzed) ? params.justAnalyzed[0] : params.justAnalyzed) === '1';
  // See this file's header (motion-consult.md item 5) — unread today, on purpose.
  const scrollRef = useAnimatedRef<Animated.ScrollView>();

  const [state, setState] = useState<ScreenState>({ status: 'loading' });
  const activeFlagRef = useRef<ActiveFlag>({ active: false });
  // Review r7-4: the result `app/analyzing.tsx` was just handed, if this is that navigation.
  // Claimed ONCE, on the first render of this mount (a `useRef` initialised lazily, not an
  // effect — the very first `load()` has to already know whether it has an answer in hand), and
  // one-shot at the source, so a later Retry or a re-open never replays it. `null` for every
  // ordinary open from Past Analyses, which reads the persisted row exactly as it always has.
  const handoffRef = useRef<PendingAnalysisResult | null | undefined>(undefined);
  if (handoffRef.current === undefined) {
    handoffRef.current = justAnalyzed && typeof id === 'string' ? takePendingAnalysisResult(id) : null;
  }
  // Issue #11: the loading/error captions below carry `accessibilityLiveRegion="polite"`, which
  // is Android-only — this is the iOS complement, same pattern as app/(tabs)/index.tsx.
  useAnnounce(
    state.status === 'loading'
      ? Copy.result.loadingFromHistory
      : state.status === 'loadFailed'
        ? Copy.result.error.loadFailed
        : state.status === 'unavailable'
          ? Copy.result.error.notFound
          : null
  );

  const load = useCallback(
    async (active: ActiveFlag) => {
      if (!id || !UUID_PATTERN.test(id)) {
        if (active.active) setState({ status: 'unavailable' });
        return;
      }

      // THE SERVER'S OWN ANSWER FIRST, when we have it. A zero-pillars-assessed 200 returns a
      // complete, honest all-null readout for a reservation that was RELEASED rather than settled
      // — nobody is charged for a result carrying nothing (cd8bf97 / PR #194) — so there is no
      // readable row behind that id, and rendering the fetch's verdict would turn a real answer
      // into "we couldn't find this analysis." The row lookup below still runs, but from here it
      // can only ADD the hero frame; it can no longer take the result away.
      const handoff = handoffRef.current ?? null;
      if (handoff) {
        setState({
          status: 'ready',
          outcome: handoff.outcome,
          heroUri: null,
          heroPending: true,
          mediaType: handoff.mediaType,
        });
      } else {
        setState({ status: 'loading' });
      }

      let row: AnalysisRow | null;
      try {
        const { data, error } = await supabase
          .from('analyses')
          .select('status, result, is_fallback, media_paths, media_type, deleted_at')
          .eq('id', id)
          .maybeSingle();

        if (error) {
          if (active.active) settleWithoutHero(handoff, setState, { status: 'loadFailed' });
          return;
        }
        row = data;
      } catch {
        if (active.active) settleWithoutHero(handoff, setState, { status: 'loadFailed' });
        return;
      }

      const read = readAnalysisRow(row);
      if (!active.active) return;

      if (read.kind === 'notFound') {
        settleWithoutHero(handoff, setState, { status: 'unavailable' });
        return;
      }
      if (read.kind === 'invalid') {
        // Structurally malformed stored data is at least as "nothing to show" as a missing row —
        // collapsed into the same copy rather than a separate, more alarming message (the fetch
        // itself succeeded; the payload just isn't a valid PaceAnalysisOutcome).
        settleWithoutHero(handoff, setState, { status: 'unavailable' });
        return;
      }

      const heroPath = read.mediaPaths[0];
      setState({
        // The persisted row and the handoff describe the same analysis; the handoff wins only
        // where there is no row to read. Preferring the row for a delivered analysis keeps a
        // fresh open and a re-open from Past Analyses rendering byte-identical content.
        status: 'ready',
        outcome: read.outcome,
        heroUri: null,
        heroPending: !!heroPath,
        mediaType: read.mediaType,
      });

      if (heroPath) {
        const heroUri = await resolveHeroImageUri(heroPath);
        if (active.active) {
          setState((current) =>
            current.status === 'ready' ? { ...current, heroUri, heroPending: false } : current
          );
        }
      }
    },
    [id]
  );

  useEffect(() => {
    const active: ActiveFlag = { active: true };
    activeFlagRef.current = active;
    load(active);
    return () => {
      active.active = false;
    };
  }, [load]);

  function goHome() {
    router.replace('/');
  }

  function goToCapture() {
    router.push('/capture');
  }

  function retry() {
    load(activeFlagRef.current);
  }

  // Everything below the hero pays the bottom inset; the hero itself reaches the top of the
  // device, so there is no top inset anywhere on this screen.
  const bottomInset = Math.max(insets.bottom, Layout.canvas.safeBottom);

  if (state.status === 'loading') {
    return (
      <View style={styles.screen}>
        <View
          style={[
            styles.centerBlock,
            { paddingTop: Math.max(insets.top, Layout.canvas.safeTop), paddingBottom: bottomInset },
          ]}>
          {/* Not drawn on the page: the quietest faithful wait state — a small spinner and the
              live-region caption that actually says what is happening. */}
          <ActivityIndicator color={Ink.ink2} testID="result-loading" />
          <Text style={[Type.body, styles.ink, styles.centered]} accessibilityLiveRegion="polite">
            {Copy.result.loadingFromHistory}
          </Text>
        </View>
      </View>
    );
  }

  if (state.status === 'loadFailed' || state.status === 'unavailable') {
    const message = state.status === 'loadFailed' ? Copy.result.error.loadFailed : Copy.result.error.notFound;
    return (
      <View style={styles.screen}>
        <View
          style={[
            styles.centerBlock,
            { paddingTop: Math.max(insets.top, Layout.canvas.safeTop), paddingBottom: bottomInset },
          ]}>
          <Text style={[Type.h2, styles.ink, styles.centered]} accessibilityLiveRegion="polite">
            {message}
          </Text>
          {/* Retry/Cancel must never trap the user in a dead end (issue #56) — both actions are
              always offered together, regardless of which error this is. */}
          <SquareButton label={Copy.result.cta.done} onPress={goHome} style={styles.errorAction} />
          <SquareButton variant="link" label={Copy.result.error.retry} onPress={retry} />
        </View>
      </View>
    );
  }

  const { outcome, heroUri, heroPending, mediaType } = state;
  const assessedCount = countAssessedPillars(outcome.result);

  return (
    <View style={styles.screen}>
      <Animated.ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        {/* THE HERO — the page's 3:4 box, first on the screen and edge to edge. Two layers in
            the page's order: the frame (or, with no image, the placeholder gradient; or, while
            the signed URL is in flight, a spinner in the same box) and the vignette. One box for
            all three cases, so the readout below is laid out once and never shoved down when the
            image lands. */}
        <View style={styles.hero}>
          {heroUri ? (
            <DuotoneFrame testID="result-hero-image" uri={heroUri} accessibilityLabel={Copy.result.hero.altText} />
          ) : heroPending ? (
            // Decorative, and hidden from the a11y tree: a screen reader has nothing to gain
            // from "an image is loading" — the result itself is already readable below.
            <View
              testID="result-hero-pending"
              style={[StyleSheet.absoluteFill, styles.heroPending]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants">
              <ActivityIndicator color={Ink.ink2} />
            </View>
          ) : (
            <Svg
              testID="result-hero-placeholder"
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants">
              <Defs>
                <LinearGradient id={PLACEHOLDER_ID} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset={0} stopColor={Ink.bgPlaceholder} />
                  <Stop offset={1} stopColor={Ink.bg} />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${PLACEHOLDER_ID})`} />
            </Svg>
          )}
          {heroPending ? null : (
            <>
              <Svg
                testID="result-hero-vignette"
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants">
                <Defs>
                  <RadialGradient id={VIGNETTE_ID} cx="50%" cy="50%" r={VIGNETTE_RADIUS}>
                    <Stop offset={VIGNETTE_CLEAR_STOP} stopColor={Ink.bg} stopOpacity={0} />
                    <Stop offset={1} stopColor={Ink.bg} stopOpacity={VIGNETTE_EDGE_OPACITY} />
                  </RadialGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${VIGNETTE_ID})`} />
              </Svg>
            </>
          )}
        </View>

        <View style={[styles.column, { paddingBottom: bottomInset }]}>
          {/* Deliberately NO screen title here. The copy deck defines no `result.title` key,
              and the readout's own "Overall" label + numeral already are this screen's heading —
              adding a second one would mean inventing copy the deck has not certified. */}
          {/* M2 (v23-ux-audit-r1): gated on the pillar count actually scored, not on the
              server's `isFallback` flag — a legitimate photo submission can score 2 of 4
              pillars with `isFallback: false` (motion-over-time pillars a still can't show),
              and that is exactly the case this banner exists to disclose. */}
          {assessedCount < 4 ? <PartialResultBanner assessedCount={assessedCount} mediaType={mediaType} /> : null}

          <SquareCard padding={Layout.cardPaddingLg} testID="result-readout-card" style={styles.readoutCard}>
            {/* `revealReady` is simply true: the hero no longer animates, so there is nothing
                for the bars to wait on beyond the readout's own first layout. */}
            <PaceReadout result={outcome.result} firstReveal={justAnalyzed} revealReady />
          </SquareCard>

          <ResultDisclaimer />

          {/* H5 (v23-ux-audit-r1): a zero-pillar result used to offer only "Back to Home" — a
              dead end for a Free user whose one-ever analysis was just spent on nothing. */}
          {assessedCount === 0 ? (
            <SquareButton label={Copy.result.cta.tryAnother} onPress={goToCapture} testID="result-try-another" />
          ) : null}
          <SquareButton
            variant={assessedCount === 0 ? 'link' : 'primary'}
            label={Copy.result.cta.done}
            onPress={goHome}
            testID="result-done"
          />
        </View>
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Ink.bg,
  },
  content: {
    // NO horizontal padding here: the hero is a direct child and must bleed. The column below
    // re-applies the gutter for everything that is not the hero.
    flexGrow: 1,
  },
  hero: {
    aspectRatio: HERO_ASPECT_RATIO,
    backgroundColor: Ink.bgRaised,
    overflow: 'hidden',
    width: '100%',
  },
  heroPending: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  column: {
    gap: Space.xl,
    paddingHorizontal: Layout.gutter,
    // The page's `padding: 40px 24px 34px` — the 40 measured from the hero's bottom edge to the
    // first card under it; the 34 is the design minimum the live bottom inset is held to.
    paddingTop: Space.section,
  },
  readoutCard: {
    gap: Space.xl,
  },
  centerBlock: {
    alignItems: 'center',
    flex: 1,
    gap: Space.lg,
    justifyContent: 'center',
    paddingHorizontal: Layout.gutter,
  },
  ink: {
    color: Ink.ink,
  },
  centered: {
    textAlign: 'center',
  },
  errorAction: {
    marginTop: Space.sm,
  },
});
