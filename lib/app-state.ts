/**
 * The app's ONE `AppState` listener (issue #10), plus a pub/sub seam (issue #64) so every other
 * module that needs to react to "we just returned to the foreground" can subscribe instead of
 * registering a second native listener of its own.
 *
 * Issue #10 — Supabase's own React Native guide is explicit that `autoRefreshToken: true`
 * (`lib/supabase.ts`) is not sufficient on mobile by itself: the refresh ticker does not run
 * while JS is suspended, so a backgrounded app can foreground with an expired access token and no
 * refresh in flight. The documented fix is exactly the `AppState` listener wired up below,
 * started once from `lib/session-provider.tsx`.
 *
 * Issue #64 needs to know about that same transition (to reconcile the Analyzing screen's
 * in-flight analysis against its DB row on foreground — `app/analyzing.tsx`). Its issue text is
 * explicit: "Build it on the same AppState listener as #10... One listener in SessionProvider, two
 * subscribers. Do NOT add a second AppState handler." `onAppForeground` below is that second
 * subscriber's seam — it does not touch `AppState` itself.
 */
import { AppState, type AppStateStatus } from 'react-native';

import { supabase } from './supabase';

type ForegroundListener = () => void;

const foregroundListeners = new Set<ForegroundListener>();

/**
 * Subscribe to "the app just returned to active from background/inactive." Fired AFTER
 * `supabase.auth.startAutoRefresh()` has already been called for this same transition (see the
 * listener body below), so a subscriber that immediately makes an authenticated request never
 * races a token that is expired-but-not-yet-refreshing. Returns an unsubscribe function.
 */
export function onAppForeground(listener: ForegroundListener): () => void {
  foregroundListeners.add(listener);
  return () => {
    foregroundListeners.delete(listener);
  };
}

// Guards against ever registering a second native `AppState.addEventListener` call, which is
// exactly the bug issue #64's text warns against reintroducing. `lib/session-provider.tsx` is the
// only intended caller, and only ever mounts once at the app root, so this should never trip in
// practice — but a silent second no-op registration is a much safer failure mode than a silent
// second real listener double-firing every subsequent test in this file.
let started = false;

/**
 * Wires up the single `AppState` listener. Call once, from `SessionProvider`'s top-level effect.
 * Returns a cleanup function that removes the listener (and re-arms the `started` guard so a
 * legitimate remount — e.g. Fast Refresh, or a future test — is not permanently locked out).
 *
 * On any transition INTO 'active' from a non-active state: re-arms Supabase's refresh ticker,
 * then notifies every `onAppForeground` subscriber. On any transition OUT of 'active': stops the
 * ticker so it does not keep firing while suspended. Transitions between two non-active states
 * (e.g. 'inactive' -> 'background', both real on iOS) are deliberately no-ops on both counts —
 * only whether 'active' was just entered or left matters.
 */
export function startAppStateSync(): () => void {
  if (started) {
    return () => {};
  }
  started = true;

  let previousState: AppStateStatus = AppState.currentState;

  const subscription = AppState.addEventListener('change', (nextState) => {
    const wasActive = previousState === 'active';
    const isActive = nextState === 'active';

    if (isActive && !wasActive) {
      supabase.auth.startAutoRefresh();
      for (const listener of foregroundListeners) {
        listener();
      }
    } else if (!isActive && wasActive) {
      supabase.auth.stopAutoRefresh();
    }

    previousState = nextState;
  });

  return () => {
    subscription.remove();
    started = false;
  };
}
