/**
 * V23-02 Hero — the line-drawn runner and its four PACE callouts, drawn natively from
 * `lib/stride-hero.ts`'s per-frame geometry. This is the first thing anyone sees; the page it
 * ports is `V23-02 Hero.dc.html`.
 *
 * HOW IT ANIMATES. One shared value, `t` (seconds since mount), is advanced by a
 * `useFrameCallback` on the UI thread. ONE `useDerivedValue` evaluates `heroFrame(t)` per frame,
 * and every animated SVG element reads its slice of that frame in its own `useAnimatedProps` — so
 * the trigonometry runs once per frame, not once per element, and nothing crosses to the JS
 * thread while the runner runs. The runner never stops (the page holds "running"); with the OS
 * Reduce Motion setting on, `t` is pinned at `HERO_END_T` and the callback never starts, which
 * yields the page's own reduced-motion still — the poster — with no motion at all.
 *
 * WHY THE TEXT IS REACT NATIVE, NOT SVG. react-native-svg's `<Text>` resolves fonts through its
 * own native path and does not reliably pick up expo-font's registered family aliases, and its
 * text content cannot be driven from the UI thread. The callout names, sub-lines and count-up
 * numbers are therefore ordinary `<Animated.Text>`s in an overlay laid over the SVG: the overlay
 * is a 393 x 852 box (the page's canvas) scaled and offset exactly as `xMidYMid meet` places the
 * viewBox, so every text keeps the page's own coordinates. Opacity comes straight from the frame
 * (`useAnimatedStyle`); the counted-up number is the one thing that must reach React state, and
 * it does so through `useAnimatedReaction` only when the rounded value actually changes — a few
 * dozen updates over a 400 ms count-up, then silence.
 *
 * WHY THE DASHES ARE REAL LENGTHS. The page draws strokes on with `pathLength="100"`; react-native-
 * svg has no `pathLength`, so `lib/stride-hero.ts` reports each stroke's real length and this
 * component dashes against it — a fixed array for the constant-length strokes (head, leaders), and
 * a fixed over-long array with a moving offset for the body, whose length changes as it runs
 * (see `BODY_DASH`).
 *
 * Decorative to assistive tech as a single image: the whole hero carries one label naming the
 * four measurements, and no child is exposed on its own.
 */
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path, Polyline } from 'react-native-svg';

import { Copy } from '@/constants/copy';
import { Ink, Type } from '@/constants/v23-theme';
import {
  FIGURE_SCALE,
  GROUND_DASH,
  GROUND_LINE,
  GROUND_Y,
  HEAD_CIRCUMFERENCE,
  HERO_CALLOUTS,
  HERO_CUE_T,
  HERO_END_T,
  HERO_VIEWBOX,
  Radius,
  Stroke,
  dashOffsetFor,
  heroFrame,
  type HeroCallout,
  type HeroFrame,
} from '@/lib/stride-hero';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);
const AnimatedLine = Animated.createAnimatedComponent(Line);
const AnimatedG = Animated.createAnimatedComponent(G);

type Frame = SharedValue<HeroFrame>;

/** The figure group's transform: scaled about the point where the hip line meets the ground. */
const FIGURE_TRANSFORM = `translate(196 ${GROUND_Y}) scale(${FIGURE_SCALE}) translate(-196 -${GROUND_Y})`;

/** Where each text role's baseline sits below the top of its line box, as a fraction of the font
 *  size — the page positions SVG text by baseline, RN positions a `<Text>` by its line box. The
 *  half-leading `(lineHeight - fontSize) / 2` is added on top. */
const ASCENT = { tight: 0.78, condensed: 0.86 } as const;

function baselineTop(baselineY: number, fontSize: number, lineHeight: number, ascent: number): number {
  return baselineY - ((lineHeight - fontSize) / 2 + fontSize * ascent);
}

