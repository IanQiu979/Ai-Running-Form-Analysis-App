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

import {
  setPendingAnalyzeFormRequest,
  takePendingAnalyzeFormRequest,
  type AnalyzeFormRequest,
} from '../analyze-form';
import {
  currentResumeGeneration,
  discardResumableAnalysis,
  hasResumableAnalysis,
  holdForResume,
  takeResumableAnalysis,
} from '../resumable-analysis';
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
const mockForegroundListeners = new Set<() => void>();
jest.mock('../app-state', () => ({
  startAppStateSync: () => () => {},
  onAppForeground: (listener: () => void) => {
    mockForegroundListeners.add(listener);
    return () => mockForegroundListeners.delete(listener);
  },
}));
jest.mock('../auth', () => ({ createSessionFromUrl: jest.fn(async () => null) }));
jest.mock('../secure-storage', () => ({ onSessionRestoreFailure: () => () => {} }));
jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn(async () => null),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const mockGetSession = supabase.auth.getSession as jest.Mock;
const mockOnAuthStateChange = supabase.auth.onAuthStateChange as jest.Mock;
const mockClearSettingsSnapshot = jest.fn();

jest.mock('../settings-cache', () => ({
  clearSettingsSnapshot: (...args: unknown[]) => mockClearSettingsSnapshot(...args),
}), { virtual: true });

