/**
 * Turns one raw `analyses` row into a state `app/result/[id].tsx` can render (issue #56). Pure
 * and Supabase-client-free on purpose — the screen is the only thing that ever touches the
 * network; this is the testable half (CLAUDE.md § Testing: "Screens are not unit-tested for
 * now" / "New logic added to `lib/` ... should get a test alongside it").
 */
import { isPaceAnalysisOutcome, type PaceAnalysisOutcome } from '@shared/pace';

/** The columns `app/result/[id].tsx` selects from `public.analyses` — a subset of the full row
 * (`docs/architecture.md` "Current — DB schema"), not the whole table shape. `result` is typed
 * `unknown` here on purpose: it's `jsonb` on the wire, and `isPaceAnalysisOutcome` below is what
 * actually proves its shape rather than a cast asserting it. */
export interface AnalysisRow {
  status: 'reserved' | 'delivered' | 'released';
  result: unknown;
  is_fallback: boolean;
  media_paths: string[];
  media_type: 'photo' | 'video';
  deleted_at: string | null;
}

export type AnalysisReadState =
  | { kind: 'notFound' }
  | { kind: 'invalid' }
  | { kind: 'ready'; outcome: PaceAnalysisOutcome; mediaPaths: string[]; mediaType: 'photo' | 'video' };

/**
 * Interprets one raw row (or `null`, meaning the query found nothing — a bad id, or a row RLS
 * excluded because it belongs to someone else) into a screen-renderable state.
 *
 * Four raw situations all collapse into the SAME `'notFound'` state, deliberately:
 *   - the row plain doesn't exist, or RLS hid it (`row === null`);
 *   - the row is soft-deleted (`deleted_at` set — `result`/`media_paths` are redacted to
 *     null/`'{}'` by the DB itself the moment that happens, see
 *     `20260712040000_analyses_quota_soft_delete.sql`'s redact trigger);
 *   - the row is still mid-flight (`status === 'reserved'`) — nothing has been persisted to
 *     `result` yet, because only `settle_analysis` (on delivery) or a fallback delivery writes
 *     it; the wait-for-a-still-running-analysis UX belongs to the Analyzing screen (a separate,
 *     not-yet-built route — #80), not this one, since result/[id] is only ever reached once an
 *     analysis has actually delivered;
 *   - the row failed outright (`status === 'released'` with no retry-partial delivered) — same
 *     reasoning: `result` was never written for a clean failure (`docs/architecture.md`
 *     "Original design — analyze-form edge function flow" step 9: "on a second failure ... else a clean
 *     failure", and only a delivered fallback reaches `status: 'delivered'`).
 * From the caller's point of view all four read identically: "there is nothing to show here."
 *
 * A row that IS `status: 'delivered'` but whose `result`/`is_fallback` pair fails
 * `isPaceAnalysisOutcome`'s structural check returns `'invalid'` instead — a defensive state for
 * corrupt or otherwise-malformed stored data, never rendered as if it were a real (if odd)
 * result.
 */
export function readAnalysisRow(row: AnalysisRow | null): AnalysisReadState {
  if (!row || row.deleted_at !== null || row.status !== 'delivered') {
    return { kind: 'notFound' };
  }

  const outcome = { result: row.result, isFallback: row.is_fallback };
  if (!isPaceAnalysisOutcome(outcome)) {
    return { kind: 'invalid' };
  }

  return { kind: 'ready', outcome, mediaPaths: row.media_paths, mediaType: row.media_type };
}
