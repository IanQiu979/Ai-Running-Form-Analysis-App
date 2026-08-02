/**
 * The side-on framing guide (issue #36, design brief §4.4): "a faint full-body figure outline"
 * overlaid on the camera preview, drawn in a running stance so it actually communicates
 * side-on-full-body-level-camera rather than just being decorative. `pace_framework.md`
 * requires a side-on, full-body, level shot for Posture/Cadence/Elasticity to be assessable at
 * all — a badly framed clip produces "not assessed" pillars (`result.pillar.notAssessed.angle`)
 * and a useless result, so this guide is the one thing standing between a runner and that
 * outcome.
 *
 * No illustration library exists in this project (§8 of the brief rules out a "custom
 * illustration system" — read as ruling out a whole ASSET PIPELINE, not this one guide, which
 * the brief itself specs by name), so the figure is
 * built from plain `View`s — a small set of positioned/rotated rectangles and a circle, the same
 * "primitive shapes, theme tokens for color" approach `components/consent-gate.tsx`'s checkbox
 * already uses. The figure's own proportions (limb lengths, angles) are art geometry, not
 * layout — same category as `assets/source/mark-*.svg`'s fixed anatomy — so they're named local
 * constants below rather than `constants/theme.ts` spacing tokens; color and opacity DO come
 * from theme tokens (`hairline`, `Opacity.disabled`), same as everywhere else in the app. This
 * file's original justification also cited `react-native-svg` not being installed; it IS installed
 * as of 2026-08-02 (see `components/annotation-lines.tsx`'s header for the record), and that half
 * of the reasoning is struck rather than left standing as a false claim. Plain views remain the
 * right choice here for the reason above, not for a missing dependency.
 *
 * Purely decorative: hidden from the accessibility tree (brief §7: "Decorative annotations are
 * hidden from the a11y tree"). The guidance a screen reader user needs is the sibling
 * `capture.overlay.tip` text, rendered separately by `app/capture/record.tsx`.
 */
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Colors, Opacity, type ColorScheme, type ThemeColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Figure geometry — art proportions, not layout spacing (see file header).
const FIGURE_WIDTH = 120;
const FIGURE_HEIGHT = 220;
const STROKE_WIDTH = 3;
const HEAD_SIZE = 26;
const TORSO_HEIGHT = 70;
const LIMB_LENGTH = 62;

export function FramingGuide() {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View
      style={styles.container}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      accessible={false}>
      {/* The level/ground reference line — ties to "level camera" in capture.overlay.tip. */}
      <View style={styles.groundLine} />

      <View style={styles.figure}>
        <View style={styles.head} />
        <View style={styles.torso} />
        {/* Trailing arm, swung back — mid-stride, side-on running form. */}
        <View style={[styles.limb, styles.armBack]} />
        {/* Leading arm, swung forward. */}
        <View style={[styles.limb, styles.armForward]} />
        {/* Trailing leg, pushing off behind. */}
        <View style={[styles.limb, styles.legBack]} />
        {/* Leading leg, driving forward. */}
        <View style={[styles.limb, styles.legForward]} />
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    groundLine: {
      position: 'absolute',
      bottom: '18%',
      left: '10%',
      right: '10%',
      height: StyleSheet.hairlineWidth * 3,
      backgroundColor: colors.hairline,
      opacity: Opacity.disabled,
    },
    figure: {
      width: FIGURE_WIDTH,
      height: FIGURE_HEIGHT,
      opacity: Opacity.disabled,
    },
    head: {
      position: 'absolute',
      top: 0,
      left: (FIGURE_WIDTH - HEAD_SIZE) / 2,
      width: HEAD_SIZE,
      height: HEAD_SIZE,
      borderRadius: HEAD_SIZE / 2,
      borderWidth: STROKE_WIDTH,
      borderColor: colors.hairline,
    },
    torso: {
      position: 'absolute',
      top: HEAD_SIZE,
      left: (FIGURE_WIDTH - STROKE_WIDTH) / 2,
      width: STROKE_WIDTH,
      height: TORSO_HEIGHT,
      backgroundColor: colors.hairline,
    },
    limb: {
      position: 'absolute',
      width: STROKE_WIDTH,
      height: LIMB_LENGTH,
      backgroundColor: colors.hairline,
      borderRadius: STROKE_WIDTH / 2,
    },
    armBack: {
      top: HEAD_SIZE + 6,
      left: FIGURE_WIDTH / 2,
      transform: [{ translateX: -STROKE_WIDTH / 2 }, { rotate: '35deg' }],
    },
    armForward: {
      top: HEAD_SIZE + 6,
      left: FIGURE_WIDTH / 2,
      transform: [{ translateX: -STROKE_WIDTH / 2 }, { rotate: '-50deg' }],
    },
    legBack: {
      top: HEAD_SIZE + TORSO_HEIGHT,
      left: FIGURE_WIDTH / 2,
      transform: [{ translateX: -STROKE_WIDTH / 2 }, { rotate: '-30deg' }],
    },
    legForward: {
      top: HEAD_SIZE + TORSO_HEIGHT,
      left: FIGURE_WIDTH / 2,
      transform: [{ translateX: -STROKE_WIDTH / 2 }, { rotate: '55deg' }],
    },
  });
}
