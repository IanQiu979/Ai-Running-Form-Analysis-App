/**
 * Capture (design brief screen 4, issue #36) — "Record your run": the in-app camera, muted by
 * design (`app.json`'s `expo-camera` plugin already sets `microphonePermission: false` and
 * `recordAudioAndroid: false` — this screen must not regress that), with the side-on framing
 * guide overlay (`components/framing-guide.tsx`) and the camera permission dance (soft-ask -> OS
 * prompt -> denied). Owns `capture.permission.camera.*` per the copy deck.
 *
 * Recording auto-caps at `MAX_CLIP_DURATION_MS` (`lib/media-caps.ts`) via `CameraView`'s own
 * `maxDuration` — the clip physically cannot exceed the cap, unlike a library pick (that's
 * `app/capture/index.tsx`'s job to check). `recordAsync` resolves with only `{ uri }` — no
 * duration — so this screen measures the clip itself (the same stamps drive the live
 * "{elapsed}s / 15s" counter) and hands the measured value on as `durationMs`.
 *
 * THAT MEASUREMENT IS NOT A PLAIN WALL-CLOCK SPAN, and reverting it to one re-breaks two things.
 * The stop time is stamped where `stopRecording()` is called, NOT where `recordAsync` resolves —
 * that promise settles after the movie file is finalized, which is not part of the clip — and
 * `lib/recorded-clip-duration.ts` clamps the result to the recorder's own `maxDuration` guarantee.
 * Without both, a full-length recording measured >15000ms and `app/capture/extracting.tsx`'s
 * pre-flight `checkMediaCaps` rejected it as `clipTooLong` (the app refusing a clip it had capped
 * itself), and `lib/frames.ts`'s `sampleTimestamps` spread its samples across a window running
 * past the real last frame, so the late samples came back as duplicates of the final still instead
 * of showing motion. See that file's header for the full derivation and for the head-end error it
 * honestly does NOT close.
 *
 * VISUALLY (V23-10, third artboard): the viewfinder fills the screen with the page's SVG guide
 * over it; the top row ("RECORD YOUR RUN" beside a bled Back control) sits at the safe top, the
 * mono timer 17 pt under it, and at the safe bottom one footnote line ("Side-on, full body, good
 * light. Muted.") above a 72 pt `ink`-ruled square holding a 28 pt square — `danger` while
 * recording (the page's stop state), `ink` when idle (not drawn on the page). No scrims, no
 * ring: the page draws its text straight on the preview.
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FramingGuide } from '@/components/framing-guide';
import { SquareButton } from '@/components/ui/square-button';
import { SquareCard } from '@/components/ui/square-card';
import { SquareIconButton } from '@/components/ui/square-icon-button';
import { TopBar } from '@/components/ui/top-bar';
import { BackIcon } from '@/components/ui/v23-icons';
import { Copy } from '@/constants/copy';
import { Ink, Layout, Space, Type } from '@/constants/v23-theme';
import { MAX_CLIP_DURATION_MS } from '@/lib/media-caps';
import { classifyPermission, permissionRecoveryAction } from '@/lib/permission-state';
import { measureRecordedClipDurationMs } from '@/lib/recorded-clip-duration';
import { isSimulatorNotSupportedError } from '@/lib/simulator-recording-error';
import { useAnnounce } from '@/lib/use-announce';

type RecordingErrorKind = 'simulatorUnsupported' | 'recordingFailed';

/** The page puts the timer at `top:120px` — 59 (safe top) + 44 (the top row) + this. */
const TIMER_GAP = 17;
/** A press is a plain opacity dip, the same one `<SquareButton>` uses. */
const PRESSED_OPACITY = 0.6;

