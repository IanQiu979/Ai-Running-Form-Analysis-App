/**
 * Analysing (`/analyzing`; issue #80, rebuilt 2026-10-06 to the captain's Claude Design page
 * "Preparing & Analysing — V23"): the wait while `analyze-form` is in flight, drawn around the
 * runner's own frames — the same frames being sent — in the app's duotone grade.
 *
 * STATE MACHINE: owned by `lib/analyzing-machine.ts` (pure, unit-tested there). This file's jobs
 * are (1) drive that reducer from real events — the `analyzeFormClient.submit()` call, a
 * client-side timeout timer, a foreground reconciliation read (issue #64), a Retry tap — and (2)
 * render each phase. The machine is honest about "waiting on a server-side job": a client-side
 * timeout does not cancel the underlying call, and Retry always reuses the SAME `idempotencyKey`,
 * so it can never double-run the model or double-burn quota.
 *
 * WHAT THE PAGE SHOWS, AND WHERE EACH PART COMES FROM (`lib/loading-screens.ts`):
 *   - "Uploading" -> "Finding your stride" -> "Still analyzing" is the machine's existing caption
 *     pacing (`captionPhaseForElapsed`); "Done" is `succeeded`, held 300 ms before the result.
 *   - Upload / Read / Result is a projection of those same steps — it claims nothing new.
 *   - The elapsed clock counts the CURRENT attempt and stops the moment the wait ends ("Stopped at").
 *   - While reading, the viewer steps through the frames and a scan line travels over it. That is
 *     the only motion on the frame: no skeleton, no joint markers — nothing on the device tracks a
 *     pose, and the screen must not imply it. Under reduced motion the viewer holds one frame and
 *     the scan line is not drawn.
 *
 * ISSUE #64 — backgrounding recovery: if the app is backgrounded (not killed) while waiting, the
 * submit promise may never resolve though the server finishes regardless. The foreground effect
 * re-reads the row by idempotency key on every return to the foreground — see its comment. A
 * genuine KILL is issue #140's marker (`lib/pending-analysis.ts`), read by Home at startup.
 *
 * THE SESSION-EXPIRED RESUME (2026-10-06, `lib/resumable-analysis.ts`): when the server answers
 * `unauthorized`, the request — its frames and its idempotency key — is held in memory for the
 * user who started the attempt, even if this screen has already been unmounted by the route guard
 * (auth-js may end the session itself). "Sign in and retry" signs the dead session out, keeping the
 * hold; after the same user signs back in, Home stages the SAME request here again. Any other
 * account discards it. Cancel, Back, "Start new analysis" and a delivered result all discard it,
 * and a 401 that lands after the runner walked away is refused by the hold's attempt generation.
 *
 * isFallback: true (an honest partial result, issue #45) is routed through the exact same success
 * path as a full result. It is never treated as a failure.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, useRouter, type Href } from 'expo-router';
import { useEffect, useReducer, useRef, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DuotoneFrame } from '@/components/duotone-frame';
import {
  FrameStrip,
  FrameTile,
  HeaderBack,
  LoadingHeader,
  NotCounted,
  Pulse,
  ScanLine,
  StopHeadline,
  type StopIconName,
} from '@/components/loading-parts';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SquareButton } from '@/components/ui/square-button';
import { Copy } from '@/constants/copy';
import { Chrome, Ink, Layout, Motion, Space, Type } from '@/constants/v23-theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import {
  analyzeFormClient,
  takePendingAnalyzeFormRequest,
  type AnalyzeFormRequest,
} from '@/lib/analyze-form';
import {
  ANALYZING_LONG_WAIT_DELAY_MS,
  ANALYZING_STEP_FLOOR_MS,
  ANALYZING_STEP_KEYS,
  ANALYZING_TIMEOUT_MS,
  INITIAL_ANALYZING_STATE,
  analyzingReducer,
  captionPhaseForElapsed,
  type AnalyzingCaptionPhase,
} from '@/lib/analyzing-machine';
import { onAppForeground } from '@/lib/app-state';
import { resolveAnalysisRequest } from '@/lib/analysis-resolver';
import { checkConnectivity } from '@/lib/connectivity';
import { cooldownEndsIn } from '@/lib/cooldown';
import {
  analysingPhase,
  analysingStop,
  analysingTrack,
  formatElapsed,
  stopIsRetryable,
  stopIsUncounted,
  type AnalysingPhase,
  type AnalysingStop,
} from '@/lib/loading-screens';
import { clearPendingAnalysisMarker, setPendingAnalysisMarker } from '@/lib/pending-analysis';
import { setPendingAnalysisResult } from '@/lib/pending-analysis-result';
import { currentResumeGeneration, discardResumableAnalysis, holdForResume } from '@/lib/resumable-analysis';
import { useSession } from '@/lib/session-provider';
import { signOut } from '@/lib/sign-out';
import { useAnnounce } from '@/lib/use-announce';
import { isPaceAnalysisOutcome } from '@shared/pace';

/** The clock's tick: one per second, the smallest unit it shows (`mm:ss`). */
const CLOCK_TICK_MS = 1000;

