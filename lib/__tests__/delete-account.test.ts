/**
 * `lib/delete-account.ts` (issue #53; made real 2026-07-13 per a security audit on PR #122,
 * finding F1) — the `delete-account` client, both the real `supabase.functions.invoke`
 * implementation and its dev/test-only mock.
 *
 * WHAT THIS SUITE PROVES, AND WHAT IT CANNOT: it proves `submitToEdgeFunction` reads the documented
 * response contract correctly and NEVER reports a success it cannot confirm from a recognized 200
 * body — that is the property F1 exists to guarantee. It does NOT prove the edge function itself
 * behaves correctly (that is #121/#58's own Deno suite, `_shared/__tests__/delete-account.deno.test.ts`)
 * and it does NOT prove the two projects agree on the contract — see `lib/delete-account.ts`'s
 * header for why that drift risk exists and how it's flagged.
 *
 * `delayMs: 0` throughout the mock tests — its default delay exists so a human reviewer can see
 * the screen's pending state, and has no business slowing a unit test down.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const mockInvoke = supabase.functions.invoke as jest.MockedFunction<typeof supabase.functions.invoke>;

// Re-imported after the mock is registered, matching this repo's established pattern
// (lib/__tests__/consent.test.ts mocks `../supabase` the same way).
import {
  createDeleteAccountClient,
  createMockDeleteAccountClient,
  deleteAccountClient,
  type DeleteAccountClient,
} from '../delete-account';

beforeEach(() => {
  mockInvoke.mockReset();
});

/** A minimal fake `Response`-shaped object — all `submitToEdgeFunction` ever calls on
 *  `FunctionsHttpError.context` is `.json()`. */
function fakeJsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

describe('createDeleteAccountClient (the real implementation)', () => {
  it('reports a plain success as { ok: true, data: { outcome: "deleted" } }', async () => {
    mockInvoke.mockResolvedValue({
      data: { deleted: true, purgedObjectCount: 12, consentEventsPurged: 3 },
      error: null,
    } as never);

    const client = createDeleteAccountClient();
    const result = await client.submit();

    expect(result).toEqual({ ok: true, data: { outcome: 'deleted' } });
    expect(mockInvoke).toHaveBeenCalledWith('delete-account', { method: 'POST' });
  });

  // THE F2/F1-ADJACENT CASE: orphans_remaining is a 200 SUCCESS, not a failure — the account is
  // irreversibly gone. A regression back to treating this as an error would tell a user their
  // (actually-deleted) account still exists.
  it('reports orphans_remaining as a SUCCESS, distinguished by outcome', async () => {
    mockInvoke.mockResolvedValue({
      data: { deleted: true, orphansRemaining: true, purgedObjectCount: 5 },
      error: null,
    } as never);

    const client = createDeleteAccountClient();
    const result = await client.submit();

    expect(result).toEqual({ ok: true, data: { outcome: 'orphansRemaining' } });
  });

  // THE F1 CASE: a 200 whose body does NOT match the documented shape must never be read as a
  // success — that is exactly the "claims erasure it can't confirm" bug this file exists to rule
  // out structurally, not just by convention.
  it('does NOT report success for a 200 body it does not recognize', async () => {
    mockInvoke.mockResolvedValue({ data: { unexpected: 'shape' }, error: null } as never);

    const client = createDeleteAccountClient();
    const result = await client.submit();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the failure branch');
    expect(result.error.code).toBe('unknown');
  });

  it.each([
    ['purge_failed', 'Could not remove your stored frames.'],
    ['rows_failed', 'Your stored frames were removed but your account could not be deleted.'],
    ['auth_delete_failed', 'Your data was deleted but your sign-in could not be removed.'],
  ] as const)('maps a documented %s failure through, code and message intact', async (code, error) => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(fakeJsonResponse({ error, code })),
    } as never);

    const client = createDeleteAccountClient();
    const result = await client.submit();

    expect(result).toEqual({ ok: false, error: { error, code } });
  });

  it('folds an unrecognized error code into the client-side "unknown" bucket, not a guessed server code', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(fakeJsonResponse({ error: 'Something new.', code: 'a_future_code' })),
    } as never);

    const client = createDeleteAccountClient();
    const result = await client.submit();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the failure branch');
    expect(result.error.code).toBe('unknown');
  });

  it('resolves — never rejects — a FunctionsHttpError whose body is not valid JSON (e.g. the function is not deployed yet: a 404)', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError({
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      } as unknown as Response),
    } as never);

    const client = createDeleteAccountClient();

    await expect(client.submit()).resolves.toEqual({
      ok: false,
      error: { error: 'The account could not be deleted.', code: 'unknown' },
    });
  });

  it('resolves — never rejects — a relay/network error with no structured body at all', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('network down') } as never);

    const client = createDeleteAccountClient();

    await expect(client.submit()).resolves.toEqual({
      ok: false,
      error: { error: 'The account could not be deleted.', code: 'unknown' },
    });
  });

  it('resolves — never rejects — even if invoke() itself throws synchronously', async () => {
    mockInvoke.mockImplementation(() => {
      throw new Error('unexpected synchronous throw');
    });

    const client = createDeleteAccountClient();

    await expect(client.submit()).resolves.toEqual({
      ok: false,
      error: { error: 'The account could not be deleted.', code: 'unknown' },
    });
  });

  it('takes no arguments — the user is identified by the JWT, never named by the client', () => {
    const client = createDeleteAccountClient();
    expect(client.submit).toHaveLength(0);
  });
});