const mockPurgePrivateFrameImageCaches = jest.fn(async () => true);
jest.mock('../private-frame-image', () => ({
  purgePrivateFrameImageCaches: () => mockPurgePrivateFrameImageCaches(),
}));

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
  mockClearSettingsSnapshot.mockReset();
  mockPurgePrivateFrameImageCaches.mockReset().mockResolvedValue(true);
  mockForegroundListeners.clear();
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

  it('clears the signed-out user\'s settings snapshot', async () => {
    await renderHook(() => useSession(), { wrapper });
    await act(async () => {
      emit('SIGNED_IN', fakeSession('outgoing-user'));
    });
    mockClearSettingsSnapshot.mockClear();

    await act(async () => {
      emit('SIGNED_OUT', null);
    });

    expect(mockClearSettingsSnapshot).toHaveBeenCalledWith('outgoing-user');
  });

  it('clears the outgoing settings snapshot when an auth event switches users directly', async () => {
    const { result } = await renderHook(() => useSession(), { wrapper });
    await act(async () => {
      emit('SIGNED_IN', fakeSession('user-a'));
    });
    mockClearSettingsSnapshot.mockClear();

    await act(async () => {
      emit('SIGNED_IN', fakeSession('user-b'));
    });

    expect(result.current.session?.user.id).toBe('user-b');
    expect(mockClearSettingsSnapshot).toHaveBeenCalledWith('user-a');
  });

  it('keeps the settings snapshot for an auth event from the same user', async () => {
    await renderHook(() => useSession(), { wrapper });
    await act(async () => {
      emit('SIGNED_IN', fakeSession('same-user'));
    });
    mockClearSettingsSnapshot.mockClear();

    await act(async () => {
      emit('TOKEN_REFRESHED', fakeSession('same-user'));
    });

    expect(mockClearSettingsSnapshot).not.toHaveBeenCalled();
  });

  // `lib/private-frame-image.ts` rule 3: stored body frames never survive in an image cache past
  // the session that could see them, and a launch clears what an earlier build left behind.
  describe('private frame image caches', () => {
    it('purges once at launch', async () => {
      await renderHook(() => useSession(), { wrapper });
      expect(mockPurgePrivateFrameImageCaches).toHaveBeenCalledTimes(1);
    });

    it('purges on SIGNED_OUT', async () => {
      await renderHook(() => useSession(), { wrapper });
      await act(async () => {
        emit('SIGNED_IN', fakeSession('outgoing-user'));
      });
      mockPurgePrivateFrameImageCaches.mockClear();

      await act(async () => {
        emit('SIGNED_OUT', null);
      });

      expect(mockPurgePrivateFrameImageCaches).toHaveBeenCalledTimes(1);
    });

    it('purges when an auth event switches users directly', async () => {
      await renderHook(() => useSession(), { wrapper });
      await act(async () => {
        emit('SIGNED_IN', fakeSession('user-a'));
      });
      mockPurgePrivateFrameImageCaches.mockClear();

      await act(async () => {
        emit('SIGNED_IN', fakeSession('user-b'));
      });

      expect(mockPurgePrivateFrameImageCaches).toHaveBeenCalledTimes(1);
    });

    // expo-image on Android resolves `false` (did nothing) while no Activity is attached.
    it('retries once on the next foreground when a clear did nothing', async () => {
      mockPurgePrivateFrameImageCaches.mockResolvedValueOnce(false);
      await renderHook(() => useSession(), { wrapper });
      expect(mockPurgePrivateFrameImageCaches).toHaveBeenCalledTimes(1);
      expect(mockForegroundListeners.size).toBe(1);

      await act(async () => {
        for (const listener of [...mockForegroundListeners]) listener();
      });
      expect(mockPurgePrivateFrameImageCaches).toHaveBeenCalledTimes(2);
      expect(mockForegroundListeners.size).toBe(0);
    });

    it('does not wait on a foreground when the purge succeeded', async () => {
      await renderHook(() => useSession(), { wrapper });
      await act(async () => {});
      expect(mockForegroundListeners.size).toBe(0);
    });

    it('does not purge on a sign-in or a token refresh for the same user', async () => {
      await renderHook(() => useSession(), { wrapper });
      mockPurgePrivateFrameImageCaches.mockClear();

      await act(async () => {
        emit('SIGNED_IN', fakeSession('same-user'));
      });
      await act(async () => {
        emit('TOKEN_REFRESHED', fakeSession('same-user'));
      });

      expect(mockPurgePrivateFrameImageCaches).not.toHaveBeenCalled();
    });
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

// Frames that never left the device (2026-10-06): the staged `analyze-form` request
// (`lib/analyze-form.ts`'s mailbox) and the session-expired resume hold
// (`lib/resumable-analysis.ts`). Both are exercised through their REAL modules, so these assert
// what a later take actually gets, not that a function was called.
describe('SessionProvider and frames that never left the device', () => {
  function makeRequest(): AnalyzeFormRequest {
    return { mediaType: 'video', frames: ['QUFBQQ=='], timestamps: [0], idempotencyKey: 'idem-key-1' };
  }

  function holdFor(request: AnalyzeFormRequest, userId: string) {
    holdForResume(request, userId, currentResumeGeneration());
  }

  beforeEach(() => {
    discardResumableAnalysis();
    takePendingAnalyzeFormRequest(null);
  });

  afterAll(() => {
    discardResumableAnalysis();
    takePendingAnalyzeFormRequest(null);
  });

  it("drops the outgoing user's staged request and resume hold when another user's session appears", async () => {
    await renderHook(() => useSession(), { wrapper });
    await act(async () => {
      emit('SIGNED_IN', fakeSession('user-a'));
    });
    setPendingAnalyzeFormRequest(makeRequest(), 'user-a');
    holdFor(makeRequest(), 'user-a');

    await act(async () => {
      emit('SIGNED_IN', fakeSession('user-b'));
    });

    expect(hasResumableAnalysis()).toBe(false);
    // Taken as the OWNER, so a null here proves the provider cleared it, not the owner binding.
    expect(takePendingAnalyzeFormRequest('user-a')).toBeNull();
    expect(takeResumableAnalysis('user-a')).toBeNull();
  });

  // The expired-session flow: the hold is made, the dead session is signed out, and the runner
  // signs back in. A SIGNED_OUT alone must not drop the hold it is waiting through.
  it('keeps the resume hold through a SIGNED_OUT and hands the same request back on the same user\'s sign-in', async () => {
    await renderHook(() => useSession(), { wrapper });
    await act(async () => {
      emit('SIGNED_IN', fakeSession('user-a'));
    });
    const request = makeRequest();
    holdFor(request, 'user-a');

    await act(async () => {
      emit('SIGNED_OUT', null);
    });
    expect(hasResumableAnalysis()).toBe(true);

    await act(async () => {
      emit('SIGNED_IN', fakeSession('user-a'));
    });
    expect(takeResumableAnalysis('user-a')).toBe(request);
  });

  it('clears the staged request on a SIGNED_OUT from a signed-in user', async () => {
    await renderHook(() => useSession(), { wrapper });
    await act(async () => {
      emit('SIGNED_IN', fakeSession('user-a'));
    });
    setPendingAnalyzeFormRequest(makeRequest(), 'user-a');

    await act(async () => {
      emit('SIGNED_OUT', null);
    });

    expect(takePendingAnalyzeFormRequest('user-a')).toBeNull();
  });

  it('drops a resume hold when a DIFFERENT user signs in after the sign-out', async () => {
    await renderHook(() => useSession(), { wrapper });
    await act(async () => {
      emit('SIGNED_IN', fakeSession('user-a'));
    });
    holdFor(makeRequest(), 'user-a');
    await act(async () => {
      emit('SIGNED_OUT', null);
    });

    await act(async () => {
      emit('SIGNED_IN', fakeSession('user-b'));
    });

    expect(hasResumableAnalysis()).toBe(false);
    expect(takeResumableAnalysis('user-a')).toBeNull();
  });

  it('leaves both untouched on a token refresh for the same user', async () => {
    await renderHook(() => useSession(), { wrapper });
    await act(async () => {
      emit('SIGNED_IN', fakeSession('user-a'));
    });
    const staged = makeRequest();
    const held = makeRequest();
    setPendingAnalyzeFormRequest(staged, 'user-a');
    holdFor(held, 'user-a');

    await act(async () => {
      emit('TOKEN_REFRESHED', fakeSession('user-a'));
    });

    expect(takePendingAnalyzeFormRequest('user-a')).toBe(staged);
    expect(takeResumableAnalysis('user-a')).toBe(held);
  });
});
