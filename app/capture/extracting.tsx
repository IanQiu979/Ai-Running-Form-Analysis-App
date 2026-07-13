/**
 * Extracting (design brief screen 5, "Uploading / Extracting" in the copy deck; issue #36) —
 * runs `lib/frames.ts`'s `extractFrames` against whatever `app/capture/index.tsx` (library pick)
 * or `app/capture/record.tsx` (in-app recording) handed off via route params, with a real,
 * honest progress readout (not theatre — `onProgress` reports the actual Nth of N sequential
 * `expo-video-thumbnails` calls).
 *
 * No client-side "uploading %" step: since issue #88 (live), the client never uploads anything —
 * `analyze-form` writes the frames server-side, after the model call. This screen's whole job
 * ends at a valid, budget-compliant `PaceFrameSet` in memory (the M2 gate: "Both sources hand a
 * valid, budget-compliant frame set to the analysis step on iOS").
 *
 * WHERE THE FRAME SET GOES (issue #135): the "ready" state hands off to `/analyzing` — the ONE
 * control on that screen mints an idempotency key, builds the wire-shaped `AnalyzeFormRequest`
 * (`lib/analyze-form.ts`'s `toAnalyzeFormRequest`) from the just-extracted `PaceFrameSet`, stages
 * it on that file's one-shot module-level mailbox (`setPendingAnalyzeFormRequest`), and
 * `router.replace`s to `/analyzing`, which already reads that mailbox on mount (issue #80). NOT
 * route params: a request carries multi-megabyte base64 frame data
 * (`PACE_MAX_REQUEST_BODY_BYTES` — up to 5MB), and expo-router search params are serialized into
 * the URL — sound for the small scalar fields this screen already receives via route params
 * (`uri`/`durationMs`/`width`/`height`), not for a payload two to three orders of magnitude
 * larger. The mailbox is the documented seam for exactly this handoff (see this file's own header
 * before this rewrite, `lib/analyze-form.ts`'s module comment, and `docs/architecture.md`'s
 * "Current — the Analyzing screen" section) — a plain module holding one piece of state, the same
 * shape as the existing `lib/consent.ts`/`lib/session-provider.tsx` precedent, not a new
 * dependency. The extraction + progress + error handling above the "ready" branch does not
 * change.
 */
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Copy } from '@/constants/copy';
import {
  Accent,
  Colors,
  ControlHeight,
  ControlWidth,
  FontFamily,
  FontSize,
  HitTarget,
  Opacity,
  Radius,
  Semantic,
  Spacing,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { setPendingAnalyzeFormRequest, toAnalyzeFormRequest } from '@/lib/analyze-form';
import { extractFrames, FrameBudgetExceededError, type PaceFrameSet, type PaceMediaInput } from '@/lib/frames';
import { checkMediaCaps, type MediaCapViolation } from '@/lib/media-caps';
import { readFileSizeBytes } from '@/lib/media-file-size';
import { parseCaptureParams } from '@/lib/parse-capture-params';

import { PACE_FRAME_CAP, type PaceTier } from '@shared/pace';

// Real tier plumbing is M5's job (`lib/subscription.ts`, "Not started" per docs/status.md) —
// there is no wired, authoritative way to read the caller's tier on the client yet, and
// `PACE_FRAME_CAP`/frame count here are display-only regardless (CLAUDE.md: "No business rules
// in the client" — reserve_analysis re-checks server-side). Free's cap (1 frame/video) is the
// smallest of the three and therefore the only one guaranteed valid+budget-compliant for every
// tier without guessing at one this screen has no way to confirm.
const EXTRACTION_TIER: PaceTier = 'free';

type ExtractState =
  | { status: 'extracting'; done: number; total: number }
  // Carries the full PaceFrameSet, not just a count — goToAnalyzing needs the actual frames to
  // build the AnalyzeFormRequest; frameCount for display is just `frameSet.frames.length`.
  | { status: 'ready'; frameSet: PaceFrameSet }
  | { status: 'error'; kind: 'budgetExceeded' }
  | { status: 'error'; kind: 'extractionFailed' }
  | { status: 'error'; kind: 'capViolation'; violation: MediaCapViolation };

export default function ExtractingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    mediaType?: string;
    uri?: string;
    durationMs?: string;
    width?: string;
    height?: string;
  }>();
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = createStyles(colors, scheme);

  const media = useMemo<PaceMediaInput | null>(() => parseCaptureParams(params), [params]);
  const total = media ? (media.mediaType === 'photo' ? 1 : PACE_FRAME_CAP[EXTRACTION_TIER]) : 0;

  const [state, setState] = useState<ExtractState>({ status: 'extracting', done: 0, total });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!media) {
      setState({ status: 'error', kind: 'extractionFailed' });
      return;
    }

    let cancelled = false;
    setState({ status: 'extracting', done: 0, total });

    // Pre-flight re-check (defense in depth): app/capture/index.tsx and record.tsx already
    // checked their own inputs, but this screen is the one place both paths converge, so it's
    // also the cheapest place to catch anything that slipped through — e.g. a stale/expired
    // cache uri whose size now reads differently.
    const violation = checkMediaCaps({
      durationMs: media.mediaType === 'video' ? media.durationMs : null,
      fileSizeBytes: readFileSizeBytes(media.uri),
    });
    if (violation) {
      setState({ status: 'error', kind: 'capViolation', violation });
      return;
    }

    extractFrames(media, EXTRACTION_TIER, (done, framesTotal) => {
      if (!cancelled) setState({ status: 'extracting', done, total: framesTotal });
    })
      .then((frameSet) => {
        if (!cancelled) setState({ status: 'ready', frameSet });
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof FrameBudgetExceededError) {
          setState({ status: 'error', kind: 'budgetExceeded' });
        } else {
          setState({ status: 'error', kind: 'extractionFailed' });
        }
      });

    return () => {
      cancelled = true;
    };
    // `total` is deterministically derived from `media` (see the `useMemo` above it), so
    // including it here never causes an extra run for the same input — just documents the real
    // dependency instead of suppressing the lint rule.
  }, [media, total, attempt]);

  function goToSourcePicker() {
    router.replace('/capture');
  }

  // The one control on the "ready" state (issue #135). Mints a fresh idempotency key for THIS
  // analysis attempt — `analyze-form` is idempotent on `(user_id, idempotencyKey)`, and every
  // retry of THIS submission inside app/analyzing.tsx reuses it; a new key here is correct because
  // tapping this button is a genuinely new, user-initiated submission, not a retry of one.
  // `Crypto.randomUUID()` (expo-crypto, already a dependency — no new one added) matches this
  // project's existing WebCrypto usage (lib/crypto-polyfill.ts, lib/secure-storage.ts).
  function goToAnalyzing() {
    if (!media || state.status !== 'ready') return;
    const idempotencyKey = Crypto.randomUUID();
    const request = toAnalyzeFormRequest(media.mediaType, state.frameSet, idempotencyKey);
    // Staged on lib/analyze-form.ts's one-shot mailbox, not route params — see this file's header
    // for why route params are the wrong mechanism for multi-megabyte base64 frame data.
    setPendingAnalyzeFormRequest(request);
    router.replace('/analyzing');
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Text style={styles.title}>{Copy.upload.title}</Text>

        {state.status === 'extracting' && (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.text.secondary} />
            <Text style={styles.caption} accessibilityLiveRegion="polite">
              {Copy.upload.step.extracting(state.done, state.total)}
            </Text>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${state.total > 0 ? Math.round((state.done / state.total) * 100) : 0}%` },
                ]}
              />
            </View>
          </View>
        )}

        {state.status === 'ready' && (
          <View style={styles.centered}>
            <Text style={styles.resultTitle}>{Copy.upload.ready.title}</Text>
            <Text style={styles.caption}>{Copy.upload.ready.body(state.frameSet.frames.length)}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={Copy.upload.ready.cta}
              onPress={goToAnalyzing}
              style={({ pressed }) => [styles.primaryCta, pressed && styles.pressedOpacity]}>
              <Text style={styles.primaryCtaText}>{Copy.upload.ready.cta}</Text>
            </Pressable>
          </View>
        )}

        {state.status === 'error' && (
          <View style={styles.centered}>
            <Text style={styles.errorTitle}>{errorCopy(state).title}</Text>
            <Text style={styles.caption}>{errorCopy(state).body}</Text>
            {state.kind === 'extractionFailed' && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry"
                onPress={() => setAttempt((n) => n + 1)}
                style={({ pressed }) => [styles.primaryCta, pressed && styles.pressedOpacity]}>
                <Text style={styles.primaryCtaText}>Retry</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={goToSourcePicker}
              style={({ pressed }) => [styles.secondaryCta, pressed && styles.pressedOpacity]}>
              <Text style={styles.secondaryCtaText}>Back</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function errorCopy(state: Extract<ExtractState, { status: 'error' }>): { title: string; body: string } {
  if (state.kind === 'budgetExceeded') return Copy.upload.error.budgetExceeded;
  if (state.kind === 'extractionFailed') return Copy.upload.error.extractionFailed;
  return state.violation === 'clipTooLong' ? Copy.sourcePicker.error.clipTooLong : Copy.sourcePicker.error.fileTooLarge;
}

function createStyles(colors: ThemeColors, scheme: ColorScheme) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      flex: 1,
      padding: Spacing.xl,
      gap: Spacing.xl,
    },
    title: {
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.xl,
      color: colors.text.primary,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.md,
    },
    caption: {
      fontFamily: FontFamily.mono.regular,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
      textAlign: 'center',
    },
    resultTitle: {
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.lg,
      color: colors.text.primary,
    },
    errorTitle: {
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.lg,
      color: Semantic.error[scheme],
      textAlign: 'center',
    },
    progressTrack: {
      width: '80%',
      height: Spacing.xs,
      borderRadius: Radius.pill,
      backgroundColor: colors.hairline,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: Radius.pill,
      backgroundColor: Accent.value,
    },
    primaryCta: {
      minHeight: ControlHeight.standard,
      minWidth: ControlWidth.primaryButton,
      borderRadius: Radius.card,
      backgroundColor: Accent.value,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Spacing.xl,
    },
    primaryCtaText: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.md,
      color: Accent.onAccent,
    },
    secondaryCta: {
      minHeight: HitTarget.min,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryCtaText: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
      textDecorationLine: 'underline',
    },
    pressedOpacity: {
      opacity: Opacity.pressed,
    },
  });
}
