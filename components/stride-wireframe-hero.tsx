/**
 * <StrideWireframeHero> — the app's signature entry/onboarding animation (captain-approved
 * 2026-09-03): a motion-capture-style wireframe runner cycling through one closed running gait,
 * drawn in icy-cyan lines on a near-black ground, with the instrument chrome of a gait-lab
 * readout around it — a faint grid, a ground that scrolls at the speed the feet push it, a
 * gait-cycle ruler with a moving cursor, a knee-flexion arc and a live knee angle. It says the
 * one thing this app does — "we measure your running form" — without a word of copy.
 *
 * WHERE THE GEOMETRY LIVES. Everything about the figure — proportions, the gait tables, the
 * forward kinematics, the path serialisation, the derived ground line and ground speed — is in
 * `lib/stride-wireframe.ts`, which has no React in it and is unit-tested as plain functions.
 * This file is only the rendering: which layers, in what order, at what stroke, and the one
 * Reanimated driver that moves them. Retune the gait there, not here.
 *
 * THE PALETTE IS DELIBERATELY NOT FROM `constants/theme.ts`. Per the 2026-09-03 redesign brief,
 * the icy-cyan highlight is a reserved, two-tier-accent colour — used only for the true primary
 * CTA and this animation — and this hero renders cyan-on-near-black REGARDLESS of the surrounding
 * screen's light/dark mode: it is the bold moment, not a themed surface. The parallel theme task
 * (`v23-redesign-theme-onboarding`) owns the new token set and should re-point
 * `STRIDE_WIREFRAME_PALETTE` at its highlight/deep-canvas tokens once they exist; until then the
 * two values are pinned here, and `lineColor`/`backgroundColor` props exist so a caller can pass
 * tokens without editing this file. Nothing else in this file names a colour.
 *
 * INTEGRATION (for the onboarding rebuild — you should not need to read past this paragraph):
 *
 *   <StrideWireframeHero style={{ width: '100%', aspectRatio: 3 / 4 }} />
 *   <StrideWireframeHero style={StyleSheet.absoluteFill} chrome={false} />
 *
 *   - It SIZES ITSELF TO ITS `style`: give it a width/height, an `aspectRatio`, `flex: 1`, or
 *     `StyleSheet.absoluteFill`; it measures the box it was given and fits the figure inside it
 *     (centred, `xMidYMid meet`-style) with the ground and grid extended edge to edge. Any aspect
 *     works — portrait gives the figure room, landscape gives the ground a long run.
 *   - It paints its own near-black background over the whole box, with no rounded corners; clip
 *     it with a parent `overflow: 'hidden'` + `borderRadius` if the layout wants a tile.
 *   - `chrome` (default true) toggles the grid, ground, ruler and labels; `trails` (default true)
 *     the onion-skin ghosts of the near leg; `readouts` (default true) the knee arc, lean
 *     reference and live knee angle. Turn `chrome` off for a background-wash use, keep everything
 *     on for the hero.
 *   - `cadenceSpm` (default 176) and `playbackRate` (default 0.5) set the loop speed: one cycle
 *     is two steps at that cadence, played back at that rate. The default reads as slow-motion
 *     review footage, which is what a gait lab shows you.
 *   - `paused` freezes the loop where it is (for a screen that has scrolled it away, or a
 *     preview). Reduced motion is handled INSIDE: see below.
 *   - It is decorative and hidden from the accessibility tree by default. Pass
 *     `accessibilityLabel` to expose it as an image with that label instead, if the screen has
 *     no other way of saying what is on it.
 *   - It has no state worth preserving and no callbacks. Mount it, size it, done.
 *
 * ONE DRIVER, LINEAR, LOOPED. A single shared value `phase` ramps 0 -> 1 with `Easing.linear`
 * (the only correct curve for a continuous loop — `constants/theme.ts`'s `Motion.curve.linear`
 * note — an eased loop would visibly pulse at every seam) and repeats. Every animated node is a
 * `useAnimatedProps` worklet reading that one value on the UI thread: the figure's layers rebuild
 * their `d` per frame from `solveStride(phase)`, the ground's `strokeDashoffset` advances by the
 * derived ground travel, the ruler's cursor slides, and the knee angle is written as `text` onto
 * a disabled `TextInput` (the same ReText pattern `components/pace-reveal.tsx` uses). Nothing
 * crosses to the JS thread per frame and nothing animates a layout property.
 *
 * Every drawn shape is a `<Path d>` rather than a `<Line>`/`<Circle>`/`<Polyline>` — see the
 * "Path serialisation" note in `lib/stride-wireframe.ts` for the Fabric reason, inherited from
 * `components/low-poly-field.tsx`.
 *
 * REDUCED MOTION: renders one still frame (`REST_PHASE`, late swing — a pose that reads as
 * running even frozen) as plain `<Path>`s with no Reanimated work scheduled at all — not paused,
 * never started — and no trails (a trail implies motion). The chrome, readouts and a static
 * knee angle still render: the composition carries the meaning, the loop is what the setting
 * asks us to drop. Same reading of the contract as `components/arc-loader.tsx` and
 * `components/low-poly-field.tsx`, per `docs/design/motion-consult.md`.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { G, Path, Text as SvgText } from 'react-native-svg';

import { FontFamily, FontSize, Tracking } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import {
  FIGURE_EXTENT,
  GROUND_TRAVEL_PER_CYCLE,
  GROUND_Y,
  REST_PHASE,
  STANCE,
  VIEWBOX,
  corePath,
  farLimbsPath,
  farMarkersPath,
  nearLegPath,
  nearLimbsPath,
  nearMarkersPath,
  readoutPath,
  solveStride,
} from '@/lib/stride-wireframe';

/**
 * The hero's two colours. Pinned here on purpose — see the file header. The line is the
 * redesign's locked icy-cyan highlight; the ground is a near-black with a hint of the same blue,
 * so the two read as one material lit from within rather than as cyan-on-#000.
 */
