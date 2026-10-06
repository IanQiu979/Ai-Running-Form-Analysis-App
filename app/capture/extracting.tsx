/**
 * Preparing (`/capture/extracting`; issue #36, rebuilt 2026-10-06 to the captain's Claude Design
 * page "Preparing & Analysing — V23") — the pre-flight, then the on-device frame extraction, with
 * the runner's REAL frames landing in the strip as they are pulled, then the hand-off to Analysing.
 *
 * THE PRE-FLIGHT: one connectivity read, then one bounded `quota-status` call
 * (`lib/analysis-preflight.ts`'s `fetchAnalysisPreflight()`), both awaited before ANY thumbnail
 * work. It answers three things at once.
 *
 * 1. MAY THIS RUNNER START AT ALL. Both refusals that can end an analysis — the allowance cap and
 *    issue #6's anti-farm cooldown — live in `reserve_analysis`, which the server does not reach
 *    until frames have been extracted AND submitted. Without this gate a capped or cooling-down
 *    runner filmed, waited through extraction, waited again on Analysing, and only then learned
 *    they were never eligible. A `cooldown` gate renders the paused state (a real countdown from
 *    `blockedUntil` when the server gave one; at zero, Continue asks the server again — it never
 *    unlocks on the client's own clock). An `exhausted` gate renders the out-of-analyses state:
 *    the paid version with the period's reset date, or Free's — one analysis for life, no reset —
 *    and "See plans" opens `/paywall`. Everything else — including every lookup failure — proceeds,
 *    because the client is never the authority and a blip must not fabricate a refusal.
 *
 * 2. HOW MANY FRAMES A VIDEO GETS: the caller's own `frameCap`, read off the server, fed to BOTH
 *    the progress total and `extractFrames`, so the caption can never promise a count the
 *    extraction will not produce (CLAUDE.md: tier, quota and frame cap are server-only). A failed,
 *    unauthorized, or slow lookup degrades to the free cap on purpose, never to a higher one.
 *
 * 3. WHAT TO SHOW: the reading itself (`preflight.quota`) for display only — "4 left", the Elite
 *    badge, the out-of-analyses numbers. A reading that failed open states no number at all.
 *
 * OFFLINE: a connectivity read that is definitely offline stops here with the offline state —
 * nothing has been extracted, nothing sent, and the clip stays on the phone. "Try again" re-runs
 * the whole pre-flight.
 *
 * A PHOTO takes the same pre-flight: its frame count never depends on the answer (always one
 * frame), but its eligibility does.
 *
 * No client-side "uploading %" step: since issue #88 the client never uploads anything —
 * `analyze-form` writes the frames server-side, after the model call. This screen's whole job ends
 * at a valid, budget-compliant `PaceFrameSet` in memory.
 *
 * FRAMES ON SCREEN. Each frame `extractFrames` accepts is reported through its progress callback
 * and drawn at once through `<DuotoneFrame deviceBase64>` — the app's duotone grade, under the
 * private-frame no-cache policy (`lib/private-frame-image.ts`). The bytes never leave memory here.
 *
 * WHERE THE FRAME SET GOES (issue #135): "Start analysis" mints an idempotency key, builds the
 * wire-shaped `AnalyzeFormRequest`, stages it on `lib/analyze-form.ts`'s one-shot mailbox (bound to
 * the signed-in user, 2026-10-06), and `router.replace`s to `/analyzing`. NOT route params: a
 * request carries megabytes of base64 frame data, and expo-router serializes params into the URL.
 * Staging a new analysis also drops any session-expired analysis still held for resume
 * (`lib/resumable-analysis.ts`) — the runner has moved on to this one.
 */
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Checklist,
  FrameStrip,
  FrameTile,
  HeaderBack,
  KeyValueCard,
  LoadingHeader,
  NotCounted,
  Pulse,
  StopHeadline,
  StopIconBox,
  type StopIconName,
} from '@/components/loading-parts';
import { SquareButton } from '@/components/ui/square-button';
import { Copy } from '@/constants/copy';
import { Ink, Layout, Space, Type } from '@/constants/v23-theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { fetchAnalysisPreflight, type AnalysisPreflight } from '@/lib/analysis-preflight';
import { setPendingAnalyzeFormRequest, toAnalyzeFormRequest } from '@/lib/analyze-form';
import { checkConnectivity } from '@/lib/connectivity';
import {
  daysUntil,
  formatCountdown,
  formatCountdownCompact,
  formatResetDate,
  msUntil,
  remainingFraction,
} from '@/lib/countdown';
import { FALLBACK_VIDEO_FRAME_CAP } from '@/lib/extraction-frame-cap';
import {
  extractFrames,
  FrameBudgetExceededError,
  InsufficientFramesError,
  type PaceFrame,
  type PaceFrameSet,
  type PaceMediaInput,
} from '@/lib/frames';
import {
  preparingBadgeParts,
  preparingChecklist,
  preparingHeroIndex,
  preparingTileStatus,
  quotaPanel,
  quotaRemaining,
  type MediaKind,
  type PreparingStage,
} from '@/lib/loading-screens';
import { checkMediaCaps, type MediaCapViolation } from '@/lib/media-caps';
import { readFileSizeBytes } from '@/lib/media-file-size';
import { parseCaptureParams } from '@/lib/parse-capture-params';
import { discardResumableAnalysis } from '@/lib/resumable-analysis';
import { useSession } from '@/lib/session-provider';
import { useAnnounce } from '@/lib/use-announce';
import type { QuotaStatus } from '@shared/quota-status';

