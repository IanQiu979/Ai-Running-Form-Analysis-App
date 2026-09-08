/**
 * Regression locks for `lib/analysis-preflight.ts` — the ONE bounded `quota-status` read taken
 * before any analysis work starts, and the two answers it yields.
 *
 * WHY THIS FILE EXISTS. Both refusals that can end an analysis — the allowance cap and issue #6's
 * anti-farm cooldown — are enforced inside `reserve_analysis`, which the server does not reach
 * until the client has already extracted frames and submitted them. So a capped or cooling-down
 * runner filmed, waited through extraction, waited again on the Analyzing screen, and only then
 * learned they were never eligible — under copy that told them their analysis had FAILED, beside a
 * Retry button that resubmitted into the identical refusal. This module is the pre-flight that
 * ends that; these are the properties that must not rot.
 *
 * THE LOAD-BEARING PROPERTIES:
 *   1. A `blocked` reading refuses UP FRONT and carries `blockedUntil`, so the message can state
 *      how long is left.
 *   2. A used-up allowance refuses up front as `exhausted`, naming the tier the paywall needs.
 *   3. COOLDOWN OUTRANKS EXHAUSTED, matching the order `reserve_analysis` itself tests them in —
 *      otherwise the pre-flight would name a different reason than the server would.
 *   4. EVERY failure fails OPEN. A cooldown is a claim about someone's account; we make it only
 *      when the server said so. A blip, a timeout, or a broken client hands the decision back to
 *      `reserve_analysis` rather than inventing a refusal.
 *   5. The frame cap still resolves off the same single read (the `fetchVideoFrameCap` behaviour
 *      this module absorbed), so the pre-flight costs no extra round trip on the video path.
 *
 * `../supabase` is mocked because `lib/quota.ts` -> `lib/functions-client.ts` -> `lib/supabase.ts`
 * builds a real client from `EXPO_PUBLIC_*` at import time and throws when those are unset (as
 * they are under Jest) — the same module-boundary mock `extraction-frame-cap.test.ts` uses. No
 * test here touches it: every case injects a fake `QuotaStatusClient`.
 */
import { PACE_FRAME_CAP } from '@shared/pace';

import {
  fetchAnalysisPreflight,
  QUOTA_WAIT_TIMEOUT_MS,
  resolveAnalysisGate,
} from '../analysis-preflight';
import { describeCooldownRemaining } from '../cooldown-remaining';
import { FALLBACK_VIDEO_FRAME_CAP } from '../extraction-frame-cap';
import type { QuotaStatus, QuotaStatusClient, QuotaStatusErrorCode, QuotaStatusResult } from '../quota';

