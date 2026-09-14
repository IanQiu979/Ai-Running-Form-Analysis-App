/**
 * Structural locks for <StrideHero /> (V23-02). Reanimated does not advance under Jest here
 * (CLAUDE.md § Testing), so nothing below proves the runner ran — what is provable is the FIRST
 * FRAME each mode mounts: the animated mode starts from nothing drawn (dash offset = the whole
 * stroke, every number at 0), and the reduced-motion mode mounts the page's end frame — the
 * poster — with all four measurements already at their final values. Losing either branch is
 * silent on a developer's device, which is why both are pinned.
 */
import { render, screen, waitFor } from '@testing-library/react-native';

import { StrideHero } from '../stride-hero';
import { Copy } from '@/constants/copy';
import { HEAD_CIRCUMFERENCE } from '@/lib/stride-hero';

const hidden = { includeHiddenElements: true } as const;

describe('StrideHero — animated (default)', () => {
  it('mounts as one labelled image with its parts hidden from assistive tech', async () => {
    await render(<StrideHero testID="hero" />);

    const hero = screen.getByTestId('hero');
    expect(hero.props.accessibilityRole).toBe('image');
    expect(hero.props.accessibilityLabel).toBe(Copy.entry.hero.a11yLabel);
    // The drawing itself is not a separate a11y node.
    expect(screen.queryByTestId('hero-figure-body')).toBeNull();
    expect(screen.getByTestId('hero-figure-body', hidden)).toBeTruthy();
  });

  it('starts with nothing drawn: the head is fully dashed out and every metric reads 0', async () => {
    await render(<StrideHero testID="hero" />);

    const head = screen.getByTestId('hero-figure-head', hidden);
    expect(head.props.strokeDashoffset).toBeCloseTo(HEAD_CIRCUMFERENCE, 4);

    expect(screen.getByTestId('hero-callout-posture', hidden)).toHaveTextContent('0°');
    expect(screen.getByTestId('hero-callout-cadence', hidden)).toHaveTextContent('0 spm');
  });

  it('draws both motion-trail ghosts and the main figure inside one scaled group', async () => {
    await render(<StrideHero testID="hero" />);

    expect(screen.getByTestId('hero-ghost-0', hidden)).toBeTruthy();
    expect(screen.getByTestId('hero-ghost-1', hidden)).toBeTruthy();
    expect(screen.getByTestId('hero-figure-body', hidden).props.stroke).toBeDefined();
  });
});

describe('StrideHero — reduced motion (the poster)', () => {
  it('mounts the end frame with the four measurements at their final values', async () => {
    await render(<StrideHero reduceMotion testID="hero" />);

    expect(screen.getByTestId('hero-callout-posture', hidden)).toHaveTextContent('6°');
    expect(screen.getByTestId('hero-callout-armSwing', hidden)).toHaveTextContent('90°');
    expect(screen.getByTestId('hero-callout-cadence', hidden)).toHaveTextContent('176 spm');
    expect(screen.getByTestId('hero-callout-elasticity', hidden)).toHaveTextContent('230 ms');
  });

  it('shows the callout names and sub-lines from the copy file', async () => {
    await render(<StrideHero reduceMotion testID="hero" />);

    for (const c of Object.values(Copy.entry.hero.callout)) {
      expect(screen.getByText(c.name, hidden)).toBeTruthy();
      expect(screen.getByText(c.sub, hidden)).toBeTruthy();
    }
  });

  // The poster is pinned past the hold, so the screen's cue must be told so at once — and only
  // once. (In the animated mode the same reaction fires when the UI-thread clock crosses
  // `HERO_CUE_T`, which Jest cannot advance; see CLAUDE.md § Testing.)
  it('reports the hold immediately, exactly once', async () => {
    const onHold = jest.fn();
    await render(<StrideHero reduceMotion onHold={onHold} testID="hero" />);

    await waitFor(() => expect(onHold).toHaveBeenCalledTimes(1));
  });
});
