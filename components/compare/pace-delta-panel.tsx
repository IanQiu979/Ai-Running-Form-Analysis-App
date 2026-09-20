/**
 * The per-pillar delta panel — the compare screen's third element, after the two readouts.
 * Re-cut to V23 (2026-09-21, change-list item 5): one `<SquareCard>` holding a row per pillar —
 * the letter in the same `Type.displayFigure` register `<PaceReadout>` uses for its own pillar
 * letter, and the certified delta sentence (which already names the pillar). The old "Cadence Arcs" `<DeltaRing>`
 * pair is retired with it — V23 replaced rings with the readout's own 2 px score bar
 * (`components/pace-readout.tsx`'s header: "a ring or a chart would encode the same number a
 * second way"), and there is no ring language left on the sheet to carry this panel's geometry
 * forward. A delta has no single bar to draw (it is a comparison between two already-drawn
 * readouts above it), so the row states the change in words instead of re-encoding it visually.
 *
 * IT COMPUTES THE DIFF ITSELF, from the two stored results, via `lib/compare.ts` — pure client-side
 * arithmetic on rows the caller already holds, exactly as Ruling 13 specifies. No network call, no
 * quota, no new state. `formatPillarDelta`/`pillarDeltaA11yLabel` are the ONLY functions that turn
 * a delta into copy here, so there is no code path that stringifies a not-assessed pillar as "+0"
 * or "No change" — the trap issue #60 names by name.
 *
 * A11Y: one accessible node per row, labelled by `pillarDeltaA11yLabel` — so VoiceOver reads
 * "Cadence changed by 6 points, from 64 to 70." and never a loose numeral off decoration.
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SquareCard } from '@/components/ui/square-card';
import { Ink, Space, Type } from '@/constants/v23-theme';
import { computePaceDeltas, formatPillarDelta, pillarDeltaA11yLabel } from '@/lib/compare';
import { pillarLabel, pillarLetter } from '@/lib/pace-readout';
import { PACE_PILLARS, type PaceResult } from '@shared/pace';

export type PaceDeltaPanelProps = {
  /** The EARLIER analysis's result — `lib/compare.ts`'s `orderByCreatedAt` fixes which is which,
   *  so a delta always reads "change from the earlier analysis to the later one". */
  from: PaceResult;
  /** The LATER analysis's result. */
  to: PaceResult;
  testID?: string;
};

/** The panel's own letter column — same reasoning `components/pace-readout.tsx` gives for its
 *  `LETTER_COLUMN_WIDTH`: composition, not a token, since no other screen wants this width. */
const LETTER_COLUMN_WIDTH = 32;

export function PaceDeltaPanel({ from, to, testID }: PaceDeltaPanelProps) {
  const deltas = useMemo(() => computePaceDeltas(from, to), [from, to]);

  return (
    <SquareCard testID={testID}>
      <View style={styles.content}>
        {PACE_PILLARS.map((id) => {
          const label = pillarLabel(id);
          const delta = deltas[id];
          return (
            <View
              key={id}
              testID={`compare-delta-row-${id}`}
              style={styles.row}
              accessible
              accessibilityLabel={pillarDeltaA11yLabel(label, delta)}>
              <Text style={[Type.displayFigure, styles.ink, styles.letter]}>{pillarLetter(id)}</Text>
              <Text style={[Type.body, styles.ink, styles.rowText]}>{formatPillarDelta(label, delta)}</Text>
            </View>
          );
        })}
      </View>
    </SquareCard>
  );
}

const styles = StyleSheet.create({
  ink: {
    color: Ink.ink,
  },
  content: {
    gap: Space.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  letter: {
    width: LETTER_COLUMN_WIDTH,
  },
  rowText: {
    flex: 1,
  },
});
