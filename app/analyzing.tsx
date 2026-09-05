/**
 * Screen 6 — Analyzing (issue #80): the wait screen shown while `analyze-form` is in flight.
 *
 * Built against `lib/analyze-form.ts`'s injectable seam, originally reviewable without a live
 * `analyze-form` (issue #44) via a dev mock. That seam is now bound to the real client — issue
 * #128, 2026-07-26, see that file's header — and the mock is kept only for tests/dev, `__DEV__`-
 * guarded so it throws in a release bundle. The one exception to "nothing in this file talks to Supabase" is issue #64's
 * reconciliation read below (`supabase.from('analyses')...`) — a plain RLS-scoped SELECT of this
 * user's own row, the same category of read `lib/consent.ts` and `app/result/[id].tsx` already
 * make directly from the client, not a privileged write.
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
 * MOTION: the step-list pacing and the "Still analyzing" fade are `docs/design/motion-consult.md`
 * ("The wait state — V2.2's honesty mechanic") — issue #61 owns the general motion/reduced-motion
 * spec; this screen only implements what that doc already pins down. Per that doc's reduced-
 * motion map, this wait-state signaling is explicitly EXEMPT from suppression ("low-amplitude,
 * single-shot, opacity/color-only functional state signaling... reduced motion targets vestibular
 * triggers, not state indicators") — so, deliberately, nothing here branches on
 * `useReducedMotion()`. That is a considered reading of the spec, not an oversight.
 */
