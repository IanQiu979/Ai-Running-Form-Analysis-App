/**
 * The `analyze-form` client seam (issue #80) — request/response types matching
 * `docs/architecture.md`'s "Planned — analyze-form edge function flow" / "Planned — API" tables,
 * the injectable `AnalyzeFormClient` `app/analyzing.tsx` calls through, a dev-only mock
 * implementation, and the one-shot request handoff the screen reads from.
 *
 * `analyze-form` (issue #44) DOES NOT EXIST YET. Nothing in this file calls the Anthropic API, a
 * Supabase edge function, or any network endpoint — `analyzeFormClient` below is bound to the
 * mock so the Analyzing screen is runnable and reviewable today. #44 drops its real
 * implementation in by replacing that one binding at the bottom of this file; every type above it
 * is the seam and should not need to change. The real implementation will lean on issue #46's
 * shared `{ error, code }` unwrapper to turn `supabase.functions.invoke`'s generic
 * `FunctionsHttpError` into `AnalyzeFormClientResult`'s error branch — this file only declares
 * the shape that unwrapper must produce, it is not a substitute for #46's own shared helper.
 */

import type { PaceFrameSet } from '@/lib/frames';
import { PACE_PILLARS, type PacePillarId, type PacePillarResult, type PaceResult } from '@shared/pace';

export type AnalyzeFormMediaType = 'photo' | 'video';

/**
 * `POST /functions/v1/analyze-form`'s documented request body (`docs/architecture.md` "Planned —
 * API"): `{ mediaType, frames: [base64...], timestamps: number[], idempotencyKey }` — two
 * parallel arrays, not `PaceFrame[]`. This mirrors `lib/frames.ts`'s own header, which describes
 * its job as producing "the exact `{ frames: string[], timestamps: number[] }` pair analyze-form
 * expects." Build one from a freshly-extracted `PaceFrameSet` with `toAnalyzeFormRequest` below
 * rather than flattening the two arrays by hand at each call site.
 */
export interface AnalyzeFormRequest {
  mediaType: AnalyzeFormMediaType;
  frames: string[];
  timestamps: number[];
  /**
   * Reused verbatim across every attempt for the SAME analysis — including a client-side timeout
   * or a Retry tap — never re-minted client-side. `analyze-form` is idempotent on `(user_id,
   * idempotencyKey)` (`docs/architecture.md` step 4): a replayed call with the same key returns
   * the already-settled outcome instead of re-running the model, which is exactly what keeps a
   * client-side timeout followed by Retry from ever double-running the analysis or double-burning
   * quota. See `app/analyzing.tsx`'s Retry handler, which never generates a new key.
   */
  idempotencyKey: string;
}

/** Builds the wire-shaped request from `lib/frames.ts`'s `extractFrames()` output — the missing
 * glue between that file's `PaceFrameSet` and this one's `AnalyzeFormRequest`, which nothing
 * before issue #80 had a reason to write yet (no caller of `extractFrames()` existed). */
export function toAnalyzeFormRequest(
  mediaType: AnalyzeFormMediaType,
  frameSet: PaceFrameSet,
  idempotencyKey: string
): AnalyzeFormRequest {
  return {
    mediaType,
    frames: frameSet.frames.map((frame) => frame.base64),
    timestamps: frameSet.frames.map((frame) => frame.timestampMs),
    idempotencyKey,
  };
}

/**
 * The documented 200 response (`docs/architecture.md` "Planned — API"): `{ result, analysisId,
 * isFallback }`. A real success and an honest-partial fallback are the SAME shape — see
 * `@shared/pace`'s `PaceAnalysisOutcome` doc comment — differentiated only by `isFallback`, never
 * by a different response type. `app/analyzing.tsx` must route both to the result screen as a
 * result, never as a failure (issue #45).
 */
export interface AnalyzeFormSuccess {
  result: PaceResult;
  analysisId: string;
  isFallback: boolean;
}

