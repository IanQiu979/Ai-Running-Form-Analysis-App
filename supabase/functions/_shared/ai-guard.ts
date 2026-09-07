/**
 * The AI spend gate's client-facing interface (issue #91). `supabase/functions/analyze-form`
 * (#44, not built here) is REQUIRED to call `gateAiCall()` before every Anthropic request and
 * `recordAiCall()` on every exit path after a successful gate — see the "call ordering" note at
 * the top of `supabase/migrations/20260712210100_ai_spend_guardrail_functions.sql` for exactly
 * where in the request lifecycle this belongs (before `reserve_analysis`, not after) and why.
 *
 * Deliberately free of any `npm:`/Deno-only import so this orchestration logic — not just the
 * pure math in `ai-pricing.ts` — is unit-testable under Jest with a mocked `RpcClient`. The
 * actual Deno-side Supabase client construction (reads `SUPABASE_URL` / `SUPABASE_SECRET_KEYS`
 * from `Deno.env`) lives in `ai-guard-client.ts`, imported only by the eventual edge function,
 * never by this file or its tests.
 *
 * There is no exported way to get a `call_id` other than through `gateAiCall()`, and
 * `recordAiCall()` requires one — so using the ledger at all runs through the gate by
 * construction. That is real, but partial, protection: nothing here can stop `analyze-form`'s
 * own code from calling the Anthropic API directly and never touching this module at all. See
 * the migration header for the full, honest scoping of what "physically cannot" means here.
 *
 * DEPLOY-GATED. The per-user cap's `gate_ai_call_unlimited` (the `ALL_USERS_UNLIMITED_ACCESS`
 * sibling) only exists once `supabase/migrations/20260907120000_per_user_ai_daily_cap.sql` is
 * applied, so `supabase db push` MUST run BEFORE this function is deployed — the same ordering
 * `pace_quota_status` / `pace_purchase_tier` needed for `quota-status` / `purchase-tier`. If it
 * is deployed the other way round, `gateAiCall` degrades rather than 500s: see the missing-
 * function fallback below.
 */

export type GateDenyReason =
  | 'killed'
  | 'breaker_open'
  /** The caller's OWN daily allowance for their tier. Their spend, their ceiling. */
  | 'user_daily_cap'
  /** The platform-wide daily ceiling, across every user. Our brake. */
  | 'daily_cap'
  | 'unknown_model'
  | 'invalid_estimate'
  /** The gate was handed no user id, so its per-user cap could not be keyed to anybody. Refused
   * rather than spent unattributably — see the per-user-cap migration's `invalid_user` branch. */
  | 'invalid_user';

export type GateResult =
  | { allowed: true; callId: string; estimatedUsd: number }
  | { allowed: false; reason: GateDenyReason; detail?: Record<string, unknown> };

export type RecordCallStatus = 'success' | 'model_error' | 'validation_failed' | 'fallback' | 'cancelled';

export interface RecordCallUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface RecordResult {
  ok: boolean;
  alreadySettled: boolean;
  status?: string;
  actualUsd?: number;
  reason?: string;
}

/**
 * Minimal shape of a Supabase client's `.rpc()` — matches `@supabase/supabase-js`'s own return
 * shape closely enough that a real client satisfies this with no adapter, while this file stays
 * free of an import from that package.
 */
export interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export interface GateAiCallParams {
  userId: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  model?: string;
  analysisId?: string | null;
  /**
   * The temporary `ALL_USERS_UNLIMITED_ACCESS` override (migration 20260807090000). Swaps
   * `gate_ai_call` for `gate_ai_call_unlimited`, exactly as `currentTier`/`reserveAnalysis` in
   * `analyze-form/flow.ts` already swap `pace_current_tier`/`reserve_analysis` for their
   * `_unlimited` siblings. The override applies the ELITE per-user cap; it does NOT lift the cap
   * — per that migration's own wording, "unlimited" means analysis COUNT and "the AI spend
   * guardrails remain intact too".
   */
  allUsersUnlimitedAccess?: boolean;
}

const BASE_GATE_FN = 'gate_ai_call';
const OVERRIDE_GATE_FN = 'gate_ai_call_unlimited';

/**
 * True only for "that function is not in the database" — PostgREST's schema-cache miss
 * (`PGRST202`) or Postgres's undefined_function (`42883`), by code or by the message either one
 * produces. Every other error class (transport, timeout, permission, a genuine DB fault) is
 * excluded on purpose: those must keep throwing exactly as before.
 */
function isMissingFunctionError(error: { message: string; code?: string }): boolean {
  if (error.code === 'PGRST202' || error.code === '42883') {
    return true;
  }
  const message = error.message.toLowerCase();
  return message.includes('could not find the function') || message.includes('does not exist');
}

/**
 * Reserves budget headroom for one Anthropic call. Denies — without ever reserving anything —
 * if the kill switch is off, the circuit breaker is open, or EITHER daily cap would be exceeded:
 * the caller's own per-tier allowance (`user_daily_cap`) or the platform-wide ceiling
 * (`daily_cap`). The per-user one is checked first, so a caller over their own allowance is told
 * that rather than being handed an outage they did not cause.
 *
 * A deny is always a normal, typed return value, never an exception, so a missed `catch` can't
 * accidentally let a call through; only a genuine transport/DB error throws.
 */
