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
 * SCOPE NOTE on the hero frame: the design brief's "annotated frame" (a ground rule + posture
 * line + landing marker drawn over the photo) is not rendered here — the `@shared/pace` contract
 * carries no coordinate data for one, and drawing invented overlay geometry would be exactly the
 * kind of fabrication this issue exists to refuse (see `components/pace-readout.tsx`'s header).
 * Redesign spec `docs/superpowers/specs/2026-07-26-redesign-design.md` §4 does schedule those
 * three hairlines as Phase 2's "moment 3", drawn as fixed geometry rather than per-joint
 * landmarks — that is a separate plan, and nothing on this screen animates today.
 *
 * REDESIGN PHASE 1 (spec §3, plan `docs/superpowers/plans/2026-07-26-redesign-phase-1-static-
 * layer.md`): the stored frame now renders through `<DuotoneFrame>` — full-bleed and graded
 * toward the warm base instead of inset as a rounded thumbnail — and the readout sits inside a
 * `<SurfaceCard>` (formerly `<NotchedCard>`, superseded by the 2026-08-02 Calm redesign — see
 * `docs/architecture.md`). Both are static; the alt text, the disclaimer footer, and every
 * accessibility label are unchanged. This is the only screen Phase 1 restyles.
 *
 * MOTION (issue #61): `justAnalyzed` is read straight off the route params and forwarded to
 * `<PaceReadout>` as `firstReveal` — nothing else on this screen branches on it. Both writers of
 * this param (`app/analyzing.tsx`'s success effect and `app/(tabs)/index.tsx`'s cold-start
 * reconciliation) already match motion-consult.md item 3's example verbatim: "ephemeral only — a
 * nav param ... set immediately after the analyze call succeeds ... never derived from
 * AsyncStorage or a DB field, so it can't replay after relaunch nor suppress a genuine first
 * view." A plain re-open from Past Analyses never sets it, so `firstReveal` defaults to false
 * there and `<PaceReadout>` renders its ordinary static, finished state.
 *
 * THE HERO'S APERTURE (2026-08-02, captain's instruction): `<Aperture>` wraps — never replaces —
 * `<DuotoneFrame>`. Its permanent vignette is the still state; its iris and rack focus play once, on
 * a fresh analysis only, and the annotation wireframe is held back by `Motion.duration.epic` so the
 * two animations run in sequence rather than on top of each other. See `components/aperture.tsx`'s
 * header for why the two treatments compose rather than fight, and why it had to be rebuilt from
 * its description rather than recovered from git.
 *
 * MOTION (issue #61) — the scroll container: motion-consult.md item 5, "build on Reanimated's
 * `Animated.ScrollView` + `useAnimatedRef` from day one (zero effects wired now) so the post-MVP
 * scroll-driven phase is additive, not a container swap." `scrollRef` below has no reader yet —
 * this is that plumbing, not new visible motion.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { useAnimatedRef } from 'react-native-reanimated';

import { ArcLoader } from '@/components/arc-loader';
import { Aperture } from '@/components/aperture';
import { DuotoneFrame } from '@/components/duotone-frame';
import { PartialResultBanner } from '@/components/partial-result-banner';
import { PaceReadout } from '@/components/pace-readout';
import { ResultDisclaimer } from '@/components/result-disclaimer';
import { PillButton } from '@/components/ui/pill-button';
import { ScreenGradient } from '@/components/ui/screen-gradient';
import { SurfaceCard } from '@/components/ui/surface-card';
import { Copy } from '@/constants/copy';
import {
  Colors,
  ContentWidth,
  FontFamily,
  FontSize,
  LineHeight,
  Motion,
  Radius,
  Spacing,
  Tracking,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
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

/** `<DuotoneFrame>`'s own fixed aspect — the hero placeholder below reserves the identical box, so
 *  the real frame arrives into space already held for it and nothing under it moves. Mirrored from
 *  `components/duotone-frame.tsx`'s `FRAME_ASPECT_RATIO` rather than imported: that constant is
 *  private to the component, and the placeholder's job is to match what the frame RENDERS as, not
 *  to couple this screen to its internals. */
const HERO_ASPECT_RATIO = 3 / 4;

/** The wait mark inside that placeholder. Composition, not a token (same rule `<ArcRing>`'s own
 *  header states for ring sizes): it is sized to read as a mark inside a hero-sized box, larger
 *  than the 88pt cold-load mark on the bare screen, and no other screen wants this size. */
const HERO_PENDING_MARK_SIZE = 120;

type ScreenState =
  | { status: 'loading' }
  | { status: 'loadFailed' }
  | { status: 'unavailable' }
  | {
      status: 'ready';
      outcome: PaceAnalysisOutcome;
      heroUri: string | null;
      /** True only while a `heroPath` exists and its signed-URL resolution is still in flight.
       * Phase 2 plan Task 5 needs this distinguished from "resolved to null" (no image at all) —
       * `annotationsDone`'s fallback below only fires once resolution has actually finished,
       * never while a real hero is still on its way in. */
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
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Issue #63 — see `heroInset` below. The hero is the one node on this screen that has to know
  // whether the readable-column cap is actually engaged.
  const { width: windowWidth } = useWindowDimensions();
  const heroIsInset = ContentWidth.isCapped(windowWidth);
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[]; justAnalyzed?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  // Motion-consult.md item 3's own example param name and value, verbatim — see this file's
  // header. Read once per mount; a later re-render (e.g. the hero image resolving) never flips it.
  const justAnalyzed = (Array.isArray(params.justAnalyzed) ? params.justAnalyzed[0] : params.justAnalyzed) === '1';
  // See this file's header (motion-consult.md item 5) — unread today, on purpose.
  const scrollRef = useAnimatedRef<Animated.ScrollView>();

  // Moment 3 sequencing (Phase 2 plan Task 5, spec 2026-07-26 §4): "annotations draw, THEN the
  // bars fill." A re-open (`!justAnalyzed`) has nothing to wait for — the hero's lines render
  // already fully drawn (see DuotoneFrame's `playAnnotation` default) — so this starts `true` in
  // that case and only starts `false`, waiting on the callback below, on a fresh analysis's first
  // open.
  const [annotationsDone, setAnnotationsDone] = useState(!justAnalyzed);

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

  if (state.status === 'loading') {
    return (
      <ScreenGradient>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.centerBlock}>
            {/* Cadence Arcs (2026-09-01): the motif's own wait state, replacing the stock
                spinner. Indeterminate by construction — `<ArcLoader>` draws nothing that
                could be read as progress, and the live-region caption beside it is what
                actually says what is happening. */}
            <ArcLoader size={88} testID="result-loading" />
            {/* `text.primary`, not secondary: this sits directly on the page wash, which
                `Gradient`'s contract (constants/theme.ts) proves for the primary tone only. */}
            <Text style={styles.onWashCaption} accessibilityLiveRegion="polite">
              {Copy.result.loadingFromHistory}
            </Text>
          </View>
        </SafeAreaView>
      </ScreenGradient>
    );
  }

  if (state.status === 'loadFailed' || state.status === 'unavailable') {
    const message = state.status === 'loadFailed' ? Copy.result.error.loadFailed : Copy.result.error.notFound;
    return (
      <ScreenGradient>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.centerBlock}>
            <Text style={styles.errorText} accessibilityLiveRegion="polite">
              {message}
            </Text>
            {/* Retry/Cancel must never trap the user in a dead end (issue #56) — both actions are
                always offered together, regardless of which error this is. */}
            <PillButton label={Copy.result.cta.done} onPress={goHome} style={styles.errorAction} />
            <PillButton variant="ghost" label={Copy.result.error.retry} onPress={retry} />
          </View>
        </SafeAreaView>
      </ScreenGradient>
    );
  }

  const { outcome, heroUri, heroPending, mediaType } = state;
  const assessedCount = countAssessedPillars(outcome.result);
  // Moment 3 sequencing (Phase 2 plan Task 5): if there is no hero to draw on at all — resolution
  // finished and came back with nothing (`!heroPending && !heroUri`) — there is nothing for the
  // readout to wait on, so it reveals as if the (nonexistent) annotations already finished. While
  // a real hero is still resolving (`heroPending`), this stays false and the readout keeps waiting
  // for `DuotoneFrame`'s actual `onAnnotationComplete` callback instead.
  const revealReady = annotationsDone || (!heroPending && !heroUri);

  return (
    <ScreenGradient>
      <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
        <Animated.ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
          {/* THE HERO, and the biggest composition change on this screen. It is now the first
              thing on it — full-bleed, edge to edge, reaching the very top of the device with no
              safe-area inset above it (hence `edges` excluding 'top' on the SafeAreaView) and
              rounding only at its bottom corners, so the frame reads as a window the content
              hangs from rather than as a picture pasted into a padded column. That is the
              breakthroughenergy.org treatment: real footage, graded into the palette, at a scale
              that commits. The duotone grade and the three assembling annotation hairlines are
              unchanged from Phase 2 — the wireframe-onto-a-real-photo idea was already here, and
              this pass gives it the scale it was drawn for.

              The partial-result banner now sits BELOW the hero rather than above it. It is a
              disclosure about the readout, and the readout is what follows it; putting it above
              the image used to push the hero down and make the honesty notice read as a page
              header. Nothing about when it shows has changed. */}
          {/* THE APERTURE (restored 2026-08-02 on the captain's instruction). It wraps the hero
              rather than replacing anything: `<DuotoneFrame>`'s grade and its three assembling
              hairlines are untouched, and the aperture adds the lens the jeskojets reference is
              about — a permanent vignette, plus a six-bladed iris and a rack focus that play once
              on a fresh analysis. The three treatments are SEQUENCED, not stacked: the iris opens
              onto a photo pulling into focus, and only then does the wireframe draw onto it
              (`annotationDelayMs`). Drawing the wireframe underneath a shut iris was the one way
              these could genuinely have fought each other, and the delay is what avoids it.
              `open` follows `justAnalyzed` for exactly the same reason `playAnnotation` does — a
              re-open from Past Analyses is not a first reveal, so it gets the still, already-open
              aperture and the vignette alone. */}
          {/* THE HERO'S OWN PENDING STATE (Cadence Arcs, 2026-09-01). `heroPending` was already
              tracked — for the reveal gate — but nothing rendered for it, so a stored result
              opened cold laid the readout out against the top of the screen and then, one signed
              URL later, shoved the whole page down by the hero's full height. That is a layout
              jump, not a reveal.

              The placeholder reserves the EXACT box the frame will occupy (the same
              `width: 100%` at `DuotoneFrame`'s own 3:4 aspect, inside the same bleed/inset
              wrapper), so the image arrives into space already held for it and nothing below it
              moves. Inside it, the motif's own wait mark — the same `<ArcLoader>` this screen's
              cold-load state uses, at the same indeterminate contract: it says the frame is
              coming, never how far along it is.

              Decorative, and hidden from the a11y tree: a screen reader has nothing to gain from
              "an image is loading" here — the result itself is already rendered and readable
              below, which is the whole reason this is a placeholder and not a blocking state. */}
          {heroUri ? (
            <View style={[styles.heroBleed, heroIsInset && styles.heroInset]}>
              <Aperture testID="result-hero-aperture" open={justAnalyzed}>
                <DuotoneFrame
                  testID="result-hero-image"
                  uri={heroUri}
                  accessibilityLabel={Copy.result.hero.altText}
                  annotate
                  playAnnotation={justAnalyzed}
                  annotationDelayMs={justAnalyzed ? Motion.duration.epic : 0}
                  onAnnotationComplete={() => setAnnotationsDone(true)}
                />
              </Aperture>
            </View>
          ) : heroPending ? (
            <View
              testID="result-hero-pending"
              style={[styles.heroBleed, styles.heroPlaceholder, heroIsInset && styles.heroInset]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants">
              <ArcLoader size={HERO_PENDING_MARK_SIZE} />
            </View>
          ) : null}

          <View style={styles.column}>
            {/* Deliberately NO screen title here. The copy deck defines no `result.title` key,
                and the readout's own "Overall" eyebrow + hero numeral already are this screen's
                heading — adding a second one would mean inventing copy the deck has not
                certified. The per-word kinetic reveal this screen would have spent on a title
                goes to the coaching prose inside `<PaceReadout>` instead, which is the one place
                on this screen where the words genuinely are the product. */}
            {/* M2 (v23-ux-audit-r1): gated on the pillar count actually scored, not on the
                server's `isFallback` flag — a legitimate photo submission can score 2 of 4
                pillars with `isFallback: false` (motion-over-time pillars a still can't show),
                and that is exactly the case this banner exists to disclose. */}
            {assessedCount < 4 ? <PartialResultBanner assessedCount={assessedCount} mediaType={mediaType} /> : null}

            <SurfaceCard tone="raised" testID="result-readout-card">
              <PaceReadout result={outcome.result} firstReveal={justAnalyzed} revealReady={revealReady} />
            </SurfaceCard>

            <ResultDisclaimer />

            {/* H5 (v23-ux-audit-r1): a zero-pillar result used to offer only "Back to Home" — a
                dead end for a Free user whose one-ever analysis was just spent on nothing. */}
            {assessedCount === 0 ? (
              <PillButton label={Copy.result.cta.tryAnother} onPress={goToCapture} testID="result-try-another" />
            ) : null}
            <PillButton
              variant={assessedCount === 0 ? 'ghost' : 'primary'}
              label={Copy.result.cta.done}
              onPress={goHome}
              testID="result-done"
            />
          </View>
        </Animated.ScrollView>
      </SafeAreaView>
    </ScreenGradient>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      // Transparent — `<ScreenGradient>` behind it owns the fill. See app/(tabs)/index.tsx's own
      // note on the same line.
      backgroundColor: 'transparent',
    },
    content: {
      flexGrow: 1,
      // NO horizontal padding here any more: the hero is a direct child and must bleed. The
      // readable column below re-applies it for everything that is not the hero.
      paddingBottom: Spacing.xxl,
    },
    column: {
      alignSelf: 'center',
      gap: Spacing.xl,
      maxWidth: ContentWidth.readable,
      paddingHorizontal: Spacing.xl,
      // The one editorial gap (spec §3.4), now measured from the hero's bottom edge to the first
      // thing under it rather than added as a margin on the hero itself.
      paddingTop: Spacing.editorial,
      width: '100%',
    },
    centerBlock: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.lg,
      padding: Spacing.xl,
    },
    onWashCaption: {
      // `text.primary`: this Text sits directly on the page gradient, which is proven for the
      // primary tone only (`Gradient`'s contract, constants/theme.ts). It was `text.secondary`
      // when the backdrop was the flat, fully-proven `background`.
      color: colors.text.primary,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.md,
      lineHeight: FontSize.md * LineHeight.body,
      textAlign: 'center',
    },
    errorText: {
      color: colors.text.primary,
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.xl,
      letterSpacing: Tracking.display,
      lineHeight: FontSize.xl * LineHeight.heading,
      textAlign: 'center',
    },
    errorAction: {
      marginTop: Spacing.sm,
      maxWidth: ContentWidth.readable,
      width: '100%',
    },
    // Applied WITH `heroBleed` (and `heroInset` where the cap engages), so the placeholder and the
    // real frame share one set of corners and one set of bounds. `surface.base`, not the wash: this
    // is an opaque panel standing in for opaque media, and a translucent one would let the gradient
    // read through the box the image is about to fill.
    heroPlaceholder: {
      alignItems: 'center',
      aspectRatio: HERO_ASPECT_RATIO,
      backgroundColor: colors.surface.base,
      justifyContent: 'center',
      width: '100%',
    },
    heroBleed: {
      // Full-bleed, and now edge-to-edge at the TOP of the screen as well: the content container
      // no longer pads horizontally, and the SafeAreaView excludes its 'top' edge, so the frame
      // reaches the device's own corner. Only the bottom corners round, so the image reads as a
      // window the page hangs from.
      borderBottomLeftRadius: Radius.hero,
      borderBottomRightRadius: Radius.hero,
      overflow: 'hidden',
    },
    // Applied ON TOP of heroBleed only on a viewport wider than the readable column (issue #63).
    //
    // `<DuotoneFrame>` is `width: '100%'` at a fixed 3:4 aspect, so its HEIGHT is the viewport
    // width times 1.33. On a phone that is the designed proportion — 524pt of an iPhone 15 Pro's
    // 852pt viewport, about 60%. On an 11" iPad in portrait it is 834 -> 1112pt of a 1194pt
    // viewport, about 93%: the PACE readout — the entire product — is pushed clean below the fold
    // and the first screenful is one enormous photo. This is the one place in the app where a wide
    // viewport is made worse by the ABSENCE of the cap rather than by the cap itself.
    //
    // Capping restores the phone proportion (560 x 747) and lines the hero up with the column
    // below it, so the screen reads as one deliberate column instead of a photo with a caption.
    // The top corners round here too: at phone width the square top edge IS the bleed, but an
    // inset card with two square corners just looks unfinished.
    //
    // NOT solved with a `maxHeight` crop instead: `components/duotone-frame.tsx` positions its
    // three annotation hairlines in PERCENTAGES of the frame, so cropping the frame would slide
    // the wireframe off the anatomy it is annotating.
    heroInset: {
      width: '100%',
      maxWidth: ContentWidth.readable,
      alignSelf: 'center',
      borderTopLeftRadius: Radius.hero,
      borderTopRightRadius: Radius.hero,
    },
  });
}
