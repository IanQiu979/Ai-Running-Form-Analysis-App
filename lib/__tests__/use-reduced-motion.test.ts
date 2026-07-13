/**
 * `useReducedMotion` (`hooks/use-reduced-motion.ts`) — issue #29 wired the mechanism; issue #61
 * is its first real motion consumer (`components/pace-readout.tsx`, `app/_layout.tsx`) and is
 * what puts this test alongside it. Locks: reads the OS "Reduce Motion" setting once on mount,
 * stays live via the `reduceMotionChanged` subscription while mounted, removes that subscription
 * on unmount, and never calls `setState` from a read that resolves after unmount (the `isMounted`
 * guard in the hook — the one thing this file exists to prove, since a regression there would
 * only ever surface as an intermittent React warning, not a type error or a visible bug).
 */
import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { useReducedMotion } from '@/hooks/use-reduced-motion';

const mockIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled as jest.Mock;
const mockAddEventListener = AccessibilityInfo.addEventListener as jest.Mock;

describe('useReducedMotion', () => {
  beforeEach(() => {
    // `mockReset` below (afterEach) wipes react-native's own jest mock default
    // (`{ remove: jest.fn() }`, node_modules/react-native/jest/mocks/AccessibilityInfo.js) along
    // with it, so every test needs a real return value here to unmount cleanly — tests that care
    // about the listener itself (the subscribe/unmount cases below) override this.
    mockAddEventListener.mockImplementation(() => ({ remove: jest.fn() }));
  });

  afterEach(() => {
    mockIsReduceMotionEnabled.mockReset();
    mockAddEventListener.mockReset();
  });

  it('defaults to false before the initial async read resolves', async () => {
    mockIsReduceMotionEnabled.mockReturnValue(new Promise<boolean>(() => {}));

    const { result } = await renderHook(() => useReducedMotion());

    expect(result.current).toBe(false);
  });

  it('reflects the OS setting once the initial read resolves true', async () => {
    mockIsReduceMotionEnabled.mockResolvedValue(true);

    const { result } = await renderHook(() => useReducedMotion());

    expect(result.current).toBe(true);
  });

  it('stays false when the OS setting reads false', async () => {
    mockIsReduceMotionEnabled.mockResolvedValue(false);

    const { result } = await renderHook(() => useReducedMotion());

    expect(result.current).toBe(false);
  });

  it('subscribes to reduceMotionChanged and updates live while mounted', async () => {
    mockIsReduceMotionEnabled.mockResolvedValue(false);
    let emit: ((enabled: boolean) => void) | undefined;
    mockAddEventListener.mockImplementation((_event: string, handler: (enabled: boolean) => void) => {
      emit = handler;
      return { remove: jest.fn() };
    });

    const { result } = await renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    expect(mockAddEventListener).toHaveBeenCalledWith('reduceMotionChanged', expect.any(Function));

    await act(() => {
      emit?.(true);
    });

    expect(result.current).toBe(true);
  });

  it('removes the subscription on unmount', async () => {
    mockIsReduceMotionEnabled.mockResolvedValue(false);
    const remove = jest.fn();
    mockAddEventListener.mockReturnValue({ remove });

    const { unmount } = await renderHook(() => useReducedMotion());
    await unmount();

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('never updates state from an initial read that resolves after unmount', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    let resolveRead: (enabled: boolean) => void = () => {};
    mockIsReduceMotionEnabled.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveRead = resolve;
      })
    );

    const { unmount } = await renderHook(() => useReducedMotion());
    await unmount();

    // Resolving after unmount: without the hook's `isMounted` guard, this would call
    // `setState` on an unmounted component and React would log its warning below.
    await act(async () => {
      resolveRead(true);
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
