/**
 * `lib/quota.ts` (issues #54/#15) — the `quota-status` client that replaces
 * `app/(tabs)/index.tsx`'s former hand-rolled `subscriptions` + `analyses` count query.
 *
 * WHAT THIS SUITE PROVES, AND WHAT IT CANNOT: it proves `fetchFromEdgeFunction` reads the
 * documented response contract correctly and NEVER reports a quota reading it cannot confirm
 * from a recognized 200 body — the same "client is never the authority, and never guesses"
 * property `lib/__tests__/delete-account.test.ts` locks for its own endpoint. It does NOT prove
 * the edge function itself behaves correctly (that is `supabase/functions/_shared/
 * __tests__/quota-status.deno.test.ts`) and it does NOT prove the two projects agree on the
 * wire contract — same drift risk `lib/quota.ts`'s header documents.
 *
 * The "Display logic" describe block below covers the pure `QuotaStatus` -> copy/CTA mapping at
 * the bottom of `lib/quota.ts` — every branch of Home's caption and primary-CTA rendering,
 * exercised without a screen (CLAUDE.md: "Screens are not unit-tested for now").
 */
import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const mockInvoke = supabase.functions.invoke as jest.MockedFunction<typeof supabase.functions.invoke>;

// Re-imported after the mock is registered, matching this repo's established pattern
// (lib/__tests__/delete-account.test.ts mocks `../supabase` the same way).
import {
  createQuotaStatusClient,
  describeQuota,
  isPrimaryCtaEnabled,
  parseQuotaStatusResponse,
  primaryCtaAccessibilityHint,
  primaryCtaKind,
  primaryCtaLabel,
  quotaStatusClient,
  type QuotaStatus,
} from '../quota';
import { Copy } from '../../constants/copy';

beforeEach(() => {
  mockInvoke.mockReset();
});

/** A minimal fake `Response`-shaped object — all `fetchFromEdgeFunction` ever calls on
 *  `FunctionsHttpError.context` is `.json()`. */
function fakeJsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

const FREE_AVAILABLE: QuotaStatus = {
  tier: 'free',
  used: 0,
  limit: 1,
  remaining: 1,
  frameCap: 8,
  isLifetime: true,
  periodStart: null,
  periodEnd: null,
  blocked: false,
  blockedReason: null,
  blockedUntil: null,
};

const PRO_REMAINING: QuotaStatus = {
  tier: 'pro',
  used: 3,
  limit: 10,
  remaining: 7,
  frameCap: 16,
  isLifetime: false,
  periodStart: '2026-07-01T00:00:00.000Z',
  periodEnd: '2026-08-01T00:00:00.000Z',
  blocked: false,
  blockedReason: null,
  blockedUntil: null,
};

const ELITE_BLOCKED: QuotaStatus = {
  tier: 'elite',
  used: 2,
  limit: 30,
  remaining: 28,
  frameCap: 24,
  isLifetime: false,
  periodStart: '2026-07-01T00:00:00.000Z',
  periodEnd: '2026-08-01T00:00:00.000Z',
  blocked: true,
  blockedReason: 'too_many_failed_attempts',
  blockedUntil: '2026-07-14T00:00:00.000Z',
};

describe('parseQuotaStatusResponse', () => {
  it.each([
    ['free, unused', FREE_AVAILABLE],
    ['pro, remaining', PRO_REMAINING],
    // A user can have remaining quota AND be anti-farm-blocked at the same time — issue #6, and
    // `_shared/quota-status.ts`'s own header calls this case out by name as one #54 must render
    // honestly rather than collapse into a single boolean.
    ['elite, remaining but anti-farm blocked', ELITE_BLOCKED],
  ])('parses a well-formed %s response', (_label, quota) => {
    expect(parseQuotaStatusResponse({ ...quota })).toEqual(quota);
  });

  it('returns null for a non-object body', () => {
    expect(parseQuotaStatusResponse(null)).toBeNull();
    expect(parseQuotaStatusResponse('nope')).toBeNull();
    expect(parseQuotaStatusResponse(42)).toBeNull();
  });

  it('returns null for an unrecognized tier', () => {
    expect(parseQuotaStatusResponse({ ...FREE_AVAILABLE, tier: 'ultra' })).toBeNull();
  });

  it('returns null when used/limit/remaining/frameCap are not all numbers', () => {
    expect(parseQuotaStatusResponse({ ...FREE_AVAILABLE, used: '0' })).toBeNull();
    expect(parseQuotaStatusResponse({ ...FREE_AVAILABLE, limit: null })).toBeNull();
    expect(parseQuotaStatusResponse({ ...FREE_AVAILABLE, remaining: undefined })).toBeNull();
    expect(parseQuotaStatusResponse({ ...FREE_AVAILABLE, frameCap: '8' })).toBeNull();
  });

  it('drops a blockedReason the server did not actually send blocked=true with', () => {
    const parsed = parseQuotaStatusResponse({
      ...FREE_AVAILABLE,
      blocked: false,
      blockedReason: 'too_many_failed_attempts',
      blockedUntil: '2026-07-14T00:00:00.000Z',
    });
    expect(parsed?.blockedReason).toBeNull();
    expect(parsed?.blockedUntil).toBeNull();
  });

  it('folds an unrecognized blockedReason into null rather than trusting it blindly', () => {
    const parsed = parseQuotaStatusResponse({
      ...ELITE_BLOCKED,
      blockedReason: 'some_future_reason',
    });
    expect(parsed?.blocked).toBe(true);
    expect(parsed?.blockedReason).toBeNull();
  });
});