/** Every non-2xx `analyze-form` response body (`docs/architecture.md` "Error contract": "every
 * non-2xx response body is structured `{ error, code }`"). `code` is what would route a `402` to
 * the paywall (#52) elsewhere in the app; this screen only displays `error`, but both fields are
 * part of the seam's contract regardless of which fields any one caller reads. */
export interface AnalyzeFormError {
  error: string;
  code: string;
}

export type AnalyzeFormClientResult =
  | { ok: true; data: AnalyzeFormSuccess }
  | { ok: false; error: AnalyzeFormError };

/**
 * The seam #44 drops its real implementation into. A conforming implementation:
 *  - resolves `{ ok: true, data }` for a 200 (a full success or an honest-partial fallback alike —
 *    see `AnalyzeFormSuccess` above);
 *  - resolves — never rejects — `{ ok: false, error }` for any DOCUMENTED non-2xx response (402
 *    over-quota, 403 anon, 503 spend-gate deny, a clean structural-validation failure, etc.) —
 *    this is exactly what issue #46's shared `{ error, code }` unwrapper exists to produce from
 *    `supabase.functions.invoke`'s generic `FunctionsHttpError`;
 *  - MAY reject (throw) only for a genuinely unexpected failure: no connectivity, a thrown
 *    exception before any response was ever received. `app/analyzing.tsx` folds a rejection into
 *    the same `analyzing.error.failed.*` copy as a documented error, because every analyze-form
 *    failure path releases the reservation before returning (`docs/architecture.md` step 9) — "this
 *    one wasn't counted against your quota" is accurate regardless of *why* the call failed, not
 *    only for a structural-validation failure specifically.
 */
export interface AnalyzeFormClient {
  submit(request: AnalyzeFormRequest): Promise<AnalyzeFormClientResult>;
}

// -------------------------------------------------------------------------------------------
// Dev mock — stands in for #44 so the Analyzing screen is runnable and reviewable today. Every
// branch the screen renders (success, honest-partial fallback, clean failure, and — by never
// resolving before the screen's own `ANALYZING_TIMEOUT_MS` — a timeout) is reachable by
// constructing a differently-configured mock; nothing here calls the Anthropic API, Supabase, or
// any edge function.
// -------------------------------------------------------------------------------------------

export type MockAnalyzeFormOutcome = 'success' | 'fallback' | 'failed' | 'timeout' | 'thrown';

