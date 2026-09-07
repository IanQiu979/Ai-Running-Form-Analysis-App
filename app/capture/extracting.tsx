/**
 * Extracting (design brief screen 5, "Uploading / Extracting" in the copy deck; issue #36) —
 * runs `lib/frames.ts`'s `extractFrames` against whatever `app/capture/index.tsx` (library pick)
 * or `app/capture/record.tsx` (in-app recording) handed off via route params, with a real,
 * honest progress readout (not theatre). A video's frames are DECODED in one batch
 * `expo-video` `generateThumbnailsAsync` call, so `onProgress` reports the actual Nth of N
 * thumbnails re-encoded after that batch returns — a real count of completed work, not a timer.
 *
 * THE PRE-FLIGHT: one bounded `quota-status` call (`lib/analysis-preflight.ts`'s
 * `fetchAnalysisPreflight()`), awaited before ANY thumbnail work, answering two things at once.
 *
 * 1. MAY THIS RUNNER START AT ALL. Both refusals that can end an analysis — the allowance cap and
 *    issue #6's anti-farm cooldown — live in `reserve_analysis`, which the server does not reach
 *    until frames have been extracted AND submitted. Without this gate a capped or cooling-down
 *    runner filmed, waited through extraction, waited again on the Analyzing screen, and only then
 *    learned they were never eligible. A `cooldown` gate renders the honest paused panel below
 *    (no Retry — retrying cannot succeed until the window clears); an `exhausted` gate replaces
 *    into `/paywall`, the same destination a server 402 already routes to, which states the real
 *    allowance. Everything else — including every lookup failure — proceeds, because the client is
 *    never the authority and a blip must not fabricate a refusal (see that module's fail-open rule).
 *
 * 2. HOW MANY FRAMES A VIDEO GETS: the caller's own `frameCap`, read off the server, fed to BOTH
 *    the progress total and `extractFrames`, so the caption can never promise a count the
 *    extraction will not produce. It does NOT read `quota.tier` and index a client-side table —
 *    CLAUDE.md: "Tier, quota, frame cap, and analysis are server-only ... the client may display
 *    tier/quota state but is never the authority for it." A failed, unauthorized, or slow lookup
 *    degrades to the free cap on purpose, never to a higher one.
 *
 * A PHOTO NOW TAKES THIS CALL TOO, where it used to skip quota entirely. Its frame count still
 * never depends on the answer (a photo is always exactly one frame at every tier), but its
 * eligibility does, and one bounded round trip is a far better price than a 20-60s analysis wait
 * ending in a refusal.
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
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArcLoader } from '@/components/arc-loader';
import { LowPolyField } from '@/components/low-poly-field';
import { ArcRing } from '@/components/ui/arc-ring';
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
  Semantic,
  Spacing,
  Tracking,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  describeCooldownRemaining,
  fetchAnalysisPreflight,
  type AnalysisPreflight,
} from '@/lib/analysis-preflight';
import { setPendingAnalyzeFormRequest, toAnalyzeFormRequest } from '@/lib/analyze-form';
import { FALLBACK_VIDEO_FRAME_CAP } from '@/lib/extraction-frame-cap';
import {
  extractFrames,
  FrameBudgetExceededError,
  InsufficientFramesError,
  type PaceFrameSet,
  type PaceMediaInput,
} from '@/lib/frames';
import { checkMediaCaps, type MediaCapViolation } from '@/lib/media-caps';
import { readFileSizeBytes } from '@/lib/media-file-size';
import { parseCaptureParams } from '@/lib/parse-capture-params';
import { useAnnounce } from '@/lib/use-announce';

// A photo submission is ALWAYS exactly one frame, at every tier (`docs/architecture.md`: "a photo
// submission is always exactly 1 frame regardless of tier"), so a photo's frame COUNT never
// depends on the quota answer. Its ELIGIBILITY does: the photo path takes the same `quota-status`
// pre-flight round trip as video, so a capped or cooling-down runner is refused up front.
const PHOTO_FRAME_COUNT = 1;

// Mirrors `lib/parse-capture-params.ts`'s private helper of the same name — kept local rather
// than exported/shared so this file's only-file-touched-by-#147 fix doesn't ripple into that
// module. Used below to pull scalar values out of route params for a stable useMemo dependency
// list (see the comment on `media`).
function firstString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

type ExtractState =
  // The pre-flight round trip: may this runner start, and how many frames does their video get.
  // Deliberately has NO frame numbers to show: the progress caption's total must never name a
  // count the extraction might not produce, and until this resolves the real total is genuinely
  // unknown. Bounded by `QUOTA_WAIT_TIMEOUT_MS`, so it cannot outlast one round trip; the
  // screen's own always-rendered title ("Preparing your analysis") is what describes it. Entered
  // for a photo too since the gate applies to every submission — see this file's header.
  | { status: 'preparing' }
  | { status: 'extracting'; done: number; total: number }
  // Carries the full PaceFrameSet, not just a count — goToAnalyzing needs the actual frames to
  // build the AnalyzeFormRequest; frameCount for display is just `frameSet.frames.length`.
  | { status: 'ready'; frameSet: PaceFrameSet }
  | { status: 'error'; kind: 'budgetExceeded' }
  // `lib/frames.ts`'s InsufficientFramesError — too few distinct frames survived the burst. Like
  // budgetExceeded and unlike extractionFailed it is deterministic per clip, so it renders no
  // Retry control: the same footage would collide the same way every time.
  | { status: 'error'; kind: 'unsupportedFootage' }
  | { status: 'error'; kind: 'extractionFailed' }
  | { status: 'error'; kind: 'capViolation'; violation: MediaCapViolation }
  // Issue #6's anti-farm cooldown, caught by the pre-flight before any extraction. NOT an
  // `error` kind on purpose: nothing failed, so it must never reach `errorCopy`'s failure
  // wording, and — like budgetExceeded and unsupportedFootage, and unlike extractionFailed — it
  // renders no Retry, because retrying cannot succeed until the window clears. `blockedUntil` is
  // carried so the panel can say how long is left.
  | { status: 'paused'; blockedUntil: string | null };

export default function ExtractingScreen() {
  const router = useRouter();
  // Issue #147's lesson applied to navigation: `useRouter()` is NOT contractually a stable
  // reference across renders, and the pre-flight effect below must never list it as a dependency —
  // a fresh object per render would re-run the effect on every pass, which is exactly the render
  // loop that crashed this screen once already. Held in a ref so the effect can navigate on an
  // `exhausted` gate without taking a dependency on it.
  const routerRef = useRef(router);
  routerRef.current = router;
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
          : state.status === 'paused'
            ? `${Copy.analysisPause.title} ${analysisPauseBody(state.blockedUntil)}`
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
          } else if (error instanceof InsufficientFramesError) {
            // Checked BEFORE the generic branch: InsufficientFramesError IS a
            // FrameExtractionError, and the generic branch's copy invites a retry that cannot
            // succeed for this clip.
            setState({ status: 'error', kind: 'unsupportedFootage' });
          } else {
            setState({ status: 'error', kind: 'extractionFailed' });
          }
        });
    }

    // THE GATE, then the extraction. A refusal here costs the runner one bounded round trip; the
    // same refusal from `reserve_analysis` costs them the whole extraction plus a 20-60s wait, and
    // used to arrive dressed as a failure. Only a gate the SERVER stated is honoured — see
    // `lib/analysis-preflight.ts`'s fail-open rule.
    function applyPreflight({ gate, frameCap }: AnalysisPreflight) {
      if (cancelled) return;


      if (gate.kind === 'cooldown') {
        setState({ status: 'paused', blockedUntil: gate.blockedUntil });
        return;
      }

      if (gate.kind === 'exhausted') {
        // The same destination a server 402 already routes to from `app/analyzing.tsx` — it
        // re-reads live quota on mount and states the real allowance, so no params are needed and
        // this screen never has to restate an allowance it is not the authority for.
        routerRef.current.replace('/paywall');
        return;
      }

      // A photo is always exactly one frame at every tier, so its count never depends on the
      // answer even though its eligibility does. A video's cap is the caller's own: the bug this
      // screen shipped with was hardcoding Free's 1 frame here for everyone, silently degrading
      // every paying user's analysis (Cadence and Elasticity cannot score off a single still).
      startExtraction(input.mediaType === 'photo' ? PHOTO_FRAME_COUNT : frameCap);
    }

    fetchAnalysisPreflight()
      // Contractually unreachable (`fetchAnalysisPreflight` folds every failure into a usable
      // answer), but a rejection escaping here would strand the screen in `preparing` forever.
      // Failing open keeps the submission working instead of hanging on a spinner.
      .catch((): AnalysisPreflight => ({ gate: { kind: 'allowed' }, frameCap: FALLBACK_VIDEO_FRAME_CAP }))
      .then(applyPreflight);

    return () => {
      cancelled = true;
    };
  }, [media, attempt]);

  function goToSourcePicker() {
    router.replace('/capture');
  }

  /** The paused panel's only control. Home, not the source picker: picking different footage
   *  cannot lift a cooldown, and Home is where the same countdown is already shown. */
  function goHome() {
    router.replace('/');
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
            instead, so the screen still has exactly one heading, just a failure-appropriate one.
            The paused branch is skipped for the same two reasons: "Preparing your analysis" would
            contradict "Analyses are paused for now", and its panel title is that state's heading. */}
        {state.status !== 'error' && state.status !== 'paused' && (
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
            {/* The INDETERMINATE sibling of the extracting ring below: the frame total is not
                known yet, so this state gets `<ArcLoader>`'s turning rings — which can never be
                read as progress — rather than a ring at some invented fraction. */}
            <View style={styles.waitMark}>
              <ArcLoader size={WAIT_MARK_SIZE * 1.35} style={styles.waitRings} testID="extracting-rings" />
              <LowPolyField
                color={colors.text.primary}
                size={WAIT_MARK_SIZE}
                testID="extracting-mark"
              />
            </View>
            {/* L1 (v23-ux-audit-r1): neither wait state offered an escape — bounded by
                QUOTA_WAIT_TIMEOUT_MS so it can't hang forever, but a long extraction otherwise
                trapped the user on this screen with nothing to press. */}
            <PillButton variant="ghost" label="Cancel" onPress={goToSourcePicker} />
          </View>
        )}

        {state.status === 'extracting' && (
          <View style={styles.centered}>
            {/* Cadence Arcs (2026-09-01): the horizontal progress bar became a ring drawn AROUND
                the mark, so the extraction reads as one object filling rather than as a figure
                with a bar underneath it. This ring is genuinely DETERMINATE — unlike the wait
                states' `<ArcLoader>`, it is driven by a real, known frame count, which is exactly
                the distinction the old bar's own comment drew and this keeps. `animate={false}`
                is deliberate: springing between progress values would make a determinate readout
                feel approximate, and `<ArcRing>` re-renders a static ring on every fraction
                change (see its `staticOffset`). */}
            <View style={styles.waitMark}>
              <ArcRing
                testID="extracting-progress-ring"
                size={WAIT_MARK_SIZE * 1.35}
                strokeWidth={Spacing.md}
                fraction={state.total > 0 ? state.done / state.total : 0}
                color={Accent.value}
                style={styles.waitRings}
              />
              <LowPolyField color={colors.text.primary} size={WAIT_MARK_SIZE} />
            </View>
            <Text style={styles.caption} accessibilityLiveRegion="polite">
              {Copy.upload.step.extracting(state.done, state.total)}
            </Text>
            <PillButton variant="ghost" label="Cancel" onPress={goToSourcePicker} />
          </View>
        )}

        {state.status === 'ready' && (
          <View style={styles.centered}>
            {/* The SAME ring and the SAME field as the extracting state above, at a full sweep —
                so preparing -> extracting -> ready reads as one object completing rather than as
                three unrelated pictures. `fraction={1}` is a statement of fact here (every frame
                the extraction promised is in memory), not a decoration. */}
            <View style={styles.waitMark}>
              <ArcRing
                size={WAIT_MARK_SIZE * 1.35}
                strokeWidth={Spacing.md}
                fraction={1}
                color={Accent.value}
                style={styles.waitRings}
              />
              <LowPolyField color={colors.text.primary} size={WAIT_MARK_SIZE} />
            </View>
            {/* On a `<SurfaceCard>`, matching the panel idiom the other two capture screens use —
                and, unlike the wash, an opaque surface this screen's body copy is proven against. */}
            <SurfaceCard style={styles.panel}>
              <View style={styles.panelStack}>
                <Text style={styles.resultTitle} accessibilityLiveRegion="polite">
                  {Copy.upload.ready.title}
                </Text>
                <Text style={styles.caption}>{Copy.upload.ready.body(state.frameSet.frames.length)}</Text>
                <PillButton label={Copy.upload.ready.cta} onPress={goToAnalyzing} style={styles.cta} />
              </View>
            </SurfaceCard>
          </View>
        )}

        {/* Issue #6's cooldown, caught by the pre-flight before a single frame was extracted.
            Rendered on the SAME `<SurfaceCard>` panel as the error states — this is a stop, and it
            should look like one — but with the paused copy rather than a failure title, and with
            NO Retry: the window has to clear before anything here can succeed, so a Retry would be
            a button that cannot work. `describeCooldownRemaining` returning null is what selects
            the no-time-known wording; nothing here invents a countdown. */}
        {state.status === 'paused' && (
          <View style={styles.centered}>
            <SurfaceCard style={styles.panel}>
              <View style={styles.panelStack}>
                <Text style={styles.errorTitle} accessibilityRole="header" accessibilityLiveRegion="polite">
                  {Copy.analysisPause.title}
                </Text>
                <Text style={styles.caption} testID="analysis-paused-body">
                  {analysisPauseBody(state.blockedUntil)}
                </Text>
                <PillButton label={Copy.analysisPause.cta} onPress={goHome} style={styles.cta} />
              </View>
            </SurfaceCard>
          </View>
        )}

        {state.status === 'error' && (
          <View style={styles.centered}>
            <SurfaceCard style={styles.panel}>
              <View style={styles.panelStack}>
                <Text style={styles.errorTitle} accessibilityRole="header" accessibilityLiveRegion="polite">
                  {errorCopy(state).title}
                </Text>
                <Text style={styles.caption}>{errorCopy(state).body}</Text>
                {state.kind === 'extractionFailed' && (
                  <PillButton label="Retry" onPress={() => setAttempt((n) => n + 1)} style={styles.cta} />
                )}
                <PillButton variant="ghost" label="Back" onPress={goToSourcePicker} />
              </View>
            </SurfaceCard>
          </View>
        )}
      </ScrollView>
      </SafeAreaView>
    </ScreenGradient>
  );
}

