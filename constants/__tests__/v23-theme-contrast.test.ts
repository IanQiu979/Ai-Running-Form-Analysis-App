/**
 * Proves the V23-01 theme sheet's contrast claims against the real exported tokens — the same
 * discipline `theme-contrast.test.ts` applies to the Cold Read system, and for the same reason:
 * a comment saying "clears AA" is a claim, this is the measurement.
 */
import { contrastRatio } from '@/constants/contrast';
import { Ink, ReadableInk, Surfaces, Type } from '@/constants/v23-theme';

describe('V23 theme sheet — colour contracts', () => {
  it.each(ReadableInk.flatMap((fg) => Surfaces.map((bg) => [fg, bg] as const)))(
    '%s on %s clears 4.5:1 as text',
    (fg, bg) => {
      expect(contrastRatio(Ink[fg], Ink[bg])).toBeGreaterThanOrEqual(4.5);
    }
  );

  it('onAccent on accent clears 4.5:1 (the primary button label)', () => {
    expect(contrastRatio(Ink.onAccent, Ink.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('accent clears 3:1 as a control boundary against both surfaces', () => {
    for (const bg of Surfaces) {
      expect(contrastRatio(Ink.accent, Ink[bg])).toBeGreaterThanOrEqual(3);
    }
  });

  it('ink3 is a placeholder tone and stays UNDER 4.5:1 — it must never carry body copy', () => {
    for (const bg of Surfaces) {
      expect(contrastRatio(Ink.ink3, Ink[bg])).toBeLessThan(4.5);
    }
  });

  it('line is decorative and stays UNDER 3:1, so it can never double as a control boundary', () => {
    for (const bg of Surfaces) {
      expect(contrastRatio(Ink.line, Ink[bg])).toBeLessThan(3);
    }
  });

  it('is monochrome apart from danger — no other role carries a hue', () => {
    const chromatic = Object.entries(Ink).filter(([, hex]) => {
      const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)];
      return !(r === g && g === b);
    });
    expect(chromatic.map(([name]) => name)).toEqual(['danger']);
  });
});

describe('V23 theme sheet — type scale', () => {
  it('uppercases exactly the display and label roles', () => {
    const upper = Object.entries(Type)
      .filter(([, style]) => 'textTransform' in style && style.textTransform === 'uppercase')
      .map(([name]) => name);
    expect(upper.sort()).toEqual(['display', 'label']);
  });

  it('sets tabular figures on every numeric role', () => {
    expect(Type.metric.fontVariant).toEqual(['tabular-nums']);
    expect(Type.clock.fontVariant).toEqual(['tabular-nums']);
  });

  it('resolves the page em tracking to points at each role size', () => {
    expect(Type.display.letterSpacing).toBeCloseTo(0.02 * Type.display.fontSize, 5);
    expect(Type.label.letterSpacing).toBeCloseTo(0.06 * Type.label.fontSize, 5);
    expect(Type.clock.letterSpacing).toBeCloseTo(0.02 * Type.clock.fontSize, 5);
  });
});
