/**
 * `lib/subscription.ts` (issue #52) — the dummy-subscription client: `getQuotaStatus()` (GET
 * `quota-status`) and `purchaseTier()` (POST `purchase-tier`), both through `invokeFunction`.
 *
 * WHAT THIS SUITE PROVES: both functions read the documented response contracts correctly, never
 * fabricate a `QuotaStatus`/`PurchaseSuccess` from a body they don't recognize, and never reject —
 * every failure resolves `{ ok: false, error }`. It also locks the one property issue #52 exists
 * to guarantee: nothing here ever returns a hardcoded tier limit or frame cap — every number in a
 * successful `QuotaStatus` comes straight from the (mocked) server response, never a local
 * constant. It does NOT prove either edge function itself behaves correctly (that's each
 * function's own Deno suite) and does NOT prove the two projects agree on the contract — same
 * caveat `lib/delete-account.ts`'s suite documents for its own endpoint.
 *
 * `delayMs`-style timers don't apply here (no mock client with an artificial delay) — every test
 * resolves as soon as its mocked `supabase.functions.invoke` does.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '../supabase';
import {
  formatRenewalDate,
  getQuotaStatus,
  parseQuotaStatus,
  purchaseTier,
  type QuotaStatus,
} from '../subscription';

jest.mock('../supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const mockInvoke = supabase.functions.invoke as jest.MockedFunction<typeof supabase.functions.invoke>;

beforeEach(() => {
  mockInvoke.mockReset();
});

/** A minimal fake `Response`-shaped object — all `invokeFunction` ever calls on
 *  `FunctionsHttpError.context` is `.json()`. Matches `lib/__tests__/delete-account.test.ts`. */
function fakeJsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

const FULL_QUOTA_STATUS_BODY = {
  tier: 'pro',
  used: 3,
  limit: 10,
  remaining: 7,
  frameCap: 5,
  unlimited: false,
  isLifetime: false,
  periodStart: '2026-07-01T00:00:00.000Z',
  periodEnd: '2026-08-01T00:00:00.000Z',
  blocked: false,
  blockedReason: null,
  blockedUntil: null,
} as const;

describe('getQuotaStatus', () => {
  it('reads a full, well-formed body straight through — no field invented, none dropped', async () => {
    mockInvoke.mockResolvedValue({ data: FULL_QUOTA_STATUS_BODY, error: null } as never);

    const result = await getQuotaStatus();

    expect(result).toEqual({ ok: true, data: FULL_QUOTA_STATUS_BODY });
    expect(mockInvoke).toHaveBeenCalledWith('quota-status', { method: 'GET' });
  });

  // THE #52 REGRESSION LOCK. If this file ever grows a `const FREE_LIMIT = 1` (or a pro/elite
  // equivalent) and starts using it instead of the server's own `limit` field, this is the test
  // that would have to be broken to hide it — the server's number and the returned number must be
  // the exact same value, from a mock that could just as easily have said something else.
  it('accepts the temporary unlimited Elite shape with null limit/remaining', async () => {
    const unlimited = {
      ...FULL_QUOTA_STATUS_BODY,
      tier: 'elite',
      used: 42,
      limit: null,
      remaining: null,
      frameCap: 8,
      unlimited: true,
      periodStart: null,
      periodEnd: null,
    } as const;
    mockInvoke.mockResolvedValue({ data: unlimited, error: null } as never);

    await expect(getQuotaStatus()).resolves.toEqual({ ok: true, data: unlimited });
  });

  it('never substitutes a hardcoded limit/frameCap for whatever the server actually sent', async () => {
    mockInvoke.mockResolvedValue({
      data: { ...FULL_QUOTA_STATUS_BODY, tier: 'free', limit: 1, used: 0, remaining: 1, frameCap: 1 },
      error: null,
    } as never);

    const free = await getQuotaStatus();
    expect(free).toEqual({
      ok: true,
      data: { ...FULL_QUOTA_STATUS_BODY, tier: 'free', limit: 1, used: 0, remaining: 1, frameCap: 1 },
    });

    mockInvoke.mockResolvedValue({
      data: { ...FULL_QUOTA_STATUS_BODY, tier: 'elite', limit: 30, used: 12, remaining: 18, frameCap: 8 },
      error: null,
    } as never);

    const elite = await getQuotaStatus();
    expect(elite).toEqual({
      ok: true,
      data: { ...FULL_QUOTA_STATUS_BODY, tier: 'elite', limit: 30, used: 12, remaining: 18, frameCap: 8 },
    });
  });

  it('carries the anti-farm block state through independently of remaining', async () => {
    mockInvoke.mockResolvedValue({
      data: {
        ...FULL_QUOTA_STATUS_BODY,
        remaining: 4,
        blocked: true,
        blockedReason: 'too_many_failed_attempts',
        blockedUntil: '2026-07-14T00:00:00.000Z',
      },
      error: null,
    } as never);

    const result = await getQuotaStatus();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.data.remaining).toBe(4);
    expect(result.data.blocked).toBe(true);
    expect(result.data.blockedReason).toBe('too_many_failed_attempts');
  });

  it('does NOT report success for a 200 body it does not recognize', async () => {
    mockInvoke.mockResolvedValue({ data: { unexpected: 'shape' }, error: null } as never);

    const result = await getQuotaStatus();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the failure branch');
    expect(result.error.code).toBe('unknown');
  });

  it.each([
    ['unauthorized', 'Missing Authorization header.'],
    ['quota_status_unavailable', 'Could not determine your current quota. Please try again shortly.'],
  ] as const)('maps a documented %s failure through by code', async (code, error) => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(fakeJsonResponse({ error, code })),
    } as never);

    const result = await getQuotaStatus();

    expect(result).toEqual({ ok: false, error: { code, message: error } });
  });

  it('folds an unrecognized error code into the client-side "unknown" bucket', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(fakeJsonResponse({ error: 'Something new.', code: 'a_future_code' })),
    } as never);

    const result = await getQuotaStatus();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the failure branch');
    expect(result.error.code).toBe('unknown');
  });

  it('resolves — never rejects — a relay/network error with no structured body at all', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('network down') } as never);

    await expect(getQuotaStatus()).resolves.toEqual({
      ok: false,
      error: { code: 'unknown', message: 'Could not load quota status.' },
    });
  });
});

