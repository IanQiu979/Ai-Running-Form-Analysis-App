/**
 * Regression lock for `assertNonEmptyKnowledge()` (issue #90) — the function
 * `knowledge.generated.ts` wraps every knowledge constant in, so the empty-knowledge failure
 * mode (see `knowledge-guard.ts`'s header) fails loud at module load instead of silently shipping
 * ungrounded AI advice.
 *
 * DENO-ONLY, DELIBERATELY: `knowledge-guard.ts` and `knowledge.generated.ts` are edge-only
 * artifacts — nothing in the app ever imports them (the client never sees raw knowledge content).
 * Testing them under the new Deno runner (`npm run test:edge`, issue #90) rather than Jest proves
 * the runner this issue exists to add can actually execute and validate edge-function code end to
 * end, not just typecheck it — the exact gap issue #90 was filed to close. This file's name ends
 * in `.deno.test.ts` and `jest.config.js`'s `testPathIgnorePatterns` excludes that suffix, so
 * Jest never attempts to run it (it would fail immediately on the undefined `Deno` global).
 *
 * No `jsr:`/`npm:` test-assertion import — a couple of hand-rolled checks below keep this file as
 * dependency-free as `pace.ts`/`ai-pricing.ts` are deliberately kept, and need nothing else.
 */
import { assertNonEmptyKnowledge } from '../knowledge-guard.ts';

function assertThrowsSync(fn: () => unknown, messageContains: string): void {
  try {
    fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes(messageContains)) {
      throw new Error(
        `Expected the thrown error to mention "${messageContains}", got: ${message}`
      );
    }
    return;
  }
  throw new Error('Expected function to throw, but it did not.');
}

Deno.test('assertNonEmptyKnowledge returns the content unchanged when it is non-empty', () => {
  const content = 'Real biomechanics content.';
  const result = assertNonEmptyKnowledge('some_file.md', content);
  if (result !== content) {
    throw new Error(`Expected unchanged content, got: ${result}`);
  }
});

Deno.test('assertNonEmptyKnowledge throws on an empty string — the exact failure this exists to prevent', () => {
  assertThrowsSync(() => assertNonEmptyKnowledge('empty_file.md', ''), 'empty_file.md');
});

Deno.test('assertNonEmptyKnowledge throws on a whitespace-only string, not just a literal empty one', () => {
  assertThrowsSync(
    () => assertNonEmptyKnowledge('whitespace_file.md', '   \n\t  \n'),
    'whitespace_file.md'
  );
});

Deno.test('assertNonEmptyKnowledge does not silently return an empty/whitespace string on failure', () => {
  // If a future edit made this function log-and-return instead of throw, this test — not just
  // the throws-assertions above — would catch it: the failure mode this whole module exists to
  // prevent is exactly "no exception, just a hollow string quietly reaches the model prompt."
  let threw = false;
  try {
    assertNonEmptyKnowledge('x.md', '');
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error('assertNonEmptyKnowledge must throw on empty input, not return silently.');
  }
});
