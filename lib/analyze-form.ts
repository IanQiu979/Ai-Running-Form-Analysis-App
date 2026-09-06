/**
 * The `analyze-form` client seam (issue #80) — request/response types matching
 * `docs/architecture.md`'s "Current — `analyze-form` edge function" section and "API" table,
 * the injectable `AnalyzeFormClient` `app/analyzing.tsx` calls through, a dev-only mock
 * implementation, and the one-shot request handoff the screen reads from.
 *
 * ⚠️ HISTORY, because it is the whole reason this file reads the way it does (issue #128, fixed
 * 2026-07-26): this file originally shipped bound to the mock, on the stated theory that #44
 * would "drop its real implementation in by replacing that one binding." #44 landed
 * `supabase/functions/analyze-form/` and never touched this file — its file list is entirely
 * under `supabase/functions/` — so the promised swap had no owner and never happened. The mock
 * stayed bound as the production client, and because it mints a `Crypto.randomUUID()` and writes
 * NO database row, every single upload in the real app dead-ended on `app/result/[id].tsx`'s "We
 * couldn't find this analysis." Verified live: `select count(*) from public.analyses` returned 0
 * rows, ever. This is the identical failure mode a security audit caught in
 * `lib/delete-account.ts` (PR #122, F1), and the fix here is deliberately the same one, so the
 * two seams stay recognizably one pattern rather than two:
 *   - `createAnalyzeFormClient()` below is the REAL client and is what `analyzeFormClient` binds;
 *   - the mock is kept, because the Analyzing screen's every branch is still worth exercising
 *     without a live model call, but it is DEV/TEST-ONLY and throws in a release bundle
 *     (`__DEV__` guard in `createMockAnalyzeFormClient`), so it can never silently become the
 *     production client again.
 *
 * The real client calls the `analyze-form` edge function through issue #46's shared
 * `invokeFunction` wrapper (`lib/functions-client.ts`) rather than `supabase.functions.invoke`
 * directly, per that file's own "every edge-function caller should go through this" rule: it
 * already owns the `FunctionsHttpError` → `{ error, code }` unwrap (a non-2xx body is only
 * reachable via `await error.context.json()`) and the `FunctionsRelayError`/`FunctionsFetchError`
 * distinction. What is left for THIS file is only what is specific to this endpoint: proving the
 * 200 body really is `{ result, analysisId, isFallback }` before handing it to the screen.
 */

import * as Crypto from 'expo-crypto';

import type { PaceFrameSet } from '@/lib/frames';
import { invokeFunction } from './functions-client';
import {
  isPaceAnalysisOutcome,
  PACE_PILLARS,
  type PacePillarId,
  type PacePillarResult,
  type PaceResult,
} from '@shared/pace';

export type AnalyzeFormMediaType = 'photo' | 'video';

/**
 * `POST /functions/v1/analyze-form`'s documented request body (`docs/architecture.md` "API"
 * table): `{ mediaType, frames: [base64...], timestamps: number[], idempotencyKey }` — two
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
 * The documented 200 response (`docs/architecture.md` "API" table): `{ result, analysisId,
 * isFallback }`, ONE shape for every tier (captain's ruling, 2026-09-06 — Free runs the same
 * model-backed, server-capped, persisted path Pro/Elite always have; there is no more
 * zero-model-call sample and no second response shape). A real success and an honest-partial
 * fallback are the SAME shape — see `@shared/pace`'s `PaceAnalysisOutcome` doc comment —
 * differentiated only by `isFallback`, never by a different response type. `app/analyzing.tsx`
 * routes every 200 to the result screen (issue #45).
 */
export type AnalyzeFormSuccess = { result: PaceResult; analysisId: string; isFallback: boolean };

/** Every non-2xx `analyze-form` response body (`docs/architecture.md` "Error contract": "every
 * non-2xx response body is structured `{ error, code }`"). `code` is what would route a `402` to
 * the paywall (#52) elsewhere in the app; this screen only displays `error`, but both fields are
 * part of the seam's contract regardless of which fields any one caller reads. */
