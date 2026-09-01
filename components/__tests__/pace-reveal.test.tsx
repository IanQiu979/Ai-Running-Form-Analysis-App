/**
 * Locks for the count-up numeral (`components/pace-reveal.tsx`, issue #61). It is mounted only by
 * `<PaceReadout>`'s `animate` mode — which tree gets mounted when is proven separately in
 * `pace-readout-reveal.test.tsx`; this file proves the primitive itself keeps the property
 * `docs/design/motion-consult.md` picked it FOR:
 *
 *   the count-up numeral is a real, inert `TextInput` whose `defaultValue` already carries the
 *   TRUE score (item 2). Reanimated patches its native `text` prop on the UI thread; if that
 *   patch never lands — an older runtime, a platform that ignores it — the user must still read
 *   the real number, never a stuck 0 and never an editable field.
 *
 * ITEM 1'S BAR-FILL PRIMITIVE IS GONE, retired with the 2026-09-01 Cadence Arcs redesign: the
 * pillar bars became arc rings, and a ring has no width to animate, so "scaleX, never width" has
 * no subject any more. Its successor invariant — the ring's layout box never moves, only its
 * stroke offset does — is proven in `pace-readout-reveal.test.tsx` and `arc-ring.test.tsx`.
 *
 * As in `pace-readout-reveal.test.tsx`, Reanimated animations do not advance under Jest here, so
 * these assert first frames and invariants, never a finished animation.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { AnimatedOverallNumeral } from '../pace-reveal';

const SCORE = 78;

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
