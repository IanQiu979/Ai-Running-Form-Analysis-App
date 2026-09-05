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

jest.mock('../supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const mockInvoke = supabase.functions.invoke as jest.MockedFunction<typeof supabase.functions.invoke>;

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
  frameCap: 1,
  unlimited: false,
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
  unlimited: false,
  isLifetime: false,
  periodStart: '2026-07-01T00:00:00.000Z',
  periodEnd: '2026-08-01T00:00:00.000Z',
  blocked: false,
  blockedReason: null,
  blockedUntil: null,
};

const UNLIMITED_ELITE: QuotaStatus = {
  tier: 'elite',
  used: 42,
  limit: null,
  remaining: null,
  frameCap: 8,
  unlimited: true,
  isLifetime: false,
  periodStart: null,
  periodEnd: null,
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
  unlimited: false,
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
    ['temporary unlimited Elite override', UNLIMITED_ELITE],
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

  it('resolves — never rejects — a FunctionsHttpError whose body is not valid JSON (e.g. a gateway error page rather than this endpoint\'s JSON)', async () => {
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
  it('renders the temporary unlimited Elite caption with no renewal/block line', () => {
    expect(describeQuota(UNLIMITED_ELITE)).toEqual({
      primary: Copy.home.quota.unlimited,
      secondary: null,
    });
  });

  it('tells an unused Free account that one real analysis is available', () => {
    expect(describeQuota(FREE_AVAILABLE)).toEqual({
      primary: '1 free analysis available',
      secondary: null,
    });
  });

  it('tells an exhausted Free account that its real analysis has been used', () => {
    expect(describeQuota(FREE_EXHAUSTED)).toEqual({
      primary: "You've used your free analysis",
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
  it('is "analyze", enabled, when the all-users unlimited override is active', () => {
    expect(primaryCtaKind(UNLIMITED_ELITE)).toBe('analyze');
    expect(isPrimaryCtaEnabled(UNLIMITED_ELITE)).toBe(true);
  });

  it('is "analyze", enabled, when quota remains and nothing blocks it', () => {
    expect(primaryCtaKind(FREE_AVAILABLE)).toBe('analyze');
    expect(primaryCtaLabel('analyze')).toBe(Copy.home.cta.analyze);
    expect(isPrimaryCtaEnabled(FREE_AVAILABLE)).toBe(true);
  });

  it('is "analyze" but DISABLED when quota remains yet the anti-farm cap blocks it', () => {
    expect(primaryCtaKind(ELITE_BLOCKED)).toBe('analyze');
    expect(isPrimaryCtaEnabled(ELITE_BLOCKED)).toBe(false);
  });

  // These two were pinned DISABLED while app/paywall.tsx did not exist. It does now (issue #52),
  // so they are enabled and route there. This is the whole of issue #15: an exhausted user must
  // be offered a way forward, not a dead button under an offer the screen cannot honour.
  it('is "upgradeToAnalyze", ENABLED, for an exhausted Free user — it opens the Paywall', () => {
    expect(primaryCtaKind(FREE_EXHAUSTED)).toBe('upgradeToAnalyze');
    expect(primaryCtaLabel('upgradeToAnalyze')).toBe(Copy.home.cta.upgradeToAnalyze);
    expect(isPrimaryCtaEnabled(FREE_EXHAUSTED)).toBe(true);
  });

  it('is "upgradeForMore", ENABLED, for an exhausted Pro user (an Elite ceiling exists above it)', () => {
    expect(primaryCtaKind(PRO_EXHAUSTED)).toBe('upgradeForMore');
    expect(primaryCtaLabel('upgradeForMore')).toBe(Copy.home.cta.upgradeForMore);
    expect(isPrimaryCtaEnabled(PRO_EXHAUSTED)).toBe(true);
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

  // An enabled CTA needs no "why is this dimmed" hint — its label ("Upgrade to analyze") already
  // says what tapping it does. A hint here would be read out on top of that label, not instead of
  // it, so VoiceOver users would hear the same thing twice.
  it.each(['upgradeToAnalyze', 'upgradeForMore'] as const)(
    'has no disabled-reason hint for the enabled %s CTA — it opens the Paywall',
    (kindLabel) => {
      const quota = kindLabel === 'upgradeToAnalyze' ? FREE_EXHAUSTED : PRO_EXHAUSTED;
      expect(primaryCtaKind(quota)).toBe(kindLabel);
      expect(isPrimaryCtaEnabled(quota)).toBe(true);
      expect(primaryCtaAccessibilityHint(quota)).toBeNull();
    }
  );
});