export const STRIDE_WIREFRAME_PALETTE = {
  line: '#8CF0FF',
  background: '#07090C',
} as const;

/** Opacity tiers, on the one line colour. Depth is opacity here, never a second hue. */
const Tier = {
  near: 1,
  far: 0.38,
  readout: 0.8,
  trail1: 0.22,
  trail2: 0.1,
  ground: 0.35,
  groundDash: 0.5,
  ruler: 0.4,
  label: 0.55,
  grid: 0.07,
} as const;

/** Stroke widths in viewBox units, so they scale with the rendered size. */
const Stroke = {
  near: 0.9,
  far: 0.7,
  marker: 0.6,
  readout: 0.45,
  ground: 0.4,
  groundDash: 0.6,
  ruler: 0.4,
  cursor: 0.9,
  grid: 0.3,
} as const;

/** How far behind the live frame each onion-skin ghost sits, as a fraction of the cycle. */
const TRAIL_LAG = [0.05, 0.1] as const;

/** The gait-cycle ruler: its drop below the ground and its marks, viewBox units. It spans the
 *  figure's own reach (`FIGURE_EXTENT`), so 0% sits under the trailing toe and 100% under the
 *  leading one — the ruler measures the runner, not the box. */
const RULER = {
  x0: Math.round(FIGURE_EXTENT.x0 * VIEWBOX),
  x1: Math.round(FIGURE_EXTENT.x1 * VIEWBOX),
  dropBelowGround: 9,
  tick: 1.4,
  majorTick: 2.5,
  cursor: 1.6,
} as const;

/** Grid pitch, viewBox units. */
const GRID_PITCH = 10;

/** SVG label size, viewBox units (scales with the hero). */
const LABEL_SIZE = 2.4;

