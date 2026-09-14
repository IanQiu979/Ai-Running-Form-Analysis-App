/**
 * The side-on framing guide (issue #36; V23-10, third artboard) overlaid on the camera preview.
 * `pace_framework.md` requires a side-on, full-body, level shot for Posture/Cadence/Elasticity to
 * be assessable at all — a badly framed clip produces "not assessed" pillars
 * (`result.pillar.notAssessed.angle`) and a useless result, so this guide is the one thing
 * standing between a runner and that outcome.
 *
 * WHAT IT DRAWS is the page's own SVG, verbatim: one `Svg` on the page's 393 x 852 canvas, a
 * dashed 200 x 500 box (`x=96 y=180`, `stroke-dasharray 4 6`) showing WHERE in frame the runner
 * should be, and a solid ground line at `y=680` from gutter to gutter tying to "level camera".
 * Both strokes are 1 pt `ink` at the page's 70 % opacity. `preserveAspectRatio="none"` stretches
 * the canvas to whatever the live viewfinder measures, so the box keeps the page's proportion of
 * the screen on every phone rather than a fixed point size — the guide is a target REGION, not
 * an illustration, which is also why the running-stance figure the 2026-09-01 version drew (and
 * its scrim plates) is gone: the page replaced it with the box and the line.
 *
 * Purely decorative: hidden from the accessibility tree (brief §7: "Decorative annotations are
 * hidden from the a11y tree"). The guidance a screen reader user needs is the sibling
 * `capture.overlay.tip` text, rendered separately by `app/capture/record.tsx`.
 */
import { StyleSheet } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

import { Ink, Layout } from '@/constants/v23-theme';

/** The page's guide geometry on its 393 x 852 canvas — art, not layout spacing. */
const GUIDE = {
  box: { x: 96, y: 180, width: 200, height: 500 },
  ground: { y: 680, x1: Layout.gutter, x2: Layout.canvas.width - Layout.gutter },
  dash: '4 6',
  strokeWidth: 1,
  opacity: 0.7,
} as const;

export function FramingGuide() {
  return (
    <Svg
      testID="framing-guide"
      style={StyleSheet.absoluteFill}
      viewBox={`0 0 ${Layout.canvas.width} ${Layout.canvas.height}`}
      preserveAspectRatio="none"
      fill="none"
      stroke={Ink.ink}
      strokeWidth={GUIDE.strokeWidth}
      opacity={GUIDE.opacity}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      accessible={false}>
      {/* The target region: the runner's full body belongs inside this box. */}
      <Rect
        testID="framing-guide-box"
        x={GUIDE.box.x}
        y={GUIDE.box.y}
        width={GUIDE.box.width}
        height={GUIDE.box.height}
        strokeDasharray={GUIDE.dash}
      />
      {/* The level/ground reference line — ties to the "level camera" half of the tip. */}
      <Line
        testID="framing-guide-ground"
        x1={GUIDE.ground.x1}
        y1={GUIDE.ground.y}
        x2={GUIDE.ground.x2}
        y2={GUIDE.ground.y}
      />
    </Svg>
  );
}
