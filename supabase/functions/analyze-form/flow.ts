/**
 * `POST /functions/v1/analyze-form` — the core of the product (issue #44), and the decision half
 * of issue #45. Nothing else in this app matters until a side-on clip returns an honest,
 * certified, well-parsed result.
 *
 * This file is the ORCHESTRATION, deliberately free of every `npm:`/Deno-only import (the same
 * split `ai-guard.ts`, `delete-analysis.ts`, and `quota-status.ts` already use): it takes injected
 * dependencies and is fully unit-testable with fakes, no network, and — critically — ZERO
 * Anthropic spend. `deps.ts` holds the real Deno wiring; `index.ts` is HTTP/auth glue only.
 *
 * ══ THE CALL ORDER IS THE CONTRACT ══════════════════════════════════════════════════════════
 *
 *   auth → consent → AI GATE → idempotency + quota reserve → model call (+1 retry)
 *        → settle → upload frames → attach ... and on any failure: release
 *
 * Every arrow is load-bearing and each has a named failure mode. In order:
 *
 * 1. AUTH (in `index.ts`, not here). `callerUserId` arrives already verified against Supabase Auth
 *    via `auth.getUser()` — a real round trip, not a local decode. **This function NEVER reads a
 *    user id from the request body**, and there is no field in the body it could read one from.
 *    `p_user_id` on every RPC below is that JWT-derived id. The reserve/settle/release RPCs trust
 *    `p_user_id` as a plain argument by design (they are `service_role`-only and do no independent
 *    check), so taking it from the body would forge reservations into another user's quota
 *    (`docs/status.md` Known Issue #14).
 *
 * 2. CONSENT. Refuse outright for a user with no recorded `upload.health.v1` grant. The client's
 *    `<ConsentGate />` is UX and is bypassable by calling this endpoint directly — THIS is the
 *    control. A missing row, a `granted = false` row, AND a query error all mean refuse; see
 *    `checkConsent()`. Skip it and the app processes Art. 9 health data with no legal basis.
 *
 * 3. AI SPEND GATE, before idempotency and before the reserve — not after (#91's binding call
 *    order). If the gate ran after the reserve, every kill-switch/cap/breaker denial would have to
 *    release a reservation, and released rows once counted against the 3-strike anti-farming cap:
 *    three outages would lock out a legitimate user for something we did. Gating first means a
 *    denied request never creates a reservation at all.
 *
 * 4/5. IDEMPOTENCY + ATOMIC RESERVE, both inside `reserve_analysis` (one round trip, one advisory
 *    lock). We branch on the returned `status`, never on `allowed` alone — see `handleExisting()`.
 *
 * 6-8. PROMPT → ONE VISION CALL → validate → retry once. `analyze-form-prompt.ts` (#41) builds the
 *    request; `analyze-form-validation.ts` (#45) reads the response and decides. Neither judges
 *    content.
 *
 * 9. SETTLE, THEN UPLOAD, THEN ATTACH — in that order, and only on a deliverable outcome (#130).
 *    THE INVARIANT: a 'reserved' row can never have frames. Frames go up only after the row has
 *    left 'reserved' for 'delivered', which is what makes an orphan impossible — a crash or a
 *    refused settle leaves a 'reserved' row with an empty bucket, so #47's SQL-only sweep has
 *    nothing to purge and needs no Storage access. `attach_media_paths` then records the paths;
 *    everything after the settle is NON-FATAL (see `safeAttachFrames`), because by then the
 *    analysis is delivered and the quota is spent. Still never upload before the reserve either
 *    (#88): a rejected or failed analysis must leave NOTHING in the bucket.
 *
 * ══ RELEASE AND RECORD ARE `finally`, NOT BRANCHES ══════════════════════════════════════════
 *
 * The two obligations that silently rot the system when a branch forgets them —
 * `release_analysis` on every failure path (an unreleased `'reserved'` row eats a quota slot
 * FOREVER) and `recordAiCall` on every exit path after a successful gate (an unsettled
 * `'pending'` row eats daily-cap headroom until it ages out) — are implemented so that **no
 * branch can forget them, because no branch performs them.**
 *
 * There is exactly ONE call site for each, both in the `finally` block at the bottom of
 * `runAnalyzeForm`. The body of the function never releases and never records; it only sets the
 * INTENT (`releaseReason`, and each open call's status), and the `finally` flushes it. A path that
 * forgets to set an intent still releases (default `'internal_error'`) and still records (default
 * `'cancelled'` if the model was never called, `'model_error'` if it was). An unexpected throw —
 * the case a hand-written `catch` chain always misses — takes the same path. This is the strongest
 * form of the requirement available in the language, and it is why these are not four scattered
 * `await release(...)` calls.
 */

import {
  gateAiCall,
  gateDenyResponseBody,
  httpStatusForGateDeny,
  recordAiCall,
  type RecordCallStatus,
  type RpcClient,
} from '../_shared/ai-guard.ts';
import { estimateTokensForCall } from '../_shared/ai-pricing.ts';
import {
  buildAnalyzeFormRequest,
  type AnalyzeFormRequest as AnthropicRequest,
  type PaceFrame,
  type PaceMediaKind,
} from '../_shared/analyze-form-prompt.ts';
import {
  callFailedAttempt,
  decideOutcome,
  readAttempt,
  type AnalyzeFormDecision,
  type AnthropicMessageResponse,
  type AttemptOutcome,
  type ReleaseReason,
} from '../_shared/analyze-form-validation.ts';
import { DEFAULT_PAGE_SIZE, purgePrefix, type StorageBucket } from '../_shared/delete-analysis.ts';
import {
  PACE_FRAME_CAP,
  PACE_MAX_REQUEST_BODY_BYTES,
  isPaceResult,
  type PaceResult,
  type PaceTier,
} from '../_shared/pace.ts';

// -------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------

/**
 * The consent this endpoint requires (`public.consents.consent_key`). An INLINE COPY of
 * `lib/consent.ts`'s `UPLOAD_HEALTH_CONSENT`, not an import of it: `lib/` is outside the
 * `supabase functions deploy` bundle and Deno cannot resolve the app's `@/*` alias, so an import
 * is not merely undesirable here, it is impossible. The version lives IN the key — consent to one
 * wording is not consent to a later one, so a reworded deck mints `...v2` and this check
 * automatically fails closed for every user until they re-tick.
 */