/**
 * The scrolling ground's dash period. Chosen so an integer number of periods fits into one
 * cycle's ground travel — otherwise the dash pattern would jump at the loop seam, which is the
 * one place a linear loop can betray itself. Derived from the gait, not authored.
 */
const GROUND_TRAVEL_UNITS = GROUND_TRAVEL_PER_CYCLE * VIEWBOX;
const GROUND_DASH_PERIOD = GROUND_TRAVEL_UNITS / Math.max(1, Math.round(GROUND_TRAVEL_UNITS / 14));
const GROUND_DASH = `${(GROUND_DASH_PERIOD * 0.22).toFixed(3)} ${(GROUND_DASH_PERIOD * 0.78).toFixed(3)}`;

/** Milliseconds for one full gait cycle (two steps) at `cadenceSpm`, played at `playbackRate`. */
export function cycleDurationMs(cadenceSpm: number, playbackRate: number): number {
  return (2 * 60_000) / cadenceSpm / playbackRate;
}

/**
 * The content frame the viewBox fits, viewBox units: the figure's derived reach plus a little
 * air, from just above the head down to the ruler's captions (the ruler sits
 * `RULER.dropBelowGround` under the ground, its captions a label's height under that). Framing
 * on the figure's true extent rather than the nominal 0-100 box is what lets a portrait hero
 * fill its box with the runner instead of with margin; reserving the caption height is what keeps
 * a wide box from clipping the ruler off the bottom.
 */
export const FRAME = (() => {
  const air = 3;
  const x0 = FIGURE_EXTENT.x0 * VIEWBOX - air;
  const x1 = FIGURE_EXTENT.x1 * VIEWBOX + air;
  const y0 = FIGURE_EXTENT.top * VIEWBOX - air;
  const y1 = GROUND_Y * VIEWBOX + RULER.dropBelowGround + RULER.majorTick + LABEL_SIZE * 2;
  return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 } as const;
})();

/**
 * The viewBox for a `width` x `height` box: `FRAME` centred, extended along whichever axis the
 * box has spare room on so the ground and grid reach the edges, with `inset` units of breathing
 * room on every side.
 */
