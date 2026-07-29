/**
 * Moment 1 (spec 2026-07-26 §4): the ground rule alone, <=400ms, interruptible. Locks: exactly one
 * line renders; a tap skips straight to `onDone`; reduced motion calls `onDone` without needing a
 * tap.
 */
import { render, screen, fireEvent } from '@testing-library/react-native';

import { LaunchIntro } from '../launch-intro';

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

describe('LaunchIntro', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(false);
  });

  it('renders exactly one hairline — the ground rule alone', async () => {
    await render(<LaunchIntro onDone={jest.fn()} />);
    expect(screen.getByTestId('launch-intro-ground', { includeHiddenElements: true })).toBeTruthy();
  });

  it('is interruptible — a tap skips straight to onDone', async () => {
    const onDone = jest.fn();
    await render(<LaunchIntro onDone={onDone} />);
    fireEvent.press(screen.getByTestId('launch-intro-overlay'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('reduced motion still calls onDone, with no tap needed', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    const onDone = jest.fn();
    await render(<LaunchIntro onDone={onDone} />);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