describe('parseQuotaStatus', () => {
  it('rejects a non-object', () => {
    expect(parseQuotaStatus(null)).toBeNull();
    expect(parseQuotaStatus('free')).toBeNull();
    expect(parseQuotaStatus([FULL_QUOTA_STATUS_BODY])).toBeNull();
  });

  it('rejects an unrecognized tier', () => {
    expect(parseQuotaStatus({ ...FULL_QUOTA_STATUS_BODY, tier: 'ultra' })).toBeNull();
  });

  it.each(['used', 'limit', 'remaining', 'frameCap'] as const)(
    'rejects a non-numeric %s',
    (field) => {
      expect(parseQuotaStatus({ ...FULL_QUOTA_STATUS_BODY, [field]: '3' })).toBeNull();
    }
  );

  it('rejects a non-boolean blocked', () => {
    expect(parseQuotaStatus({ ...FULL_QUOTA_STATUS_BODY, blocked: 'no' })).toBeNull();
  });

  it('rejects a blockedReason the server does not document', () => {
    expect(parseQuotaStatus({ ...FULL_QUOTA_STATUS_BODY, blockedReason: 'made_up_reason' })).toBeNull();
  });

  it('normalizes a null period (free tier) through, not dropped or fabricated', () => {
    const free: QuotaStatus = {
      tier: 'free',
      used: 1,
      limit: 1,
      remaining: 0,
      frameCap: 1,
      unlimited: false,
      isLifetime: true,
      periodStart: null,
      periodEnd: null,
      blocked: false,
      blockedReason: null,
      blockedUntil: null,
    };

    expect(parseQuotaStatus(free)).toEqual(free);
  });
});

const PURCHASE_SUCCESS_BODY = {
  tier: 'pro',
  periodStart: '2026-07-13T12:00:00.000Z',
  periodEnd: '2026-08-13T12:00:00.000Z',
};