import { Redirect, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { Alert, Animated, Easing, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArcLoader } from '@/components/arc-loader';
import { KineticText } from '@/components/kinetic-text';
import { LowPolyField } from '@/components/low-poly-field';
import { Eyebrow } from '@/components/ui/eyebrow';
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
  Spacing,
  Tracking,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
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
import { checkConnectivity } from '@/lib/connectivity';
import { clearPendingAnalysisMarker, setPendingAnalysisMarker } from '@/lib/pending-analysis';
import { useSession } from '@/lib/session-provider';
import { signOut, type SignOutResult } from '@/lib/sign-out';
import { supabase } from '@/lib/supabase';
import { useAnnounce } from '@/lib/use-announce';
import { isPaceAnalysisOutcome } from '@shared/pace';

export default function AnalyzingScreen() {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();

  // Taken exactly once, on first render — see lib/analyze-form.ts's mailbox doc comment. Retry
  // re-submits THIS same object (same idempotencyKey), never re-reads the (now-empty) mailbox.
  // CAVEAT: this app does not render under React.StrictMode today (grepped: no occurrence
  // anywhere in app/ or app.json) — if that ever changes, a lazy useState initializer runs
  // twice per mount in dev, which would drain this one-shot mailbox on the first call and hand
  // the second call `null`. Revisit this line before enabling StrictMode.
  const [request] = useState<AnalyzeFormRequest | null>(() => takePendingAnalyzeFormRequest());
  const [state, dispatch] = useReducer(analyzingReducer, INITIAL_ANALYZING_STATE);
  const [captionPhase, setCaptionPhase] = useState<AnalyzingCaptionPhase>(() => captionPhaseForElapsed(0));
  const longWaitOpacity = useRef(new Animated.Value(0)).current;
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
  useAnnounce(
    state.phase === 'waiting'
      ? captionPhase.kind === 'step'
        ? Copy.analyzing.step[captionPhase.stepKey]
        : Copy.analyzing.longWait
      : null
  );

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
            dispatch({ type: 'failed', attempt, code: result.error.code });
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
  // `idempotency_key`, not `id`: the DB id is never known client-side until a real `succeeded`
  // response names it, but the idempotency key is known from the moment `request` exists, and
  // `reserve_analysis` guarantees at most one row per (user, idempotency_key) — see
  // supabase/migrations/20260711150400_quota_reserve_settle_release.sql. RLS scopes the read to
  // this user's own rows, so no explicit user_id filter is needed (same idiom as lib/consent.ts).
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
        const { data, error } = await supabase
          .from('analyses')
          .select('id, status, result, is_fallback')
          .eq('idempotency_key', req.idempotencyKey)
          .maybeSingle();

        if (error || !data) return;

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
    longWaitOpacity.setValue(0);

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

  // The long-wait line fades in once, never loops (motion-consult.md) — an ease-out arrival, per
  // theme.ts's Motion.curve convention.
  useEffect(() => {
    if (captionPhase.kind !== 'longWait') return;
    Animated.timing(longWaitOpacity, {
      toValue: 1,
      duration: Motion.duration.standard,
      easing: Easing.bezier(...Motion.curve.easeOut),
      useNativeDriver: true,
    }).start();
  }, [captionPhase.kind, longWaitOpacity]);

  // Success (a full result OR an honest isFallback: true partial, issue #45 — both flow through
  // this SAME branch, never treated as a failure) hands off to the result screen. That route
  // (issue #56) does not exist in this worktree, hence the `Href` cast — a real forward reference
  // to a documented route (docs/architecture.md's route tree: `result/[id]`), not a guess at one.
  // `justAnalyzed` matches docs/design/motion-consult.md item 3's own example verbatim, which is
  // what #56/#61's first-reveal-vs-reopen animation trigger is specified to key off.
  useEffect(() => {
    if (state.phase !== 'succeeded') return;
    // Issue #140: clear the marker on the way out. Without this, a NORMAL (non-killed) analysis
    // would leave a stale 'delivered' marker behind, and the next cold start — for any reason at
    // all — would silently reroute the user to this same, already-viewed result.
    clearPendingAnalysisMarker();
    router.replace({
      pathname: '/result/[id]',
      params: { id: state.analysisId, justAnalyzed: '1' },
    } as Href);
  }, [state, router]);

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

  return (
    <ScreenGradient>
      <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* The screen title belongs to the WAIT, and only to it. Every non-waiting phase below
            renders an `<ErrorPanel>` whose own `<KineticText>` title already carries
            `accessibilityRole="header"` — so leaving this mounted put two headers in VoiceOver's
            rotor, and the first of them said "ANALYZING" directly above a panel that says the
            analysis stopped, timed out, or was never sent. The eyebrow is not the thing that has to
            survive there; the panel's title is. Nothing about the wait phase's own composition
            changes. */}
        {state.phase === 'waiting' && (
          <Eyebrow tone="primary" accessibilityRole="header">
            {Copy.analyzing.title}
          </Eyebrow>
        )}

        {state.phase === 'waiting' && (
          <ScreenCenter styles={styles}>
            {/* THE WAIT, redesigned. The `ActivityIndicator` is replaced by the low-poly field
                morphing continuously between its three poses — the species-in-pieces motif, and
                the one screen in the app with enough dead time to earn it.

                THIS IS NOT A PROGRESS INDICATOR AND MUST NEVER BECOME ONE. It has no start, no
                end, and no relationship to how long the request has been in flight; it does not
                fill, and it does not speed up as the wait ages. That is this screen's existing
                honesty rule (see the file header: "no fake progress, no extra beat"), and the
                field obeys it for the same reason the step captions do. Under reduced motion it
                renders as a still mark — the composition survives, the movement goes; this
                screen's header already documents why its wait-state signaling is exempt from
                blanket motion suppression, and a static mark is the honest middle. */}
            {/* Cadence Arcs (2026-09-01): the wait mark now runs INSIDE the motif's rings —
                ripples radiating from the figure, which is the same idea the result screen's score
                rings carry, at the moment the score is being computed. The rings are drawn behind
                the runner and take no layout, so the mark's own size and position are unchanged.
                `<ArcLoader>` inherits this screen's honesty rule verbatim rather than being
                trusted to remember it: see its header — it draws no arc that fills toward a
                completion, and is dead still under reduced motion, exactly as the field is. */}
            <View style={styles.waitMark}>
              <ArcLoader
                size={WAIT_MARK_SIZE * WAIT_RINGS_SCALE}
                style={styles.waitRings}
                testID="analyzing-rings"
              />
              <LowPolyField
                color={colors.text.primary}
                size={WAIT_MARK_SIZE}
                testID="analyzing-mark"
              />
            </View>
            {captionPhase.kind === 'step' ? (
              <Text style={styles.caption} accessibilityLiveRegion="polite">
                {Copy.analyzing.step[captionPhase.stepKey]}
              </Text>
            ) : (
              <Animated.Text
                style={[styles.caption, { opacity: longWaitOpacity }]}
                accessibilityLiveRegion="polite">
                {Copy.analyzing.longWait}
              </Animated.Text>
            )}
          </ScreenCenter>
        )}

        {/* The server's 409 `previous_attempt_failed`: this request's reservation was already
            released, so a Retry — which by design reuses the same idempotency key — would hand back
            the same released row and the same 409, forever. Same reasoning as the `released` branch
            below, reached through the live response path rather than through reconciliation. The
            primary action is therefore "start a new analysis", matching the server's own wording. */}
        {state.phase === 'failed' && state.code === 'previous_attempt_failed' && (
          <ErrorPanel
            styles={styles}
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
            styles={styles}
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

        {/* Issue #136: `quota_exceeded` is excluded here — the effect above routes it to /paywall.
            Rendering a Retry for it would resubmit into the same exhausted quota. */}
        {state.phase === 'failed' &&
          state.code !== 'quota_exceeded' &&
          state.code !== 'previous_attempt_failed' &&
          state.code !== 'unauthorized' && (
            <ErrorPanel
              styles={styles}
              title={Copy.analyzing.error.failed.title}
              body={Copy.analyzing.error.failed.body}
              primary={{ label: Copy.analyzing.error.cta.retry, onPress: handleRetry }}
              onCancel={handleCancel}
            />
          )}

        {state.phase === 'timedOut' && (
          <ErrorPanel
            styles={styles}
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
            styles={styles}
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
            styles={styles}
            title={Copy.analyzing.error.previousAttemptFailed.title}
            body={Copy.analyzing.error.previousAttemptFailed.body}
            primary={{ label: Copy.analyzing.error.cta.startNew, onPress: handleStartNew }}
            onCancel={handleCancel}
          />
        )}

        {/* 'succeeded' is transient — the effect above navigates away immediately; nothing
            distinct renders for it, matching the "no fake progress, no extra beat" honesty rule. */}
      </ScrollView>
      </SafeAreaView>
    </ScreenGradient>
  );
}

function ScreenCenter({ styles, children }: { styles: Styles; children: ReactNode }) {
  return <View style={styles.centerBlock}>{children}</View>;
}

type ErrorPanelProps = {
  styles: Styles;
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
  onCancel: () => void;
};

/**
 * Shared chrome for all three error/exit states (`analyzing.error.failed.*` / `.timeout.*`, and
 * issue #64's `released` phase reusing `failed`'s copy) — same calm, non-alarmed treatment
 * app/(tabs)/index.tsx's own quota-error state already uses (plain text.primary/text.secondary,
 * no Semantic.error red): this app's voice is "coach, not scold" even when something went wrong,
 * and `Semantic.error` (constants/theme.ts) is reserved for a true alarm condition, not a "try
 * again, nothing was lost" recoverable state.
 */
function ErrorPanel({ styles, title, body, primary, onCancel }: ErrorPanelProps) {
  // Issue #11: `accessibilityLiveRegion="polite"` on the two Texts below is Android-only — this
  // is the iOS complement. `ErrorPanel` is only ever mounted fresh for whichever phase is showing
  // (failed/timedOut/offline/released never render two at once), so this fires once per
  // presentation, on mount. Title+body announced together as one utterance, not two ticks.
  useAnnounce(`${title} ${body}`);

  return (
    <View style={styles.centerBlock}>
      {/* The title assembles word by word. This is the redesign's kinetic reveal used where it
          carries meaning rather than as decoration: the error panel is the one thing on this
          screen the user did not expect, and having it resolve rather than snap in is what keeps
          the "coach, not scold" register the panel's own doc comment above establishes. */}
      <KineticText
        accessibilityRole="header"
        accessibilityLiveRegion="polite"
        staggerMs={Motion.stagger.line}
        style={styles.errorTitle}
        containerStyle={styles.errorTitleRow}>
        {title}
      </KineticText>
      {/* The body sits on an OPAQUE card, not on the wash: it is `text.secondary`, and the page
          gradient is proven for `text.primary` only (`Gradient`'s contract, constants/theme.ts). */}
      <SurfaceCard style={styles.errorCard}>
        <Text style={styles.errorBody} accessibilityLiveRegion="polite">
          {body}
        </Text>
      </SurfaceCard>
      {primary && (
        <PillButton label={primary.label} onPress={primary.onPress} style={styles.errorAction} />
      )}
      <PillButton variant="ghost" label={Copy.analyzing.error.cta.cancel} onPress={onCancel} />
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;

/** The waiting field's drawn size — the screen's subject while nothing else is on it. */
const WAIT_MARK_SIZE = 240;

/** How far the ripple rings extend past the figure they radiate from. Composition, not a token
 *  (the same rule `<ArcRing>`'s header states for ring sizes) — but named rather than inlined,
 *  because an unexplained `* 1.35` at the call site reads as a nudge someone tried once, and this
 *  is the one number that decides whether the rings frame the runner or crowd them. */
const WAIT_RINGS_SCALE = 1.35;

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
      // flexGrow, not flex — matches app/(tabs)/index.tsx: fills the viewport when short, scrolls
      // instead of clipping at the largest Dynamic Type sizes (design brief §7).
      flexGrow: 1,
      width: '100%',
      maxWidth: ContentWidth.readable,
      alignSelf: 'center',
      padding: Spacing.xl,
      gap: Spacing.xxl,
    },
    centerBlock: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xl,
    },
    // The runner and the rings share one centre. The mark keeps its own intrinsic size and the
    // rings are absolute, so adding them cannot have moved the figure by a point.
    waitMark: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    waitRings: {
      position: 'absolute',
    },
    caption: {
      fontFamily: FontFamily.mono.regular,
      fontSize: FontSize.md,
      // `text.primary`, raised from `text.secondary`: this caption now sits directly on the page
      // gradient, which `Gradient`'s contract proves for the primary tone only. It was correct at
      // secondary when the backdrop was the flat, fully-proven `background`.
      color: colors.text.primary,
      letterSpacing: Tracking.eyebrow,
      textAlign: 'center',
      textTransform: 'uppercase',
    },
    errorTitleRow: {
      justifyContent: 'center',
    },
    errorTitle: {
      fontFamily: FontFamily.display.semiBold,
      // Stepped up lg -> xxl. An error the user has to make a decision about should be the
      // largest thing on its screen; at 20pt it read as a caption above two buttons.
      fontSize: FontSize.xxl,
      letterSpacing: Tracking.display,
      lineHeight: FontSize.xxl * LineHeight.display,
      color: colors.text.primary,
      textAlign: 'center',
    },
    errorCard: {
      alignSelf: 'stretch',
    },
    errorBody: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      lineHeight: FontSize.sm * LineHeight.body,
      color: colors.text.secondary,
      textAlign: 'center',
    },
    errorAction: {
      alignSelf: 'stretch',
    },
  });
}
