/**
 * result/[id] — the PACE readout (issue #56). "This is the product's payload. Everything else
 * in the app exists to get the user here."
 *
 * Renders BOTH a fresh M4 result and a re-opened stored one with the SAME code path: this screen
 * always fetches its own `analyses` row by `id` and renders from that — a freshly-delivered
 * analysis is just a row whose insert happened moments ago (`analyze-form`, once #44 exists,
 * already persists the row before returning `{ result, analysisId, isFallback }` to the client —
 * see `docs/architecture.md` "Planned — analyze-form edge function flow" step 10), so there is
 * no second, parallel "render whatever the API call just returned" path to keep in sync with
 * this one.
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
 * This screen renders the stored frame plainly, with the deck's alt text.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PartialResultBanner } from '@/components/partial-result-banner';
import { PaceReadout } from '@/components/pace-readout';
import { ResultDisclaimer } from '@/components/result-disclaimer';
import { Copy } from '@/constants/copy';
import {
  Accent,
  Colors,
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
// "~1h, regenerated on open" per docs/architecture.md's "Planned — media pipeline".
const HERO_SIGNED_URL_TTL_SECONDS = 60 * 60;
// A representative running photo's typical portrait ratio. Not a `constants/theme.ts` token —
// aspect ratio isn't one of that file's roles (colors/spacing/type/radii), and this issue's
// scope is explicitly the result screen, not new design-system tokens — so this stays a local,
// commented layout constant rather than an invented theme value.
const HERO_ASPECT_RATIO = 4 / 5;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ScreenState =
  | { status: 'loading' }
  | { status: 'loadFailed' }
  | { status: 'unavailable' }
  | { status: 'ready'; outcome: PaceAnalysisOutcome; heroUri: string | null };

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
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

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

      setState({ status: 'ready', outcome: read.outcome, heroUri: null });

      const heroPath = read.mediaPaths[0];
      if (heroPath) {
        const heroUri = await resolveHeroImageUri(heroPath);
        if (active.active) {
          setState((current) => (current.status === 'ready' ? { ...current, heroUri } : current));
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

  const { outcome, heroUri } = state;
  const assessedCount = countAssessedPillars(outcome.result);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        {outcome.isFallback ? <PartialResultBanner assessedCount={assessedCount} /> : null}

        {heroUri ? (
          <Image
            testID="result-hero-image"
            source={{ uri: heroUri }}
            style={styles.heroImage}
            contentFit="cover"
            accessible
            accessibilityLabel={Copy.result.hero.altText}
          />
        ) : null}

        <PaceReadout result={outcome.result} />

        <ResultDisclaimer />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={Copy.result.cta.done}
          onPress={goHome}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <Text style={styles.primaryButtonText}>{Copy.result.cta.done}</Text>
        </Pressable>
      </ScrollView>
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
    heroImage: {
      aspectRatio: HERO_ASPECT_RATIO,
      backgroundColor: colors.surface.base,
      borderRadius: Radius.card,
      width: '100%',
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
