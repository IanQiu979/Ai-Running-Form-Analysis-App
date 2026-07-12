/**
 * Screen 6 — Analyzing (issue #80): the wait screen shown while `analyze-form` is in flight.
 *
 * `analyze-form` (issue #44) does not exist yet, so this screen is built and reviewable entirely
 * against `lib/analyze-form.ts`'s injectable seam, currently bound to a mock (see that file's
 * header). Swapping the seam's binding for the real implementation is the only change #44 needs
 * to make here — nothing in this file talks to Supabase or the network directly.
 *
 * STATE MACHINE: owned by `lib/analyzing-machine.ts` (pure, unit-tested there). This file's only
 * jobs are (1) drive that reducer from real events — the `analyzeFormClient.submit()` call, a
 * client-side timeout timer, a Retry tap — and (2) render each phase. Per the issue: the machine
 * is honest about "waiting on a server-side job," not "holding a promise in memory" — a client-
 * side timeout here does not cancel the underlying call (the server settles the analysis and
 * releases/keeps quota regardless of whether this screen is still listening,
 * `docs/architecture.md`'s "Backgrounding recovery" note), and Retry always reuses the SAME
 * `idempotencyKey` rather than minting a new one, so it can never double-run the model or
 * double-burn quota. Recovering an analysis that finished while this screen (or the app) was
 * gone is issue #64's job, not this one's — this screen only has to not get in its way.
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

  // Defensive bail-out: a direct or cold navigation to this route with nothing staged (module
  // state does not survive a process kill, so this is also what a relaunch mid-analysis looks
  // like from here — issue #64's territory, not this screen's). There is no copy-deck string for
  // this case because the real flow should never reach it; back out quietly rather than invent
  // wording the deck doesn't have.
  useEffect(() => {
    if (request) return;
    router.replace('/');
  }, [request, router]);

  // Drives the reducer: fires the submit call for the current attempt, races it against the
  // client-side timeout, and dispatches whichever settles first. Re-runs whenever `state`
  // transitions into a new `waiting` attempt (a fresh mount, or a Retry); the guard below makes
  // every other transition a no-op cleanup.
  useEffect(() => {
    if (state.phase !== 'waiting' || !request) {
      return;
    }
    const attempt = state.attempt;

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
          dispatch({ type: 'failed', attempt });
        }
      })
      .catch(() => {
        // Folded into the same failure copy as a documented error — every analyze-form failure
        // path releases the reservation before returning (docs/architecture.md step 9), so "this
        // one wasn't counted against your quota" holds regardless of *why* the call failed.
        dispatch({ type: 'failed', attempt });
      });

    const timeoutHandle = setTimeout(() => {
      dispatch({ type: 'timedOut', attempt });
    }, ANALYZING_TIMEOUT_MS);

    return () => {
      clearTimeout(timeoutHandle);
    };
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
    router.replace({
      pathname: '/result/[id]',
      params: { id: state.analysisId, justAnalyzed: '1' },
    } as Href);
  }, [state, router]);

  function handleRetry() {
    dispatch({ type: 'retry' });
  }

  function handleCancel() {
    // Copy deck: "returns to Home. Retry/Cancel must never trap the user."
    router.replace('/');
  }

  if (!request) {
    return null;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
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

        {state.phase === 'failed' && (
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
  onRetry: () => void;
  onCancel: () => void;
};

/**
 * Shared chrome for both error states (`analyzing.error.failed.*` / `.timeout.*`) — same
 * calm, non-alarmed treatment app/(tabs)/index.tsx's own quota-error state already uses (plain
 * text.primary/text.secondary, no Semantic.error red): this app's voice is "coach, not scold"
 * even when something went wrong, and `Semantic.error` (constants/theme.ts) is reserved for a
 * true alarm condition, not a "try again, nothing was lost" recoverable state.
 */
function ErrorPanel({ styles, title, body, onRetry, onCancel }: ErrorPanelProps) {
  return (
    <View style={styles.centerBlock}>
      <Text style={styles.errorTitle} accessibilityLiveRegion="polite">
        {title}
      </Text>
      <Text style={styles.errorBody} accessibilityLiveRegion="polite">
        {body}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={Copy.analyzing.error.cta.retry}
        onPress={onRetry}
        style={({ pressed }) => [styles.primaryCta, pressed && styles.pressed]}>
        <Text style={styles.primaryCtaText}>{Copy.analyzing.error.cta.retry}</Text>
      </Pressable>
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
    content: {
      // flexGrow, not flex — matches app/(tabs)/index.tsx: fills the viewport when short, scrolls
      // instead of clipping at the largest Dynamic Type sizes (design brief §7).
      flexGrow: 1,
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
