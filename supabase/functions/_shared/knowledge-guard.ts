/**
 * The empty-knowledge guard (issue #90). `knowledge.generated.ts` wraps every constant it
 * exports in `assertNonEmptyKnowledge()` at module top level, so the check runs the moment the
 * bundle is imported — not lazily, not only when a value happens to be read.
 *
 * WHY THIS EXISTS: the three `knowledge/*.md` files (`pace_framework.md`, `injury_flags.md`,
 * `drills.md`) are the certified biomechanics grounding `analyze-form` (#44) is required to
 * inject as system context on every call (`docs/architecture.md` step 7). A deploy that ships an
 * empty or whitespace-only knowledge string does not crash — it produces confident, fluent,
 * ungrounded advice from the model's general knowledge instead, which is the one failure mode
 * this product must never ship. There is no way to detect that from the *output* without a live
 * model call (that's `llm-eval`'s job, #42, and it only ever catches it after the fact) — so the
 * only reliable place to stop it is before the bundle is ever readable at all: fail loud at
 * function boot, never silently serve ungrounded advice.
 *
 * Deliberately kept in its own hand-written file, separate from `knowledge.generated.ts`: the
 * codegen script (`scripts/generate-knowledge-bundle.js`) only ever emits data (the three
 * `assertNonEmptyKnowledge(...)` call sites and their string literals), never logic — so this
 * function's behavior is reviewed and tested exactly like any other hand-written source, and
 * regenerating the bundle can never accidentally change what "empty" means.
 */
export function assertNonEmptyKnowledge(sourceFile: string, content: string): string {
  if (content.trim().length === 0) {
    throw new Error(
      `Knowledge bundle "${sourceFile}" is empty or whitespace-only. Refusing to load it: an ` +
        'empty knowledge string would make analyze-form serve confident, fluent, ungrounded ' +
        'biomechanics advice instead of failing loudly. Fix the source file (or the codegen ' +
        'step that produced this bundle) before this function is allowed to boot.'
    );
  }
  return content;
}
