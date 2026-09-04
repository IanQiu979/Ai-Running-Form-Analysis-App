/**
 * Source picker (design brief screen 3, issue #36) — "Add your run": two cards, Upload
 * (library) or Record (in-app). Also hosts:
 *   - the consent gate (`components/consent-gate.tsx`, issues #68 and #94) — the copy deck
 *     names this screen as the exact place it intercepts: "gates the Source Picker ->
 *     Capture/Upload handoff" (docs/design/copy-deck.md § Consent). Every card press shows the
 *     gate now — it used to skip straight through for a returning, already-consented user, but
 *     issue #94 added a per-upload "who's actually in this photo or video" question that a
 *     once-ever grant cannot answer, so the gate always mounts and decides its own starting
 *     phase internally (see that component's docblock).
 *   - the photo-library permission dance (soft-ask -> OS prompt -> denied), since the deck's
 *     `sourcePicker.permission.library.*` keys live on THIS screen, not a separate one.
 *   - `lib/media-caps.ts`'s pre-flight check on whatever the library picker returns (a picked
 *     video, unlike an in-app recording, isn't bounded by `CameraView`'s own `maxDuration`).
 *
 * Camera permission is Capture's (`app/capture/record.tsx`) own concern, not this screen's —
 * tapping Record just navigates there once the gate fires onConsented.
 */
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArcLoader } from '@/components/arc-loader';
import { ConsentGate } from '@/components/consent-gate';
import { ArcRing } from '@/components/ui/arc-ring';
import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { PillButton } from '@/components/ui/pill-button';
import { ScreenGradient } from '@/components/ui/screen-gradient';
import { SurfaceCard } from '@/components/ui/surface-card';
import { Copy } from '@/constants/copy';
import {
  Meter,
  Colors,
  ContentWidth,
  FontFamily,
  FontSize,
  LineHeight,
  Opacity,
  Semantic,
  Spacing,
  Tracking,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { readFileSizeBytes } from '@/lib/media-file-size';
import { checkMediaCaps } from '@/lib/media-caps';
import { classifyPermission, permissionRecoveryAction } from '@/lib/permission-state';
import { useAnnounce } from '@/lib/use-announce';

// The card badge's geometry and the busy loader's diameter — a drawn mark's size is composition,
// not a spacing step between elements, so these are local constants rather than invented
// `constants/theme.ts` tokens (same category as `app/capture/record.tsx`'s record-button size and
// `components/framing-guide.tsx`'s figure geometry; `<ArcRing>` documents `size` as the caller's
// own call for exactly this reason).
const CARD_BADGE_SIZE = 56;
const CARD_BADGE_ICON_SIZE = 24;
const LOADING_MARK_SIZE = 32;

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

  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [libraryFlow, setLibraryFlow] = useState<LibraryFlow>('idle');
  const [uploadError, setUploadError] = useState<InlineError | null>(null);
  // Guards double-taps while a native permission dialog / picker sheet is in flight — both are
  // modal and async, and this screen stays mounted underneath them.
  const [busy, setBusy] = useState(false);

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

  // Always routes through the gate now (issue #94) — there is no "already consented, skip
  // straight through" shortcut anymore, because the gate's per-upload subject question has no
  // such thing as "already answered" (see components/consent-gate.tsx's docblock).
  function handleCardPress(action: 'record' | 'upload') {
    setUploadError(null);
    setPendingAction(action);
  }

  function handleConsented() {
    const action = pendingAction;
    setPendingAction(null);
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

  const cardsDisabled = busy;

  if (pendingAction !== null) {
    return (
      <ScreenGradient>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.consentWrap}>
            <ConsentGate onConsented={handleConsented} onCancel={() => setPendingAction(null)} />
          </View>
        </SafeAreaView>
      </ScreenGradient>
    );
  }

  return (
    <ScreenGradient>
      <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* The reference's top bar: a circular glass control at the leading edge, the screen name
            as a tracked eyebrow beside it. Replaces the "24pt heading + underlined 'Back' text"
            row — a back affordance is the one control that should look identical on every screen,
            and a word set in body type never will. */}
        <View style={styles.headerRow}>
          <CircleIconButton
            accessibilityLabel="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
            testID="capture-back">
            <MaterialIcons name="arrow-back" size={20} color={colors.text.primary} />
          </CircleIconButton>
          <Eyebrow tone="primary" accessibilityRole="header" style={styles.header}>
            {Copy.sourcePicker.title}
          </Eyebrow>
        </View>

        <SourceCard
          colors={colors}
          scheme={scheme}
          testID="source-card-upload"
          icon="photo-library"
          title={Copy.sourcePicker.card.upload.title}
          subtitle={Copy.sourcePicker.card.upload.subtitle}
          disabled={cardsDisabled}
          onPress={() => handleCardPress('upload')}
        />

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

        <SourceCard
          colors={colors}
          scheme={scheme}
          testID="source-card-record"
          icon="videocam"
          title={Copy.sourcePicker.card.record.title}
          subtitle={Copy.sourcePicker.card.record.subtitle}
          disabled={cardsDisabled}
          onPress={() => handleCardPress('record')}
        />

        <Text style={styles.framingTip}>{Copy.sourcePicker.framingTip}</Text>

        {/* The motif's own wait state replaces the platform spinner. `<ArcLoader>` is decorative and
            hidden from the a11y tree by design, so the "Loading" label a screen reader needs moves
            onto this wrapper — same label, same announcement, just carried by the node that is
            actually visible to the a11y tree now. */}
        {cardsDisabled && (
          <View accessible accessibilityLabel="Loading" style={styles.loading}>
            <ArcLoader size={LOADING_MARK_SIZE} />
          </View>
        )}
      </ScrollView>
      </SafeAreaView>
    </ScreenGradient>
  );
}

