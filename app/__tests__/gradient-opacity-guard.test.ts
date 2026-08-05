/**
 * Static-analysis regression lock for H3 (v23-ux-audit-r1): a style object on a
 * `<ScreenGradient>`-backed screen must never combine `opacity:` with a `color: colors.text.*`
 * on the same style — the gradient's contract only proves `text.primary` at FULL opacity
 * (constants/__tests__/theme-contrast.test.ts). Dimming that color with `opacity` silently drops
 * it below WCAG AA, and `theme-contrast.test.ts` can't see it because the opacity is applied at
 * the screen, not the token. Four screens shipped this exact bug (capture/index, settings,
 * paywall, compare) before it was ever measured.
 *
 * This is intentionally a source-text scan, not a render test: the defect is a *combination of
 * two style properties*, which is invisible at runtime (nothing throws, nothing looks broken in
 * a snapshot) and only shows up as a failed contrast ratio.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const APP_ROOT = join(__dirname, '..');

function listTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      out.push(...listTsxFiles(full));
    } else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** Non-nested `name: { ...single-level braces... }` style-object entries. */
function extractStyleEntries(source: string): { name: string; body: string }[] {
  const entries: { name: string; body: string }[] = [];
  const re = /(\w+):\s*{([^{}]*)}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    entries.push({ name: match[1], body: match[2] });
  }
  return entries;
}

describe('gradient-backed screens never dim text.* with opacity (H3 guard)', () => {
  const files = listTsxFiles(APP_ROOT).filter((f) => {
    const source = readFileSync(f, 'utf8');
    return source.includes('ScreenGradient');
  });

  it('found at least one ScreenGradient screen to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const relative = file.slice(APP_ROOT.length + 1);
    it(`${relative} has no style combining opacity with colors.text.*`, () => {
      const source = readFileSync(file, 'utf8');
      const offenders = extractStyleEntries(source)
        .filter((entry) => /opacity\s*:/.test(entry.body) && /color:\s*colors\.text\./.test(entry.body))
        .map((entry) => entry.name);

      expect(offenders).toEqual([]);
    });
  }
});