export function computeViewBox(
  width: number,
  height: number,
  inset: number
): { x: number; y: number; w: number; h: number } {
  const baseW = FRAME.w + 2 * inset;
  const baseH = FRAME.h + 2 * inset;
  let w = baseW;
  let h = baseH;
  if (width / height > baseW / baseH) w = (baseH * width) / height;
  else h = (baseW * height) / width;
  return { x: FRAME.cx - w / 2, y: FRAME.cy - h / 2, w, h };
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/** Native `TextInput` prop Reanimated writes on the UI thread — see `components/pace-reveal.tsx`. */
type NativeTextProp = { text: string };

export type StrideWireframeHeroProps = {
  /** Sizes the hero — it fills whatever box this gives it. See the file header. */
  style?: StyleProp<ViewStyle>;
  /** Grid, ground, ruler and labels. Default true. */
  chrome?: boolean;
  /** Onion-skin ghosts of the near leg. Default true. Never rendered under reduced motion. */
  trails?: boolean;
  /** Knee-flexion arc, lean reference and the live knee angle. Default true. */
  readouts?: boolean;
  /** Steps per minute the loop depicts. Default 176 — the compact cadence PACE coaches toward. */
  cadenceSpm?: number;
  /** Playback speed. Default 0.5: slow-motion review, the way a gait lab shows footage. */
  playbackRate?: number;
  /** Freeze the loop where it is. */
  paused?: boolean;
  /** Override the pinned line colour with a token. */
  lineColor?: string;
  /** Override the pinned ground colour with a token. */
  backgroundColor?: string;
  /** Expose the hero to assistive tech as an image with this label. Hidden when omitted. */
  accessibilityLabel?: string;
  testID?: string;
};

export function StrideWireframeHero({
  style,
  chrome = true,
  trails = true,
  readouts = true,
  cadenceSpm = 176,
  playbackRate = 0.5,
  paused = false,
  lineColor = STRIDE_WIREFRAME_PALETTE.line,
  backgroundColor = STRIDE_WIREFRAME_PALETTE.background,
  accessibilityLabel,
  testID,
}: StrideWireframeHeroProps) {
  const reduceMotion = useReducedMotion();
  const animate = !reduceMotion;
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  const phase = useSharedValue(REST_PHASE);
  const duration = cycleDurationMs(cadenceSpm, playbackRate);

  useEffect(() => {
    if (!animate) {
      cancelAnimation(phase);
      phase.value = REST_PHASE;
      return;
    }
    if (paused) {
      cancelAnimation(phase);
      return;
    }
    // Resume from wherever the loop is: ramp the remainder of this cycle first, then repeat
    // whole cycles. Linear — see the file header for why a loop must never ease.
    const current = ((phase.value % 1) + 1) % 1;
    phase.value = current;
    phase.value = withTiming(1, { duration: duration * (1 - current), easing: Easing.linear }, (finished) => {
      if (!finished) return;
      phase.value = 0;
      phase.value = withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false);
    });
    return () => cancelAnimation(phase);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- phase is a stable shared value
  }, [animate, paused, duration]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  };

  const a11y = accessibilityLabel
    ? ({ accessible: true, accessibilityRole: 'image', accessibilityLabel } as const)
    : ({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as const);

  return (
    <View
      testID={testID}
      style={[styles.container, { backgroundColor }, style]}
      onLayout={onLayout}
      pointerEvents="none"
      {...a11y}>
      {box && box.width > 0 && box.height > 0 && (
        <Stage
          box={box}
          animate={animate}
          phase={phase}
          chrome={chrome}
          trails={trails}
          readouts={readouts}
          lineColor={lineColor}
          backgroundColor={backgroundColor}
          testID={testID}
        />
      )}
    </View>
  );
}

type StageProps = {
  box: { width: number; height: number };
  animate: boolean;
  phase: ReturnType<typeof useSharedValue<number>>;
  chrome: boolean;
  trails: boolean;
  readouts: boolean;
  lineColor: string;
  backgroundColor: string;
  testID?: string;
};

/** Everything inside the measured box. Split out so the hero's own `onLayout` never re-renders
 *  the SVG tree for a same-size layout event. */
function Stage({ box, animate, phase, chrome, trails, readouts, lineColor, backgroundColor, testID }: StageProps) {
  const vb = useMemo(() => computeViewBox(box.width, box.height, 4), [box.width, box.height]);
  const groundY = GROUND_Y * VIEWBOX;
  const rulerY = groundY + RULER.dropBelowGround;
  const id = (suffix: string) => (testID ? `${testID}-${suffix}` : undefined);

  // Static chrome geometry. Built once per box size; none of it animates.
  const gridD = useMemo(() => {
    let d = '';
    const x0 = Math.ceil(vb.x / GRID_PITCH) * GRID_PITCH;
    const y0 = Math.ceil(vb.y / GRID_PITCH) * GRID_PITCH;
    for (let x = x0; x <= vb.x + vb.w; x += GRID_PITCH) d += `M${x} ${vb.y.toFixed(2)} v${vb.h.toFixed(2)} `;
    for (let y = y0; y <= vb.y + vb.h; y += GRID_PITCH) d += `M${vb.x.toFixed(2)} ${y} h${vb.w.toFixed(2)} `;
    return d.trim();
  }, [vb]);
  const groundD = `M${vb.x.toFixed(2)} ${groundY.toFixed(2)} h${vb.w.toFixed(2)}`;
  const groundDashD = `M${vb.x.toFixed(2)} ${(groundY + 2).toFixed(2)} h${vb.w.toFixed(2)}`;
  const rulerD = useMemo(() => {
    const span = RULER.x1 - RULER.x0;
    let d = `M${RULER.x0} ${rulerY} H${RULER.x1}`;
    for (let i = 0; i <= 8; i++) d += ` M${(RULER.x0 + (span * i) / 8).toFixed(2)} ${rulerY} v${RULER.tick}`;
    // Toe-off for each foot: the stance/swing boundary, the one event a gait plot always marks.
    for (const p of [STANCE.to, 0.5 + STANCE.to]) {
      d += ` M${(RULER.x0 + span * p).toFixed(2)} ${rulerY} v${RULER.majorTick}`;
    }
    return d;
  }, [rulerY]);

  const still = useMemo(() => solveStride(REST_PHASE), []);

  return (
    <>
      <Svg width={box.width} height={box.height} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}>
        {chrome && (
          <>
            <Path d={gridD} stroke={lineColor} strokeOpacity={Tier.grid} strokeWidth={Stroke.grid} fill="none" />
            <Path
              d={groundD}
              stroke={lineColor}
              strokeOpacity={Tier.ground}
              strokeWidth={Stroke.ground}
              fill="none"
            />
            {animate ? (
              <GroundDashes phase={phase} d={groundDashD} color={lineColor} testID={id('ground-dashes')} />
            ) : (
              <Path
                testID={id('ground-dashes')}
                d={groundDashD}
                stroke={lineColor}
                strokeOpacity={Tier.groundDash}
                strokeWidth={Stroke.groundDash}
                strokeDasharray={GROUND_DASH}
                strokeDashoffset={REST_PHASE * GROUND_TRAVEL_UNITS}
                fill="none"
              />
            )}
            <Path d={rulerD} stroke={lineColor} strokeOpacity={Tier.ruler} strokeWidth={Stroke.ruler} fill="none" />
            {animate ? (
              <RulerCursor phase={phase} rulerY={rulerY} color={lineColor} testID={id('cursor')} />
            ) : (
              <Path
                testID={id('cursor')}
                d={cursorD(REST_PHASE, rulerY)}
                stroke={lineColor}
                strokeWidth={Stroke.cursor}
                fill="none"
              />
            )}
            <RulerLabels rulerY={rulerY} color={lineColor} />
          </>
        )}

        {animate ? (
          <G testID={id('loop')}>
            {trails &&
              TRAIL_LAG.map((lag, i) => (
                <TrailLayer
                  key={lag}
                  phase={phase}
                  lag={lag}
                  color={lineColor}
                  opacity={i === 0 ? Tier.trail1 : Tier.trail2}
                  testID={id(`trail-${i}`)}
                />
              ))}
            <FigureLayer phase={phase} build={farLimbsPath} color={lineColor} opacity={Tier.far} width={Stroke.far} testID={id('far')} />
            <FigureLayer phase={phase} build={farMarkersPath} color={lineColor} opacity={Tier.far} width={Stroke.marker} fill={backgroundColor} testID={id('far-markers')} />
            <FigureLayer phase={phase} build={corePath} color={lineColor} opacity={Tier.near} width={Stroke.near} testID={id('core')} />
            <FigureLayer phase={phase} build={nearLimbsPath} color={lineColor} opacity={Tier.near} width={Stroke.near} testID={id('near')} />
            {readouts && (
              <FigureLayer phase={phase} build={readoutPath} color={lineColor} opacity={Tier.readout} width={Stroke.readout} dash="1.2 1.2" testID={id('readout')} />
            )}
            <FigureLayer phase={phase} build={nearMarkersPath} color={lineColor} opacity={Tier.near} width={Stroke.marker} fill={backgroundColor} testID={id('near-markers')} />
          </G>
        ) : (
          <G testID={id('still')}>
            <Path testID={id('far')} d={farLimbsPath(still)} {...strokeProps(lineColor, Tier.far, Stroke.far)} />
            <Path testID={id('far-markers')} d={farMarkersPath(still)} {...strokeProps(lineColor, Tier.far, Stroke.marker)} fill={backgroundColor} />
            <Path testID={id('core')} d={corePath(still)} {...strokeProps(lineColor, Tier.near, Stroke.near)} />
            <Path testID={id('near')} d={nearLimbsPath(still)} {...strokeProps(lineColor, Tier.near, Stroke.near)} />
            {readouts && (
              <Path testID={id('readout')} d={readoutPath(still)} {...strokeProps(lineColor, Tier.readout, Stroke.readout)} strokeDasharray="1.2 1.2" />
            )}
            <Path testID={id('near-markers')} d={nearMarkersPath(still)} {...strokeProps(lineColor, Tier.near, Stroke.marker)} fill={backgroundColor} />
          </G>
        )}
      </Svg>

      {readouts && (
        <KneeReadout
          animate={animate}
          phase={phase}
          color={lineColor}
          minDim={Math.min(box.width, box.height)}
          testID={id('knee-angle')}
        />
      )}
    </>
  );
}