export const UPLOAD_HEALTH_CONSENT_KEY = 'upload.health.v1';

/**
 * Wall-clock budget for ALL model work in one request, measured from the moment the reserve
 * lands. Sized against two ceilings that are not ours to move:
 *   - the client gives up at `ANALYZING_TIMEOUT_MS` = 120s (`lib/analyzing-machine.ts`);
 *   - Supabase's edge runtime has its own wall-clock limit above that.
 * 105s leaves ~15s of headroom under the client's timeout for the DB round trips, the frame
 * uploads, and the response itself — so a request that is going to fail does so as OUR structured
 * `{ error, code }` (with the reservation released and the ledger settled), rather than as the
 * client's blind timeout, which leaves the row `'reserved'` until #47's sweep.
 */
export const ANALYZE_FORM_DEADLINE_MS = 105_000;

/** Per-attempt ceiling. Two attempts cannot both run at this length inside the deadline — that is
 * intentional: attempt 1 is allowed to be slow (8 frames, adaptive thinking), and the retry then
 * takes whatever is genuinely left. */
export const MODEL_CALL_TIMEOUT_MS = 65_000;

/** Below this much remaining budget, the retry is skipped rather than started and aborted
 * mid-flight. A call we cut off at 8s is a call we pay for and cannot use — strictly worse than
 * falling back on what attempt 1 already gave us. */
export const MIN_RETRY_BUDGET_MS = 20_000;

/** The client sends raw base64 with no per-frame media type (`lib/analyze-form.ts`'s wire shape is
 * `frames: string[]`), and `lib/frames.ts` emits JPEG at q≈0.7. Both the vision call and the
 * Storage upload therefore assume JPEG. If the extractor ever emits another format, the wire
 * contract has to carry it — it cannot be sniffed here without decoding every frame. */
const FRAME_MEDIA_TYPE = 'image/jpeg';
const FRAME_EXTENSION = 'jpg';

/** Anything that is not `A-Za-z0-9+/` with at most two `=` of padding is not base64 we can send.
 * Checked as a STRING (cheap, no allocation) rather than by decoding 5MB up front just to throw it
 * away — the decode happens once, at upload time. */
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

// -------------------------------------------------------------------------------------------
// Injected dependencies
// -------------------------------------------------------------------------------------------

/** Reads `public.consents`. MUST throw (not return `null`) on a query error — `checkConsent()`
 * treats a throw and a missing row identically: refuse. Fail-closed is the whole point. */
export interface ConsentReader {
  /** The newest `granted` for this (user, key), or `null` when the user has never answered. */
  latestGrant(userId: string, consentKey: string): Promise<boolean | null>;
}

/** What `analyze-form` needs from the private `media` bucket: it uploads frames, and — when an
 * attach refuses because the row is gone — purges the prefix it just wrote (#130). `list`/`remove`
 * come from `StorageBucket`, the same shape `deleteAnalysis` and `delete-account` already use, so
 * `purgePrefix` can be reused verbatim rather than reimplemented.
 *
 * The client has no INSERT on `storage.objects` at all (#88), so this is the only way a frame ever
 * lands. */
export interface FrameStorage extends StorageBucket {
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<{ error: string | null }>;
}

export type ModelCallResult =
  | { ok: true; response: AnthropicMessageResponse }
  | { ok: false; kind: 'timeout' | 'error'; message: string };

/** One Anthropic Messages call. NEVER throws — a transport failure is a typed value, so a missed
 * `catch` cannot turn a provider blip into a 500 with a stranded reservation. */
export interface ModelCaller {
  send(request: AnthropicRequest, timeoutMs: number): Promise<ModelCallResult>;
}

/** One structured line per request. Model id, tokens, latency, whether it retried, whether it fell
 * back — without these you cannot tell a prompt regression from a provider incident. */
export interface AnalyzeFormLogEvent {
  event: 'analyze-form';
  userId: string;
  analysisId: string | null;
  tier: PaceTier | null;
  mediaType: PaceMediaKind | null;
  frameCount: number | null;
  attempts: number;
  retried: boolean;
  outcome: string;
  isFallback: boolean;
  releaseReason: ReleaseReason | null;
  stopReasons: (string | null)[];
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  framesUploaded: number;
  latencyMs: number;
  status: number;
}

export interface AnalyzeFormDeps {
  /** Service-role RPC client — `gate_ai_call`, `record_ai_call`, `reserve_analysis`,
   * `settle_analysis`, and `release_analysis` are ALL granted to `service_role` only. Never build
   * this from the caller's JWT: it would simply fail, which is the DB doing its job. */
  rpc: RpcClient;
  consents: ConsentReader;
  storage: FrameStorage;
  model: ModelCaller;
  now?: () => number;
  log?: (event: AnalyzeFormLogEvent) => void;
}

export interface AnalyzeFormHttpResponse {
  status: number;
  body: Record<string, unknown>;
}

// -------------------------------------------------------------------------------------------
// Request body — the wire shape from `lib/analyze-form.ts` (#80). NO `mediaPaths` (#88).
// -------------------------------------------------------------------------------------------

interface ParsedRequest {
  mediaType: PaceMediaKind;
  frames: PaceFrame[];
  idempotencyKey: string;
}

type ParseResult =
  | { ok: true; request: ParsedRequest }
  /** `code` defaults to `'invalid_request'` at the call site; a rejection that the client should be
   * able to distinguish (e.g. `'too_many_frames'`) sets its own. */
  | { ok: false; code?: string; message: string };

