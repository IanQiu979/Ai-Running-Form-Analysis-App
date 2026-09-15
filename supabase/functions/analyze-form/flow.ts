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
 *   auth → consent → derive content identity → AI GATE
 *        → idempotency + canonical-result + quota reserve (tier is DERIVED here)
 *        → model call (+1 retry) → normalize (evidence + tier)
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
 * 2.5. FREE TIER (captain's ruling, 2026-09-06 — supersedes the earlier zero-spend sample). Free
 *    gets a REAL, model-backed analysis through this SAME path, capped server-side by
 *    `reserve_analysis`'s one-lifetime-delivered-analysis policy (Known Issue #14's authority, not
 *    a client-visible counter). There is no more side-effect-free pre-reserve tier lookup and no
 *    early return: every tier — free, pro, elite — runs gate → reserve → model → normalize →
 *    settle identically, and `reserve.tier` (from `reserve_analysis` itself) is the only place tier
 *    is learned. This closes the launch-blocking defect the fabricated sample created: it promised
 *    a cadence figure, a left/right ground-contact comparison, and flags/drills that do not exist
 *    in the certified knowledge files, and nobody who saw it ever received a real analysis (five
 *    weeks, zero `analyses` rows). The normalization step below is what makes a real Free result
 *    honest rather than merely genuine.
 *
 * 3. AI SPEND GATE, before idempotency and before the reserve — not after (#91's binding call
 *    order). If the gate ran after the reserve, every kill-switch/cap/breaker denial would have to
 *    release a reservation, and released rows once counted against the 3-strike anti-farming cap:
 *    three outages would lock out a legitimate user for something we did. Gating first means a
 *    denied request never creates a reservation at all.
 *
 *    The gate enforces TWO daily ceilings: the caller's own per-tier allowance
 *    (`user_daily_cap`), and the platform-wide one (`daily_cap`). The per-user cap counts every
 *    gated call for that user whatever its outcome — including a deliverable verdict in which no
 *    pillar could be assessed — so this is the only control standing between a paying account and
 *    unlimited free model calls. Its tier is
 *    derived inside the RPC from `public.subscriptions`, never passed in from here. See
 *    `supabase/migrations/20260907120000_per_user_ai_daily_cap.sql` for the numbers and the
 *    total-exposure statement.
 *
 * 4/5. IDEMPOTENCY + CANONICAL RESULT + ATOMIC RESERVE, all inside `reserve_analysis` (one round
 *    trip, one per-user advisory lock). The server-derived identity binds the exact ordered frame
 *    bytes/timestamps, authenticated user, media kind, and analyzer revision. A fresh request key
 *    for identical evidence therefore replays the one active reserved/delivered row instead of
 *    issuing another model call. We branch on the returned `status`, never on `allowed` alone — see
 *    `handleExisting()`. `reserve.tier` is the SOLE source of tier for the rest of the request.
 *
 * 6-8. PROMPT → ONE VISION CALL → validate → retry once, only for an eligible failure kind.
 *    `analyze-form-prompt.ts` (#41) builds the request; `analyze-form-validation.ts` (#45) reads
 *    the response and decides. `provider_timeout` and `max_tokens` truncation are terminal —
 *    attempt 1 already spent most/all of the model window, so a retry would very likely repeat
 *    the same failure (issue #199) — and so is a policy `refusal` (unlikely to change on the same
 *    frames, and carries no farming signal either way). A quick transport blip (`model_error`)
 *    retries only with a full 80s attempt available. A content/shape failure
 *    (`no_tool_use`/`invalid_shape`) retries with at least 20s left: those failures already consumed
 *    a completed model round trip, but MUST remain retry-reachable because a repeated content
 *    failure is the only signal `classifyReleaseReason` has for deliberate prompt-injection
 *    farming. If that smaller retry times out, it safely becomes `model_error`, not a strike.
 *    The MEDIUM RULES are picked from the frame count actually attached, not the client's
 *    declared `mediaType` — a video clipped to one frame by Free's cap is one instant, and must
 *    never be handed the cross-frame rules.
 *
 * 8.5. NORMALIZE (evidence + tier) — server-side, unconditional, never prompt-only trust. Cadence
 *    (a rate) and Elasticity (a bounce cycle) cannot be honestly assessed from a single frame,
 *    whatever the model claims: every one-frame submission (Free's only allowance, and any photo
 *    from any tier) has both pillars forced to `notAssessedReason: 'needsVideo'` here, and `overall`
 *    is recomputed from what is left. A stop-running SAFETY signal the model wrote into such a
 *    pillar survives the strip and leads the replacement feedback (SAFETY_RULES: undroppable at
 *    every tier). Free additionally never renders flags/drills (`pace.ts`'s `PacePillarResult` doc
 *    comment) — stripped here, not merely omitted from the prompt. See
 *    `normalizeForEvidenceAndTier()`.
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
 * `await release(...)` calls. On failures, quota release runs first: a slow ledger RPC may hold
 * daily-cap headroom temporarily, but must never delay returning the user's reserved quota slot.
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
  deriveAnalyzeFormIdentity,
  type AnalyzeFormIdentity,
} from '../_shared/analyze-form-fingerprint.ts';
import {
  buildAnalyzeFormRequest,
  type AnalyzeFormRequest as AnthropicRequest,
  type PaceFrame,
  type PaceMediaKind,
} from '../_shared/analyze-form-prompt.ts';
import {
  callFailedAttempt,
  decideOutcome,
  deriveOverall,
  readAttempt,
  type AnalyzeFormDecision,
  type AnthropicMessageResponse,
  type AttemptOutcome,
  type ReleaseReason,
} from '../_shared/analyze-form-validation.ts';
import { DEFAULT_PAGE_SIZE, purgePrefix, type StorageBucket } from '../_shared/delete-analysis.ts';
import { errorClassOf, hashUserId, logEvent, newRequestId } from '../_shared/log.ts';
import {
  PACE_FRAME_CAP,
  PACE_MAX_REQUEST_BODY_BYTES,
  PACE_PILLARS,
  hasSafetySignal,
  isPaceResult,
  type PacePillarResult,
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

/** Total request envelope, measured before parsing/consent/tier/gate/reserve. The client gives up
 * at `ANALYZING_TIMEOUT_MS` = 120s (`lib/analyzing-machine.ts`), so 105s nominally leaves 15s for
 * settling, releasing, uploads, and returning OUR structured error. Individual DB/storage calls
 * remain governed by their own platform/network limits; we do not race side-effecting RPCs against
 * local timers that could let them finish after the response. */
export const ANALYZE_FORM_REQUEST_DEADLINE_MS = 105_000;

/** Maximum model-work window once preflight lands. The effective model deadline is the earlier of
 * `now + 85s` and the 105s request envelope above: preflight up to 20s preserves the full model
 * window, while slower preflight consumes only the request envelope rather than extending it. */
export const ANALYZE_FORM_DEADLINE_MS = 85_000;

/** Per-attempt ceiling. A full 85s model window leaves 5s to classify a completed first attempt
 * and, for a quick eligible failure, decide whether a retry still has a useful budget. */
export const MODEL_CALL_TIMEOUT_MS = 80_000;

/** A transport error retries only with a full attempt available. Transport failures should be
 * quick; starting an underfunded replacement after a slow transport failure doubles likely waste. */
export const MIN_RETRY_BUDGET_MS = 80_000;

/** Content/shape failures have already completed a model round trip, so sharing the 80s transport
 * floor made their retry — and therefore repeated-content anti-farming classification — practically
 * unreachable. Twenty seconds preserves that signal. If the smaller retry times out, it safely
 * self-classifies as `model_error`, never as a farming strike. */
export const MIN_CONTENT_RETRY_BUDGET_MS = 20_000;

/**
 * THE FREE ZERO-PILLAR COOLDOWN — the replacement for the Free-specific charge that used to sit on
 * the zero-pillars branch (see §9.5). That carve-out bounded the free-form-checking loop by TOTAL
 * count — one blank result and Free's single lifetime analysis was gone — which punished the
 * honest case (a badly framed clip) exactly as hard as the abusive one. A cooldown bounds the same
 * loop by FREQUENCY instead, which is the axis the worry was actually about.
 *
 * THE INTERVAL IS NOT DECLARED HERE. It lives in `public.pace_zero_pillar_cooldown_seconds()`
 * (`20260906140000_quota_status_zero_pillar_cooldown.sql`, 15 minutes, justified there) because
 * two callers need it: this function, to refuse, and `pace_quota_status`, to warn Home BEFORE a
 * runner extracts frames and uploads them. A TypeScript constant passed into one of them would be
 * a second source of truth, and the drift it invites is Home saying "try again at 3:15" while the
 * server refuses until 3:30.
 *
 * Free only. Pro/Elite pay per period and their zero-pillar refund is already bounded by quota.
 */

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
 * back — without these you cannot tell a prompt regression from a provider incident.
 *
 * `userId` is the output of `_shared/log.ts`'s `hashUserId()`, never the raw `auth.uid` (issue
 * #85's "user id ONLY if hashed/opaque"). `requestId` correlates this summary line with the
 * intermediate structured events (`ai_gate_denied`, `retry_gated_out`, `honest_partial_fallback`,
 * `model_call_timeout`, ...) emitted directly via `logEvent()` elsewhere in this file for the same
 * request — see `runAnalyzeForm`'s top for where both are minted. */
export interface AnalyzeFormLogEvent {
  event: 'analyze-form';
  requestId: string;
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
  /** Temporary captain-only test override. When true, selects additive service-role wrapper RPCs
   * that report Elite and bypass count/anti-farm quota refusal. Normal RPCs remain untouched. */
  allUsersUnlimitedAccess?: boolean;
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
      // The wire field keeps its historical `requestedTimestampMs` name, but the server cannot
      // distinguish an older client's requested seek target from a newer decoder-reported estimate.
      // Downstream copy must treat either provenance as an approximate temporal hint.
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

/** `ReserveResult` crosses an RPC/JSON trust boundary; its compile-time tier annotation proves
 * nothing at runtime. Keep this check closed and explicit so prototype keys cannot index the
 * prompt/token tables or bypass `tier === 'free'` normalization. */
function isPaceTier(value: unknown): value is PaceTier {
  return value === 'free' || value === 'pro' || value === 'elite';
}

async function reserveAnalysis(
  rpc: RpcClient,
  args: {
    userId: string;
    idempotencyKey: string;
    mediaType: PaceMediaKind;
    frameCount: number;
    analysisIdentity: AnalyzeFormIdentity;
    allUsersUnlimitedAccess?: boolean;
  }
): Promise<ReserveResult> {
  const fn = args.allUsersUnlimitedAccess ? 'reserve_analysis_unlimited' : 'reserve_analysis';
  const { data, error } = await rpc.rpc(fn, {
    // CONTRACT RULE 1 — `p_user_id` is the JWT-derived id, threaded down from `index.ts`'s
    // `auth.getUser()`. There is no code path by which a request body can influence it.
    p_user_id: args.userId,
    p_idempotency_key: args.idempotencyKey,
    p_media_type: args.mediaType,
    p_frame_count: args.frameCount,
    // Trusted, server-derived content identity. Never accept this from the request body and never
    // return or log it: the service-only claim table is its sole persistence boundary.
    p_analysis_identity: args.analysisIdentity,
  });
  if (error) {
    throw new Error(`${fn} failed: ${error.message}`);
  }
  return data as ReserveResult;
}

/**
 * Seconds still to wait before this user may resubmit after a zero-pillar result, or 0.
 *
 * FAILS OPEN, deliberately. `pace_zero_pillar_cooldown_remaining`
 * (`20260906130000_free_zero_pillar_cooldown.sql`, narrowed to one argument by
 * `20260906140000_quota_status_zero_pillar_cooldown.sql`) is a read-only lookup over rows `release_
 * analysis` already writes — it holds no state of its own and adds no counter. If it is missing
 * (the function deployed ahead of its migration) or errors, this returns 0 and the request runs:
 * a throttle is not worth failing a legitimate analysis over, and the un-throttled behaviour is
 * exactly the blanket no-charge policy Pro/Elite already get. That also means the
 * `'zero_pillar_cooldown'` release reason is never written before the migration that permits it
 * exists — the reason and the function that produces it land in the same migration.
 */
async function zeroPillarCooldownRemaining(
  deps: AnalyzeFormDeps,
  userId: string,
  requestId: string,
  userIdHash: string
): Promise<number> {
  try {
    const { data, error } = await deps.rpc.rpc('pace_zero_pillar_cooldown_remaining', {
      p_user_id: userId,
    });
    if (error) throw new Error(error.message);
    return typeof data === 'number' && Number.isFinite(data) && data > 0 ? Math.ceil(data) : 0;
  } catch (err) {
    logEvent({
      level: 'warn',
      fn: 'analyze-form',
      event: 'zero_pillar_cooldown_unavailable',
      requestId,
      userId: userIdHash,
      errorClass: errorClassOf(err),
    });
    return 0;
  }
}

async function settleAnalysis(
  rpc: RpcClient,
  args: {
    userId: string;
    analysisId: string;
    result: PaceResult;
    isFallback: boolean;
    zeroPillar: boolean;
  }
): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await rpc.rpc('settle_analysis', {
    p_user_id: args.userId,
    p_analysis_id: args.analysisId,
    p_result: args.result,
    p_is_fallback: args.isFallback,
    // Delivered but UNCHARGED when true: the row is persisted so the verdict is pinned, and
    // stamped `zero_pillar_at` so quota skips it and the cooldown can find it. REQUIRED in SQL,
    // not defaulted — exactly as `p_analysis_identity` is on the five-argument reserve overload.
    // A required argument is what keeps the older signature unambiguously callable during a
    // DB-first rollout; a defaulted one would make a four-named-argument call ambiguous between
    // the two overloads and fail at resolution time.
    p_zero_pillar: args.zeroPillar,
    // EXPLICITLY EMPTY, and it must stay explicit. Nothing has been uploaded yet — the frames go
    // up AFTER this call succeeds and `attach_media_paths` records them, and THE INVARIANT from
    // #130 still holds: a 'reserved' row can never have frames. What changed on 2026-09-10 is that
    // omitting this argument no longer works. The six-argument overload has NO defaults (that is
    // what keeps the five-argument one unambiguously callable), so a named call that skips
    // `p_media_paths` matches neither overload and Postgres rejects the whole statement with
    // "function ... does not exist" — which would break EVERY settle, scored results included,
    // not just zero-pillar ones. Passing `[]` is identical in effect to the old `default '{}'`.
    p_media_paths: [],
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
 * hits a transport error and the retry succeeds, call 1 settles `'model_error'` and call 2 settles
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
  params: {
    callerUserId: string;
    rawBody: unknown;
    requestId?: string;
    requestStartedAt?: number;
  }
): Promise<AnalyzeFormHttpResponse> {
  const now = deps.now ?? Date.now;
  const startedAt = params.requestStartedAt ?? now();
  const requestDeadline = startedAt + ANALYZE_FORM_REQUEST_DEADLINE_MS;
  const { callerUserId } = params;

  // Issue #85 — observability. Minted ONCE per request, before any work: `requestId` correlates
  // every structured log line this invocation emits (the gate denial, a skipped retry, the
  // honest-partial fallback, and the final summary below) even across a genuine model timeout;
  // `userIdHash` is what every one of those lines is allowed to carry instead of the raw
  // `callerUserId` — see `_shared/log.ts`'s `hashUserId()` for why. Neither call can throw
  // (`hashUserId` degrades internally rather than reject), so this cannot turn into a new failure
  // mode for a request that would otherwise have succeeded.
  const requestId = params.requestId ?? newRequestId();
  const userIdHash = await hashUserId(callerUserId);

  // --- The two `finally` obligations, as state. Nothing below this line calls release or record.
  let reservation: string | null = null;
  let reservationSettled = false;
  let releaseReason: ReleaseReason = 'internal_error';
  const openCalls = new Map<string, OpenCall>();

  // --- Observability accumulators.
  const attempts: AttemptOutcome[] = [];
  // The subset of `attempts` for which a provider request actually went out. `attempts` itself
  // must keep every entry — including the synthetic one `callModel` returns when the envelope is
  // already spent — because the failure/settle logic below indexes into it by attempt number.
  // But the summary line describes what HAPPENED, and a request that dispatched nothing made zero
  // calls: reporting `attempts: 1` there over-counts every dashboard built on this field.
  const dispatchedAttempts: AttemptOutcome[] = [];
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
    // Derive this only from the JWT subject and exact accepted evidence. The client idempotency
    // key identifies a transport attempt and the database derives the tier, so neither belongs in
    // the raw evidence digest. The identity crosses only the service-role RPC boundary and is
    // never logged or returned.
    const analysisIdentity = await deriveAnalyzeFormIdentity({
      authenticatedUserId: callerUserId,
      media: request.mediaType,
      frames: request.frames,
    });

    // Tier is not known yet — `reserve_analysis` below is the only place it is derived — so the
    // pre-call estimate deliberately uses the WORST case (elite's 8k output budget) rather than
    // guessing. That errs strictly toward reserving too much headroom, which `ai-pricing.ts` names
    // as the intended direction of error — the gate is a ceiling, not an accountant, and
    // `record_ai_call` settles the real cost from real token counts moments later. The retry's
    // gate, below, knows the true tier and uses it.
    const firstEstimate = estimateTokensForCall(request.frames.length, 'elite');
    const gate = await gateAiCall(deps.rpc, {
      userId: callerUserId,
      estimatedInputTokens: firstEstimate.inputTokens,
      estimatedOutputTokens: firstEstimate.outputTokens,
      allUsersUnlimitedAccess: deps.allUsersUnlimitedAccess,
    });
    if (!gate.allowed) {
      // `gate.detail` is deliberately NOT forwarded to the client. On a `daily_cap` denial it
      // carries `spent_usd` / `cap_usd` — our operational AI spend and our ceiling — and on
      // `killed` it carries the operator's `disabled_reason`. None of that is the caller's
      // business, and any authenticated user could read it just by tripping the cap. A
      // `user_daily_cap` denial's detail is about the caller's own spend rather than ours, but it
      // is withheld on the same principle: it still discloses our per-tier $ ceilings, which is
      // a farming aid, not a user-facing fact. The client
      // needs `code` (to pick the right copy) and nothing more; the detail is logged server-side,
      // where it belongs.
      //
      // Issue #85 — this is #91's guardrail substrate (kill switch / circuit breaker / daily cap)
      // actually firing, and it is exactly the kind of failure that must be COUNTED, not
      // discovered from a user complaint. `reason` is one of 'killed' | 'breaker_open' |
      // 'user_daily_cap' | 'daily_cap' | 'unknown_model' | 'invalid_estimate' | 'invalid_user' —
      // filterable directly in `get_logs`. 'user_daily_cap' (one caller over their own tier's
      // daily allowance, a 429) and 'daily_cap' (the platform-wide ceiling, a 503) are
      // deliberately distinct events: the first is normal per-account throttling, the second is
      // an operational ceiling worth paging on.
      logEvent({
        level: 'warn',
        fn: 'analyze-form',
        event: 'ai_gate_denied',
        requestId,
        userId: userIdHash,
        outcome: `gate_${gate.reason}`,
        reason: gate.reason,
        detail: gate.detail ?? {},
      });
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
      analysisIdentity,
      allUsersUnlimitedAccess: deps.allUsersUnlimitedAccess,
    });

    if (!reserve.allowed) {
      // No reservation was created, so there is nothing to release. The gate's `'pending'` row is
      // settled as `'cancelled'` by the `finally` — the model was never going to be called, so it
      // is not a failure and must not feed the circuit breaker.
      outcome = String(reserve.reason ?? 'reserve_denied');
      return (response = reserveDenialResponse(reserve));
    }

    const analysisId = reserve.id;
    // A fresh row already exists once reserve_analysis returns allowed. Record it BEFORE validating
    // the rest of the untrusted RPC payload so every malformed tier/id exit still reaches the one
    // release_analysis call in `finally` whenever an id is available.
    if (!reserve.existing && typeof analysisId === 'string') {
      reservation = analysisId;
    }

    if (!isPaceTier(reserve.tier)) {
      throw new Error('reserve_analysis returned an allowed reservation with an invalid tier.');
    }
    tier = reserve.tier;

    if (reserve.existing) {
      // CONTRACT RULE 2 lives here. `allowed: true` is not permission to deliver.
      outcome = `existing_${reserve.status}`;
      return (response = handleExisting(reserve));
    }

    if (typeof analysisId !== 'string') {
      throw new Error('reserve_analysis returned an allowed reservation with no id.');
    }
    // From this line on, a row exists in state `'reserved'`. Every exit path below — return, throw,
    // or fall-through — passes through the `finally`, which releases it unless it was settled.
    reservation = analysisId;
    const modelDeadline = Math.min(now() + ANALYZE_FORM_DEADLINE_MS, requestDeadline);

    // Free zero-pillar cooldown: after the fresh reserve establishes the server-derived tier and
    // before the prompt/model call. `finally` releases this reservation and cancels the open AI
    // gate row at $0 when a retry is refused.
    if (tier === 'free') {
      const cooldownSeconds = await zeroPillarCooldownRemaining(
        deps,
        callerUserId,
        requestId,
        userIdHash
      );
      if (cooldownSeconds > 0) {
        releaseReason = 'zero_pillar_cooldown';
        outcome = 'zero_pillar_cooldown';
        return (response = {
          status: 429,
          body: {
            // ONE SHORT SENTENCE, and no more (captain's standing style rule). The client owns
            // saying WHEN — it renders this alongside a clock time derived from
            // `retryAfterSeconds` — and neither surface explains the throttle's purpose: a runner
            // whose clip could not be read is not an abuser and must not be addressed as one.
            error: 'Nothing in that last clip could be read.',
            code: 'zero_pillar_cooldown',
            retryAfterSeconds: cooldownSeconds,
          },
        });
      }
    }

    // ── 6/7. The grounded prompt (#41). Server-derived tier; never the client's word for it. ──
    // Both facts go to the builder — what the runner SENT (`mediaType`) and what actually reached
    // us (`frames`) — and `analyze-form-prompt.ts` keeps them apart: one attached frame gets the
    // one-instant rules whatever produced it, while the runner's own upload is still described to
    // the model as the video it was. Collapsing the two is how a video submitter ends up being
    // told their upload is a photo and advised to send a video.
    const anthropicRequest = buildAnalyzeFormRequest({
      tier,
      media: request.mediaType,
      frames: request.frames,
    });

    // ── 8. One vision call, then — on a quick transport failure — exactly one retry. ───────

    const first = await callModel(
      deps,
      anthropicRequest,
      openCalls,
      gate.callId,
      0,
      modelDeadline,
      now,
      requestId,
      userIdHash
    );
    attempts.push(first.attempt);
    if (first.dispatched) {
      dispatchedAttempts.push(first.attempt);
    }
    if (first.timedOut) {
      releaseReason = 'provider_timeout';
    }

    // Did a second model call genuinely happen? Keep this explicit for per-call accounting,
    // fallback provenance, and `decideOutcome`'s conservative failure classification.
    let retryRan = false;

    if (!first.attempt.result) {
      const lastFailureReason = first.timedOut
        ? 'provider_timeout'
        : first.attempt.failure === 'call_failed'
          ? 'model_error'
          : first.attempt.failure;
      const remainingBeforeGate = modelDeadline - now();
      // RETRY-ELIGIBLE BY KIND, an explicit allowlist — get this wrong in either direction and
      // something important breaks:
      //   - `model_error` (a transport blip) and the two CONTENT/SHAPE failures (`no_tool_use`,
      //     `invalid_shape`) are eligible. Content failures MUST stay eligible, not just
      //     transport errors: a REPEATED content failure is the ONLY signal
      //     `classifyReleaseReason` (`analyze-form-validation.ts`) has for deliberate
      //     prompt-injection farming — it requires BOTH attempts to be content failures AND
      //     `retryRan === true`. An earlier version of this fix restricted retry eligibility to
      //     `model_error` alone, which makes `retryRan` structurally impossible whenever attempt 1
      //     IS a content failure — silently making `'validation_failed'` unreachable and
      //     disabling the 3-strike anti-farming cap for the one failure class it exists to catch
      //     (issue #6/#85). See `flow.deno.test.ts`'s "rule 3" cases for the reachability proof.
      //   - `provider_timeout` and `truncated` (max_tokens) are NOT eligible: both mean attempt 1
      //     already spent most/all of the model window on THIS input, so retrying is very likely
      //     to repeat the same failure and would only double the wait and the spend for nothing
      //     (issue #199's core-purpose-audit finding: 3 of 6 real video calls timed out, one
      //     truncated).
      //   - `refusal` is also NOT eligible: it carries no farming signal
      //     (`classifyReleaseReason` only recognizes `no_tool_use`/`invalid_shape`) and a policy
      //     refusal on the exact same frames is unlikely to change on a second ask, so retrying it
      //     buys nothing.
      //   - `invalid_safety` IS eligible, on the same content floor as the two shape failures: it
      //     is a completed round trip whose CONTENT violated our own safety contract (a missing,
      //     malformed, or ungrounded `safety` declaration), so a second ask can plausibly produce
      //     a conforming one. Unlike the other two it can never become a farming strike —
      //     `classifyReleaseReason` short-circuits any attempt carrying it to `'invalid_safety'`
      //     — so the retry exists purely to give the model its second chance before we refuse to
      //     deliver anything at all.
      const isRetryEligibleFailure =
        lastFailureReason === 'model_error' ||
        lastFailureReason === 'no_tool_use' ||
        lastFailureReason === 'invalid_shape' ||
        lastFailureReason === 'invalid_safety';
      const minRetryBudgetMs =
        lastFailureReason === 'no_tool_use' ||
        lastFailureReason === 'invalid_shape' ||
        lastFailureReason === 'invalid_safety'
          ? MIN_CONTENT_RETRY_BUDGET_MS
          : MIN_RETRY_BUDGET_MS;
      const mayRetry = isRetryEligibleFailure && remainingBeforeGate >= minRetryBudgetMs;
      if (mayRetry) {
        // A SECOND Anthropic request is a second billed call, so it gets its OWN gate — the daily
        // cap and the circuit breaker must both see it. This gate necessarily runs after the
        // reserve (the retry could not exist before it); the ordering contract is about the FIRST
        // gate, which ran before any row was created. A denial here is not a failure: we simply
        // stop calling and fall through to the transport failure from attempt 1.
        const retryEstimate = estimateTokensForCall(request.frames.length, tier);
        const retryGate = await gateAiCall(deps.rpc, {
          userId: callerUserId,
          estimatedInputTokens: retryEstimate.inputTokens,
          estimatedOutputTokens: retryEstimate.outputTokens,
          analysisId,
          allUsersUnlimitedAccess: deps.allUsersUnlimitedAccess,
        });

        if (retryGate.allowed) {
          openCalls.set(retryGate.callId, { attemptIndex: null });
          // The gate is a real network round trip. Re-check the SAME failure-kind floor after it
          // returns so a slow gate cannot turn an eligible retry into an underfunded provider call.
          const remainingAfterGate = modelDeadline - now();
          if (remainingAfterGate >= minRetryBudgetMs) {
            const second = await callModel(
              deps,
              anthropicRequest,
              openCalls,
              retryGate.callId,
              1,
              modelDeadline,
              now,
              requestId,
              userIdHash
            );
            attempts.push(second.attempt);
            if (second.dispatched) {
              dispatchedAttempts.push(second.attempt);
            }
            // The retry genuinely happened — the model was asked a second time.
            retryRan = true;
            if (second.timedOut) {
              // A transport retry received the full 80s attempt budget, so its timeout remains a
              // provider timeout. A content retry may receive only the remaining >=20s by our own
              // policy; timing out that deliberately truncated attempt is our degradation and
              // must self-correct to non-farming model_error, never blame the provider or strike
              // the user.
              releaseReason = lastFailureReason === 'model_error' ? 'provider_timeout' : 'model_error';
            }
          } else {
            // The allowed gate row remains `attemptIndex: null`, so `finally` settles it cancelled
            // at $0. Emit exactly one insufficient-budget event for this post-gate branch.
            logEvent({
              level: 'warn',
              fn: 'analyze-form',
              event: 'retry_skipped_insufficient_budget',
              requestId,
              userId: userIdHash,
              analysisId,
              failureKind: lastFailureReason,
              stage: 'after_retry_gate',
              remainingMs: remainingAfterGate,
              minRetryBudgetMs,
            });
          }
        } else {
          // We suppressed the retry (daily cap / open breaker). `retryRan` stays false: the
          // transport failure on attempt 1 remains a server fault.
          //
          // Issue #85 — the retry-once path (#45's promise), specifically the case where WE cut
          // it, not the model. Distinct event name from `ai_gate_denied` above: this one denies
          // the SECOND call of an in-flight request, after a reservation already exists.
          logEvent({
            level: 'warn',
            fn: 'analyze-form',
            event: 'retry_gated_out',
            requestId,
            userId: userIdHash,
            analysisId,
            reason: retryGate.reason,
          });
        }
      } else if (isRetryEligibleFailure) {
        // `remaining < minRetryBudgetMs`, but the failure kind itself was still retry-eligible
        // — we skipped only because too little of the window is left, not because a
        // `provider_timeout`/`truncated`/`refusal` made retrying pointless by kind (that case is
        // silent on purpose: it is not a degradation, it is the intended behavior). `retryRan`
        // stays false for the same reason. This IS exactly the kind of degradation issue #85 says
        // must be counted, not discovered from a user complaint — a request that arrived with too
        // little deadline left for a genuine second attempt.
        logEvent({
          level: 'warn',
          fn: 'analyze-form',
          event: 'retry_skipped_insufficient_budget',
          requestId,
          userId: userIdHash,
          analysisId,
          failureKind: lastFailureReason,
          stage: 'before_retry_gate',
          remainingMs: remainingBeforeGate,
          minRetryBudgetMs,
        });
      }
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
        // `'invalid_safety'` is a LEDGER distinction, not a wire one: it tells us apart "the
        // provider erred" from "our own certified-safety requirement was not honoured". The caller
        // can do exactly the same thing about either, so the client keeps seeing the stable
        // `'model_error'` code rather than learning our internal vocabulary.
        releaseReason === 'invalid_safety' ? 'model_error' : releaseReason,
        'The analysis service is having trouble right now. This one has not been counted against your quota — please try again shortly.'
      ));
    }

    isFallback = decision.kind === 'partial';

    // ── 8.5. Normalize (evidence + tier) — see the file header. Server-side, unconditional, and
    // strictly AFTER the honest-partial decision above: the only input this function ever
    // recomputes `overall` from again is what actually survives normalization, never what the
    // model claimed. From here on `normalizedResult` — never `decision.result` — is the value that
    // gets counted, returned, and persisted.
    const normalizedResult = normalizeForEvidenceAndTier(decision.result, {
      frameCount: request.frames.length,
      mediaType: request.mediaType,
      tier,
    });

    // ── 9.5. A zero-pillar verdict is PINNED but NOT CHARGED (captain's ruling, 2026-09-10). ──
    //
    // A response can reach here fully structurally VALID (`decideOutcome` returned `kind:
    // 'valid'`, never even touching the >= 1-assessed-pillar bar that gates the 'partial' branch
    // above) and yet assess NOTHING — every pillar honestly `score: null`, e.g. a clip that never
    // actually shows the runner, OR a one-frame submission whose only assessed pillars were
    // Cadence/Elasticity before normalization forced them to `needsVideo`. That is a real,
    // well-formed result the user got zero usable information from.
    //
    // TWO RULINGS MEET HERE, AND BOTH ARE KEPT.
    //   * NO CHARGE, ON ANY TIER (PR #213, and cd8bf97/PR #194 before it, 2026-08-19). Charging a
    //     runner for a result carrying nothing is the harshest available reading of a submission
    //     we could not read — the failure is usually framing or lighting, not intent.
    //   * ONE VERDICT PER CLIP (the determinism launch blocker this branch exists for). Identical
    //     evidence must not be able to come back with a different verdict on a re-run.
    //
    // PR #213 answered the first by RELEASING the reservation, which returned an unpersisted 200.
    // That is incompatible with the second: an unpersisted 200 retires the canonical claim in
    // `finally`, so the same clip could reach the model again and be judged differently. The
    // captain's 2026-09-10 ruling resolves it by separating persistence from payment — the row is
    // SETTLED so the verdict is pinned and replayable, and marked zero-pillar so it does not count
    // against quota. See `20260910120000_zero_pillar_delivered_uncharged.sql`.
    //
    // THE COOLDOWN MOVES WITH IT. #213's 15-minute frequency bound read `status = 'released' AND
    // release_reason = 'zero_pillars_assessed'` — rows this path no longer writes. The same
    // migration re-points `pace_zero_pillar_cooldown_remaining` at `zero_pillar_at`, which is set
    // on exactly these settled rows, so the bound survives the representation change instead of
    // silently failing open. Do not reintroduce an early unpersisted 200 here.
    //
    // `'zero_pillars_assessed'` stays excluded from `pace_is_farming_signal` (20260712220000): an
    // honest "nothing to see here" is not an attack and must never tick the 3-strike cap.
    const zeroPillarVerdict =
      PACE_PILLARS.filter((id) => normalizedResult.pillars[id].score !== null).length === 0;

    if (isFallback) {
      // Issue #85 — the honest-partial fallback IS #45's promise: some pillars scored, others
      // honestly dropped rather than fabricated. It is a deliverable 200, not an error, which is
      // exactly why it needs its own greppable event — the final summary line below reports
      // `outcome: 'partial'` too, but only once the whole request has finished, and only in the
      // shape `deps.log` happens to be wired to. This line exists on its own so ops can count and
      // alert on fallback RATE without parsing the summary schema.
      logEvent({
        level: 'warn',
        fn: 'analyze-form',
        event: 'honest_partial_fallback',
        requestId,
        userId: userIdHash,
        analysisId,
        tier,
        sourceAttempt: decision.sourceAttempt,
        retried: retryRan,
      });
    }

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
      result: normalizedResult,
      isFallback,
      zeroPillar: zeroPillarVerdict,
    });

    if (!settled.ok) {
      // The row was not in `'reserved'` when we got here. Nothing was delivered and — the whole
      // point of the new ordering — nothing was uploaded. The `finally` releases (a no-op if
      // something else already moved the row) and we do not pretend otherwise.
      throw new Error(`settle_analysis refused: ${settled.reason ?? 'unknown'}`);
    }

    reservationSettled = true;
    // A zero-pillar verdict keeps its own greppable outcome even though it now settles: ops must
    // still be able to count how often a submission could not be read, and it is neither a plain
    // 'success' nor the honest-partial 'partial'.
    outcome = zeroPillarVerdict ? 'zero_pillars_assessed' : isFallback ? 'partial' : 'success';

    // Everything from here on is NON-FATAL. The analysis is delivered and the quota is spent.
    framesUploaded = await safeAttachFrames(deps, callerUserId, analysisId, request.frames);

    return (response = {
      status: 200,
      body: { result: normalizedResult, analysisId, isFallback },
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

    if (reservation && !reservationSettled) {
      await safeRelease(deps.rpc, callerUserId, reservation, releaseReason);
    }

    for (const [callId, call] of openCalls) {
      await safeRecord(
        deps.rpc,
        callId,
        statusForCall(call, attempts, decision),
        reservation,
        usageForCall(call, attempts)
      );
    }

    // Observability must never be able to break the request it is describing: a throw from here
    // would escape the `finally` and mask the real response (and the `catch` above has already run).
    try {
      deps.log?.({
        event: 'analyze-form',
        requestId,
        userId: userIdHash,
        analysisId: reservation,
        tier,
        mediaType,
        frameCount,
        attempts: dispatchedAttempts.length,
        retried: dispatchedAttempts.length > 1,
        outcome,
        isFallback,
        releaseReason: reservation && !reservationSettled ? releaseReason : null,
        stopReasons: dispatchedAttempts.map((attempt) => attempt.stopReason),
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

/** Cadence is a rate and Elasticity is a bounce cycle: neither exists inside one still frame. */
const MOTION_ONLY_PILLARS: readonly string[] = ['cadence', 'elasticity'];

/**
 * Server-side normalization — see the file header's "NORMALIZE" step. Never prompt-only trust
 * (captain's ruling, 2026-09-06, the audit's sharpest finding): whatever the model wrote, this
 * function is the last word on what actually reaches the caller and gets persisted.
 *
 *   - ONE FRAME cannot show stride-to-stride motion. Cadence and Elasticity are forced to an
 *     honest not-assessed, DISCARDING every claim the model made about them — score, band,
 *     feedback prose, flags, drills. That prose is exactly the failure mode the retired sample
 *     shipped (a hallucinated "mid-170s spm" and a left/right ground-contact comparison neither
 *     pillar's certified knowledge file supports), so none of it survives, however it is phrased.
 *   - A certified non-`none` `safety` declaration is carried STRUCTURALLY, on the pillar's own
 *     `safety` field, on EVERY path — all pillars, all tiers, one or many frames. It is never
 *     composed into `feedback` (this function did that until 2026-09-16: `"note\n\ncoaching"`, one
 *     string — which the client then drew as one paragraph in one tone, so the warning was
 *     indistinguishable from the coaching it led). The client renders `pillar.safety.note` as its
 *     own labelled element ABOVE the coaching (`lib/pace-readout.ts`'s `safetyNote()`, read
 *     identically by `components/pace-readout.tsx` and `components/pillar-detail-modal.tsx`), so
 *     the captain's ruling holds by construction — a warning never deletes supportable coaching
 *     and never trails behind it — without any string a text layer could flatten. `feedback` is
 *     coaching only; on a motion pillar one frame cannot assess it is discarded and the note
 *     stands alone. The prompt tells the model not to repeat the warning in `feedback`, but prompt
 *     compliance is not validation: if the model echoes it anyway, the client would draw the same
 *     sentence twice — the one thing this contract exists to prevent. So on every pillar carrying
 *     a certified signal, a `feedback` whose trimmed text STARTS WITH the trimmed note has that
 *     leading exact copy (and the whitespace after it) removed; if nothing remains, `feedback`
 *     becomes `null`. Trimmed prefix equality only — no keyword, fuzzy or paraphrase detection,
 *     and no other rewriting of the coaching. This function may assume the declaration is THERE:
 *     `analyze-form-validation.ts` refuses to call a response
 *     deliverable unless every pillar carries a usable one, so an absent, malformed, ungrounded,
 *     or blank-note `safety` never reaches this code — it fails closed into a retry and then a
 *     release. The only `safety: null` that reaches this code is on a pillar WE produced (a
 *     salvage drop), never one whose warning we might be discarding.
 *   - The `notAssessedReason` names what we can actually vouch for: `'needsVideo'` for a photo,
 *     and `'singleFrameFromVideo'` when the runner sent a video and exactly one frame of it
 *     arrived. It does NOT claim WHY only one frame arrived — the frame count is chosen on the
 *     device (`lib/extraction-frame-cap.ts`, which degrades to one frame when it cannot read the
 *     caller's quota at all), so "your plan only allows one" is a cause we have not verified and
 *     is plainly false for a paying user whose quota lookup failed. The client renders one
 *     sentence from this reason (`Copy.result.pillar.notAssessed.*`), so no surface tells a video
 *     submitter to submit a video, and none blames a plan.
 *   - ALL FOUR pillars are guarded on a one-frame submission, not merely the two that are forced.
 *     Posture and Arm-swing POSITION do survive one frame, but a pillar the model itself did not
 *     score may not keep flags or drills it cannot support — guarding half of them was never a
 *     guarantee against fabricated confidence.
 *   - FREE never renders flags/drills (`pace.ts`'s `PacePillarResult` doc comment: "Paid-tier
 *     content"). Stripped here on every pillar, not merely omitted from the prompt. `safety` is
 *     NOT tier-gated and is never stripped — it is the one field a cheap tier cannot cost you.
 *
 * `overall` is recomputed — via the same `deriveOverall()` the honest-partial fallback path
 * already uses — ONLY when this function actually changed a pillar. A multi-frame Pro/Elite
 * result passes through untouched, model `overall` included: recomputing it there would silently
 * replace the model's headline with our mean on a paid path this change has no business altering.
 * When pillars WERE normalized, the model's `overall` was computed over pillars that no longer
 * exist, so it cannot be kept.
 */
function normalizeForEvidenceAndTier(
  result: PaceResult,
  input: { frameCount: number; mediaType: PaceMediaKind; tier: PaceTier }
): PaceResult {
  const { frameCount, mediaType, tier } = input;
  const pillars: Record<string, PacePillarResult> = { ...result.pillars };
  const normalizesPillars = frameCount === 1 || tier === 'free';

  if (frameCount === 1) {
    for (const id of PACE_PILLARS) {
      const pillar = pillars[id];

      if (MOTION_ONLY_PILLARS.includes(id)) {
        const safety = pillar.safety ?? null;
        pillars[id] = {
          score: null,
          band: null,
          feedback: null,
          notAssessedReason: mediaType === 'video' ? 'singleFrameFromVideo' : 'needsVideo',
          safety,
          flags: [],
          drills: [],
        };
        continue;
      }

      const notAssessedReason =
        mediaType === 'video' && pillar.notAssessedReason === 'needsVideo'
          ? ('singleFrameFromVideo' as const)
          : pillar.notAssessedReason;

      if (pillar.score === null || pillar.band === null) {
        pillars[id] = {
          ...pillar,
          score: null,
          band: null,
          notAssessedReason,
          flags: [],
          drills: [],
        };
      } else if (notAssessedReason !== pillar.notAssessedReason) {
        pillars[id] = { ...pillar, notAssessedReason };
      }
    }
  }

  if (tier === 'free') {
    for (const id of PACE_PILLARS) {
      pillars[id] = { ...pillars[id], flags: [], drills: [] };
    }
  }

  for (const id of PACE_PILLARS) {
    const pillar = pillars[id];
    const feedback = stripEchoedSafetyNote(pillar);
    if (feedback !== pillar.feedback) {
      pillars[id] = { ...pillar, feedback };
    }
  }

  const normalizedPillars = pillars as PaceResult['pillars'];
  return {
    pillars: normalizedPillars,
    overall: normalizesPillars ? deriveOverall(normalizedPillars) : result.overall,
  };
}

/**
 * The echo guard described in `normalizeForEvidenceAndTier()`'s doc comment: a certified note the
 * model ALSO wrote at the head of `feedback` is removed from `feedback` once, by trimmed prefix
 * equality, so the client's own notice is the only place the runner reads it.
 */
function stripEchoedSafetyNote(pillar: PacePillarResult): string | null {
  if (typeof pillar.feedback !== 'string' || !hasSafetySignal(pillar.safety)) {
    return pillar.feedback;
  }
  const feedback = pillar.feedback.trim();
  const note = pillar.safety.note.trim();
  if (!feedback.startsWith(note)) {
    return pillar.feedback;
  }
  const remainder = feedback.slice(note.length).trimStart();
  return remainder.length > 0 ? remainder : null;
}

async function callModel(
  deps: AnalyzeFormDeps,
  request: AnthropicRequest,
  openCalls: Map<string, OpenCall>,
  callId: string,
  attemptIndex: number,
  deadline: number,
  now: () => number,
  requestId: string,
  userIdHash: string
): Promise<{ attempt: AttemptOutcome; timedOut: boolean; dispatched: boolean }> {
  const budget = Math.min(MODEL_CALL_TIMEOUT_MS, Math.max(0, deadline - now()));

  if (budget <= 0) {
    // The gate reservation exists, but no provider request was issued. Leave `attemptIndex` null so
    // `finally` settles the unused ledger row as cancelled rather than billing a phantom timeout.
    logEvent({
      level: 'warn',
      fn: 'analyze-form',
      event: 'model_call_skipped_deadline',
      requestId,
      userId: userIdHash,
      attemptIndex,
      budgetMs: budget,
    });
    // `dispatched: false` — nothing was sent. The synthetic attempt below still drives the
    // caller's failure handling (there is no result to decide on), but the observability line
    // must not count it as a provider call that happened.
    return { attempt: callFailedAttempt(), timedOut: true, dispatched: false };
  }

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
    // Issue #85 — timeouts specifically. `result.message` is Anthropic/network free text (already
    // logged above via the pre-existing console.error, unchanged); the structured line below
    // carries only the enum-shaped `result.kind` and `budgetMs`, so it stays within the "no
    // unbounded free text" rule even though the console.error next to it does not need to.
    logEvent({
      level: 'warn',
      fn: 'analyze-form',
      event: result.kind === 'timeout' ? 'model_call_timeout' : 'model_call_error',
      requestId,
      userId: userIdHash,
      attemptIndex,
      budgetMs: budget,
    });
    return { attempt: callFailedAttempt(), timedOut: result.kind === 'timeout', dispatched: true };
  }

  return { attempt: readAttempt(result.response), timedOut: false, dispatched: true };
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
    case 'invalid_safety':
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
      // One of the strings `analyses_release_reason_known_values` permits. Anything else is
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
