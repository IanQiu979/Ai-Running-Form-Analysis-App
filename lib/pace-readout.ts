/**
 * Pure display-logic helpers for the PACE readout (issue #56) — kept out of
 * `components/pace-readout.tsx` so they get real unit-test coverage; screens/components aren't
 * where CLAUDE.md wants this kind of logic proven ("New logic added to `lib/` ... should get a
 * test alongside it. Screens are not unit-tested for now.").
 *
 * Every function here is a pure mapping from the `@shared/pace` contract to copy-deck strings —
 * nothing fabricates a score, a band, or a reason. The one rule every code path in this file
 * must uphold: `score: null` never becomes the string "0".
 */
import { Copy } from '@/constants/copy';
import { ScoreBandLabel } from '@/constants/theme';
import {
  PACE_PILLARS,
  hasSafetySignal,
  type PaceNotAssessedReason,
  type PaceOverall,
  type PacePillarId,
  type PacePillarResult,
  type PaceResult,
} from '@shared/pace';

const PILLAR_LABELS: Record<PacePillarId, string> = {
  posture: Copy.result.pillar.posture.label,
  armSwing: Copy.result.pillar.armSwing.label,
  cadence: Copy.result.pillar.cadence.label,
  elasticity: Copy.result.pillar.elasticity.label,
};

/** `Copy.result.pillar.<id>.label` by pillar id, in one place so callers never hand-index the
 * `Copy` tree themselves. */
export function pillarLabel(id: PacePillarId): string {
  return PILLAR_LABELS[id];
}

/** The P/A/C/E single-letter glyph shown beside each pillar's name (design brief §3's pillar-row
 * diagram). Not a copy-deck string — the deck doesn't define per-pillar letter glyphs, and the
 * letters are just the PACE acronym itself, already fixed by `PacePillarId`'s own four values —
 * so this is a derived design constant, not localizable prose, and stays in `lib/` rather than
 * `constants/copy.ts`. */
const PILLAR_LETTERS: Record<PacePillarId, string> = {
  posture: 'P',
  armSwing: 'A',
  cadence: 'C',
  elasticity: 'E',
};

export function pillarLetter(id: PacePillarId): string {
  return PILLAR_LETTERS[id];
}

/** How many of the four pillars carry a real score. Feeds the partial-result banner ("we could
 * confidently score {n} of 4 pillars") — deliberately NOT used to infer `isFallback` itself.
 * `PaceAnalysisOutcome`'s own doc comment is explicit that a legitimate, non-fallback result can
 * just as validly have several pillars null (every photo submission reports two), so a null-
 * pillar count can never stand in for the server's own `isFallback` provenance flag. */
export function countAssessedPillars(result: PaceResult): number {
  return PACE_PILLARS.filter((id) => result.pillars[id].score !== null).length;
}

/**
 * Maps a not-assessed pillar's reason to its copy-deck string. Falls back to
 * `Copy.result.pillar.notAssessed.generic` for a reason the deck hasn't named a string for, or
 * no reason at all — `pace.ts`'s own doc comment on `PaceNotAssessedReason` is explicit that a
 * model response is not structurally required to report exactly `'angle' | 'needsVideo'`, and an
 * otherwise-honest "couldn't assess this" must still render, never be silently dropped.
 */
export function notAssessedCopy(reason: PaceNotAssessedReason | undefined): string {
  if (reason === 'angle') return Copy.result.pillar.notAssessed.angle;
  if (reason === 'needsVideo') return Copy.result.pillar.notAssessed.needsVideo;
  if (reason === 'singleFrameFromVideo') return Copy.result.pillar.notAssessed.singleFrameFromVideo;
  return Copy.result.pillar.notAssessed.generic;
}