/**
 * Structural validation of the request body. Note what the PER-TIER frame cap is NOT: the exact
 * tier limit (Free 1 / Pro 5 / Elite 8) and the photo-must-be-one-frame rule are business rules,
 * and `reserve_analysis` (`SECURITY DEFINER`, service-role) is their sole authority (CLAUDE.md:
 * "No business rules in the client" — and this function is not the authority either). Re-deriving
 * the exact per-tier limit here would create a second, drifting copy.
 *
 * What IS enforced here is a single GLOBAL frame-count ceiling — `PACE_FRAME_CAP.elite`, the most
 * any tier could ever legitimately send. That is not a business rule, it is a DoS bound. Because
 * the spend gate runs BEFORE the reserve (#91's ordering), an unbounded frame count lets a caller
 * whose quota is already spent send ~2000 tiny valid-base64 frames: `estimateTokensForCall(2000,
 * 'elite')` is ~$9.9, which `gate_ai_call` holds against the live $10 daily cap as a `'pending'`
 * row for the whole request lifetime. The reserve then denies and the `finally` cancels the
 * hold at $0 real spend — but sustained with light concurrency it keeps the GLOBAL cap saturated
 * and every legitimate analysis gets a `daily_cap` 503. Capping at 8 bounds that pre-reserve
 * estimate to ~$0.23. A Free user sending 8 frames still gets `frame_cap_exceeded` from the
 * reserve; this ceiling only stops the pathological case before it can reserve gate budget.
 */
function parseRequestBody(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: 'Request body must be a JSON object.' };
  }
  const body = raw as Record<string, unknown>;

  const mediaType = body.mediaType;
  if (mediaType !== 'photo' && mediaType !== 'video') {
    return { ok: false, message: 'mediaType must be "photo" or "video".' };
  }

  const idempotencyKey = body.idempotencyKey;
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
    return { ok: false, message: 'idempotencyKey must be a non-empty string.' };
  }

  const frames = body.frames;
  const timestamps = body.timestamps;
  if (!Array.isArray(frames) || frames.length === 0) {
    return { ok: false, message: 'frames must be a non-empty array of base64 strings.' };
  }
  // Global DoS ceiling — reject an over-count BEFORE the per-frame loop, the gate, or the reserve,
  // so a 2000-frame payload never reserves gate budget. Not the per-tier business rule (that is
  // reserve_analysis's job); just the largest count any tier could ever legitimately produce.
  if (frames.length > PACE_FRAME_CAP.elite) {
    return {
      ok: false,
      code: 'too_many_frames',
      message: `A submission may include at most ${PACE_FRAME_CAP.elite} frames; got ${frames.length}.`,
    };
  }
  if (!Array.isArray(timestamps) || timestamps.length !== frames.length) {
    return {
      ok: false,
      message: 'timestamps must be an array of the same length as frames.',
    };
  }

  let totalBytes = 0;
  const parsedFrames: PaceFrame[] = [];

  for (let i = 0; i < frames.length; i += 1) {
    const base64 = frames[i];
    const timestamp = timestamps[i];

    if (typeof base64 !== 'string' || base64.length === 0) {
      return { ok: false, message: `frames[${i}] must be a non-empty base64 string.` };
    }
    if (base64.startsWith('data:')) {
      return {
        ok: false,
        message: `frames[${i}] carries a "data:" URI prefix; send raw base64 only.`,
      };
    }
    if (base64.length % 4 !== 0 || !BASE64_RE.test(base64)) {
      return { ok: false, message: `frames[${i}] is not valid base64.` };
    }
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0) {
      return { ok: false, message: `timestamps[${i}] must be a finite, non-negative number.` };
    }

    totalBytes += base64.length;
    parsedFrames.push({
      base64,
      mediaType: FRAME_MEDIA_TYPE,
      // Named `requestedTimestampMs`, not `timestampMs`, all the way down: these are the times the
      // client ASKED the decoder for, not the times of the frames it got back (issue #112). The
      // prompt is what has to say so; this layer's only job is to not silently rename them.
      requestedTimestampMs: timestamp,
    });
  }

  // Re-checked server-side, exactly as `docs/architecture.md`'s media pipeline requires — the
  // client's own check (`lib/frames.ts`'s `assertWithinBudget`) is a courtesy, not a control.
  if (totalBytes > PACE_MAX_REQUEST_BODY_BYTES) {
    return {
      ok: false,
      message: `Frame payload is ${totalBytes} bytes; the maximum is ${PACE_MAX_REQUEST_BODY_BYTES}.`,
    };
  }

  return { ok: true, request: { mediaType, frames: parsedFrames, idempotencyKey } };
}

// -------------------------------------------------------------------------------------------
// RPC shapes
// -------------------------------------------------------------------------------------------

interface ReserveResult {
  allowed: boolean;
  existing?: boolean;
  id?: string;
  status?: string;
  tier?: PaceTier;
  result?: unknown;
  is_fallback?: boolean;
  reason?: string;
  [key: string]: unknown;
}

async function reserveAnalysis(
  rpc: RpcClient,
  args: { userId: string; idempotencyKey: string; mediaType: PaceMediaKind; frameCount: number }
): Promise<ReserveResult> {
  const { data, error } = await rpc.rpc('reserve_analysis', {
    // CONTRACT RULE 1 — `p_user_id` is the JWT-derived id, threaded down from `index.ts`'s
    // `auth.getUser()`. There is no code path by which a request body can influence it.
    p_user_id: args.userId,
    p_idempotency_key: args.idempotencyKey,
    p_media_type: args.mediaType,
    p_frame_count: args.frameCount,
    // Four args, not five: `p_media_paths` was dropped by #88. The client never names a storage
    // path, and the frames are not in the bucket yet — they are uploaded, by us, after the model
    // call succeeds.
  });
  if (error) {
    throw new Error(`reserve_analysis failed: ${error.message}`);
  }
  return data as ReserveResult;
}

async function settleAnalysis(
  rpc: RpcClient,
  args: {
    userId: string;
    analysisId: string;
    result: PaceResult;
    isFallback: boolean;
  }
): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await rpc.rpc('settle_analysis', {
    p_user_id: args.userId,
    p_analysis_id: args.analysisId,
    p_result: args.result,
    p_is_fallback: args.isFallback,
    // FOUR args, not five (#130). `p_media_paths` still exists on the RPC and still defaults to
    // '{}' — we simply have nothing to pass it, because nothing has been uploaded yet. The frames
    // go up AFTER this call succeeds and `attach_media_paths` records them. THE INVARIANT: a
    // 'reserved' row can never have frames.
  });
  if (error) {
    throw new Error(`settle_analysis failed: ${error.message}`);
  }
  return data as { ok: boolean; reason?: string };
}

