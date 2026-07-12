/**
 * Regression locks for `lib/sign-out.ts` (issue #27).
 *
 * THE LOAD-BEARING CASES ARE 2 AND 3. Issue #27 exists because `supabase.auth.signOut()` was called
 * fire-and-forget: the returned `{ error }` was discarded, so a failed GLOBAL token revoke left
 * server-side refresh tokens alive while the user was shown a clean sign-out. That is a silent
 * failure, and silent failures stay green in every happy-path test — case 1 alone would pass just
 * as well against the original bug.
 *
 * So the two cases that actually protect the fix are:
 *   - case 2: a returned `{ error }` must surface as `ok: false`, never be swallowed;
 *   - case 3: a THROWN failure must also surface as `ok: false` — and must not reject, which was
 *     the second half of the bug (an unhandled promise rejection).
 *
 * Delete either and `signOut` can regress to `return { ok: true }` unconditionally with the rest of
 * this file still passing.
 */
import { signOut } from '../sign-out';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: { auth: { signOut: jest.fn() } },
}));

const mockSignOut = supabase.auth.signOut as jest.MockedFunction<typeof supabase.auth.signOut>;

beforeEach(() => {
  mockSignOut.mockReset();
});

describe('signOut', () => {
  it('reports ok when the global revoke succeeds', async () => {
    mockSignOut.mockResolvedValue({ error: null });

    await expect(signOut()).resolves.toEqual({ ok: true });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  // Issue #27's actual bug. Before the fix, this error was discarded and the user was told nothing.
  it('reports NOT ok when the server returns an error — a failed global revoke is never silent', async () => {
    mockSignOut.mockResolvedValue({ error: { message: 'network down' } as never });

    await expect(signOut()).resolves.toEqual({ ok: false, reason: 'globalRevokeFailed' });
  });

  // The other half of #27: no `.catch` meant a thrown failure became an unhandled rejection.
  it('folds a THROWN failure into the same not-ok result, and never rejects', async () => {
    mockSignOut.mockRejectedValue(new Error('offline'));

    await expect(signOut()).resolves.toEqual({ ok: false, reason: 'globalRevokeFailed' });
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
