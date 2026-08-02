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
  // REVERSED by the 2026-08-02 Calm shape/type/motion redesign. This test used to read
  // "squares off cards — sharp reads as document, rounded reads as app" and assert
  // `Radius.card === 0`, locking spec 2026-07-26 §3.3's deliberate choice for the "Gait Plate"
  // language. That language has been replaced: every surface in the Calm reference is generously
  // rounded, and the softness is the brand. See `Radius`'s own block comment in constants/theme.ts
  // for the full reasoning. The lock is kept — not deleted — because the value is still a
  // deliberate design decision that should not drift silently; only what it is locked TO changed.
  it('rounds cards generously — softness is the design language now, not sharpness', () => {
    expect(Radius.card).toBe(24);
  });

  it('gives sheets a larger corner than cards, and leaves pills alone', () => {
    expect(Radius.sheet).toBe(28);
    expect(Radius.pill).toBe(999);
  });

  it('adds the two corners the redesign needs between a tile and a hero', () => {
    // A tile nested inside a card must be TIGHTER than its container or the two radii fight;
    // full-bleed hero media must be LOOSER than a card so it reads as the outermost shape.
    expect(Radius.tile).toBeLessThan(Radius.card);
    expect(Radius.hero).toBeGreaterThan(Radius.card);
  });

  it('adds one editorial gap above the brief’s ramp', () => {
    expect(Spacing.editorial).toBe(96);
    expect(Spacing.xxxl).toBe(48);
  });
});
