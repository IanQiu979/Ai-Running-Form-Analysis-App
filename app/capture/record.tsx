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
 */
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FramingGuide } from '@/components/framing-guide';
import { KineticText } from '@/components/kinetic-text';
import { CircleIconButton } from '@/components/ui/circle-icon-button';
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
  Motion,
  Opacity,
  Radius,
  Spacing,
  Tracking,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MAX_CLIP_DURATION_MS } from '@/lib/media-caps';
import { classifyPermission, permissionRecoveryAction } from '@/lib/permission-state';
import { measureRecordedClipDurationMs } from '@/lib/recorded-clip-duration';
import { useAnnounce } from '@/lib/use-announce';

// The record button's own geometry — a custom circular control, not a spacing value between UI
// elements, so it's a local constant rather than a `constants/theme.ts` token (same category as
// `components/framing-guide.tsx`'s figure geometry — see that file's header comment). Comfortably
// clears `HitTarget.min` (44).
const RECORD_BUTTON_SIZE = 72;
const RECORD_BUTTON_BORDER_WIDTH = 4;
const RECORD_BUTTON_START_ICON_SIZE = 28;
const RECORD_BUTTON_STOP_ICON_SIZE = 24;

export default function RecordScreen() {
  const router = useRouter();
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = createStyles(colors);

  const [permission, requestPermission] = useCameraPermissions();
  const permissionState = classifyPermission(permission);

  const cameraRef = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [busy, setBusy] = useState(false);
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
    } finally {
      setRecording(false);
      recordingStartRef.current = null;
      recordingStopRef.current = null;
    }
  }

  if (permissionState === 'checking') {
    return (
      <ScreenGradient>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.centered}>
            <ActivityIndicator color={colors.text.primary} />
          </View>
        </SafeAreaView>
      </ScreenGradient>
    );
  }

  if (permissionState === 'undetermined') {
    return (
      <ScreenGradient>
        <SafeAreaView style={styles.safeArea}>
        {/* ScrollView + flexGrow, not a plain flex:1 View (issue #63) — same Dynamic Type
            reflow-not-clip pattern as app/(tabs)/index.tsx: this panel's title/body/two buttons
            could otherwise overflow a small phone at the largest accessibility text sizes with
            no way to reach the second button. */}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.permissionPanel}>
          <KineticText
            accessibilityRole="header"
            staggerMs={Motion.stagger.line}
            style={styles.permissionTitle}>
            {Copy.capture.permission.camera.title}
          </KineticText>
          <Text style={styles.permissionBody}>{Copy.capture.permission.camera.body}</Text>
          <PillButton
            label={Copy.capture.permission.camera.cta}
            disabled={busy}
            onPress={handleSoftAskAllow}
            style={styles.permissionCta}
          />
          <PillButton variant="ghost" label="Back" onPress={() => router.back()} block />
        </ScrollView>
        </SafeAreaView>
      </ScreenGradient>
    );
  }

  if (permissionState === 'denied') {
    return (
      <ScreenGradient>
        <SafeAreaView style={styles.safeArea}>
        {/* Same ScrollView + flexGrow reflow fix as the 'undetermined' panel above (issue #63). */}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.permissionPanel}>
          <KineticText
            accessibilityRole="header"
            staggerMs={Motion.stagger.line}
            style={styles.permissionTitle}>
            {Copy.capture.permission.camera.denied.title}
          </KineticText>
          <Text style={styles.permissionBody}>{Copy.capture.permission.camera.denied.body}</Text>
          <PillButton
            label={Copy.capture.permission.camera.denied.cta}
            disabled={busy}
            onPress={handleDeniedCta}
            style={styles.permissionCta}
          />
          <PillButton
            variant="ghost"
            label={Copy.capture.permission.camera.denied.secondary}
            onPress={() => router.back()}
            block
          />
        </ScrollView>
        </SafeAreaView>
      </ScreenGradient>
    );
  }

  return (
    <View style={styles.cameraContainer}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        mode="video"
        mute
        onCameraReady={() => setCameraReady(true)}
      />
      <FramingGuide />

      <SafeAreaView style={styles.overlaySafeArea} pointerEvents="box-none">
        <View style={styles.topOverlay} pointerEvents="box-none">
          {/* Hidden while actively recording, same convention as most camera apps — the record
              button below is the one control while a clip is in flight; this is the "every
              screen needs an exit" affordance for before/after that. */}
          {!recording && (
            <CircleIconButton accessibilityLabel="Back" onPress={() => router.back()}>
              <MaterialIcons name="arrow-back" size={20} color={colors.text.primary} />
            </CircleIconButton>
          )}
          <Text style={styles.overlayTip}>{Copy.capture.overlay.tip}</Text>
        </View>

        <View style={styles.bottomOverlay}>
          <Text style={styles.mutedNote}>{Copy.capture.overlay.muted}</Text>
          <Text style={styles.recordingCaption} accessibilityLiveRegion="polite">
            {recording ? Copy.capture.recording.timer(Math.floor(elapsedMs / 1000)) : Copy.capture.recording.autoCap}
          </Text>
          <Pressable
            testID="record-button"
            accessibilityRole="button"
            accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
            disabled={!cameraReady}
            onPress={handleRecordPress}
            style={({ pressed }) => [
              styles.recordButton,
              (pressed || !cameraReady) && styles.pressed,
            ]}>
            <View style={recording ? styles.recordButtonStopIcon : styles.recordButtonStartIcon} />
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      // Transparent — `<ScreenGradient>` behind it owns the fill. The camera view below is a
      // different case: it keeps an opaque fill, see `cameraContainer`.
      backgroundColor: 'transparent',
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // `flex` ONLY. Child-layout props (alignItems/justifyContent/...) are ILLEGAL in a
    // ScrollView's `style` and throw at render: "ScrollView child layout must be applied
    // through the contentContainerStyle prop." The readable column is therefore centred by
    // `alignSelf: 'center'` on the contentContainerStyle below, not from here (issue #63).
    scroll: {
      flex: 1,
    },
    permissionPanel: {
      flexGrow: 1,
      width: '100%',
      maxWidth: ContentWidth.readable,
      alignSelf: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
      gap: Spacing.md,
    },
    permissionTitle: {
      fontFamily: FontFamily.display.bold,
      fontSize: FontSize.xxl,
      letterSpacing: Tracking.display,
      lineHeight: FontSize.xxl * LineHeight.display,
      color: colors.text.primary,
    },
    permissionBody: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.md,
      lineHeight: FontSize.md * LineHeight.body,
      // On the wash — `text.primary` only (`Gradient`'s contract, constants/theme.ts).
      color: colors.text.primary,
    },
    permissionCta: {
      marginTop: Spacing.md,
    },
    pressed: {
      opacity: Opacity.pressed,
    },
    cameraContainer: {
      flex: 1,
      // Only ever visible for the brief instant before CameraView (an absolute-fill sibling
      // below) paints its first frame — colors.background, not a hardcoded black, per
      // CLAUDE.md's "theme tokens only" rule.
      backgroundColor: colors.background,
    },
    overlaySafeArea: {
      flex: 1,
      justifyContent: 'space-between',
    },
    topOverlay: {
      alignItems: 'flex-start',
      padding: Spacing.xl,
      gap: Spacing.md,
    },
    overlayTip: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      color: colors.text.primary,
      backgroundColor: colors.surface.base,
      borderColor: colors.hairline,
      borderRadius: Radius.tile,
      borderWidth: StyleSheet.hairlineWidth * 2,
      padding: Spacing.lg,
    },
    bottomOverlay: {
      alignItems: 'center',
      gap: Spacing.sm,
      padding: Spacing.xl,
    },
    mutedNote: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.xs,
      color: colors.text.primary,
      backgroundColor: colors.surface.base,
      borderRadius: Radius.pill,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
    },
    recordingCaption: {
      fontFamily: FontFamily.mono.regular,
      fontSize: FontSize.sm,
      color: colors.text.primary,
      backgroundColor: colors.surface.base,
      borderRadius: Radius.pill,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
    },
    recordButton: {
      width: RECORD_BUTTON_SIZE,
      height: RECORD_BUTTON_SIZE,
      borderRadius: RECORD_BUTTON_SIZE / 2,
      borderWidth: RECORD_BUTTON_BORDER_WIDTH,
      borderColor: Accent.onAccent,
      backgroundColor: Accent.value,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: Spacing.sm,
    },
    recordButtonStartIcon: {
      width: RECORD_BUTTON_START_ICON_SIZE,
      height: RECORD_BUTTON_START_ICON_SIZE,
      borderRadius: RECORD_BUTTON_START_ICON_SIZE / 2,
      backgroundColor: Accent.onAccent,
    },
    recordButtonStopIcon: {
      width: RECORD_BUTTON_STOP_ICON_SIZE,
      height: RECORD_BUTTON_STOP_ICON_SIZE,
      // A small fixed softening, NOT `Radius.card / 2` as before: that expression tracked the card
      // token, so when `Radius.card` went 0 -> 24 this ~20pt stop square would have silently
      // become a circle and stopped reading as "stop" at all.
      borderRadius: Spacing.xs,
      backgroundColor: Accent.onAccent,
    },
  });
}