export async function gateAiCall(client: RpcClient, params: GateAiCallParams): Promise<GateResult> {
  const args = {
    p_user_id: params.userId,
    p_estimated_input_tokens: params.estimatedInputTokens,
    p_estimated_output_tokens: params.estimatedOutputTokens,
    p_model: params.model ?? 'claude-sonnet-5',
    p_analysis_id: params.analysisId ?? null,
  };
  const fn = params.allUsersUnlimitedAccess ? OVERRIDE_GATE_FN : BASE_GATE_FN;
  let { data, error } = await client.rpc(fn, args);

  if (error && fn === OVERRIDE_GATE_FN && isMissingFunctionError(error)) {
    // The override sibling ships in 20260907120000_per_user_ai_daily_cap.sql; if the edge
    // function is deployed before `supabase db push` runs, the RPC simply does not exist. Fall
    // back to the always-present `gate_ai_call` once rather than 500ing every analysis. The
    // fallback is deliberately TIGHTER, not looser: `gate_ai_call` derives the caller's real
    // tier, so an override caller temporarily gets their true (usually Free, $0.75) allowance
    // instead of Elite's $4.00. That is the correct direction of error for a spend cap —
    // degraded, not unbounded — and it self-heals the moment the migration is pushed.
    console.error(
      `[ai-guard] ${OVERRIDE_GATE_FN} is missing from the database (${error.message}). ` +
        `Run \`supabase db push\` to apply 20260907120000_per_user_ai_daily_cap.sql. ` +
        `Falling back to ${BASE_GATE_FN}, which applies the caller's REAL tier cap.`
    );
    ({ data, error } = await client.rpc(BASE_GATE_FN, args));
    if (error) {
      throw new Error(`${BASE_GATE_FN} failed: ${error.message}`);
    }
  } else if (error) {
    throw new Error(`${fn} failed: ${error.message}`);
  }

  const result = data as {
    allowed: boolean;
    call_id?: string;
    estimated_usd?: number;
    reason?: GateDenyReason;
    [key: string]: unknown;
  };

  if (result.allowed) {
    return {
      allowed: true,
      callId: result.call_id as string,
      estimatedUsd: result.estimated_usd as number,
    };
  }

  const { allowed: _allowed, reason, call_id: _callId, estimated_usd: _estimatedUsd, ...detail } = result;
  return { allowed: false, reason: reason as GateDenyReason, detail };
}

export interface RecordAiCallParams {
  callId: string;
  status: RecordCallStatus;
  usage?: RecordCallUsage;
  analysisId?: string | null;
}

/**
 * Settles a call reserved by `gateAiCall()`. Idempotent — a second call for the same `callId`
 * (a retried invocation) is a safe no-op, reported via `alreadySettled: true`, never an error.
 *
 * Call this on EVERY exit path after a successful gate, including a `'cancelled'` settle when
 * the call turns out never to be needed (an idempotent replay of an already-delivered analysis,
 * or a genuine quota denial arriving after the gate already passed — see the migration header).
 * An unsettled `'pending'` row silently eats daily-cap headroom until `pending_timeout_seconds`
 * ages it out on its own; there is no other cleanup path, so treat this like a `finally`.
 */
export async function recordAiCall(client: RpcClient, params: RecordAiCallParams): Promise<RecordResult> {
  const usage = params.usage ?? {};
  const { data, error } = await client.rpc('record_ai_call', {
    p_call_id: params.callId,
    p_status: params.status,
    p_input_tokens: usage.inputTokens ?? null,
    p_output_tokens: usage.outputTokens ?? null,
    p_cache_creation_input_tokens: usage.cacheCreationInputTokens ?? null,
    p_cache_read_input_tokens: usage.cacheReadInputTokens ?? null,
    p_analysis_id: params.analysisId ?? null,
  });

  if (error) {
    throw new Error(`record_ai_call failed: ${error.message}`);
  }

  const result = data as {
    ok: boolean;
    already_settled?: boolean;
    status?: string;
    actual_usd?: number;
    reason?: string;
  };

  return {
    ok: result.ok,
    alreadySettled: Boolean(result.already_settled),
    status: result.status,
    actualUsd: result.actual_usd,
    reason: result.reason,
  };
}

/**
 * Deny -> HTTP mapping. The design spec's rule was "all three denials are 503, not a 4xx — it is
 * our brake, not the user's fault", and that still holds for every denial that is about US:
 * `killed`, `breaker_open`, `daily_cap` (the platform-wide ceiling), and the two
 * guardrail/operator-config problems `unknown_model`/`invalid_estimate`.
 *
 * `user_daily_cap` is the one denial that is genuinely ABOUT THE CALLER — they have used their
 * own tier's allowance for the day — so it is a 429, the status that actually means that. Calling
 * it a 503 would tell the client the service is down when it is up and serving everybody else.
 * `invalid_user` is a 400: the request named no user, which is a malformed call, not an outage.
 */
export function httpStatusForGateDeny(reason: GateDenyReason): number {
  if (reason === 'user_daily_cap') {
    return 429;
  }
  if (reason === 'invalid_user') {
    return 400;
  }
  return 503;
}

/**
 * Structured `{ error, code }` body matching `docs/architecture.md`'s error contract ("every
 * non-2xx response body is structured `{ error, code }`"). The message is a deliberately generic
 * placeholder — final user-facing copy belongs in `constants/copy.ts` / `docs/design/copy-deck.md`
 * per this project's convention, not hardcoded in a shared server module; #44 should route
 * `code` through the copy deck rather than surface `error` verbatim if a nicer string exists by
 * then.
 */
export function gateDenyResponseBody(
  reason: GateDenyReason,
  detail?: Record<string, unknown>
): { error: string; code: GateDenyReason; detail?: Record<string, unknown> } {
  return {
    error:
      reason === 'user_daily_cap'
        ? "You've reached today's analysis limit for your plan. Please try again tomorrow."
        : 'Analysis is temporarily unavailable. Please try again shortly.',
    code: reason,
    detail,
  };
}
