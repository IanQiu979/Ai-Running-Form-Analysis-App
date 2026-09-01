/**
 * The arc ring — the Cadence Arcs redesign's single load-bearing primitive.
 *
 * The motif is concentric arcs radiating from a footstrike, and this file is the one place that
 * knows how to draw one: a circular track with a fill arc swept over it from 12 o'clock, plus
 * whatever the caller centres inside it. Every ring in the app is this component — the overall
 * score readout, the four pillar rings, the loading rings, the compare deltas — so a change to how
 * a ring is drawn is a change here and nowhere else.
 *
 * THE RULE THIS FILE INHERITS FROM THE READOUT IT REPLACED, and must never break: a `fraction` of
 * `null` is a first-class, common state (every photo submission reports two pillars this way), not
 * an error and not a zero. It renders a DASHED, EMPTY track and mounts no fill arc at all — there
 * is no code path here that turns `null` into a 0% sweep, because a 0% sweep and a not-assessed
 * pillar would be the same picture. This is the direct successor of the old bar's
 * `barTrackNotAssessed` dashed-border treatment (M1, v23-ux-audit-r1), which existed for exactly
 * the same reason.
 *
 * MOTION, and it follows `components/pace-reveal.tsx`'s documented discipline rather than
 * inventing its own: the ARC LENGTH is the only thing that animates, via `strokeDashoffset` on a
 * shared value, driven on the UI thread by `useAnimatedProps` with no per-frame React render and
 * no layout pass — the SVG geometry (`r`, `cx`, `cy`, the dash array) is computed once at mount
 * and never re-serialised. `animate=false` (the overwhelmingly common case: every re-open from
 * Past Analyses) renders the arc at its final offset with nothing scheduled at all, exactly as
 * `<AnnotationLines play={false}>` does. Reduced motion is the caller's call, not this file's —
 * `components/pace-readout.tsx` owns that branch for the readout, because the reduced-motion
 * variant is a single crossfade over the WHOLE block, not a per-ring behaviour.
 *
 * WHY SVG HERE, when `components/annotation-lines.tsx` deliberately stays on plain Views: a line
 * has no internal geometry, so a `View` + `scaleX` draws it exactly. An arc does — its sweep is a
 * property of the path itself, and there is no transform on a `View` that produces a partial
 * circle. This is precisely the case the captain's 2026-08-02 ruling lifted the SVG ban for.
 *
 * DECORATIVE BY DEFAULT. A ring carries no text and no accessible label of its own; the numeral
 * and band word its caller centres in it are what a screen reader reads, and the caller wraps
 * those in its own `accessible` group. So the SVG layer is hidden from the a11y tree — which also
 * means a test looking for `arc-ring-fill` needs `{ includeHiddenElements: true }` (CLAUDE.md
 * § Testing).
 */
import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { Arc, Colors, Motion, type ColorScheme } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** The dash pattern a not-assessed ring's track is drawn with, in points. Long enough to read as
 *  a deliberate dashed rule at every size this ring is used at, rather than as a dotted texture. */
const NOT_ASSESSED_DASH = [5, 5] as const;

export type ArcRingProps = {
  /** Outer diameter, in points. The caller owns this: a ring's size is composition, not a token —
   *  the overall ring and a pillar ring differ by their role on the screen, not by a scale step. */
  size: number;
  /** Ring thickness, in points. */
  strokeWidth: number;
  /**
   * How far round to sweep, 0-1 — or `null` for NOT ASSESSED, which is a different picture, not a
   * zero. See this file's header; there is no code path that conflates the two.
   */
  fraction: number | null;
  /** The fill arc's colour. Callers pass a proven role — `Score[band][scheme].fill` for a score,
   *  `Arc[scheme].ornament` for a non-score ring. Never a literal. */
  color: string;
  /** Animate the sweep in once, on mount. Default false: finished instantly, nothing scheduled. */
  animate?: boolean;
  /** Delay before this ring's sweep starts, for a staggered group of them. Ignored when
   *  `animate` is false. */
  delayMs?: number;
  /** Centred content — a numeral, a band word, an icon. Laid out over the ring, never clipped by
   *  it, so Dynamic Type can grow the numeral past the ring's own bounds rather than truncating. */
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function ArcRing({
  size,
  strokeWidth,
  fraction,
  color,
  animate = false,
  delayMs = 0,
  children,
  style,
  testID,
}: ArcRingProps) {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const arc = Arc[scheme];

  // Geometry, computed once per size — never re-derived on a frame. The radius is inset by half
  // the stroke so the ring's OUTER edge lands on `size`, not half a stroke past it.
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const assessed = fraction !== null;
  const target = assessed ? Math.max(0, Math.min(1, fraction)) : 0;

  // `swept` is the fraction currently drawn. Starts at its final value when not animating, so the
  // very first painted frame is already correct and there is nothing to settle.
  const swept = useSharedValue(animate ? 0 : target);

  useEffect(() => {
    if (!animate || !assessed) return;
    // The reveal's one spring settle (`Motion.spring.reveal`) — the same single overshoot the bar
    // fill this ring replaces used, so the moment feels identical, only rounder.
    const settle = withSpring(target, Motion.spring.reveal);
    swept.value = delayMs > 0 ? withDelay(delayMs, settle) : settle;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- swept is a stable shared value
  }, [animate, assessed, target, delayMs]);

  const fillProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - swept.value),
  }));

  return (
    <View style={[styles.root, { width: size, height: size }, style]} testID={testID}>
      <Svg
        width={size}
        height={size}
        style={StyleSheet.absoluteFill}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {/* The track. Dashed and un-filled when this ring has nothing to report — the direct
            successor of the old bar's dashed empty track, and structurally distinct at a glance
            from "filled at 0%". */}
        <Circle
          testID={testID ? `${testID}-track` : undefined}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={arc.track}
          strokeWidth={strokeWidth}
          strokeDasharray={assessed ? undefined : [...NOT_ASSESSED_DASH]}
          fill="none"
        />
        {assessed ? (
          <AnimatedCircle
            testID={testID ? `${testID}-fill` : undefined}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            // One dash the length of the whole circle, offset back by however much is unswept —
            // the standard way to draw a partial arc without re-serialising a path string. The
            // -90° rotation starts the sweep at 12 o'clock instead of 3.
            strokeDasharray={[circumference, circumference]}
            strokeDashoffset={circumference * (1 - (animate ? 0 : target))}
            fill="none"
            originX={size / 2}
            originY={size / 2}
            rotation={-90}
            animatedProps={fillProps}
          />
        ) : null}
      </Svg>
      {children ? <View style={styles.center}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