export default function RecordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const safeTop = Math.max(insets.top, Layout.canvas.safeTop);
  const safeBottom = Math.max(insets.bottom, Layout.canvas.safeBottom);

  const [permission, requestPermission] = useCameraPermissions();
  const permissionState = classifyPermission(permission);

  const cameraRef = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [recordingError, setRecordingError] = useState<RecordingErrorKind | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  // Stamped where `stopRecording()` is called, and read back after `recordAsync` resolves — the
  // two happen in different invocations of `handleRecordPress`, which is why this is a ref and not
  // a local. Stays null when the recorder auto-stops at `maxDuration` (nothing in this screen
  // calls `stopRecording()` on that path), and the read below falls back to `Date.now()`, whose
  // overshoot the clamp in `measureRecordedClipDurationMs` then absorbs.
  const recordingStopRef = useRef<number | null>(null);
  // Issue #11: `accessibilityLiveRegion="polite"` on the recording caption below is Android-only —
  // this is the iOS complement, but deliberately keyed to the recording/idle TRANSITION rather
  // than the per-second "Ns / 15s" text change: a live region firing every second for the whole
  // clip would fight VoiceOver's own speech queue instead of helping it. One announcement when
  // recording starts, naming the same auto-stop bound the idle caption already shows.
  useAnnounce(recording ? `Recording. ${Copy.capture.recording.autoCap}` : null);

  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => {
      if (recordingStartRef.current !== null) {
        setElapsedMs(Date.now() - recordingStartRef.current);
      }
    }, 200);
    return () => clearInterval(interval);
  }, [recording]);

  async function handleSoftAskAllow() {
    setBusy(true);
    await requestPermission();
    setBusy(false);
  }

  async function handleDeniedCta() {
    if (permissionRecoveryAction(permission) === 'request') {
      setBusy(true);
      await requestPermission();
      setBusy(false);
    } else {
      await Linking.openSettings();
    }
  }

  function leaveForUpload() {
    setRecordingError(null);
    if (router.canGoBack()) router.back();
    else router.replace('/capture');
  }

  async function handleRecordPress() {
    const camera = cameraRef.current;
    if (!camera || !cameraReady || busy) return;

    if (recording) {
      // Stamped BEFORE the native call, so the measured clip ends where the user asked it to
      // rather than where the movie file finished being written (see this file's header).
      recordingStopRef.current = Date.now();
      camera.stopRecording();
      return;
    }

    setRecording(true);
    setElapsedMs(0);
    recordingStartRef.current = Date.now();
    recordingStopRef.current = null;
    try {
      const video = await camera.recordAsync({ maxDuration: MAX_CLIP_DURATION_MS / 1000 });
      const startedAtMs = recordingStartRef.current;
      const durationMs =
        startedAtMs === null
          ? 0
          : measureRecordedClipDurationMs(startedAtMs, recordingStopRef.current ?? Date.now());
      if (video?.uri && durationMs > 0) {
        router.push({
          pathname: '/capture/extracting',
          params: { mediaType: 'video', uri: video.uri, durationMs: String(durationMs) },
        });
      }
    } catch (error) {
      // Issue #232: `recordAsync` rejects with a native `SimulatorNotSupported` error on the iOS
      // Simulator (no camera hardware) — this used to reach the LogBox as an uncaught promise.
      // Every rejection is caught and shown through the same dialog; nothing here is ever left
      // uncaught.
      setRecordingError(isSimulatorNotSupportedError(error) ? 'simulatorUnsupported' : 'recordingFailed');
    } finally {
      setRecording(false);
      recordingStartRef.current = null;
      recordingStopRef.current = null;
    }
  }

  if (permissionState === 'checking') {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={Ink.ink2} />
      </View>
    );
  }

  if (permissionState === 'undetermined') {
    return (
      <View style={styles.screen}>
        {/* ScrollView + flexGrow, not a plain flex:1 View (issue #63) — the Dynamic Type
            reflow-not-clip pattern: this panel's title/body/two buttons could otherwise overflow
            a small phone at the largest accessibility text sizes with no way to reach the second
            button. The page does not draw the permission panels; this is the source picker's
            panel idiom at the large card padding. */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.permissionScroll, { paddingTop: safeTop, paddingBottom: safeBottom }]}>
          <SquareCard padding={Layout.cardPaddingLg} style={styles.permissionPanel}>
            <Text accessibilityRole="header" style={styles.permissionTitle}>
              {Copy.capture.permission.camera.title}
            </Text>
            <Text style={styles.permissionBody}>{Copy.capture.permission.camera.body}</Text>
            <SquareButton
              label={Copy.capture.permission.camera.cta}
              disabled={busy}
              onPress={handleSoftAskAllow}
              style={styles.permissionCta}
            />
            <SquareButton variant="link" label="Back" onPress={() => router.back()} />
          </SquareCard>
        </ScrollView>
      </View>
    );
  }

  if (permissionState === 'denied') {
    return (
      <View style={styles.screen}>
        {/* Same ScrollView + flexGrow reflow fix as the 'undetermined' panel above (issue #63). */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.permissionScroll, { paddingTop: safeTop, paddingBottom: safeBottom }]}>
          <SquareCard padding={Layout.cardPaddingLg} style={styles.permissionPanel}>
            <Text accessibilityRole="header" style={styles.permissionTitle}>
              {Copy.capture.permission.camera.denied.title}
            </Text>
            <Text style={styles.permissionBody}>{Copy.capture.permission.camera.denied.body}</Text>
            <SquareButton
              label={Copy.capture.permission.camera.denied.cta}
              disabled={busy}
              onPress={handleDeniedCta}
              style={styles.permissionCta}
            />
            <SquareButton
              variant="link"
              label={Copy.capture.permission.camera.denied.secondary}
              onPress={() => router.back()}
            />
          </SquareCard>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        mode="video"
        mute
        onCameraReady={() => setCameraReady(true)}
      />
      <FramingGuide />

      {/* The back control is hidden while actively recording, same convention as most camera
          apps — the record button below is the one control while a clip is in flight, and the
          back button is the "every screen needs an exit" affordance for before/after that. The
          top bar keeps its 44 pt spacer in the control's place so the title does not move. */}
      <View style={[styles.topOverlay, { top: safeTop }]} pointerEvents="box-none">
        <TopBar
          title={Copy.capture.title}
          leading={
            recording ? undefined : (
              <SquareIconButton accessibilityLabel="Back" bleed="left" onPress={() => router.back()}>
                <BackIcon />
              </SquareIconButton>
            )
          }
        />
      </View>

      <Text
        style={[styles.timer, { top: safeTop + Layout.topBarHeight + TIMER_GAP }]}
        accessibilityLiveRegion="polite">
        {recording ? Copy.capture.recording.timer(Math.floor(elapsedMs / 1000)) : Copy.capture.recording.autoCap}
      </Text>

      <View style={[styles.bottomOverlay, { bottom: safeBottom }]} pointerEvents="box-none">
        {/* One line: the framing tip and the muted note, joined. The tip has nothing left to tell
            a runner who is already mid-clip, so it drops out while recording; the note stays. */}
        <Text style={styles.overlayLine}>
          {recording ? Copy.capture.overlay.muted : `${Copy.capture.overlay.tip} ${Copy.capture.overlay.muted}`}
        </Text>
        <Pressable
          testID="record-button"
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
          disabled={!cameraReady}
          onPress={handleRecordPress}
          style={({ pressed }) => [styles.recordButton, (pressed || !cameraReady) && styles.pressed]}>
          <View style={[styles.recordMark, recording ? styles.recordMarkStop : styles.recordMarkIdle]} />
        </Pressable>
      </View>

      <ConfirmDialog
        testID="recording-error-dialog"
        visible={recordingError !== null}
        title={
          recordingError === 'simulatorUnsupported'
            ? Copy.capture.recordingError.simulatorUnsupported.title
            : Copy.capture.recordingError.recordingFailed.title
        }
        body={
          recordingError === 'simulatorUnsupported'
            ? Copy.capture.recordingError.simulatorUnsupported.body
            : Copy.capture.recordingError.recordingFailed.body
        }
        primary={
          recordingError === 'simulatorUnsupported'
            ? { label: Copy.capture.recordingError.simulatorUnsupported.cta, onPress: leaveForUpload }
            : {
                label: Copy.capture.recordingError.recordingFailed.cta,
                onPress: () => setRecordingError(null),
              }
        }
        secondary={
          recordingError === 'recordingFailed'
            ? { label: Copy.capture.recordingError.recordingFailed.secondary, onPress: leaveForUpload }
            : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Painted `Ink.bg` — under the permission panels it is the page, and under the camera it is
  // only ever visible for the instant before `CameraView` (an absolute-fill sibling) paints.
  screen: {
    flex: 1,
    backgroundColor: Ink.bg,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // `flex` ONLY. Child-layout props (alignItems/justifyContent/...) are ILLEGAL in a
  // ScrollView's `style` and throw at render (issue #63); the centring lives on the
  // contentContainerStyle below.
  scroll: {
    flex: 1,
  },
  permissionScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Layout.gutter,
  },
  permissionPanel: {
    gap: Space.md,
  },
  permissionTitle: {
    ...Type.h2,
    color: Ink.ink,
  },
  permissionBody: {
    ...Type.body,
    color: Ink.ink2,
  },
  permissionCta: {
    marginTop: Space.md,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  // The page's `top:59px; left:24px; right:24px` row over the preview.
  topOverlay: {
    position: 'absolute',
    left: Layout.gutter,
    right: Layout.gutter,
  },
  timer: {
    ...Type.mono,
    color: Ink.ink,
    textAlign: 'center',
    position: 'absolute',
    left: 0,
    right: 0,
  },
  // The page's `left:0; right:0; bottom:34px` column: the line, then the control, 16 pt apart.
  bottomOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: Space.lg,
  },
  overlayLine: {
    ...Type.footnote,
    color: Ink.ink,
    textAlign: 'center',
    paddingHorizontal: Layout.gutter,
  },
  recordButton: {
    width: Layout.recordButton.size,
    height: Layout.recordButton.size,
    borderWidth: Layout.recordButton.border,
    borderColor: Ink.ink,
    borderRadius: Layout.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordMark: {
    width: Layout.recordButton.stop,
    height: Layout.recordButton.stop,
  },
  recordMarkIdle: {
    backgroundColor: Ink.ink,
  },
  recordMarkStop: {
    backgroundColor: Ink.danger,
  },
});
