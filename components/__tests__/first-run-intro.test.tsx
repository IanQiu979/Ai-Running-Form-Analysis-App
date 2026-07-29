/**
 * Moment 2 (spec 2026-07-26 §4): all three annotations draw onto the empty-state figure outline
 * (`FramingGuide`'s figure, reused rather than rebuilt), once per install. Locks: it renders the
 * figure plus all three lines, marks itself seen and calls `onDone` exactly once when the draw
 * finishes, and reduced motion still does both without needing the full duration to elapse.
 */
import { render, screen } from '@testing-library/react-native';

import { FirstRunIntro } from '../first-run-intro';

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

const mockMarkFirstRunSeen = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/first-run', () => ({
  markFirstRunSeen: () => mockMarkFirstRunSeen(),
}));

describe('FirstRunIntro', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseReducedMotion.mockReturnValue(false);
  });

  it('renders the figure outline and all three annotation lines', async () => {
    await render(<FirstRunIntro onDone={jest.fn()} />);
    expect(screen.getByTestId('first-run-intro-ground', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('first-run-intro-posture', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('first-run-intro-landing', { includeHiddenElements: true })).toBeTruthy();
  });

  it('marks itself seen and calls onDone once the draw finishes', async () => {
    jest.useFakeTimers();
    const onDone = jest.fn();
    await render(<FirstRunIntro onDone={onDone} />);
    jest.advanceTimersByTime(3000);
    await Promise.resolve();
    expect(mockMarkFirstRunSeen).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('reduced motion still marks seen and calls onDone', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    const onDone = jest.fn();
    await render(<FirstRunIntro onDone={onDone} />);
    expect(mockMarkFirstRunSeen).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
