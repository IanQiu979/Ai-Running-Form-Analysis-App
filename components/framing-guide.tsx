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
 * constants below rather than `constants/theme.ts` spacing tokens; color DOES come from theme
 * tokens, same as everywhere else in the app. This
 * file's original justification also cited `react-native-svg` not being installed; it IS installed
 * as of 2026-08-02 (see `components/annotation-lines.tsx`'s header for the record), and that half
 * of the reasoning is struck rather than left standing as a false claim. Plain views remain the
 * right choice here for the reason above, not for a missing dependency.
 *
 * Purely decorative: hidden from the accessibility tree (brief §7: "Decorative annotations are
 * hidden from the a11y tree"). The guidance a screen reader user needs is the sibling
 * `capture.overlay.tip` text, rendered separately by `app/capture/record.tsx`.
 *
 * LEGIBILITY, fixed 2026-09-01. This guide used to be drawn in `colors.hairline` at
 * `Opacity.disabled` — i.e. in the one colour role `constants/theme.ts` deliberately holds UNDER
 * 3:1 against app surfaces (there is a guard in `theme-contrast.test.ts` keeping it there), dimmed
 * to 40%, composited over LIVE CAMERA VIDEO, which no contrast proof in this repo covers at all.
 * Over a bright or busy scene the figure was effectively invisible, and an invisible framing guide
 * is worse than none: it is the only thing standing between a runner and a badly framed clip, whose
 * downstream cost is "not assessed" pillars and a useless result (see the top of this docblock).
 *
 * The fix has two halves, and both are needed. Every stroke is now drawn in `text.primary` — the
 * one foreground role with a real contrast obligation — at FULL opacity, because dimming text-scale
 * marks with `opacity` is the exact failure mode H3 (v23-ux-audit-r1) closed elsewhere in this app.
 * And each part of the guide sits on its own `Glass.*.scrim` plate: the token whose documented role
 * is "legibility scrim laid over photographic media before text sits on it", which is what turns an
 * unknown backdrop into a known one. The plates are deliberately shaped to the guide (a rounded
 * plate behind the figure, a pill behind the ground rule) rather than a full-screen wash — the
 * viewfinder is what the user is framing with, and it must stay readable.
 */
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Colors, Glass, Radius, Spacing, type ColorScheme, type ThemeColors } from '@/constants/theme';
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
  const styles = useMemo(() => createStyles(colors, scheme), [colors, scheme]);

  return (
    <View
      style={styles.container}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      accessible={false}>
      {/* The level/ground reference line — ties to "level camera" in capture.overlay.tip. The rule
          rides its own scrim pill so it stays a readable line over whatever is behind it. */}
      <View style={styles.groundPlate}>
        <View style={styles.groundLine} />
      </View>

      {/* The figure's scrim plate doubles as a target region: it shows WHERE in frame the runner
          should be, not just what pose to look for. */}
      <View style={styles.figurePlate}>
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
    </View>
  );
}

function createStyles(colors: ThemeColors, scheme: ColorScheme) {
  const glass = Glass[scheme];
  return StyleSheet.create({
    container: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    groundPlate: {
      position: 'absolute',
      bottom: '18%',
      left: '10%',
      right: '10%',
      justifyContent: 'center',
      paddingVertical: Spacing.xs,
      borderRadius: Radius.pill,
      backgroundColor: glass.scrim,
    },
    groundLine: {
      height: StyleSheet.hairlineWidth * 3,
      backgroundColor: colors.text.primary,
    },
    figurePlate: {
      padding: Spacing.lg,
      borderRadius: Radius.card,
      backgroundColor: glass.scrim,
    },
    figure: {
      width: FIGURE_WIDTH,
      height: FIGURE_HEIGHT,
    },
    head: {
      position: 'absolute',
      top: 0,
      left: (FIGURE_WIDTH - HEAD_SIZE) / 2,
      width: HEAD_SIZE,
      height: HEAD_SIZE,
      borderRadius: HEAD_SIZE / 2,
      borderWidth: STROKE_WIDTH,
      borderColor: colors.text.primary,
    },
    torso: {
      position: 'absolute',
      top: HEAD_SIZE,
      left: (FIGURE_WIDTH - STROKE_WIDTH) / 2,
      width: STROKE_WIDTH,
      height: TORSO_HEIGHT,
      backgroundColor: colors.text.primary,
    },
    limb: {
      position: 'absolute',
      width: STROKE_WIDTH,
      height: LIMB_LENGTH,
      backgroundColor: colors.text.primary,
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