/**
 * THE ONE READ of a pillar's certified stop-running note, shared by every surface that shows it —
 * `components/pace-readout.tsx`'s `PillarRow` and `components/pillar-detail-modal.tsx`. Both call
 * this; neither parses prose, and neither re-derives the rule.
 *
 * It reads the STRUCTURED `safety` field (`@shared/pace`'s `PaceSafety`), never `feedback`. The
 * server used to concatenate the note into `feedback` as `"note\n\ncoaching"` (issue #212), and
 * the readout drew that one string as one paragraph in one tone — under the earlier per-word
 * reveal the blank line did not even survive to the screen — so the warning was indistinguishable
 * from the coaching it led, on the one screen that matters. A field cannot be flattened by a text
 * layer; a separator can. Hence: structured field, own element, above the coaching, on both
 * surfaces, and `feedback` is coaching only.
 *
 * Returns `null` when there is nothing to warn about — `hasSafetySignal` is `@shared/pace`'s own
 * predicate (`signal !== 'none'` AND a non-blank note), so "no signal" and "a signal with no
 * words" both render nothing rather than an empty banner.
 */
export function safetyNote(pillar: PacePillarResult): string | null {
  const safety = pillar.safety ?? null;
  return hasSafetySignal(safety) ? safety.note.trim() : null;
}

/**
 * VoiceOver announcement for one pillar row (`result.pillar.a11yLabel` / design brief §7:
 * "Posture, 72 out of 100, Solid."). A not-assessed pillar has no numeral to announce, so it
 * gets its own honest sentence instead of interpolating a missing score into the template —
 * the same "hollow bar, not a fabricated number" rule the visual bar follows.
 */
export function pillarA11yLabel(label: string, pillar: PacePillarResult): string {
  if (pillar.score === null || pillar.band === null) {
    return `${label}. ${notAssessedCopy(pillar.notAssessedReason)}`;
  }
  return Copy.result.pillar.a11yLabel
    .replace('{pillar}', label)
    .replace('{score}', String(pillar.score))
    .replace('{band}', ScoreBandLabel[pillar.band]);
}

/** The info-affordance's accessible name (`Copy.result.pillar.detail.a11yLabel`, e.g. "Posture
 * details") — the `<CircleIconButton>` `pace-readout.tsx` renders per pillar row to open
 * `<PillarDetailModal>`. Mirrors `pillarA11yLabel`'s style: one pure template fill, kept out of
 * the component so it gets its own unit test. */
export function pillarDetailA11yLabel(label: string): string {
  return Copy.result.pillar.detail.a11yLabel.replace('{pillar}', label);
}

/** Same announcement shape as `pillarA11yLabel`, for the overall headline — reuses
 * `result.pillar.a11yLabel`'s template with `Copy.result.overall.label` ("Overall") standing in
 * for the pillar name, rather than inventing a second template string for what is structurally
 * the same sentence. */
export function overallA11yLabel(overall: PaceOverall): string {
  if (overall.score === null || overall.band === null) {
    return `${Copy.result.overall.label}. ${Copy.result.pillar.notAssessed.generic}`;
  }
  return Copy.result.pillar.a11yLabel
    .replace('{pillar}', Copy.result.overall.label)
    .replace('{score}', String(overall.score))
    .replace('{band}', ScoreBandLabel[overall.band]);
}

/** `result.partial.banner.body`'s `{n}` and `{medium}` interpolation — `{medium}` reads "photo"
 * for a photo submission and "clip" for a video, so the banner never calls a still image a
 * "clip" (M3, v23-ux-audit-r1). */
export function formatPartialBannerBody(assessedCount: number, mediaType: 'photo' | 'video'): string {
  return Copy.result.partial.banner.body
    .replace('{n}', String(assessedCount))
    .replace('{medium}', mediaType === 'photo' ? 'photo' : 'clip');
}

/**
 * The reveal gate `components/pace-readout.tsx` uses to decide when its bar/numeral animation may
 * start (Phase 2 plan Task 5, spec 2026-07-26 §4 moment 3: "annotations draw, THEN the bars
 * fill"). Hoisted here, pure, so the sequencing rule itself has a real unit test rather than one
 * that fights Reanimated's timing/effects — the component's own job is just to call this with its
 * current `hasLaidOut`/`revealReady` state.
 *
 * `revealReady` defaults to `true` at the call site (see `PaceReadout`'s `Props`), so every
 * existing caller that doesn't pass it keeps its exact pre-Phase-2 behavior: reveal starts the
 * instant layout fires, same as before this gate existed.
 */
export function isRevealTriggered(hasLaidOut: boolean, revealReady: boolean): boolean {
  return hasLaidOut && revealReady;
}
