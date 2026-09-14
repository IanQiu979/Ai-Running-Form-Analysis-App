/**
 * Locks for the lane-2 chrome primitives (2026-09-14): the tab bar, the top bar, the confirm
 * dialog and the icon control. Structural claims only — which nodes mount, what they say, what
 * they hand back — never a pixel value; the visual match is the screenshot pass.
 *
 * Every press is wrapped in an awaited `act`: two bare `fireEvent.press` calls in one test leave
 * an act scope open under this Jest setup, and the NEXT test's `render` then produces an empty
 * tree ("Unable to find an element with testID") — which reads like a missing component and is
 * not one.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ConfirmDialog } from '../ui/confirm-dialog';
import { SquareIconButton } from '../ui/square-icon-button';
import { TopBar } from '../ui/top-bar';
import { BackIcon } from '../ui/v23-icons';
import { V23TabBar } from '../v23-tab-bar';
import { Copy } from '@/constants/copy';
import { Ink, Layout } from '@/constants/v23-theme';

describe('<V23TabBar>', () => {
  it('names both tabs, marks the active one selected, and routes each press', async () => {
    const onPressHome = jest.fn();
    const onPressHistory = jest.fn();
    await render(<V23TabBar active="home" onPressHome={onPressHome} onPressHistory={onPressHistory} testID="bar" />);

    const home = screen.getByRole('tab', { name: Copy.home.title });
    const history = screen.getByRole('tab', { name: Copy.history.title });
    expect(home.props.accessibilityState).toEqual({ selected: true });
    expect(history.props.accessibilityState).toEqual({ selected: false });

    await act(async () => {

      fireEvent.press(history);

    });
    expect(onPressHistory).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.press(home);
    });
    expect(onPressHome).toHaveBeenCalledTimes(1);
  });

  it('floats by default', async () => {
    await render(<V23TabBar active="history" onPressHome={() => {}} onPressHistory={() => {}} testID="bar" />);
    const floating = StyleSheet.flatten(screen.getByTestId('bar').props.style);
    expect(floating.position).toBe('absolute');
    expect(floating.height).toBe(Layout.tabBar.height);
  });

  it('lays out inline, opaque, when asked', async () => {
    await render(
      <V23TabBar active="history" mode="inline" onPressHome={() => {}} onPressHistory={() => {}} testID="bar" />
    );
    const inline = StyleSheet.flatten(screen.getByTestId('bar').props.style);
    expect(inline.position).toBeUndefined();
    expect(inline.backgroundColor).toBe(Ink.bgRaised);
  });
});

describe('<TopBar>', () => {
  it('centres a header-role title between two controls or spacers', async () => {
    const onBack = jest.fn();
    await render(
      <TopBar
        title="Add footage"
        leading={
          <SquareIconButton accessibilityLabel="Back" onPress={onBack} bleed="left">
            <BackIcon />
          </SquareIconButton>
        }
      />
    );
    expect(screen.getByRole('header', { name: 'Add footage' })).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('hangs a bled control past the gutter by the icon bleed', async () => {
    await render(
      <SquareIconButton accessibilityLabel="Settings" onPress={() => {}} bleed="right" testID="control">
        <BackIcon />
      </SquareIconButton>
    );
    const style = StyleSheet.flatten(screen.getByTestId('control').props.style);
    expect(style.marginRight).toBe(-Layout.iconBleed);
    expect(style.width).toBe(Layout.hitTarget);
    expect(style.height).toBe(Layout.hitTarget);
  });
});

describe('<ConfirmDialog>', () => {
  it('renders title, body, a danger primary and a cancel link, and routes both', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    await render(
      <ConfirmDialog
        visible
        tone="danger"
        title="Delete this analysis?"
        body="This cannot be undone."
        primary={{ label: 'Delete analysis', onPress: onConfirm }}
        secondary={{ label: 'Cancel', onPress: onCancel }}
        testID="dialog"
      />
    );
    expect(screen.getByRole('header', { name: 'Delete this analysis?' })).toBeTruthy();
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();

    const primary = screen.getByRole('button', { name: 'Delete analysis' });
    expect(StyleSheet.flatten(primary.props.style).backgroundColor).toBe(Ink.danger);
    await act(async () => {
      fireEvent.press(primary);
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await act(async () => {

      fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));

    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('is a one-button notice without a secondary, on the accent fill', async () => {
    const onDismiss = jest.fn();
    await render(
      <ConfirmDialog visible title="Purchase complete" body="Your plan is active." primary={{ label: 'OK', onPress: onDismiss }} />
    );
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    const primary = screen.getByRole('button', { name: 'OK' });
    expect(StyleSheet.flatten(primary.props.style).backgroundColor).toBe(Ink.accent);
  });

  it('mounts nothing while hidden', async () => {
    await render(
      <ConfirmDialog visible={false} title="Hidden" body="Hidden body" primary={{ label: 'OK', onPress: () => {} }} />
    );
    expect(screen.queryByText('Hidden')).toBeNull();
  });
});
