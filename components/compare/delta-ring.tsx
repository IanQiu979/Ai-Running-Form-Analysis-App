/**
 * The compare screen's delta ring — the Cadence Arcs motif applied to a CHANGE rather than to a
 * score (issue #60's per-pillar deltas; `docs/design/frontend-design-brief.md` §4 screen 9).
 *
 * TWO CONCENTRIC `<ArcRing>`s, which is the whole idea: the OUTER arc is the later analysis's
 * score, the INNER one is the earlier analysis's, and the gap between the two sweeps IS the delta,
 * drawn. That is the motif's own metaphor — a ripple radiating outward from a footstrike — used
 * for the one thing this screen exists to show, and it makes the compare view read as the same
 * system as the two readouts above it instead of as a list of sentences under them.
 *
 * WHAT ENCODES WHAT, and why there are four channels rather than one: arc LENGTH (both rings),
 * arc COLOUR (each side's own server-issued band), the numeral in the middle (the later score),
 * and — beside this ring, at the call site — the certified delta sentence ("+6 Posture"). Colour
 * is never alone, exactly as the design brief §7 requires.
 *
 * THE RULE THIS FILE INHERITS FROM `lib/compare.ts` AND MUST NEVER BREAK: a pillar that is
 * `score: null` on either side is NOT a zero and NOT a delta of zero. Each ring reads its OWN
 * side's nullness and hands `<ArcRing>` a `fraction` of `null`, which draws the dashed, empty
 * track and mounts no fill arc at all — so a not-assessed side is structurally a different picture
 * from a side that scored 0. There is no code path here that turns a null into a sweep, and the
 * centre numeral is mounted only when the later side carries a real score.
 *
 * NO BAND IS COMPUTED HERE. Each side's `band` comes off the server's own `PacePillarResult`
 * (`@shared/pace`) exactly as `components/pace-readout.tsx` takes it — the client displays the
 * band it was given and is never the authority for which band a score falls in.
 *
 * DECORATIVE. Both rings hide their own SVG from the a11y tree, and the caller wraps this and its
 * sentence in one `accessible` node labelled by `pillarDeltaA11yLabel` — so a screen reader hears
 * one honest sentence per pillar, never a loose numeral.
 */
import { StyleSheet, Text, View } from 'react-native';

import { ArcRing } from '@/components/ui/arc-ring';
import { Arc, Colors, FontFamily, FontSize, Score, type ColorScheme } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { PacePillarResult } from '@shared/pace';

/** Ring geometry — COMPOSITION, not tokens, for the same reason `components/pace-readout.tsx`
 *  keeps its own two ring sizes local: these numbers say how loud a delta is on THIS screen, and
 *  no other screen wants them. The outer ring is deliberately thicker than the inner one so
 *  "now" and "before" are told apart by weight and position, never by colour alone. */
const OUTER_SIZE = 72;
const OUTER_STROKE = 6;
const INNER_SIZE = 50;
const INNER_STROKE = 3;

export type DeltaRingProps = {
  /** The earlier analysis's pillar — drawn as the inner, thinner arc. */
  from: PacePillarResult;
  /** The later analysis's pillar — the outer arc, and the numeral in the middle. */
  to: PacePillarResult;
  testID?: string;
};

export function DeltaRing({ from, to, testID }: DeltaRingProps) {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];

  return (
    <ArcRing
      testID={testID}
      size={OUTER_SIZE}
      strokeWidth={OUTER_STROKE}
      fraction={to.score !== null ? to.score / 100 : null}
      color={to.band !== null ? Score[to.band][scheme].fill : Arc[scheme].ornament}>
      <ArcRing
        testID={testID ? `${testID}-before` : undefined}
        size={INNER_SIZE}
        strokeWidth={INNER_STROKE}
        fraction={from.score !== null ? from.score / 100 : null}
        color={from.band !== null ? Score[from.band][scheme].fill : Arc[scheme].ornament}>
        {to.score !== null ? (
          <View style={styles.center}>
            <Text
              testID={testID ? `${testID}-score` : undefined}
              style={[styles.numeral, { color: colors.text.primary }]}
              numberOfLines={1}
              // Dynamic Type guard (brief §7: never hard-clip the score readout). The ring never
              // clips its centred content, so the worst case is a numeral growing toward the inner
              // arc rather than one cut off by it.
              adjustsFontSizeToFit
              minimumFontScale={0.6}>
              {to.score}
            </Text>
          </View>
        ) : null}
      </ArcRing>
    </ArcRing>
  );
}

const styles = StyleSheet.create({
  center: {
    // Bounded by the inner ring's own inner diameter, so `adjustsFontSizeToFit` has a width to
    // shrink against rather than growing the layout.
    width: INNER_SIZE - INNER_STROKE * 2,
    alignItems: 'center',
  },
  numeral: {
    fontFamily: FontFamily.mono.bold,
    fontSize: FontSize.sm,
    textAlign: 'center',
  },
});
