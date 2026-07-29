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
 * `<NotchedCard>`. Both are static; the alt text, the disclaimer footer, and every accessibility
 * label are unchanged. This is the only screen Phase 1 restyles.
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
 * MOTION (issue #61) — the scroll container: motion-consult.md item 5, "build on Reanimated's
 * `Animated.ScrollView` + `useAnimatedRef` from day one (zero effects wired now) so the post-MVP
 * scroll-driven phase is additive, not a container swap." `scrollRef` below has no reader yet —
 * this is that plumbing, not new visible motion.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { useAnimatedRef } from 'react-native-reanimated';

import { DuotoneFrame } from '@/components/duotone-frame';
import { PartialResultBanner } from '@/components/partial-result-banner';
import { PaceReadout } from '@/components/pace-readout';
import { ResultDisclaimer } from '@/components/result-disclaimer';
import { NotchedCard } from '@/components/ui/notched-card';
import { Copy } from '@/constants/copy';
import {
  Accent,
  Colors,
  ContentWidth,
  ControlHeight,
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
import { readAnalysisRow, type AnalysisRow } from '@/lib/analysis-result';
import { countAssessedPillars } from '@/lib/pace-readout';
import { supabase } from '@/lib/supabase';
import { useAnnounce } from '@/lib/use-announce';
import type { PaceAnalysisOutcome } from '@shared/pace';

// The private frame bucket (`supabase/migrations/20260711150500_media_storage_bucket.sql`) —
// there are no public URLs, only owner-scoped signed reads (CLAUDE.md § Secrets & env).
const MEDIA_BUCKET = 'media';
// "~1h, regenerated on open" per docs/architecture.md's "Current — media pipeline".
const HERO_SIGNED_URL_TTL_SECONDS = 60 * 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    };

/** Mirrors `app/(tabs)/index.tsx`'s own `ActiveFlag` pattern: minted per fetch attempt, flipped
 * off on unmount/re-fetch, so a slow or stale request can never overwrite a newer one's state. */
type ActiveFlag = { active: boolean };

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

      setState({ status: 'loading' });

      let row: AnalysisRow | null;
      try {
        const { data, error } = await supabase
          .from('analyses')
          .select('status, result, is_fallback, media_paths, media_type, deleted_at')
          .eq('id', id)
          .maybeSingle();

        if (error) {
          if (active.active) setState({ status: 'loadFailed' });
          return;
        }
        row = data;
      } catch {
        if (active.active) setState({ status: 'loadFailed' });
        return;
      }

      const read = readAnalysisRow(row);
      if (!active.active) return;

      if (read.kind === 'notFound') {
        setState({ status: 'unavailable' });
        return;
      }
      if (read.kind === 'invalid') {
        // Structurally malformed stored data is at least as "nothing to show" as a missing row —
        // collapsed into the same copy rather than a separate, more alarming message (the fetch
        // itself succeeded; the payload just isn't a valid PaceAnalysisOutcome).
        setState({ status: 'unavailable' });
        return;
      }

      const heroPath = read.mediaPaths[0];
      setState({ status: 'ready', outcome: read.outcome, heroUri: null, heroPending: !!heroPath });

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

  function retry() {
    load(activeFlagRef.current);
  }

  if (state.status === 'loading') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerBlock}>
          <ActivityIndicator color={colors.text.secondary} />
          <Text style={styles.loadingCaption} accessibilityLiveRegion="polite">
            {Copy.result.loadingFromHistory}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state.status === 'loadFailed' || state.status === 'unavailable') {
    const message = state.status === 'loadFailed' ? Copy.result.error.loadFailed : Copy.result.error.notFound;
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerBlock}>
          <Text style={styles.errorText} accessibilityLiveRegion="polite">
            {message}
          </Text>
          {/* Retry/Cancel must never trap the user in a dead end (issue #56) — both actions are
              always offered together, regardless of which error this is. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Copy.result.error.retry}
            onPress={retry}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
            <Text style={styles.retryText}>{Copy.result.error.retry}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Copy.result.cta.done}
            onPress={goHome}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <Text style={styles.primaryButtonText}>{Copy.result.cta.done}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const { outcome, heroUri, heroPending } = state;
  const assessedCount = countAssessedPillars(outcome.result);
  // Moment 3 sequencing (Phase 2 plan Task 5): if there is no hero to draw on at all — resolution
  // finished and came back with nothing (`!heroPending && !heroUri`) — there is nothing for the
  // readout to wait on, so it reveals as if the (nonexistent) annotations already finished. While
  // a real hero is still resolving (`heroPending`), this stays false and the readout keeps waiting
  // for `DuotoneFrame`'s actual `onAnnotationComplete` callback instead.
  const revealReady = annotationsDone || (!heroPending && !heroUri);

  return (
    <SafeAreaView style={styles.safeArea}>
      <Animated.ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        {outcome.isFallback ? <PartialResultBanner assessedCount={assessedCount} /> : null}

        {heroUri ? (
          <View
            style={[styles.heroBleed, !outcome.isFallback && styles.heroBleedFirstChild]}>
            <DuotoneFrame
              testID="result-hero-image"
              uri={heroUri}
              accessibilityLabel={Copy.result.hero.altText}
              annotate
              playAnnotation={justAnalyzed}
              onAnnotationComplete={() => setAnnotationsDone(true)}
            />
          </View>
        ) : null}

        <NotchedCard testID="result-readout-card" style={styles.readoutCard}>
          <PaceReadout result={outcome.result} firstReveal={justAnalyzed} revealReady={revealReady} />
        </NotchedCard>

        <ResultDisclaimer />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={Copy.result.cta.done}
          onPress={goHome}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <Text style={styles.primaryButtonText}>{Copy.result.cta.done}</Text>
        </Pressable>
      </Animated.ScrollView>
    </SafeAreaView>
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
    centerBlock: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.lg,
      padding: Spacing.xl,
    },
    loadingCaption: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.md,
      textAlign: 'center',
    },
    errorText: {
      color: colors.text.primary,
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.md,
      textAlign: 'center',
    },
    heroBleed: {
      // Full-bleed (spec 2026-07-26 §3.5): cancel the content container's own horizontal padding
      // so the graded frame reaches the screen edges. A photograph inset inside a padded column
      // is a thumbnail again, which is exactly what this change exists to stop being.
      marginHorizontal: -Spacing.xl,
      // The one editorial gap (spec §3.4). The content container's `gap: Spacing.xl` supplies
      // the remainder, so the separation the eye measures is exactly Spacing.editorial.
      marginBottom: Spacing.editorial - Spacing.xl,
    },
    heroBleedFirstChild: {
      // Only cancel the content container's top padding when the hero is actually its first
      // child. When PartialResultBanner renders above it, this margin would instead cancel the
      // container's `gap: Spacing.xl` between the two siblings, collapsing it to zero.
      marginTop: -Spacing.xl,
    },
    readoutCard: {
      // The screen's one raised element (brief §2). NotchedCard defaults to `surface.base`,
      // which is exactly what the pillar rows inside it already use — on that surface the rows
      // vanish into their own container. `surface.raised` separates them. (It does not rescue
      // the notches: `background` reads 1.07:1 on base and 1.13:1 on raised, both invisible —
      // the notch's hairline stroke is what makes it read. See notched-card.tsx's header.)
      backgroundColor: colors.surface.raised,
    },
    pressed: {
      opacity: Opacity.pressed,
    },
    retryButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: HitTarget.min,
      minWidth: HitTarget.min,
      paddingHorizontal: Spacing.md,
    },
    retryText: {
      color: colors.text.primary,
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      textDecorationLine: 'underline',
    },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: Accent.value,
      borderRadius: Radius.card,
      justifyContent: 'center',
      minHeight: ControlHeight.standard,
      paddingHorizontal: Spacing.xl,
    },
    primaryButtonText: {
      color: Accent.onAccent,
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.md,
    },
  });
}