function strokeProps(color: string, opacity: number, width: number) {
  return {
    stroke: color,
    strokeOpacity: opacity,
    strokeWidth: width,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    fill: 'none',
  } as const;
}

function cursorD(phase: number, rulerY: number): string {
  'worklet';
  const x = RULER.x0 + (RULER.x1 - RULER.x0) * phase;
  return `M${x.toFixed(2)} ${(rulerY - RULER.cursor).toFixed(2)} v${(RULER.cursor * 2).toFixed(2)}`;
}

type Phase = ReturnType<typeof useSharedValue<number>>;

function FigureLayer({
  phase,
  build,
  color,
  opacity,
  width,
  fill = 'none',
  dash,
  testID,
}: {
  phase: Phase;
  build: (s: ReturnType<typeof solveStride>) => string;
  color: string;
  opacity: number;
  width: number;
  fill?: string;
  dash?: string;
  testID?: string;
}) {
  const animatedProps = useAnimatedProps(() => {
    'worklet';
    return { d: build(solveStride(phase.value)) };
  });
  return (
    <AnimatedPath
      testID={testID}
      animatedProps={animatedProps}
      // The at-rest value, so the first painted frame is the still pose rather than an empty
      // path waiting for the driver's first tick.
      d={build(solveStride(REST_PHASE))}
      stroke={color}
      strokeOpacity={opacity}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={dash}
      fill={fill}
    />
  );
}

