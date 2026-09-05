/**
 * The aperture — jeskojets.com's device (spec 2026-07-26 §2.1: "content framed by an aperture"),
 * restored 2026-08-02 on the captain's instruction and, this time, actually consumed.
 *
 * PROVENANCE, because the instruction was to recover rather than rewrite: the redesign built a
 * `components/aperture.tsx`, deleted it before committing, and reported the deletion. It is
 * therefore in NO commit — `git rev-list --all --objects | grep aperture` is empty, and PR #164's
 * own file list carries neither it nor `expo-blur`. There was nothing in history to recover, so
 * this is rebuilt to the treatment that PR described (photoreal aperture + depth-of-field, on
 * `expo-blur`) rather than reconstructed line-for-line. Flagged in the report rather than passed
 * off as a recovery.
 *
 * WHAT IT IS. Two ideas from the reference, and it is one beat, not two effects:
 *
 *   1. THE IRIS. A six-bladed hexagonal hole in a full-frame plate painted in the page's own
 *      `background`, opening from nothing to past the frame's corners. The blades are the page,
 *      so the content reads as being cut out of the page by a lens rather than as an image with a
 *      shape animating over it. `react-native-svg` — a dependency since the captain lifted the ban
 *      on it the same day (see `components/annotation-lines.tsx`'s header) — is what makes a real
 *      even-odd hole possible; there is no way to punch one with plain views.
 *   2. THE RACK FOCUS. A real backdrop blur over the frame, at full strength while the iris is
 *      shut, fading to nothing as it opens. That is the depth-of-field half: the shot arrives soft
 *      and pulls into focus. Fading a blur's OPACITY rather than its `intensity` is deliberate —
 *      `intensity` re-renders the native blur view on every step, opacity is a composited property.
 *
 * AND THE VIGNETTE, which is the part that is NOT animation. A soft radial fall-off toward the same
 * `background`, drawn permanently. It is what makes the frame read as seen through a lens once the
 * opening is over and on every re-open, and it is this component's reduced-motion answer: with
 * Reduce Motion on, the aperture is still visibly an aperture, it simply does not open. That is the
 * same reading of `docs/design/motion-consult.md` every other primitive here takes — suppress the
 * movement, keep the composition. `onOpened` still fires immediately in that case, so a caller
 * sequencing off it is never left hanging (the contract `components/annotation-lines.tsx` sets).
 *
 * HOW IT COMPOSES WITH THE HERO'S EXISTING TREATMENTS, since the brief for restoring it was that it
 * must not fight them. The duotone grade is a flat 14% wash of `background`; this vignette is the
 * same colour with a radial ramp, so the two read as one graded frame rather than as two overlays —
 * had the vignette been a neutral black (the reflexive choice) it would have greyed the grade and
 * muddied exactly what that file exists to avoid. The annotation wireframe draws in the middle of
 * the frame where the vignette is fully transparent; the fall-off only bites past 62% of the
 * radius, which is a deliberate cap rather than a default, chosen so the ground rule's ends (10%
 * and 90% across, at 82% down) stay legible. And the two MOTIONS are sequenced rather than
 * overlaid: the caller delays the wireframe's draw until the iris has opened, so the beat is
 * "aperture opens onto a sharp photo, then the analysis is drawn onto it" — not both at once.
 */
import { BlurTargetView, BlurView } from 'expo-blur';
import { useEffect, useRef, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Colors, Motion } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

/** The blade plate and the vignette are both drawn in this square user space and stretched to the
 *  frame, so nothing in this file needs the rendered size. */
const VIEWBOX = 100;

/** A real aperture has an even blade count and reads hexagonal at rest — six is the classic
 *  photographic iris, and it happens to rhyme with the triangle language the low-poly mark uses. */
const BLADES = 6;

/** Where the hole must reach to be fully out of frame. The corner of a 100x100 box is at 70.7 from
 *  centre, and a hexagon's flats sit inside its circumradius, so this overshoots deliberately. */
const OPEN_RADIUS = 84;

/** Blur strength while the iris is shut. High enough to be an unmistakable defocus, not so high the
 *  frame becomes an abstract smear the user cannot recognise as their own photo. */
const RACK_FOCUS_INTENSITY = 48;

/** How far out the vignette stays fully clear. Past this it ramps to `VIGNETTE_EDGE_OPACITY`. Both
 *  are capped for the annotation wireframe's sake — see this file's header. */
const VIGNETTE_CLEAR_STOP = 0.62;
const VIGNETTE_EDGE_OPACITY = 0.45;

/** `react-native-svg` resolves `url(#id)` against a document-wide id table, so this must not
 *  collide. It does not: the aperture is a single-instance treatment on the result hero, which is
 *  the same "one per screen" discipline `Colors.*.surface.raised` already states. */
