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
  // Locked THROUGH the 2026-09-01 Cadence Arcs redesign, which re-cut the other three families.
  // The prose role surviving a wholesale type swap is the point: it is not a stylistic leftover,
  // it is the one family that marks the coach's own writing (see its token comment).
  it('exposes a serif family distinct from the UI family', () => {
    expect(FontFamily.prose.regular).toBe('Newsreader_400Regular');
    expect(FontFamily.prose.italic).toBe('Newsreader_400Regular_Italic');
  });
});

describe('Cadence Arcs type families (2026-09-01)', () => {
  it('sets display / body / mono to the redesign’s three families', () => {
    expect(FontFamily.display.regular).toBe('BricolageGrotesque_400Regular');
    expect(FontFamily.body.regular).toBe('Manrope_400Regular');
    expect(FontFamily.mono.regular).toBe('SpaceMono_400Regular');
  });

  // Space Mono has no 500/600. This asserts the token does NOT invent one — see the `mono` token's
  // own comment; an aliased `medium` would be a token that lies about what it renders.
  it('exposes only the two weights Space Mono actually ships', () => {
    expect(Object.keys(FontFamily.mono).sort()).toEqual(['bold', 'regular']);
  });

  // Every family the app loads must be one of the four roles, and every role must resolve to a
  // family name `app/_layout.tsx` actually passes to `useFonts` — the failure this catches is a
  // role left pointing at a retired family, which renders as a silent system-font fallback.
  it('leaves no reference to a retired family', () => {
    const all = Object.values(FontFamily).flatMap((role) => Object.values(role));
    for (const retired of ['Archivo', 'Inter', 'IBMPlexMono']) {
      expect(all.some((name) => name.startsWith(retired))).toBe(false);
    }
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
