/**
 * Regression locks for `lib/connectivity.ts` (issue #93).
 *
 * `@react-native-community/netinfo` wraps a native module, so — same convention as
 * `lib/__tests__/media-file-size.test.ts` (`expo-file-system`) and
 * `lib/__tests__/secure-storage.test.ts` (`expo-secure-store`) — it's mocked here rather than
 * exercised for real.
 */
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { checkConnectivity, isConnectivityUsable, useIsOffline } from '../connectivity';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(),
    fetch: jest.fn(),
  },
}));

const mockAddEventListener = NetInfo.addEventListener as jest.MockedFunction<
  typeof NetInfo.addEventListener
>;
const mockFetch = NetInfo.fetch as jest.MockedFunction<typeof NetInfo.fetch>;

/** Builds a minimally-valid NetInfoState for a given (isConnected, isInternetReachable) pair —
 * only the two fields `isConnectivityUsable` reads are load-bearing for any of these tests. */
function state(isConnected: boolean | null, isInternetReachable: boolean | null): NetInfoState {
  return {
    type: 'wifi',
    isConnected,
    isInternetReachable,
    details: null,
  } as unknown as NetInfoState;
}

beforeEach(() => {
  mockAddEventListener.mockReset();
  mockFetch.mockReset();
});

describe('isConnectivityUsable', () => {
  it('is usable when connected and reachability is confirmed true', () => {
    expect(isConnectivityUsable(state(true, true))).toBe(true);
  });

  it('is usable when connected and reachability is still indeterminate (null) — fails OPEN on ambiguity, not closed', () => {
    expect(isConnectivityUsable(state(true, null))).toBe(true);
  });

  it('is NOT usable when reachability is definitively false, even if connected', () => {
    expect(isConnectivityUsable(state(true, false))).toBe(false);
  });

  it('is NOT usable when isConnected is false', () => {
    expect(isConnectivityUsable(state(false, false))).toBe(false);
  });

  it('is NOT usable when isConnected is null (NetInfo\'s "unknown" state)', () => {
    expect(isConnectivityUsable(state(null, null))).toBe(false);
  });
});

describe('checkConnectivity', () => {
  it('resolves true when NetInfo.fetch reports a usable connection', async () => {
    mockFetch.mockResolvedValue(state(true, true));
    await expect(checkConnectivity()).resolves.toBe(true);
  });

  it('resolves false when NetInfo.fetch reports no connection', async () => {
    mockFetch.mockResolvedValue(state(false, false));
    await expect(checkConnectivity()).resolves.toBe(false);
  });

  it('re-fetches on every call rather than caching a stale reading', async () => {
    mockFetch.mockResolvedValueOnce(state(true, true)).mockResolvedValueOnce(state(false, false));

    await expect(checkConnectivity()).resolves.toBe(true);
    await expect(checkConnectivity()).resolves.toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('useIsOffline', () => {
  it('starts false (never flashes an offline banner) before the first NetInfo reading arrives', async () => {
    // Simulate a listener that never fires synchronously — the hook must not assume "offline"
    // while it waits.
    mockAddEventListener.mockImplementation(() => () => {});

    const { result } = await renderHook(() => useIsOffline());

    expect(result.current).toBe(false);
  });

  it('reflects the first reading once NetInfo delivers it: true (usable) -> not offline', async () => {
    let listener: ((s: NetInfoState) => void) | undefined;
    mockAddEventListener.mockImplementation((cb) => {
      listener = cb;
      return () => {};
    });

    const { result } = await renderHook(() => useIsOffline());
    await act(() => listener?.(state(true, true)));

    expect(result.current).toBe(false);
  });

  it('reflects the first reading once NetInfo delivers it: disconnected -> offline', async () => {
    let listener: ((s: NetInfoState) => void) | undefined;
    mockAddEventListener.mockImplementation((cb) => {
      listener = cb;
      return () => {};
    });

    const { result } = await renderHook(() => useIsOffline());
    await act(() => listener?.(state(false, false)));

    expect(result.current).toBe(true);
  });

  it('updates live as connectivity changes after mount', async () => {
    let listener: ((s: NetInfoState) => void) | undefined;
    mockAddEventListener.mockImplementation((cb) => {
      listener = cb;
      return () => {};
    });

    const { result } = await renderHook(() => useIsOffline());
    await act(() => listener?.(state(true, true)));
    expect(result.current).toBe(false);

    await act(() => listener?.(state(false, false)));
    await waitFor(() => expect(result.current).toBe(true));

    await act(() => listener?.(state(true, true)));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('unsubscribes from NetInfo on unmount', async () => {
    const unsubscribe = jest.fn();
    mockAddEventListener.mockImplementation(() => unsubscribe);

    const { unmount } = await renderHook(() => useIsOffline());
    await unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
