/**
 * Source picker (design brief screen 3, issue #36) — "Add your run": two cards, Upload
 * (library) or Record (in-app). Also hosts:
 *   - the Art. 9 consent gate (`components/consent-gate.tsx`, issue #68) — the copy deck names
 *     this screen as the exact place it intercepts: "gates the Source Picker -> Capture/Upload
 *     handoff" (docs/design/copy-deck.md § Consent). Checked once per screen visit, shown at
 *     most once before whichever card the user tapped actually proceeds.
 *   - the photo-library permission dance (soft-ask -> OS prompt -> denied), since the deck's
 *     `sourcePicker.permission.library.*` keys live on THIS screen, not a separate one.
 *   - `lib/media-caps.ts`'s pre-flight check on whatever the library picker returns (a picked
 *     video, unlike an in-app recording, isn't bounded by `CameraView`'s own `maxDuration`).
 *
 * Camera permission is Capture's (`app/capture/record.tsx`) own concern, not this screen's —
 * tapping Record just navigates there once consent is settled.
 */
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConsentGate } from '@/components/consent-gate';
import { Copy } from '@/constants/copy';
import {
  Accent,
  Colors,
  ControlHeight,
  FontFamily,
  FontSize,
  HitTarget,
  Opacity,
  Radius,
  Semantic,
  Spacing,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { hasConsented, UPLOAD_HEALTH_CONSENT } from '@/lib/consent';
import { readFileSizeBytes } from '@/lib/media-file-size';
import { checkMediaCaps } from '@/lib/media-caps';
import { classifyPermission, permissionRecoveryAction } from '@/lib/permission-state';

type ConsentState = 'checking' | 'needed' | 'granted';
type PendingAction = 'record' | 'upload' | null;
type LibraryFlow = 'idle' | 'softAsk';
type InlineError = { title: string; body: string };

export default function SourcePickerScreen() {
  const router = useRouter();
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = createStyles(colors);

  const [libraryPermission, requestLibraryPermission] = ImagePicker.useMediaLibraryPermissions();
  const libraryState = classifyPermission(libraryPermission);

  const [consentState, setConsentState] = useState<ConsentState>('checking');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [libraryFlow, setLibraryFlow] = useState<LibraryFlow>('idle');
  const [uploadError, setUploadError] = useState<InlineError | null>(null);
  // Guards double-taps while a native permission dialog / picker sheet is in flight — both are
  // modal and async, and this screen stays mounted underneath them.
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hasConsented(UPLOAD_HEALTH_CONSENT)
      .then((granted) => {
        if (!cancelled) setConsentState(granted ? 'granted' : 'needed');
      })
      .catch(() => {
        // Fail closed (lib/consent.ts's own contract): treat "couldn't confirm" the same as
        // "not yet consented" and show the gate again. Safe either way — re-granting an
        // already-granted consent just appends another true row; it never skips the check.
        if (!cancelled) setConsentState('needed');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function goToRecord() {
    router.push('/capture/record');
  }

  async function launchLibraryPicker() {
    setBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 1,
      });
      if (result.canceled || result.assets.length === 0) return;
      await handlePickedAsset(result.assets[0]);
    } finally {
      setBusy(false);
    }
  }

  async function handlePickedAsset(asset: ImagePicker.ImagePickerAsset) {
    const isVideo = asset.type === 'video' || (!asset.type && !!asset.mimeType?.startsWith('video/'));
    const fileSizeBytes = asset.fileSize ?? readFileSizeBytes(asset.uri);

    if (isVideo) {
      const durationMs = asset.duration ?? null;
      if (!durationMs || durationMs <= 0) {
        setUploadError(Copy.upload.error.extractionFailed);
        return;
      }
      const violation = checkMediaCaps({ durationMs, fileSizeBytes });
      if (violation === 'clipTooLong') {
        setUploadError(Copy.sourcePicker.error.clipTooLong);
        return;
      }
      if (violation === 'fileTooLarge') {
        setUploadError(Copy.sourcePicker.error.fileTooLarge);
        return;
      }
      router.push({
        pathname: '/capture/extracting',
        params: { mediaType: 'video', uri: asset.uri, durationMs: String(durationMs) },
      });
      return;
    }

    if (!asset.width || !asset.height) {
      setUploadError(Copy.upload.error.extractionFailed);
      return;
    }
    if (checkMediaCaps({ fileSizeBytes }) === 'fileTooLarge') {
      setUploadError(Copy.sourcePicker.error.fileTooLarge);
      return;
    }
    router.push({
      pathname: '/capture/extracting',
      params: { mediaType: 'photo', uri: asset.uri, width: String(asset.width), height: String(asset.height) },
    });
  }

  async function beginUploadFlow() {
    setUploadError(null);
    if (libraryState === 'granted') {
      await launchLibraryPicker();
      return;
    }
    if (libraryState === 'undetermined') {
      setLibraryFlow('softAsk');
      return;
    }
    // 'denied' renders its panel from libraryState directly; 'checking' is a brief race the
    // hook resolves on its own re-render — nothing to do here either way.
  }

  function handleCardPress(action: 'record' | 'upload') {
    setUploadError(null);
    if (consentState !== 'granted') {
      setPendingAction(action);
      return;
    }
    if (action === 'record') {
      goToRecord();
    } else {
      void beginUploadFlow();
    }
  }

  function handleConsented() {
    const action = pendingAction;
    setPendingAction(null);
    setConsentState('granted');
    if (action === 'record') {
      goToRecord();
    } else if (action === 'upload') {
      void beginUploadFlow();
    }
  }

  async function handleSoftAskAllow() {
    setBusy(true);
    const result = await requestLibraryPermission();
    setBusy(false);
    setLibraryFlow('idle');
    if (result.granted) {
      await launchLibraryPicker();
    }
    // Denied: libraryState flips to 'denied' on the next render (the hook updates its own
    // state) and the denied panel below takes over — no separate branch needed here.
  }

  async function handleDeniedCta() {
    if (permissionRecoveryAction(libraryPermission) === 'request') {
      setBusy(true);
      const result = await requestLibraryPermission();
      setBusy(false);
      if (result.granted) await launchLibraryPicker();
    } else {
      await Linking.openSettings();
    }
  }

  // Also gates on consentState === 'checking': tapping a card before the initial consent read
  // resolves would show the ConsentGate to an already-consented returning user (a harmless but
  // annoying re-ask, not an unsafe skip — see the consent effect's fail-closed comment above),
  // purely because of a race with this screen's own fetch. Disabling briefly is simpler and
  // more honest than either racing it or re-asking needlessly.
  const cardsDisabled = busy || consentState === 'checking';

  if (pendingAction !== null) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.consentWrap}>
          <ConsentGate onConsented={handleConsented} onCancel={() => setPendingAction(null)} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.header}>{Copy.sourcePicker.title}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
        </View>

        <Pressable
          testID="source-card-upload"
          accessibilityRole="button"
          accessibilityLabel={`${Copy.sourcePicker.card.upload.title}. ${Copy.sourcePicker.card.upload.subtitle}`}
          disabled={cardsDisabled}
          onPress={() => handleCardPress('upload')}
          style={({ pressed }) => [styles.card, (pressed || cardsDisabled) && styles.pressed]}>
          <Text style={styles.cardTitle}>{Copy.sourcePicker.card.upload.title}</Text>
          <Text style={styles.cardSubtitle}>{Copy.sourcePicker.card.upload.subtitle}</Text>
        </Pressable>

        {libraryState === 'denied' && libraryFlow === 'idle' && (
          <InlinePanel
            colors={colors}
            scheme={scheme}
            title={Copy.sourcePicker.permission.library.denied.title}
            body={Copy.sourcePicker.permission.library.denied.body}
            primaryCta={Copy.sourcePicker.permission.library.denied.cta}
            onPrimary={handleDeniedCta}
            secondaryCta={Copy.sourcePicker.permission.library.denied.secondary}
            onSecondary={goToRecord}
            busy={busy}
          />
        )}

        {libraryFlow === 'softAsk' && (
          <InlinePanel
            colors={colors}
            scheme={scheme}
            title={Copy.sourcePicker.permission.library.title}
            body={Copy.sourcePicker.permission.library.body}
            primaryCta={Copy.sourcePicker.permission.library.cta}
            onPrimary={handleSoftAskAllow}
            busy={busy}
          />
        )}

        {uploadError && (
          <InlinePanel colors={colors} scheme={scheme} title={uploadError.title} body={uploadError.body} error />
        )}

        <Pressable
          testID="source-card-record"
          accessibilityRole="button"
          accessibilityLabel={`${Copy.sourcePicker.card.record.title}. ${Copy.sourcePicker.card.record.subtitle}`}
          disabled={cardsDisabled}
          onPress={() => handleCardPress('record')}
          style={({ pressed }) => [styles.card, (pressed || cardsDisabled) && styles.pressed]}>
          <Text style={styles.cardTitle}>{Copy.sourcePicker.card.record.title}</Text>
          <Text style={styles.cardSubtitle}>{Copy.sourcePicker.card.record.subtitle}</Text>
        </Pressable>

        <Text style={styles.framingTip}>{Copy.sourcePicker.framingTip}</Text>

        {cardsDisabled && <ActivityIndicator color={colors.text.secondary} accessibilityLabel="Loading" />}
      </ScrollView>
    </SafeAreaView>
  );
}

