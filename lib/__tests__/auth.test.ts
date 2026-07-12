/**
 * Regression locks for `createSessionFromUrl` (lib/auth.ts), issue #5.
 *
 * The bug: a failed OAuth code exchange became a silent no-op. Root cause was two-fold —
 * (1) `lib/session-provider.tsx`'s Linking listener discarded every exchange failure with a bare
 * `.catch(() => {})`, and (2) the dedupe guard against the Android double-delivery race (the same
 * redirect reaching `createSessionFromUrl` more than once concurrently) marked a code "processed"
 * *before* the exchange resolved and never unmarked it on failure — so the race's loser silently
 * got `null` back even when the winner's exchange had actually thrown.
 *
 * This file locks (1) that a URL carrying a provider error throws `OAuthRedirectError` rather
 * than a plain `Error` (so `mapAuthError` can tell "user declined" apart from "exchange broke"),
 * (2) that an unrelated deep link still safely no-ops, and (3) the actual fix for the race:
 * concurrent callers racing the same code share one in-flight exchange and get the SAME outcome
 * — including the same rejection — rather than one succeeding/no-oping while the other's failure
 * vanishes.
 */
jest.mock('../supabase', () => ({
  supabase: { auth: { exchangeCodeForSession: jest.fn() } },
}));

// lib/auth.ts calls makeRedirectUri at module scope to build `oauthRedirectTo` (unused by the
// function under test here) — under Jest there's no real app.json/expo-constants manifest for it
// to resolve a URI scheme from, so it throws before the module even finishes loading. Stubbed
// out; QueryParams (imported from a different subpath) is untouched by this mock.
jest.mock('expo-auth-session', () => ({
  makeRedirectUri: jest.fn(() => 'paceanalysisai://oauth-callback'),
}));

import type { Session } from '@supabase/supabase-js';

import { OAuthRedirectError } from '../auth-errors';
import { createSessionFromUrl } from '../auth';
import { supabase } from '../supabase';

const mockExchange = supabase.auth.exchangeCodeForSession as jest.MockedFunction<
  typeof supabase.auth.exchangeCodeForSession
>;

