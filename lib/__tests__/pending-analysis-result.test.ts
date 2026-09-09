/**
 * Locks for `lib/pending-analysis-result.ts` (review r7-4) — the mailbox that carries the
 * `analyze-form` 200 body from the analyzing screen to the result screen, so a zero-pillars-
 * assessed result (whose reservation is RELEASED, never settled, because nobody is charged for a
 * result carrying nothing) can still be rendered instead of dead-ending on a row that does not
 * exist in a readable state.
 *
 * The two properties worth proving are both about NOT showing the wrong thing: the outcome is
 * claimed exactly once, and only under the id it was staged for.
 */
import { photoResult } from '../pace-fixtures';
import { setPendingAnalysisResult, takePendingAnalysisResult } from '../pending-analysis-result';

const ID = 'b144d29b-2348-4043-a96b-581ff4af6dbe';
const OTHER_ID = 'c255e3ac-3459-5154-ba7c-692ff5bf7ecf';

const STAGED = {
  analysisId: ID,
  outcome: { result: photoResult, isFallback: false },
  mediaType: 'photo' as const,
};

beforeEach(() => {
  // Drain anything a previous test left behind — the module is deliberately module-level state.
  takePendingAnalysisResult(ID);
  takePendingAnalysisResult(OTHER_ID);
});

it('hands the staged outcome to the matching analysis id', () => {
  setPendingAnalysisResult(STAGED);
  expect(takePendingAnalysisResult(ID)).toEqual(STAGED);
});

it('is one-shot — a second read gets nothing, so a Retry never replays a stale result', () => {
  setPendingAnalysisResult(STAGED);
  takePendingAnalysisResult(ID);
  expect(takePendingAnalysisResult(ID)).toBeNull();
});

it('refuses to hand an outcome to a different analysis id', () => {
  setPendingAnalysisResult(STAGED);
  expect(takePendingAnalysisResult(OTHER_ID)).toBeNull();
});

it('clears on a mismatched read too, so the stale outcome cannot surface later', () => {
  setPendingAnalysisResult(STAGED);
  takePendingAnalysisResult(OTHER_ID);
  expect(takePendingAnalysisResult(ID)).toBeNull();
});

it('returns null when nothing was staged — an ordinary re-open from Past Analyses', () => {
  expect(takePendingAnalysisResult(ID)).toBeNull();
});
