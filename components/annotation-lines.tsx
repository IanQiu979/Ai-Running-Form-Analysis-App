/**
 * The result hero's three annotation marks (V23-08): a ground rule, a dashed posture line and a
 * landing marker, drawn over the stored frame as ONE fixed piece of geometry — the page's own
 * `<svg viewBox="0 0 393 524">` transcribed verbatim. They render fully drawn, always: the page
 * is static, so the draw-on animation, its stagger, its start delay and its `onComplete` callback
 * (which used to gate the readout's reveal) are gone with it.
 *
 * WHY THE GEOMETRY LIVES HERE AND IS NOT A PROP: `@shared/pace` carries no per-joint coordinates,
 * and this screen has always refused to invent overlay geometry that pretends to be a measurement
 * (see `app/result/[id].tsx`'s header). What the page draws is art — the same three lines on every
 * result, at the same place — so the file that owns them is the file that draws them, and there
 * is no caller-supplied position to get wrong.
 *
 * `preserveAspectRatio="none"` is load-bearing: the hero box is `width: 100%` at a 3:4 aspect,
 * and the page's viewBox is 393 x 524 (the same 3:4), so the lines scale with the box on any
 * device width and the marker stays where the page put it.
 *
 * Decorative: hidden from the accessibility tree (the frame's own alt text already says "with
 * posture and ground lines marked") and transparent to touches.
 */
import { StyleSheet } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';

import { Ink, Layout } from '@/constants/v23-theme';

/** The page's canvas for this SVG: the hero at the design width, 3:4. */
const VIEWBOX_WIDTH = Layout.canvas.width;
const VIEWBOX_HEIGHT = (Layout.canvas.width * 4) / 3;

/** The page's three marks, in its coordinates. */
const GROUND = { x1: 24, y1: 440, x2: 369, y2: 440 } as const;
const POSTURE = { x1: 200, y1: 60, x2: 182, y2: 440, dash: '3 5' } as const;
const LANDING = { cx: 182, cy: 440, r: 5 } as const;

type AnnotationLinesProps = {
  /** Becomes `${testID}-ground` / `-posture` / `-landing` on the three marks. */
  testID?: string;
};

export function AnnotationLines({ testID }: AnnotationLinesProps) {
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      preserveAspectRatio="none"
      fill="none"
      stroke={Ink.ink}
      strokeWidth={Layout.hairline}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}>
      <Line testID={testID ? `${testID}-ground` : undefined} {...GROUND} />
      <Line
        testID={testID ? `${testID}-posture` : undefined}
        x1={POSTURE.x1}
        y1={POSTURE.y1}
        x2={POSTURE.x2}
        y2={POSTURE.y2}
        strokeDasharray={POSTURE.dash}
      />
      <Circle testID={testID ? `${testID}-landing` : undefined} {...LANDING} />
    </Svg>
  );
}
