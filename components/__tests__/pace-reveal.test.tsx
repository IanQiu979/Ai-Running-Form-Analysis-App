/**
 * Locks for the two reveal primitives (`components/pace-reveal.tsx`, issue #61). They are mounted
 * only by `<PaceReadout>`'s `animate` mode — which tree gets mounted when is proven separately in
 * `pace-readout-reveal.test.tsx`; this file proves the primitives themselves keep the two
 * properties `docs/design/motion-consult.md` picked them FOR:
 *
 *   1. the bar's `width` is its final width from the first frame and never moves, so the fill can
 *      only ever grow by transform — "scaleX, never width" (item 1). Animating width instead
 *      would still look right while thrashing layout on every frame of the reveal, which is
 *      precisely the regression a screenshot cannot catch;
 *   2. the count-up numeral is a real, inert `TextInput` whose `defaultValue` already carries the
 *      TRUE score (item 2). Reanimated patches its native `text` prop on the UI thread; if that
 *      patch never lands — an older runtime, a platform that ignores it — the user must still read
 *      the real number, never a stuck 0 and never an editable field.
 *
 * As in `pace-readout-reveal.test.tsx`, Reanimated animations do not advance under Jest here, so
 * these assert first frames and invariants, never a finished animation.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { AnimatedOverallNumeral, AnimatedPillarBarFill } from '../pace-reveal';

const SCORE = 78;

const barStyle = () =>
  StyleSheet.flatten(screen.getByTestId('bar', { includeHiddenElements: true }).props.style);

describe('AnimatedPillarBarFill — grows by transform, never by layout', () => {
  it('sits at its final width, scaled to nothing, before the reveal is triggered', async () => {
    await render(<AnimatedPillarBarFill testID="bar" index={0} score={SCORE} triggered={false} style={{}} />);

    expect(barStyle().width).toBe(`${SCORE}%`);
    expect(barStyle().transform).toEqual([{ scaleX: 0 }]);
  });

  it('keeps that exact width once triggered — only the transform is allowed to move', async () => {
    await render(<AnimatedPillarBarFill testID="bar" index={0} score={SCORE} triggered style={{}} />);

    // The invariant that makes this a transform animation rather than a layout animation: the
    // width is identical whether the reveal has started or not.
    expect(barStyle().width).toBe(`${SCORE}%`);
  });

  it('grows from the left edge, so the bar reads as filling rather than as widening from centre', async () => {
    await render(<AnimatedPillarBarFill testID="bar" index={0} score={SCORE} triggered style={{}} />);

    expect(barStyle().transformOrigin).toBe('left');
  });

  it('keeps the caller\'s band colour and bar styling intact', async () => {
    await render(
      <AnimatedPillarBarFill testID="bar" index={2} score={SCORE} triggered style={{ backgroundColor: '#279390' }} />
    );

    expect(barStyle().backgroundColor).toBe('#279390');
  });
});

describe('AnimatedOverallNumeral — an inert input that already shows the truth', () => {
  it('paints the real score even if the UI-thread text patch never lands', async () => {
    await render(<AnimatedOverallNumeral testID="numeral" value={SCORE} triggered={false} style={{}} />);

    expect(screen.getByTestId('numeral', { includeHiddenElements: true }).props.defaultValue).toBe(String(SCORE));
  });

  it('can never be typed into, focused, or raise a keyboard — it is decoration, not a field', async () => {
    await render(<AnimatedOverallNumeral testID="numeral" value={SCORE} triggered style={{}} />);

    const node = screen.getByTestId('numeral', { includeHiddenElements: true });
    expect(node.props.editable).toBe(false);
    expect(node.props.focusable).toBe(false);
    expect(node.props.showSoftInputOnFocus).toBe(false);
  });

  it('strips the TextInput padding that would otherwise shift the numeral off the Text baseline', async () => {
    await render(<AnimatedOverallNumeral testID="numeral" value={SCORE} triggered style={{ fontSize: 64 }} />);

    const style = StyleSheet.flatten(screen.getByTestId('numeral', { includeHiddenElements: true }).props.style);
    expect(style.padding).toBe(0);
    expect(style.fontSize).toBe(64);
  });
});
