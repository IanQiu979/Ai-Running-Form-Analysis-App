/**
 * The entry flow's scroll-to-reveal arithmetic (2026-09-20), pure so it can be unit-tested
 * without a scroll view.
 *
 * The signed-out entry (`app/(auth)/welcome.tsx`) is one paged vertical scroll of
 * screen-height sections: the hero first, then `components/pillar-story.tsx`'s story. A
 * section's content is held at the first frame of its rise until the scroll has brought enough
 * of it into view, then rises once and stays. "Enough" is `REVEAL_LEAD` of a section height —
 * half — so a section starts arriving while the page snap is still carrying it up, and lands
 * settled about when the snap does. Reveals are monotonic: a section that has begun arriving
 * never hides again on a scroll back up, which is what keeps the flow calm.
 */

/** How much of a section must be on screen before it starts to arrive, as a fraction of its
 *  height. */
export const REVEAL_LEAD = 0.5;

/**
 * How many sections, counted from the top of the scroll, have had their reveal reached at
 * `offsetY`. Section `i` occupies `[i · sectionHeight, (i + 1) · sectionHeight)`; it counts as
 * reached once `offsetY >= (i - REVEAL_LEAD) · sectionHeight`. At the top of the scroll that is
 * the first section only. An unmeasured (`<= 0`) section height reveals nothing but the first
 * section — the arithmetic would otherwise divide by zero, and an unmeasured page has nothing
 * scrolled into view yet.
 */
export function revealedSectionCount(offsetY: number, sectionHeight: number): number {
  if (!(sectionHeight > 0)) return 1;
  const y = Math.max(0, offsetY);
  return Math.floor(y / sectionHeight + REVEAL_LEAD) + 1;
}
