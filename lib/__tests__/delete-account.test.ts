/**
 * `lib/delete-account.ts` (issue #53) — the `delete-account` client seam and its dev mock.
 *
 * What this suite can and cannot prove: the seam is a CONTRACT, not an implementation. These tests
 * lock the shape `app/settings.tsx` branches on and every outcome the screen has to render — they
 * do NOT prove anything about the actual purge, which is #58's edge function and #59's job to
 * prove leaves zero orphaned storage objects. That test is what the privacy policy's publication
 * actually rests on; this one only guarantees the client can't misread the answer.
 *
 * `delayMs: 0` throughout — the mock's default delay exists so a human reviewer can see the
 * screen's pending state, and has no business slowing a unit test down.
 */
import {
  createMockDeleteAccountClient,
  deleteAccountClient,
  type DeleteAccountClient,
} from '../delete-account';

describe('createMockDeleteAccountClient', () => {
  it('defaults to the deleted outcome', async () => {
    const client = createMockDeleteAccountClient({ delayMs: 0 });

    await expect(client.submit()).resolves.toEqual({ ok: true, data: { deleted: true } });
  });

  it('resolves a success as { ok: true, data: { deleted: true } }', async () => {
    const client = createMockDeleteAccountClient({ delayMs: 0, outcome: 'deleted' });

    const result = await client.submit();

    expect(result).toEqual({ ok: true, data: { deleted: true } });
  });

  // A documented non-2xx RESOLVES on the error branch — it never rejects. This is the seam's
  // central promise (see the DeleteAccountClient doc comment): the screen must be able to tell a
  // "the server said no" apart from a "the call blew up" without a try/catch around every call.
  it('resolves — never rejects — a documented failure, carrying the { error, code } contract', async () => {
    const client = createMockDeleteAccountClient({ delayMs: 0, outcome: 'failed' });

    const result = await client.submit();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the failure branch');
    expect(result.error).toEqual({
      error: 'The account could not be deleted.',
      code: 'purge_failed',
    });
  });

  it('rejects only for a genuinely unexpected failure', async () => {
    const client = createMockDeleteAccountClient({ delayMs: 0, outcome: 'thrown' });

    await expect(client.submit()).rejects.toThrow(/Mock delete-account failure/);
  });

  it('takes no arguments — the user is identified by the JWT, never named by the client', () => {
    const client = createMockDeleteAccountClient({ delayMs: 0 });

    // A client that accepted a user id would let a caller ask to delete someone else's account.
    // The seam's `submit()` is nullary on purpose; this locks that in at the type AND arity level.
    expect(client.submit).toHaveLength(0);
  });
});

describe('deleteAccountClient (the shipped binding)', () => {
  it('conforms to the DeleteAccountClient seam', () => {
    // Typed assignment is the assertion: if the binding ever drifts from the interface #58 must
    // implement, this stops compiling.
    const client: DeleteAccountClient = deleteAccountClient;

    expect(typeof client.submit).toBe('function');
  });

  // Guards the one thing that would turn this screen into a lie: shipping with the mock still
  // bound would tell a user their account was deleted when nothing happened. This test does not
  // (and cannot) prevent that — it exists to FAIL LOUDLY at the moment #58 swaps the binding, so
  // whoever does the swap is forced to come back here, delete this test, and confirm the real
  // client is wired. See lib/delete-account.ts's binding note.
  it('is STILL THE MOCK — delete #58 swaps this binding, and this test with it', async () => {
    await expect(deleteAccountClient.submit()).resolves.toEqual({
      ok: true,
      data: { deleted: true },
    });
  });
});
