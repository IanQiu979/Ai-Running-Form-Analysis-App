/**
 * The PACE readout (issue #56; V23-08) — the four-pillar score block that is the product's
 * payload. The Overall block on top, then one card per pillar, each nested inside the readout
 * card exactly as the page draws it: letter, name, band word, numeral, an info control, a 2 px
 * bar, and one line of coaching prose.
 *
 * THE BARS. Each pillar's score is a 2 px `Ink.ink` fill on a 2 px `Ink.line` track, its width
 * the score as a percentage — the page's `<div style="width:78%">`. A ring or a chart would
 * encode the same number a second way; the page encodes it once, in a bar read against its own
 * full track, so a pillar is judged against 100 and not against the pillar above it.
 *
 * THE RULE THIS FILE MUST NEVER BREAK: `score: null` is a first-class, common state (every photo
 * submission reports two pillars this way — motion-over-time pillars a single frame cannot
 * show), not an error. A not-assessed pillar renders NO numeral (an em dash in the disabled
 * tone, the page's `—`), NO band word, and NO fill — only a dashed 2 px track and a plain-language
 * reason where the band word would sit. It must never read as a zero, and never as a greyed-out
 * fake score. `<PillarRow>` below enforces this by construction: the numeral/band-word/fill
 * elements are only ever mounted when `pillar.score !== null`. There is no code path that
 * stringifies `null` into "0", and no code path that turns it into a 0 % fill.
 *
 * FLAGS AND DRILLS ARE NOT HERE. The page puts them in the pillar detail modal only
 * (`components/pillar-detail-modal.tsx`, opened by each row's info control); a row carries the
 * score, the band and the one line of prose. Tier gating is never re-derived here (CLAUDE.md:
 * no business rules in the client) — the server already ships `flags: []` / `drills: []` for
 * Free and not-assessed pillars, and the modal renders whichever arrays it is given.
 *
 * MOTION. The page is static; the ONE thing that moves on this screen is the bar fill on a
 * fresh analysis. `firstReveal` (set by `app/result/[id].tsx` only when the `justAnalyzed` nav
 * param is present — ephemeral, never derived from storage, so it cannot replay on a re-open)
 * plus Reduce Motion OFF is the only combination that animates: each fill grows from 0 to its
 * score width over `Motion.duration.rise` on the move curve, staggered `Motion.stagger.item`
 * per row P → A → C → E, once the readout has laid out (`isRevealTriggered`: first-visible, not
 * on-mount) and the screen says it is ready (`revealReady`). A re-open, or a first reveal under
 * Reduce Motion, renders every bar at its final width at once with nothing scheduled.
 *
 * The fill animates `scaleX` from a left origin, never `width`: its layout width is the score
 * from the first frame, so no frame of the reveal triggers a layout pass — the same
 * "transform, never a dimension" discipline the rest of the app's motion follows. That is also
 * what `components/__tests__/pace-readout-reveal.test.tsx` locks: which first frame each mode
 * renders, since a Reanimated tween never advances under Jest.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { PillarDetailModal } from '@/components/pillar-detail-modal';
import { SquareCard } from '@/components/ui/square-card';
import { SquareIconButton } from '@/components/ui/square-icon-button';
import { InfoIcon } from '@/components/ui/v23-icons';
import { Copy } from '@/constants/copy';
import { ScoreBandLabel } from '@/constants/theme';
import { Ink, Layout, Motion, Space, Type } from '@/constants/v23-theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import {
  isRevealTriggered,
  notAssessedCopy,
  overallA11yLabel,
  pillarA11yLabel,
  pillarDetailA11yLabel,
  pillarLabel,
  pillarLetter,
} from '@/lib/pace-readout';
import { PACE_PILLARS, type PacePillarId, type PacePillarResult, type PaceResult } from '@shared/pace';

type Props = {
  result: PaceResult;
  /** True only on the fresh-analysis nav (`justAnalyzed=1`) — see this file's header. Defaults to
   * false, i.e. every call site that doesn't pass it renders finished, instantly. */
  firstReveal?: boolean;
  /** The screen's own "you may start" — `app/result/[id].tsx` passes it once its state is ready.
   * Defaults to `true` so a caller with nothing to wait on reveals the instant layout fires. See
   * `lib/pace-readout.ts`'s `isRevealTriggered` for the actual gate. */
  revealReady?: boolean;
};

/** The page's not-assessed numeral: an em dash in the disabled tone, where the score would be. */
const NOT_ASSESSED_GLYPH = '—';

/** The page's `width:32px` column the P / A / C / E letter sits in. Composition, not a token: it is
 *  the width of one condensed capital at `Type.displayFigure`, and no other screen has it. */
