/**
 * The single motion primitive behind the result reveal (spec 2026-07-26 §4/§5; the first-run
 * intro that also mounted it was deleted 2026-09-13 with the V23 entry flow). Each consumer
 * mounts this with a different set of lines and a different trigger, but none of them know how a
 * line is drawn — only this file does.
 *
 * THE STANDING RULING AGAINST `react-native-svg` WAS LIFTED BY THE CAPTAIN ON 2026-08-02. This
 * header used to say the library "is not a dependency of this project and must not become one"
 * (spec §4.3), and other files — `components/low-poly-field.tsx` most consequentially — inherited
 * that ruling from here rather than relitigating it. It is now false in both halves and left
 * standing it would mislead: `react-native-svg` IS a dependency, and it is the right tool where a
 * shape's own geometry has to change. The captain lifted it specifically so the low-poly mark could
 * morph per-vertex, which a CSS border-triangle (always isoceles about its own axis) cannot do at
 * any amount of transform. Read that file's header for what the ruling was costing.
 *
 * WHY THIS FILE STAYS ON PLAIN VIEWS ANYWAY — a choice now, not a prohibition. A hairline is a 1pt
 * `View`; "drawing it on" is `scaleX` 0→1 with `transformOrigin: 'left'` so the line grows from its
 * own fixed left edge regardless of its static `rotate` — exactly `components/pace-reveal.tsx`'s
 * documented "Pillar bar fill = scaleX, never width" pattern, reused verbatim, because a transform
 * never triggers a layout pass. An SVG rewrite would buy this component nothing it does not already
 * have (a straight line has no internal geometry to morph), would move a proven, tested animation
 * onto a different rendering path for no behaviour change, and would swap a pure-transform draw for
 * one that re-serialises a path string every frame. Migrating was evaluated and declined on those
 * grounds; it is not blocked.
 *
 * WHY THE CALLER SUPPLIES GEOMETRY: this primitive invents no positions or angles. Every line's
 * `top`/`left`/`width`/`rotate` is fixed geometry the caller already decided (art proportions, the
 * same category `components/framing-guide.tsx`'s figure already lives in) — this file only knows
 * how to grow a line that's told where to sit.
 *
 * `play=false` renders every line already at scale 1 — no timing, no Reanimated work scheduled —
 * which is what a re-open (or any non-first render) needs: finished, instantly, matching
 * `components/pace-readout.tsx`'s own `instant` mode discipline. `play=true` animates once; this
 * component does not re-arm itself if `play` flips back to false and true again — callers that
 * need "never replay" enforce it by not remounting/re-triggering, same as `pace-reveal.tsx` and
 * `pace-readout.tsx` already do.
 *
 * Reduced motion: every line snaps to fully drawn immediately (a single implicit crossfade via
 * the surrounding caller's own opacity, not a per-line stagger) and `onComplete` still fires once,
 * so a caller waiting on it is never left hanging.
 */
import { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { Colors, Motion } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

export type AnnotationLine = {
  /** Stable id — becomes `${testID}-${id}` when a `testID` is supplied. */
  id: string;
  top: DimensionValue;
  left: DimensionValue;
  width: DimensionValue;
  /** Static angle, e.g. `'90deg'` for a vertical line. Growth is always along the line's own
   * local axis (scaleX before rotate), so an angled line still draws out from its fixed edge. */
  rotate?: string;
};

type AnnotationLinesProps = {
  lines: AnnotationLine[];
  /** Draw the lines on once. False renders every line already fully drawn — the re-open case. */
  play: boolean;
  /** Delay (ms) between each line's draw-start, so multiple lines draw progressively rather than
   * in lockstep — every line otherwise shares the same fixed `Motion.duration.slow`, so a caller
   * with more than one line MUST pass this to reach its own intended total duration (moment 2's
   * ~2000ms budget across three lines is exactly this: 0ms stagger silently collapsed it to one
   * line's ~320ms, which is why it was never observed). Default 0. Ignored under reduced
   * motion, which never staggers (see this file's header). */
  staggerMs?: number;
  /** Delay (ms) before the FIRST line starts, on top of `staggerMs`. Added 2026-08-02 so the result
   * hero can sequence this behind `<Aperture>`'s opening instead of drawing the wireframe underneath
   * a closed iris where nobody can see it. Distinct from `staggerMs`, which only spaces lines
   * relative to each other and can never delay line 0. Default 0 — every existing caller is
   * unaffected. Ignored under reduced motion, which never delays (see this file's header). */
  startDelayMs?: number;
  /** Fires once, after the slowest line finishes drawing (or immediately under reduced motion). */
  onComplete?: () => void;
  testID?: string;
};

export function AnnotationLines({
  lines,
  play,
  staggerMs = 0,
  startDelayMs = 0,
  onComplete,
  testID,
}: AnnotationLinesProps) {
  const scheme = useColorScheme() ?? 'light';
  const color = Colors[scheme].hairline;
  const reduceMotion = useReducedMotion();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {lines.map((line, index) => (
        <Line
          key={line.id}
          line={line}
          color={color}
          play={play}
          delay={startDelayMs + index * staggerMs}
          reduceMotion={reduceMotion}
          isLast={index === lines.length - 1}
          onComplete={onComplete}
          testID={testID ? `${testID}-${line.id}` : undefined}
        />
      ))}
    </View>
  );
}

function Line({
  line,
  color,
  play,
  delay,
  reduceMotion,
  isLast,
  onComplete,
  testID,
}: {
  line: AnnotationLine;
  color: string;
  play: boolean;
  delay: number;
  reduceMotion: boolean;
  isLast: boolean;
  onComplete?: () => void;
  testID?: string;
}) {
  const scaleX = useSharedValue(play ? 0 : 1);

  useEffect(() => {
    if (!play) return;

    const notify = isLast && onComplete ? () => runOnJS(onComplete)() : undefined;

    if (reduceMotion) {
      scaleX.value = 1;
      notify?.();
      return;
    }

    const animate = withTiming(1, { duration: Motion.duration.slow }, (finished) => {
      'worklet';
      if (finished && isLast && onComplete) {
        runOnJS(onComplete)();
      }
    });
    scaleX.value = delay > 0 ? withDelay(delay, animate) : animate;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scaleX is a stable shared value
  }, [play, reduceMotion, delay]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: scaleX.value }, { rotate: line.rotate ?? '0deg' }],
  }));

  return (
    <Animated.View
      testID={testID}
      style={[
        styles.line,
        {
          top: line.top,
          left: line.left,
          width: line.width,
          backgroundColor: color,
          transformOrigin: 'left',
        },
        animatedStyle,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

const styles = StyleSheet.create({
  line: {
    position: 'absolute',
    height: StyleSheet.hairlineWidth * 3,
  },
});
