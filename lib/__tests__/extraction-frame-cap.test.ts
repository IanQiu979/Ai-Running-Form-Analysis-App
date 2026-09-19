/**
 * Regression locks for `lib/extraction-frame-cap.ts` — the module that decides how many frames
 * `app/capture/extracting.tsx` extracts from a video.
 *
 * WHY THIS FILE EXISTS. The screen shipped with `const EXTRACTION_TIER: PaceTier = 'free'`
 * hardcoded, so every Pro and Elite user's video was extracted down to Free's single frame.
 * Cadence and Elasticity are the two PACE pillars derived from motion over time and cannot be
 * scored from one still, so a paying user silently received a degraded version of the free
 * product. Nothing covered it, which is exactly how it shipped and stayed shipped.
 *
 * THE LOAD-BEARING PROPERTIES, in the order the acceptance criteria name them:
 *   1. A Pro/Elite quota response produces THAT tier's frame count, taken from the server's
 *      `frameCap` field — not looked up from a client-side per-tier table.
 *   2. Every failure — `unauthorized`, `quota_status_unavailable`, `unknown`, a timeout, or a
 *      contract-violating rejection — falls back to the FREE cap, and never to a higher one.
 *   3. A structurally-valid-but-nonsense `frameCap` (0, negative, NaN, fractional) is treated as
 *      a failure, not obeyed.
 *
 * THE `quota-status` ROUND TRIP THAT FEEDS THIS lives in `lib/analysis-preflight.ts` (one read,
 * two answers: this frame cap and whether the caller may start at all) and is covered by
 * `lib/__tests__/analysis-preflight.test.ts`. Only the pure decision is exercised here.
 *
 * `../supabase` is mocked because `lib/quota.ts` -> `lib/functions-client.ts` -> `lib/supabase.ts`
 * builds a real client from `EXPO_PUBLIC_*` at import time and throws when those are unset (as
 * they are under Jest) — same module-boundary mock `delete-account.test.ts` and `consent.test.ts`
 * already use. No test here touches it: every case injects a fake `QuotaStatusClient` instead,
 * which is the seam `lib/quota.ts` exposes `createQuotaStatusClient()` for.
 */
import { PACE_FRAME_CAP } from '@shared/pace';

import { FALLBACK_VIDEO_FRAME_CAP, resolveVideoFrameCap } from '../extraction-frame-cap';
import type { QuotaStatus, QuotaStatusClient, QuotaStatusErrorCode, QuotaStatusResult } from '../quota';

