/**
 * Exactly one route file may resolve to the URL `/`.
 *
 * `app/(tabs)/index.tsx` is `/` for a signed-in user, and every "back to Home" exit in the core
 * flow — `app/analyzing.tsx`'s Cancel and its no-request `<Redirect>`, `app/result/[id].tsx`'s and
 * `app/capture/extracting.tsx`'s home actions — is a `router.replace('/')`. A second `index.tsx`
 * in another route group also matches `/`, and from any route outside `(tabs)` expo-router's path
 * matcher prefers that other candidate; while signed in, `Stack.Protected` has removed it from
 * the navigator, so the replace fails silently and the button is dead. The V23 hero shipped as
 * `(auth)/index.tsx` for a few hours on 2026-09-14 before code review caught exactly this; it is
 * `(auth)/welcome.tsx` now. This lock keeps it that way — the screen tests cannot see it, because
 * they mock the router and assert the literal `'/'`.
 */
import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const APP_DIR = join(__dirname, '..');

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(relative(APP_DIR, full));
  }
  return out;
}

/** Strips route groups and the file extension — the path expo-router would serve the file at. */
function urlOf(file: string): string {
  const withoutExt = file.replace(/\.tsx?$/, '');
  const segments = withoutExt.split('/').filter((s) => !/^\(.*\)$/.test(s));
  return '/' + segments.join('/');
}

describe('route tree', () => {
  it('has exactly one file that resolves to "/"', () => {
    const roots = routeFiles(APP_DIR).filter((f) => urlOf(f) === '/index');
    expect(roots).toEqual(['(tabs)/index.tsx']);
  });
});
