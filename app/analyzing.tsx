/**
 * Screen 6 — Analyzing (issue #80): the wait screen shown while `analyze-form` is in flight.
 *
 * Built against `lib/analyze-form.ts`'s injectable seam, originally reviewable without a live
 * `analyze-form` (issue #44) via a dev mock. That seam is now bound to the real client — issue
 * #128, 2026-07-26, see that file's header — and the mock is kept only for tests/dev, `__DEV__`-
 * guarded so it throws in a release bundle. The one exception to "nothing in this file talks to
 * Supabase" is issue #64's reconciliation below, now routed through an authenticated RPC so a
 * request key that became an alias of a canonical result resolves to the same analysis row.
 *
 * STATE MACHINE: owned by `lib/analyzing-machine.ts` (pure, unit-tested there). This file's jobs
 * are (1) drive that reducer from real events — the `analyzeFormClient.submit()` call, a
 * client-side timeout timer, a foreground reconciliation read (issue #64), a Retry tap — and (2)
 * render each phase. Per the issue: the machine is honest about "waiting on a server-side job,"
 * not "holding a promise in memory" — a client-side timeout here does not cancel the underlying
 * call (the server settles the analysis and releases/keeps quota regardless of whether this
 * screen is still listening, `docs/architecture.md`'s "Backgrounding recovery" note), and Retry
 * always reuses the SAME `idempotencyKey` rather than minting a new one, so it can never
 * double-run the model or double-burn quota.
 *
 * ISSUE #64 — backgrounding recovery, implemented here: if the app is backgrounded (not killed)
 * while this screen is still `waiting`, `analyzeFormClient.submit()`'s promise may never resolve
 * (iOS/Android can suspend or drop in-flight JS work) even though the SERVER-SIDE `analyze-form`
 * invocation runs to completion regardless. The foreground-reconciliation effect below re-reads
 * the `analyses` row by idempotency key on every return-to-foreground and routes accordingly —
 * see that effect's own comment for the three cases. A genuine app KILL (not just background) is
 * NOT handled here: `request` (lib/analyze-form.ts's one-shot mailbox) does not survive a process
 * restart, so this screen is never re-entered with a live `waiting` state to reconcile — see the
 * defensive bail-out below. Surfacing "your analysis finished" on a cold relaunch after a kill
 * would need a differently-scoped, persisted marker read at app startup, out of this issue's file
 * lane (see this issue's DOCS block).
 *

 * isFallback: true (an honest partial result, issue #45) is routed through the exact same success
 * path as a full result — see the `succeeded` effect below. It is never treated as a failure.
 *
 * MOTION (V23-05, 2026-09-13 — the captain-approved Claude Design page): the wait is a live
 * stopwatch (`mm:ss.t`, ticking every 100 ms from the start of the CURRENT attempt, so a Retry
 * restarts it), the `ANALYZING` label, one Body status line, and `<LaserSweep>` — a glowing 2 pt
 * line sweeping the full screen top to bottom every 3.2 s. The status line still follows the
 * step pacing below (`docs/design/motion-consult.md`'s "honesty mechanic": steps hold their floor,
 * then the one-shot "Still analyzing" fade). On `succeeded` the page's third artboard plays: the
 * stopwatch STOPS, the laser goes, the status reads "Done", the frame holds 300 ms, and only then
 * does the result route replace this one — the root Stack's 250 ms fade is the "result fades in".
 * Per motion-consult.md's reduced-motion map, wait-state signaling is explicitly EXEMPT from
 * suppression ("low-amplitude, single-shot, opacity/color-only functional state signaling...
 * reduced motion targets vestibular triggers, not state indicators") — so, deliberately, nothing
 * here branches on `useReducedMotion()`, the sweep included (see `components/laser-sweep.tsx`).
 * The 300 ms hold is a pause, not motion, and plays regardless.
 */
import { Redirect, useRouter, type Href } from 'expo-router';
import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LaserSweep } from '@/components/laser-sweep';
import { SquareButton } from '@/components/ui/square-button';
import { Copy } from '@/constants/copy';
import { Ink, Layout, Motion, Space, Type } from '@/constants/v23-theme';
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
  type AnalyzingStepKey,
} from '@/lib/analyzing-machine';
import { onAppForeground } from '@/lib/app-state';
import { checkConnectivity } from '@/lib/connectivity';
import { resolveAnalysisRequest } from '@/lib/analysis-resolver';
import { cooldownEndsIn } from '@/lib/cooldown';
import { clearPendingAnalysisMarker, setPendingAnalysisMarker } from '@/lib/pending-analysis';
import { setPendingAnalysisResult } from '@/lib/pending-analysis-result';
import { useSession } from '@/lib/session-provider';
import { signOut, type SignOutResult } from '@/lib/sign-out';
import { useAnnounce } from '@/lib/use-announce';
import { isPaceAnalysisOutcome } from '@shared/pace';