/** The page's "Complete · timer stops · hold 300 ms → result fades in". */
const COMPLETE_HOLD_MS = Motion.duration.fade;

/** The frame the viewer holds when it is not stepping: the page's third, or the last if fewer. */
const HELD_FRAME_INDEX = 2;

export default function AnalyzingScreen() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  // Taken exactly once, on first render — see lib/analyze-form.ts's mailbox doc comment. Retry
  // re-submits THIS same object (same idempotencyKey), never re-reads the (now-empty) mailbox.
  // Bound to the signed-in user: a request staged for another account is refused (null).
  // CAVEAT: this app does not render under React.StrictMode; a lazy initializer runs twice per
  // mount there, which would drain this one-shot mailbox. Revisit before enabling StrictMode.
  const [request] = useState<AnalyzeFormRequest | null>(() => takePendingAnalyzeFormRequest(userId));
  // The account the request was staged for — the mailbox only hands it to that user, so it is the
  // user signed in at mount. Every hold is made for THIS account, never for whoever is signed in
  // when a later answer lands, and none is made at all if the signed-in user has since changed.
  const [ownerUserId] = useState(userId);
  // The resume hold's generation as of this screen's start — see `lib/resumable-analysis.ts`.
  const [resumeGeneration] = useState(currentResumeGeneration);
  const [state, dispatch] = useReducer(analyzingReducer, INITIAL_ANALYZING_STATE);
  const [captionPhase, setCaptionPhase] = useState<AnalyzingCaptionPhase>(() => captionPhaseForElapsed(0));
  const [elapsedMs, setElapsedMs] = useState(0);
  const [signOutStuck, setSignOutStuck] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  // The latest session, readable from inside the submit effect without making it a dependency.
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const mediaType = request?.mediaType ?? 'photo';
  const frameCount = request?.frames.length ?? 0;
  const phase = analysingPhase(state, captionPhase);
  const stop = analysingStop(state);

  // Issue #140: persist a marker of this analysis (keyed by idempotency key) the moment a real
  // request exists, so a process KILL during the wait can still be reconciled on the next cold
  // launch. Fire-and-forget.
  useEffect(() => {
    if (!request || !session?.user.id) return;
    setPendingAnalysisMarker({ idempotencyKey: request.idempotencyKey, userId: session.user.id });
  }, [request, session]);

  // Drives the reducer: fires the submit call for the current attempt, races it against the
  // client-side timeout, and dispatches whichever settles first. Issue #93's connectivity read runs
  // FIRST, immediately before the call: an offline reading dispatches 'offline' without ever
  // calling submit(), so "nothing was sent" is true by construction.
  useEffect(() => {
    if (state.phase !== 'waiting' || !request) {
      return;
    }
    const attempt = state.attempt;
    // A 401 that lands after the session has gone must still be held for the account that owns
    // this request, never for whoever is signed in later — and not at all if this attempt is
    // running under a different account than the owner.
    const attemptUserId = userIdRef.current === ownerUserId ? ownerUserId : null;
    let cancelled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    checkConnectivity().then((online) => {
      if (cancelled) return;

      if (!online) {
        dispatch({ type: 'offline', attempt });
        return;
      }

      analyzeFormClient
        .submit(request)
        .then((result) => {
          if (!result.ok) {
            // Held even if this screen has been unmounted: auth-js may already have ended the
            // session itself and the route guard torn this screen down. The generation check
            // inside `holdForResume` refuses it if the runner had already walked away. Re-checked
            // NOW: no session at all (the expired case) still holds for the owner, but a session
            // for a DIFFERENT account that appeared mid-attempt holds nothing.
            const userNow = userIdRef.current;
            if (
              result.error.code === 'unauthorized' &&
              attemptUserId &&
              (userNow === null || userNow === attemptUserId)
            ) {
              holdForResume(request, attemptUserId, resumeGeneration);
            }
            // Issue #136: carry the server's code through, so a 402 opens the paywall instead of
            // a Retry that would resubmit into the same exhausted quota.
            dispatch({
              type: 'failed',
              attempt,
              code: result.error.code,
              message: result.error.error,
              retryAfterSeconds: result.error.retryAfterSeconds,
            });
            return;
          }

          dispatch({
            type: 'succeeded',
            attempt,
            outcome: { result: result.data.result, isFallback: result.data.isFallback },
            analysisId: result.data.analysisId,
          });
        })
        .catch(() => {
          // Folded into the same failure as a documented error — every analyze-form failure path
          // releases the reservation before returning (docs/architecture.md step 9).
          dispatch({ type: 'failed', attempt });
        });

      timeoutHandle = setTimeout(() => {
        dispatch({ type: 'timedOut', attempt });
      }, ANALYZING_TIMEOUT_MS);
    });

    return () => {
      cancelled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
    };
  }, [state, request, resumeGeneration, ownerUserId]);

  // Issue #64: reconcile against the persisted row whenever the app returns to the foreground
  // while still waiting. No row / a read error / `reserved` -> do nothing (still in flight; never
  // resubmit here). `delivered` -> the existing `succeeded` event. `released` -> the one case that
  // would otherwise spin forever.
  useEffect(() => {
    if (state.phase !== 'waiting' || !request) {
      return;
    }
    const attempt = state.attempt;
    const req = request;

    async function reconcile() {
      try {
        const data = await resolveAnalysisRequest(req.idempotencyKey);
        if (!data) return;

        if (data.status === 'delivered') {
          const outcome = { result: data.result, isFallback: data.is_fallback };
          // Structural validation before trusting a row read outside the normal response path.
          if (isPaceAnalysisOutcome(outcome)) {
            dispatch({ type: 'succeeded', attempt, outcome, analysisId: data.id });
          }
          return;
        }

        if (data.status === 'released') {
          // Issue #140: a terminal outcome — clear the cross-restart marker.
          clearPendingAnalysisMarker();
          dispatch({ type: 'reconciledReleased', attempt, analysisId: data.id });
        }
      } catch {
        // A supplementary check, not the source of truth: a thrown read is not surfaced.
      }
    }

    return onAppForeground(() => {
      reconcile();
    });
  }, [state, request]);

  // The caption pacing (step 0 -> step 1 -> the long wait), scheduled from the SAME pure function
  // the reducer's timing constants come from — see lib/analyzing-machine.ts.
  useEffect(() => {
    if (state.phase !== 'waiting') {
      return;
    }
    setCaptionPhase(captionPhaseForElapsed(0));

    const transitionTimes: number[] = [];
    for (let i = 1; i < ANALYZING_STEP_KEYS.length; i++) {
      transitionTimes.push(i * ANALYZING_STEP_FLOOR_MS);
    }
    transitionTimes.push(ANALYZING_STEP_KEYS.length * ANALYZING_STEP_FLOOR_MS + ANALYZING_LONG_WAIT_DELAY_MS);

    const handles = transitionTimes.map((t) => setTimeout(() => setCaptionPhase(captionPhaseForElapsed(t)), t));
    return () => {
      handles.forEach(clearTimeout);
    };
  }, [state]);

  // The elapsed clock ticks only while `waiting`; every other phase leaves the last value on
  // screen ("Stopped at"). A Retry restarts it from zero.
  useEffect(() => {
    if (state.phase !== 'waiting') return;
    setElapsedMs(0);
    const startedAt = Date.now();
    const handle = setInterval(() => setElapsedMs(Date.now() - startedAt), CLOCK_TICK_MS);
    return () => clearInterval(handle);
  }, [state]);

  // While reading, the viewer steps through the frames; otherwise it holds one. Not under
  // reduced motion, and never for a single frame.
  const stepping = (phase === 'finding' || phase === 'longWait') && !reduceMotion && frameCount > 1;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!stepping) return;
    const handle = setInterval(() => setTick((t) => t + 1), Motion.loading.frameCycle);
    return () => clearInterval(handle);
  }, [stepping]);
  const heldIndex = Math.min(HELD_FRAME_INDEX, Math.max(frameCount - 1, 0));
  const activeIndex = stepping ? (heldIndex + tick) % frameCount : heldIndex;

  // Success (a full result OR an honest isFallback partial) hands off to the result screen after
  // the page's 300 ms "Done" hold. The kept-for-resume frames are dropped here: this analysis has
  // a result now.
  useEffect(() => {
    if (state.phase !== 'succeeded') return;
    discardResumableAnalysis();
    const handle = setTimeout(() => {
      // Issue #140: clear the marker INSIDE the hold, beside the staging it pairs with.
      clearPendingAnalysisMarker();
      // Review r7-4: hand the result screen the body the server just sent.
      if (request) {
        setPendingAnalysisResult({
          analysisId: state.analysisId,
          outcome: state.outcome,
          mediaType: request.mediaType,
        });
      }
      router.replace({
        pathname: '/result/[id]',
        params: { id: state.analysisId, justAnalyzed: '1' },
      } as Href);
    }, COMPLETE_HOLD_MS);
    return () => clearTimeout(handle);
  }, [state, router, request]);

  // Issue #136: a real 402 quota_exceeded opens the paywall rather than a retryable panel.
  useEffect(() => {
    if (state.phase !== 'failed' || state.code !== 'quota_exceeded') return;
    router.replace('/paywall');
  }, [state, router]);

  // Android's hardware back leaves through the same door as the on-screen Back, so it drops a held
  // resume too (swipe-back is disabled on this route in `app/_layout.tsx` for the same reason).
  const handleCancelRef = useRef<() => void>(() => {});
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleCancelRef.current();
      return true;
    });
    return () => subscription.remove();
  }, []);

  function handleRetry() {
    dispatch({ type: 'retry' });
  }

  /** Every way off this screen that is not a resume: the runner chose to stop. */
  function leave() {
    // Issue #140: nothing should resurface on a later launch. Deliberately NOT cleared on
    // `failed`/`timedOut` themselves — a client-perceived timeout does not prove the server
    // stopped, so the marker survives until the runner walks away (here) or a later check learns
    // the truth.
    clearPendingAnalysisMarker();
    discardResumableAnalysis();
  }

  function handleCancel() {
    leave();
    router.replace('/');
  }
  handleCancelRef.current = handleCancel;

  // A released reservation (409 `previous_attempt_failed`, or #64's `released`): re-submitting
  // this key can only return the same released row, so the way forward is a NEW analysis.
  function handleStartNew() {
    leave();
    router.replace('/capture');
  }

  // The session-expired panel's action: sign the dead session out, KEEPING the held request, so the
  // runner signs back in and the same analysis resumes from Home. A successful sign-out lets the
  // route guard redirect to sign-in on its own; this screen does not navigate.
  async function handleSignInAndRetry() {
    if (isSigningOut || !request) return;
    // Normally already held by the 401 handler; re-placing the same request is harmless, and it
    // still passes through the same user and generation checks.
    if (ownerUserId && userId === ownerUserId) holdForResume(request, ownerUserId, resumeGeneration);
    setIsSigningOut(true);
    const result = await signOut({ keepResumableAnalysis: true });
    if (!isMountedRef.current) return;
    setIsSigningOut(false);
    // `globalRevokeFailed` means the LOCAL session is gone — the guard is already tearing this
    // screen down and the runner lands on sign-in, which is the whole point here; the revoke that
    // failed was for a session that had already ended. Only `stillSignedIn` leaves the runner
    // here, and gets the same notice Settings shows for it.
    if (!result.ok && result.reason === 'stillSignedIn') setSignOutStuck(true);
  }

  // The server's 429 `zero_pillar_cooldown` body: its own sentence plus the clock time its
  // `retryAfterSeconds` names — or no time at all when that field was unreadable.
  const zeroPillarBody =
    state.phase === 'failed' && state.code === 'zero_pillar_cooldown'
      ? buildCooldownBody(state.message, cooldownEndsIn(state.retryAfterSeconds))
      : '';

  const announcement =
    phase !== null
      ? phaseTitleAndBody(phase, mediaType, frameCount).join('. ')
      : stop !== null
        ? (() => {
            const c = stopContent(stop, mediaType, zeroPillarBody);
            return `${c.title}. ${c.body}`;
          })()
        : null;
  useAnnounce(announcement);

  if (!request) {
    // A direct or cold navigation with nothing staged (module state does not survive a kill). A
    // declarative `<Redirect>` defers the navigation until the root navigator is ready (H4).
    return <Redirect href="/" />;
  }

  return (
    <View style={styles.screen}>
      <AnalysingView
        request={request}
        phase={phase}
        stop={stop}
        elapsedMs={elapsedMs}
        activeIndex={activeIndex}
        stepping={stepping}
        reduceMotion={reduceMotion}
        zeroPillarBody={zeroPillarBody}
        uncounted={stop !== null && stopIsUncounted(stop, state)}
        busy={isSigningOut}
        onRetry={handleRetry}
        onSignInAndRetry={() => {
          void handleSignInAndRetry();
        }}
        onStartNew={handleStartNew}
        onBack={handleCancel}
      />

      <ConfirmDialog
        visible={signOutStuck}
        title={Copy.settings.signOutError.stillSignedIn.title}
        body={Copy.settings.signOutError.stillSignedIn.body}
        primary={{
          label: Copy.settings.signOutError.stillSignedIn.cta.primary,
          onPress: () => {
            setSignOutStuck(false);
            void handleSignInAndRetry();
          },
        }}
        secondary={{
          label: Copy.settings.signOutError.stillSignedIn.cta.secondary,
          onPress: () => setSignOutStuck(false),
        }}
        testID="analyzing-signout-stuck"
      />
    </View>
  );
}