async function attachMediaPaths(
  rpc: RpcClient,
  args: { userId: string; analysisId: string; mediaPaths: string[] }
): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await rpc.rpc('attach_media_paths', {
    p_user_id: args.userId,
    p_analysis_id: args.analysisId,
    // Namespace-guarded inside the RPC exactly as `settle_analysis` is — it rejects the whole call
    // rather than dropping a foreign path — and we pass only the paths that ACTUALLY landed, so
    // `media_paths` never names an object that does not exist.
    p_media_paths: args.mediaPaths,
  });
  if (error) {
    throw new Error(`attach_media_paths failed: ${error.message}`);
  }
  return data as { ok: boolean; reason?: string };
}

// -------------------------------------------------------------------------------------------
// Responses
// -------------------------------------------------------------------------------------------

function fail(status: number, code: string, error: string): AnalyzeFormHttpResponse {
  return { status, body: { error, code } };
}

/**
 * `reserve_analysis`'s refusal reasons → HTTP. `quota_exceeded` is the only 402 (it is the one the
 * paywall, #52, routes on). `too_many_failed_attempts` is a 429, deliberately NOT a 402: it is a
 * throttle that clears on its own (a rolling 24h window on free, per
 * `20260712220000_anti_farm_release_reason_fix.sql`), and selling an upgrade to a user we just
 * rate-limited would be both wrong and useless.
 */
function reserveDenialResponse(reserve: ReserveResult): AnalyzeFormHttpResponse {
  const reason = typeof reserve.reason === 'string' ? reserve.reason : 'reserve_denied';

  switch (reason) {
    case 'quota_exceeded':
      return {
        status: 402,
        body: {
          error: "You've used all the analyses on your plan for this period.",
          code: 'quota_exceeded',
          tier: reserve.tier,
          used: reserve.used,
          limit: reserve.limit,
        },
      };
    case 'too_many_failed_attempts':
      return {
        status: 429,
        body: {
          error: 'Too many analyses failed recently. Please try again a little later.',
          code: 'too_many_failed_attempts',
          tier: reserve.tier,
        },
      };
    case 'frame_cap_exceeded':
      return {
        status: 400,
        body: {
          error: 'This clip has more frames than your plan allows.',
          code: 'frame_cap_exceeded',
          tier: reserve.tier,
          frameCap: reserve.frame_cap,
        },
      };
    default:
      // invalid_idempotency_key / invalid_frame_count / invalid_frame_count_for_photo — all of
      // them mean the client built a request it should never have built.
      return fail(400, reason, 'That request could not be accepted. Please try again.');
  }
}

/**
 * CONTRACT RULE 2 — branch on `status`, never on `allowed` alone.
 *
 * `reserve_analysis` returns `allowed: true, existing: true` for ANY row it finds under this
 * `(user_id, idempotency_key)`, whatever state that row is in. The row being real is not the same
 * as the row being deliverable:
 *
 *   - `'delivered'` — the genuine idempotent replay. Return the STORED result as-is. No model
 *     call, no second charge, no second quota burn. (Unless it has since been soft-deleted, in
 *     which case its `result` was redacted to NULL by the trigger in
 *     `20260712040000_analyses_quota_soft_delete.sql` — `isPaceResult` catches that and we return
 *     410 rather than a 200 carrying `result: null`, which would crash the result screen.)
 *
 *   - `'released'` — a PREVIOUS attempt under this key failed and handed its reservation back.
 *     The row is real; nothing may be delivered against it as if it were a fresh reservation. This
 *     is the exact case the M1 review flagged: `allowed: true`, and yet the correct answer is "no".
 *     The client must mint a NEW idempotency key to try again — the same key can never succeed,
 *     because `reserve_analysis` will keep finding this same released row.
 *
 *   - `'reserved'` — a reservation under this key is IN FLIGHT (or was orphaned by a crashed
 *     invocation). We refuse rather than run a second model call against it. The dominant cause is
 *     the benign one: this call takes 20-60s, the client gives up at 120s and offers Retry, and
 *     `app/analyzing.tsx` deliberately reuses the same idempotency key — so "resuming" here would
 *     double-bill Anthropic on every slow analysis, for a row that the first invocation is about to
 *     settle anyway. The server finishes and persists regardless of whether the client is still
 *     listening ("backgrounding recovery"), so the honest answer is "still running, check back",
 *     not a second $0.05 call. The orphaned-by-a-crash case is real but rare and is #47's job (the
 *     stale-`reserved` sweep); it is not worth double-billing every slow request to paper over.
 */
function handleExisting(reserve: ReserveResult): AnalyzeFormHttpResponse {
  const status = reserve.status;

  if (status === 'delivered') {
    if (!isPaceResult(reserve.result)) {
      // Delivered, but the stored result is gone — the row was soft-deleted and redacted. There is
      // nothing to replay.
      return fail(
        410,
        'analysis_deleted',
        'That analysis has been deleted. Submit a new one to get a fresh result.'
      );
    }
    return {
      status: 200,
      body: {
        result: reserve.result,
        analysisId: reserve.id,
        isFallback: Boolean(reserve.is_fallback),
      },
    };
  }

  if (status === 'released') {
    return fail(
      409,
      'previous_attempt_failed',
      'A previous attempt at this analysis did not complete. Start a new analysis to try again.'
    );
  }

  // 'reserved' — and any status this function has not been taught about, which is treated the same
  // way on purpose: an unknown state is never a deliverable one.
  return fail(
    409,
    'analysis_in_progress',
    'This analysis is still running. It will appear in your past analyses when it finishes.'
  );
}

// -------------------------------------------------------------------------------------------
// The flow
// -------------------------------------------------------------------------------------------

