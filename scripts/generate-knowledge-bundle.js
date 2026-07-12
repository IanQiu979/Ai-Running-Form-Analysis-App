#!/usr/bin/env node

/**
 * Codegens `supabase/functions/_shared/knowledge.generated.ts` from `knowledge/*.md` (issue #90).
 *
 * WHY THIS EXISTS: `supabase functions deploy` bundles only `supabase/functions/` — the
 * `knowledge/*.md` files live at the repo root, outside that tree, so a deployed edge function
 * has no way to read them at runtime. This script embeds each file's contents as a checked-in TS
 * string constant *inside* `supabase/functions/_shared/`, so the deploy bundle carries the real
 * content, not a path to it.
 *
 * Run with `npm run generate:knowledge` after editing any `knowledge/*.md` file, then commit the
 * regenerated `knowledge.generated.ts`. `npm run verify:knowledge` (wired into `npm run
 * test:edge`, part of the standard `npm test` gate) regenerates into the same path and runs `git
 * diff --exit-code` against it — so an edit to a source file without regenerating fails the
 * build instead of silently shipping a stale bundle.
 *
 * Each constant is wrapped in `assertNonEmptyKnowledge()` (from the hand-written, NOT generated,
 * `knowledge-guard.ts`) so the bundle throws at import time if a source file was ever empty or
 * whitespace-only — see that file's header for the full rationale. This script also fails loudly
 * at generation time for the same condition (`assertSourceIsUsable` below) — belt and suspenders:
 * catch it as early as possible, but never rely on generation-time checking alone, since a
 * hand-edit of the generated file could still slip an empty string past it.
 *
 * String contents are embedded via `JSON.stringify`, not a template literal: markdown can
 * contain backticks and `${...}`-shaped text, either of which would break a hand-rolled template
 * literal; `JSON.stringify` escapes unconditionally and correctly regardless of source content.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const knowledgeDir = path.join(root, 'knowledge');
const outFile = path.join(root, 'supabase', 'functions', '_shared', 'knowledge.generated.ts');

// [sourceFile relative to knowledge/, exported constant name]
const SOURCES = [
  ['pace_framework.md', 'PACE_FRAMEWORK_MD'],
  ['injury_flags.md', 'INJURY_FLAGS_MD'],
  ['drills.md', 'DRILLS_MD'],
];

function assertSourceIsUsable(relPath, content) {
  if (content.trim().length === 0) {
    throw new Error(
      `knowledge/${relPath} is empty or whitespace-only. Refusing to generate a knowledge ` +
        'bundle that would silently ship ungrounded AI advice — fix the source file first.'
    );
  }
}

function generate() {
  const entries = SOURCES.map(([relPath, constName]) => {
    const fullPath = path.join(knowledgeDir, relPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`knowledge/${relPath} does not exist — cannot generate the knowledge bundle.`);
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    assertSourceIsUsable(relPath, content);
    return { relPath, constName, content };
  });

  const header = `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Source: `.concat(
    entries.map((e) => `knowledge/${e.relPath}`).join(', '),
    `.
// Regenerate with \`npm run generate:knowledge\` (scripts/generate-knowledge-bundle.js) after
// editing any knowledge/*.md file, then commit this file. \`npm run verify:knowledge\` — part of
// the \`npm run test:edge\` / \`npm test\` gate — fails the build via \`git diff --exit-code\` if
// this file is stale relative to its sources (issue #90).
//
// Bundled here, not read from disk at runtime: \`supabase functions deploy\` only bundles
// supabase/functions/**, and knowledge/*.md lives at the repo root, outside that tree.
//
// Every constant below is wrapped in assertNonEmptyKnowledge() (supabase/functions/_shared/
// knowledge-guard.ts, hand-written, not generated) — it throws at module load if any bundle is
// empty or whitespace-only, so a deploy can never silently serve ungrounded biomechanics advice.
// See that file's header comment for the full rationale.

import { assertNonEmptyKnowledge } from './knowledge-guard.ts';
`
  );

  const body = entries
    .map(
      ({ relPath, constName, content }) =>
        `export const ${constName}: string = assertNonEmptyKnowledge(\n  ${JSON.stringify(
          `knowledge/${relPath}`
        )},\n  ${JSON.stringify(content)}\n);\n`
    )
    .join('\n');

  return `${header}\n${body}`;
}

function main() {
  const output = generate();
  fs.writeFileSync(outFile, output, 'utf8');
  console.log(`Wrote ${path.relative(root, outFile)} from ${SOURCES.length} knowledge/*.md source(s).`);
}

main();