const REDIRECT_BASE = 'paceanalysisai://oauth-callback';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createSessionFromUrl', () => {
  // Case: no `code` and no `error` param at all — session-provider.tsx feeds EVERY deep link
  // through this function, so an unrelated link (not part of any auth redirect) must resolve to
  // null, not throw, or every non-auth deep link would incorrectly surface an auth error banner.
  it('returns null for a URL that is not part of an auth redirect', async () => {
    await expect(createSessionFromUrl(`${REDIRECT_BASE}?somethingElse=1`)).resolves.toBeNull();
    expect(mockExchange).not.toHaveBeenCalled();
  });

  // Case: the provider itself reported an outcome in the redirect (e.g. the user hit "Cancel" on
  // Google's own consent screen) before the flow ever reached a token exchange. Must throw a
  // typed OAuthRedirectError carrying the provider's raw code, not a plain Error with the message
  // baked in as a string mapAuthError would have to pattern-match.
  it('throws OAuthRedirectError, not a plain Error, for a provider-reported redirect error', async () => {
    const url = `${REDIRECT_BASE}?error=access_denied&error_description=The+user+denied+the+request`;

    await expect(createSessionFromUrl(url)).rejects.toBeInstanceOf(OAuthRedirectError);
    await expect(createSessionFromUrl(url)).rejects.toMatchObject({ code: 'access_denied' });
    expect(mockExchange).not.toHaveBeenCalled();
  });

  // Case: a normal successful exchange — the baseline the race-condition tests below build on.
  it('resolves with the session on a successful exchange', async () => {
    const session = { access_token: 'abc' } as Session;
    mockExchange.mockResolvedValue({ data: { session, user: session as never, redirectType: null }, error: null } as never);

    await expect(createSessionFromUrl(`${REDIRECT_BASE}?code=abc123`)).resolves.toBe(session);
    expect(mockExchange).toHaveBeenCalledTimes(1);
    expect(mockExchange).toHaveBeenCalledWith('abc123');
  });

  // Case: the exchange itself fails (bad/expired code, PKCE mismatch, network — whatever
  // supabase-js returns as `{ error }`). Must reject with that real error, not resolve null.
  it('rejects with the real error when the exchange fails', async () => {
    const error = new Error('invalid flow state, no valid flow state found');
    mockExchange.mockResolvedValue({ data: { session: null, user: null, redirectType: null }, error } as never);

    await expect(createSessionFromUrl(`${REDIRECT_BASE}?code=deadcode`)).rejects.toBe(error);
  });

  // THE race-condition lock. Two callers hit the same code concurrently (Android's
  // double-delivery: expo-web-browser's own Linking listener races SessionProvider's). Before
  // the fix, the loser was marked "processed" ahead of the exchange settling and got `null`
  // back — even when the winner's exchange failed — because the old dedupe Set had no way to
  // propagate a failure to a caller that arrived while it was already in flight. The fix caches
  // the in-flight PROMISE, so both callers get the exact same outcome.
  it('shares one exchange call across concurrent callers racing the same code, and calls exchangeCodeForSession only once', async () => {
    const session = { access_token: 'xyz' } as Session;
    let resolveExchange!: (value: { data: { session: Session; user: unknown; redirectType: null }; error: null }) => void;
    mockExchange.mockReturnValue(
      new Promise((resolve) => {
        resolveExchange = resolve as never;
      }) as never
    );

    const url = `${REDIRECT_BASE}?code=raced-code`;
    const first = createSessionFromUrl(url);
    const second = createSessionFromUrl(url);

    resolveExchange({ data: { session, user: session as never, redirectType: null }, error: null });

    await expect(first).resolves.toBe(session);
    await expect(second).resolves.toBe(session);
    // The whole point of the fix: only one real network exchange for both racing callers.
    expect(mockExchange).toHaveBeenCalledTimes(1);
  });

  // The failure-mode mirror of the test above, and the exact bug this issue reports: previously
  // the race's loser got `null` (silently treated as "cancelled" by app/(auth)/sign-in.tsx) even
  // though the winner's exchange had thrown a real error. Now BOTH callers must see the SAME
  // rejection — neither one is allowed to silently no-op.
  it('propagates the same rejection to every concurrent caller racing the same code', async () => {
    const error = new Error('invalid flow state, no valid flow state found');
    let rejectExchange!: (reason: unknown) => void;
    mockExchange.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectExchange = reject;
      }) as never
    );

    const url = `${REDIRECT_BASE}?code=raced-failing-code`;
    const first = createSessionFromUrl(url);
    const second = createSessionFromUrl(url);

    rejectExchange(error);

    await expect(first).rejects.toBe(error);
    await expect(second).rejects.toBe(error);
    expect(mockExchange).toHaveBeenCalledTimes(1);
  });

  // Once an exchange settles (success OR failure) and a later, unrelated call comes in with a
  // fresh code, it must trigger its own new exchange rather than reusing a stale cached
  // promise — this is what keeps the in-flight cache from either growing unbounded or wedging a
  // later legitimate attempt behind an old outcome.
  it('starts a fresh exchange for a different code after a previous one has settled', async () => {
    const sessionA = { access_token: 'a' } as Session;
    const sessionB = { access_token: 'b' } as Session;
    mockExchange
      .mockResolvedValueOnce({ data: { session: sessionA, user: sessionA as never, redirectType: null }, error: null } as never)
      .mockResolvedValueOnce({ data: { session: sessionB, user: sessionB as never, redirectType: null }, error: null } as never);

    await expect(createSessionFromUrl(`${REDIRECT_BASE}?code=first-code`)).resolves.toBe(sessionA);
    await expect(createSessionFromUrl(`${REDIRECT_BASE}?code=second-code`)).resolves.toBe(sessionB);
    expect(mockExchange).toHaveBeenCalledTimes(2);
  });
});