const VIGNETTE_ID = 'pace-aperture-vignette';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** The outer plate, then a hexagonal hole. With `fillRule="evenodd"` the hole is genuinely cut, so
 *  what shows through it is the untouched content beneath — not a lightened version of it. */
function bladePath(radius: number): string {
  'worklet';
  const c = VIEWBOX / 2;
  let hole = '';
  for (let i = 0; i < BLADES; i++) {
    // -90° start puts a vertex at the top, which is how a photographic iris sits.
    const angle = (Math.PI * 2 * i) / BLADES - Math.PI / 2;
    const x = c + radius * Math.cos(angle);
    const y = c + radius * Math.sin(angle);
    hole += `${i === 0 ? 'M' : 'L'}${x} ${y} `;
  }
  return `M0 0 H${VIEWBOX} V${VIEWBOX} H0 Z ${hole}Z`;
}

type ApertureProps = {
  /** What is seen through the aperture. Rendered at full size beneath every overlay. */
  children: ReactNode;
  /** Play the opening once. False (the default) renders the aperture already open — the re-open
   *  case, matching `<AnnotationLines>`'s `play` and `<PaceReadout>`'s `instant` discipline. */
  open?: boolean;
  /** Fires once the iris is fully clear of the frame — or immediately when there is no opening to
   *  wait for (`open` false, or reduced motion). Callers sequence the next beat off this. */
  onOpened?: () => void;
  testID?: string;
};

export function Aperture({ children, open = false, onOpened, testID }: ApertureProps) {
  const scheme = useColorScheme() ?? 'light';
  const canvas = Colors[scheme].background;
  const reduceMotion = useReducedMotion();
  const animate = open && !reduceMotion;
  // What the rack focus blurs, on Android: expo-blur's dimezisBlurView method needs an explicit
  // target view to snapshot (unlike iOS's compositor-level blur, which needs nothing extra) —
  // without one it silently falls back to no blur at all. `children` (the photo/video frame) is
  // exactly that target; it's rendered inside this ref below instead of bare.
  const blurTarget = useRef<View>(null);

  // One driver, two readers: the blades' radius and the blur's opacity are the same gesture.
  const progress = useSharedValue(animate ? 0 : 1);

  useEffect(() => {
    if (!animate) {
      progress.value = 1;
      onOpened?.();
      return;
    }
    progress.value = withTiming(
      1,
      { duration: Motion.duration.epic, easing: Easing.bezier(...Motion.curve.calm) },
      (finished) => {
        'worklet';
        if (finished && onOpened) runOnJS(onOpened)();
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- progress is a stable shared value
  }, [animate]);

  const bladeProps = useAnimatedProps(() => ({ d: bladePath(progress.value * OPEN_RADIUS) }));
  const focusStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));

  return (
    <View style={styles.root} testID={testID}>
      <BlurTargetView ref={blurTarget}>{children}</BlurTargetView>

      {/* THE RACK FOCUS. Mounted only while there is an opening to play — a permanently mounted
          blur at opacity 0 is a native view the compositor still has to walk on every frame, for
          nothing. */}
      {animate ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, focusStyle]}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID={testID ? `${testID}-focus` : undefined}>
          <BlurView
            intensity={RACK_FOCUS_INTENSITY}
            tint={scheme}
            blurTarget={blurTarget}
            blurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}

      {/* THE VIGNETTE — permanent, and this component's still fallback. Drawn ABOVE the blur so the
          lens edge is present even in the defocused first frame, and below the blades so the blades
          close over it rather than under it. */}
      <Svg
        style={StyleSheet.absoluteFill}
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        preserveAspectRatio="none"
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID={testID ? `${testID}-vignette` : undefined}>
        <Defs>
          <RadialGradient id={VIGNETTE_ID} cx="50%" cy="50%" r="75%">
            <Stop offset={VIGNETTE_CLEAR_STOP} stopColor={canvas} stopOpacity={0} />
            <Stop offset={1} stopColor={canvas} stopOpacity={VIGNETTE_EDGE_OPACITY} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={VIEWBOX} height={VIEWBOX} fill={`url(#${VIGNETTE_ID})`} />
      </Svg>

      {/* THE IRIS. Same "mounted only while opening" rule as the blur: once open it is a full-frame
          path with a hole bigger than the frame, i.e. nothing, and it should cost nothing. */}
      {animate ? (
        <Svg
          style={StyleSheet.absoluteFill}
          viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
          preserveAspectRatio="none"
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID={testID ? `${testID}-blades` : undefined}>
          <AnimatedPath animatedProps={bladeProps} d={bladePath(0)} fill={canvas} fillRule="evenodd" />
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    // No size of its own: the aperture is exactly as large as what it frames, so the hero's own
    // aspect ratio stays the single source of that geometry.
    position: 'relative',
  },
});
