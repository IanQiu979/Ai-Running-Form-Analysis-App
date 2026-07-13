/**
 * `lib/functions-client.ts` (issue #46) — the shared `supabase.functions.invoke()` wrapper every
 * edge-function caller in this app should go through instead of calling `invoke()` directly.
 *
 * WHAT THIS SUITE PROVES: `invokeFunction()` correctly tells apart the three shapes
 * `supabase.functions.invoke()` can resolve/throw — a genuine HTTP error with a parseable
 * `{ error, code }` body, an HTTP error whose body doesn't match that contract, and a
 * network-class failure with no body at all (`FunctionsRelayError`/`FunctionsFetchError`/
 * anything else) — and never lets any of them escape as a rejection. It does NOT prove any one
 * edge function's `code` values are correct; that's each function's own Deno suite.
 */
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';

import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const mockInvoke = supabase.functions.invoke as jest.MockedFunction<typeof supabase.functions.invoke>;

// Re-imported after the mock is registered, matching this repo's established pattern
// (lib/__tests__/delete-account.test.ts mocks `../supabase` the same way).
import { invokeFunction } from '../functions-client';

beforeEach(() => {
  mockInvoke.mockReset();
});

/** A minimal fake `Response`-shaped object — all `invokeFunction` ever calls on
 *  `FunctionsHttpError.context` is `.json()`. */
function fakeJsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

describe('invokeFunction', () => {
  it('resolves { ok: true, data } for a successful invocation', async () => {
    mockInvoke.mockResolvedValue({ data: { tier: 'free' }, error: null } as never);

    const result = await invokeFunction('quota-status', { method: 'GET' });

    expect(result).toEqual({ ok: true, data: { tier: 'free' } });
    expect(mockInvoke).toHaveBeenCalledWith('quota-status', { method: 'GET' });
  });

  it('unwraps a FunctionsHttpError whose body matches the documented { error, code } contract', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(
        fakeJsonResponse({ error: 'You are out of analyses this month.', code: 'quota_exceeded' })
      ),
    } as never);

    const result = await invokeFunction('analyze-form', { method: 'POST' });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'http', error: 'You are out of analyses this month.', code: 'quota_exceeded' },
    });
  });

  it('reports kind: "malformed" for a FunctionsHttpError whose body is not valid JSON', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError({
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      } as unknown as Response),
    } as never);

    const result = await invokeFunction('purchase-tier', { method: 'POST' });

    expect(result).toEqual({ ok: false, error: { kind: 'malformed' } });
  });

  it('reports kind: "malformed" for a FunctionsHttpError whose body is valid JSON but not the documented shape', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(fakeJsonResponse({ unexpected: 'shape' })),
    } as never);

    const result = await invokeFunction('purchase-tier', { method: 'POST' });

    expect(result).toEqual({ ok: false, error: { kind: 'malformed' } });
  });

  it.each([
    ['error', 42],
    ['code', null],
  ])('reports kind: "malformed" when %s is present but not a string', async (field, value) => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(
        fakeJsonResponse({ error: 'Some error.', code: 'some_code', [field]: value })
      ),
    } as never);

    const result = await invokeFunction('purchase-tier', { method: 'POST' });

    expect(result).toEqual({ ok: false, error: { kind: 'malformed' } });
  });

  it('reports kind: "network" for a FunctionsRelayError — no server body was ever produced', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsRelayError(fakeJsonResponse({ error: 'irrelevant', code: 'irrelevant' })),
    } as never);

    const result = await invokeFunction('quota-status', { method: 'GET' });

    expect(result).toEqual({ ok: false, error: { kind: 'network' } });
  });

  it('reports kind: "network" for a FunctionsFetchError — the request never got a response', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsFetchError(new TypeError('Network request failed')),
    } as never);

    const result = await invokeFunction('quota-status', { method: 'GET' });

    expect(result).toEqual({ ok: false, error: { kind: 'network' } });
  });

  it('reports kind: "network" for any other error shape supabase.functions.invoke() might resolve', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('something unexpected') } as never);

    const result = await invokeFunction('quota-status', { method: 'GET' });

    expect(result).toEqual({ ok: false, error: { kind: 'network' } });
  });

  it('resolves — never rejects — even if invoke() itself throws synchronously', async () => {
    mockInvoke.mockImplementation(() => {
      throw new Error('unexpected synchronous throw');
    });

    await expect(invokeFunction('quota-status', { method: 'GET' })).resolves.toEqual({
      ok: false,
      error: { kind: 'network' },
    });
  });

  it('passes the function name and options straight through to supabase.functions.invoke', async () => {
    mockInvoke.mockResolvedValue({ data: {}, error: null } as never);

    await invokeFunction('delete-account', { method: 'POST', body: { foo: 'bar' } });

    expect(mockInvoke).toHaveBeenCalledWith('delete-account', { method: 'POST', body: { foo: 'bar' } });
  });

  it('is callable with no options at all', async () => {
    mockInvoke.mockResolvedValue({ data: {}, error: null } as never);

    await invokeFunction('quota-status');

    expect(mockInvoke).toHaveBeenCalledWith('quota-status', undefined);
  });
});
