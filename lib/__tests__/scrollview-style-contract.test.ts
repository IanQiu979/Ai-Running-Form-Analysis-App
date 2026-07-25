/**
 * A ScrollView's `style` may not carry child-layout props.
 *
 * React Native throws at RENDER TIME if it does:
 *
 *   Invariant Violation: ScrollView child layout (["alignItems"]) must be applied through the
 *   contentContainerStyle prop.
 *
 * That is a hard crash, not a warning — the screen does not render at all.
 *
 * WHY THIS TEST EXISTS. Issue #63 (the tablet readable-column cap) shipped `alignItems: 'center'`
 * on the `style` prop of EIGHT ScrollViews to centre the width-capped column. Every one of those
 * screens crashed on open, and it reached `main` because nothing checked for it: the unit suite
 * renders individual components, not whole screens, so the invariant never fired in CI. It was
 * found only by running the app in Expo Go.
 *
 * WHY THIS IS A STATIC CHECK rather than a render test. Rendering all 8 screens would need each
 * one's navigation, auth, Supabase and permission context stubbed — a lot of scaffolding whose
 * failure mode is "the test was skipped", which is exactly how this bug survived. Reading the
 * source proves the property directly for EVERY ScrollView in the app, including ones added later
 * by someone who never reads this file. The centring belongs on `contentContainerStyle`
 * (`alignSelf: 'center'`), which is where the fix put it.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/** Props React Native rejects in a ScrollView's `style`. Its own invariant lists these as "child
 *  layout" props — they describe how CHILDREN are laid out, which is the content container's job. */
const CHILD_LAYOUT_PROPS = [
  'alignItems',
  'justifyContent',
  'flexDirection',
  'flexWrap',
  'alignContent',
] as const;

/** Components whose `style` prop is a scroll container's own style, with the same restriction. */
const SCROLLING_COMPONENTS = [
  'ScrollView',
  'Animated.ScrollView',
  'FlatList',
  'Animated.FlatList',
  'SectionList',
  'KeyboardAwareScrollView',
];

const PROJECT_ROOT = join(__dirname, '..', '..');
const SEARCH_DIRS = ['app', 'components'];

function sourceFiles(dir: string): string[] {
  const abs = join(PROJECT_ROOT, dir);
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    if (entry === 'node_modules' || entry === '__tests__' || entry.startsWith('.')) continue;
    const full = join(abs, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(join(dir, entry)));
    } else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      out.push(join(dir, entry));
    }
  }
  return out;
}

/**
 * Style-object names passed as a scrolling component's OWN `style` (never `contentContainerStyle`).
 * The negative lookbehind is what keeps `contentContainerStyle={styles.x}` out of the results —
 * without it every correctly-written screen would be reported.
 */
function scrollOwnStyleNames(src: string): string[] {
  const names = new Set<string>();
  const opening = new RegExp(`<(${SCROLLING_COMPONENTS.map((c) => c.replace('.', '\\.')).join('|')})\\b([^>]*)>`, 'gs');
  for (const tag of src.matchAll(opening)) {
    const attrs = tag[2] ?? '';
    for (const styleRef of attrs.matchAll(/(?<!contentContainer)\bstyle=\{\[?\s*styles\.([A-Za-z0-9_]+)/g)) {
      names.add(styleRef[1]);
    }
  }
  return [...names];
}

/** The body of `name: { ... }` inside a StyleSheet.create block. */
function styleBody(src: string, name: string): string | null {
  const match = src.match(new RegExp(`\\b${name}:\\s*\\{([^{}]*)\\}`, 's'));
  return match ? match[1] : null;
}

describe('ScrollView style contract', () => {
  const files = SEARCH_DIRS.flatMap(sourceFiles);

  it('finds source files to check (a silent zero would make this test meaningless)', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('no scrolling component carries child-layout props in its own `style`', () => {
    const violations: string[] = [];

    for (const file of files) {
      const src = readFileSync(join(PROJECT_ROOT, file), 'utf8');
      for (const styleName of scrollOwnStyleNames(src)) {
        const body = styleBody(src, styleName);
        if (body === null) continue; // spread or imported style — nothing to read here
        for (const prop of CHILD_LAYOUT_PROPS) {
          if (new RegExp(`\\b${prop}\\s*:`).test(body)) {
            violations.push(`${file} — styles.${styleName} sets ${prop}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('at least one screen still centres its capped column via contentContainerStyle', () => {
    // The counterpart to the rule above: prove the #63 centring survives somewhere, so a future
    // "fix" that just deletes the centring instead of relocating it does not pass silently.
    const centred = files.filter((file) => {
      const src = readFileSync(join(PROJECT_ROOT, file), 'utf8');
      return src.includes('ContentWidth.readable') && src.includes("alignSelf: 'center'");
    });

    expect(centred.length).toBeGreaterThan(0);
  });
});