const LETTER_COLUMN_WIDTH = 32;

/** The page's `gap:2px` between a pillar's name and its band word — under `Space.xs`, and the
 *  only place on the sheet that steps off the 4 pt grid. */
const NAME_BAND_GAP = 2;

export function PaceReadout({ result, firstReveal = false, revealReady = true }: Props) {
  const reduceMotion = useReducedMotion();
  const animate = firstReveal && !reduceMotion;

  // The onLayout-gated reveal trigger (see this file's header), gated by `revealReady` via the
  // pure `isRevealTriggered` — fires once, ever, per mount, and only once both conditions are
  // true. Never attached when nothing animates.
  const [hasLaidOut, setHasLaidOut] = useState(false);
  const hasLaidOutRef = useRef(false);
  const handleFirstLayout = useCallback(() => {
    if (hasLaidOutRef.current) return;
    hasLaidOutRef.current = true;
    setHasLaidOut(true);
  }, []);
  const revealed = isRevealTriggered(hasLaidOut, revealReady);

  const { overall } = result;

  return (
    <View testID="pace-readout" style={styles.container} onLayout={animate ? handleFirstLayout : undefined}>
      {/* `accessibilityRole="header"`, not just `accessible`: this block IS the result screen's
          heading (the copy deck defines no `result.title`, so there is deliberately no other
          title element). Without the role `/result/[id]` had zero headings, so a screen reader
          user had no way to jump to the score and had to swipe the hero and both banners to
          reach it. The role rides on the single accessible node; the spoken label is the whole
          sentence. */}
      <View
        style={styles.overallBlock}
        accessible
        accessibilityRole="header"
        accessibilityLabel={overallA11yLabel(overall)}>
        <Text style={[Type.label, styles.ink2]}>{Copy.result.overall.label}</Text>
        {overall.score !== null && overall.band !== null ? (
          <View style={styles.overallRow}>
            <Text testID="overall-score" style={[Type.score, styles.ink]}>
              {overall.score}
            </Text>
            <Text testID="overall-band" style={[Type.label, styles.ink]}>
              {ScoreBandLabel[overall.band]}
            </Text>
          </View>
        ) : (
          // Not drawn on the page; the same honesty rule at the headline: an em dash in the
          // disabled tone where the numeral would be, and the generic reason beside it.
          <View style={styles.overallRow}>
            <Text style={[Type.score, styles.ink3]}>{NOT_ASSESSED_GLYPH}</Text>
            <Text testID="overall-not-assessed" style={[Type.note, styles.ink2, styles.overallNotAssessed]}>
              {Copy.result.pillar.notAssessed.generic}
            </Text>
          </View>
        )}
      </View>

      {PACE_PILLARS.map((id, index) => (
        <PillarRow
          key={id}
          pillarId={id}
          pillar={result.pillars[id]}
          animate={animate}
          index={index}
          triggered={revealed}
        />
      ))}
    </View>
  );
}