/**
 * One row in `ai_call_log`, reserved by `gateAiCall()` and awaiting `recordAiCall()`.
 *
 * `attemptIndex` is the whole design. Each gated call is ONE Anthropic request, and it is settled
 * with the outcome of THAT request — not with the outcome of the request as a whole. When attempt 1
 * returns prose and the retry succeeds, call 1 settles `'validation_failed'` and call 2 settles
 * `'success'`. Settling both as `'success'` (because "the request worked in the end") would be
 * two separate bugs at once: the circuit breaker opens only when the last N settled calls ALL carry
 * `'model_error'`/`'validation_failed'`, so a masked failure makes it under-react to a real model
 * degradation; and `record_ai_call` bills `actual_usd` from the token counts handed to it, so the
 * wrong attempt's usage lands on the wrong row.
 *
 * `null` means the call was gated but never issued — a retry we decided to skip, or a request we
 * abandoned at the quota check. Nothing happened, nothing failed: `'cancelled'`, settled at $0.
 */
interface OpenCall {
  attemptIndex: number | null;
}

export async function runAnalyzeForm(
  deps: AnalyzeFormDeps,
  params: { callerUserId: string; rawBody: unknown }
): Promise<AnalyzeFormHttpResponse> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const { callerUserId } = params;

  // --- The two `finally` obligations, as state. Nothing below this line calls release or record.
  let reservation: string | null = null;
  let reservationSettled = false;
  let releaseReason: ReleaseReason = 'internal_error';
  const openCalls = new Map<string, OpenCall>();

  // --- Observability accumulators.
  const attempts: AttemptOutcome[] = [];
  let tier: PaceTier | null = null;
  let mediaType: PaceMediaKind | null = null;
  let frameCount: number | null = null;
  let framesUploaded = 0;
  let isFallback = false;
  let outcome = 'unknown';
  let decision: AnalyzeFormDecision | null = null;
  let response: AnalyzeFormHttpResponse | undefined;

  try {
    // ── 0. Request shape ───────────────────────────────────────────────────────────────────
    const parsed = parseRequestBody(params.rawBody);
    if (!parsed.ok) {
      const code = parsed.code ?? 'invalid_request';
      outcome = code;
      return (response = fail(400, code, parsed.message));
    }
    const request = parsed.request;
    mediaType = request.mediaType;
    frameCount = request.frames.length;

    // ── 2. Consent — before any work, any spend, and any row. ──────────────────────────────
    const consented = await checkConsent(deps, callerUserId);
    if (!consented) {
      outcome = 'consent_required';
      return (response = fail(
        403,
        'consent_required',
        'You need to agree to the upload consent before an analysis can run.'
      ));
    }

    // ── 3. AI spend gate — BEFORE idempotency and reserve (#91's binding order). ────────────
    //
    // The tier is not known yet (only `reserve_analysis` may decide it), so the pre-call estimate
    // is made at the WORST case: elite's 8k output budget. That errs strictly toward reserving too
    // much headroom, which `ai-pricing.ts` names as the intended direction of error — the gate is a
    // ceiling, not an accountant, and `record_ai_call` settles the real cost from real token counts
    // moments later. The retry's gate, below, knows the true tier and uses it.
    const firstEstimate = estimateTokensForCall(request.frames.length, 'elite');
    const gate = await gateAiCall(deps.rpc, {
      userId: callerUserId,
      estimatedInputTokens: firstEstimate.inputTokens,
      estimatedOutputTokens: firstEstimate.outputTokens,
    });
    if (!gate.allowed) {
      // `gate.detail` is deliberately NOT forwarded to the client. On a `daily_cap` denial it
      // carries `spent_usd` / `cap_usd` — our operational AI spend and our ceiling — and on
      // `killed` it carries the operator's `disabled_reason`. None of that is the caller's
      // business, and any authenticated user could read it just by tripping the cap. The client
      // needs `code` (to pick the right copy) and nothing more; the detail is logged server-side,
      // where it belongs.
      console.error(
        `analyze-form: AI gate denied (${gate.reason})`,
        JSON.stringify(gate.detail ?? {})
      );
      outcome = `gate_${gate.reason}`;
      return (response = {
        status: httpStatusForGateDeny(gate.reason),
        body: gateDenyResponseBody(gate.reason) as unknown as Record<string, unknown>,
      });
    }
    openCalls.set(gate.callId, { attemptIndex: null });

    // ── 4/5. Idempotency + atomic reserve, in one RPC. ─────────────────────────────────────
    const reserve = await reserveAnalysis(deps.rpc, {
      userId: callerUserId,
      idempotencyKey: request.idempotencyKey,
      mediaType: request.mediaType,
      frameCount: request.frames.length,
    });

    if (!reserve.allowed) {
      // No reservation was created, so there is nothing to release. The gate's `'pending'` row is
      // settled as `'cancelled'` by the `finally` — the model was never going to be called, so it
      // is not a failure and must not feed the circuit breaker.
      outcome = String(reserve.reason ?? 'reserve_denied');
      return (response = reserveDenialResponse(reserve));
    }

    tier = reserve.tier ?? null;

    if (reserve.existing) {
      // CONTRACT RULE 2 lives here. `allowed: true` is not permission to deliver.
      outcome = `existing_${reserve.status}`;
      return (response = handleExisting(reserve));
    }

    const analysisId = reserve.id;
    if (typeof analysisId !== 'string' || !tier) {
      throw new Error('reserve_analysis returned an allowed reservation with no id or tier.');
    }
    // From this line on, a row exists in state `'reserved'`. Every exit path below — return, throw,
    // or fall-through — passes through the `finally`, which releases it unless it was settled.
    reservation = analysisId;

    // ── 6/7. The grounded prompt (#41). Server-derived tier; never the client's word for it. ──
    const anthropicRequest = buildAnalyzeFormRequest({
      tier,
      media: request.mediaType,
      frames: request.frames,
    });

    // ── 8. One vision call, then — on any failure — exactly one retry. ─────────────────────
    const deadline = startedAt + ANALYZE_FORM_DEADLINE_MS;

    const first = await callModel(deps, anthropicRequest, openCalls, gate.callId, 0, deadline, now);
    attempts.push(first.attempt);
    if (first.timedOut) {
      releaseReason = 'provider_timeout';
    }

    // Did the model get its full second chance? This is the signal `decideOutcome` needs to tell a
    // genuine farmer (asked twice, refused twice) from OUR suppressed-retry degradation (attempt 1
    // failed, but WE cut the retry — too little deadline left, or its spend gate denied it). Only
    // the former may release as the anti-farming `'validation_failed'`; the latter is `'model_error'`
    // and must not tick the user's 3-strike cap for something we did (issue #6).
    let retryRan = false;

    if (!first.attempt.result) {
      const remaining = deadline - now();
      if (remaining >= MIN_RETRY_BUDGET_MS) {
        // A SECOND Anthropic request is a second billed call, so it gets its OWN gate — the daily
        // cap and the circuit breaker must both see it. This gate necessarily runs after the
        // reserve (the retry could not exist before it); the ordering contract is about the FIRST
        // gate, which ran before any row was created. A denial here is not a failure: we simply
        // stop calling and fall through to whatever attempt 1 gave us, which may still be a
        // perfectly deliverable honest partial.
        const retryEstimate = estimateTokensForCall(request.frames.length, tier);
        const retryGate = await gateAiCall(deps.rpc, {
          userId: callerUserId,
          estimatedInputTokens: retryEstimate.inputTokens,
          estimatedOutputTokens: retryEstimate.outputTokens,
          analysisId,
        });

        if (retryGate.allowed) {
          openCalls.set(retryGate.callId, { attemptIndex: null });
          const second = await callModel(
            deps,
            anthropicRequest,
            openCalls,
            retryGate.callId,
            1,
            deadline,
            now
          );
          attempts.push(second.attempt);
          // The retry genuinely happened — the model was asked a second time. This, and ONLY this,
          // is what lets a two-content-failure pair be classified as the farming signal.
          retryRan = true;
          if (second.timedOut) {
            releaseReason = 'provider_timeout';
          }
        } else {
          // We suppressed the retry (daily cap / open breaker). `retryRan` stays false: a content
          // failure on attempt 1 alone is our fault now, not a farming signal.
          console.error(`analyze-form: retry gated out (${retryGate.reason})`);
        }
      }
      // (else: `remaining < MIN_RETRY_BUDGET_MS` — we skipped the retry to avoid paying for a call
      // we'd have to abort. `retryRan` stays false for the same reason.)
    }

    // ── 9. The decision (#45). Never fabricate a score. ────────────────────────────────────
    decision = decideOutcome(attempts, retryRan);

    if (decision.kind === 'failed') {
      // A timeout already claimed `releaseReason` above and outranks the classifier: `decideOutcome`
      // cannot see that an abort happened, only that no usable response arrived, so it says
      // `'model_error'`. Both are server-fault and neither counts against the anti-farming cap, so
      // the distinction is purely for honest observability — but it is free to keep.
      if (releaseReason !== 'provider_timeout') {
        releaseReason = decision.releaseReason;
      }
      outcome = `failed_${releaseReason}`;

      if (releaseReason === 'validation_failed') {
        return (response = fail(
          422,
          'validation_failed',
          'The analysis service did not return a usable result. This one has not been counted against your quota.'
        ));
      }
      return (response = fail(
        503,
        releaseReason,
        'The analysis service is having trouble right now. This one has not been counted against your quota — please try again shortly.'
      ));
    }

    isFallback = decision.kind === 'partial';

    // ── 10. Settle FIRST, then upload. Never the other way round (#130). ──────────────────────
    //
    // THE INVARIANT: a 'reserved' row can never have frames. Frames go up only once the row is
    // 'delivered'. That is what makes an orphaned object impossible:
    //
    //   * killed before the settle -> 'reserved' row, ZERO frames uploaded. `sweep_stale_
    //     reservations()` (#47) reclaims the row and has nothing to purge — which is precisely why
    //     that sweep needs no Storage access at all.
    //   * settle REFUSES           -> we throw, the `finally` releases, and again nothing was
    //     uploaded. This is the leak the old upload-then-settle order had that needed NO CRASH: a
    //     late replay or a concurrent duplicate makes `settle_analysis` return
    //     `not_reserved_or_not_found` AFTER the frames are already in the bucket, and the released
    //     row never names them. No sweep could ever have reached those objects — the sweep only
    //     touches rows still stuck in 'reserved'.
    //   * killed mid-upload        -> 'delivered' row whose frames sit under its OWN prefix, where
    //     deletion finds them anyway. Purge walks the PREFIX, never `media_paths`.
    //
    // THE PRICE: a delivered row can carry an empty or short `media_paths`. That shortens the Past
    // Analyses frame strip (#55) and nothing else — `media_paths` is the DISPLAY list, never the
    // deletion authority.
    const settled = await settleAnalysis(deps.rpc, {
      userId: callerUserId,
      analysisId,
      result: decision.result,
      isFallback,
    });

    if (!settled.ok) {
      // The row was not in `'reserved'` when we got here. Nothing was delivered and — the whole
      // point of the new ordering — nothing was uploaded. The `finally` releases (a no-op if
      // something else already moved the row) and we do not pretend otherwise.
      throw new Error(`settle_analysis refused: ${settled.reason ?? 'unknown'}`);
    }

    reservationSettled = true;
    outcome = isFallback ? 'partial' : 'success';

    // Everything from here on is NON-FATAL. The analysis is delivered and the quota is spent.
    framesUploaded = await safeAttachFrames(deps, callerUserId, analysisId, request.frames);

    return (response = {
      status: 200,
      body: { result: decision.result, analysisId, isFallback },
    });
  } catch (err) {
    // Our own bug, or an RPC that hard-failed. Never the user's fault, and never a farming signal:
    // `releaseReason` stays/becomes `'internal_error'`, which `pace_is_farming_signal` excludes.
    console.error('analyze-form: unhandled failure', err instanceof Error ? err.message : err);
    releaseReason = releaseReason === 'provider_timeout' ? releaseReason : 'internal_error';
    // `decision` stays whatever it was — most likely `null`, so every issued call settles as its
    // own failure and every un-issued one as `'cancelled'`. We do NOT overwrite it: if we crashed
    // in the settle AFTER a good model call, that call really did succeed and should be billed and
    // reported as such. The reservation is still released, because the user never got the result.
    outcome = `error_${releaseReason}`;
    return (response = fail(
      500,
      'internal_error',
      'Something went wrong running that analysis. This one has not been counted against your quota.'
    ));
  } finally {
    // ══ THE ONLY release_analysis AND recordAiCall CALL SITES IN THIS FILE ══════════════════
    // Every path above — every `return`, every `throw`, every fall-through — arrives here. That is
    // the point: a branch cannot forget an obligation it does not perform.

    for (const [callId, call] of openCalls) {
      await safeRecord(
        deps.rpc,
        callId,
        statusForCall(call, attempts, decision),
        reservation,
        usageForCall(call, attempts)
      );
    }

    if (reservation && !reservationSettled) {
      await safeRelease(deps.rpc, callerUserId, reservation, releaseReason);
    }

    // Observability must never be able to break the request it is describing: a throw from here
    // would escape the `finally` and mask the real response (and the `catch` above has already run).
    try {
      deps.log?.({
        event: 'analyze-form',
        userId: callerUserId,
        analysisId: reservation,
        tier,
        mediaType,
        frameCount,
        attempts: attempts.length,
        retried: attempts.length > 1,
        outcome,
        isFallback,
        releaseReason: reservation && !reservationSettled ? releaseReason : null,
        stopReasons: attempts.map((attempt) => attempt.stopReason),
        inputTokens: sumUsage(attempts, 'input_tokens'),
        outputTokens: sumUsage(attempts, 'output_tokens'),
        cacheReadInputTokens: sumUsage(attempts, 'cache_read_input_tokens'),
        cacheCreationInputTokens: sumUsage(attempts, 'cache_creation_input_tokens'),
        framesUploaded,
        latencyMs: now() - startedAt,
        status: response?.status ?? 500,
      });
    } catch (logErr) {
      console.error('analyze-form: log sink threw', logErr instanceof Error ? logErr.message : logErr);
    }
  }
}

