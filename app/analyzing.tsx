/**
 * Screen 6 — Analyzing (issue #80): the wait screen shown while `analyze-form` is in flight.
 *
 * `analyze-form` (issue #44) does not exist yet, so this screen is built and reviewable entirely
 * against `lib/analyze-form.ts`'s injectable seam, currently bound to a mock (see that file's
 * header). Swapping the seam's binding for the real implementation is the only change #44 needs
 * to make here. The one exception to "nothing in this file talks to Supabase" is issue #64's
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
import { useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Copy } from '@/constants/copy';
import {
  Accent,
  Colors,
  ContentWidth,
  ControlHeight,
  ControlWidth,
  FontFamily,
  FontSize,
  HitTarget,
  Motion,
  Opacity,
  Radius,
  Spacing,
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
  useEffect(() => {
    if (request) return;
    router.replace('/');
  }, [request, router]);

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
          if (result.ok) {
            dispatch({
              type: 'succeeded',
              attempt,
              outcome: { result: result.data.result, isFallback: result.data.isFallback },
              analysisId: result.data.analysisId,
            });
          } else {
            // Issue #136: carry the server's code through, so a 402 quota_exceeded can open the
            // paywall below instead of offering a Retry that would resubmit into the same
            // exhausted quota.
            dispatch({ type: 'failed', attempt, code: result.error.code });
          }
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
    return null;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.header}>{Copy.analyzing.title}</Text>

        {state.phase === 'waiting' && (
          <ScreenCenter styles={styles}>
            <ActivityIndicator color={colors.text.secondary} />
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

        {/* Issue #136: `quota_exceeded` is excluded here — the effect above routes it to /paywall.
            Rendering a Retry for it would resubmit into the same exhausted quota. */}
        {state.phase === 'failed' && state.code !== 'quota_exceeded' && (
          <ErrorPanel
            styles={styles}
            title={Copy.analyzing.error.failed.title}
            body={Copy.analyzing.error.failed.body}
            onRetry={handleRetry}
            onCancel={handleCancel}
          />
        )}

        {state.phase === 'timedOut' && (
          <ErrorPanel
            styles={styles}
            title={Copy.analyzing.error.timeout.title}
            body={Copy.analyzing.error.timeout.body}
            onRetry={handleRetry}
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
            onRetry={handleRetry}
            onCancel={handleCancel}
          />
        )}

        {/* Issue #64's third case — the one that otherwise spins forever: the app was backgrounded
            while waiting, and reconciliation found the row already 'released' (the server gave up
            on it while we were away). Deliberately NO onRetry: resubmitting with this request's
            idempotency key would just hand back the same released row again (`reserve_analysis`
            returns an idempotency match "as-is, whatever its status"), not actually retry — see
            lib/analyzing-machine.ts's 'released' phase doc comment. Reuses the `failed` copy as the
            closest existing string (same "didn't go through" / "wasn't counted against your quota"
            meaning) since no dedicated string exists yet — same reuse-and-flag precedent
            lib/session-provider.tsx's corruptedSessionError already follows for `Copy.auth.error.generic`.
            A dedicated `analyzing.error.releasedWhileAway.*` pair (without the "try again" line,
            since there is no working retry here) is real future ux-copywriter work — see this
            issue's DOCS block. */}
        {state.phase === 'released' && (
          <ErrorPanel
            styles={styles}
            title={Copy.analyzing.error.failed.title}
            body={Copy.analyzing.error.failed.body}
            onCancel={handleCancel}
          />
        )}

        {/* 'succeeded' is transient — the effect above navigates away immediately; nothing
            distinct renders for it, matching the "no fake progress, no extra beat" honesty rule. */}
      </ScrollView>
    </SafeAreaView>
  );
}

function ScreenCenter({ styles, children }: { styles: Styles; children: ReactNode }) {
  return <View style={styles.centerBlock}>{children}</View>;
}

type ErrorPanelProps = {
  styles: Styles;
  title: string;
  body: string;
  /** Omitted for the `released` phase (issue #64) — see that render branch's comment for why a
   * Retry button would be a dead end there rather than an actual retry. */
  onRetry?: () => void;
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
function ErrorPanel({ styles, title, body, onRetry, onCancel }: ErrorPanelProps) {
  // Issue #11: `accessibilityLiveRegion="polite"` on the two Texts below is Android-only — this
  // is the iOS complement. `ErrorPanel` is only ever mounted fresh for whichever phase is showing
  // (failed/timedOut/offline/released never render two at once), so this fires once per
  // presentation, on mount. Title+body announced together as one utterance, not two ticks.
  useAnnounce(`${title} ${body}`);

  return (
    <View style={styles.centerBlock}>
      <Text style={styles.errorTitle} accessibilityLiveRegion="polite">
        {title}
      </Text>
      <Text style={styles.errorBody} accessibilityLiveRegion="polite">
        {body}
      </Text>
      {onRetry && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={Copy.analyzing.error.cta.retry}
          onPress={onRetry}
          style={({ pressed }) => [styles.primaryCta, pressed && styles.pressed]}>
          <Text style={styles.primaryCtaText}>{Copy.analyzing.error.cta.retry}</Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={Copy.analyzing.error.cta.cancel}
        onPress={onCancel}
        style={({ pressed }) => [styles.secondaryCta, pressed && styles.pressed]}>
        <Text style={styles.secondaryCtaText}>{Copy.analyzing.error.cta.cancel}</Text>
      </Pressable>
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    // Centers the (width-capped) content within the ScrollView's own viewport — a no-op on any
    // phone, and what keeps a tablet's readable column centered instead of flush-left (issue
    // #63; see ContentWidth's own comment in constants/theme.ts).
    scroll: {
      flex: 1,
      alignItems: 'center',
    },
    content: {
      // flexGrow, not flex — matches app/(tabs)/index.tsx: fills the viewport when short, scrolls
      // instead of clipping at the largest Dynamic Type sizes (design brief §7).
      flexGrow: 1,
      width: '100%',
      maxWidth: ContentWidth.readable,
      padding: Spacing.xl,
      gap: Spacing.xxl,
    },
    header: {
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.xl,
      color: colors.text.primary,
    },
    centerBlock: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xl,
    },
    caption: {
      fontFamily: FontFamily.mono.regular,
      fontSize: FontSize.md,
      color: colors.text.secondary,
      textAlign: 'center',
    },
    errorTitle: {
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.lg,
      color: colors.text.primary,
      textAlign: 'center',
    },
    errorBody: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
      textAlign: 'center',
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
      minWidth: HitTarget.min,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Spacing.md,
    },
    secondaryCtaText: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
      textDecorationLine: 'underline',
    },
    pressed: {
      opacity: Opacity.pressed,
    },
  });
}