jest.mock('../supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

/**
 * A complete, well-formed `QuotaStatus` for a tier, with `frameCap` set to whatever the server
 * would really send for it. Every field is present because `resolveVideoFrameCap` receives the
 * already-parsed shape (`lib/quota.ts`'s `parseQuotaStatusResponse` has run), and a partial
 * fixture would let a regression that reads some OTHER field pass unnoticed.
 */
function quotaFor(tier: QuotaStatus['tier'], frameCap: number): QuotaStatus {
  return {
    tier,
    used: 0,
    limit: tier === 'free' ? 1 : 10,
    remaining: tier === 'free' ? 1 : 10,
    frameCap,
    unlimited: false,
    isLifetime: tier === 'free',
    periodStart: tier === 'free' ? null : '2026-07-01T00:00:00.000Z',
    periodEnd: tier === 'free' ? null : '2026-08-01T00:00:00.000Z',
    blocked: false,
    blockedReason: null,
    blockedUntil: null,
  };
}

function okResult(tier: QuotaStatus['tier'], frameCap: number): QuotaStatusResult {
  return { ok: true, data: quotaFor(tier, frameCap) };
}

function errorResult(code: QuotaStatusErrorCode): QuotaStatusResult {
  return { ok: false, error: { error: `simulated ${code}`, code } };
}

/** A fake `QuotaStatusClient` that resolves the given result — the injection seam in use. */
function clientResolving(result: QuotaStatusResult): QuotaStatusClient {
  return { fetch: jest.fn().mockResolvedValue(result) };
}

describe('FALLBACK_VIDEO_FRAME_CAP', () => {
  // The fallback must BE the free cap, sourced from @shared/pace — not a hand-written `1` that
  // could drift from what reserve_analysis enforces for free.
  it('is exactly the free tier cap from @shared/pace', () => {
    expect(FALLBACK_VIDEO_FRAME_CAP).toBe(PACE_FRAME_CAP.free);
    // 5 since issue #89 (2026-09-19): Free video runs Pro's stride burst. Still the SMALLEST cap
    // of the three, which is the property the fallback direction depends on.
    expect(FALLBACK_VIDEO_FRAME_CAP).toBe(5);
    expect(FALLBACK_VIDEO_FRAME_CAP).toBe(Math.min(PACE_FRAME_CAP.free, PACE_FRAME_CAP.pro, PACE_FRAME_CAP.elite));
  });
});

/** What the shipped bug collapsed every tier to: the free cap AS IT WAS when the bug shipped
 * (2026-07-26). Free's cap has since moved to Pro's burst (#89, 2026-09-19), so "not the free
 * cap" is no longer a meaningful lock for Pro — "not one frame" is what the bug actually did. */
const THE_SHIPPED_BUG_FRAME_COUNT = 1;

describe('resolveVideoFrameCap — the paid-tier path (the shipped bug)', () => {
  // THE headline regression lock. Before the fix this was 1 for every tier.
  it.each([
    ['pro', PACE_FRAME_CAP.pro],
    ['elite', PACE_FRAME_CAP.elite],
  ] as const)('gives a %s response its own frame count (%i), not a single frame', (tier, cap) => {
    expect(resolveVideoFrameCap(okResult(tier, cap))).toBe(cap);
    // Stated explicitly: the whole bug was this number collapsing to one frame.
    expect(resolveVideoFrameCap(okResult(tier, cap))).not.toBe(THE_SHIPPED_BUG_FRAME_COUNT);
  });

  // Issue #89 (2026-09-19): a Free video gets the same 5-frame stride burst as Pro. The number
  // still comes from the SERVER's `frameCap`; this only pins that a free response resolves to the
  // burst and no longer to a single frame.
  it('gives a free response its stride burst (5), not a single frame', () => {
    expect(resolveVideoFrameCap(okResult('free', PACE_FRAME_CAP.free))).toBe(5);
    expect(resolveVideoFrameCap(okResult('free', PACE_FRAME_CAP.free))).toBe(PACE_FRAME_CAP.pro);
  });

  // THE "read frameCap, do not look up tier" lock. The server is the authority: if it sends a
  // `frameCap` that disagrees with what this client's own table says the tier gets, the SERVER
  // wins. A regression that reimplemented this as `PACE_FRAME_CAP[quota.tier]` would return 5
  // here and fail — which is the point, since that implementation would also have silently
  // reintroduced a client-side authority over a paid entitlement.
  it("takes the server's frameCap even when it disagrees with the client's table for that tier", () => {
    expect(resolveVideoFrameCap(okResult('pro', 3))).toBe(3);
    expect(resolveVideoFrameCap(okResult('free', 4))).toBe(4);
  });
});

describe('resolveVideoFrameCap — the deliberate free-cap fallback', () => {
  // Every documented error code from lib/quota.ts's QuotaStatusErrorCode. None may produce a cap
  // above free: an unauthenticated or failed lookup tells us nothing about entitlement, so
  // assuming a paid cap would hand a signed-out or free user Elite's frame count on a blip.
  it.each(['unauthorized', 'quota_status_unavailable', 'unknown'] as const)(
    'falls back to the free cap on a %s error',
    (code) => {
      expect(resolveVideoFrameCap(errorResult(code))).toBe(FALLBACK_VIDEO_FRAME_CAP);
    }
  );

  // A structurally-valid response can still carry a number that is not a usable frame count.
  // `sampleTimestamps` throws a RangeError on a non-positive count, which would surface to the
  // user as a dead-end "extraction failed" screen — degrading to the free floor is both safer and
  // an honest statement of what we actually know.
  it.each([
    ['zero', 0],
    ['negative', -5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['fractional', 2.5],
  ] as const)('falls back to the free cap for a %s frameCap', (_label, frameCap) => {
    expect(resolveVideoFrameCap(okResult('pro', frameCap))).toBe(FALLBACK_VIDEO_FRAME_CAP);
  });

  // The sanity ceiling: mirrors the single GLOBAL cap analyze-form already enforces
  // (`flow.ts`: `if (frames.length > PACE_FRAME_CAP.elite)`), so an absurd server value cannot
  // turn into thousands of sequential on-device thumbnail calls for a submission the server would
  // reject anyway. A no-op for every honest value, asserted just below.
  it('clamps an absurd frameCap to the global elite ceiling rather than obeying it', () => {
    expect(resolveVideoFrameCap(okResult('elite', 10_000))).toBe(PACE_FRAME_CAP.elite);
  });

  it('never clamps a real tier cap — the ceiling is inert for every value the server really sends', () => {
    expect(resolveVideoFrameCap(okResult('free', PACE_FRAME_CAP.free))).toBe(PACE_FRAME_CAP.free);
    expect(resolveVideoFrameCap(okResult('pro', PACE_FRAME_CAP.pro))).toBe(PACE_FRAME_CAP.pro);
    expect(resolveVideoFrameCap(okResult('elite', PACE_FRAME_CAP.elite))).toBe(PACE_FRAME_CAP.elite);
  });

  // THE direction lock, stated as one property over every input this module can receive: nothing
  // resolves above the free cap unless a successful response explicitly said so.
  it('never resolves above the free cap for any non-success input', () => {
    const failures: QuotaStatusResult[] = [
      errorResult('unauthorized'),
      errorResult('quota_status_unavailable'),
      errorResult('unknown'),
      okResult('elite', 0),
      okResult('elite', -1),
      okResult('elite', Number.NaN),
    ];

    for (const failure of failures) {
      expect(resolveVideoFrameCap(failure)).toBeLessThanOrEqual(PACE_FRAME_CAP.free);
    }
  });
});
