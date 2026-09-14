/**
 * The floating tab bar's horizontal inset must be expressed as `start`/`end`, never `left`/`right`.
 *
 * WHY. Yoga resolves the writing-direction properties (`start`/`end`) at HIGHER precedence than
 * the physical ones (`left`/`right`), so wherever a container's own `start: 0, end: 0` reaches a
 * bar, a `left`/`right` written on it is not overridden — it is silently DISCARDED and the bar
 * spans the full viewport. That is exactly how the Calm redesign's bar shipped edge-to-edge for
 * weeks (issue #63): typecheck cannot see it (`left` is a valid ViewStyle key) and on a phone the
 * missing 24 pt is nearly invisible. This locks the property on the RENDERED node's flattened
 * style, so a refactor that moves the inset somewhere else still has to land it as `start`/`end`.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { V23TabBar } from '@/components/v23-tab-bar';
import { Copy } from '@/constants/copy';
import { Ink, Layout } from '@/constants/v23-theme';

function barStyle() {
  return StyleSheet.flatten(screen.getByTestId('tab-bar').props.style) as Record<string, unknown>;
}

describe('V23TabBar floating mode', () => {
  it('is absolutely positioned and inset with start/end, never left/right', async () => {
    await render(<V23TabBar testID="tab-bar" active="home" onPressHome={() => {}} onPressHistory={() => {}} />);

    const style = barStyle();
    expect(style.position).toBe('absolute');
    expect(style.start).toBe(Layout.tabBar.inset);
    expect(style.end).toBe(Layout.tabBar.inset);
    expect(style).not.toHaveProperty('left');
    expect(style).not.toHaveProperty('right');
  });

  it('takes the host’s bottom edge through `style`', async () => {
    await render(
      <V23TabBar testID="tab-bar" active="home" onPressHome={() => {}} onPressHistory={() => {}} style={{ bottom: 48 }} />
    );

    expect(barStyle().bottom).toBe(48);
  });
});

describe('V23TabBar inline mode', () => {
  it('reserves layout space as an opaque strip — not absolute, not inset', async () => {
    await render(
      <V23TabBar testID="tab-bar" mode="inline" active="history" onPressHome={() => {}} onPressHistory={() => {}} />
    );

    const style = barStyle();
    expect(style.position).toBeUndefined();
    expect(style).not.toHaveProperty('start');
    expect(style).not.toHaveProperty('end');
    expect(style.backgroundColor).toBe(Ink.bgRaised);
  });
});

describe('V23TabBar cells', () => {
  it('marks the active tab selected and routes each cell to its own callback', async () => {
    const onPressHome = jest.fn();
    const onPressHistory = jest.fn();
    await render(<V23TabBar testID="tab-bar" active="history" onPressHome={onPressHome} onPressHistory={onPressHistory} />);

    expect(screen.getByRole('tab', { name: Copy.history.title, selected: true })).toBeTruthy();
    expect(screen.getByRole('tab', { name: Copy.home.title, selected: false })).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByRole('tab', { name: Copy.home.title }));
    });
    expect(onPressHome).toHaveBeenCalledTimes(1);
    expect(onPressHistory).not.toHaveBeenCalled();
  });
});