// -------------------------------------------------------------------------------------------
// The view: everything this screen draws, from state and handlers alone — no effects, no I/O —
// so every state renders the same way in the screen, in its tests, and in a screenshot.
// -------------------------------------------------------------------------------------------

export type AnalysingViewProps = {
  request: AnalyzeFormRequest;
  /** One of the four progress artboards, or `null` for a stop state. */
  phase: AnalysingPhase | null;
  stop: AnalysingStop | null;
  elapsedMs: number;
  activeIndex: number;
  stepping: boolean;
  reduceMotion: boolean;
  zeroPillarBody: string;
  /** Whether "Not counted against your quota" is true for this stop (`stopIsUncounted`). */
  uncounted: boolean;
  busy: boolean;
  onRetry: () => void;
  onSignInAndRetry: () => void;
  onStartNew: () => void;
  onBack: () => void;
};

export function AnalysingView({ phase, stop, ...rest }: AnalysingViewProps) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, Space.xl) },
      ]}>
      {phase !== null ? (
        <ProgressBody
          request={rest.request}
          phase={phase}
          elapsedMs={rest.elapsedMs}
          activeIndex={rest.activeIndex}
          stepping={rest.stepping}
          reduceMotion={rest.reduceMotion}
        />
      ) : stop !== null ? (
        <StopBody
          request={rest.request}
          stop={stop}
          elapsedMs={rest.elapsedMs}
          zeroPillarBody={rest.zeroPillarBody}
          uncounted={rest.uncounted}
          reduceMotion={rest.reduceMotion}
          busy={rest.busy}
          onRetry={rest.onRetry}
          onSignInAndRetry={rest.onSignInAndRetry}
          onStartNew={rest.onStartNew}
          onBack={rest.onBack}
        />
      ) : null}
    </ScrollView>
  );
}