// A photo submission is ALWAYS exactly one frame, at every tier (`docs/architecture.md`).
const PHOTO_FRAME_COUNT = 1;

/** The countdown's tick: the smallest unit it shows. */
const COUNTDOWN_TICK_MS = 1000;

/** The page draws a photo's single tile one third of the width. */
const PHOTO_STRIP_COLUMNS = 3;

/** The page's tile shape on this screen. */
const TILE_ASPECT = 3 / 4;

// Mirrors `lib/parse-capture-params.ts`'s private helper of the same name; used to pull scalar
// values out of route params for a stable useMemo dependency list (issue #147).
function firstString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export type FrameSlot = PaceFrame | 'skipped';

type ErrorKind = 'budgetExceeded' | 'unsupportedFootage' | 'extractionFailed' | 'capViolation';

export type ExtractState =
  // The pre-flight round trip. Deliberately has NO frame numbers: until it resolves the real total
  // is genuinely unknown, and the screen must not name a count it might not honour.
  | { status: 'preparing' }
  // `slots[i]` is step i's outcome: the frame it accepted, or 'skipped' when `lib/frames.ts`
  // dropped it as a duplicate — so a tile's image and its status always come from the same step.
  | { status: 'extracting'; done: number; total: number; slots: FrameSlot[] }
  // `total` is the number of frames actually extracted, which can be fewer than requested when
  // duplicates were dropped: the hero, segments, badge and rows then state the real count.
  | { status: 'ready'; frameSet: PaceFrameSet; total: number }
  | { status: 'error'; kind: Exclude<ErrorKind, 'capViolation'> }
  | { status: 'error'; kind: 'capViolation'; violation: MediaCapViolation }
  // Issue #6's cooldown. NOT an error: nothing failed. `blockedUntil` drives the countdown.
  | { status: 'paused'; blockedUntil: string | null }
  // The allowance is used up. `quota` is the server's reading (null if it stated none).
  | { status: 'exhausted'; quota: QuotaStatus | null }
  // The connectivity read was definitely offline before anything started.
  | { status: 'offline' };