/**
 * The page's stopwatch format, `mm:ss.t`, exactly as its script builds it:
 * `String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0') + '.' + tenth`. Negative input
 * clamps to zero — a clock never reads below its own start.
 */
export function formatStopwatch(ms: number): string {
  const clamped = Math.max(0, ms);
  const m = Math.floor(clamped / 60000);
  const sec = Math.floor(clamped / 1000) % 60;
  const tenth = Math.floor(clamped / 100) % 10;
  return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + tenth;
}

/** The page's `setInterval(..., 100)` — one tick per tenth, the smallest unit the clock shows. */
const STOPWATCH_TICK_MS = 100;

/** The page's "Complete · timer stops · hold 300 ms → result fades in". */
const COMPLETE_HOLD_MS = Motion.duration.fade;

export default function AnalyzingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Taken exactly once, on first render — see lib/analyze-form.ts's mailbox doc comment. Retry
  // re-submits THIS same object (same idempotencyKey), never re-reads the (now-empty) mailbox.
  // CAVEAT: this app does not render under React.StrictMode today (grepped: no occurrence
  // anywhere in app/ or app.json) — if that ever changes, a lazy useState initializer runs
  // twice per mount in dev, which would drain this one-shot mailbox on the first call and hand
  // the second call `null`. Revisit this line before enabling StrictMode.
  const [request] = useState<AnalyzeFormRequest | null>(() => takePendingAnalyzeFormRequest());
  const [state, dispatch] = useReducer(analyzingReducer, INITIAL_ANALYZING_STATE);
  const [captionPhase, setCaptionPhase] = useState<AnalyzingCaptionPhase>(() => captionPhaseForElapsed(0));
  const longWaitOpacity = useSharedValue(0);
  const longWaitStyle = useAnimatedStyle(() => ({ opacity: longWaitOpacity.value }));
  // The stopwatch: elapsed ms of the current attempt. Reset on every new `waiting` attempt and
  // frozen the moment the reducer leaves `waiting` — the page's "timer stops".
  const [elapsedMs, setElapsedMs] = useState(0);
  const { session } = useSession();
  // This screen unmounts the instant `session` flips to null (the route guard) — which is exactly
  // what a successful handleUnauthorizedSignOut() below does. Same guard app/settings.tsx's
  // isMountedRef uses for its own signOut() call, for the same reason.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  // Issue #11: the waiting-phase caption below carries `accessibilityLiveRegion="polite"`,
  // Android-only — this is the iOS complement, same pattern as app/(tabs)/index.tsx. Derived from
  // the same `captionPhase` the caption itself renders, so the announcement always matches what's
  // on screen (step 0 -> step 1 -> the long-wait line), and goes silent (null) once this screen
  // leaves 'waiting' — the ErrorPanel below announces its own title/body instead.
  const statusLine =
    state.phase === 'waiting'
      ? captionPhase.kind === 'step'
        ? stepCaption(captionPhase.stepKey, request?.mediaType ?? 'photo')
        : Copy.analyzing.longWait
      : state.phase === 'succeeded'
        ? Copy.analyzing.done
        : null;
  useAnnounce(statusLine);

  // Defensive bail-out: a direct or cold navigation to this route with nothing staged (module
  // state does not survive a process kill, so this is also what a relaunch mid-analysis looks
  // like from here — a genuine app KILL, not just a background/foreground cycle, which issue
  // #64's reconciliation effect below handles instead; see this file's header). Surfacing "your
  // analysis finished" after a real kill+relaunch needs a persisted, cross-restart marker outside
  // this screen entirely, not something reachable from a mailbox that a process kill already
  // emptied — out of scope here, see this issue's DOCS block. There is no copy-deck string for
  // this case because the real flow should never reach it; back out quietly rather than invent
  // wording the deck doesn't have.
  // H4 (v23-ux-audit-r1): this used to be `router.replace('/')` inside a mount effect, which
  // fires before the root navigator has mounted on a cold start/deep link and throws "Attempted
  // to navigate before mounting the Root Layout component." A declarative `<Redirect>` in the
  // JSX below (guarded by the `!request` check further down) defers the navigation until the
  // navigator is actually ready.

  // Issue #140: persist a marker of this analysis (keyed by idempotency key) the moment a real
  // request exists, so a process KILL during the wait can still be reconciled on the next cold
  // launch — see lib/pending-analysis.ts and the startup check in app/(tabs)/index.tsx. The
  // foreground reconciliation below (#64) only covers a background/foreground cycle while this
  // screen stays mounted; a genuine kill needs a marker that outlives the JS process, which
  // lib/analyze-form.ts's module-state mailbox cannot be. Fire-and-forget: nothing here blocks the
  // submit() call below, and losing the race to an extremely early kill is no worse than the
  // unmarked behavior it replaces.
  useEffect(() => {
    if (!request || !session?.user.id) return;
    setPendingAnalysisMarker({ idempotencyKey: request.idempotencyKey, userId: session.user.id });
  }, [request, session]);

  // Drives the reducer: fires the submit call for the current attempt, races it against the
  // client-side timeout, and dispatches whichever settles first. Re-runs whenever `state`
  // transitions into a new `waiting` attempt (a fresh mount, or a Retry); the guard below makes
  // every other transition a no-op cleanup.
  //
  // Issue #93's pre-flight gate runs FIRST, immediately before the call — not once on mount —
  // because connectivity changes while this screen sits on `waiting` (time passing in a dead zone)
  // and again on a Retry (the user walked back into signal). An offline reading dispatches
  // 'offline' and returns WITHOUT ever calling submit() or starting the timeout timer, so the user
  // sees `offline.blocked.*` — whose "nothing has been sent yet" is true by construction here —
  // rather than a spinner that can only ever resolve into the generic failure copy.
  useEffect(() => {
    if (state.phase !== 'waiting' || !request) {
      return;
    }
    const attempt = state.attempt;
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
            // Issue #136: carry the server's code through, so a 402 quota_exceeded can open the
            // paywall below instead of offering a Retry that would resubmit into the same
            // exhausted quota.
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
          // Folded into the same failure copy as a documented error — every analyze-form failure
          // path releases the reservation before returning (docs/architecture.md step 9), so "this
          // one wasn't counted against your quota" holds regardless of *why* the call failed. No
          // `code` here: no response was ever received, so there is no server-authored code.
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
  }, [state, request]);

  // Issue #64: reconcile against the persisted `analyses` row whenever the app returns to the
  // foreground while this screen is still waiting — subscribing to issue #10's single AppState
  // listener (lib/app-state.ts) rather than registering a second one. The row is matched by
  // request key, not `id`: the DB id is never known client-side until a real `succeeded` response
  // names it. `resolve_analysis_request` derives the owner from auth.uid() and follows either the
  // original key or a canonical-result alias without exposing the content fingerprint.
  //
  // Three outcomes, matching the issue's own three cases:
  //  - no row yet, a transient read error, or `status: 'reserved'` -> do nothing. The row not
  //    existing yet just means the reserve hasn't landed server-side; either way this is still
  //    genuinely in flight, so the ORIGINAL submit()/timeout race above remains the source of
  //    truth. Never resubmit here — the idempotency key protects the server from a double-charge,
  //    but this effect must not even try.
  //  - `status: 'delivered'` -> dispatch the EXISTING `succeeded` event (same fields a real
  //    response carries), which the effect below already routes to `/result/[id]`.
  //  - `status: 'released'` -> dispatch `reconciledReleased`, the one case that would otherwise
  //    spin forever: the server already gave up on this analysis while the app was away, and
  //    nothing will ever resolve the original submit() promise now.
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
          // Structural validation (CLAUDE.md: shape only, never content) before trusting a row
          // read outside the normal submit() response path. An invalid shape here would be a
          // genuine bug elsewhere (settle_analysis only ever writes a validated PaceResult) —
          // rather than navigate to a broken result screen, fall through to a no-op and let the
          // original submit()/timeout race keep governing.
          if (isPaceAnalysisOutcome(outcome)) {
            dispatch({ type: 'succeeded', attempt, outcome, analysisId: data.id });
          }
          return;
        }

        if (data.status === 'released') {
          // Issue #140: a terminal outcome — clear the cross-restart marker here, the only path
          // that ever reaches the 'released' phase, so a later cold start cannot resurrect it.
          clearPendingAnalysisMarker();
          dispatch({ type: 'reconciledReleased', attempt, analysisId: data.id });
        }
        // status === 'reserved': still genuinely in flight — intentionally no-op.
      } catch {
        // Same posture as a missing row / a returned error above: this is a supplementary check,
        // not the primary source of truth, so a thrown read failure is not surfaced.
      }
    }

    return onAppForeground(() => {
      reconcile();
    });
  }, [state, request]);

  // Drives the caption pacing (step 0 -> step 1, steady -> the long-wait fade) from the SAME pure
  // function the reducer's timing constants come from — see lib/analyzing-machine.ts. Scheduled,
  // not polled: there are only as many transitions as ANALYZING_STEP_KEYS has entries, plus one.
  useEffect(() => {
    if (state.phase !== 'waiting') {
      return;
    }
    setCaptionPhase(captionPhaseForElapsed(0));
    longWaitOpacity.value = 0;

    const transitionTimes: number[] = [];
    for (let i = 1; i < ANALYZING_STEP_KEYS.length; i++) {
      transitionTimes.push(i * ANALYZING_STEP_FLOOR_MS);
    }
    transitionTimes.push(ANALYZING_STEP_KEYS.length * ANALYZING_STEP_FLOOR_MS + ANALYZING_LONG_WAIT_DELAY_MS);

    const handles = transitionTimes.map((t) =>
      setTimeout(() => setCaptionPhase(captionPhaseForElapsed(t)), t)
    );

    return () => {
      handles.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- longWaitOpacity is a stable ref value
  }, [state]);

  // The long-wait line fades in once, never loops (motion-consult.md) — the sheet's arrive curve.
  useEffect(() => {
    if (captionPhase.kind !== 'longWait') return;
    longWaitOpacity.value = withTiming(1, {
      duration: Motion.duration.fade,
      easing: Easing.bezier(...Motion.curve.arrive),
    });
  }, [captionPhase.kind, longWaitOpacity]);

  // The stopwatch ticks only while `waiting`; every other phase leaves the last value on screen
  // (the page's "timer stops"). A new `waiting` attempt (a Retry) restarts it from zero.
  useEffect(() => {
    if (state.phase !== 'waiting') return;
    setElapsedMs(0);
    const startedAt = Date.now();
    const handle = setInterval(() => setElapsedMs(Date.now() - startedAt), STOPWATCH_TICK_MS);
    return () => clearInterval(handle);
  }, [state]);

  // Success (a full result OR an honest isFallback: true partial, issue #45 — both flow through
  // this SAME branch, never treated as a failure) hands off to the result screen. That route
  // (issue #56) does not exist in this worktree, hence the `Href` cast — a real forward reference
  // to a documented route (docs/architecture.md's route tree: `result/[id]`), not a guess at one.
  // `justAnalyzed` matches docs/design/motion-consult.md item 3's own example verbatim, which is
  // what #56/#61's first-reveal-vs-reopen animation trigger is specified to key off.
  useEffect(() => {
    if (state.phase !== 'succeeded') return;
    // V23-05's completion frame: the clock has stopped (the tick effect above ended with
    // `waiting`), the laser is gone and the status reads "Done" — hold it for the page's 300 ms,
    // THEN hand off. The timer is cleared on unmount so a screen that is already gone (the route
    // guard unmounts this on sign-out) never stages a result or navigates from the grave.
    const handle = setTimeout(() => {
      // Issue #140: clear the marker on the way out. Without this, a NORMAL (non-killed) analysis
      // would leave a stale 'delivered' marker behind, and the next cold start — for any reason at
      // all — would silently reroute the user to this same, already-viewed result. Cleared INSIDE
      // the hold, beside the staging it pairs with: a kill during the 300 ms must still find the
      // marker, or the cold-start reroute to a result the user was charged for is lost.
      clearPendingAnalysisMarker();
      // Review r7-4: hand the result screen the body the server just sent, rather than making it
      // re-query the row. A zero-pillars-assessed 200 carries a complete, honest all-null readout
      // for a reservation that was RELEASED, not settled (nobody is charged for a result carrying
      // nothing), so there is no readable row behind that id and a re-fetch dead-ends on "We
      // couldn't find this analysis." Staged before the navigation, one-shot and id-matched, so a
      // re-open from Past Analyses still reads the persisted row exactly as before.
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

  // Issue #136: a real 402 quota_exceeded opens the paywall rather than the generic retryable
  // error panel — a Retry there would only resubmit into the same exhausted quota, a dead-end
  // loop. Routed from an effect, mirroring the 'succeeded' effect above, so the `failed` render
  // branch (guarded to skip this code) never flashes first. `app/paywall.tsx` re-reads live quota
  // on mount, so no params are needed.
  useEffect(() => {
    if (state.phase !== 'failed' || state.code !== 'quota_exceeded') return;
    router.replace('/paywall');
  }, [state, router]);

  function handleRetry() {
    dispatch({ type: 'retry' });
  }

  // The server's 429 `zero_pillar_cooldown` (review r8-1). Its own one-sentence message, plus the
  // clock time its `retryAfterSeconds` names — and no time at all when that field was unreadable,
  // because a guessed "try again at" is worse than none. Computed once per render off state the
  // panel already has; nothing here counts down or re-derives the server's decision.
  const cooldown =
    state.phase === 'failed' && state.code === 'zero_pillar_cooldown'
      ? { body: buildCooldownBody(state.message, cooldownEndsIn(state.retryAfterSeconds)) }
      : null;

  // L7 follow-up (v23-ux-audit-r1, review-1): the `unauthorized` panel's copy tells the user to
  // "sign in and try again", but the session that expired is still the one a plain Retry would
  // resubmit under — that CTA must actually clear the session, not resubmit into it. Reuses
  // lib/sign-out.ts's signOut() (the same helper app/settings.tsx calls) so a successful sign-out
  // clears the local session and lets app/_layout.tsx's Stack.Protected guard redirect to
  // (auth)/sign-in on its own; this screen does not navigate itself.
  const [isSigningOutOfExpiredSession, setIsSigningOutOfExpiredSession] = useState(false);

  async function handleUnauthorizedSignOut() {
    if (isSigningOutOfExpiredSession) return;
    setIsSigningOutOfExpiredSession(true);

    const result = await signOut();
    if (!result.ok) {
      showUnauthorizedSignOutFailureAlert(result);
    }

    if (isMountedRef.current) setIsSigningOutOfExpiredSession(false);
  }

  // Mirrors app/settings.tsx's showSignOutFailureAlert exactly (same three-state result, same
  // copy, same exhaustiveness guard) rather than inventing a second error-handling philosophy for
  // the same underlying call.
  function showUnauthorizedSignOutFailureAlert(result: Extract<SignOutResult, { ok: false }>) {
    const reason = result.reason;
    switch (reason) {
      case 'globalRevokeFailed':
        Alert.alert(
          Copy.settings.signOutError.globalRevokeFailed.title,
          Copy.settings.signOutError.globalRevokeFailed.body,
          [{ text: Copy.settings.alertDismiss }]
        );
        return;
      case 'stillSignedIn':
        Alert.alert(
          Copy.settings.signOutError.stillSignedIn.title,
          Copy.settings.signOutError.stillSignedIn.body,
          [
            { text: Copy.settings.signOutError.stillSignedIn.cta.secondary, style: 'cancel' },
            {
              text: Copy.settings.signOutError.stillSignedIn.cta.primary,
              onPress: () => {
                void handleUnauthorizedSignOut();
              },
            },
          ]
        );
        return;
      default: {
        const exhaustive: never = reason;
        throw new Error(`Unhandled SignOutResult reason: ${String(exhaustive)}`);
      }
    }
  }

  // The server answered 409 `previous_attempt_failed`: the reservation for THIS idempotency key was
  // already released, and `reserve_analysis` hands an idempotency match back as-is whatever its
  // status — so re-submitting `request` can only ever produce the same 409. The only real recovery
  // is a new analysis, which mints a fresh idempotency key through the normal capture flow. Clears
  // the cross-restart marker (#140) for the same reason handleCancel does: this attempt is over.
  function handleStartNew() {
    clearPendingAnalysisMarker();
    router.replace('/capture');
  }

  function handleCancel() {
    // Copy deck: "returns to Home. Retry/Cancel must never trap the user."
    // Issue #140: the user chose to stop watching, so nothing should resurface on a later launch.
    // Deliberately NOT cleared on `failed`/`timedOut` themselves — a client-perceived timeout does
    // not prove the server-side call stopped, so the marker must survive until either the user
    // walks away (here) or a later check learns the truth.
    clearPendingAnalysisMarker();
    router.replace('/');
  }

  if (!request) {
    return <Redirect href="/" />;
  }

  // The wait and the completion frame share one composition (the page's three artboards differ
  // only in the status line and whether the laser is running).
  const showsClock = state.phase === 'waiting' || state.phase === 'succeeded';

  return (
    <View style={styles.screen}>
      {/* The laser sits behind the scroll content and sweeps the whole screen, not the padded
          column; it unmounts the instant the wait ends (the page's third artboard has none). */}
      {state.phase === 'waiting' && <LaserSweep testID="analyzing-laser" />}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top, Layout.canvas.safeTop),
            paddingBottom: Math.max(insets.bottom, Layout.canvas.safeBottom),
          },
        ]}>
        {/* The title belongs to the WAIT (and its completion frame), and only to it. Every
            non-waiting phase below renders an `<ErrorPanel>` whose own title carries
            `accessibilityRole="header"` — so leaving this mounted put two headers in VoiceOver's
            rotor, and the first of them said "ANALYZING" directly above a panel that says the
            analysis stopped, timed out, or was never sent. */}
        {showsClock && (
          <ScreenCenter>
            <View style={styles.readout}>
              <Text style={styles.clock} testID="analyzing-clock">
                {formatStopwatch(elapsedMs)}
              </Text>
              <Text style={styles.label} accessibilityRole="header">
                {Copy.analyzing.title}
              </Text>
              {state.phase === 'waiting' && captionPhase.kind === 'longWait' ? (
                <Animated.Text
                  style={[styles.status, longWaitStyle]}
                  accessibilityLiveRegion="polite">
                  {Copy.analyzing.longWait}
                </Animated.Text>
              ) : (
                <Text style={styles.status} accessibilityLiveRegion="polite">
                  {statusLine}
                </Text>
              )}
            </View>
          </ScreenCenter>
        )}

        {/* The server's 409 `previous_attempt_failed`: this request's reservation was already
            released, so a Retry — which by design reuses the same idempotency key — would hand back
            the same released row and the same 409, forever. Same reasoning as the `released` branch
            below, reached through the live response path rather than through reconciliation. The
            primary action is therefore "start a new analysis", matching the server's own wording. */}
        {state.phase === 'failed' && state.code === 'previous_attempt_failed' && (
          <ErrorPanel
            title={Copy.analyzing.error.previousAttemptFailed.title}
            body={Copy.analyzing.error.previousAttemptFailed.body}
            primary={{ label: Copy.analyzing.error.cta.startNew, onPress: handleStartNew }}
            onCancel={handleCancel}
          />
        )}

        {/* L7 (v23-ux-audit-r1): a session that expired mid-wait used to read identically to a
            generic server failure. The code is already tracked (`state.code`), so this is a
            copy-only split, not a new failure path. */}
        {state.phase === 'failed' && state.code === 'unauthorized' && (
          <ErrorPanel
            title={Copy.analyzing.error.unauthorized.title}
            body={Copy.analyzing.error.unauthorized.body}
            primary={{
              label: Copy.analyzing.error.cta.signOut,
              onPress: () => {
                void handleUnauthorizedSignOut();
              },
            }}
            onCancel={handleCancel}
          />
        )}

        {/* The server's 429 `too_many_failed_attempts` — issue #6's anti-farm cooldown, reached
            here only when it beat `app/capture/extracting.tsx`'s pre-flight (a lookup that failed
            open, or a window that closed between the two calls). NOTHING FAILED: the reserve was
            refused, so no model call was made, no row exists, and nothing was counted. It used to
            render `error.failed` — "Your analysis failed / the service didn't return a usable
            result" — with a Retry that resubmitted into the identical refusal; both halves were
            untrue. There is deliberately no Retry and no upgrade offer here: retrying cannot
            succeed until the window clears, and `analyze-form` maps this to 429 rather than 402
            precisely so we never sell a plan to someone we just throttled.

            The remaining time is NOT stated on this path. The 429 body carries no expiry
            (`reserve_analysis` returns only the reason), and this screen will not invent one or
            spend another round trip to guess at it — the pre-flight is the surface that has the
            number, and Home shows it too. */}
        {state.phase === 'failed' && state.code === 'too_many_failed_attempts' && (
          <ErrorPanel
            title={Copy.analysisPause.title}
            body={Copy.analysisPause.body}
            primary={{ label: Copy.analysisPause.cta, onPress: handleCancel }}
          />
        )}

        {/* The server's 429 `zero_pillar_cooldown` (review r8-1): the previous analysis assessed
            nothing, so a resubmission is refused for a short window — BEFORE any model call, so
            the generic "your analysis failed" this would otherwise render is simply false. NO
            RETRY: a retry reuses this request's idempotency key, which `reserve_analysis` answers
            with the already-released row and a 409, and "start a new analysis" only lands back in
            the same cooldown. Neither button can work inside the window, so neither is offered —
            the one honest way forward is out of this screen. Home states the same wait, from
            `quota-status`'s `blockedUntil`, before a frame is ever extracted. */}
        {cooldown && (
          <ErrorPanel
            title={Copy.analyzing.error.zeroPillarCooldown.title}
            body={cooldown.body}
            primary={{ label: Copy.analyzing.error.cta.backHome, onPress: handleCancel }}
          />
        )}

        {/* Issue #136: `quota_exceeded` is excluded here — the effect above routes it to /paywall.
            Rendering a Retry for it would resubmit into the same exhausted quota. */}
        {state.phase === 'failed' &&
          state.code !== 'quota_exceeded' &&
          state.code !== 'too_many_failed_attempts' &&
          state.code !== 'previous_attempt_failed' &&
          state.code !== 'unauthorized' &&
          state.code !== 'zero_pillar_cooldown' && (
            <ErrorPanel
              title={Copy.analyzing.error.failed.title}
              body={Copy.analyzing.error.failed.body}
              primary={{ label: Copy.analyzing.error.cta.retry, onPress: handleRetry }}
              onCancel={handleCancel}
            />
          )}

        {state.phase === 'timedOut' && (
          <ErrorPanel
            title={Copy.analyzing.error.timeout.title}
            body={Copy.analyzing.error.timeout.body}
            primary={{ label: Copy.analyzing.error.cta.retry, onPress: handleRetry }}
            onCancel={handleCancel}
          />
        )}

        {/* Issue #93's pre-flight gate: the connectivity read in the submit effect came back
            offline BEFORE analyzeFormClient.submit() was ever called, so `offline.blocked.body`'s
            "nothing has been sent yet" is literally true here rather than a hopeful claim. Retry
            re-runs the same effect (a fresh checkConnectivity() read); Cancel exits to Home — the
            same exit every other error phase on this screen offers. */}
        {state.phase === 'offline' && (
          <ErrorPanel
            title={Copy.offline.blocked.title}
            body={Copy.offline.blocked.body}
            primary={{ label: Copy.analyzing.error.cta.retry, onPress: handleRetry }}
            onCancel={handleCancel}
          />
        )}

        {/* Issue #64's third case — the one that otherwise spins forever: the app was backgrounded
            while waiting, and reconciliation found the row already 'released' (the server gave up
            on it while we were away). This is the SAME released-reservation dead end the 409
            `previous_attempt_failed` branch above handles, reached through reconciliation rather
            than through a live response, so it renders the same copy and offers the same action.
            Still deliberately NO Retry: resubmitting with this request's idempotency key would just
            hand back the same released row again (`reserve_analysis` returns an idempotency match
            "as-is, whatever its status"), not actually retry — see lib/analyzing-machine.ts's
            'released' phase doc comment. */}
        {state.phase === 'released' && (
          <ErrorPanel
            title={Copy.analyzing.error.previousAttemptFailed.title}
            body={Copy.analyzing.error.previousAttemptFailed.body}
            primary={{ label: Copy.analyzing.error.cta.startNew, onPress: handleStartNew }}
            onCancel={handleCancel}
          />
        )}

        {/* 'succeeded' renders the completion frame above (clock stopped, "Done") for the page's
            300 ms hold; the effect above then navigates away. */}
      </ScrollView>
    </View>
  );
}