/** One reusable inline panel for every non-error and error state this screen shows below the
 * cards (soft-ask, denied, upload validation error) — same shape, different copy/actions, kept
 * local since nothing outside this screen needs it. */
function InlinePanel({
  colors,
  scheme,
  title,
  body,
  primaryCta,
  onPrimary,
  secondaryCta,
  onSecondary,
  busy,
  error,
}: {
  colors: ThemeColors;
  scheme: ColorScheme;
  title: string;
  body: string;
  primaryCta?: string;
  onPrimary?: () => void;
  secondaryCta?: string;
  onSecondary?: () => void;
  busy?: boolean;
  error?: boolean;
}) {
  const styles = createPanelStyles(colors, scheme);
  return (
    <View style={styles.panel} accessibilityLiveRegion="polite">
      <Text style={[styles.panelTitle, error && styles.panelTitleError]}>{title}</Text>
      <Text style={styles.panelBody}>{body}</Text>
      {primaryCta && onPrimary && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={primaryCta}
          disabled={busy}
          onPress={onPrimary}
          style={({ pressed }) => [styles.panelPrimaryCta, (pressed || busy) && { opacity: Opacity.pressed }]}>
          <Text style={styles.panelPrimaryCtaText}>{primaryCta}</Text>
        </Pressable>
      )}
      {secondaryCta && onSecondary && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={secondaryCta}
          onPress={onSecondary}
          style={({ pressed }) => [styles.panelSecondaryCta, pressed && { opacity: Opacity.pressed }]}>
          <Text style={styles.panelSecondaryCtaText}>{secondaryCta}</Text>
        </Pressable>
      )}
    </View>
  );
}

