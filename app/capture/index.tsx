/**
 * Source picker (design brief screen 3, issue #36) — "Add your run": two cards, Upload
 * (library) or Record (in-app). Also hosts:
 *   - the photo-library permission dance (soft-ask -> OS prompt -> denied), since the deck's
 *     `sourcePicker.permission.library.*` keys live on THIS screen, not a separate one.
 *   - `lib/media-caps.ts`'s pre-flight check on whatever the library picker returns (a picked
 *     video, unlike an in-app recording, isn't bounded by `CameraView`'s own `maxDuration`).
 *
 * Camera permission is Capture's (`app/capture/record.tsx`) own concern, not this screen's —
 * tapping Record just navigates there directly.
 *
 * VISUALLY (V23-10, first artboard): the page's top row ("ADD FOOTAGE" between a bled Back
 * control and a 44 pt spacer), then two `SquareCard`s at the 24 pt card padding — a 56 pt
 * `line`-ruled badge holding the page's glyph beside an H1 title and a `note` subtitle — and the
 * framing tip centred beneath. The permission and error panels are not drawn on the page; they
 * are the same card with a semibold title, a `note` body and the two button variants.
 */
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import * as ImagePicker from 'expo-image-picker';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SquareButton } from '@/components/ui/square-button';
import { SquareCard } from '@/components/ui/square-card';
import { SquareIconButton } from '@/components/ui/square-icon-button';
import { TopBar } from '@/components/ui/top-bar';
import { BackIcon, RecordIcon, UploadIcon } from '@/components/ui/v23-icons';
import { Copy } from '@/constants/copy';
import { Font, Ink, Layout, Space, Type } from '@/constants/v23-theme';
import { FUTURE_UPLOADS_ATTESTATION_CONSENT, grantConsent, readConsentState, UPLOAD_HEALTH_CONSENT } from '@/lib/consent';
import { readFileSizeBytes } from '@/lib/media-file-size';
import { checkMediaCaps } from '@/lib/media-caps';
import { classifyPermission, permissionRecoveryAction } from '@/lib/permission-state';
import { useAnnounce } from '@/lib/use-announce';

/**
 * Best-effort self-heal, not a gate (there is no consent gate at capture — see
 * `components/age-band-gate.tsx` and `app/(auth)/sign-in.tsx` for where consent is actually
 * granted). Email/Google sign-up grants `UPLOAD_HEALTH_CONSENT` and
 * `FUTURE_UPLOADS_ATTESTATION_CONSENT` fire-and-forget; if that grant silently failed, the account
 * is left with no consent row and every `analyze-form` call 403s with no way back in. Checking
 * here, right before the two actions that lead to an upload, catches that case cheaply — the check
 * always runs, but the extra grant round trip only happens when there is genuinely NO row for the
 * key. A `withdrawn` state (newest row is `granted = false`) is the user's own explicit act in
 * Settings and is never repaired here — the caller shows the way back to Settings instead, and
 * the server's `consent_required` refusal stands. A read or grant failure is not fatal:
 * `analyze-form`'s own server-side gate still enforces this and fails closed if the repair could
 * not complete.
 */
async function ensureConsentGranted(): Promise<'proceed' | 'withdrawn'> {
  try {
    const state = await readConsentState(UPLOAD_HEALTH_CONSENT);
    if (state === 'withdrawn') return 'withdrawn';
    if (state === 'none') {
      await Promise.all([
        grantConsent(UPLOAD_HEALTH_CONSENT),
        grantConsent(FUTURE_UPLOADS_ATTESTATION_CONSENT),
      ]);
    }
  } catch {
    // Proceed regardless — see the function doc above.
  }
  return 'proceed';
}

const PRESSED_OPACITY = 0.6;

type LibraryFlow = 'idle' | 'softAsk';
type InlineError = { title: string; body: string; cta?: string };

