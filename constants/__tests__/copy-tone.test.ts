/**
 * Tone lock for `constants/copy.ts` (captain's user-audit, 2026-09-12: "too informal").
 *
 * Every user-facing string is held to the professional register the copy file's header states:
 * no exclamation marks, no emoji, no contractions. This walks the whole `Copy` tree — template
 * functions are invoked with representative arguments so their output is checked too — so a new
 * key is covered the moment it is added, without anyone remembering to list it here.
 *
 * The consent-act strings are the one deliberate exemption: their wording is legal text whose
 * meaning must not move, and the brief for this pass was explicit that shortening never trumps
 * scope there. They are listed by key so the exemption is visible and reviewable, not implicit.
 */
import { Copy } from '@/constants/copy';

/** Consent/legal strings whose wording is frozen by meaning, not tone. */
const EXEMPT_KEYS = new Set<string>([
  'consent.upload.subject.thirdParty.checkbox',
  'consent.upload.subject.body',
]);

/** Representative arguments for each template-function value in `Copy`. */
const TEMPLATE_ARGS: Record<string, unknown[]> = {
  'consent.upload.subject.cta.primary': ['other'],
  'paywall.gate.paid.body': [10, 'Oct 1, 2026'],
  'paywall.purchase.success.title': ['Pro'],
  'analyzing.step.uploading': ['photo'],
  'capture.recording.timer': [7],
  'upload.step.extracting': [3, 8],
  'upload.ready.body': [8],
  'analysisPause.bodyFor': ['about 2 hours'],
};

function collect(node: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof node === 'string') {
    out.push([path, node]);
    return;
  }
  if (typeof node === 'function') {
    const args = TEMPLATE_ARGS[path];
    if (!args) throw new Error(`No sample arguments registered for template ${path}`);
    out.push([path, (node as (...a: unknown[]) => string)(...args)]);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      collect(value, path ? `${path}.${key}` : key, out);
    }
  }
}

const ALL: Array<[string, string]> = [];
collect(Copy, '', ALL);
const CHECKED = ALL.filter(([path]) => !EXEMPT_KEYS.has(path));

describe('Copy tone', () => {
  it('walks a non-trivial number of strings (the lock is not vacuous)', () => {
    expect(CHECKED.length).toBeGreaterThan(200);
  });

  it('every exempt key still exists (a stale exemption would silently widen nothing)', () => {
    const paths = new Set(ALL.map(([path]) => path));
    for (const key of EXEMPT_KEYS) expect(paths.has(key)).toBe(true);
  });

  it.each(CHECKED)('%s has no exclamation mark', (_path, text) => {
    expect(text).not.toContain('!');
  });

  it.each(CHECKED)('%s has no emoji', (_path, text) => {
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it.each(CHECKED)('%s has no contractions', (_path, text) => {
    // Apostrophe-s is deliberately NOT in this set: "someone else's" is a possessive, and the
    // consent strings need it. Everything else here is only ever a contraction.
    expect(text).not.toMatch(/\b\w+(n't|'re|'ve|'ll|'d|'m)\b/i);
  });
});