export default function ExtractingScreen() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const params = useLocalSearchParams<{
    mediaType?: string;
    uri?: string;
    durationMs?: string;
    width?: string;
    height?: string;
  }>();

  // Issue #147: `params` is a NEW object every render, so the memo keys on the parsed scalar
  // strings instead — do not go back to `[params]`, it loops the effect below forever.
  const paramUri = firstString(params.uri);
  const paramMediaType = firstString(params.mediaType);
  const paramDurationMs = firstString(params.durationMs);
  const paramWidth = firstString(params.width);
  const paramHeight = firstString(params.height);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const media = useMemo<PaceMediaInput | null>(() => parseCaptureParams(params), [
    paramUri,
    paramMediaType,
    paramDurationMs,
    paramWidth,
    paramHeight,
  ]);
  const mediaKind: MediaKind = media?.mediaType ?? (paramMediaType === 'photo' ? 'photo' : 'video');

  const [state, setState] = useState<ExtractState>({ status: 'preparing' });
  // The server's reading, kept beside the state so the checklist and badge can show it while
  // extraction runs. `undefined` until the pre-flight answers; `null` when it stated nothing.
  const [quota, setQuota] = useState<QuotaStatus | null | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!media) {
      setState({ status: 'error', kind: 'extractionFailed' });
      return;
    }

    const input = media;
    let cancelled = false;
    setState({ status: 'preparing' });
    setQuota(undefined);

    // Pre-flight re-check (defense in depth): the capture screens checked their own inputs, but
    // this is the one place both paths converge.
    const violation = checkMediaCaps({
      durationMs: input.mediaType === 'video' ? input.durationMs : null,
      fileSizeBytes: readFileSizeBytes(input.uri),
    });
    if (violation) {
      setState({ status: 'error', kind: 'capViolation', violation });
      return;
    }

    // ONE number drives both the progress total and the extraction itself.
    function startExtraction(frameCount: number) {
      const slots: FrameSlot[] = [];
      setState({ status: 'extracting', done: 0, total: frameCount, slots: [] });

      extractFrames(input, frameCount, (done, framesTotal, frame) => {
        slots[done - 1] = frame ?? 'skipped';
        if (!cancelled) setState({ status: 'extracting', done, total: framesTotal, slots: [...slots] });
      })
        .then((frameSet) => {
          if (!cancelled) setState({ status: 'ready', frameSet, total: frameSet.frames.length });
        })
        .catch((error) => {
          if (cancelled) return;
          if (error instanceof FrameBudgetExceededError) {
            setState({ status: 'error', kind: 'budgetExceeded' });
          } else if (error instanceof InsufficientFramesError) {
            // Checked BEFORE the generic branch: InsufficientFramesError IS a FrameExtractionError,
            // and the generic branch's copy invites a retry that cannot succeed for this clip.
            setState({ status: 'error', kind: 'unsupportedFootage' });
          } else {
            setState({ status: 'error', kind: 'extractionFailed' });
          }
        });
    }

    // THE GATE, then the extraction. Only a gate the SERVER stated is honoured — see
    // `lib/analysis-preflight.ts`'s fail-open rule.
    function applyPreflight({ gate, frameCap, quota: reading }: AnalysisPreflight) {
      if (cancelled) return;
      setQuota(reading);

      if (gate.kind === 'cooldown') {
        setState({ status: 'paused', blockedUntil: gate.blockedUntil });
        return;
      }
      if (gate.kind === 'exhausted') {
        setState({ status: 'exhausted', quota: reading });
        return;
      }
      startExtraction(input.mediaType === 'photo' ? PHOTO_FRAME_COUNT : frameCap);
    }

    checkConnectivity()
      // A connectivity read that cannot answer is not evidence of being offline.
      .catch(() => true)
      .then((online) => {
        if (cancelled) return;
        if (!online) {
          setState({ status: 'offline' });
          return;
        }
        fetchAnalysisPreflight()
          // Contractually unreachable, but a rejection escaping here would strand the screen.
          .catch(
            (): AnalysisPreflight => ({
              gate: { kind: 'allowed' },
              frameCap: FALLBACK_VIDEO_FRAME_CAP,
              quota: null,
            })
          )
          .then(applyPreflight);
      });

    return () => {
      cancelled = true;
    };
  }, [media, attempt]);

  // The cooldown countdown: a 1 s tick while paused with a known, future end. The bar drains from
  // how much was left when the pause was first shown — the server does not say when it began.
  const [now, setNow] = useState(() => Date.now());
  const pauseStartRemainingRef = useRef<number | null>(null);
  const blockedUntil = state.status === 'paused' ? state.blockedUntil : null;
  const pauseRemaining = state.status === 'paused' ? msUntil(blockedUntil, now) : null;
  useEffect(() => {
    if (state.status !== 'paused' || !blockedUntil) {
      pauseStartRemainingRef.current = null;
      return;
    }
    const startNow = Date.now();
    setNow(startNow);
    pauseStartRemainingRef.current = msUntil(blockedUntil, startNow);
    const handle = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if ((msUntil(blockedUntil, t) ?? 0) <= 0) clearInterval(handle);
    }, COUNTDOWN_TICK_MS);
    return () => clearInterval(handle);
  }, [state.status, blockedUntil]);

  function goToSourcePicker() {
    router.replace('/capture');
  }

  function goHome() {
    router.replace('/');
  }

  function retryFromStart() {
    setAttempt((n) => n + 1);
  }

  // The one control on the "ready" state (issue #135). A fresh idempotency key for THIS analysis:
  // every retry of it inside `app/analyzing.tsx` reuses this key; tapping here is a genuinely new,
  // user-initiated submission.
  function goToAnalyzing() {
    if (!media || state.status !== 'ready' || !userId) return;
    const idempotencyKey = Crypto.randomUUID();
    const request = toAnalyzeFormRequest(media.mediaType, state.frameSet, idempotencyKey);
    discardResumableAnalysis();
    setPendingAnalyzeFormRequest(request, userId);
    router.replace('/analyzing');
  }

  const announcement = announcementFor(state, mediaKind);
  useAnnounce(announcement);

  return (
    <PreparingView
      state={state}
      mediaKind={mediaKind}
      quota={quota}
      reduceMotion={reduceMotion}
      pauseRemaining={pauseRemaining}
      pauseStartRemaining={pauseStartRemainingRef.current}
      onSourcePicker={goToSourcePicker}
      onHome={goHome}
      onRetry={retryFromStart}
      onStart={goToAnalyzing}
      onSeePlans={() => router.replace('/paywall')}
    />
  );
}