describe('createMockDeleteAccountClient', () => {
  it('defaults to a plain deleted success', async () => {
    const client = createMockDeleteAccountClient({ delayMs: 0 });
    await expect(client.submit()).resolves.toEqual({ ok: true, data: { outcome: 'deleted' } });
  });

  it('exercises the orphansRemaining success', async () => {
    const client = createMockDeleteAccountClient({ delayMs: 0, outcome: 'orphansRemaining' });
    await expect(client.submit()).resolves.toEqual({ ok: true, data: { outcome: 'orphansRemaining' } });
  });

  it.each([
    ['purgeFailed', 'purge_failed'],
    ['rowsFailed', 'rows_failed'],
    ['authDeleteFailed', 'auth_delete_failed'],
    ['unknownFailure', 'unknown'],
  ] as const)('exercises the %s failure with code %s', async (outcome, code) => {
    const client = createMockDeleteAccountClient({ delayMs: 0, outcome });
    const result = await client.submit();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the failure branch');
    expect(result.error.code).toBe(code);
  });

  it("rejects only for the thrown outcome, exercising the seam's \"MAY reject\" branch", async () => {
    const client = createMockDeleteAccountClient({ delayMs: 0, outcome: 'thrown' });
    await expect(client.submit()).rejects.toThrow(/Mock delete-account failure/);
  });

  // F1's tripwire: this mock must be unable to run in a release build. __DEV__ is true under
  // Jest (react-native/jest/setup.js sets it explicitly), so this asserts the guard EXISTS by
  // temporarily flipping it, rather than only trusting the source to say so.
  it('refuses to run at all when __DEV__ is false', async () => {
    const original = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    try {
      const client = createMockDeleteAccountClient({ delayMs: 0 });
      await expect(client.submit()).rejects.toThrow(/must never run outside a dev\/test build/);
    } finally {
      (globalThis as { __DEV__?: boolean }).__DEV__ = original;
    }
  });
});

describe('deleteAccountClient (the shipped binding)', () => {
  it('conforms to the DeleteAccountClient interface', () => {
    const client: DeleteAccountClient = deleteAccountClient;
    expect(typeof client.submit).toBe('function');
  });

  // THE F1 REGRESSION LOCK. The original version of this file bound `deleteAccountClient` to the
  // mock with NO PR anywhere responsible for swapping it — #58/#121 never touches this file. That
  // shipped a screen whose delete confirmation was real but whose purge silently did nothing. This
  // test asserts the OPPOSITE of what this file's very first version asserted (it used to say "is
  // STILL THE MOCK", and passed): the binding must be the REAL client, which it can prove by
  // observing that it actually calls through to `supabase.functions.invoke` rather than resolving
  // on a bare `setTimeout` with no network call at all.
  it('IS THE REAL CLIENT — calls supabase.functions.invoke, not the mock', async () => {
    mockInvoke.mockResolvedValue({ data: { deleted: true }, error: null } as never);

    await deleteAccountClient.submit();

    expect(mockInvoke).toHaveBeenCalledWith('delete-account', { method: 'POST' });
  });
});
