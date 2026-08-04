/**
 * result/sample — Free tier's zero-model-call labeled preview (captain-approved 2026-07-26).
 *
 * `analyze-form` never calls the model for a Free-tier request (`supabase/functions/analyze-form/
 * flow.ts`'s tier-lookup branch): it returns a fabricated, hand-authored `PaceResult`
 * (`_shared/analyze-form-sample.ts`) marked `isSample: true`, and `app/analyzing.tsx` routes here
 * instead of `/result/[id]` — a static route, so it never collides with that dynamic sibling.
 *
 * Unlike `/result/[id]`, this screen has NO `analyses` row to fetch: nothing was ever persisted
 * for a sample (no reservation, no settle, no upload). It reads its one-shot payload from
 * `lib/pending-sample-result.ts`'s mailbox instead — the same "too big for a serialized route
 * param" reasoning `lib/analyze-form.ts`'s own `pendingRequest` mailbox already documents (a full
 * `PaceResult` plus a `data:` URI of the user's photo). A direct or cold navigation here (the
 * mailbox is empty) bails to Home, mirroring `app/analyzing.tsx`'s own defensive bail-out for a
 * missing `request`.
 *
 * The hero image is the user's OWN uploaded photo — not stock art — passed through as a
 * `data:image/jpeg;base64,...` URI built client-side in `app/analyzing.tsx` from the frame already
 * in memory. Nothing was uploaded to Storage for a sample, so there is no signed URL to resolve
 * and no `<Aperture>`/annotation-timing choreography to wait on (that sequencing exists to gate
 * `<PaceReadout>`'s reveal on a first-analysis's drawn annotations — this screen has no "first
 * analysis" moment to honor, so the readout renders in its default, already-revealed state).
 *
 * THE LABELING (`<SampleResultBanner>`) is not optional decoration: it is the control that keeps
 * this feature from reading as a real personalized analysis — an App Store policy risk and a
 * refund-dispute risk per the captain's brief — so it renders ABOVE the readout, not buried below
 * it, with the upgrade CTA inside the same banner.
 */
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DuotoneFrame } from '@/components/duotone-frame';
import { PaceReadout } from '@/components/pace-readout';
import { ResultDisclaimer } from '@/components/result-disclaimer';
import { SampleResultBanner } from '@/components/sample-result-banner';
import { PillButton } from '@/components/ui/pill-button';
import { ScreenGradient } from '@/components/ui/screen-gradient';
import { SurfaceCard } from '@/components/ui/surface-card';
import { Copy } from '@/constants/copy';
import { ContentWidth, Radius, Spacing } from '@/constants/theme';
import { takePendingSampleResult, type PendingSampleResult } from '@/lib/pending-sample-result';

export default function SampleResultScreen() {
  // One-shot read, same pattern as `app/analyzing.tsx`'s own pending-request mailbox — read once
  // on mount so a re-render (e.g. a theme change) never re-consumes an already-empty mailbox.
  const [pending] = useState<PendingSampleResult | null>(() => takePendingSampleResult());
  const router = useRouter();

  // Mirrors app/analyzing.tsx's own defensive bail-out for a missing pending payload — a direct
  // or cold navigation here has nothing to render, so back out to Home rather than crash on a
  // null `pending.result` below. A `useEffect`, not a render-time call: `router.replace` is a
  // side effect and must not run during render.
  useEffect(() => {
    if (pending) return;
    router.replace('/');
  }, [pending, router]);

  if (!pending) {
    return null;
  }

  function goHome() {
    router.replace('/');
  }

  function goToPaywall() {
    router.push('/paywall');
  }

  return (
    <ScreenGradient>
      <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          {pending.heroDataUri ? (
            <View style={styles.heroBleed}>
              <DuotoneFrame
                testID="sample-hero-image"
                uri={pending.heroDataUri}
                accessibilityLabel={Copy.result.sample.heroAltText}
              />
            </View>
          ) : null}

          <View style={styles.column}>
            <SampleResultBanner onUpgradePress={goToPaywall} />

            <SurfaceCard tone="raised" testID="sample-readout-card">
              <PaceReadout result={pending.result} />
            </SurfaceCard>

            <ResultDisclaimer />

            <PillButton label={Copy.result.cta.done} onPress={goHome} testID="sample-done" />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenGradient>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: 'transparent',
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingBottom: Spacing.xxl,
  },
  column: {
    alignSelf: 'center',
    gap: Spacing.xl,
    maxWidth: ContentWidth.readable,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.editorial,
    width: '100%',
  },
  heroBleed: {
    borderBottomLeftRadius: Radius.hero,
    borderBottomRightRadius: Radius.hero,
    overflow: 'hidden',
  },
});