export interface AnalyzeFormError {
  error: string;
  code: string;
  /** Only the 429 `zero_pillar_cooldown` sends one (`docs/architecture.md`'s status-code table).
   * `app/analyzing.tsx` turns it into the clock time its panel states; every other code leaves it
   * `undefined`, and no caller may invent one. */
  retryAfterSeconds?: number;
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
// The real client (issue #128). This is what `analyzeFormClient` binds and what a production
// build ships.
// -------------------------------------------------------------------------------------------

const EDGE_FUNCTION_NAME = 'analyze-form';

/**
 * The honest failure every path with no server-authored `code` collapses into: a relay/fetch
 * failure, a non-2xx body that wasn't the documented `{ error, code }` shape (e.g. a gateway
 * error page rather than this endpoint's JSON), or a 200 whose body didn't survive validation.
 *
 * The copy deliberately does NOT carry the "this one wasn't counted against your quota"
 * reassurance the rest of `app/analyzing.tsx` uses. That claim rests on `analyze-form` releasing
 * the reservation on every failure path (`docs/architecture.md` step 9), which is true for the
 * relay/fetch and unreadable-body branches — but NOT for the 200-we-couldn't-validate branch: there
 * the server settled the row and kept the quota, and only this client refused to render it. One
 * constant covers all three, so it must say something true on all three. It instead points at Past
 * Analyses, where a settled-but-unrendered analysis will in fact be waiting.
 *
 * `code` is `'unknown'` — this client's own bucket, never a fabricated server code — matching
 * `lib/delete-account.ts` and `lib/subscription.ts`'s identical convention. Nothing downstream
 * branches on it: `app/analyzing.tsx` only special-cases real server codes (`quota_exceeded` #136,
 * `previous_attempt_failed`), which reach it through the `'http'` branch.
 */
const UNKNOWN_ANALYZE_FORM_ERROR: AnalyzeFormError = {
  error: "Something went wrong running that analysis, and we couldn't show you a result. Check Past Analyses before trying again.",
  code: 'unknown',
};

/** Mirrors `app/result/[id].tsx`'s own route-param guard — see `parseAnalyzeFormSuccess`. */
const ANALYSIS_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Structural validation of the 200 body, in the same spirit as `lib/subscription.ts`'s
 * `parseQuotaStatus` and `lib/analysis-result.ts`'s `readAnalysisRow` — and reusing `@shared/pace`'s
 * own `isPaceAnalysisOutcome` for the `{ result, isFallback }` half rather than hand-rolling a
 * second, driftable copy of the pillar-shape check.
 *
 * `analysisId` is checked against the SAME `UUID_PATTERN`-shaped requirement `app/result/[id].tsx`
 * enforces on its route param, on purpose. That screen bails to "we couldn't find this analysis"
 * before it ever queries Supabase if the id isn't a UUID — which is precisely how issue #128's
 * mock produced a dead end. Rejecting a non-UUID id HERE turns that silent dead end into an honest
 * failure on the Analyzing screen, which at least offers a Retry.
 */
export function parseAnalyzeFormSuccess(raw: unknown): AnalyzeFormSuccess | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;

  // The retired `{ result, isSample: true }` shape (no `analysisId`/`isFallback`) is rejected here
  // by construction, not by a special case: it fails the `analysisId` check below, exactly like
  // any other malformed body. A server still shipping the old sample response would fail CLOSED
  // (this screen's generic failure copy), never render a stale fabricated result.
  const { analysisId } = body;
  if (typeof analysisId !== 'string' || !ANALYSIS_ID_PATTERN.test(analysisId)) return null;

  const outcome = { result: body.result, isFallback: body.isFallback };
  if (!isPaceAnalysisOutcome(outcome)) return null;

  return { result: outcome.result, analysisId, isFallback: outcome.isFallback };
}

/**
 * Calls the real `analyze-form` edge function. Resolves — never rejects — for every documented
 * outcome, exactly as `AnalyzeFormClient`'s contract above requires, because `invokeFunction` is
 * itself guaranteed never to reject.
 *
 * The `'http'` branch passes the server's `code` through VERBATIM and unnarrowed. That is
 * deliberate and differs from `lib/delete-account.ts`, which whitelists its three codes: this
 * endpoint's code set is both large and still growing (`quota_exceeded`, `frame_cap_exceeded`,
 * `too_many_failed_attempts`, `validation_failed`, `consent_required`, `misconfigured`,
 * `internal_error`, …), and `app/analyzing.tsx` already treats an unrecognized code as a plain
 * failure. Whitelisting here would mean a newly-added server code silently degrading into
 * `'unknown'` and losing, say, a future paywall route — the exact coupling issue #136 had to undo
 * once already.
 */
