/**
 * The just-analyzed result handoff (review r7-4) — a plain module-level mailbox carrying the
 * `analyze-form` response body from `app/analyzing.tsx` to `app/result/[id].tsx`, so the result
 * screen RENDERS WHAT THE SERVER JUST SENT instead of throwing it away and re-fetching the row by
 * id. Same shape and same reasoning as `lib/analyze-form.ts`'s pending-request mailbox: one piece
 * of module state, not a store, and far too large to round-trip through expo-router's serialized
 * route params.
 *
 * WHY IT HAS TO EXIST. Not every 200 has a row behind it. A structurally valid response that
 * assessed nothing is returned in full — the honest all-null readout — while its reservation is
 * RELEASED rather than settled, because cd8bf97 / PR #194 refuses to charge anyone for a result
 * carrying no information. The row is therefore `status: 'released'` with a null `result` by the
 * time the screen could query it, so the old re-fetch turned a computed, honest answer into "We
 * couldn't find this analysis." The fix is not to persist a blank analysis to make the fetch work
 * — that would charge the very submission the policy exists to refund — it is to stop discarding
 * the answer we were already handed.
 *
 * ONE SHOT, AND ID-MATCHED. `take` clears the mailbox whether or not the id matched, so a stale
 * outcome can never be rendered under a later analysis's id, and a re-open from Past Analyses
 * (which never passes through the analyzing screen) always reads the persisted row as before.
 * Module state does not survive a process kill, which is the correct behaviour here too: after a
 * relaunch there is no handoff and the screen falls back to the row, exactly as it always did.
 */
import type { PaceAnalysisOutcome } from '@shared/pace';

import type { AnalyzeFormMediaType } from './analyze-form';

export interface PendingAnalysisResult {
  analysisId: string;
  outcome: PaceAnalysisOutcome;
  /** What the runner actually SENT. The result screen's partial banner says "photo" or "clip",
   * and a released row cannot be asked, so the value travels with the outcome. */
  mediaType: AnalyzeFormMediaType;
}

let pending: PendingAnalysisResult | null = null;

/** Called by `app/analyzing.tsx` immediately before it navigates to the result screen. */
export function setPendingAnalysisResult(result: PendingAnalysisResult): void {
  pending = result;
}

/**
 * One-shot read for `analysisId`. Returns the handed-off result only when the id matches, and
 * clears the mailbox either way — a mismatch means this navigation is not the one the outcome was
 * staged for, and keeping it would let it surface later under the wrong analysis.
 */
export function takePendingAnalysisResult(analysisId: string): PendingAnalysisResult | null {
  const staged = pending;
  pending = null;
  return staged && staged.analysisId === analysisId ? staged : null;
}