/**
 * One of the two source cards. Extracted local to this screen (same idiom as `InlinePanel` below)
 * once the card grew a badge + text column: two hand-copied twenty-line blocks is how the pair
 * drifts apart.
 *
 * Cadence Arcs (2026-09-01): a `<SurfaceCard>` — the redesign's one opaque panel shape, so the
 * card's fill, corner and edge come from that component rather than being restated here — wrapping
 * the SAME `Pressable` as before, with its `testID`, role, composed label, disabled state and
 * `Opacity.pressed` untouched. The card carries `padding={0}` and the Pressable owns the interior
 * padding, so the whole card area stays tappable rather than only the text inside it.
 *
 * The badge is a FULL `<ArcRing>` (`fraction={1}`) in the ornament role, not a score: it holds a
 * glyph naming the source, and a complete sweep is the only fraction that can never be misread as
 * a progress value on a screen where nothing is in progress.
 */
function SourceCard({
  colors,
  scheme,
  testID,
  icon,
  title,
  subtitle,
  disabled,
  onPress,
}: {
  colors: ThemeColors;
  scheme: ColorScheme;
  testID: string;
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  subtitle: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const styles = createCardStyles(colors);
  return (
    <SurfaceCard padding={0}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${subtitle}`}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [styles.card, (pressed || disabled) && styles.pressed]}>
        <ArcRing
          size={CARD_BADGE_SIZE}
          strokeWidth={Spacing.xs}
          fraction={1}
          color={Meter[scheme].rule}>
          <MaterialIcons name={icon} size={CARD_BADGE_ICON_SIZE} color={colors.text.primary} />
        </ArcRing>
        <View style={styles.cardText}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardSubtitle}>{subtitle}</Text>
        </View>
      </Pressable>
    </SurfaceCard>
  );
}

function createCardStyles(colors: ThemeColors) {
  return StyleSheet.create({
    // "Large cards" (brief §4.3) — generous padding rather than a fixed minHeight, so size comes
    // from Spacing tokens + content instead of an invented pixel number. Fill/corner/edge now come
    // from the `<SurfaceCard>` around this Pressable, so only layout is left here.
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.lg,
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.xl,
    },
    // Flexes so a long subtitle wraps inside the column instead of pushing the badge off the card,
    // and so Dynamic Type grows the block downward rather than sideways.
    cardText: {
      flex: 1,
      gap: Spacing.xs,
    },
    cardTitle: {
      fontFamily: FontFamily.display.semiBold,
      // These two cards are the only decision on the screen; they should read as headlines, not as
      // list rows.
      fontSize: FontSize.xl,
      letterSpacing: Tracking.display,
      lineHeight: FontSize.xl * LineHeight.heading,
      color: colors.text.primary,
    },
    cardSubtitle: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      lineHeight: FontSize.sm * LineHeight.body,
      // Secondary text is legal here and only here on this screen: it sits on an opaque
      // `surface.base` inside the card, not on the page wash (`Gradient`'s contract).
      color: colors.text.secondary,
    },
    pressed: {
      opacity: Opacity.pressed,
    },
  });
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
  // Issue #11: `accessibilityLiveRegion="polite"` on the panel View below is Android-only — this
  // is the iOS complement, same pattern as app/(auth)/sign-in.tsx. `InlinePanel` is only ever
  // mounted while it has something to say (soft-ask / denied / upload-error), so this fires once
  // per presentation, on mount.
  useAnnounce(`${title} ${body}`);

  return (
    // Cadence Arcs (2026-09-01): the hand-rolled `View` this docblock's own note described became
    // the `<SurfaceCard>` it was always describing — `accessibilityLiveRegion` is forwarded because
    // that component exists partly to keep exactly this Android announcement when a banner becomes
    // a card (see its prop docs).
    <SurfaceCard accessibilityLiveRegion="polite">
      <View style={styles.panel}>
        <Text style={[styles.panelTitle, error && styles.panelTitleError]}>{title}</Text>
        <Text style={styles.panelBody}>{body}</Text>
        {primaryCta && onPrimary && (
          <PillButton label={primaryCta} onPress={onPrimary} disabled={busy} style={styles.panelPrimaryCta} />
        )}
        {secondaryCta && onSecondary && (
          <PillButton variant="ghost" label={secondaryCta} onPress={onSecondary} block />
        )}
      </View>
    </SurfaceCard>
  );
}

function createPanelStyles(colors: ThemeColors, scheme: ColorScheme) {
  return StyleSheet.create({
    // Fill, corner, edge and padding all come from `<SurfaceCard>` now; this inner stack exists
    // only to space the panel's children — `<SurfaceCard>`'s `style` lands on its outer shadow
    // node, whose single child is the clip view, so a `gap` set there would silently do nothing.
    panel: {
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
      lineHeight: FontSize.sm * LineHeight.body,
      color: colors.text.secondary,
    },
    panelPrimaryCta: {
      marginTop: Spacing.xs,
    },
  });
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      // Transparent — `<ScreenGradient>` behind it owns the fill.
      backgroundColor: 'transparent',
    },
    consentWrap: {
      flex: 1,
      width: '100%',
      maxWidth: ContentWidth.readable,
      alignSelf: 'center',
      justifyContent: 'center',
      padding: Spacing.lg,
    },
    // `flex` ONLY. Child-layout props (alignItems/justifyContent/...) are ILLEGAL in a
    // ScrollView's `style` and throw at render: "ScrollView child layout must be applied
    // through the contentContainerStyle prop." The readable column is therefore centred by
    // `alignSelf: 'center'` on the contentContainerStyle below, not from here (issue #63).
    scroll: {
      flex: 1,
    },
    content: {
      flexGrow: 1,
      width: '100%',
      maxWidth: ContentWidth.readable,
      alignSelf: 'center',
      padding: Spacing.xl,
      gap: Spacing.lg,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.lg,
    },
    header: {
      flex: 1,
    },
    framingTip: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.xs,
      lineHeight: FontSize.xs * LineHeight.body,
      // On the wash — `text.primary` only, at full opacity (`Gradient`'s contract; H3,
      // v23-ux-audit-r1: opacity here dropped this below WCAG AA). Quietness comes from the xs
      // size alone, not from a dimmed color.
      color: colors.text.primary,
      textAlign: 'center',
    },
    loading: {
      alignItems: 'center',
    },
  });
}