function createPanelStyles(colors: ThemeColors, scheme: ColorScheme) {
  return StyleSheet.create({
    panel: {
      backgroundColor: colors.surface.base,
      borderRadius: Radius.sheet,
      padding: Spacing.lg,
      gap: Spacing.sm,
    },
    panelTitle: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.md,
      color: colors.text.primary,
    },
    panelTitleError: {
      color: Semantic.error[scheme],
    },
    panelBody: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
    },
    panelPrimaryCta: {
      minHeight: ControlHeight.standard,
      borderRadius: Radius.card,
      backgroundColor: Accent.value,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: Spacing.xs,
    },
    panelPrimaryCtaText: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.sm,
      color: Accent.onAccent,
    },
    panelSecondaryCta: {
      minHeight: HitTarget.min,
      alignItems: 'center',
      justifyContent: 'center',
    },
    panelSecondaryCtaText: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
      textDecorationLine: 'underline',
    },
  });
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    consentWrap: {
      flex: 1,
      justifyContent: 'center',
      padding: Spacing.lg,
    },
    content: {
      flexGrow: 1,
      padding: Spacing.xl,
      gap: Spacing.lg,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    header: {
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.xl,
      color: colors.text.primary,
    },
    backButton: {
      minHeight: HitTarget.min,
      minWidth: HitTarget.min,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backText: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
      textDecorationLine: 'underline',
    },
    // "Large cards" (brief §4.3) — generous padding rather than a fixed minHeight, so size comes
    // from Spacing tokens + content instead of an invented pixel number.
    card: {
      borderRadius: Radius.sheet,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.hairline,
      backgroundColor: colors.surface.base,
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.xxl,
      justifyContent: 'center',
      gap: Spacing.xs,
    },
    cardTitle: {
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.lg,
      color: colors.text.primary,
    },
    cardSubtitle: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
    },
    framingTip: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.xs,
      color: colors.text.secondary,
      textAlign: 'center',
    },
    pressed: {
      opacity: Opacity.pressed,
    },
  });
}
