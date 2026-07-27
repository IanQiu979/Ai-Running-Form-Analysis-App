/**
 * Locks the redesign's new token values (spec 2026-07-26-redesign-design.md §3).
 *
 * The six original steps are asserted UNCHANGED on purpose: the redesign is additive, and a
 * screen that never opts into `display`/`hero` must look exactly as it did before.
 */
import { FontFamily, FontSize, Radius, Spacing } from '../theme';

describe('type scale', () => {
  it('keeps the brief’s six original steps unchanged', () => {
    expect(FontSize.xs).toBe(13);
    expect(FontSize.sm).toBe(15);
    expect(FontSize.md).toBe(17);
    expect(FontSize.lg).toBe(20);
    expect(FontSize.xl).toBe(24);
    expect(FontSize.xxl).toBe(32);
  });

  it('adds display steps that give the scale real range', () => {
    expect(FontSize.display).toBe(64);
    expect(FontSize.hero).toBe(96);
  });

  it('spans a ratio wide enough for editorial hierarchy (the old 2.5x was the problem)', () => {
    expect(FontSize.hero / FontSize.xs).toBeGreaterThan(7);
  });
});

describe('prose type role', () => {
  it('exposes a serif family distinct from the UI family', () => {
    expect(FontFamily.prose.regular).toBe('Newsreader_400Regular');
    expect(FontFamily.prose.italic).toBe('Newsreader_400Regular_Italic');
  });

  it('does not disturb the existing three roles', () => {
    expect(FontFamily.body.regular).toBe('Inter_400Regular');
    expect(FontFamily.display.regular).toBe('Archivo_400Regular');
    expect(FontFamily.mono.regular).toBe('IBMPlexMono_400Regular');
  });
});

describe('shape and rhythm', () => {
  it('squares off cards — sharp reads as document, rounded reads as app', () => {
    expect(Radius.card).toBe(0);
  });

  it('leaves sheets and pills alone (a pill is still a pill)', () => {
    expect(Radius.sheet).toBe(12);
    expect(Radius.pill).toBe(999);
  });

  it('adds one editorial gap above the brief’s ramp', () => {
    expect(Spacing.editorial).toBe(96);
    expect(Spacing.xxxl).toBe(48);
  });
});