function TrailLayer({
  phase,
  lag,
  color,
  opacity,
  testID,
}: {
  phase: Phase;
  lag: number;
  color: string;
  opacity: number;
  testID?: string;
}) {
  const animatedProps = useAnimatedProps(() => {
    'worklet';
    return { d: nearLegPath(solveStride(phase.value - lag)) };
  });
  return (
    <AnimatedPath
      testID={testID}
      animatedProps={animatedProps}
      d={nearLegPath(solveStride(REST_PHASE - lag))}
      stroke={color}
      strokeOpacity={opacity}
      strokeWidth={Stroke.far}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  );
}

function GroundDashes({ phase, d, color, testID }: { phase: Phase; d: string; color: string; testID?: string }) {
  const animatedProps = useAnimatedProps(() => {
    'worklet';
    // Increasing the offset shifts the pattern toward the path's start (left), i.e. the ground
    // runs backward under a runner facing right, at the derived speed of the planted foot.
    return { strokeDashoffset: phase.value * GROUND_TRAVEL_UNITS };
  });
  return (
    <AnimatedPath
      testID={testID}
      animatedProps={animatedProps}
      d={d}
      stroke={color}
      strokeOpacity={Tier.groundDash}
      strokeWidth={Stroke.groundDash}
      strokeDasharray={GROUND_DASH}
      strokeDashoffset={REST_PHASE * GROUND_TRAVEL_UNITS}
      fill="none"
    />
  );
}

