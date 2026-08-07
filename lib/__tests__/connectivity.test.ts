/**
 * Regression locks for `lib/connectivity.ts` (issue #93).
 *
 * `@react-native-community/netinfo` wraps a native module, so — same convention as
 * `lib/__tests__/media-file-size.test.ts` (`expo-file-system`) and
 * `lib/__tests__/secure-storage.test.ts` (`expo-secure-store`) — it's mocked here rather than
 * exercised for real.
 *
 * The last `describe` block is a different kind of lock — it guards the dependency manifest, not
 * the module. See its own header for the 2026-08-07 finding that put it there.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

/**
 * Dependency-manifest lock — one connectivity library, not two.
 *
 * WHY THIS EXISTS (2026-08-07). `expo-network@8.0.8` turned up installed into `node_modules` on a
 * working copy of this app with **zero references anywhere in `app/`, `lib/`, `components/`,
 * `hooks/`, `constants/`, `supabase/` or `.maestro/`** — `npm ls` reported it `extraneous`. It had
 * never been committed, and nobody could say what it was for. The investigation's conclusion was
 * that it is leftover cruft, not a half-finished fix, and the reasoning is worth keeping because
 * the same dead end is easy to walk into twice:
 *
 *  - Connectivity is ALREADY SOLVED, by `lib/connectivity.ts` on
 *    `@react-native-community/netinfo` (issue #93) — a live `useIsOffline()` behind the global
 *    `components/offline-banner.tsx`, and a one-shot `checkConnectivity()` pre-flight gate wired
 *    at `app/analyzing.tsx`. Everything above this comment proves that half works.
 *  - `expo-network` overlaps it (`getNetworkStateAsync`) rather than adding to it. Two independent
 *    connectivity sources is an active hazard, not redundancy: they classify the indeterminate
 *    "connected, reachability still probing" state differently, so the banner and the pre-flight
 *    gate could disagree about whether the device is online — exactly the "never claim a state
 *    that isn't true" failure issue #93 exists to prevent.
 *  - The `TypeError: Network request failed` class of bug (a sibling app hit it over Expo tunnel
 *    mode on a physical device) has NO foothold here, so there is no problem for a second library
 *    to solve. This app talks to a hosted `https://` Supabase project read from
 *    `EXPO_PUBLIC_SUPABASE_URL`; there is no `http://` and no `localhost`/`127.0.0.1` anywhere in
 *    app source. Tunnel mode tunnels Metro's *bundler*, not the app's own `fetch` calls, so the
 *    device reaching Supabase never depends on it. (`eas.json`'s `development-local` /
 *    `preview-local` profiles do pin `http://127.0.0.1:54321`, but both are declared
 *    `ios.simulator: true` — the Simulator shares the Mac host's loopback, which is the documented
 *    point of them. See `docs/architecture.md`'s issue #84 section.)
 *  - `lib/functions-client.ts` already classifies the failure that surfaces as "Network request
 *    failed" — `@supabase/functions-js` wraps it as `FunctionsFetchError` — into
 *    `kind: 'network'`, distinct from a server-authored `{ error, code }`. Nothing about
 *    detecting it is missing.
 *
 * So: if a future change wants a second network library, it needs a reason none of the above
 * covers, and this test is where it has to be argued.
 */
describe('connectivity dependency contract', () => {
  /**
   * Packages that would each become a SECOND source of truth for "is the device online". Not an
   * exhaustive list of every networking package on npm — it is the set that has plausibly shown up
   * in, or been reached for by, this project. `@react-native-community/netinfo` is deliberately
   * absent: it is the one that is supposed to be here.
   */
  const COMPETING_CONNECTIVITY_PACKAGES = [
    'expo-network',
    'react-native-offline',
    'react-native-network-info',
    '@react-native-community/net-info', // netinfo's pre-rename name — installing both is the same bug
  ];

  const manifest = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')
  ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);

  it('declares @react-native-community/netinfo — the source of truth lib/connectivity.ts imports', () => {
    expect(declared.has('@react-native-community/netinfo')).toBe(true);
  });

  it('declares no competing connectivity library alongside it', () => {
    const competitors = COMPETING_CONNECTIVITY_PACKAGES.filter((name) => declared.has(name));

    // Named in the matcher rather than asserted as a bare `toHaveLength(0)` so the failure output
    // says *which* package was added, and this block's header says why that is a problem.
    expect(competitors).toEqual([]);
  });
});
