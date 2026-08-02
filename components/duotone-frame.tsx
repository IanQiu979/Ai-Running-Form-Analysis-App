/**
 * A user's frame, full-bleed and graded into the palette (spec 2026-07-26 §3.5).
 *
 * WHY FULL-BLEED: rendering a photograph as a rounded thumbnail inside a card makes it foreign
 * to the interface. Bleeding it and grading it toward the app's base makes photograph and UI one
 * material — brief §1's "frames real photographic content with restraint", executed.
 *
 * WHY A WASH AND NOT A HUE SHIFT: a cold duotone of the kind used on machinery photography is
 * clinical and unflattering on a human body. So the subject's own colour is never rotated — a
 * low-opacity wash of `Colors[scheme].background` sits over it, which unifies the surface without
 * touching skin rendition. The wash reads whatever the base token is, so the 2026-08-02 Calm
 * palette swap (warm graphite/bone → blue/violet) carried through here with no code change; only
 * this comment, which used to justify the overlay by the base being *warm*, needed correcting.
 * `GRADE_OPACITY` is the lever if the cooler base ever proves too strong on skin — it is
 * deliberately low for exactly that reason, and was left untouched by the swap.
 *
 * MOMENT 3 (spec §4, Phase 2 plan Task 5): `annotate` renders the three fixed-geometry hairlines
 * (ground rule, posture line, landing marker) as PERMANENT hero decoration — on every result,
 * first open or re-open — because `@shared/pace` carries no real per-joint coordinates and this
 * screen has always refused to invent overlay geometry (see `app/result/[id].tsx`'s header).
 * `playAnnotation` is the one-time part: the draw-on transform, gated to a fresh analysis's first
 * open only. Same positions `components/first-run-intro.tsx` previews before any real result
 * exists, so "here is what it is for" and "here it is, on you" visually rhyme.
 */
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { AnnotationLines, type AnnotationLine } from '@/components/annotation-lines';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Heavy enough to unify frame and interface, light enough that skin stays true. */
const GRADE_OPACITY = 0.14;

/** A representative running photo's portrait ratio (spec 2026-07-26 §3.5's full-bleed hero). */
const FRAME_ASPECT_RATIO = 3 / 4;

// Same fixed geometry `components/first-run-intro.tsx` previews on the empty-state figure.
const ANNOTATION_LINES: AnnotationLine[] = [
  { id: 'ground', top: '82%', left: '10%', width: '80%' },
  { id: 'posture', top: '18%', left: '48%', width: '55%', rotate: '90deg' },
  { id: 'landing', top: '78%', left: '58%', width: '10%', rotate: '30deg' },
];

type DuotoneFrameProps = {
  /** Local or remote URI of the stored frame. */
  uri: string;
  /** Brief §7: the hero frame must carry a text alternative. */
  accessibilityLabel: string;
  testID?: string;
  /** Render the three fixed-geometry annotation lines over the frame. False (the default) is
   * every screen before this plan — no lines at all. */
  annotate?: boolean;
  /** Draw the lines on once, rather than rendering them already fully drawn. Only meaningful
   * when `annotate` is set; ignored otherwise. */
  playAnnotation?: boolean;
  /** Hold the draw for this long before line 1 starts. The result hero passes `<Aperture>`'s own
   * duration here so the wireframe is drawn onto an open, sharp frame rather than underneath a
   * closed iris. Only meaningful alongside `playAnnotation`. */
  annotationDelayMs?: number;
  /** Fires once, after the draw finishes. Only meaningful when both `annotate` and
   * `playAnnotation` are set. */
  onAnnotationComplete?: () => void;
};

export function DuotoneFrame({
  uri,
  accessibilityLabel,
  testID,
  annotate = false,
  playAnnotation = false,
  annotationDelayMs = 0,
  onAnnotationComplete,
}: DuotoneFrameProps) {
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
      {annotate && (
        <AnnotationLines
          lines={ANNOTATION_LINES}
          play={playAnnotation}
          startDelayMs={annotationDelayMs}
          onComplete={onAnnotationComplete}
          testID={testID ? `${testID}-annotations` : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    aspectRatio: FRAME_ASPECT_RATIO,
  },
});
