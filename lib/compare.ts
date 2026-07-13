/**
 * Compare (Elite, minimal) — issue #60, Ruling 13 (`docs/status.md`, 2026-07-10) / "M6:
 * Elite comparison — two stored results side by side with per-pillar deltas."
 *
 * Pure diffing + copy-formatting for `app/compare.tsx`, split out for the same reason
 * `lib/pace-readout.ts` documents for its own split from `components/pace-readout.tsx`: this is
 * exactly the kind of logic CLAUDE.md wants proven with a real test ("New logic added to `lib/`
 * ... should get a test alongside it. Screens are not unit-tested for now."). Nothing here
 * touches the network or Supabase — the two `analyses` rows it diffs are already fetched by the
 * caller through `lib/history.ts`'s existing, RLS-guarded `fetchHistoryList()` (Ruling 13's own
 * words: "Reads two rows the user already has via the normal `analyses` RLS read... Diffs them
 * IN THE CLIENT... No new AI call, NO quota burn, NO extra storage, NO new edge function, NO new
 * API route").
 *
 * THE TRAP THIS FILE EXISTS TO REFUSE (issue #60's own words, and `@shared/pace`'s own honest-
 * failure contract): a pillar that is `score: null` ("not assessed") in EITHER of the two results
 * must diff to `{ kind: 'notAssessed' }`, never a fabricated `{ kind: 'delta', delta: 0 }`. A
 * pillar scored 70 in one result and not-assessed in the other is NOT "no change" — it is
 * "nothing to compare." `computePillarDelta` below enforces this by construction: the
 * `{ kind: 'delta' }` branch is only reachable when BOTH sides carry a real, non-null score —
 * mirroring exactly how `components/pace-readout.tsx`'s `<PillarRow>` only ever mounts a numeral/
 * bar-fill when `pillar.score !== null`.
 */
import { Copy } from '@/constants/copy';
import type { HistoryListItem } from '@/lib/history';
import { PACE_PILLARS, type PacePillarId, type PacePillarResult, type PaceResult } from '@shared/pace';

// -------------------------------------------------------------------------------------------
// Ordering — chronological, so a delta always reads "change from the earlier analysis to the
// later one," never dependent on the order the user happened to tap the two rows in the picker.
// -------------------------------------------------------------------------------------------

/**
 * Orders two selected history items oldest-first, by `createdAt`. Selection order in the picker
 * (`app/compare.tsx`) is otherwise arbitrary — a user can tap the newer one first — so this is
 * what fixes "older" vs "newer" for both the side-by-side readouts and the sign of every delta
 * `computePaceDeltas` below produces.
 */
export function orderByCreatedAt(a: HistoryListItem, b: HistoryListItem): [HistoryListItem, HistoryListItem] {
  return new Date(a.createdAt).getTime() <= new Date(b.createdAt).getTime() ? [a, b] : [b, a];
}

// -------------------------------------------------------------------------------------------
// Diffing — pure arithmetic, no business judgment beyond the sign of a subtraction. See this
// file's header for the one rule every branch here must uphold.
// -------------------------------------------------------------------------------------------

/** One pillar's diff between two results. `'notAssessed'` covers every case where at least one
 * side has `score: null` — see this file's header. `'delta'` is only ever produced when BOTH
 * sides carry a real score. */
export type PillarDelta =
  | { kind: 'notAssessed' }
  | { kind: 'delta'; delta: number; fromScore: number; toScore: number };

/**
 * Diffs one pillar between `from` (the earlier analysis) and `to` (the later one). `delta` is
 * `to.score - from.score`: positive means the later analysis scored higher, negative means lower,
 * zero means genuinely unchanged (a real "no change," not a stand-in for "nothing to compare").
 */
export function computePillarDelta(from: PacePillarResult, to: PacePillarResult): PillarDelta {
  if (from.score === null || to.score === null) {
    return { kind: 'notAssessed' };
  }
  return { kind: 'delta', delta: to.score - from.score, fromScore: from.score, toScore: to.score };
}

/** Diffs all four pillars, in `PACE_PILLARS`' canonical P-A-C-E order, between two full results. */
export function computePaceDeltas(from: PaceResult, to: PaceResult): Record<PacePillarId, PillarDelta> {
  const deltas = {} as Record<PacePillarId, PillarDelta>;
  for (const id of PACE_PILLARS) {
    deltas[id] = computePillarDelta(from.pillars[id], to.pillars[id]);
  }
  return deltas;
}

// -------------------------------------------------------------------------------------------
// Copy formatting — pure, mirrors lib/pace-readout.ts's split of formatting from rendering, and
// its "never stringify null as a score" rule.
// -------------------------------------------------------------------------------------------

/**
 * `compare.delta.positive` / `.negative` / `.none` (docs/design/copy-deck.md § Screen 9: "+{n}
 * {pillar}" / "−{n} {pillar}" / "No change") with placeholders filled in, or
 * `compare.delta.notAssessed` — a NEW key, not in the deck; see this file's header for why the
 * deck's three cases alone are not exhaustive and this fourth one must exist — when either side
 * is not-assessed. `delta.delta === 0` (a real, both-sides-scored tie) reads `.none`; that branch
 * is unreachable for a `'notAssessed'` diff, which is exactly the point.
 */
export function formatPillarDelta(pillarLabel: string, delta: PillarDelta): string {
  if (delta.kind === 'notAssessed') {
    return Copy.compare.delta.notAssessed;
  }
  if (delta.delta === 0) {
    return Copy.compare.delta.none;
  }
  if (delta.delta > 0) {
    return Copy.compare.delta.positive.replace('{n}', String(delta.delta)).replace('{pillar}', pillarLabel);
  }
  // Copy.compare.delta.negative already carries the deck-mandated U+2212 MINUS SIGN (not a
  // hyphen) at the `{n}` position; Math.abs keeps the interpolated number itself unsigned so the
  // glyph is the only thing carrying the sign, matching the deck's own "−3 Cadence" example.
  return Copy.compare.delta.negative.replace('{n}', String(Math.abs(delta.delta))).replace('{pillar}', pillarLabel);
}

/**
 * `compare.delta.a11yLabel` ("{pillar} changed by {delta} points, from {oldScore} to
 * {newScore}.") filled in, or `compare.delta.notAssessedA11yLabel` — a NEW key, same reasoning as
 * `formatPillarDelta` above — when either side is not-assessed. Mirrors
 * `lib/pace-readout.ts`'s `pillarA11yLabel`: a not-assessed pillar gets its own honest sentence
 * instead of interpolating a missing score into the template.
 */
export function pillarDeltaA11yLabel(pillarLabel: string, delta: PillarDelta): string {
  if (delta.kind === 'notAssessed') {
    return Copy.compare.delta.notAssessedA11yLabel.replace('{pillar}', pillarLabel);
  }
  return Copy.compare.delta.a11yLabel
    .replace('{pillar}', pillarLabel)
    .replace('{delta}', String(delta.delta))
    .replace('{oldScore}', String(delta.fromScore))
    .replace('{newScore}', String(delta.toScore));
}