export default function SourcePickerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [libraryPermission, requestLibraryPermission] = ImagePicker.useMediaLibraryPermissions();
  const libraryState = classifyPermission(libraryPermission);

  const [libraryFlow, setLibraryFlow] = useState<LibraryFlow>('idle');
  const [uploadError, setUploadError] = useState<InlineError | null>(null);
  // Guards double-taps while a native permission dialog / picker sheet is in flight — both are
  // modal and async, and this screen stays mounted underneath them.
  const [busy, setBusy] = useState(false);

  function goToRecord() {
    router.push('/capture/record');
  }

  /** Runs the consent check under the same `busy` guard the native pickers use, so a second tap
   *  during the round trip cannot fire the navigation or the picker twice. Resolves false when the
   *  consent was withdrawn, after showing the panel that points at Settings. */
  async function checkConsentBeforeCapture(): Promise<boolean> {
    setUploadError(null);
    setBusy(true);
    try {
      if ((await ensureConsentGranted()) === 'withdrawn') {
        setUploadError(Copy.sourcePicker.error.consentWithdrawn);
        return false;
      }
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function handleRecordPress() {
    if (busy) return;
    if (await checkConsentBeforeCapture()) goToRecord();
  }

  async function handleUploadPress() {
    if (busy) return;
    if (await checkConsentBeforeCapture()) await beginUploadFlow();
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

  const cardsDisabled = busy;

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top, Layout.canvas.safeTop),
            paddingBottom: Math.max(insets.bottom, Layout.canvas.safeBottom),
          },
        ]}>
        <View style={styles.topBarWrap}>
          <TopBar
            title={Copy.sourcePicker.title}
            leading={
              <SquareIconButton
                accessibilityLabel="Back"
                bleed="left"
                testID="capture-back"
                onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}>
                <BackIcon />
              </SquareIconButton>
            }
          />
        </View>

        <View style={styles.body}>
          <SourceCard
            testID="source-card-upload"
            icon={<UploadIcon />}
            title={Copy.sourcePicker.card.upload.title}
            subtitle={Copy.sourcePicker.card.upload.subtitle}
            disabled={cardsDisabled}
            onPress={() => {
              void handleUploadPress();
            }}
          />

          {libraryState === 'denied' && libraryFlow === 'idle' && (
            <InlinePanel
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
              title={Copy.sourcePicker.permission.library.title}
              body={Copy.sourcePicker.permission.library.body}
              primaryCta={Copy.sourcePicker.permission.library.cta}
              onPrimary={handleSoftAskAllow}
              busy={busy}
            />
          )}

          {uploadError && (
            <InlinePanel
              title={uploadError.title}
              body={uploadError.body}
              primaryCta={uploadError.cta}
              onPrimary={uploadError.cta ? () => router.push('/settings') : undefined}
              error
            />
          )}

          <SourceCard
            testID="source-card-record"
            icon={<RecordIcon />}
            title={Copy.sourcePicker.card.record.title}
            subtitle={Copy.sourcePicker.card.record.subtitle}
            disabled={cardsDisabled}
            onPress={() => {
              void handleRecordPress();
            }}
          />

          <Text style={styles.framingTip}>{Copy.sourcePicker.framingTip}</Text>

          {/* The page draws no busy state; the quiet platform spinner stands in while a native
              permission dialog or picker sheet is in flight, labelled for the a11y tree since the
              indicator itself has nothing to say. */}
          {cardsDisabled && (
            <View accessible accessibilityLabel="Loading" style={styles.loading}>
              <ActivityIndicator color={Ink.ink2} />
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * One of the two source cards (V23-10): a `SquareCard` at the large card padding, laid out as a
 * row — the 56 pt `line`-ruled badge holding the page's glyph, then the title and subtitle column.
 * Extracted local to this screen (same idiom as `InlinePanel` below) so the pair cannot drift
 * apart. The `Pressable` wraps the card so its `testID`, role, composed label and disabled state
 * live on the control and the whole card area is the target.
 */
function SourceCard({
  testID,
  icon,
  title,
  subtitle,
  disabled,
  onPress,
}: {
  testID: string;
  icon: ReactNode;
  title: string;
  subtitle: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [(pressed || disabled) && styles.pressed]}>
      <SquareCard padding={Layout.cardPaddingLg} style={styles.card}>
        <View style={styles.badge}>{icon}</View>
        <View style={styles.cardText}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardSubtitle}>{subtitle}</Text>
        </View>
      </SquareCard>
    </Pressable>
  );
}

