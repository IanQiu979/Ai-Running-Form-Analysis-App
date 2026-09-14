/**
 * A user's frame, full-bleed and graded into the palette (V23-08's "[ stored frame · duotone
 * grade ]").
 *
 * WHY FULL-BLEED: rendering a photograph as a rounded thumbnail inside a card makes it foreign
 * to the interface. Bleeding it and grading it toward the app's black makes photograph and UI
 * one material — the page's hero is the frame itself, edge to edge, with the readout hanging
 * from it.
 *
 * WHY A WASH AND NOT A HUE SHIFT: a duotone of the kind used on machinery photography is
 * clinical and unflattering on a human body. So the subject's own colour is never rotated — a
 * low-opacity wash of `Ink.bg` sits over it, which pulls the frame's shadows toward the page's
 * black and unifies the surface without touching skin rendition. That is the V23 grade: the
 * palette has no chromatic base any more (the wash used to read `Colors[scheme].background`, a
 * blue-violet), so the same overlay now lands greyscale. A true two-tone map (shadows to `Ink.bg`,
 * highlights to `Ink.ink`) would need a per-pixel colour matrix, which a colour overlay cannot
 * do — `GRADE_OPACITY` is the lever, and it is deliberately low so skin stays true.
 *
 * The three annotation marks (`components/annotation-lines.tsx`) and the vignette are drawn by
 * the result screen as siblings over this frame, not by this component: the page draws them
 * over the placeholder gradient too, when there is no image at all, so they belong to the hero
 * box rather than to the image.
 */
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { Ink } from '@/constants/v23-theme';

/** Heavy enough to unify frame and interface, light enough that skin stays true. */
const GRADE_OPACITY = 0.14;

/** The page's hero box: `aspect-ratio: 3/4` at full width. */
const FRAME_ASPECT_RATIO = 3 / 4;

type DuotoneFrameProps = {
  /** Local or remote URI of the stored frame. */
  uri: string;
  /** The hero frame must carry a text alternative (`Copy.result.hero.altText`). */
  accessibilityLabel: string;
  testID?: string;
};

export function DuotoneFrame({ uri, accessibilityLabel, testID }: DuotoneFrameProps) {
  return (
    <View style={styles.container} testID={testID}>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        accessible
        accessibilityLabel={accessibilityLabel}
      />
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
    width: '100%',
    aspectRatio: FRAME_ASPECT_RATIO,
  },
  grade: {
    backgroundColor: Ink.bg,
    opacity: GRADE_OPACITY,
  },
});