describe('createQuotaStatusClient (the real implementation)', () => {
  it('calls quota-status with GET and reports a well-formed 200 as a success', async () => {
    mockInvoke.mockResolvedValue({ data: { ...PRO_REMAINING }, error: null } as never);

    const client = createQuotaStatusClient();
    const result = await client.fetch();

    expect(result).toEqual({ ok: true, data: PRO_REMAINING });
    expect(mockInvoke).toHaveBeenCalledWith('quota-status', { method: 'GET' });
  });

  it('does NOT report success for a 200 body it does not recognize', async () => {
    mockInvoke.mockResolvedValue({ data: { unexpected: 'shape' }, error: null } as never);

    const client = createQuotaStatusClient();
    const result = await client.fetch();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the failure branch');
    expect(result.error.code).toBe('unknown');
  });

  it.each([
    ['unauthorized', 'Invalid or expired session.'],
    ['quota_status_unavailable', 'Could not determine your current quota. Please try again shortly.'],
  ] as const)('maps a documented %s failure through, code and message intact', async (code, error) => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(fakeJsonResponse({ error, code })),
    } as never);

    const client = createQuotaStatusClient();
    const result = await client.fetch();

    expect(result).toEqual({ ok: false, error: { error, code } });
  });

  it('folds an unrecognized error code into the client-side "unknown" bucket, not a guessed server code', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(fakeJsonResponse({ error: 'Something new.', code: 'a_future_code' })),
    } as never);

    const client = createQuotaStatusClient();
    const result = await client.fetch();

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

    const client = createQuotaStatusClient();

    await expect(client.fetch()).resolves.toEqual({
      ok: false,
      error: { error: 'Could not determine your current quota.', code: 'unknown' },
    });
  });

  it('resolves — never rejects — a relay/network error with no structured body at all', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('network down') } as never);

    const client = createQuotaStatusClient();

    await expect(client.fetch()).resolves.toEqual({
      ok: false,
      error: { error: 'Could not determine your current quota.', code: 'unknown' },
    });
  });

  it('resolves — never rejects — even if invoke() itself throws synchronously', async () => {
    mockInvoke.mockImplementation(() => {
      throw new Error('unexpected synchronous throw');
    });

    const client = createQuotaStatusClient();

    await expect(client.fetch()).resolves.toEqual({
      ok: false,
      error: { error: 'Could not determine your current quota.', code: 'unknown' },
    });
  });

  it('takes no arguments — the user is identified by the JWT, never named by the client', () => {
    const client = createQuotaStatusClient();
    expect(client.fetch).toHaveLength(0);
  });
});

describe('quotaStatusClient (the shipped binding)', () => {
  it('conforms to the QuotaStatusClient interface and calls through to supabase.functions.invoke', async () => {
    mockInvoke.mockResolvedValue({ data: { ...FREE_AVAILABLE }, error: null } as never);

    expect(typeof quotaStatusClient.fetch).toBe('function');
    await quotaStatusClient.fetch();

    expect(mockInvoke).toHaveBeenCalledWith('quota-status', { method: 'GET' });
  });
});

// -------------------------------------------------------------------------------------------
// Display logic
// -------------------------------------------------------------------------------------------

const FREE_EXHAUSTED: QuotaStatus = { ...FREE_AVAILABLE, used: 1, remaining: 0 };
const PRO_EXHAUSTED: QuotaStatus = { ...PRO_REMAINING, used: 10, remaining: 0 };
const ELITE_EXHAUSTED: QuotaStatus = { ...ELITE_BLOCKED, used: 30, remaining: 0, blocked: false, blockedReason: null, blockedUntil: null };