export interface MockAnalyzeFormClientOptions {
  /** ms before resolving. Default sits past the honesty threshold (`ANALYZING_STEP_FLOOR_MS` *
   * `ANALYZING_STEP_KEYS.length` + `ANALYZING_LONG_WAIT_DELAY_MS` from `lib/analyzing-machine.ts`
   * — about 2.55s) so a manual review actually sees the step list settle into "Still analyzing"
   * before the mock resolves: the same shape a real 20-60s call produces, just compressed. */
  delayMs?: number;
  outcome?: MockAnalyzeFormOutcome;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A structurally-valid, clearly-fake pillar result — never mistakable for a real score, only
 * used by the mock client below. */
const MOCK_ASSESSED_PILLAR: PacePillarResult = {
  score: 78,
  band: 'good',
  feedback: '[Mock] Solid, upright posture through most of the stride.',
  flags: [],
  drills: [],
};

const MOCK_NOT_ASSESSED_PILLAR: PacePillarResult = {
  score: null,
  band: null,
  feedback: null,
  notAssessedReason: 'needsVideo',
  flags: [],
  drills: [],
};

/** Builds a structurally-valid `PaceResult` with exactly `assessedPillars` scored and the rest
 * `null`/"not assessed" — used for both the mock's `success` (all four) and `fallback` (two)
 * outcomes, so `isFallback: true` genuinely exercises the ≥2-pillar honest-partial shape (issue
 * #45), not a fabricated stand-in for it. */
function mockPaceResult(assessedPillars: readonly PacePillarId[]): PaceResult {
  const pillars = Object.fromEntries(
    PACE_PILLARS.map((id) => [
      id,
      assessedPillars.includes(id) ? MOCK_ASSESSED_PILLAR : MOCK_NOT_ASSESSED_PILLAR,
    ])
  ) as Record<PacePillarId, PacePillarResult>;

  return {
    pillars,
    overall: assessedPillars.length > 0 ? { score: 78, band: 'good' } : { score: null, band: null },
  };
}

/** Not a real UUID generator — good enough for a value that only ever flows into dev-only mock
 * navigation params, never persisted or compared against a real database row. */
function mockAnalysisId(): string {
  return `mock-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createMockAnalyzeFormClient(options: MockAnalyzeFormClientOptions = {}): AnalyzeFormClient {
  const delayMs = options.delayMs ?? 4000;
  const outcome = options.outcome ?? 'success';

  return {
    async submit(): Promise<AnalyzeFormClientResult> {
      if (outcome === 'timeout') {
        // Deliberately never resolves — exercises the SCREEN's own client-side timeout
        // (ANALYZING_TIMEOUT_MS) instead of the mock inventing a fake one of its own.
        return new Promise<AnalyzeFormClientResult>(() => {});
      }

      await wait(delayMs);

      switch (outcome) {
        case 'success':
          return {
            ok: true,
            data: { result: mockPaceResult(PACE_PILLARS), analysisId: mockAnalysisId(), isFallback: false },
          };
        case 'fallback':
          return {
            ok: true,
            data: {
              result: mockPaceResult(['posture', 'armSwing']),
              analysisId: mockAnalysisId(),
              isFallback: true,
            },
          };
        case 'failed':
          return {
            ok: false,
            error: {
              error: 'The analysis service did not return a usable result.',
              code: 'validation_failed',
            },
          };
        case 'thrown':
          throw new Error('Mock analyze-form failure (simulated network/unexpected error).');
      }
    },
  };
}

/**
 * The seam's current binding. #44 swaps this line for the real implementation once
 * `supabase/functions/analyze-form` exists and is deployed; nothing else in this file, and
 * nothing in `app/analyzing.tsx`, needs to change to pick it up.
 */
export const analyzeFormClient: AnalyzeFormClient = createMockAnalyzeFormClient();

// -------------------------------------------------------------------------------------------
// Pending-request handoff — a plain module-level mailbox, not a state-management store.
// `AnalyzeFormRequest` carries multiple megabytes of base64 frame data
// (`PACE_MAX_REQUEST_BODY_BYTES` in `@shared/pace`: "total request body ≤5MB"), far past what's
// sane to round-trip through expo-router's serialized route params. The closest existing
// precedent in this codebase (`lib/consent.ts`, `lib/session-provider.tsx`) is already "a plain
// module holding one piece of state," not a library — this follows the same shape.
// -------------------------------------------------------------------------------------------

let pendingRequest: AnalyzeFormRequest | null = null;

/** Called by the capture/upload flow (#36) immediately before navigating to `/analyzing`. */
export function setPendingAnalyzeFormRequest(request: AnalyzeFormRequest): void {
  pendingRequest = request;
}

/**
 * One-shot read: returns the pending request and clears it, so a later re-read (e.g. this
 * module surviving a fast-refresh, or a second screen instance) never replays a stale request.
 * `null` is the expected result of a direct/cold navigation to `/analyzing` with nothing staged —
 * module state does not survive a process kill, so this is also what a relaunch mid-analysis
 * looks like from here. Recovering THAT case is issue #64's job, not this screen's; see
 * `app/analyzing.tsx`'s handling of a `null` request, which just backs out rather than pretending
 * to still be waiting on a promise that no longer exists.
 */
export function takePendingAnalyzeFormRequest(): AnalyzeFormRequest | null {
  const request = pendingRequest;
  pendingRequest = null;
  return request;
}
