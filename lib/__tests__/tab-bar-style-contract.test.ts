/**
 * The floating tab bar's horizontal inset must be expressed as `start`/`end`, never `left`/`right`.
 *
 * WHY THIS TEST EXISTS. `@react-navigation/bottom-tabs` applies its own base style to a bottom tab
 * bar before ours (`views/BottomTabBar.js`, `styles.bottom`), and that base style sets:
 *
 *   bottom: { start: 0, end: 0, bottom: 0, elevation: 8 }
 *
 * Yoga resolves the writing-direction properties (`start`/`end`) at HIGHER precedence than the
 * physical ones (`left`/`right`). So a `left`/`right` in our `tabBarStyle` is not overridden — it is
 * silently DISCARDED, and the bar spans the full viewport width no matter what we wrote.
 *
 * That is not hypothetical. The Calm redesign's whole premise for this bar is that it FLOATS, inset
 * from the screen edges, and it shipped setting `left: TabBar.inset, right: TabBar.inset`. The bar
 * has been drawing edge-to-edge ever since — only its rounded corners and shadow survived, which is
 * exactly why it read as "nearly right" rather than as broken. Issue #63 found it while capping the
 * bar to the readable column on a tablet, and only because the cap is large enough (137pt on an
 * 11" iPad) that its absence was unmistakable; at a phone's 24pt it had gone unnoticed for weeks.
 *
 * WHY THIS IS STATIC. The failure is invisible to typecheck (`left` is a perfectly valid ViewStyle
 * key), invisible to the unit suite (no test renders a navigator), and nearly invisible on a phone.
 * Reading the source is what proves the property, and it keeps proving it for whoever edits this
 * style next without reading any of the above.
 *
 * V23 (2026-09-14): the bar is `components/v23-tab-bar.tsx` now, mounted through the navigator's
 * `tabBar` renderer rather than restyled via `tabBarStyle`, and the absolute position lives in
 * that component's `floating` style. Same trap, same property, new file — the navigator still
 * wraps our element in its own bottom-anchored container.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const TAB_BAR = join(__dirname, '..', '..', 'components', 'v23-tab-bar.tsx');
const TAB_LAYOUT = join(__dirname, '..', '..', 'app', '(tabs)', '_layout.tsx');

/** The `floating: {...}` style literal, isolated so a `left:` in an unrelated style cannot fail
 *  this test (or, worse, pass it). */
function styleBlock(source: string, key: string): string {
  const start = source.indexOf(`${key}: {`);
  expect(start).toBeGreaterThan(-1);

  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${key} object literal is unbalanced`);
}

describe("components/v23-tab-bar.tsx's floating style", () => {
  const block = styleBlock(readFileSync(TAB_BAR, 'utf8'), 'floating');

  it('sets the horizontal inset with start/end, which is what actually moves the bar', () => {
    expect(block).toMatch(/\bstart:/);
    expect(block).toMatch(/\bend:/);
  });

  it('does NOT set left/right, which the library’s own start/end silently override', () => {
    expect(block).not.toMatch(/\bleft:/);
    expect(block).not.toMatch(/\bright:/);
  });

  it('is absolutely positioned — the floating bar reserves no layout space', () => {
    expect(block).toMatch(/position: 'absolute'/);
  });
});

describe("app/(tabs)/_layout.tsx's tab bar", () => {
  const source = readFileSync(TAB_LAYOUT, 'utf8');

  it('renders the V23 bar through the navigator’s `tabBar` slot, not a restyled stock bar', () => {
    expect(source).toMatch(/tabBar=\{/);
    expect(source).not.toMatch(/tabBarStyle:/);
  });

  it('pins the floating bar’s bottom edge to the live inset, never under the design’s 34 pt', () => {
    expect(source).toMatch(/Math\.max\(insets\.bottom, Layout\.canvas\.safeBottom\)/);
  });
});