jest.mock('../supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

/** A complete, well-formed `QuotaStatus`. Every field is present because `resolveAnalysisGate`
 *  receives the already-parsed shape, and a partial fixture would let a regression that reads
 *  some OTHER field pass unnoticed. */
function quotaFor(overrides: Partial<QuotaStatus> = {}): QuotaStatus {
  return {
    tier: 'free',
    used: 0,
    limit: 1,
    remaining: 1,
    frameCap: PACE_FRAME_CAP.free,
    unlimited: false,
    isLifetime: true,
    periodStart: null,
    periodEnd: null,
    blocked: false,
    blockedReason: null,
    blockedUntil: null,
    ...overrides,
  };
}

function okResult(overrides: Partial<QuotaStatus> = {}): QuotaStatusResult {
  return { ok: true, data: quotaFor(overrides) };
}

function errorResult(code: QuotaStatusErrorCode): QuotaStatusResult {
  return { ok: false, error: { error: `simulated ${code}`, code } };
}

function clientResolving(result: QuotaStatusResult): QuotaStatusClient {
  return { fetch: jest.fn().mockResolvedValue(result) };
}

const BLOCKED_UNTIL = '2026-09-08T12:00:00.000Z';

describe('resolveAnalysisGate — the cooldown', () => {
  it('refuses a blocked reading and carries the expiry so the message can state it', () => {
    const gate = resolveAnalysisGate(
      okResult({ blocked: true, blockedReason: 'too_many_failed_attempts', blockedUntil: BLOCKED_UNTIL })
    );

    expect(gate).toEqual({ kind: 'cooldown', blockedUntil: BLOCKED_UNTIL });
  });

  // `pace_quota_status` only ever emits `too_many_failed_attempts`, but a reading that says
  // "blocked" under some reason this client does not recognise is still a refusal the server will
  // make. Letting it through would put the user back on the burn-a-wait-then-be-refused path.
  it('still refuses when `blocked` is true but the reason did not survive parsing', () => {
    const gate = resolveAnalysisGate(okResult({ blocked: true, blockedReason: null, blockedUntil: null }));

    expect(gate).toEqual({ kind: 'cooldown', blockedUntil: null });
  });

  // `reserve_analysis` tests the anti-farm counter BEFORE the quota cap, so a caller who is both
  // gets `too_many_failed_attempts` from the server. A pre-flight that named the cap instead would
  // send them to the paywall to buy something that would not unblock them.
  it('reports the cooldown ahead of an exhausted allowance, matching reserve_analysis', () => {
    const gate = resolveAnalysisGate(
      okResult({ remaining: 0, blocked: true, blockedReason: 'too_many_failed_attempts', blockedUntil: BLOCKED_UNTIL })
    );

    expect(gate.kind).toBe('cooldown');
  });
});

describe('resolveAnalysisGate — the allowance cap', () => {
  it('refuses a Free reading whose one lifetime analysis is used', () => {
    expect(resolveAnalysisGate(okResult({ tier: 'free', used: 1, limit: 1, remaining: 0 }))).toEqual({
      kind: 'exhausted',
      tier: 'free',
    });
  });

  it('refuses an exhausted paid period and names the tier the paywall needs', () => {
    expect(
      resolveAnalysisGate(okResult({ tier: 'pro', used: 10, limit: 10, remaining: 0, isLifetime: false }))
    ).toEqual({ kind: 'exhausted', tier: 'pro' });
  });

  it('allows a reading with allowance left', () => {
    expect(resolveAnalysisGate(okResult({ remaining: 1 })).kind).toBe('allowed');
  });

  // `unlimited` readings carry `remaining: null` by contract and can never be exhausted — the
  // comprehensive-test override (`ALL_USERS_UNLIMITED_ACCESS`) is exactly this shape.
  it('never refuses an unlimited reading, whose remaining is null by contract', () => {
    expect(
      resolveAnalysisGate(okResult({ unlimited: true, limit: null, remaining: null, isLifetime: false })).kind
    ).toBe('allowed');
  });
});

describe('resolveAnalysisGate — failing open', () => {
  // The whole honesty rule in one place: "you are in a cooldown" is a claim about someone's
  // account, and we may only make it when the server actually said so.
  it.each<QuotaStatusErrorCode>(['unauthorized', 'quota_status_unavailable', 'unknown'])(
    'allows through a %s failure rather than inventing a refusal',
    (code) => {
      expect(resolveAnalysisGate(errorResult(code)).kind).toBe('allowed');
    }
  );
});

describe('fetchAnalysisPreflight', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the gate and the frame cap from ONE round trip', async () => {
    const client = clientResolving(okResult({ tier: 'elite', frameCap: PACE_FRAME_CAP.elite, remaining: 30 }));

    await expect(fetchAnalysisPreflight(client)).resolves.toEqual({
      gate: { kind: 'allowed' },
      frameCap: PACE_FRAME_CAP.elite,
    });
    expect(client.fetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces a cooldown without a second call', async () => {
    const client = clientResolving(
      okResult({ blocked: true, blockedReason: 'too_many_failed_attempts', blockedUntil: BLOCKED_UNTIL })
    );

    const { gate } = await fetchAnalysisPreflight(client);

    expect(gate).toEqual({ kind: 'cooldown', blockedUntil: BLOCKED_UNTIL });
    expect(client.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns the free cap when the client reports an error', async () => {
    const client = clientResolving(errorResult('quota_status_unavailable'));

    await expect(fetchAnalysisPreflight(client)).resolves.toEqual({
      gate: { kind: 'allowed' },
      frameCap: FALLBACK_VIDEO_FRAME_CAP,
    });
  });

  // Degrading a paying user to one frame is not free: the result honestly reports that only one
  // frame could be analysed, so a single flaky request costs them the analysis they paid for. A
  // retryable failure gets one more attempt before we accept that.
  it('retries once and honours the paid cap when the first lookup fails transiently', async () => {
    const fetch = jest
      .fn<Promise<QuotaStatusResult>, []>()
      .mockResolvedValueOnce(errorResult('quota_status_unavailable'))
      .mockResolvedValueOnce(okResult({ tier: 'pro', frameCap: PACE_FRAME_CAP.pro, remaining: 10 }));

    await expect(fetchAnalysisPreflight({ fetch })).resolves.toEqual({
      gate: { kind: 'allowed' },
      frameCap: PACE_FRAME_CAP.pro,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('still degrades to the free cap when BOTH attempts fail', async () => {
    const fetch = jest
      .fn<Promise<QuotaStatusResult>, []>()
      .mockResolvedValue(errorResult('quota_status_unavailable'));

    await expect(fetchAnalysisPreflight({ fetch })).resolves.toEqual({
      gate: { kind: 'allowed' },
      frameCap: FALLBACK_VIDEO_FRAME_CAP,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  // `unauthorized` is a settled answer about the caller, not a blip — asking again cannot change
  // it, and a second round trip would only delay the extraction screen.
  it('does NOT retry an unauthorized lookup', async () => {
    const fetch = jest.fn<Promise<QuotaStatusResult>, []>().mockResolvedValue(errorResult('unauthorized'));

    await expect(fetchAnalysisPreflight({ fetch })).resolves.toEqual({
      gate: { kind: 'allowed' },
      frameCap: FALLBACK_VIDEO_FRAME_CAP,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // "Do not block the UI indefinitely on a network call." A hung quota-status must degrade the
  // frame count and skip the gate, not strand the screen on a spinner that never advances.
  it('stops waiting after QUOTA_WAIT_TIMEOUT_MS and fails open', async () => {
    jest.useFakeTimers();
    const client: QuotaStatusClient = { fetch: jest.fn(() => new Promise<QuotaStatusResult>(() => {})) };

    const pending = fetchAnalysisPreflight(client);
    await jest.advanceTimersByTimeAsync(QUOTA_WAIT_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({
      gate: { kind: 'allowed' },
      frameCap: FALLBACK_VIDEO_FRAME_CAP,
    });
  });

  // The race must not fire early: a response that arrives comfortably inside the window is
  // honoured in full, so a paying user on a merely-slowish connection still gets their frames.
  it('honours a paid cap that arrives before the timeout', async () => {
    jest.useFakeTimers();
    const client: QuotaStatusClient = {
      fetch: jest.fn(
        () =>
          new Promise<QuotaStatusResult>((resolve) => {
            setTimeout(
              () => resolve(okResult({ tier: 'pro', frameCap: PACE_FRAME_CAP.pro, remaining: 10 })),
              QUOTA_WAIT_TIMEOUT_MS - 1_000
            );
          })
      ),
    };

    const pending = fetchAnalysisPreflight(client);
    await jest.advanceTimersByTimeAsync(QUOTA_WAIT_TIMEOUT_MS - 1_000);

    await expect(pending).resolves.toEqual({ gate: { kind: 'allowed' }, frameCap: PACE_FRAME_CAP.pro });
  });

  // Defence in depth, not a live path: QuotaStatusClient's contract is that it resolves and never
  // rejects. If one ever did, the rejection must not escape to the extraction screen's own
  // `.catch`, where it would render a dead-end "extraction failed" instead of simply proceeding.
  it('fails open when a client violates its contract and rejects', async () => {
    const client: QuotaStatusClient = { fetch: jest.fn().mockRejectedValue(new Error('boom')) };

    await expect(fetchAnalysisPreflight(client)).resolves.toEqual({
      gate: { kind: 'allowed' },
      frameCap: FALLBACK_VIDEO_FRAME_CAP,
    });
  });
});

describe('describeCooldownRemaining', () => {
  const NOW = Date.parse('2026-09-07T12:00:00.000Z');

  function inMs(ms: number): string {
    return new Date(NOW + ms).toISOString();
  }

  it.each([
    [30 * 1000, 'under a minute'],
    [60 * 1000, 'about a minute'],
    [20 * 60 * 1000, 'about 20 minutes'],
    [90 * 60 * 1000, 'about 2 hours'],
    [23 * 60 * 60 * 1000, 'about 23 hours'],
    [36 * 60 * 60 * 1000, 'about 2 days'],
  ])('describes %d ms left as "%s"', (ms, expected) => {
    expect(describeCooldownRemaining(inMs(ms), NOW)).toBe(expected);
  });

  // The three "we do not know" cases. Every one must return null so the caller states the pause
  // WITHOUT naming a time, rather than printing "0 minutes" or guessing.
  it('returns null when the server sent no expiry', () => {
    expect(describeCooldownRemaining(null, NOW)).toBeNull();
  });

  it('returns null for an unparsable expiry', () => {
    expect(describeCooldownRemaining('not a date', NOW)).toBeNull();
  });

  // A stale reading whose expiry has passed is NOT evidence the cooldown lifted — only
  // `reserve_analysis` can say that — so it degrades to the no-time-known wording.
  it('returns null for an expiry already in the past', () => {
    expect(describeCooldownRemaining(inMs(-60_000), NOW)).toBeNull();
  });
});
