import { REVEAL_LEAD, revealedSectionCount } from '../entry-story';

const H = 800;

describe('revealedSectionCount', () => {
  it('reveals only the first section at the top of the scroll', () => {
    expect(revealedSectionCount(0, H)).toBe(1);
    expect(revealedSectionCount(H * REVEAL_LEAD - 1, H)).toBe(1);
  });

  it('reveals the next section once half of it is on screen, not before', () => {
    expect(revealedSectionCount(H * REVEAL_LEAD, H)).toBe(2);
    expect(revealedSectionCount(H, H)).toBe(2);
    expect(revealedSectionCount(H * 1.5 - 1, H)).toBe(2);
    expect(revealedSectionCount(H * 1.5, H)).toBe(3);
  });

  it('counts through the whole story on a long scroll', () => {
    // Hero, intro, four pillars: the last section is index 5, reached at 4.5 H.
    expect(revealedSectionCount(H * 4.5, H)).toBe(6);
    expect(revealedSectionCount(H * 5, H)).toBe(6);
  });

  it('treats an over-scroll above the top as the top', () => {
    expect(revealedSectionCount(-120, H)).toBe(1);
  });

  it('reveals nothing but the first section before the page has measured itself', () => {
    expect(revealedSectionCount(400, 0)).toBe(1);
    expect(revealedSectionCount(400, Number.NaN)).toBe(1);
  });
});
