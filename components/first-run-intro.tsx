/**
 * Moment 2 (spec 2026-07-26 §4): "here is what the mark is for" — all three annotations (ground
 * rule, posture line, landing marker) draw onto the empty-state figure outline, once per install,
 * before the user has any real result to show them on.
 *
 * The figure is `components/framing-guide.tsx`'s existing running-stance figure, reused rather
 * than rebuilt — it is already this app's one "empty-state figure outline," used on the capture
 * screen's camera overlay. This is NOT a new addition to Home's empty state (brief §4 screen 2's
 * figure caption is separate, unbuilt UI — see the Phase 2 plan's architectural note); this is its
 * own once-ever overlay.
 *
 * The three lines sit at the same fixed relative positions `components/duotone-frame.tsx` uses
 * over a real result's hero, so moment 2's preview visually rhymes with moment 3's "here it is on
 * you" (spec's narrative: the mark exists → here is what it is for → here it is, on you).
 */
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { AnnotationLines, type AnnotationLine } from '@/components/annotation-lines';
import { FramingGuide } from '@/components/framing-guide';
import { Colors, ContentWidth } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { markFirstRunSeen } from '@/lib/first-run';

// Same fixed geometry `components/duotone-frame.tsx` uses over a real hero (Phase 2 plan Task 5).
const LINES: AnnotationLine[] = [
  { id: 'ground', top: '82%', left: '10%', width: '80%' },
  { id: 'posture', top: '18%', left: '48%', width: '55%', rotate: '90deg' },
  { id: 'landing', top: '78%', left: '58%', width: '10%', rotate: '30deg' },
];

// Spec's ~2000ms budget across three lines, spread by AnnotationLines' staggerMs (each line still
// draws over its own fixed Motion.duration.slow — see that file's header): 2 gaps * 800ms + 320ms
// ≈ 1920ms. Without this, all three lines shared the same lockstep 320ms and the whole moment
// finished before anyone could notice it — the actual bug behind "never observed."
const STAGGER_MS = 800;

type FirstRunIntroProps = {
  onDone: () => void;
};

export function FirstRunIntro({ onDone }: FirstRunIntroProps) {
  const scheme = useColorScheme() ?? 'light';
  const reduceMotion = useReducedMotion();
  const doneRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    markFirstRunSeen();
    onDone();
  };

  useEffect(() => {
    // Belt-and-braces fallback — see components/launch-intro.tsx's identical comment for why.
    if (reduceMotion) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finish is stable via doneRef
  }, [reduceMotion]);

  return (
    <View
      style={[styles.overlay, { backgroundColor: Colors[scheme].background }]}
      // `accessibilityElementsHidden` is the iOS half of this pair and was missing: on iOS
      // `accessible={false}` only declines to MERGE the subtree into one node, it does not hide
      // it, and `importantForAccessibility` is Android-only. Every other decorative component
      // here (`framing-guide`, `marquee`, `aperture`, `low-poly-field`, `screen-gradient`) sets
      // all of it together — the same iOS/Android parity trap as issue #11's live regions.
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <View style={styles.figureBlock}>
        <FramingGuide />
        <AnnotationLines
          lines={LINES}
          play
          staggerMs={STAGGER_MS}
          onComplete={finish}
          testID="first-run-intro"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  figureBlock: {
    width: '70%',
    // Issue #63 (M7 tablet pass): `70%` of an 11" iPad's 834pt viewport is 584pt wide, which at a
    // 3:4 aspect draws a 778pt-tall figure — the same overlay that is a modest 275pt-wide sketch
    // on a phone. Capping at the app-wide readable column restores the phone proportion on a
    // tablet. A no-op below the cap: 70% of any phone width is far under 560.
    maxWidth: ContentWidth.readable,
    aspectRatio: 3 / 4,
  },
});