/** The status line for a step, resolved against the media the user submitted. */
function stepCaption(stepKey: AnalyzingStepKey, mediaType: AnalyzeFormRequest['mediaType']): string {
  return stepKey === 'uploading'
    ? Copy.analyzing.step.uploading(mediaType)
    : Copy.analyzing.step.finding;
}

/**
 * The cooldown panel's body: the server's own sentence, then when to come back.
 *
 * Kept as one pure function so the honest degradation is explicit rather than an inline ternary —
 * with no readable `retryAfterSeconds` there is no time to state, and the copy says "give it a few
 * minutes" instead of naming a clock time we would be inventing. `null` when the server sent no
 * message at all, which is the caller's signal to render nothing rather than a sentence with a
 * hole in it.
 */
function buildCooldownBody(message: string | undefined, time: string | null): string {
  // Falls back to the deck's own sentence rather than returning nothing. The server always sends
  // one today, so this is skew insurance — but the failure it insures against is not a worse
  // message, it is a panel that never renders: this code is excluded from the generic retryable
  // branch below, so an empty body would leave the screen with no text and no way off it. Known
  // Issue #39's lesson is that a client and a deployed server CAN disagree about a body while
  // every offline test agrees with itself.
  const sentence = message?.trim() || Copy.analyzing.error.zeroPillarCooldown.fallbackMessage;
  const template = time
    ? Copy.analyzing.error.zeroPillarCooldown.body.replace('{time}', time)
    : Copy.analyzing.error.zeroPillarCooldown.bodyUnknownTime;
  return template.replace('{message}', sentence);
}