/** One reusable inline panel for every non-error and error state this screen shows below the
 * cards (soft-ask, denied, upload validation error) — same shape, different copy/actions, kept
 * local since nothing outside this screen needs it. Not drawn on the page: the same card, in
 * the quietest faithful form. */
function InlinePanel({
  title,
  body,
  primaryCta,
  onPrimary,
  secondaryCta,
  onSecondary,
  busy,
  error,
}: {
  title: string;
  body: string;
  primaryCta?: string;
  onPrimary?: () => void;
  secondaryCta?: string;
  onSecondary?: () => void;
  busy?: boolean;
  error?: boolean;
}) {
  // Issue #11: `accessibilityLiveRegion="polite"` on the panel below is Android-only — this is
  // the iOS complement, same pattern as app/(auth)/sign-in.tsx. `InlinePanel` is only ever
  // mounted while it has something to say (soft-ask / denied / upload-error), so this fires once
  // per presentation, on mount.
  useAnnounce(`${title} ${body}`);

  return (
    <SquareCard accessibilityLiveRegion="polite" style={styles.panel}>
      <Text style={[styles.panelTitle, error && styles.panelTitleError]}>{title}</Text>
      <Text style={styles.panelBody}>{body}</Text>
      {primaryCta && onPrimary && (
        <SquareButton label={primaryCta} onPress={onPrimary} disabled={busy} style={styles.panelPrimaryCta} />
      )}
      {secondaryCta && onSecondary && <SquareButton variant="link" label={secondaryCta} onPress={onSecondary} />}
    </SquareCard>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Ink.bg,
  },
  // `flex` ONLY. Child-layout props (alignItems/justifyContent/...) are ILLEGAL in a
  // ScrollView's `style` and throw at render: "ScrollView child layout must be applied
  // through the contentContainerStyle prop." (issue #63).
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  topBarWrap: {
    paddingHorizontal: Layout.gutter,
  },
  // The page's `padding:24px; gap:16px` column under the top row.
  body: {
    padding: Layout.gutter,
    gap: Space.lg,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
  },
  badge: {
    width: Layout.sourceBadge,
    height: Layout.sourceBadge,
    borderWidth: Layout.hairline,
    borderColor: Ink.line,
    borderRadius: Layout.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Flexes so a long subtitle wraps inside the column instead of pushing the badge off the card,
  // and so Dynamic Type grows the block downward rather than sideways.
  cardText: {
    flex: 1,
    gap: Space.xs,
  },
  cardTitle: {
    ...Type.h1,
    color: Ink.ink,
  },
  cardSubtitle: {
    ...Type.note,
    color: Ink.ink2,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  framingTip: {
    ...Type.footnote,
    color: Ink.ink,
    textAlign: 'center',
    marginTop: Space.sm,
  },
  loading: {
    alignItems: 'center',
  },
  panel: {
    gap: Space.sm,
  },
  // The page has no panel title role; Body at the semibold weight is the quietest heading the
  // sheet's two families allow.
  panelTitle: {
    ...Type.body,
    fontFamily: Font.tight.semiBold,
    color: Ink.ink,
  },
  panelTitleError: {
    color: Ink.danger,
  },
  panelBody: {
    ...Type.note,
    color: Ink.ink2,
  },
  panelPrimaryCta: {
    marginTop: Space.xs,
  },
});