/** The cooldown body, with the time left when the server gave us a usable one and without it when
 *  it did not — never a guessed or zeroed countdown. Read at render time rather than when the
 *  state was set so the phrase does not go stale if the panel is on screen for a while. */
function analysisPauseBody(blockedUntil: string | null): string {
  const remaining = describeCooldownRemaining(blockedUntil);
  return remaining ? Copy.analysisPause.bodyFor(remaining) : Copy.analysisPause.body;
}

function errorCopy(state: Extract<ExtractState, { status: 'error' }>): { title: string; body: string } {
  if (state.kind === 'budgetExceeded') return Copy.upload.error.budgetExceeded;
  if (state.kind === 'unsupportedFootage') return Copy.upload.error.unsupportedFootage;
  if (state.kind === 'extractionFailed') return Copy.upload.error.extractionFailed;
  return state.violation === 'clipTooLong' ? Copy.sourcePicker.error.clipTooLong : Copy.sourcePicker.error.fileTooLarge;
}

/** The waiting field's drawn size, matching app/analyzing.tsx's — the two waits are one moment
 *  split across two screens and should not look like different products. */
const WAIT_MARK_SIZE = 200;

function createStyles(colors: ThemeColors, scheme: ColorScheme) {
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
      // `text.primary`, because this same style is also used by the extracting caption, which sits
      // directly on the wash — and the wash carries `text.primary` ONLY (`Gradient`'s contract,
      // constants/theme.ts). Legal on the ready/error cards too; a surface is proven for both roles.
      color: colors.text.primary,
      textAlign: 'center',
    },
    // The ready/error panels. `alignSelf: 'stretch'` so the card fills the readable column rather
    // than shrink-wrapping its longest line.
    panel: {
      alignSelf: 'stretch',
    },
    // Spacing only — fill, corner, edge and interior padding come from `<SurfaceCard>`. A `gap` on
    // the card's own `style` would land on its outer shadow node, whose single child is the clip
    // view, and silently do nothing.
    panelStack: {
      gap: Spacing.md,
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
    // (`Gradient`'s contract) — which is why this title used to take `text.primary` and let the
    // copy carry the failure. Now that the error block sits on a `<SurfaceCard>`, the hue is on a
    // backdrop it IS proven against, so the state reads as a failure at a glance as well as in
    // words. Same treatment as `app/capture/index.tsx`'s `panelTitleError`.
    errorTitle: {
      fontFamily: FontFamily.display.bold,
      fontSize: FontSize.xxl,
      letterSpacing: Tracking.display,
      lineHeight: FontSize.xxl * LineHeight.display,
      color: Semantic.error[scheme],
      textAlign: 'center',
    },
    // The mark and its ring share one centre. The ring is absolute, so adding it did not move the
    // figure by a point. Replaces `progressTrack`/`progressFill`: the readout this screen's bar
    // was matched to is a ring now (components/pace-readout.tsx), and the two should still read as
    // the same object.
    waitMark: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    waitRings: {
      position: 'absolute',
    },
    cta: {
      alignSelf: 'stretch',
      marginTop: Spacing.sm,
    },
  });
}