function ScreenCenter({ children }: { children: ReactNode }) {
  return <View style={styles.centerBlock}>{children}</View>;
}

type ErrorPanelProps = {
  title: string;
  body: string;
  /**
   * The one recoverable action this phase actually has, if it has one. Retry for the phases where
   * re-submitting the same request can genuinely succeed (a plain failure, a timeout, an offline
   * pre-flight block); "start a new analysis" for both released-reservation phases —
   * `previous_attempt_failed` and issue #64's `released` — where re-submitting the same request can
   * only ever return the same released row. A label lives with its handler here so no phase can
   * render a button whose wording promises something the handler cannot do.
   */
  primary?: { label: string; onPress: () => void };
  /**
   * The secondary exit. Omitted on either cooldown panel because its single honest primary action
   * already leaves this screen; rendering a second exit would duplicate the same destination.
   */
  onCancel?: () => void;
};

/**
 * Shared chrome for all three error/exit states (`analyzing.error.failed.*` / `.timeout.*`, and
 * issue #64's `released` phase reusing `failed`'s copy) — same calm, non-alarmed treatment
 * app/(tabs)/index.tsx's own quota-error state already uses (plain text.primary/text.secondary,
 * no Semantic.error red): this app's voice is "coach, not scold" even when something went wrong,
 * and `Semantic.error` (constants/theme.ts) is reserved for a true alarm condition, not a "try
 * again, nothing was lost" recoverable state.
 */