function RulerCursor({ phase, rulerY, color, testID }: { phase: Phase; rulerY: number; color: string; testID?: string }) {
  const animatedProps = useAnimatedProps(() => {
    'worklet';
    return { d: cursorD(phase.value, rulerY) };
  });
  return (
    <AnimatedPath
      testID={testID}
      animatedProps={animatedProps}
      d={cursorD(REST_PHASE, rulerY)}
      stroke={color}
      strokeWidth={Stroke.cursor}
      strokeLinecap="round"
      fill="none"
    />
  );
}

/** The ruler's captions: the cycle's name, and IC/TO (initial contact / toe-off — a gait
 *  plot's two canonical events) at each foot's marks. Texture, not copy: tiny, dim, mono. */
function RulerLabels({ rulerY, color }: { rulerY: number; color: string }) {
  const span = RULER.x1 - RULER.x0;
  const labelY = rulerY + RULER.majorTick + LABEL_SIZE + 0.6;
  const text = {
    fill: color,
    fillOpacity: Tier.label,
    fontSize: LABEL_SIZE,
    fontFamily: FontFamily.mono.regular,
    letterSpacing: 0.3,
  } as const;
  return (
    <>
      <SvgText {...text} x={RULER.x0} y={rulerY - RULER.cursor - 1.2} textAnchor="start">
        GAIT CYCLE
      </SvgText>
      <SvgText {...text} x={RULER.x1} y={rulerY - RULER.cursor - 1.2} textAnchor="end">
        100%
      </SvgText>
      {[0, 0.5].map((p) => (
        <SvgText key={`ic-${p}`} {...text} x={RULER.x0 + span * p} y={labelY} textAnchor="middle">
          IC
        </SvgText>
      ))}
      {[STANCE.to, 0.5 + STANCE.to].map((p) => (
        <SvgText key={`to-${p}`} {...text} x={RULER.x0 + span * p} y={labelY} textAnchor="middle">
          TO
        </SvgText>
      ))}
    </>
  );
}

/**
 * The live knee-flexion angle, top-left, as an instrument would print it. Under animation it is
 * a disabled `TextInput` whose `text` is written per frame on the UI thread (see the file
 * header); under reduced motion it is a plain `Text` with the still frame's value. Sized off the
 * hero's shorter side and capped at the theme's smallest text size, so it stays a caption.
 */
function KneeReadout({
  animate,
  phase,
  color,
  minDim,
  testID,
}: {
  animate: boolean;
  phase: Phase;
  color: string;
  minDim: number;
  testID?: string;
}) {
  const fontSize = Math.max(9, Math.min(FontSize.xs, minDim * 0.04));
  const inset = Math.round(minDim * 0.05);
  const animatedProps = useAnimatedProps<NativeTextProp>(() => {
    'worklet';
    return { text: `${Math.round(solveStride(phase.value).nearKneeFlexDeg)}°` };
  });
  const stillValue = `${Math.round(solveStride(REST_PHASE).nearKneeFlexDeg)}°`;
  const labelStyle = {
    color,
    fontSize,
    fontFamily: FontFamily.mono.regular,
    letterSpacing: Tracking.eyebrow,
    opacity: Tier.label,
  } as const;
  const valueStyle = { color, fontSize: fontSize * 1.6, fontFamily: FontFamily.mono.bold, lineHeight: fontSize * 2 } as const;
  return (
    <View style={[styles.readout, { top: inset, left: inset }]}>
      <Text style={labelStyle}>KNEE FLEX</Text>
      {animate ? (
        <AnimatedTextInput
          testID={testID}
          style={[valueStyle, styles.readoutInputReset]}
          defaultValue={stillValue}
          editable={false}
          focusable={false}
          showSoftInputOnFocus={false}
          underlineColorAndroid="transparent"
          animatedProps={animatedProps as never}
        />
      ) : (
        <Text testID={testID} style={valueStyle}>
          {stillValue}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  readout: {
    position: 'absolute',
  },
  readoutInputReset: {
    padding: 0,
    margin: 0,
  },
});
