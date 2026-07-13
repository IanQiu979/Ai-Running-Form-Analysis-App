/**
 * Connectivity detection (issue #93) — the missing half of a fully-specified state:
 * `docs/design/copy-deck.md`'s "Cross-cutting — Offline" section already has the strings
 * (`offline.banner`, `offline.blocked.*`), but nothing in the repo ever asked the device whether
 * it's actually online. Without this, a user in a dead zone taps Analyze, watches a spinner, and
 * gets nothing — the single most common real-world failure for a phone app used outdoors, at a
 * track, which is exactly this product's context.
 *
 * Two shapes, for two different jobs:
 *  - `useIsOffline()` — a LIVE hook for `components/offline-banner.tsx` (mounted globally in
 *    `app/_layout.tsx`). It has to keep updating for as long as the app is open.
 *  - `checkConnectivity()` — a ONE-SHOT async check for a pre-flight gate: call it immediately
 *    before a network-dependent action (the `analyze-form` submit, a future direct upload) so the
 *    user is told *before* they wait, not after a call silently fails. See the `HANDOFF` note in
 *    this issue's report for the exact call sites (`app/analyzing.tsx`, `app/capture/index.tsx`)
 *    — both are owned by other in-flight work, so this module only exports the guard, it does not
 *    wire itself in anywhere.
 *
 * `isConnectivityUsable` is the one pure classifier both shapes share, split out so it's testable
 * without mocking React or the native module (same split `lib/permission-state.ts`'s
 * `classifyPermission` uses for the same reason).
 *
 * Fails closed, matching `lib/consent.ts`'s convention (its header: "Everything here FAILS
 * CLOSED"): an indeterminate reachability reading (`isInternetReachable: null` — NetInfo's own
 * "still figuring it out" state) is treated as ONLINE, not offline — the false-positive here
 * (banner never wrongly claims a working connection is dead) is far cheaper than the false-
 * negative (a live connection that never gets a chance to work). But `isConnected: false` (no
 * network interface at all) or `isInternetReachable: false` (interface up, internet confirmed
 * unreachable) are both definitive, and are always treated as offline.
 */
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

/**
 * Pure classifier: does this NetInfo reading describe a connection actually usable for a network
 * call? `isConnected` must be definitively `true` — NetInfo's own "unknown" state reports it as
 * `null`, which this treats the same as `false` (there is no interface to try over). Once
 * connected, `isInternetReachable` blocks ONLY on a definitive `false`; `null` (still probing) or
 * `true` both count as usable — see the header comment for why that direction is the safe one.
 */
export function isConnectivityUsable(state: NetInfoState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

/**
 * Live-updating "is the device offline right now" read, for `components/offline-banner.tsx`.
 *
 * Returns `false` (not offline) until NetInfo's first reading arrives, rather than defaulting to
 * `true` — an app that briefly flashes an incorrect offline banner on every cold start would
 * itself violate the "never claim a state that isn't true" rule this issue exists to uphold.
 * `NetInfo.addEventListener` calls its listener once immediately with the current state and again
 * on every subsequent change (library contract — see its own doc comment), so that first real
 * reading normally arrives within a frame or two; the subscription is removed on unmount, the same
 * shape `hooks/use-reduced-motion.ts` already uses for a live OS-setting read.
 */
export function useIsOffline(): boolean {
  const [state, setState] = useState<NetInfoState | null>(null);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(setState);
    return unsubscribe;
  }, []);

  if (state === null) return false;
  return !isConnectivityUsable(state);
}

/**
 * One-shot pre-flight gate: resolves `true` if a network-dependent action should proceed, `false`
 * if it should show the `offline.blocked.*` panel instead of attempting the call. Does not throw
 * — `NetInfo.fetch()` resolving is itself just a read of the OS's current connectivity state, not
 * a network request, so there is no failure mode here distinct from "offline" itself.
 *
 * Call this immediately before the network call it's guarding, not once on screen mount: the
 * whole point is to catch connectivity that changed *since* the screen loaded (walking out of
 * signal range while reading a permission screen, for example).
 */
export async function checkConnectivity(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return isConnectivityUsable(state);
}