function ErrorPanel({ title, body, primary, onCancel }: ErrorPanelProps) {
  // Issue #11: `accessibilityLiveRegion="polite"` on the two Texts below is Android-only — this
  // is the iOS complement. `ErrorPanel` is only ever mounted fresh for whichever phase is showing
  // (failed/timedOut/offline/released never render two at once), so this fires once per
  // presentation, on mount. Title+body announced together as one utterance, not two ticks.
  useAnnounce(`${title} ${body}`);

  return (
    <View style={[styles.centerBlock, styles.errorPanel]}>
      {/* `accessibilityLabel` on the title is what lets a screen reader (and the screen tests)
          find the panel by its heading text. */}
      <Text
        style={styles.errorTitle}
        accessibilityRole="header"
        accessibilityLabel={title}
        accessibilityLiveRegion="polite">
        {title}
      </Text>
      <Text style={styles.errorBody} accessibilityLiveRegion="polite">
        {body}
      </Text>
      {primary && <SquareButton label={primary.label} onPress={primary.onPress} />}
      {onCancel && (
        <SquareButton variant="secondary" label={Copy.analyzing.error.cta.cancel} onPress={onCancel} />
      )}
    </View>
  );
}

/** The old theme's readable-column cap (issue #63), kept so an iPad does not stretch the panels. */
const READABLE_WIDTH = 560;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Ink.bg,
  },
  // `flex` ONLY. Child-layout props (alignItems/justifyContent/...) are ILLEGAL in a
  // ScrollView's `style` and throw at render: "ScrollView child layout must be applied
  // through the contentContainerStyle prop." The readable column is therefore centred by
  // `alignSelf: 'center'` on the contentContainerStyle below, not from here (issue #63).
  scroll: {
    flex: 1,
  },
  content: {
    // flexGrow, not flex — matches app/(tabs)/index.tsx: fills the viewport when short, scrolls
    // instead of clipping at the largest Dynamic Type sizes (design brief §7). The vertical
    // padding is set at the render site from the live insets (page: 59 / 34 minimum).
    flexGrow: 1,
    width: '100%',
    maxWidth: READABLE_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: Layout.gutter,
  },
  centerBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Layout.sectionGap,
  },
  // The page's readout: a centred column, gap 16 — clock, label, status.
  readout: {
    alignItems: 'center',
    gap: Space.lg,
  },
  clock: {
    ...Type.clock,
    color: Ink.ink,
    textAlign: 'center',
  },
  label: {
    ...Type.label,
    color: Ink.ink2,
    textAlign: 'center',
  },
  status: {
    ...Type.body,
    color: Ink.ink,
    textAlign: 'center',
  },
  errorPanel: {
    alignSelf: 'stretch',
    gap: Space.lg,
  },
  errorTitle: {
    ...Type.h1,
    color: Ink.ink,
    textAlign: 'center',
  },
  errorBody: {
    ...Type.body,
    color: Ink.ink2,
    textAlign: 'center',
  },
});