function PillarRow({
  pillarId,
  pillar,
  animate,
  index,
  triggered,
}: {
  pillarId: PacePillarId;
  pillar: PacePillarResult;
  animate: boolean;
  index: number;
  triggered: boolean;
}) {
  const label = pillarLabel(pillarId);
  // Narrowed once so every branch below reads the same two values and the types prove the
  // numeral / band word / fill can only mount together.
  const scored = pillar.score !== null && pillar.band !== null ? { score: pillar.score, band: pillar.band } : null;
  // Owned locally, not lifted to `<PaceReadout>` (only one pillar's modal can be open from one
  // row's own button at a time — no cross-row coordination needed).
  const [detailVisible, setDetailVisible] = useState(false);

  // The fill's first frame: empty when this row will animate, full otherwise. `scaleX` from a
  // left origin — the fill's layout width IS the score from the first frame (see the header).
  const fillScale = useSharedValue(animate ? 0 : 1);
  useEffect(() => {
    if (!animate || !triggered) return;
    fillScale.value = withDelay(
      index * Motion.stagger.item,
      withTiming(1, {
        duration: Motion.duration.rise,
        easing: Easing.bezier(...Motion.curve.move),
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fillScale is a stable shared value
  }, [animate, triggered, index]);
  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: fillScale.value }],
  }));

  return (
    <SquareCard testID={`pillar-row-${pillarId}`} style={styles.pillarCard}>
      <View style={styles.pillarHeaderRow}>
        {/* The accessible-collapsing group is scoped to JUST the letter/name/score — the info
            button below is a SIBLING, not a child, of this node. A button nested inside this
            `accessible` view would have its own accessibilityLabel/role dropped in favour of one
            opaque parent label (issue #62's failure mode). */}
        <View
          testID={`pillar-header-${pillarId}`}
          style={styles.pillarHeaderInfo}
          accessible
          accessibilityLabel={pillarA11yLabel(label, pillar)}>
          <Text style={[Type.displayFigure, styles.ink, styles.pillarLetter]}>{pillarLetter(pillarId)}</Text>
          <View style={styles.pillarNameBlock}>
            <Text style={[Type.h2, styles.ink]}>{label}</Text>
            {scored ? (
              <Text testID={`pillar-band-${pillarId}`} style={[Type.label, styles.ink2]}>
                {ScoreBandLabel[scored.band]}
              </Text>
            ) : (
              // ONE statement about the submission, where the band word would sit. Keyed off
              // `notAssessedReason`, so it is media-aware ('needsVideo' for a photo,
              // 'singleFrameFromVideo' when the runner sent a video and only one frame reached
              // the analysis). Hidden from the a11y tree because the group's own label
              // (`pillarA11yLabel`) already speaks this exact sentence.
              <Text
                testID={`pillar-not-assessed-${pillarId}`}
                style={[Type.note, styles.ink2]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants">
                {notAssessedCopy(pillar.notAssessedReason)}
              </Text>
            )}
          </View>
          {scored ? (
            <Text testID={`pillar-score-${pillarId}`} style={[Type.metric, styles.ink]}>
              {scored.score}
            </Text>
          ) : (
            <Text style={[Type.metric, styles.ink3]}>{NOT_ASSESSED_GLYPH}</Text>
          )}
        </View>
        <SquareIconButton
          testID={`pillar-detail-button-${pillarId}`}
          accessibilityLabel={pillarDetailA11yLabel(label)}
          accessibilityHint={Copy.result.pillar.detail.a11yHint}
          onPress={() => setDetailVisible(true)}
          bleed="right">
          <InfoIcon />
        </SquareIconButton>
      </View>

      <PillarDetailModal
        visible={detailVisible}
        onDismiss={() => setDetailVisible(false)}
        pillarId={pillarId}
        pillar={pillar}
      />

      {/* THE BAR. A scored pillar: a 2 px `line` track with the `ink` fill at the score's width.
          Not assessed: a dashed 2 px rule and NO fill node at all — "could not be scored" must be
          structurally distinct from "scored zero", not a fill at 0 % (M1, v23-ux-audit-r1). */}
      {scored ? (
        <View testID={`pillar-bar-track-${pillarId}`} style={styles.barTrack}>
          <Animated.View
            testID={`pillar-bar-${pillarId}`}
            style={[styles.barFill, { width: `${scored.score}%` }, fillStyle]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </View>
      ) : (
        <View testID={`pillar-bar-track-${pillarId}`} style={styles.barTrackNotAssessed} />
      )}

      {/* The coach's own line — the one sentence the user paid for. Plain text: the page does not
          reveal it word by word. Present on a scored pillar, and on a not-assessed Pro/Elite
          pillar the model wrote a note for (a stop-running note, say) — the reason line above and
          this prose are two facts, not two accounts of the same one. */}
      {pillar.feedback ? (
        <Text testID={`pillar-feedback-${pillarId}`} style={[Type.body, styles.ink2]}>
          {pillar.feedback}
        </Text>
      ) : null}
    </SquareCard>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Space.xl,
  },
  ink: {
    color: Ink.ink,
  },
  ink2: {
    color: Ink.ink2,
  },
  ink3: {
    color: Ink.ink3,
  },
  overallBlock: {
    gap: Space.sm,
  },
  overallRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: Space.md,
  },
  overallNotAssessed: {
    flex: 1,
  },
  pillarCard: {
    gap: Space.md,
  },
  pillarHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.md,
  },
  // The accessible-collapsing group (letter/name/score) — `flex: 1` so it takes the row's full
  // width minus the info control.
  pillarHeaderInfo: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: Space.md,
  },
  pillarLetter: {
    width: LETTER_COLUMN_WIDTH,
  },
  pillarNameBlock: {
    flex: 1,
    gap: NAME_BAND_GAP,
  },
  barTrack: {
    backgroundColor: Ink.line,
    height: Layout.scoreBar,
  },
  barFill: {
    backgroundColor: Ink.ink,
    height: Layout.scoreBar,
    transformOrigin: 'left',
  },
  barTrackNotAssessed: {
    borderColor: Ink.line,
    borderStyle: 'dashed',
    borderTopWidth: Layout.scoreBar,
    height: 0,
  },
});
