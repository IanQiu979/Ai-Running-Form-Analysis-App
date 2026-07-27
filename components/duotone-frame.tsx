/**
 * A user's frame, full-bleed and graded into the palette (spec 2026-07-26 §3.5).
 *
 * WHY FULL-BLEED: rendering a photograph as a rounded thumbnail inside a card makes it foreign
 * to the interface. Bleeding it and grading it toward the app's base makes photograph and UI one
 * material — brief §1's "frames real photographic content with restraint", executed.
 *
 * WHY A WARM OVERLAY AND NOT A HUE SHIFT: brief §2 chose a warm graphite/bone base specifically
 * because it flatters skin tones. A cold duotone of the kind used on machinery photography is
 * clinical and unflattering on a human body. So the subject's own colour is never rotated — a
 * low-opacity warm wash sits over it, which unifies the surface without touching skin rendition.
 */
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Heavy enough to unify frame and interface, light enough that skin stays true. */
const GRADE_OPACITY = 0.14;

/** A representative running photo's portrait ratio (spec 2026-07-26 §3.5's full-bleed hero). */
const FRAME_ASPECT_RATIO = 3 / 4;

type DuotoneFrameProps = {
  /** Local or remote URI of the stored frame. */
  uri: string;
  /** Brief §7: the hero frame must carry a text alternative. */
  accessibilityLabel: string;
  testID?: string;
};

export function DuotoneFrame({ uri, accessibilityLabel, testID }: DuotoneFrameProps) {
  const scheme = useColorScheme() ?? 'light';
  const grade = Colors[scheme].background;

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
        style={[StyleSheet.absoluteFill, { backgroundColor: grade, opacity: GRADE_OPACITY }]}
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
});
