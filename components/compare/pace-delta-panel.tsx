/**
 * The per-pillar delta panel — the compare screen's third element, after the two readouts.
 *
 * WHY THIS IS A COMPONENT AND NOT FOUR ROWS INSIDE `app/compare.tsx`: until the Cadence Arcs pass
 * these deltas were four plain text lines with no motif treatment at all, sitting under two ring
 * readouts — the screen said "arcs" twice and then stopped. This panel is where the motif carries
 * through: a `<CornerArcs>` ripple in the panel's own corner (the same ornament every screen wears,
 * at card scale) and a `<DeltaRing>` per pillar (the before/after arc pair — see that file).
 *
 * IT COMPUTES THE DIFF ITSELF, from the two stored results, via `lib/compare.ts` — pure client-side
 * arithmetic on rows the caller already holds, exactly as Ruling 13 specifies. No network call, no
 * quota, no new state. `formatPillarDelta`/`pillarDeltaA11yLabel` are the ONLY functions that turn
 * a delta into copy here, so there is no code path that stringifies a not-assessed pillar as "+0"
 * or "No change" — the trap issue #60 names by name.
 *
 * SURFACE, NOT WASH. Score fills, score text and secondary text are not proven on `Gradient.page`
 * (`constants/theme.ts`'s `Gradient` contract), and this panel carries all three, so it is an
 * opaque `<SurfaceCard>`. `padding={0}` with an inner padded content node is deliberate and is the
 * documented use of that prop: an absolutely-positioned ornament resolves against its parent's
 * PADDING box, so a ripple inside a padded card would float 24pt in from the corner instead of
 * radiating from it.
 *
 * A11Y: one accessible node per row, labelled by `pillarDeltaA11yLabel` — so VoiceOver reads
 * "Cadence changed by 6 points, from 64 to 70." and never a loose numeral off a decorative ring.
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DeltaRing } from '@/components/compare/delta-ring';
import { CornerArcs } from '@/components/ui/corner-arcs';
import { SurfaceCard } from '@/components/ui/surface-card';
import {
  Colors,
  FontFamily,
  FontSize,
  LineHeight,
  Spacing,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { computePaceDeltas, formatPillarDelta, pillarDeltaA11yLabel } from '@/lib/compare';
import { pillarLabel, pillarLetter } from '@/lib/pace-readout';
import { PACE_PILLARS, type PaceResult } from '@shared/pace';

/** The panel ornament's radius. Smaller than a screen's own corner ripple (which scales with the
 *  viewport) because this one is scaled to a card, not to a device — a screen-sized ripple inside a
 *  card is a smudge, and a card-sized one on a screen is a full stop. */
const ORNAMENT_RADIUS = 132;
/** Quieter than the screen ornament's default: it is drawn on an opaque surface directly behind
 *  reading matter, not on the wash behind a whole layout. */
const ORNAMENT_OPACITY = 0.3;

export type PaceDeltaPanelProps = {
  /** The EARLIER analysis's result — `lib/compare.ts`'s `orderByCreatedAt` fixes which is which,
   *  so a delta always reads "change from the earlier analysis to the later one". */
  from: PaceResult;
  /** The LATER analysis's result. */
  to: PaceResult;
  testID?: string;
};

export function PaceDeltaPanel({ from, to, testID }: PaceDeltaPanelProps) {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const deltas = useMemo(() => computePaceDeltas(from, to), [from, to]);

  return (
    <SurfaceCard testID={testID} padding={0}>
      <CornerArcs
        testID={testID ? `${testID}-ornament` : undefined}
        corner="topRight"
        radius={ORNAMENT_RADIUS}
        opacity={ORNAMENT_OPACITY}
      />
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
              <DeltaRing
                testID={`compare-delta-ring-${id}`}
                from={from.pillars[id]}
                to={to.pillars[id]}
              />
              <View style={styles.rowText}>
                <Text style={styles.pillarLetter}>{pillarLetter(id)}</Text>
                <Text style={styles.deltaText}>{formatPillarDelta(label, delta)}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </SurfaceCard>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    content: {
      padding: Spacing.xl,
      gap: Spacing.lg,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.lg,
    },
    /** `flex: 1` + `flexWrap`, so a long delta sentence at large Dynamic Type reflows beside the
     *  ring instead of pushing it off the card (brief §7: reflow, never clip). */
    rowText: {
      flex: 1,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'baseline',
      gap: Spacing.sm,
    },
    pillarLetter: {
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.md,
      color: colors.text.primary,
      // minWidth, not width — the same Dynamic Type clipping fix `components/pace-readout.tsx`
      // applies to its own pillar letter (issue #63).
      minWidth: Spacing.xl,
    },
    deltaText: {
      flex: 1,
      fontFamily: FontFamily.mono.regular,
      fontSize: FontSize.sm,
      lineHeight: FontSize.sm * LineHeight.body,
      color: colors.text.primary,
    },
  });
}
