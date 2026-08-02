/**
 * `<PillButton>` is now every button in the app, so the things it gets wrong, it gets wrong
 * everywhere. The locks below are the ones that matter:
 *
 *   - `disabled` and `busy` are SEPARATE. A busy control that is still tappable double-submits;
 *     the component deliberately does not infer one from the other, so a caller passing only
 *     `busy` must still get a live button — and this proves that is a decision, not an oversight.
 *   - the accessible name comes from the label with no call-site wiring, so no screen can ship a
 *     nameless button;
 *   - the ghost variant still meets the 44pt floor even though it has no fill to make it look big;
 *   - reduced motion drops the press SCALE but keeps press feedback (via opacity) — feedback must
 *     survive, only the movement goes.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { PillButton } from '../pill-button';
import { Colors, ControlHeight, HitTarget, type ColorScheme } from '@/constants/theme';

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

const mockUseColorScheme = jest.fn<ColorScheme, []>(() => 'light');
jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: () => mockUseColorScheme(),
}));

describe('PillButton', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(false);
    mockUseColorScheme.mockReturnValue('light');
  });

  it('names itself from its label — a call site cannot ship a nameless button', async () => {
    await render(<PillButton label="Analyze my form" onPress={jest.fn()} testID="cta" />);

    expect(screen.getByLabelText('Analyze my form')).toBeTruthy();
    expect(screen.getByTestId('cta').props.accessibilityRole).toBe('button');
  });

  it('fires onPress', async () => {
    const onPress = jest.fn();
    await render(<PillButton label="Go" onPress={onPress} testID="cta" />);

    fireEvent.press(screen.getByTestId('cta'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled, and says so in accessibilityState', async () => {
    const onPress = jest.fn();
    await render(<PillButton label="Go" onPress={onPress} disabled testID="cta" />);

    fireEvent.press(screen.getByTestId('cta'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId('cta').props.accessibilityState.disabled).toBe(true);
  });

  it('treats busy as a DISPLAY state only — it never silently disables the control', async () => {
    // The important half: a caller that wants a submitting button to stop accepting taps must
    // pass `disabled` too. Conflating the two here would let a screen think it was protected
    // when it was not.
    const onPress = jest.fn();
    await render(<PillButton label="Send" onPress={onPress} busy testID="cta" />);

    expect(screen.getByTestId('cta').props.accessibilityState.busy).toBe(true);
    expect(screen.getByTestId('cta').props.accessibilityState.disabled).toBe(false);
    fireEvent.press(screen.getByTestId('cta'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('swaps the label for a spinner while busy, but keeps its accessible name', async () => {
    await render(<PillButton label="Send" onPress={jest.fn()} busy testID="cta" />);

    expect(screen.queryByText('Send')).toBeNull();
    expect(screen.getByLabelText('Send')).toBeTruthy();
  });

  it('keeps the pill variants at the taller control height', async () => {
    await render(<PillButton label="Go" onPress={jest.fn()} testID="cta" />);

    const style = StyleSheet.flatten(screen.getByTestId('cta').props.style);
    expect(style.minHeight).toBe(ControlHeight.pill);
  });

  it('still meets the 44pt floor on the ghost variant, which has no fill to make it look big', async () => {
    await render(<PillButton variant="ghost" label="Cancel" onPress={jest.fn()} testID="cta" />);

    const style = StyleSheet.flatten(screen.getByTestId('cta').props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(HitTarget.min);
    expect(style.minWidth).toBeGreaterThanOrEqual(HitTarget.min);
  });

  // The 2026-08-02 captain's decision, locked. These two assertions are a pair and only mean
  // anything together: "translucent" without a proven ring is a control whose edge disappears into
  // the page wash, which is exactly what the redesign refused to ship. Neither half may be dropped
  // without the other being reconsidered.
  it('gives the secondary pill a GENUINELY translucent fill — no opaque surface colour', async () => {
    await render(<PillButton variant="secondary" label="Not now" onPress={jest.fn()} testID="cta" />);

    // The frost layer paints `Glass.control`; the Pressable itself must therefore stay transparent,
    // or the token's alpha would be composited over an opaque colour and the page wash would not
    // show through at all.
    const style = StyleSheet.flatten(screen.getByTestId('cta').props.style);
    expect(style.backgroundColor).toBe('transparent');
    expect(screen.getByTestId('cta-frost', { includeHiddenElements: true })).toBeTruthy();
  });

  it('keeps a proven control.border ring on the secondary pill — the fill cannot carry 1.4.11', async () => {
    mockUseColorScheme.mockReturnValue('dark');
    await render(<PillButton variant="secondary" label="Not now" onPress={jest.fn()} testID="cta" />);

    const style = StyleSheet.flatten(screen.getByTestId('cta').props.style);
    expect(style.borderColor).toBe(Colors.dark.control.border);
    expect(style.borderWidth).toBeGreaterThan(0);
  });

  it('still renders and still fires under reduced motion — only the press scale is dropped', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    const onPress = jest.fn();
    await render(<PillButton label="Go" onPress={onPress} testID="cta" />);

    fireEvent.press(screen.getByTestId('cta'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