// -------------------------------------------------------------------------------------------
// The wait: a. uploading, b. finding your stride, c. still analyzing, d. done.
// -------------------------------------------------------------------------------------------

function ProgressBody({
  request,
  phase,
  elapsedMs,
  activeIndex,
  stepping,
  reduceMotion,
}: {
  request: AnalyzeFormRequest;
  phase: AnalysingPhase;
  elapsedMs: number;
  activeIndex: number;
  stepping: boolean;
  reduceMotion: boolean;
}) {
  const photo = request.mediaType === 'photo';
  const total = request.frames.length;
  const [title, body] = phaseTitleAndBody(phase, request.mediaType, total);
  const reading = phase === 'finding' || phase === 'longWait';
  const tag =
    phase === 'uploading'
      ? Copy.analyzing.viewer.sending
      : phase === 'done'
        ? Copy.analyzing.viewer.complete
        : Copy.analyzing.viewer.reading;
  const activeFrame = request.frames[activeIndex] ?? null;
  const activeTimestamp = request.timestamps[activeIndex];

  return (
    <View style={styles.body}>
      <LoadingHeader
        leading={<Text style={styles.headerEyebrow}>{Copy.analyzing.title}</Text>}
        trailing={<Clock label={Copy.analyzing.clock.elapsed} elapsedMs={elapsedMs} />}
      />

      <View
        style={[styles.viewer, { height: photo ? Layout.loading.viewer.photo : Layout.loading.viewer.video }]}
        testID="analyzing-viewer">
        {activeFrame ? (
          <DuotoneFrame
            deviceBase64={activeFrame}
            contentFit="contain"
            accessibilityLabel={Copy.analyzing.frameLabel(activeIndex + 1, total)}
            style={StyleSheet.absoluteFill}
            testID="analyzing-viewer-frame"
          />
        ) : null}
        {/* Scrims of the page black behind the corner labels, so they read over a bright frame. */}
        <LinearGradient
          colors={[Chrome.scrim, 'transparent']}
          style={[styles.viewerScrim, styles.viewerScrimTop]}
          pointerEvents="none"
        />
        <LinearGradient
          colors={['transparent', Chrome.scrim]}
          style={[styles.viewerScrim, styles.viewerScrimBottom]}
          pointerEvents="none"
        />
        {reading && !reduceMotion ? <ScanLine testID="analyzing-scan" /> : null}
        <Text style={[styles.viewerLabel, styles.viewerTopLeft]}>
          {photo ? Copy.analyzing.viewer.photo : Copy.analyzing.viewer.frame(activeIndex + 1, total)}
        </Text>
        {!photo && typeof activeTimestamp === 'number' ? (
          <Text style={[styles.viewerLabel, styles.viewerTopRight]}>{Copy.upload.frame.timestamp(activeTimestamp)}</Text>
        ) : null}
        <Text style={[styles.viewerLabel, styles.viewerTag]} testID="analyzing-viewer-tag">
          {tag}
        </Text>
      </View>

      {!photo ? (
        <FrameStrip style={styles.strip} testID="analyzing-strip">
          {request.frames.map((frame, i) => (
            <FrameTile
              key={i}
              testID={`analyzing-tile-${i + 1}`}
              base64={frame}
              accessibilityLabel={Copy.analyzing.frameLabel(i + 1, total)}
              caption={String(i + 1).padStart(2, '0')}
              status={stepping && i === activeIndex ? 'now' : 'todo'}
              aspectRatio={1}
              reduceMotion={reduceMotion}
            />
          ))}
        </FrameStrip>
      ) : null}

      <View style={styles.phaseBlock}>
        <Text style={styles.phaseTitle} accessibilityRole="header" testID="analyzing-phase-title">
          {title}
        </Text>
        <Text style={styles.phaseBody} accessibilityLiveRegion="polite">
          {body}
        </Text>
      </View>

      <View style={styles.spacer} />

      <View style={styles.track} testID="analyzing-track">
        {analysingTrack(phase).map((step) => (
          <View
            key={step.key}
            style={styles.trackStep}
            accessible
            accessibilityLabel={`${Copy.analyzing.track[step.key]}, ${
              step.status === 'done'
                ? Copy.upload.rows.stateDone
                : step.status === 'now'
                  ? Copy.upload.rows.stateNow
                  : Copy.upload.rows.stateTodo
            }`}
            accessibilityState={{ selected: step.status === 'now', busy: step.status === 'now' }}
            testID={`analyzing-track-${step.key}-${step.status}`}>
            <Pulse
              active={step.status === 'now'}
              reduceMotion={reduceMotion}
              style={[
                styles.trackBar,
                step.status === 'done' && styles.trackBarDone,
                step.status === 'now' && styles.trackBarNow,
              ]}
            />
            <Text style={[styles.trackLabel, step.status === 'todo' && styles.trackLabelTodo]}>
              {Copy.analyzing.track[step.key]}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function phaseTitleAndBody(
  phase: AnalysingPhase,
  mediaType: AnalyzeFormRequest['mediaType'],
  frameCount: number
): [string, string] {
  const p = Copy.analyzing.phase;
  switch (phase) {
    case 'uploading':
      return [p.uploading.title, mediaType === 'photo' ? p.uploading.photo : p.uploading.video(frameCount)];
    case 'finding':
      return [p.finding.title, mediaType === 'photo' ? p.finding.photo : p.finding.video(frameCount)];
    case 'longWait':
      return [p.longWait.title, p.longWait.body];
    case 'done':
      return [p.done.title, p.done.body];
  }
}

function Clock({ label, elapsedMs }: { label: string; elapsedMs: number }) {
  const value = formatElapsed(elapsedMs);
  return (
    <View style={styles.clock} accessible accessibilityLabel={`${label} ${value}`} testID="analyzing-clock">
      <Text style={styles.clockLabel}>{label}</Text>
      <Text style={styles.clockValue}>{value}</Text>
    </View>
  );
}

// -------------------------------------------------------------------------------------------
// The stop states.
// -------------------------------------------------------------------------------------------

type StopContent = {
  icon: StopIconName;
  danger: boolean;
  eyebrow: string;
  title: string;
  body: string;
};

function stopContent(stop: AnalysingStop, mediaType: AnalyzeFormRequest['mediaType'], zeroPillarBody: string): StopContent {
  const e = Copy.analyzing.error;
  const pick = (copy: { photo: string; video: string }) => (mediaType === 'photo' ? copy.photo : copy.video);
  switch (stop) {
    case 'failed':
      return { icon: 'alert', danger: true, eyebrow: e.failed.eyebrow, title: e.failed.title, body: pick(e.failed) };
    case 'timeout':
      return { icon: 'clock', danger: true, eyebrow: e.timeout.eyebrow, title: e.timeout.title, body: pick(e.timeout) };
    case 'unauthorized':
      return { icon: 'lock', danger: false, eyebrow: e.unauthorized.eyebrow, title: e.unauthorized.title, body: pick(e.unauthorized) };
    case 'offline':
      return { icon: 'wifi', danger: false, eyebrow: e.offline.eyebrow, title: e.offline.title, body: pick(e.offline) };
    case 'inProgress':
      return { icon: 'clock', danger: false, ...e.inProgress };
    case 'deleted':
      return { icon: 'alert', danger: false, ...e.deleted };
    case 'released':
      return { icon: 'alert', danger: false, ...e.previousAttemptFailed };
    case 'paused':
      return { icon: 'clock', danger: false, ...e.paused };
    case 'zeroPillarCooldown':
      return {
        icon: 'clock',
        danger: false,
        eyebrow: e.zeroPillarCooldown.eyebrow,
        title: e.zeroPillarCooldown.title,
        body: zeroPillarBody,
      };
  }
}

function StopBody({
  request,
  stop,
  elapsedMs,
  zeroPillarBody,
  uncounted,
  reduceMotion,
  busy,
  onRetry,
  onSignInAndRetry,
  onStartNew,
  onBack,
}: {
  request: AnalyzeFormRequest;
  stop: AnalysingStop;
  elapsedMs: number;
  zeroPillarBody: string;
  /** Whether "Not counted against your quota" is true here (`stopIsUncounted`). */
  uncounted: boolean;
  reduceMotion: boolean;
  busy: boolean;
  onRetry: () => void;
  onSignInAndRetry: () => void;
  onStartNew: () => void;
  onBack: () => void;
}) {
  const content = stopContent(stop, request.mediaType, zeroPillarBody);
  const photo = request.mediaType === 'photo';
  const total = request.frames.length;
  // "Ready to retry" only where a retry with these same frames is genuinely on offer.
  const keepsFrames = stopIsRetryable(stop) || stop === 'unauthorized';
  const cta = Copy.analyzing.error.cta;

  let primary: { label: string; onPress: () => void; testID: string } | null = null;
  let showBack = true;
  if (stopIsRetryable(stop)) {
    primary = { label: cta.retry, onPress: onRetry, testID: 'analyzing-retry' };
  } else if (stop === 'unauthorized') {
    primary = { label: Copy.analyzing.error.unauthorized.cta, onPress: onSignInAndRetry, testID: 'analyzing-sign-in-retry' };
  } else if (stop === 'released' || stop === 'deleted') {
    primary = { label: cta.startNew, onPress: onStartNew, testID: 'analyzing-start-new' };
  } else {
    // Both cooldowns: neither Retry nor a new analysis can work inside the window, so the one
    // honest way forward is out of this screen — and a second exit would duplicate it.
    primary = { label: cta.backHome, onPress: onBack, testID: 'analyzing-back-home' };
    showBack = false;
  }

  return (
    <View style={styles.body} testID={`analyzing-stop-${stop}`}>
      <LoadingHeader
        leading={<HeaderBack label={cta.back} onPress={onBack} testID="analyzing-header-back" />}
        trailing={<Clock label={Copy.analyzing.clock.stoppedAt} elapsedMs={elapsedMs} />}
      />

      <View style={styles.stopFrames}>
        <FrameStrip style={styles.dimmed} testID="analyzing-kept-strip">
          {Array.from({ length: photo ? Math.max(total, 3) : total }, (_, i) =>
            i < total ? (
              <FrameTile
                key={i}
                base64={request.frames[i]}
                accessibilityLabel={Copy.analyzing.frameLabel(i + 1, total)}
                caption={photo ? undefined : String(i + 1).padStart(2, '0')}
                status="todo"
                aspectRatio={1}
                reduceMotion={reduceMotion}
              />
            ) : (
              <View key={i} style={styles.emptyColumn} />
            )
          )}
        </FrameStrip>
        {keepsFrames ? (
          <Text style={styles.keptLabel} testID="analyzing-kept-label">
            {photo ? Copy.analyzing.kept.photo : Copy.analyzing.kept.video(total)}
          </Text>
        ) : null}
      </View>

      <StopHeadline
        eyebrow={content.eyebrow}
        title={content.title}
        body={content.body}
        danger={content.danger}
        inlineIcon={content.icon}
        testID="analyzing-stop-headline"
      />

      <View style={styles.spacer} />

      <View style={styles.actions}>
        {uncounted ? (
          <NotCounted label={Copy.analyzing.notCounted} boxed testID="analyzing-not-counted" />
        ) : null}
        {primary ? (
          <SquareButton label={primary.label} onPress={primary.onPress} busy={busy && stop === 'unauthorized'} testID={primary.testID} />
        ) : null}
        {showBack ? (
          <SquareButton variant="secondary" label={cta.back} onPress={onBack} testID="analyzing-back" />
        ) : null}
      </View>
    </View>
  );
}

/**
 * The zero-pillar cooldown body: the server's own sentence, then when to come back — and no time
 * at all when `retryAfterSeconds` was unreadable, because a guessed "try again at" is worse than
 * none. Falls back to the local sentence when the server sent none, so the panel is never empty.
 */
function buildCooldownBody(message: string | undefined, time: string | null): string {
  const sentence = message?.trim() || Copy.analyzing.error.zeroPillarCooldown.fallbackMessage;
  const template = time
    ? Copy.analyzing.error.zeroPillarCooldown.body.replace('{time}', time)
    : Copy.analyzing.error.zeroPillarCooldown.bodyUnknownTime;
  return template.replace('{message}', sentence);
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
  body: {
    flexGrow: 1,
  },
  headerEyebrow: {
    ...Type.eyebrow,
    color: Ink.ink2,
  },
  clock: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Space.sm,
  },
  clockLabel: {
    ...Type.monoClockLabel,
    color: Ink.ink2,
  },
  clockValue: {
    ...Type.monoClock,
    color: Ink.ink,
  },
  viewer: {
    backgroundColor: Ink.bgRaised,
    borderWidth: Layout.hairline,
    borderColor: Ink.line,
    overflow: 'hidden',
  },
  viewerScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: Space.xxxl,
  },
  viewerScrimTop: {
    top: 0,
  },
  viewerScrimBottom: {
    bottom: 0,
  },
  viewerLabel: {
    ...Type.monoCaption,
    position: 'absolute',
    color: Ink.ink,
  },
  viewerTopLeft: {
    left: Space.md,
    top: Layout.loading.stackGap,
  },
  viewerTopRight: {
    right: Space.md,
    top: Layout.loading.stackGap,
    color: Ink.ink2,
  },
  viewerTag: {
    left: Space.md,
    bottom: Layout.loading.stackGap,
    color: Ink.ink2,
  },
  strip: {
    marginTop: Space.sm,
  },
  phaseBlock: {
    gap: Space.sm,
    marginTop: Space.lg + Space.xs,
  },
  phaseTitle: {
    ...Type.displayMd,
    color: Ink.ink,
  },
  phaseBody: {
    ...Type.lead,
    color: Ink.ink2,
  },
  spacer: {
    flexGrow: 1,
    minHeight: Space.xl,
  },
  track: {
    flexDirection: 'row',
    gap: Layout.loading.segmentGap,
  },
  trackStep: {
    flex: 1,
    gap: Space.sm,
  },
  trackBar: {
    height: Layout.loading.track,
    backgroundColor: Ink.line,
  },
  trackBarDone: {
    backgroundColor: Ink.ink,
  },
  trackBarNow: {
    backgroundColor: Ink.ink2,
  },
  trackLabel: {
    ...Type.monoCaption,
    color: Ink.ink,
  },
  trackLabelTodo: {
    color: Ink.ink2,
  },
  stopFrames: {
    gap: Space.sm,
    paddingTop: Space.xs,
    marginBottom: Space.xl,
  },
  dimmed: {
    opacity: Layout.loading.keptOpacity,
  },
  emptyColumn: {
    flex: 1,
  },
  keptLabel: {
    ...Type.monoCaption,
    color: Ink.ink2,
  },
  actions: {
    gap: Layout.loading.stackGap,
    paddingTop: Space.md,
  },
});
