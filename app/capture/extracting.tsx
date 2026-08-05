/**
 * Extracting (design brief screen 5, "Uploading / Extracting" in the copy deck; issue #36) —
 * runs `lib/frames.ts`'s `extractFrames` against whatever `app/capture/index.tsx` (library pick)
 * or `app/capture/record.tsx` (in-app recording) handed off via route params, with a real,
 * honest progress readout (not theatre — `onProgress` reports the actual Nth of N sequential
 * `expo-video-thumbnails` calls).
 *
 * HOW MANY FRAMES A VIDEO GETS: the caller's own `frameCap`, read off the server. This screen
 * awaits `lib/extraction-frame-cap.ts`'s `fetchVideoFrameCap()` (one bounded `quota-status` call)
 * before extracting, and feeds the single number it returns to BOTH the progress total and
 * `extractFrames`, so the caption can never promise a count the extraction will not produce. It
 * does NOT read `quota.tier` and index a client-side table — CLAUDE.md: "Tier, quota, frame cap,
 * and analysis are server-only ... the client may display tier/quota state but is never the
 * authority for it." A failed, unauthorized, or slow lookup degrades to the free cap on purpose,
 * never to a higher one. A photo skips all of this: always exactly one frame, no quota call.
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
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LowPolyField } from '@/components/low-poly-field';
import { Eyebrow } from '@/components/ui/eyebrow';
import { PillButton } from '@/components/ui/pill-button';
import { ScreenGradient } from '@/components/ui/screen-gradient';
import { Copy } from '@/constants/copy';
import {
  Accent,
  Colors,
  ContentWidth,
  FontFamily,
  FontSize,
  LineHeight,
  Radius,
  Spacing,
  Tracking,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { setPendingAnalyzeFormRequest, toAnalyzeFormRequest } from '@/lib/analyze-form';
import { FALLBACK_VIDEO_FRAME_CAP, fetchVideoFrameCap } from '@/lib/extraction-frame-cap';
import { extractFrames, FrameBudgetExceededError, type PaceFrameSet, type PaceMediaInput } from '@/lib/frames';
import { checkMediaCaps, type MediaCapViolation } from '@/lib/media-caps';
import { readFileSizeBytes } from '@/lib/media-file-size';
import { parseCaptureParams } from '@/lib/parse-capture-params';
import { useAnnounce } from '@/lib/use-announce';

// A photo submission is ALWAYS exactly one frame, at every tier (`docs/architecture.md`: "a photo
// submission is always exactly 1 frame regardless of tier"), so this path never consults quota at
// all — no `quota-status` round trip is made for a photo, and nothing about it changed when video
// gained a real cap.
const PHOTO_FRAME_COUNT = 1;

// Mirrors `lib/parse-capture-params.ts`'s private helper of the same name — kept local rather
// than exported/shared so this file's only-file-touched-by-#147 fix doesn't ripple into that
// module. Used below to pull scalar values out of route params for a stable useMemo dependency
// list (see the comment on `media`).
function firstString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

type ExtractState =
  // Resolving the caller's authoritative video frame cap off `quota-status` before any thumbnail
  // work starts. Deliberately has NO frame numbers to show: the progress caption's total must
  // never name a count the extraction might not produce, and until this resolves the real total is
  // genuinely unknown. Bounded by `QUOTA_WAIT_TIMEOUT_MS`, so it cannot outlast one round trip;
  // the screen's own always-rendered title ("Preparing your analysis") is what describes it.
  // Never entered for a photo — see `PHOTO_FRAME_COUNT`.
  | { status: 'preparing' }
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
  const styles = createStyles(colors);

  // Issue #147: `params` (expo-router's useLocalSearchParams()) is a NEW object reference every
  // render, so a useMemo keyed on `params` itself recomputes every render, which fed a fresh
  // `media` into the effect below on every pass and looped it forever ("Maximum update depth
  // exceeded"). Keying on the parsed scalar strings instead — pulled via `firstString` to also
  // cover the string[] case for a repeated param — makes the memo (and the effect depending on
  // `media`) stable across renders that don't actually change the input. Do not go back to
  // `[params]`.
  const paramUri = firstString(params.uri);
  const paramMediaType = firstString(params.mediaType);
  const paramDurationMs = firstString(params.durationMs);
  const paramWidth = firstString(params.width);
  const paramHeight = firstString(params.height);
  // Deliberately NOT `params` itself (see the comment above); these primitives are the real,
  // stable dependency set.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const media = useMemo<PaceMediaInput | null>(() => parseCaptureParams(params), [
    paramUri,
    paramMediaType,
    paramDurationMs,
    paramWidth,
    paramHeight,
  ]);

  const [state, setState] = useState<ExtractState>({ status: 'preparing' });
  const [attempt, setAttempt] = useState(0);
  // Issue #11: the extracting-progress caption below carries `accessibilityLiveRegion="polite"`,
  // Android-only — this is the iOS complement. The ready/error branches carried no live region on
  // EITHER platform (a status message that reached no screen reader at all, not just an iOS gap) —
  // `accessibilityLiveRegion="polite"` is added to those two Texts below to match, so both
  // platforms get an announcement through that prop + this hook together.
  useAnnounce(
    state.status === 'extracting'
      ? Copy.upload.step.extracting(state.done, state.total)
      : state.status === 'ready'
        ? `${Copy.upload.ready.title} ${Copy.upload.ready.body(state.frameSet.frames.length)}`
        : state.status === 'error'
          ? `${errorCopy(state).title} ${errorCopy(state).body}`
          : null
  );

  useEffect(() => {
    if (!media) {
      setState({ status: 'error', kind: 'extractionFailed' });
      return;
    }

    const input = media;
    let cancelled = false;
    setState({ status: 'preparing' });

    // Pre-flight re-check (defense in depth): app/capture/index.tsx and record.tsx already
    // checked their own inputs, but this screen is the one place both paths converge, so it's
    // also the cheapest place to catch anything that slipped through — e.g. a stale/expired
    // cache uri whose size now reads differently.
    const violation = checkMediaCaps({
      durationMs: input.mediaType === 'video' ? input.durationMs : null,
      fileSizeBytes: readFileSizeBytes(input.uri),
    });
    if (violation) {
      setState({ status: 'error', kind: 'capViolation', violation });
      return;
    }

    // ONE number drives both the progress total and the extraction itself — that is the whole
    // structural point of this function. They used to be two independent reads of the same
    // hardcoded constant, which is precisely the shape that let the caption promise a count the
    // extraction did not produce. There is now no way to change one without the other.
    function startExtraction(frameCount: number) {
      setState({ status: 'extracting', done: 0, total: frameCount });

      extractFrames(input, frameCount, (done, framesTotal) => {
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
    }

    if (input.mediaType === 'photo') {
      // Synchronously, with no quota round trip and no `preparing` frame in between: a photo is
      // always exactly one frame at every tier, so there is nothing to ask the server about.
      startExtraction(PHOTO_FRAME_COUNT);
    } else {
      // A video's cap is the caller's own, read off `quota-status` — the bug this screen shipped
      // with was hardcoding Free's 1 frame here for everyone, silently degrading every paying
      // user's analysis (Cadence and Elasticity cannot score off a single still). This resolves to
      // the free cap on a failed/unauthorized/slow lookup and never to a higher one; see
      // `lib/extraction-frame-cap.ts` for each branch.
      fetchVideoFrameCap()
        // Contractually unreachable (`fetchVideoFrameCap` folds every failure into a usable count),
        // but a rejection escaping here would strand the screen in `preparing` forever. Falling
        // back keeps the submission working instead of hanging on a spinner.
        .catch(() => FALLBACK_VIDEO_FRAME_CAP)
        .then((frameCount) => {
          if (!cancelled) startExtraction(frameCount);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [media, attempt]);

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
    <ScreenGradient>
      <SafeAreaView style={styles.safeArea}>
      {/* ScrollView + flexGrow, not a plain flex:1 View (issue #63) — same Dynamic Type
          reflow-not-clip pattern as app/(tabs)/index.tsx: the error state stacks a title, body,
          and up to two buttons, which could otherwise overflow a small phone at the largest
          accessibility text sizes with no way to reach the second button. */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* L2 (v23-ux-audit-r1): this eyebrow used to render unconditionally, so the error state
            said "Preparing your analysis" and "Couldn't process this clip" at the same time.
            Skipped in the error branch — its own title below carries `accessibilityRole="header"`
            instead, so the screen still has exactly one heading, just a failure-appropriate one. */}
        {state.status !== 'error' && (
          <Eyebrow tone="primary" accessibilityRole="header">
            {Copy.upload.title}
          </Eyebrow>
        )}

        {/* Spinner only, and no numeric caption or progress bar — the total is not known yet and
            this screen must not name one it might not honour. The always-rendered title above
            ("Preparing your analysis") already describes this state, so no new copy-deck string is
            invented for it. Bounded by QUOTA_WAIT_TIMEOUT_MS. */}
        {state.status === 'preparing' && (
          <View style={styles.centered}>
            {/* The same ambient low-poly mark the Analyzing wait uses, for the same reason and
                under the same rule: it signals "alive", never progress. The progress BAR below
                is different — that one is real, driven by a known frame count. */}
            <LowPolyField
              color={colors.text.primary}
              size={WAIT_MARK_SIZE}
              testID="extracting-mark"
            />
            {/* L1 (v23-ux-audit-r1): neither wait state offered an escape — bounded by
                QUOTA_WAIT_TIMEOUT_MS so it can't hang forever, but a long extraction otherwise
                trapped the user on this screen with nothing to press. */}
            <PillButton variant="ghost" label="Cancel" onPress={goToSourcePicker} />
          </View>
        )}

        {state.status === 'extracting' && (
          <View style={styles.centered}>
            <LowPolyField color={colors.text.primary} size={WAIT_MARK_SIZE} />
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
            <PillButton variant="ghost" label="Cancel" onPress={goToSourcePicker} />
          </View>
        )}

        {state.status === 'ready' && (
          <View style={styles.centered}>
            <Text style={styles.resultTitle} accessibilityLiveRegion="polite">
              {Copy.upload.ready.title}
            </Text>
            <Text style={styles.caption}>{Copy.upload.ready.body(state.frameSet.frames.length)}</Text>
            <PillButton label={Copy.upload.ready.cta} onPress={goToAnalyzing} style={styles.cta} />
          </View>
        )}

        {state.status === 'error' && (
          <View style={styles.centered}>
            <Text style={styles.errorTitle} accessibilityRole="header" accessibilityLiveRegion="polite">
              {errorCopy(state).title}
            </Text>
            <Text style={styles.caption}>{errorCopy(state).body}</Text>
            {state.kind === 'extractionFailed' && (
              <PillButton label="Retry" onPress={() => setAttempt((n) => n + 1)} style={styles.cta} />
            )}
            <PillButton variant="ghost" label="Back" onPress={goToSourcePicker} />
          </View>
        )}
      </ScrollView>
      </SafeAreaView>
    </ScreenGradient>
  );
}

