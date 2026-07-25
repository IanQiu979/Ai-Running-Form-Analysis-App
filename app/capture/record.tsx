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
 * duration — so this screen measures wall-clock elapsed time itself (also what drives the live
 * "{elapsed}s / 15s" counter) and hands that measured value on as the clip's `durationMs`.
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FramingGuide } from '@/components/framing-guide';
import { Copy } from '@/constants/copy';
import {
  Accent,
  Colors,
  ContentWidth,
  ControlHeight,
  FontFamily,
  FontSize,
  HitTarget,
  Opacity,
  Radius,
  Spacing,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MAX_CLIP_DURATION_MS } from '@/lib/media-caps';
import { classifyPermission, permissionRecoveryAction } from '@/lib/permission-state';
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
      camera.stopRecording();
      return;
    }

    setRecording(true);
    setElapsedMs(0);
    recordingStartRef.current = Date.now();
    try {
      const video = await camera.recordAsync({ maxDuration: MAX_CLIP_DURATION_MS / 1000 });
      const durationMs = recordingStartRef.current ? Date.now() - recordingStartRef.current : 0;
      if (video?.uri && durationMs > 0) {
        router.push({
          pathname: '/capture/extracting',
          params: { mediaType: 'video', uri: video.uri, durationMs: String(durationMs) },
        });
      }
    } finally {
      setRecording(false);
      recordingStartRef.current = null;
    }
  }

  if (permissionState === 'checking') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.text.secondary} />
        </View>
      </SafeAreaView>
    );
  }

  if (permissionState === 'undetermined') {
    return (
      <SafeAreaView style={styles.safeArea}>
        {/* ScrollView + flexGrow, not a plain flex:1 View (issue #63) — same Dynamic Type
            reflow-not-clip pattern as app/(tabs)/index.tsx: this panel's title/body/two buttons
            could otherwise overflow a small phone at the largest accessibility text sizes with
            no way to reach the second button. */}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.permissionPanel}>
          <Text style={styles.permissionTitle}>{Copy.capture.permission.camera.title}</Text>
          <Text style={styles.permissionBody}>{Copy.capture.permission.camera.body}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Copy.capture.permission.camera.cta}
            disabled={busy}
            onPress={handleSoftAskAllow}
            style={({ pressed }) => [styles.primaryCta, (pressed || busy) && styles.pressed]}>
            <Text style={styles.primaryCtaText}>{Copy.capture.permission.camera.cta}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.secondaryCta, pressed && styles.pressed]}>
            <Text style={styles.secondaryCtaText}>Back</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (permissionState === 'denied') {
    return (
      <SafeAreaView style={styles.safeArea}>
        {/* Same ScrollView + flexGrow reflow fix as the 'undetermined' panel above (issue #63). */}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.permissionPanel}>
          <Text style={styles.permissionTitle}>{Copy.capture.permission.camera.denied.title}</Text>
          <Text style={styles.permissionBody}>{Copy.capture.permission.camera.denied.body}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Copy.capture.permission.camera.denied.cta}
            disabled={busy}
            onPress={handleDeniedCta}
            style={({ pressed }) => [styles.primaryCta, (pressed || busy) && styles.pressed]}>
            <Text style={styles.primaryCtaText}>{Copy.capture.permission.camera.denied.cta}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Copy.capture.permission.camera.denied.secondary}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.secondaryCta, pressed && styles.pressed]}>
            <Text style={styles.secondaryCtaText}>{Copy.capture.permission.camera.denied.secondary}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={() => router.back()}
              style={({ pressed }) => [styles.backChip, pressed && styles.pressed]}>
              <Text style={styles.backChipText}>Back</Text>
            </Pressable>
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
      backgroundColor: colors.background,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Centers the (width-capped) content within the ScrollView's own viewport — a no-op on any
    // phone, and what keeps a tablet's readable column centered instead of flush-left (issue
    // #63; see ContentWidth's own comment in constants/theme.ts).
    scroll: {
      flex: 1,
      alignItems: 'center',
    },
    permissionPanel: {
      flexGrow: 1,
      width: '100%',
      maxWidth: ContentWidth.readable,
      justifyContent: 'center',
      padding: Spacing.xl,
      gap: Spacing.md,
    },
    permissionTitle: {
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.xl,
      color: colors.text.primary,
    },
    permissionBody: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
    },
    primaryCta: {
      minHeight: ControlHeight.standard,
      borderRadius: Radius.card,
      backgroundColor: Accent.value,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: Spacing.md,
    },
    primaryCtaText: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.md,
      color: Accent.onAccent,
    },
    secondaryCta: {
      minHeight: HitTarget.min,
      alignItems: 'center',
      justifyContent: 'center',
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
      padding: Spacing.xl,
      gap: Spacing.sm,
    },
    backChip: {
      alignSelf: 'flex-start',
      minHeight: HitTarget.min,
      minWidth: HitTarget.min,
      justifyContent: 'center',
      backgroundColor: colors.surface.base,
      borderRadius: Radius.pill,
      paddingHorizontal: Spacing.md,
    },
    backChipText: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      color: colors.text.primary,
    },
    overlayTip: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      color: colors.text.primary,
      backgroundColor: colors.surface.base,
      borderRadius: Radius.card,
      padding: Spacing.md,
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
      borderRadius: Radius.card / 2,
      backgroundColor: Accent.onAccent,
    },
  });
}
