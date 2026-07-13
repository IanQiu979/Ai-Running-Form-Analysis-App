/**
 * `lib/app-state.ts` (issues #10, #64) — the app's one `AppState` listener, plus its foreground
 * pub/sub seam.
 *
 * The load-bearing cases:
 *  1. autoRefresh is armed/disarmed exactly on the active<->non-active boundary, never on a
 *     non-active-to-non-active transition (e.g. 'inactive' -> 'background', both real transient
 *     iOS states) — see "does nothing on a transition between two non-active states".
 *  2. Foreground subscribers fire only on entering 'active', and only AFTER
 *     `startAutoRefresh()` has already been called for that same transition — a subscriber that
 *     immediately makes an authenticated request must never race a token that's
 *     expired-but-not-yet-refreshing. See "calls startAutoRefresh before notifying subscribers".
 *  3. Only ONE native `AppState.addEventListener` call is ever registered while a previous one is
 *     still active — issue #64's explicit "do NOT add a second AppState handler" instruction,
 *     regression-locked in "does not register a second native listener on an overlapping call".
 *
 * `startAppStateSync()`'s own `started` guard is module-level state, so every test that calls it
 * routes through `sync()` below, which registers the returned cleanup for `afterEach` to run
 * unconditionally — including when an assertion throws mid-test — so one test's registration can
 * never leak `started: true` into the next test.
 */
import { AppState } from 'react-native';

import { onAppForeground, startAppStateSync } from '../app-state';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: { auth: { startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn() } },
}));

const mockAddEventListener = AppState.addEventListener as jest.Mock;
const mockStartAutoRefresh = supabase.auth.startAutoRefresh as jest.MockedFunction<
  typeof supabase.auth.startAutoRefresh
>;
const mockStopAutoRefresh = supabase.auth.stopAutoRefresh as jest.MockedFunction<
  typeof supabase.auth.stopAutoRefresh
>;

type ChangeHandler = (state: string) => void;

/** Captures the handler passed to `AppState.addEventListener('change', handler)` so a test can
 * fire transitions directly, and exposes the `.remove()` spy handed back as the subscription. */
function captureChangeHandler() {
  let handler: ChangeHandler = () => {};
  const remove = jest.fn();
  mockAddEventListener.mockImplementation((event: string, cb: ChangeHandler) => {
    if (event === 'change') handler = cb;
    return { remove };
  });
  return { fire: (state: string) => handler(state), remove };
}

let cleanupFns: Array<() => void> = [];

/** Routes every `startAppStateSync()` call in this file through the shared cleanup list — see
 * the file header for why that matters for the `started` guard. */
function sync(): void {
  cleanupFns.push(startAppStateSync());
}

/** Same idea for `onAppForeground` subscriptions: keeps each test's listeners from leaking into
 * the next test's transitions. */
function subscribe(listener: () => void): void {
  cleanupFns.push(onAppForeground(listener));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAddEventListener.mockReturnValue({ remove: jest.fn() });
  (AppState as unknown as { currentState: string }).currentState = 'active';
});

afterEach(() => {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
});

describe('startAppStateSync', () => {
  it('registers exactly one native AppState "change" listener', () => {
    sync();

    expect(mockAddEventListener).toHaveBeenCalledTimes(1);
    expect(mockAddEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('does not register a second native listener on an overlapping call', () => {
    sync();
    sync();

    expect(mockAddEventListener).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh registration after the previous one was cleaned up', () => {
    sync();
    cleanupFns.pop()!(); // clean up the first registration out of band, before the second sync()
    sync();

    expect(mockAddEventListener).toHaveBeenCalledTimes(2);
  });

  it('calls startAutoRefresh on a transition into active from a background state', () => {
    const { fire } = captureChangeHandler();
    sync();

    fire('background');
    fire('active');

    expect(mockStartAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it('calls stopAutoRefresh on a transition out of active', () => {
    const { fire } = captureChangeHandler();
    sync();

    fire('background');

    expect(mockStopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(mockStartAutoRefresh).not.toHaveBeenCalled();
  });

  it('does nothing on a transition between two non-active states', () => {
    const { fire } = captureChangeHandler();
    sync();

    fire('inactive'); // active -> inactive: this one legitimately stops the ticker
    mockStopAutoRefresh.mockClear();
    fire('background'); // inactive -> background: neither side is 'active'

    expect(mockStartAutoRefresh).not.toHaveBeenCalled();
    expect(mockStopAutoRefresh).not.toHaveBeenCalled();
  });

  it('removes the native listener on cleanup', () => {
    const { remove } = captureChangeHandler();
    sync();
    cleanupFns.pop()!();

    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe('onAppForeground', () => {
  it('notifies a subscriber when the app enters active from background', () => {
    const { fire } = captureChangeHandler();
    sync();
    const listener = jest.fn();
    subscribe(listener);

    fire('background');
    fire('active');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify on a transition OUT of active', () => {
    const { fire } = captureChangeHandler();
    sync();
    const listener = jest.fn();
    subscribe(listener);

    fire('background');

    expect(listener).not.toHaveBeenCalled();
  });

  // Issue #64's own requirement (via lib/session-provider.tsx / app/analyzing.tsx): a subscriber
  // that reads live server state on foreground must not race an about-to-refresh token.
  it('calls startAutoRefresh before notifying subscribers for the same transition', () => {
    const { fire } = captureChangeHandler();
    sync();
    const callOrder: string[] = [];
    mockStartAutoRefresh.mockImplementation(() => {
      callOrder.push('startAutoRefresh');
      return Promise.resolve();
    });
    subscribe(() => callOrder.push('listener'));

    fire('background');
    fire('active');

    expect(callOrder).toEqual(['startAutoRefresh', 'listener']);
  });

  it('stops notifying once unsubscribed', () => {
    const { fire } = captureChangeHandler();
    sync();
    const listener = jest.fn();
    const unsubscribe = onAppForeground(listener);
    unsubscribe();

    fire('background');
    fire('active');

    expect(listener).not.toHaveBeenCalled();
  });

  it('supports multiple independent subscribers', () => {
    const { fire } = captureChangeHandler();
    sync();
    const listenerA = jest.fn();
    const listenerB = jest.fn();
    subscribe(listenerA);
    subscribe(listenerB);

    fire('background');
    fire('active');

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });
});