function errorCopy(state: Extract<ExtractState, { status: 'error' }>): { title: string; body: string } {
  if (state.kind === 'budgetExceeded') return Copy.upload.error.budgetExceeded;
  if (state.kind === 'extractionFailed') return Copy.upload.error.extractionFailed;
  return state.violation === 'clipTooLong' ? Copy.sourcePicker.error.clipTooLong : Copy.sourcePicker.error.fileTooLarge;
}

/** The waiting field's drawn size, matching app/analyzing.tsx's — the two waits are one moment
 *  split across two screens and should not look like different products. */
const WAIT_MARK_SIZE = 200;

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      // Transparent — `<ScreenGradient>` behind it owns the fill.
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
      // flexGrow, not flex — this is now a ScrollView contentContainerStyle (issue #63): fills
      // the viewport when the content is short, scrolls instead of clipping when it isn't.
      flexGrow: 1,
      width: '100%',
      maxWidth: ContentWidth.readable,
      alignSelf: 'center',
      padding: Spacing.xl,
      gap: Spacing.xl,
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
      lineHeight: FontSize.sm * LineHeight.body,
      // On the wash — `text.primary` only (`Gradient`'s contract, constants/theme.ts).
      color: colors.text.primary,
      textAlign: 'center',
    },
    resultTitle: {
      fontFamily: FontFamily.display.bold,
      fontSize: FontSize.xxl,
      letterSpacing: Tracking.display,
      lineHeight: FontSize.xxl * LineHeight.display,
      color: colors.text.primary,
      textAlign: 'center',
    },
    // `Semantic.error` is proven against the opaque surfaces, NOT against the page gradient
    // (`Gradient`'s contract). This title sits on the wash, so it takes `text.primary` and the
    // error is carried by the copy — which names the failure explicitly — rather than by a hue
    // whose contrast this backdrop cannot guarantee. Flagged as a judgement call.
    errorTitle: {
      fontFamily: FontFamily.display.bold,
      fontSize: FontSize.xxl,
      letterSpacing: Tracking.display,
      lineHeight: FontSize.xxl * LineHeight.display,
      color: colors.text.primary,
      textAlign: 'center',
    },
    progressTrack: {
      width: '80%',
      // Thickened to match the readout's own bar (components/pace-readout.tsx) — this is the app's
      // other real progress indicator and the two should read as the same object.
      height: Spacing.md,
      borderRadius: Radius.pill,
      backgroundColor: colors.hairline,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: Radius.pill,
      backgroundColor: Accent.value,
    },
    cta: {
      alignSelf: 'stretch',
      marginTop: Spacing.sm,
    },
  });
}
