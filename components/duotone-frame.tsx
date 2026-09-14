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
 * highlights left at the photo's own whites. The desaturation is an SVG colour-matrix filter
 * (`FeColorMatrix type="saturate" values="0"`, react-native-svg >= 15.8 renders filters natively
 * on both platforms) over an SVG `Image`; `expo-image` has no filter pipeline, which is why the
 * frame is drawn through SVG here. `GRADE_OPACITY` is the wash's one lever, kept low so the
 * subject stays legible.
 *
 * The three annotation marks (`components/annotation-lines.tsx`) and the vignette are drawn by
 * the result screen as siblings over this frame, not by this component: the page draws them
 * over the placeholder gradient too, when there is no image at all, so they belong to the hero
 * box rather than to the image.
 */
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, FeColorMatrix, Filter, Image as SvgImage } from 'react-native-svg';

import { Ink } from '@/constants/v23-theme';

/** The desaturation filter's id — unique on the page so a second `<Defs>` can never collide. */
const GRADE_FILTER_ID = 'duotone-frame-grade';

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
      <Svg
        width="100%"
        height="100%"
        style={StyleSheet.absoluteFill}
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        testID={testID ? `${testID}-image` : undefined}>
        <Defs>
          <Filter id={GRADE_FILTER_ID}>
            <FeColorMatrix type="saturate" values="0" />
          </Filter>
        </Defs>
        <SvgImage
          href={{ uri }}
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid slice"
          filter={`url(#${GRADE_FILTER_ID})`}
        />
      </Svg>
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
