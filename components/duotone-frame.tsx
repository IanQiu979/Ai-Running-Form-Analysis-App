/**
 * A user's frame, full-bleed and graded into the palette (V23-08's "[ stored frame · duotone
 * grade ]").
 *
 * WHY FULL-BLEED: rendering a photograph as a rounded thumbnail inside a card makes it foreign
 * to the interface. Bleeding it and grading it toward the app's black makes photograph and UI
 * one material — the page's hero is the frame itself, edge to edge, with the readout hanging
 * from it.
 *
 * THE GRADE. The V23 system is black, white and grey with no chromatic base (spec A.0), and a
 * full-colour photograph would be the one thing on the screen outside it — so the frame is
 * desaturated to greyscale and then washed with a low-opacity `Ink.bg`, which pulls its shadows
 * toward the page's black. That is the two-tone map the page names: shadows toward `Ink.bg`,
 * highlights left at the photo's own whites. `GRADE_OPACITY` is the wash's one lever, kept low
 * so the subject stays legible.
 *
 * HOW IT DESATURATES (2026-10-05). The frame draws through `<PrivateFrameImage>` — expo-image
 * under the app's one private-frame cache policy (`lib/private-frame-image.ts`: signed URLs
 * only, no memory or disk cache). It used to be an SVG `Image` with an `FeColorMatrix` saturate
 * filter, but react-native-svg loads `href` through React Native's own image pipeline
 * (`NSURLCache` on iOS, Fresco's disk cache on Android) with no way to opt out, so every hero
 * frame was written to disk. expo-image has no filter pipeline and React Native's `filter:
 * grayscale()` is a no-op on iOS by default, so the grey comes from a blend layer instead: a
 * neutral `Ink.bg` sheet with `mixBlendMode: 'saturation'` takes the saturation of a grey (zero)
 * and the hue and luminosity of the photo beneath — the photo's own greyscale. What confines the
 * blend to the photo is the image itself: an opaque JPEG at `contentFit="cover"` fills the whole
 * box, so the layer never blends with anything else. Android applies blend modes only from API
 * 29; below that an unsupported blend layer would paint as a solid `Ink.bg` sheet over the photo,
 * so it is not mounted there and the frame shows in colour under the same wash.
 *
 * The vignette is drawn by the result screen as a sibling over this frame, not by this component:
 * the page draws it over the placeholder gradient too, when there is no image at all, so it
 * belongs to the hero box rather than to the image. (The drawn annotation marks that used to sit
 * here were removed 2026-09-20 — captain's phone test.)
 */
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { DeviceFrameImage } from '@/components/device-frame-image';
import { PrivateFrameImage } from '@/components/private-frame-image';
import { Ink } from '@/constants/v23-theme';

/** Heavy enough to unify frame and interface, light enough that skin stays true. */
const GRADE_OPACITY = 0.14;

/** The page's hero box: `aspect-ratio: 3/4` at full width. */
const FRAME_ASPECT_RATIO = 3 / 4;

/** First Android API level whose views honour `mixBlendMode` (`BlendModeHelper` returns null below). */
const ANDROID_BLEND_MODE_MIN_API = 29;

/** Whether this device draws the desaturate layer as a blend rather than as an opaque sheet. */
function supportsBlendModes(): boolean {
  return Platform.OS !== 'android' || Number(Platform.Version) >= ANDROID_BLEND_MODE_MIN_API;
}

/**
 * Where the frame comes from — exactly one of the two private-frame sources
 * (`lib/private-frame-image.ts`): a STORED frame by its signed URL (the result screen), or a frame
 * that has NOT left the device yet by its in-memory base64 bytes (the Preparing and Analysing
 * screens, 2026-10-06). Both draw under the same no-cache policy; the grade is identical.
 */
type DuotoneFrameSource = { uri: string; deviceBase64?: never } | { deviceBase64: string; uri?: never };

type DuotoneFrameProps = DuotoneFrameSource & {
  /** Every frame carries a text alternative (`Copy.result.hero.altText`, "Frame 2 of 5"). */
  accessibilityLabel: string;
  /** Replaces the default full-width 3:4 box — a thumbnail tile sizes itself. */
  style?: StyleProp<ViewStyle>;
  /** `cover` (default) bleeds the frame; `contain` shows the whole frame (Analysing's viewer).
   *  Under `contain` the blend and wash layers also cover the letterbox, which sits on a neutral
   *  grey surface — desaturating grey is a no-op, so only the wash's slight darkening shows. */
  contentFit?: 'cover' | 'contain';
  testID?: string;
};

export function DuotoneFrame({
  uri,
  deviceBase64,
  accessibilityLabel,
  style,
  contentFit = 'cover',
  testID,
}: DuotoneFrameProps) {
  const imageTestID = testID ? `${testID}-image` : undefined;
  return (
    <View
      style={[styles.container, style ?? styles.defaultBox]}
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}>
      {deviceBase64 !== undefined ? (
        <DeviceFrameImage
          base64={deviceBase64}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          accessible={false}
          testID={imageTestID}
        />
      ) : (
        <PrivateFrameImage
          uri={uri ?? ''}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          accessible={false}
          testID={imageTestID}
        />
      )}
      {supportsBlendModes() ? (
        <View
          testID={testID ? `${testID}-desaturate` : undefined}
          style={[StyleSheet.absoluteFill, styles.desaturate]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
        />
      ) : null}
      <View
        testID={testID ? `${testID}-grade` : undefined}
        style={[StyleSheet.absoluteFill, styles.grade]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  // The result hero's box. A caller passing `style` sizes the frame itself instead — a tile, or
  // Analysing's viewer — and must not inherit a 3:4 height that would overflow it.
  defaultBox: {
    width: '100%',
    aspectRatio: FRAME_ASPECT_RATIO,
  },
  // Any colour with zero saturation works; `Ink.bg` is a neutral grey (R = G = B).
  desaturate: {
    backgroundColor: Ink.bg,
    mixBlendMode: 'saturation',
  },
  grade: {
    backgroundColor: Ink.bg,
    opacity: GRADE_OPACITY,
  },
});
