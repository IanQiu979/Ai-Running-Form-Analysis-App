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
 * `../supabase` is mocked because `lib/quota.ts` -> `lib/functions-client.ts` -> `lib/supabase.ts`
 * builds a real client from `EXPO_PUBLIC_*` at import time and throws when those are unset (as
 * they are under Jest) — same module-boundary mock `delete-account.test.ts` and `consent.test.ts`
 * already use. No test here touches it: every case injects a fake `QuotaStatusClient` instead,
 * which is the seam `lib/quota.ts` exposes `createQuotaStatusClient()` for.
 */
import { PACE_FRAME_CAP } from '@shared/pace';

import {
  FALLBACK_VIDEO_FRAME_CAP,
  fetchVideoFrameCap,
  QUOTA_WAIT_TIMEOUT_MS,
  resolveVideoFrameCap,
} from '../extraction-frame-cap';
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
    expect(FALLBACK_VIDEO_FRAME_CAP).toBe(1);
  });
});

describe('resolveVideoFrameCap — the paid-tier path (the shipped bug)', () => {
  // THE headline regression lock. Before the fix this was 1 for every tier.
  it.each([
    ['pro', PACE_FRAME_CAP.pro],
    ['elite', PACE_FRAME_CAP.elite],
  ] as const)('gives a %s response its own frame count (%i), not the free cap', (tier, cap) => {
    expect(resolveVideoFrameCap(okResult(tier, cap))).toBe(cap);
    // Stated explicitly: the whole bug was this number collapsing to the free cap.
    expect(resolveVideoFrameCap(okResult(tier, cap))).not.toBe(PACE_FRAME_CAP.free);
  });

  it('leaves a free response at one frame per video, unchanged', () => {
    expect(resolveVideoFrameCap(okResult('free', PACE_FRAME_CAP.free))).toBe(1);
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

describe('fetchVideoFrameCap', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the paid cap the injected client reports', async () => {
    const client = clientResolving(okResult('elite', PACE_FRAME_CAP.elite));

    await expect(fetchVideoFrameCap(client)).resolves.toBe(PACE_FRAME_CAP.elite);
    expect(client.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns the free cap when the client reports an error', async () => {
    const client = clientResolving(errorResult('quota_status_unavailable'));

    await expect(fetchVideoFrameCap(client)).resolves.toBe(FALLBACK_VIDEO_FRAME_CAP);
  });

  // "Do not block the UI indefinitely on a network call." A hung quota-status must degrade the
  // frame count, not strand the screen on a spinner that never advances.
  it('stops waiting after QUOTA_WAIT_TIMEOUT_MS and falls back to the free cap', async () => {
    jest.useFakeTimers();
    // Never resolves on its own — the real behavior of a hung request.
    const client: QuotaStatusClient = { fetch: jest.fn(() => new Promise<QuotaStatusResult>(() => {})) };

    const capPromise = fetchVideoFrameCap(client);
    await jest.advanceTimersByTimeAsync(QUOTA_WAIT_TIMEOUT_MS);

    await expect(capPromise).resolves.toBe(FALLBACK_VIDEO_FRAME_CAP);
  });

  // The race must not fire early: a response that arrives comfortably inside the window is
  // honoured in full, so a paying user on a merely-slowish connection still gets their frames.
  it('honours a paid cap that arrives before the timeout', async () => {
    jest.useFakeTimers();
    const client: QuotaStatusClient = {
      fetch: jest.fn(
        () =>
          new Promise<QuotaStatusResult>((resolve) => {
            setTimeout(() => resolve(okResult('pro', PACE_FRAME_CAP.pro)), QUOTA_WAIT_TIMEOUT_MS - 1_000);
          })
      ),
    };

    const capPromise = fetchVideoFrameCap(client);
    await jest.advanceTimersByTimeAsync(QUOTA_WAIT_TIMEOUT_MS - 1_000);

    await expect(capPromise).resolves.toBe(PACE_FRAME_CAP.pro);
  });

  // Defence in depth, not a live path: QuotaStatusClient's contract is that it resolves and never
  // rejects. If one ever did, the rejection must not escape to the extraction screen's own
  // `.catch`, where it would render a dead-end "extraction failed" instead of simply extracting
  // at the free cap.
  it('falls back to the free cap when a client violates its contract and rejects', async () => {
    const client: QuotaStatusClient = { fetch: jest.fn().mockRejectedValue(new Error('boom')) };

    await expect(fetchVideoFrameCap(client)).resolves.toBe(FALLBACK_VIDEO_FRAME_CAP);
  });
});