async function submitToEdgeFunction(request: AnalyzeFormRequest): Promise<AnalyzeFormClientResult> {
  const result = await invokeFunction(EDGE_FUNCTION_NAME, {
    method: 'POST',
    body: request,
  });

  if (result.ok) {
    const success = parseAnalyzeFormSuccess(result.data);
    if (success) return { ok: true, data: success };
    // A 200 we can't prove the shape of is not a result we can render — and navigating to an
    // unvalidated `analysisId` is how #128 dead-ended in the first place.
    return { ok: false, error: UNKNOWN_ANALYZE_FORM_ERROR };
  }

  if (result.error.kind === 'http') {
    return {
      ok: false,
      error: {
        error: result.error.error,
        code: result.error.code,
        retryAfterSeconds: result.error.retryAfterSeconds,
      },
    };
  }

  // 'network' (no response was ever produced or relayed) and 'malformed' (a response arrived with
  // no readable `{ error, code }`) both carry no server-authored code to report.
  return { ok: false, error: UNKNOWN_ANALYZE_FORM_ERROR };
}

/** The real client. Bound below as `analyzeFormClient` — the binding a production build ships. */
export function createAnalyzeFormClient(): AnalyzeFormClient {
  return { submit: submitToEdgeFunction };
}

// -------------------------------------------------------------------------------------------
// Dev/test-only mock — stands in for a live model call so the Analyzing screen is runnable and
// reviewable without one. Every
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

/**
 * A REAL UUID, deliberately — do not "simplify" this back to a `mock-…` string.
 *
 * It used to return `mock-${Date.now()}-${random}`, on the stated assumption that a mock id is
 * "never compared against a real database row." That assumption was false, and it silently broke
 * the entire dev happy path: `app/result/[id].tsx` guards its route param with a strict
 * `UUID_PATTERN` regex and bails to the "we couldn't find this analysis" state before it ever
 * queries Supabase. So the mock's SUCCESS path landed the user on a not-found screen — the core
 * flow #135 had just connected still dead-ended one screen later, and every Maestro happy-path
 * assertion (#86) failed against it. Found by the #86 E2E lane, 2026-07-13.
 *
 * `Crypto.randomUUID()` (expo-crypto, already a dependency) is what `app/capture/extracting.tsx`
 * already uses to mint the idempotency key, so this adds nothing and matches the existing idiom.
 */
function mockAnalysisId(): string {
  return Crypto.randomUUID();
}

/**
 * ⚠️ ISSUE #128's TRIPWIRE, and the direct counterpart of `createMockDeleteAccountClient`'s. This
 * mock existing at all is what let this file ship bound to it with no owner for the swap to a real
 * client — see this file's header. `__DEV__` is `true` under Metro's dev server and under Jest
 * (`react-native/jest/setup.js` sets it explicitly, which is what keeps this suite's own tests able
 * to construct the mock at all) and `false` in any release/production JS bundle, so this throws at
 * the first call to `submit()` in exactly the build where fabricating an analysis id that no
 * database row backs would matter — belt-and-suspenders alongside `analyzeFormClient` below now
 * being bound to the real client, not this one.
 *
 * The throw is placed inside `submit()` rather than at construction time on purpose: the `timeout`
 * outcome deliberately never resolves, so a guard placed after that branch would be unreachable
 * for precisely the configuration whose whole job is to hang forever.
 */
export function createMockAnalyzeFormClient(options: MockAnalyzeFormClientOptions = {}): AnalyzeFormClient {
  const delayMs = options.delayMs ?? 4000;
  const outcome = options.outcome ?? 'success';

  return {
    async submit(): Promise<AnalyzeFormClientResult> {
      if (!__DEV__) {
        throw new Error(
          'createMockAnalyzeFormClient() must never run outside a dev/test build. ' +
            'analyzeFormClient must be bound to createAnalyzeFormClient() in production.'
        );
      }

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
            data: {
              result: mockPaceResult(PACE_PILLARS),
              analysisId: mockAnalysisId(),
              isFallback: false,
            },
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
 * The seam's binding. THIS IS NOW THE REAL CLIENT — issue #128, fixed 2026-07-26: submitting a
 * photo or video calls the actual `analyze-form` edge function, which reserves a row, runs the
 * model, and settles that row to `status: 'delivered'` BEFORE returning the `analysisId` this
 * client hands to `app/analyzing.tsx`. That ordering is the entire fix: `app/result/[id].tsx`
 * queries `public.analyses` by that id, so the row must already exist when the navigation happens.
 *
 * Do not rebind this to the mock to make something pass locally — a mock bound here is invisible
 * in review and was the production bug. Construct `createMockAnalyzeFormClient()` explicitly at
 * the call site that needs it instead (which is what the tests do).
 */
export const analyzeFormClient: AnalyzeFormClient = createAnalyzeFormClient();

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
