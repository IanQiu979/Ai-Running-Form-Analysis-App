/**
 * Regression locks for `lib/sign-out.ts` (issue #27; corrected 2026-07-13 per a security audit on
 * PR #122, finding F3).
 *
 * THE LOAD-BEARING CASES: issue #27 exists because `supabase.auth.signOut()` was called
 * fire-and-forget: the returned `{ error }` was discarded, so a failed GLOBAL token revoke left
 * server-side refresh tokens alive while the user was shown a clean sign-out. That is a silent
 * failure, and silent failures stay green in every happy-path test — the plain-success case alone
 * would pass just as well against the original bug.
 *
 * Finding F3 found a SECOND silent-failure class in the first version of this fix: it assumed a
 * failed `signOut()` call always means the local session was cleared, which is false — verified
 * against the installed `@supabase/auth-js` source (see `lib/sign-out.ts`'s header). The
 * `'stillSignedIn'` cases below are the load-bearing ones for THAT fix: delete them and `signOut`
 * can regress to reporting `'globalRevokeFailed'` (a false "you're safe here, at least") for a
 * failure that actually left the user fully signed in everywhere, with every other test in this
 * file still green.
 */
import { signOut } from '../sign-out';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: { auth: { signOut: jest.fn(), getSession: jest.fn() } },
}));

const mockSignOut = supabase.auth.signOut as jest.MockedFunction<typeof supabase.auth.signOut>;
const mockGetSession = supabase.auth.getSession as jest.MockedFunction<typeof supabase.auth.getSession>;

beforeEach(() => {
  mockSignOut.mockReset();
  mockGetSession.mockReset();
});

describe('signOut', () => {
  it('reports ok when the global revoke succeeds, without needing to check getSession at all', async () => {
    mockSignOut.mockResolvedValue({ error: null });

    await expect(signOut()).resolves.toEqual({ ok: true });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  // Issue #27's original bug, still guarded: a returned error must never be silently discarded.
  // This is the common real-world case — signOut() reached the server, which said no, and auth-js
  // still cleared the local session per its normal path — so getSession() reports no session.
  it('reports globalRevokeFailed when signOut() errors AND the local session is confirmed gone', async () => {
    mockSignOut.mockResolvedValue({ error: { message: 'network down' } as never });
    mockGetSession.mockResolvedValue({ data: { session: null } } as never);

    await expect(signOut()).resolves.toEqual({ ok: false, reason: 'globalRevokeFailed' });
  });

  // THE F3 CASE — the one the original two-state fix could not represent at all. Verified against
  // @supabase/auth-js: an expired access token whose refresh also fails takes an early return in
  // `_signOut` that returns an error WITHOUT ever clearing the local session. Reported here as
  // "signed out here" would be a lie on a shared/stolen device — the exact scenario #27 exists for.
  it('reports stillSignedIn when signOut() errors but the local session is confirmed to SURVIVE', async () => {
    mockSignOut.mockResolvedValue({ error: { message: 'refresh failed' } as never });
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'still-here' } } } as never);

    await expect(signOut()).resolves.toEqual({ ok: false, reason: 'stillSignedIn' });
  });

  // The other half of #27: no `.catch` meant a thrown failure became an unhandled rejection. A
  // throw is disambiguated the same way a returned error is — it does not by itself imply the
  // local session is gone.
  it('folds a THROWN signOut() failure into globalRevokeFailed when the session really is gone, and never rejects', async () => {
    mockSignOut.mockRejectedValue(new Error('offline'));
    mockGetSession.mockResolvedValue({ data: { session: null } } as never);

    await expect(signOut()).resolves.toEqual({ ok: false, reason: 'globalRevokeFailed' });
  });

  it('folds a THROWN signOut() failure into stillSignedIn when the session survives', async () => {
    mockSignOut.mockRejectedValue(new Error('offline'));
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'still-here' } } } as never);

    await expect(signOut()).resolves.toEqual({ ok: false, reason: 'stillSignedIn' });
  });

  // FAIL-CLOSED, same direction as lib/consent.ts's hasConsented: if we cannot even confirm
  // whether the local session survived, we must not report the reassuring answer.
  it('fails closed to stillSignedIn when getSession() itself throws — never assumes the safer answer', async () => {
    mockSignOut.mockResolvedValue({ error: { message: 'network down' } as never });
    mockGetSession.mockRejectedValue(new Error('storage read failed'));

    await expect(signOut()).resolves.toEqual({ ok: false, reason: 'stillSignedIn' });
  });

  it('awaits the call rather than firing it and forgetting it', async () => {
    let settled = false;
    mockSignOut.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      settled = true;
      return { error: null };
    });

    const result = await signOut();

    // If signOut() returned before the underlying call settled (the original fire-and-forget bug),
    // this would still be false at the point the promise resolved.
    expect(settled).toBe(true);
    expect(result).toEqual({ ok: true });
  });
});