describe('purchaseTier', () => {
  it('sends the documented { tier, source: "dummy" } body and reports a matching success', async () => {
    mockInvoke.mockResolvedValue({ data: PURCHASE_SUCCESS_BODY, error: null } as never);

    const result = await purchaseTier('pro');

    expect(result).toEqual({ ok: true, data: PURCHASE_SUCCESS_BODY });
    expect(mockInvoke).toHaveBeenCalledWith('purchase-tier', {
      method: 'POST',
      body: { tier: 'pro', source: 'dummy' },
    });
  });

  it('works for elite too', async () => {
    mockInvoke.mockResolvedValue({
      data: { tier: 'elite', periodStart: '2026-07-13T12:00:00.000Z', periodEnd: '2026-08-13T12:00:00.000Z' },
      error: null,
    } as never);

    const result = await purchaseTier('elite');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.data.tier).toBe('elite');
    expect(mockInvoke).toHaveBeenCalledWith('purchase-tier', {
      method: 'POST',
      body: { tier: 'elite', source: 'dummy' },
    });
  });

  it('does NOT report success for a 200 body it does not recognize', async () => {
    mockInvoke.mockResolvedValue({ data: { unexpected: 'shape' }, error: null } as never);

    const result = await purchaseTier('pro');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the failure branch');
    expect(result.error.code).toBe('unknown');
  });

  // THE DEPLOYMENT-GATE CASE (this file's header): a real { error, code: 'not_found' } JSON body
  // (deployed but gated off / not allowlisted) must read as "not available", not "broke".
  it('maps a documented not_found (gate off / not allowlisted) to code: not_found', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(fakeJsonResponse({ error: 'Not found.', code: 'not_found' })),
    } as never);

    const result = await purchaseTier('pro');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the failure branch');
    expect(result.error.code).toBe('not_found');
  });

  // THE OTHER DEPLOYMENT-GATE CASE: the function isn't deployed to this project AT ALL yet (this
  // project's actual current state, per docs/architecture.md) — a 404 with no parseable
  // { error, code } body, which invokeFunction reports as kind: 'malformed'. Must collapse to the
  // SAME code as the documented not_found above, not a generic "unknown" failure — see
  // purchaseTier's own comment on why these two must be indistinguishable to the user.
  it('maps an undeployed-function 404 (kind: malformed) to the SAME code: not_found', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError({
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      } as unknown as Response),
    } as never);

    const result = await purchaseTier('pro');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the failure branch');
    expect(result.error.code).toBe('not_found');
  });

  it.each([
    ['unauthorized', 'Missing Authorization header.'],
    ['rate_limited', 'Too many purchase requests for this account. Please wait a moment and try again.'],
    ['purchase_unavailable', 'Could not complete your purchase. Please try again shortly.'],
  ] as const)('maps a documented %s failure through by code', async (code, error) => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(fakeJsonResponse({ error, code })),
    } as never);

    const result = await purchaseTier('pro');

    expect(result).toEqual({ ok: false, error: { code, message: error } });
  });

  // A client-bug-only code (this client always sends a well-formed body) — folded into
  // 'unknown' rather than given its own copy, per this file's PurchaseErrorCode doc comment.
  it.each(['invalid_tier', 'invalid_source', 'invalid_body'] as const)(
    'folds the client-bug-only code %s into the "unknown" bucket',
    async (code) => {
      mockInvoke.mockResolvedValue({
        data: null,
        error: new FunctionsHttpError(fakeJsonResponse({ error: 'bad request', code })),
      } as never);

      const result = await purchaseTier('pro');

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected the failure branch');
      expect(result.error.code).toBe('unknown');
    }
  );

  it('folds an unrecognized error code into the client-side "unknown" bucket', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(fakeJsonResponse({ error: 'Something new.', code: 'a_future_code' })),
    } as never);

    const result = await purchaseTier('elite');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the failure branch');
    expect(result.error.code).toBe('unknown');
  });

  it('resolves — never rejects — a relay/network error with no structured body at all', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('network down') } as never);

    await expect(purchaseTier('pro')).resolves.toEqual({
      ok: false,
      error: { code: 'unknown', message: 'Could not complete the purchase.' },
    });
  });

  it('resolves — never rejects — even if invoke() itself throws synchronously', async () => {
    mockInvoke.mockImplementation(() => {
      throw new Error('unexpected synchronous throw');
    });

    await expect(purchaseTier('pro')).resolves.toEqual({
      ok: false,
      error: { code: 'unknown', message: 'Could not complete the purchase.' },
    });
  });
});

describe('formatRenewalDate', () => {
  it('formats a valid ISO date', () => {
    // Locale-independent assertion: just check it's not the raw ISO string and contains the year.
    const formatted = formatRenewalDate('2026-08-01T00:00:00.000Z');
    expect(formatted).not.toBe('2026-08-01T00:00:00.000Z');
    expect(formatted).toContain('2026');
  });

  it('returns the raw string unchanged for an unparseable value, rather than throwing', () => {
    expect(formatRenewalDate('not-a-date')).toBe('not-a-date');
  });
});