type StrideHeroProps = {
  /** Pin the hero at its end frame with no motion (the OS Reduce Motion setting). */
  reduceMotion?: boolean;
  /**
   * Fired once, on the JS thread, the moment the hero's OWN clock passes `HERO_CUE_T` — the
   * page's "hold" point where the cue may appear. The screen keys its cue off this rather than
   * off a parallel `setTimeout`: the two clocks start at different moments (the frame callback
   * starts on the UI thread's first frame after mount, a timer on the JS commit), and when the JS
   * thread is busy around a navigation the drift was measured at whole seconds — enough for the
   * cue to show over a figure still drawing itself, which the spec forbids. Under reduced motion
   * the clock is pinned past the hold, so this fires on mount.
   */
  onHold?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** The clock's origin is unset until the first frame runs. */
const NOT_STARTED = -1;

export function StrideHero({ reduceMotion = false, onHold, style, testID }: StrideHeroProps) {
  const t = useSharedValue(reduceMotion ? HERO_END_T : 0);
  const frame = useDerivedValue<HeroFrame>(() => heroFrame(t.value));

  // THE CLOCK KEEPS ITS OWN ORIGIN. `useFrameCallback` re-registers its callback on every render
  // (its effect depends on the callback's identity, and this one is inline), and a re-registered
  // callback gets a fresh `timeSinceFirstFrame` — so reading that field would rewind the hero to
  // t = 0 whenever the screen re-rendered, e.g. the moment the cue state flipped at the hold.
  // Measured live before this: the figure redrew itself and the callouts vanished at 4 s. The
  // origin is therefore captured once, in a shared value, and `t` is measured from it.
  const startedAt = useSharedValue(NOT_STARTED);
  const clock = useFrameCallback((info) => {
    if (startedAt.value === NOT_STARTED) startedAt.value = info.timestamp;
    t.value = (info.timestamp - startedAt.value) / 1000;
  }, !reduceMotion);

  useAnimatedReaction(
    () => t.value >= HERO_CUE_T,
    (held, previouslyHeld) => {
      if (held && !previouslyHeld && onHold) runOnJS(onHold)();
    },
    [onHold]
  );

  useEffect(() => {
    if (reduceMotion) {
      clock.setActive(false);
      t.value = HERO_END_T;
    } else {
      clock.setActive(true);
    }
    // `clock` is a stable handle; `t` a stable shared value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  // The overlay's placement — the same arithmetic `preserveAspectRatio="xMidYMid meet"` applies to
  // the viewBox, so RN text and SVG strokes agree to the point.
  // Until the first layout lands the overlay sits at the page's own 1:1 placement, so the texts
  // exist from the first frame rather than appearing a frame after the strokes.
  const [box, setBox] = useState<{ width: number; height: number }>(HERO_VIEWBOX);
  const overlayStyle = useMemo(() => {
    const scale = Math.min(box.width / HERO_VIEWBOX.width, box.height / HERO_VIEWBOX.height);
    const offsetX = (box.width - HERO_VIEWBOX.width * scale) / 2;
    const offsetY = (box.height - HERO_VIEWBOX.height * scale) / 2;
    // `transform` scales about the box's centre, so the unscaled box is placed such that its
    // centre lands where the scaled viewBox's centre does.
    return {
      left: offsetX + (HERO_VIEWBOX.width * scale - HERO_VIEWBOX.width) / 2,
      top: offsetY + (HERO_VIEWBOX.height * scale - HERO_VIEWBOX.height) / 2,
      transform: [{ scale }],
    };
  }, [box]);

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setBox({ width, height });
  }

  return (
    <View
      style={[styles.container, style]}
      onLayout={onLayout}
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={Copy.entry.hero.a11yLabel}>
      <Svg
        style={StyleSheet.absoluteFill}
        viewBox={`0 0 ${HERO_VIEWBOX.width} ${HERO_VIEWBOX.height}`}
        preserveAspectRatio="xMidYMid meet"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <GroundRules frame={frame} />
        <G transform={FIGURE_TRANSFORM}>
          <Ghost frame={frame} index={0} testID={testID ? `${testID}-ghost-0` : undefined} />
          <Ghost frame={frame} index={1} testID={testID ? `${testID}-ghost-1` : undefined} />
          <MainFigure frame={frame} testID={testID ? `${testID}-figure` : undefined} />
        </G>
        {HERO_CALLOUTS.map((c, i) => (
          <Leader key={c.id} frame={frame} index={i} callout={c} />
        ))}
      </Svg>
      <View
        style={[styles.overlay, overlayStyle]}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {HERO_CALLOUTS.map((c, i) => (
          <CalloutText
            key={c.id}
            frame={frame}
            index={i}
            callout={c}
            reduceMotion={reduceMotion}
            testID={testID ? `${testID}-callout-${c.id}` : undefined}
          />
        ))}
      </View>
    </View>
  );
}

function GroundRules({ frame }: { frame: Frame }) {
  const solidProps = useAnimatedProps(() => ({ opacity: frame.value.groundOpacity }));
  const dashedProps = useAnimatedProps(() => ({
    opacity: frame.value.groundOpacity,
    strokeDashoffset: frame.value.groundDashOffset,
  }));
  const still = heroFrame(0);
  return (
    <>
      <AnimatedLine
        animatedProps={solidProps}
        x1={GROUND_LINE.x1}
        x2={GROUND_LINE.x2}
        y1={GROUND_LINE.solidY}
        y2={GROUND_LINE.solidY}
        stroke={Ink.line}
        strokeWidth={Stroke.ground}
        opacity={still.groundOpacity}
      />
      <AnimatedLine
        animatedProps={dashedProps}
        x1={GROUND_LINE.x1}
        x2={GROUND_LINE.x2}
        y1={GROUND_LINE.dashedY}
        y2={GROUND_LINE.dashedY}
        stroke={Ink.line}
        strokeWidth={Stroke.ground}
        strokeDasharray={[GROUND_DASH, GROUND_DASH]}
        strokeDashoffset={still.groundDashOffset}
        opacity={still.groundOpacity}
      />
    </>
  );
}

/** A motion-trail ghost: the figure a fraction of a stride behind, faint, no joints, no draw-on. */
function Ghost({ frame, index, testID }: { frame: Frame; index: 0 | 1; testID?: string }) {
  const groupProps = useAnimatedProps(() => ({ opacity: frame.value.ghosts[index].opacity }));
  const headProps = useAnimatedProps(() => {
    const [cx, cy] = frame.value.ghosts[index].head;
    return { cx, cy };
  });
  const bodyProps = useAnimatedProps(() => ({ d: frame.value.ghosts[index].d }));
  return (
    <AnimatedG animatedProps={groupProps} opacity={0} testID={testID}>
      <AnimatedCircle
        animatedProps={headProps}
        r={Radius.head}
        fill="none"
        stroke={Ink.ink2}
        strokeWidth={Stroke.figure}
      />
      <AnimatedPath
        animatedProps={bodyProps}
        fill="none"
        stroke={Ink.ink2}
        strokeWidth={Stroke.figure}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </AnimatedG>
  );
}

const JOINT_INDICES = Array.from({ length: 13 }, (_, i) => i);

/** The body's dash pattern is a FIXED length longer than the figure can ever be, and only the
 *  offset moves: a dash of `BODY_DASH` followed by a gap of `BODY_DASH`, offset by
 *  `BODY_DASH - visible`, shows exactly the first `visible` points of the path. The body's real
 *  length changes every frame as the runner moves (it is a sum of moving segments), and moving
 *  the dash array itself per frame is a prop react-native-svg re-parses; a single offset is not. */
const BODY_DASH = 2000;

function bodyDashOffset(length: number, draw: number): number {
  'worklet';
  return BODY_DASH - length * draw;
}

/** The figure proper: head, body and joints, drawing themselves on over the first second. */
function MainFigure({ frame, testID }: { frame: Frame; testID?: string }) {
  const headProps = useAnimatedProps(() => {
    const m = frame.value.main;
    return {
      cx: m.head[0],
      cy: m.head[1],
      strokeDashoffset: dashOffsetFor(HEAD_CIRCUMFERENCE, m.headDraw),
    };
  });
  const bodyProps = useAnimatedProps(() => {
    const m = frame.value.main;
    return { d: m.d, strokeDashoffset: bodyDashOffset(m.length, m.draw) };
  });
  const jointsProps = useAnimatedProps(() => ({ opacity: frame.value.main.jointOpacity }));
  const still = heroFrame(0).main;
  return (
    <>
      <AnimatedCircle
        testID={testID ? `${testID}-head` : undefined}
        animatedProps={headProps}
        cx={still.head[0]}
        cy={still.head[1]}
        r={Radius.head}
        fill="none"
        stroke={Ink.ink}
        strokeWidth={Stroke.figure}
        strokeDasharray={[HEAD_CIRCUMFERENCE, HEAD_CIRCUMFERENCE]}
        strokeDashoffset={dashOffsetFor(HEAD_CIRCUMFERENCE, still.headDraw)}
      />
      <AnimatedPath
        testID={testID ? `${testID}-body` : undefined}
        animatedProps={bodyProps}
        d={still.d}
        fill="none"
        stroke={Ink.ink}
        strokeWidth={Stroke.figure}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={[BODY_DASH, BODY_DASH]}
        strokeDashoffset={bodyDashOffset(still.length, still.draw)}
      />
      <AnimatedG animatedProps={jointsProps} opacity={still.jointOpacity}>
        {JOINT_INDICES.map((i) => (
          <Joint key={i} frame={frame} index={i} />
        ))}
      </AnimatedG>
    </>
  );
}

function Joint({ frame, index }: { frame: Frame; index: number }) {
  const props = useAnimatedProps(() => {
    const j = frame.value.main.joints[index];
    return { cx: j[0], cy: j[1] };
  });
  return (
    <AnimatedCircle
      animatedProps={props}
      r={Radius.joint}
      fill={Ink.bg}
      stroke={Ink.ink}
      strokeWidth={Stroke.joint}
    />
  );
}

/** A callout's leader line (anchor -> elbow -> margin) and the dot on its anchor. */
function Leader({ frame, index, callout }: { frame: Frame; index: number; callout: HeroCallout }) {
  const lineProps = useAnimatedProps(() => {
    const c = frame.value.callouts[index];
    return {
      strokeDashoffset: dashOffsetFor(c.leaderLength, c.leader),
      opacity: c.leader > 0 ? c.dim : 0,
    };
  });
  const dotProps = useAnimatedProps(() => ({ opacity: frame.value.callouts[index].anchorOpacity }));
  const still = heroFrame(0).callouts[index];
  const points = [callout.A, callout.E, callout.X].map((p) => `${p[0]},${p[1]}`).join(' ');
  return (
    <>
      <AnimatedPolyline
        animatedProps={lineProps}
        points={points}
        fill="none"
        stroke={Ink.ink}
        strokeWidth={Stroke.leader}
        strokeDasharray={[still.leaderLength, still.leaderLength]}
        strokeDashoffset={dashOffsetFor(still.leaderLength, still.leader)}
        opacity={0}
      />
      <AnimatedCircle
        animatedProps={dotProps}
        cx={callout.A[0]}
        cy={callout.A[1]}
        r={Radius.anchor}
        fill={Ink.ink}
        opacity={still.anchorOpacity}
      />
    </>
  );
}

/** A callout's three text lines — name, sub-line, counted-up metric — at the page's baselines. */
function CalloutText({
  frame,
  index,
  callout,
  reduceMotion,
  testID,
}: {
  frame: Frame;
  index: number;
  callout: HeroCallout;
  reduceMotion: boolean;
  testID?: string;
}) {
  const copy = Copy.entry.hero.callout[callout.id];
  const [value, setValue] = useState(reduceMotion ? callout.value : 0);

  useAnimatedReaction(
    () => frame.value.callouts[index].value,
    (current, previous) => {
      if (current !== previous) runOnJS(setValue)(current);
    }
  );

  const labelStyle = useAnimatedStyle(() => ({ opacity: frame.value.callouts[index].labelOpacity }));
  const metricStyle = useAnimatedStyle(() => ({ opacity: frame.value.callouts[index].metricOpacity }));

  const side = callout.anchor === 'start' ? { left: callout.tx } : { right: HERO_VIEWBOX.width - callout.tx };
  const align = callout.anchor === 'start' ? styles.alignStart : styles.alignEnd;
  // A one-glyph unit (the degree sign) stays in the metric face; a word unit drops to Body in ink2
  // after a space — the page's own `tspan` rule.
  const wordUnit = copy.unit.length > 1;

  return (
    <>
      <Animated.Text
        style={[
          Type.label,
          styles.text,
          align,
          side,
          { top: baselineTop(callout.ly, Type.label.fontSize, Type.label.lineHeight, ASCENT.tight), color: Ink.ink },
          labelStyle,
        ]}>
        {copy.name}
      </Animated.Text>
      <Animated.Text
        style={[
          Type.small,
          styles.text,
          align,
          side,
          { top: baselineTop(callout.sy, Type.small.fontSize, Type.small.lineHeight, ASCENT.tight), color: Ink.ink2 },
          labelStyle,
        ]}>
        {copy.sub}
      </Animated.Text>
      <Animated.Text
        testID={testID}
        style={[
          Type.metric,
          styles.text,
          align,
          side,
          { top: baselineTop(callout.my, Type.metric.fontSize, Type.metric.lineHeight, ASCENT.condensed), color: Ink.ink },
          metricStyle,
        ]}>
        {value}
        <Animated.Text style={[wordUnit ? Type.metricUnit : null, { color: Ink.ink2 }]}>
          {wordUnit ? ` ${copy.unit}` : copy.unit}
        </Animated.Text>
      </Animated.Text>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  overlay: {
    position: 'absolute',
    width: HERO_VIEWBOX.width,
    height: HERO_VIEWBOX.height,
  },
  text: {
    position: 'absolute',
  },
  alignStart: {
    textAlign: 'left',
  },
  alignEnd: {
    textAlign: 'right',
  },
});
