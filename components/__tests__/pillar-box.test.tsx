/**
 * Locks for `<PillarBox>` (V23-04): which tree each state mounts and what it says. Reanimated
 * animations do not advance under Jest here (CLAUDE.md § Testing), so nothing below asserts the
 * expand tween finished — only that the closed square, the open card and the close control are
 * what the page draws, and that each hands control back to the parent through `onToggle`.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { PillarBox } from '../pillar-box';
import { Copy } from '@/constants/copy';

const posture = Copy.entry.details.pillar.posture;

describe('closed', () => {
  it('renders the letter and the name, as a button', async () => {
    const onToggle = jest.fn();
    await render(<PillarBox id="posture" open={false} onToggle={onToggle} reduceMotion />);

    expect(screen.getByText('P')).toBeTruthy();
    expect(screen.getByText(posture.name)).toBeTruthy();
    expect(screen.queryByText(posture.desc)).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: posture.name }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('mounts at rest — the section that holds it owns its arrival', async () => {
    await render(<PillarBox id="cadence" open={false} onToggle={() => {}} testID="box" />);
    const style = StyleSheet.flatten(screen.getByTestId('box').props.style);
    expect(style.opacity).toBeUndefined();
    expect(style.transform).toBeUndefined();
  });
});

describe('open', () => {
  it('renders the description, metric, range and a close control', async () => {
    const onToggle = jest.fn();
    await render(<PillarBox id="posture" open onToggle={onToggle} reduceMotion />);

    expect(screen.getByRole('header', { name: posture.name })).toBeTruthy();
    expect(screen.getByText(posture.desc)).toBeTruthy();
    expect(screen.getByText(posture.metric)).toBeTruthy();
    expect(screen.getByText(posture.range)).toBeTruthy();
    expect(screen.queryByText('P')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: Copy.entry.details.close }));
    // Reduced motion closes at once — there is no reverse tween to wait out.
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('does not hand back synchronously with motion on (the reverse tween owns the hand-off)', async () => {
    const onToggle = jest.fn();
    await render(<PillarBox id="armSwing" open onToggle={onToggle} />);

    fireEvent.press(screen.getByRole('button', { name: Copy.entry.details.close }));
    // What this proves is only that a press does NOT call back before the tween — Reanimated never
    // completes under Jest, so it cannot prove the callback fires at the tween's end. That half of
    // the contract is the reduced-motion test above (same handler, no tween) plus the simulator
    // pass; a wiring bug that dropped the callback entirely would pass here and fail there.
    expect(onToggle).not.toHaveBeenCalled();
  });
});
