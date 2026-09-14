/**
 * The navigator's `tabBar` renderer (`app/(tabs)/_layout.tsx`): V23-07's floating strip on Home,
 * nothing on History (which lays the bar out inline itself), its bottom edge on the live safe-area
 * inset and never under the design canvas's 34 pt.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { StyleSheet } from 'react-native';

import { Copy } from '@/constants/copy';
import { Layout } from '@/constants/v23-theme';

import { FloatingTabBar } from '../_layout';

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => insets,
}));

jest.mock('expo-router', () => ({
  Tabs: () => null,
}));

function props(index: 0 | 1, overrides: Partial<{ defaultPrevented: boolean }> = {}) {
  const navigation = {
    emit: jest.fn(() => ({ defaultPrevented: overrides.defaultPrevented ?? false })),
    navigate: jest.fn(),
  };
  const state = {
    index,
    routes: [
      { key: 'index-key', name: 'index', params: undefined },
      { key: 'history-key', name: 'history', params: undefined },
    ],
  };
  return { navigation, bar: { state, navigation } as unknown as BottomTabBarProps };
}

function barStyle() {
  return StyleSheet.flatten(screen.getByTestId('tab-bar').props.style) as Record<string, unknown>;
}

describe('FloatingTabBar', () => {
  beforeEach(() => {
    insets.bottom = 0;
  });

  it('sits on the design canvas’s 34 pt when the device has no bottom inset', async () => {
    await render(<FloatingTabBar {...props(0).bar} />);

    expect(barStyle().bottom).toBe(Layout.canvas.safeBottom);
    expect(barStyle().position).toBe('absolute');
  });

  it('sits on the live bottom inset when that is larger', async () => {
    insets.bottom = 48;
    await render(<FloatingTabBar {...props(0).bar} />);

    expect(barStyle().bottom).toBe(48);
  });

  it('renders nothing on History, which draws the bar inline itself', async () => {
    await render(<FloatingTabBar {...props(1).bar} />);

    expect(screen.queryByTestId('tab-bar')).toBeNull();
  });

  it('emits tabPress and navigates to the other tab', async () => {
    const { navigation, bar } = props(0);
    await render(<FloatingTabBar {...bar} />);

    await act(async () => {
      fireEvent.press(screen.getByRole('tab', { name: Copy.history.title }));
    });
    expect(navigation.emit).toHaveBeenCalledWith({ type: 'tabPress', target: 'history-key', canPreventDefault: true });
    expect(navigation.navigate).toHaveBeenCalledWith('history', undefined);
  });

  it('does not navigate when a screen prevents the tab press', async () => {
    const { navigation, bar } = props(0, { defaultPrevented: true });
    await render(<FloatingTabBar {...bar} />);

    await act(async () => {
      fireEvent.press(screen.getByRole('tab', { name: Copy.history.title }));
    });
    expect(navigation.emit).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('emits but does not navigate for the tab already focused', async () => {
    const { navigation, bar } = props(0);
    await render(<FloatingTabBar {...bar} />);

    await act(async () => {
      fireEvent.press(screen.getByRole('tab', { name: Copy.home.title }));
    });
    expect(navigation.emit).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).not.toHaveBeenCalled();
  });
});
