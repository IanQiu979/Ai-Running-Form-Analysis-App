/**
 * The responsive/cross-device geometry added by issue #63's M7 pass.
 *
 * These are the only pieces of that pass that are pure functions rather than static style objects,
 * which makes them the only pieces a unit test can prove. Each one encodes a rule that is invisible
 * on the reference device and only bites on a tablet, in landscape, or on Android 3-button
 * navigation — exactly the conditions nobody has in front of them while editing a screen. The
 * no-op assertions below are the load-bearing ones: they are what stops a future "simplification"
 * from silently changing the signed-off phone layout while chasing a tablet fix.
 */
import { Platform } from 'react-native';

import { ContentWidth, TabBar } from '../theme';

/** Real point widths, so a failure names a device rather than a number. */
const IPHONE_SE = 375;
const IPHONE_15_PRO = 393;
const IPHONE_15_PRO_MAX = 430;
const IPAD_11_PORTRAIT = 834;
const IPAD_13_LANDSCAPE = 1366;
const PHONE_WIDTHS = [IPHONE_SE, IPHONE_15_PRO, IPHONE_15_PRO_MAX];

describe('ContentWidth.isCapped', () => {
  it('is false on every phone — the cap must never engage where the design was drawn', () => {
    for (const width of PHONE_WIDTHS) {
      expect(ContentWidth.isCapped(width)).toBe(false);
    }
  });

  it('is true on a tablet in portrait and in landscape', () => {
    expect(ContentWidth.isCapped(IPAD_11_PORTRAIT)).toBe(true);
    expect(ContentWidth.isCapped(IPAD_13_LANDSCAPE)).toBe(true);
  });

  it('is false exactly at the cap — at 560pt the column already fills the viewport', () => {
    expect(ContentWidth.isCapped(ContentWidth.readable)).toBe(false);
    expect(ContentWidth.isCapped(ContentWidth.readable + 1)).toBe(true);
  });

  it('is true at an iPad Split View width that still exceeds the column', () => {
    // iPadOS can hand a secondary app widths well below the full screen. The rule is the column,
    // not the device: a 640pt pane is still wider than 560 and still gets the inset treatment.
    expect(ContentWidth.isCapped(640)).toBe(true);
    // ...and a narrow Slide Over pane is phone-shaped, so it must NOT.
    expect(ContentWidth.isCapped(320)).toBe(false);
  });
});

describe('TabBar.sideInset', () => {
  // NOT "keeps its shipped geometry": what shipped was full-bleed, because the bar was setting
  // `left`/`right`, which React Navigation's own `start: 0, end: 0` overrode. This function returns
  // the plain 24pt inset on a phone — the geometry the redesign specified and never achieved. See
  // lib/__tests__/tab-bar-style-contract.test.ts.
  it('is the plain 24pt inset on every phone — the geometry the redesign specified', () => {
    for (const width of PHONE_WIDTHS) {
      expect(TabBar.sideInset(width)).toBe(TabBar.inset);
    }
  });

  it('centres a readable-column-wide bar on a tablet instead of stretching it', () => {
    const inset = TabBar.sideInset(IPAD_11_PORTRAIT);
    // The bar's drawn width is whatever the two offsets leave behind.
    expect(IPAD_11_PORTRAIT - inset * 2).toBe(ContentWidth.readable);
  });

  it('still caps at the readable column in landscape, where the stretch was worst', () => {
    const inset = TabBar.sideInset(IPAD_13_LANDSCAPE);
    expect(IPAD_13_LANDSCAPE - inset * 2).toBe(ContentWidth.readable);
  });

  it('never returns less than the plain inset, however narrow the viewport', () => {
    expect(TabBar.sideInset(0)).toBe(TabBar.inset);
    expect(TabBar.sideInset(320)).toBe(TabBar.inset);
  });
});

describe('TabBar.bottomOffset', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('ignores the inset on iOS — a floating bar over the home indicator is the shipped design', () => {
    Platform.OS = 'ios';
    // 34pt is the iPhone home-indicator inset, and it is LARGER than TabBar.inset. If this ever
    // starts returning 34 the bar has silently moved up 10pt on every modern iPhone.
    expect(TabBar.bottomOffset(34)).toBe(TabBar.inset);
    expect(TabBar.bottomOffset(0)).toBe(TabBar.inset);
  });

  it('clears Android 3-button navigation, which is what the bar was drawn behind', () => {
    Platform.OS = 'android';
    // ~48pt is the 3-button navigation bar. The floating bar sat at 24pt with a 64pt height, so
    // its lowest 24pt — part of its label row — was drawn underneath it.
    expect(TabBar.bottomOffset(48)).toBe(48);
  });

  it('leaves Android gesture navigation alone — that inset was already smaller than the bar offset', () => {
    Platform.OS = 'android';
    expect(TabBar.bottomOffset(16)).toBe(TabBar.inset);
    expect(TabBar.bottomOffset(24)).toBe(TabBar.inset);
  });
});

describe('TabBar.clearanceFor', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('reproduces the shipped 112pt phone clearance exactly', () => {
    Platform.OS = 'ios';
    expect(TabBar.clearanceFor(34)).toBe(TabBar.clearance);
    expect(TabBar.clearance).toBe(112);
  });

  it('grows with the bar on Android 3-button navigation, so content still clears it', () => {
    Platform.OS = 'android';
    const clearance = TabBar.clearanceFor(48);
    expect(clearance).toBe(48 + TabBar.height + TabBar.inset);
    // The property that actually matters, stated against the SHIPPED phone value rather than
    // re-deriving the formula: 3-button nav must buy strictly more clearance than a phone gets,
    // by exactly the extra distance the bar itself moved up.
    expect(clearance - TabBar.clearance).toBe(48 - TabBar.inset);
  });
});