describe('describeQuota', () => {
  it('renders the free-lifetime caption, never "this month" — the deck is emphatic', () => {
    expect(describeQuota(FREE_AVAILABLE)).toEqual({
      primary: Copy.home.quota.free.available,
      secondary: null,
    });
    expect(Copy.home.quota.free.available.toLowerCase()).not.toContain('this month');
  });

  it('renders the free-exhausted caption with no secondary line', () => {
    expect(describeQuota(FREE_EXHAUSTED)).toEqual({
      primary: Copy.home.quota.exhausted.free,
      secondary: null,
    });
  });

  it('renders Pro remaining with a "Renews {date}" secondary line', () => {
    const caption = describeQuota(PRO_REMAINING);
    expect(caption.primary).toBe('7 of 10 analyses left this period');
    expect(caption.secondary).toMatch(/^Renews /);
  });

  it('renders Elite remaining the same way as Pro, off its own deck key', () => {
    const eliteRemaining: QuotaStatus = { ...PRO_REMAINING, tier: 'elite', used: 3, limit: 30, remaining: 27 };
    const caption = describeQuota(eliteRemaining);
    expect(caption.primary).toBe('27 of 30 analyses left this period');
    expect(caption.secondary).toMatch(/^Renews /);
  });

  it('renders Pro exhausted with the renewal date folded into the primary line, no secondary', () => {
    const caption = describeQuota(PRO_EXHAUSTED);
    expect(caption.primary).toMatch(/^You've used all 10 analyses this period — renews /);
    expect(caption.secondary).toBeNull();
  });

  it('renders the anti-farm blocked notice as the secondary line even when quota remains', () => {
    // ELITE_BLOCKED: remaining: 28, blocked: true — the exact "quota left but currently
    // refused" combination issue #6 / `_shared/quota-status.ts`'s header calls out by name.
    const caption = describeQuota(ELITE_BLOCKED);
    expect(caption.primary).toBe('28 of 30 analyses left this period');
    expect(caption.secondary).toBe(Copy.home.quota.blocked);
  });

  it('prioritizes the blocked notice over "Renews" when both would otherwise apply', () => {
    const caption = describeQuota(ELITE_BLOCKED);
    expect(caption.secondary).not.toMatch(/^Renews/);
  });
});

describe('primaryCtaKind / primaryCtaLabel / isPrimaryCtaEnabled', () => {
  it('is "analyze", enabled, when quota remains and nothing blocks it', () => {
    expect(primaryCtaKind(FREE_AVAILABLE)).toBe('analyze');
    expect(primaryCtaLabel('analyze')).toBe(Copy.home.cta.analyze);
    expect(isPrimaryCtaEnabled(FREE_AVAILABLE)).toBe(true);
  });

  it('is "analyze" but DISABLED when quota remains yet the anti-farm cap blocks it', () => {
    expect(primaryCtaKind(ELITE_BLOCKED)).toBe('analyze');
    expect(isPrimaryCtaEnabled(ELITE_BLOCKED)).toBe(false);
  });

  it('is "upgradeToAnalyze", disabled, for an exhausted Free user (no route to send it to yet)', () => {
    expect(primaryCtaKind(FREE_EXHAUSTED)).toBe('upgradeToAnalyze');
    expect(primaryCtaLabel('upgradeToAnalyze')).toBe(Copy.home.cta.upgradeToAnalyze);
    expect(isPrimaryCtaEnabled(FREE_EXHAUSTED)).toBe(false);
  });

  it('is "upgradeForMore", disabled, for an exhausted Pro user (Elite ceiling exists above it)', () => {
    expect(primaryCtaKind(PRO_EXHAUSTED)).toBe('upgradeForMore');
    expect(primaryCtaLabel('upgradeForMore')).toBe(Copy.home.cta.upgradeForMore);
    expect(isPrimaryCtaEnabled(PRO_EXHAUSTED)).toBe(false);
  });

  it('is "analyzeDisabled", same label as "analyze", for an exhausted Elite user (nothing above it)', () => {
    expect(primaryCtaKind(ELITE_EXHAUSTED)).toBe('analyzeDisabled');
    expect(primaryCtaLabel('analyzeDisabled')).toBe(Copy.home.cta.analyze);
    expect(isPrimaryCtaEnabled(ELITE_EXHAUSTED)).toBe(false);
  });
});

describe('primaryCtaAccessibilityHint', () => {
  it('is null when the CTA is enabled', () => {
    expect(primaryCtaAccessibilityHint(FREE_AVAILABLE)).toBeNull();
  });

  it('names the anti-farm block, not a quota reason, when quota remains but is blocked', () => {
    expect(primaryCtaAccessibilityHint(ELITE_BLOCKED)).toBe(Copy.home.quota.blocked);
  });

  it('reuses the visible exhausted-Elite caption verbatim (no separate invented reason)', () => {
    expect(primaryCtaAccessibilityHint(ELITE_EXHAUSTED)).toBe(describeQuota(ELITE_EXHAUSTED).primary);
  });

  it.each(['upgradeToAnalyze', 'upgradeForMore'] as const)(
    'names the paywall-unavailable reason for a disabled %s CTA',
    (kindLabel) => {
      const quota = kindLabel === 'upgradeToAnalyze' ? FREE_EXHAUSTED : PRO_EXHAUSTED;
      expect(primaryCtaKind(quota)).toBe(kindLabel);
      expect(primaryCtaAccessibilityHint(quota)).toBe(Copy.home.cta.upgradeUnavailable);
    }
  );
});