// -------------------------------------------------------------------------------------------
// The view: everything this screen draws, from state and handlers alone — no effects, no I/O —
// so every state renders the same way in the screen, in its tests, and in a screenshot.
// -------------------------------------------------------------------------------------------

export type PreparingViewProps = {
  state: ExtractState;
  mediaKind: MediaKind;
  /** The pre-flight's reading: `undefined` before it answers, `null` when it stated nothing. */
  quota: QuotaStatus | null | undefined;
  reduceMotion: boolean;
  /** Paused only: ms left (`null` when the server gave no end) and ms left when first shown. */
  pauseRemaining: number | null;
  pauseStartRemaining: number | null;
  onSourcePicker: () => void;
  onHome: () => void;
  onRetry: () => void;
  onStart: () => void;
  onSeePlans: () => void;
};

export function PreparingView({
  state,
  mediaKind,
  quota,
  reduceMotion,
  pauseRemaining,
  pauseStartRemaining,
  onSourcePicker,
  onHome,
  onRetry,
  onStart,
  onSeePlans,
}: PreparingViewProps) {
  const insets = useSafeAreaInsets();
  const isWorking = state.status === 'preparing' || state.status === 'extracting' || state.status === 'ready';
  // The badge's count: the extraction's own total once it runs; before that (and on a stop state)
  // the server's stated cap, when it stated one — never a number of the client's own.
  const frameTotal =
    state.status === 'extracting' || state.status === 'ready'
      ? state.total
      : mediaKind === 'photo'
        ? PHOTO_FRAME_COUNT
        : (quota?.frameCap ?? null);
  const badge = preparingBadgeParts(mediaKind, frameTotal, quota?.tier ?? null)
    .map((part) =>
      part === 'photo'
        ? Copy.upload.badge.photo
        : part === 'video'
          ? Copy.upload.badge.video
          : part === 'elite'
            ? Copy.upload.badge.elite
            : Copy.upload.badge.frames(part.frames)
    )
    .join(Copy.upload.badge.separator);

  // Stop states leave for Home; the working states' Cancel goes back to the source picker.
  const onHeaderBack = isWorking ? onSourcePicker : onHome;

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top,
            paddingBottom: Math.max(insets.bottom, Space.xl),
          },
        ]}>
        <LoadingHeader
          leading={<HeaderBack label={Copy.upload.cta.back} onPress={onHeaderBack} testID="preparing-back" />}
          trailing={
            <Text style={styles.badge} testID="preparing-badge">
              {badge}
            </Text>
          }
        />

        {isWorking ? (
          <WorkingBody state={state} mediaKind={mediaKind} quota={quota} reduceMotion={reduceMotion} />
        ) : (
          <StopBody
            state={state}
            mediaKind={mediaKind}
            pauseRemaining={pauseRemaining}
            pauseStartRemaining={pauseStartRemaining}
          />
        )}

        <View style={styles.spacer} />

        <View style={styles.actions}>
          {state.status === 'ready' && (
            <SquareButton label={Copy.upload.cta.start} onPress={onStart} testID="preparing-start" />
          )}
          {(state.status === 'preparing' || state.status === 'extracting' || state.status === 'ready') && (
            <SquareButton
              variant="secondary"
              label={Copy.upload.cta.cancel}
              onPress={onSourcePicker}
              testID="preparing-cancel"
            />
          )}

          {state.status === 'exhausted' && (
            <>
              <SquareButton
                label={Copy.upload.cta.seePlans}
                onPress={onSeePlans}
                testID="preparing-see-plans"
              />
              <SquareButton variant="secondary" label={Copy.upload.cta.back} onPress={onHome} />
            </>
          )}

          {state.status === 'paused' && (
            <>
              {/* With a known end: disabled until it passes, then Continue asks the server again.
                  With none: no Continue at all — a button whose wait we cannot state would be a
                  guess. */}
              {pauseRemaining !== null && (
                <SquareButton
                  label={
                    pauseRemaining > 0
                      ? Copy.upload.pause.continueIn(formatCountdownCompact(pauseRemaining))
                      : Copy.upload.pause.continue
                  }
                  disabled={pauseRemaining > 0}
                  disabledTone="fill"
                  onPress={onRetry}
                  testID="preparing-continue"
                />
              )}
              <SquareButton variant="secondary" label={Copy.upload.cta.back} onPress={onHome} />
            </>
          )}

          {state.status === 'offline' && (
            <>
              <SquareButton label={Copy.upload.cta.retry} onPress={onRetry} testID="preparing-retry" />
              <SquareButton variant="secondary" label={Copy.upload.cta.back} onPress={onHome} />
            </>
          )}

          {state.status === 'error' &&
            (state.kind === 'extractionFailed' ? (
              // Retrying the same input CAN succeed here (a native-module blip), so Retry stays.
              <>
                <SquareButton label={Copy.upload.cta.retry} onPress={onRetry} testID="preparing-retry" />
                <SquareButton
                  variant="secondary"
                  label={mediaKind === 'photo' ? Copy.upload.cta.choosePhoto : Copy.upload.cta.chooseVideo}
                  onPress={onSourcePicker}
                />
              </>
            ) : (
              // Deterministic for this clip: the same footage fails the same way, so no Retry.
              <>
                <SquareButton
                  label={mediaKind === 'photo' ? Copy.upload.cta.choosePhoto : Copy.upload.cta.chooseVideo}
                  onPress={onSourcePicker}
                  testID="preparing-choose-another"
                />
                <SquareButton variant="secondary" label={Copy.upload.cta.back} onPress={onHome} />
              </>
            ))}

          {/* Nothing was reserved before a refusal or a failed extraction — the server never saw
              this clip — so this line is true on every one of these states. */}
          {(state.status === 'error' || state.status === 'offline') && (
            <NotCounted label={Copy.upload.notCounted} boxed={false} testID="preparing-not-counted" />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// -------------------------------------------------------------------------------------------
// The working states: pre-flight, extracting, ready.
// -------------------------------------------------------------------------------------------

function WorkingBody({
  state,
  mediaKind,
  quota,
  reduceMotion,
}: {
  state: Extract<ExtractState, { status: 'preparing' | 'extracting' | 'ready' }>;
  mediaKind: MediaKind;
  quota: QuotaStatus | null | undefined;
  reduceMotion: boolean;
}) {
  const stage: PreparingStage =
    state.status === 'preparing' ? 'checking' : state.status === 'extracting' ? 'extracting' : 'ready';
  const total = state.status === 'preparing' ? (mediaKind === 'photo' ? PHOTO_FRAME_COUNT : null) : state.total;
  const done = state.status === 'extracting' ? state.done : state.status === 'ready' ? (total ?? 0) : 0;
  // Step i's outcome. Once ready, the tiles are exactly the extracted set (skips dropped).
  const slots: FrameSlot[] =
    state.status === 'extracting' ? state.slots : state.status === 'ready' ? state.frameSet.frames : [];

  const status =
    state.status === 'preparing'
      ? Copy.upload.status.checking
      : state.status === 'ready'
        ? mediaKind === 'photo'
          ? Copy.upload.status.readyPhoto
          : Copy.upload.status.readyVideo(state.frameSet.frames.length)
        : mediaKind === 'photo'
          ? Copy.upload.status.photo
          : Copy.upload.status.extracting(preparingHeroIndex(done, state.total), state.total);

  const remaining = quota === undefined ? undefined : quotaRemaining(quota);
  const rowValueFor = (key: 'quota' | 'frames' | 'ready'): string => {
    if (key === 'quota') return remaining == null ? Copy.upload.rows.none : Copy.upload.rows.quotaLeft(remaining);
    if (key === 'frames') {
      if (total === null || stage === 'checking') return Copy.upload.rows.none;
      return Copy.upload.rows.progress(preparingHeroIndex(done, total), total);
    }
    return Copy.upload.rows.none;
  };
  const items = preparingChecklist(stage).map((row) => ({
    key: row.key,
    status: row.status,
    stateLabel:
      row.status === 'done'
        ? Copy.upload.rows.stateDone
        : row.status === 'now'
          ? Copy.upload.rows.stateNow
          : Copy.upload.rows.stateTodo,
    value: rowValueFor(row.key),
    label:
      row.key === 'quota'
        ? row.status === 'done'
          ? Copy.upload.rows.quotaChecked
          : Copy.upload.rows.quotaChecking
        : row.key === 'frames'
          ? mediaKind === 'photo'
            ? Copy.upload.rows.loadingPhoto
            : Copy.upload.rows.extracting
          : Copy.upload.rows.ready,
  }));

  const columns = mediaKind === 'photo' ? PHOTO_STRIP_COLUMNS : total ?? 0;

  return (
    <View style={styles.body}>
      <View style={styles.heroBlock}>
        <Text style={styles.eyebrow} accessibilityRole="header">
          {mediaKind === 'photo' ? Copy.upload.eyebrow.photo : Copy.upload.eyebrow.video}
        </Text>
        {total !== null && stage !== 'checking' ? (
          // Hidden from the a11y tree: the status line below says the same thing in words.
          <View
            style={styles.heroRow}
            testID="preparing-hero"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants">
            <Text style={styles.heroNum}>{preparingHeroIndex(done, total)}</Text>
            <Text style={styles.heroOf}>{Copy.upload.rows.heroOf(total)}</Text>
          </View>
        ) : null}
        <Text style={styles.status} accessibilityLiveRegion="polite" testID="preparing-status">
          {status}
        </Text>
      </View>

      {total !== null && stage !== 'checking' ? (
        <>
          <View style={styles.segments} testID="preparing-segments">
            {Array.from({ length: total }, (_, i) => {
              const segment = preparingTileStatus(i, done, total);
              return (
                <Pulse
                  key={i}
                  active={segment === 'now'}
                  reduceMotion={reduceMotion}
                  style={[
                    styles.segment,
                    segment === 'done' && styles.segmentDone,
                    segment === 'now' && styles.segmentNow,
                  ]}
                />
              );
            })}
          </View>

          <FrameStrip testID="preparing-strip">
            {Array.from({ length: Math.max(columns, total) }, (_, i) => {
              if (i >= total) return <View key={i} style={styles.emptyColumn} />;
              const slot = slots[i];
              const frame = slot && slot !== 'skipped' ? slot : null;
              const tile = preparingTileStatus(i, done, total);
              return (
                <FrameTile
                  key={i}
                  testID={`preparing-tile-${i + 1}`}
                  base64={frame?.base64 ?? null}
                  accessibilityLabel={
                    frame
                      ? Copy.upload.frame.label(i + 1, total)
                      : slot === 'skipped'
                        ? Copy.upload.frame.skipped(i + 1, total)
                        : Copy.upload.frame.pending(i + 1, total)
                  }
                  caption={frame && mediaKind === 'video' ? Copy.upload.frame.timestamp(frame.timestampMs) : undefined}
                  status={tile}
                  aspectRatio={TILE_ASPECT}
                  pulse
                  reduceMotion={reduceMotion}
                />
              );
            })}
          </FrameStrip>
        </>
      ) : null}

      <Checklist items={items} reduceMotion={reduceMotion} testID="preparing-checklist" />
    </View>
  );
}

// -------------------------------------------------------------------------------------------
// The stop states: out of analyses, paused, offline, failed.
// -------------------------------------------------------------------------------------------

function StopBody({
  state,
  mediaKind,
  pauseRemaining,
  pauseStartRemaining,
}: {
  state: Extract<ExtractState, { status: 'error' | 'paused' | 'exhausted' | 'offline' }>;
  mediaKind: MediaKind;
  pauseRemaining: number | null;
  pauseStartRemaining: number | null;
}) {
  const stop = stopCopy(state, mediaKind);
  let extra: ReactNode = null;

  if (state.status === 'paused' && pauseRemaining !== null) {
    const fraction = remainingFraction(pauseRemaining, pauseStartRemaining ?? pauseRemaining);
    extra = (
      <View style={styles.countdownCard} testID="preparing-countdown">
        <View style={styles.countdownRow}>
          <Text style={styles.countdown} accessibilityLabel={`${formatCountdown(pauseRemaining)} ${Copy.upload.pause.remaining}`}>
            {formatCountdown(pauseRemaining)}
          </Text>
          <Text style={styles.countdownLabel}>{Copy.upload.pause.remaining}</Text>
        </View>
        <View style={styles.drainTrack}>
          <View style={[styles.drainFill, { width: `${fraction * 100}%` }]} />
        </View>
      </View>
    );
  }

  if (state.status === 'exhausted') {
    const panel = quotaPanel(state.quota);
    if (panel.kind === 'paid') {
      const date = formatResetDate(panel.resetsAt);
      const days = daysUntil(panel.resetsAt);
      const rows: { key: string; label: string; value: string }[] = [
        { key: 'used', label: Copy.upload.quota.used, value: Copy.upload.rows.progress(panel.used, panel.limit) },
      ];
      if (date && days !== null) {
        rows.push({ key: 'resets', label: Copy.upload.quota.resets, value: Copy.upload.quota.resetValue(date, days) });
      }
      extra = <KeyValueCard rows={rows} testID="preparing-quota-panel" />;
    } else if (panel.kind === 'free') {
      extra = (
        <KeyValueCard
          testID="preparing-quota-panel"
          rows={[
            { key: 'used', label: Copy.upload.quota.used, value: Copy.upload.rows.progress(panel.used, panel.limit) },
            { key: 'plan', label: Copy.upload.quota.plan, value: Copy.upload.quota.freePlanValue },
          ]}
        />
      );
    }
  }

  return (
    <View style={styles.stopBody} testID={`preparing-stop-${stop.id}`}>
      <StopIconBox name={stop.icon} danger={stop.danger} />
      <StopHeadline eyebrow={stop.eyebrow} title={stop.title} body={stop.body} danger={stop.danger} />
      {extra}
    </View>
  );
}

type StopCopy = { id: string; icon: StopIconName; danger: boolean; eyebrow: string; title: string; body: string };

function stopCopy(
  state: Extract<ExtractState, { status: 'error' | 'paused' | 'exhausted' | 'offline' }>,
  mediaKind: MediaKind
): StopCopy {
  switch (state.status) {
    case 'exhausted': {
      const free = quotaPanel(state.quota).kind === 'free';
      return {
        id: 'quota',
        icon: 'quota',
        danger: false,
        eyebrow: Copy.upload.quota.eyebrow,
        title: Copy.upload.quota.title,
        body: free ? Copy.upload.quota.freeBody : Copy.upload.quota.paidBody,
      };
    }
    case 'paused':
      return {
        id: 'paused',
        icon: 'clock',
        danger: false,
        eyebrow: Copy.upload.pause.eyebrow,
        title: Copy.upload.pause.title,
        body: Copy.upload.pause.body,
      };
    case 'offline':
      return {
        id: 'offline',
        icon: 'wifi',
        danger: false,
        eyebrow: Copy.upload.offline.eyebrow,
        title: Copy.upload.offline.title,
        body: mediaKind === 'photo' ? Copy.upload.offline.photo : Copy.upload.offline.video,
      };
    case 'error': {
      const e = Copy.upload.error;
      switch (state.kind) {
        case 'extractionFailed':
          return {
            id: 'extractionFailed',
            icon: 'alert',
            danger: true,
            eyebrow: e.extractionFailed.eyebrow,
            title: mediaKind === 'photo' ? e.extractionFailed.titlePhoto : e.extractionFailed.titleVideo,
            body: e.extractionFailed.body,
          };
        case 'budgetExceeded':
          return { id: 'budgetExceeded', icon: 'alert', danger: true, ...e.budgetExceeded };
        case 'unsupportedFootage':
          return { id: 'unsupportedFootage', icon: 'alert', danger: true, ...e.unsupportedFootage };
        case 'capViolation':
          return state.violation === 'clipTooLong'
            ? { id: 'clipTooLong', icon: 'alert', danger: true, eyebrow: e.clipTooLong.eyebrow, ...Copy.sourcePicker.error.clipTooLong }
            : { id: 'fileTooLarge', icon: 'alert', danger: true, eyebrow: e.fileTooLarge.eyebrow, ...Copy.sourcePicker.error.fileTooLarge };
      }
    }
  }
}

/** What a screen reader hears when the state changes (issue #11's iOS complement to the live
 *  regions). Progress is announced per frame; a stop state by its title and body. */
function announcementFor(state: ExtractState, mediaKind: MediaKind): string | null {
  switch (state.status) {
    case 'preparing':
      return Copy.upload.status.checking;
    case 'extracting':
      return mediaKind === 'photo'
        ? Copy.upload.status.photo
        : Copy.upload.status.extracting(preparingHeroIndex(state.done, state.total), state.total);
    case 'ready':
      return mediaKind === 'photo' ? Copy.upload.status.readyPhoto : Copy.upload.status.readyVideo(state.frameSet.frames.length);
    default: {
      const stop = stopCopy(state, mediaKind);
      return `${stop.title}. ${stop.body}`;
    }
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Ink.bg,
  },
  // `flex` ONLY — child-layout props are illegal on a ScrollView's `style` (issue #63).
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: Layout.loading.gutter,
  },
  badge: {
    ...Type.monoCaption,
    color: Ink.ink2,
  },
  body: {
    gap: Space.lg + Space.xs,
    paddingTop: Space.xs,
  },
  heroBlock: {
    gap: Layout.loading.stackGap,
  },
  eyebrow: {
    ...Type.eyebrow,
    color: Ink.ink2,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Space.xs,
  },
  heroNum: {
    ...Type.hero,
    color: Ink.ink,
  },
  heroOf: {
    ...Type.heroOf,
    color: Ink.ink2,
  },
  status: {
    ...Type.lead,
    color: Ink.ink2,
  },
  segments: {
    flexDirection: 'row',
    gap: Layout.loading.segmentGap,
  },
  segment: {
    flex: 1,
    height: Layout.loading.segment,
    backgroundColor: Ink.line,
  },
  segmentDone: {
    backgroundColor: Ink.ink,
  },
  segmentNow: {
    backgroundColor: Ink.ink2,
  },
  emptyColumn: {
    flex: 1,
  },
  stopBody: {
    gap: Space.lg + Space.xs,
    paddingTop: Space.md,
  },
  countdownCard: {
    gap: Layout.loading.stackGap,
    padding: Space.lg,
    backgroundColor: Ink.bgRaised,
    borderWidth: Layout.hairline,
    borderColor: Ink.line,
  },
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  countdown: {
    ...Type.countdown,
    color: Ink.ink,
  },
  countdownLabel: {
    ...Type.monoCaption,
    color: Ink.ink2,
  },
  drainTrack: {
    height: Layout.loading.track,
    backgroundColor: Ink.line,
  },
  drainFill: {
    height: Layout.loading.track,
    backgroundColor: Ink.ink,
  },
  spacer: {
    flexGrow: 1,
    minHeight: Space.xl,
  },
  actions: {
    gap: Layout.loading.stackGap,
    paddingTop: Space.md,
  },
});