// -------------------------------------------------------------------------------------------
// Steps
// -------------------------------------------------------------------------------------------

/**
 * CONTRACT RULE 4. A missing row, a `granted = false` row, AND a query error all mean REFUSE.
 * The catch is not defensive tidiness — it IS the rule: if we cannot prove consent, we do not have
 * it, and processing Art. 9 health data without it has no legal basis.
 */
async function checkConsent(deps: AnalyzeFormDeps, userId: string): Promise<boolean> {
  try {
    const granted = await deps.consents.latestGrant(userId, UPLOAD_HEALTH_CONSENT_KEY);
    return granted === true;
  } catch (err) {
    console.error(
      'analyze-form: consent lookup failed, refusing',
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

async function callModel(
  deps: AnalyzeFormDeps,
  request: AnthropicRequest,
  openCalls: Map<string, OpenCall>,
  callId: string,
  attemptIndex: number,
  deadline: number,
  now: () => number
): Promise<{ attempt: AttemptOutcome; timedOut: boolean }> {
  const budget = Math.min(MODEL_CALL_TIMEOUT_MS, Math.max(0, deadline - now()));

  // Bind this ledger row to this attempt BEFORE the request goes out. From here on the call is
  // billable and is no longer a `'cancelled'` — a cancelled call is one that never happened — and
  // if we die mid-flight the `finally` still settles it against whatever this attempt turned out to
  // be.
  const call = openCalls.get(callId);
  if (call) {
    call.attemptIndex = attemptIndex;
  }

  const result = await deps.model.send(request, budget);

  if (!result.ok) {
    console.error(`analyze-form: model call ${result.kind}: ${result.message}`);
    return { attempt: callFailedAttempt(), timedOut: result.kind === 'timeout' };
  }

  return { attempt: readAttempt(result.response), timedOut: false };
}

/**
 * Upload the frames, record them on the ALREADY-DELIVERED row, and — if that row turned out to be
 * gone — purge what we just wrote. NEVER THROWS (#130).
 *
 * By the time this runs, `settle_analysis` has succeeded: the analysis is delivered and the user's
 * quota is spent. A throw from here would land in `runAnalyzeForm`'s `catch` and turn a delivered,
 * charged analysis into a 500 the user cannot retry — a failure the old settle-last ordering made
 * structurally impossible and this ordering has to close by hand. Same discipline as the `finally`
 * helpers below: it must never be able to break the request it is decorating.
 *
 * THE PURGE (the delete-during-upload window). `deleteAnalysis` purges Storage BEFORE it marks the
 * row deleted. Under this file's settle-first ordering the row is 'delivered', and therefore
 * DELETABLE, while we are still uploading — so a user who deletes mid-upload gets their prefix
 * walked, and then our remaining frames land in it, stranded, with the per-analysis purge already
 * spent. `attach_media_paths` refusing with `row_deleted`/`not_found` IS that signal: nothing will
 * ever name these objects, so we purge the prefix ourselves. We must NOT purge on
 * `already_attached` — there the paths are recorded on a live row, and removing them would destroy
 * a working analysis's frame strip.
 *
 * Returns the number of frames that landed and STAYED, for the observability line.
 */
async function safeAttachFrames(
  deps: AnalyzeFormDeps,
  userId: string,
  analysisId: string,
  frames: PaceFrame[]
): Promise<number> {
  const prefix = `${userId}/${analysisId}/`;

  try {
    const mediaPaths = await uploadFrames(deps, userId, analysisId, frames);
    if (mediaPaths.length === 0) {
      // A total storage outage. The row keeps `media_paths = '{}'`: the frame strip is empty, the
      // analysis is intact, and we never name an object that does not exist.
      return 0;
    }

    const attached = await attachMediaPaths(deps.rpc, { userId, analysisId, mediaPaths });
    if (attached.ok) {
      return mediaPaths.length;
    }

    if (attached.reason === 'row_deleted' || attached.reason === 'not_found') {
      // The row is gone. Everything we just uploaded is an orphan — including whatever the user's
      // own delete already walked past. Purge by PREFIX, never by `mediaPaths`: a partial upload
      // means our list is not the authority on what is actually under there.
      const purged = await purgePrefix(deps.storage, prefix, DEFAULT_PAGE_SIZE);
      console.error(
        `analyze-form: analysis ${analysisId} was ${attached.reason} mid-upload — purged ${purged} orphaned object(s)`
      );
      return 0;
    }

    // `already_attached` (a replay) or `not_delivered`. The objects are LIVE and NAMED by a row we
    // must not touch. Purging here would delete a working analysis's frames.
    console.error(`analyze-form: attach_media_paths refused: ${attached.reason ?? 'unknown'}`);
    return mediaPaths.length;
  } catch (err) {
    // Includes a throw from `purgePrefix` itself (it refuses to report success while objects
    // remain). The analysis is delivered either way; we log and return.
    console.error(
      'analyze-form: frames could not be attached — the analysis is still delivered',
      err instanceof Error ? err.message : err
    );
    return 0;
  }
}

/**
 * Uploads the frames the analysis actually ran on, service-role, to
 * `{user_id}/{analysis_id}/frame-{NN}.jpg` — the exact prefix `attach_media_paths`'s namespace
 * guard enforces and `DELETE /analysis/:id` (#57) purges by. Returns only the paths that LANDED.
 *
 * A failed upload is logged and skipped, never thrown: the user's analysis is done and correct, and
 * refusing to deliver it because a thumbnail did not persist would be absurd. The only cost of a
 * missing frame is a shorter frame strip in Past Analyses (#56). Objects are still reachable for
 * deletion regardless, because purge walks the PREFIX, not `media_paths`.
 */
async function uploadFrames(
  deps: AnalyzeFormDeps,
  userId: string,
  analysisId: string,
  frames: PaceFrame[]
): Promise<string[]> {
  const landed: string[] = [];

  for (let i = 0; i < frames.length; i += 1) {
    const path = `${userId}/${analysisId}/frame-${String(i + 1).padStart(2, '0')}.${FRAME_EXTENSION}`;
    try {
      const bytes = decodeBase64(frames[i].base64);
      const { error } = await deps.storage.upload(path, bytes, FRAME_MEDIA_TYPE);
      if (error) {
        console.error(`analyze-form: frame upload failed for ${path}: ${error}`);
        continue;
      }
      landed.push(path);
    } catch (err) {
      console.error(
        `analyze-form: frame upload threw for ${path}`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return landed;
}

/** Raw base64 -> bytes. `atob` is a Web API and exists in Deno; it throws on malformed input, which
 * `uploadFrames` catches per-frame. The body parser already rejected anything that is not
 * well-formed base64, so reaching the throw means the string was pathological in a way the regex
 * missed — one frame is skipped, and the analysis is still delivered. */
function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// -------------------------------------------------------------------------------------------
// The `finally` helpers — these must never throw, or they would mask the real failure.
// -------------------------------------------------------------------------------------------

/**
 * The ledger status for ONE gated call — derived from the outcome of the one Anthropic request it
 * paid for, never from the request's overall fate. See `OpenCall`.
 *
 * `'success'`/`'fallback'` are reserved for the call whose output was actually DELIVERED
 * (`decision.sourceAttempt`). An attempt that failed and was rescued by a retry still settles as
 * the failure it was, so the circuit breaker sees it.
 */
function statusForCall(
  call: OpenCall,
  attempts: AttemptOutcome[],
  decision: AnalyzeFormDecision | null
): RecordCallStatus {
  if (call.attemptIndex === null) {
    return 'cancelled';
  }

  const attempt = attempts[call.attemptIndex];
  if (!attempt) {
    // Issued, but we never recorded its outcome — only reachable if `ModelCaller.send` broke its
    // "never throws" contract. Something went wrong on a call we paid for: say so.
    return 'model_error';
  }

  if (decision && decision.kind !== 'failed' && decision.sourceAttempt === call.attemptIndex) {
    return decision.kind === 'partial' ? 'fallback' : 'success';
  }

  switch (attempt.failure) {
    case 'no_tool_use':
    case 'invalid_shape':
      return 'validation_failed';
    case 'truncated':
    case 'refusal':
    case 'call_failed':
      return 'model_error';
    default:
      // A fully valid attempt that was NOT the delivered one cannot happen (`decideOutcome` returns
      // the first valid attempt), but a validated call is a successful call either way.
      return 'success';
  }
}

/** This call's own token usage — never another attempt's, or the ledger double-counts one request's
 * tokens across two rows and drops the other's. `undefined` for a call that never ran, which is
 * exactly when `record_ai_call` falls back to its own pre-call estimate. */
function usageForCall(call: OpenCall, attempts: AttemptOutcome[]) {
  if (call.attemptIndex === null) {
    return undefined;
  }
  const usage = attempts[call.attemptIndex]?.usage;
  if (!usage) {
    return undefined;
  }
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens,
  };
}

function sumUsage(attempts: AttemptOutcome[], field: keyof AttemptOutcome['usage']): number {
  return attempts.reduce((total, attempt) => total + (attempt.usage[field] ?? 0), 0);
}

async function safeRecord(
  rpc: RpcClient,
  callId: string,
  status: RecordCallStatus,
  analysisId: string | null,
  usage: ReturnType<typeof usageForCall>
): Promise<void> {
  try {
    await recordAiCall(rpc, { callId, status, usage, analysisId });
  } catch (err) {
    // An unsettled `'pending'` row eats daily-cap headroom until `pending_timeout_seconds` ages it
    // out. That is a degradation, not a corruption — and it is emphatically not worth turning a
    // delivered analysis into a 500 over.
    console.error(
      `analyze-form: record_ai_call(${callId}, ${status}) failed`,
      err instanceof Error ? err.message : err
    );
  }
}

async function safeRelease(
  rpc: RpcClient,
  userId: string,
  analysisId: string,
  reason: ReleaseReason
): Promise<void> {
  try {
    const { error } = await rpc.rpc('release_analysis', {
      p_user_id: userId,
      p_analysis_id: analysisId,
      // One of the four strings `analyses_release_reason_known_values` permits. Anything else is
      // rejected by the CHECK constraint — and only `'validation_failed'` ticks the anti-farming
      // counter, so getting this wrong either brickes an innocent user or hands a farmer free
      // calls.
      p_reason: reason,
    });
    if (error) {
      throw new Error(error.message);
    }
  } catch (err) {
    // The reservation stays `'reserved'` and silently eats a quota slot until #47's sweep. There is
    // nothing more this request can do about it, and failing louder would not give the user their
    // slot back either.
    console.error(
      `analyze-form: release_analysis(${analysisId}, ${reason}) FAILED — the reservation is stranded`,
      err instanceof Error ? err.message : err
    );
  }
}
