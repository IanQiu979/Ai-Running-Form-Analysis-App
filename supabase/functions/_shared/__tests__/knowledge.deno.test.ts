/**
 * Regression lock for the generated knowledge bundle (issue #90) — the actual artifact that
 * ships inside the `analyze-form` deploy bundle. This is the test that most directly guards
 * against the issue's stated danger: "a deploy that ships an empty knowledge string produces
 * confident, fluent, ungrounded biomechanics advice... It does not crash. It is just wrong."
 *
 * Three layers of protection, each catching a different failure:
 *   1. Importing this file at all exercises `knowledge.generated.ts`'s module-load-time
 *      `assertNonEmptyKnowledge()` calls — if any constant were empty, `deno test` would fail to
 *      even load this file, loudly, before a single assertion below runs.
 *   2. The non-empty + anchor-content assertions below prove each constant isn't just
 *      "non-empty" in some degenerate way (e.g. a single stray space) but actually carries real,
 *      recognizable content from its source file.
 *   3. The exact-match-against-disk assertions prove the codegen step (`scripts/
 *      generate-knowledge-bundle.js`) didn't mangle, truncate, or stale-cache the content —
 *      catching an escaping bug that "contains an anchor string" alone would miss.
 *
 * DENO-ONLY, DELIBERATELY — same rationale as `knowledge-guard.deno.test.ts`: this bundle is
 * edge-only content the app never imports, so testing it under the Deno runner this issue adds is
 * the most direct proof that runner can execute real edge-function code end to end. Excluded from
 * Jest via the `.deno.test.ts` suffix in `jest.config.js`'s `testPathIgnorePatterns`.
 *
 * Needs `--allow-read` (see `deno test` invocation in `package.json`'s `test:edge` script) only
 * for the exact-match-against-disk checks, which re-read `knowledge/*.md` directly — the deployed
 * edge function itself never reads from disk at runtime; that's the whole point of this bundle.
 */
import { DRILLS_MD, INJURY_FLAGS_MD, PACE_FRAMEWORK_MD } from '../knowledge.generated.ts';

const KNOWLEDGE_DIR = new URL('../../../../knowledge/', import.meta.url);

function readSource(fileName: string): string {
  return Deno.readTextFileSync(new URL(fileName, KNOWLEDGE_DIR));
}

Deno.test('PACE_FRAMEWORK_MD is non-empty and carries the certified framework content', () => {
  if (PACE_FRAMEWORK_MD.trim().length === 0) {
    throw new Error('PACE_FRAMEWORK_MD is empty or whitespace-only.');
  }
  if (!PACE_FRAMEWORK_MD.includes('# PACE Form Framework — the certified core')) {
    throw new Error('PACE_FRAMEWORK_MD is missing its expected title heading.');
  }
  if (!PACE_FRAMEWORK_MD.includes('## The four hard rules for the analyzer (read first, obey always)')) {
    throw new Error('PACE_FRAMEWORK_MD is missing its expected "four hard rules" section.');
  }
});

Deno.test('INJURY_FLAGS_MD is non-empty and carries the certified injury-flag content', () => {
  if (INJURY_FLAGS_MD.trim().length === 0) {
    throw new Error('INJURY_FLAGS_MD is empty or whitespace-only.');
  }
  if (!INJURY_FLAGS_MD.includes('# PACE Injury-Risk Flags — from visible form')) {
    throw new Error('INJURY_FLAGS_MD is missing its expected title heading.');
  }
  if (!INJURY_FLAGS_MD.includes('## How to use these flags')) {
    throw new Error('INJURY_FLAGS_MD is missing its expected "how to use these flags" section.');
  }
});

Deno.test('DRILLS_MD is non-empty and carries the certified drills content', () => {
  if (DRILLS_MD.trim().length === 0) {
    throw new Error('DRILLS_MD is empty or whitespace-only.');
  }
  if (!DRILLS_MD.includes('# PACE Corrective Drills')) {
    throw new Error('DRILLS_MD is missing its expected title heading.');
  }
  if (!DRILLS_MD.includes('## P — Posture drills')) {
    throw new Error('DRILLS_MD is missing its expected "Posture drills" section.');
  }
});

Deno.test('PACE_FRAMEWORK_MD matches knowledge/pace_framework.md on disk byte-for-byte', () => {
  const onDisk = readSource('pace_framework.md');
  if (PACE_FRAMEWORK_MD !== onDisk) {
    throw new Error('PACE_FRAMEWORK_MD has drifted from knowledge/pace_framework.md — regenerate with `npm run generate:knowledge`.');
  }
});

Deno.test('INJURY_FLAGS_MD matches knowledge/injury_flags.md on disk byte-for-byte', () => {
  const onDisk = readSource('injury_flags.md');
  if (INJURY_FLAGS_MD !== onDisk) {
    throw new Error('INJURY_FLAGS_MD has drifted from knowledge/injury_flags.md — regenerate with `npm run generate:knowledge`.');
  }
});

Deno.test('DRILLS_MD matches knowledge/drills.md on disk byte-for-byte', () => {
  const onDisk = readSource('drills.md');
  if (DRILLS_MD !== onDisk) {
    throw new Error('DRILLS_MD has drifted from knowledge/drills.md — regenerate with `npm run generate:knowledge`.');
  }
});
