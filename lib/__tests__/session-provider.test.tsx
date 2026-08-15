/**
 * `SessionProvider` (`lib/session-provider.tsx`) — specifically the ONE property the whole
 * signed-in experience hangs off: an `onAuthStateChange` event carrying a session must flip
 * `session` from null to that session, because `app/_layout.tsx` routes on exactly that value
 * (`<Stack.Protected guard={!!session}>`). If it doesn't flip, the user sits on the sign-in form
 * with a perfectly valid session in hand and no way into the app.
 *
 * WHY THIS FILE EXISTS (2026-08-15). That is not a hypothetical: it is how the sign-up bug
 * documented in `lib/signup-with-captcha.ts`'s header presented to the captain — "I signed up and
 * nothing happened." The root cause turned out to be upstream (the client read the 200 body's
 * session with the wrong field names, so `setSession` was handed `undefined` and threw before it
 * ever emitted anything), but the reason that failure was so hard to place is that NOTHING between
 * `setSession` and the navigator was covered by a test. This file covers the last link, so a
 * future "signed in but stuck on the form" report can be attributed instead of guessed at.
 *
 * `SIGNED_IN` here stands for every event that carries a session — the provider deliberately does
 * not branch on the event name for routing purposes (it calls `setSession(newSession)` for all of
 * them), which is exactly what makes a `setSession()`-triggered sign-up land in the app the same
 * way a `signInWithPassword` one does. The `PASSWORD_RECOVERY` case below is the one event that
 * legitimately means something different, and issue #81's flag is asserted alongside it so a
 * refactor cannot quietly collapse the two.
 */
import type { Session } from '@supabase/supabase-js';
import { act, renderHook } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { SessionProvider, useSession } from '../session-provider';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
    },
  },
}));

// The provider's other side-effects are not what this file is about; each is covered by its own
// suite (`app-state.test.ts`, `auth.test.ts`, `secure-storage.test.ts`). Stubbed to inert so the
// auth-state plumbing under test is the only thing that can move.
jest.mock('../app-state', () => ({ startAppStateSync: () => () => {} }));
jest.mock('../auth', () => ({ createSessionFromUrl: jest.fn(async () => null) }));
jest.mock('../secure-storage', () => ({ onSessionRestoreFailure: () => () => {} }));
jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn(async () => null),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const mockGetSession = supabase.auth.getSession as jest.Mock;
const mockOnAuthStateChange = supabase.auth.onAuthStateChange as jest.Mock;

/** Minimal stand-in for a real `Session` — this suite only ever reads identity off it. */
function fakeSession(userId = 'user-1'): Session {
  return { access_token: 'a', refresh_token: 'r', user: { id: userId } } as unknown as Session;
}

/** Captures the listener the provider registers, so a test can fire an auth event at it the way
 *  supabase-js would after `setSession` / `signInWithPassword` / a recovery link. */
let emit: (event: string, session: Session | null) => void;

function wrapper({ children }: PropsWithChildren) {
  return <SessionProvider>{children}</SessionProvider>;
}

beforeEach(() => {
  mockGetSession.mockResolvedValue({ data: { session: null } });
  mockOnAuthStateChange.mockImplementation((listener: typeof emit) => {
    emit = listener;
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });
});

afterEach(() => {
  mockGetSession.mockReset();
  mockOnAuthStateChange.mockReset();
});

describe('SessionProvider auth-state routing', () => {
  it('starts signed out once the initial getSession resolves with no session', async () => {
    const { result } = await renderHook(() => useSession(), { wrapper });

    expect(result.current.session).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  // THE LOAD-BEARING ONE. `!!session` is app/_layout.tsx's routing guard; this asserts it goes
  // true off an event the provider did not initiate itself — which is precisely the shape of a
  // sign-up completing through `applySignupSession` -> `supabase.auth.setSession`.
  it('flips session on a SIGNED_IN event, which is what routes the user into the app', async () => {
    const { result } = await renderHook(() => useSession(), { wrapper });
    expect(result.current.session).toBeNull();

    const session = fakeSession();
    await act(async () => {
      emit('SIGNED_IN', session);
    });

    expect(result.current.session).toBe(session);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isPasswordRecovery).toBe(false);
  });

  it('clears session on SIGNED_OUT', async () => {
    const { result } = await renderHook(() => useSession(), { wrapper });
    await act(async () => {
      emit('SIGNED_IN', fakeSession());
    });

    await act(async () => {
      emit('SIGNED_OUT', null);
    });

    expect(result.current.session).toBeNull();
  });

  // Issue #81: a recovery session IS a session, so `!!session` alone would throw the user into
  // (tabs) before they have set a new password — and `Stack.Protected` OMITS the (auth) group
  // rather than hiding it, so the reset screen would be unreachable at the moment it is needed.
  it('marks a PASSWORD_RECOVERY session as recovery so the guard can hold the user in (auth)', async () => {
    const { result } = await renderHook(() => useSession(), { wrapper });

    await act(async () => {
      emit('PASSWORD_RECOVERY', fakeSession());
    });

    expect(result.current.session).not.toBeNull();
    expect(result.current.isPasswordRecovery).toBe(true);

    await act(async () => {
      result.current.clearPasswordRecovery();
    });
    expect(result.current.isPasswordRecovery).toBe(false);
  });

  it('does not hold the splash forever when the initial getSession read rejects', async () => {
    mockGetSession.mockRejectedValue(new Error('AsyncStorage read failed'));

    const { result } = await renderHook(() => useSession(), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.session).toBeNull();
  });
});
