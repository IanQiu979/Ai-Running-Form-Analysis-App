/**
 * Pure spend-guardrail math for the AI gate (issue #91). Zero imports, zero side effects,
 * deliberately — this file is unit-testable under Jest even though the edge function that will
 * eventually call it (`supabase/functions/analyze-form`, issue #44, not built here) runs under
 * Deno, not Node. See `supabase/functions/_shared/ai-guard.ts` for how this plugs into the gate.
 *
 * This is the PRE-CALL ESTIMATE side only. `gate_ai_call` (in
 * `supabase/migrations/20260712210100_ai_spend_guardrail_functions.sql`) checks a call's
 * estimated cost against the daily cap before the model is ever invoked; `record_ai_call`
 * computes the REAL cost from real token counts against `public.ai_model_pricing` once the call
 * is known. `AI_MODEL_PRICING` below is a deliberate, manually-kept-in-sync mirror of that
 * table's seed row — not automatically synced — because this copy only ever feeds a *pre-call*
 * estimate; `ai_model_pricing` is the sole source of truth for what actually gets billed. If the
 * price changes, update both places (a DB `UPDATE` there, a code change + redeploy here).
 */

export type AnalysisTier = 'free' | 'pro' | 'elite';

export interface ModelPricing {
  inputUsdPerMtok: number;
  outputUsdPerMtok: number;
  cacheWriteMultiplier: number;
  cacheReadMultiplier: number;
}

// Mirrors the seed row in 20260712210000_ai_spend_guardrails.sql: claude-sonnet-5 at Anthropic's
// LIST price ($3/M input, $15/M output), deliberately not the cheaper introductory rate (through
// 2026-08-31) — every estimate computed from this errs conservative, never optimistic.
export const AI_MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-5': {
    inputUsdPerMtok: 3.0,
    outputUsdPerMtok: 15.0,
    cacheWriteMultiplier: 1.25,
    cacheReadMultiplier: 0.1,
  },
};

// Frames are capped at 1568px on the long edge (docs/architecture.md, media pipeline), which
// puts each frame at roughly 1600 image tokens under Anthropic's vision pricing.
export const TOKENS_PER_FRAME = 1600;

// Every input token of a call that is NOT a frame: the system prompt (the certified PACE
// knowledge — framework + injury flags + drills — bundled with the function, not fetched per
// call), the user turn's text blocks, the `tools` parameter (a tool schema is billed as input
// too, and this one is ~3.7k tokens of descriptions), and the ~474-token tool-use system prompt
// the API prepends when `tool_choice` is forced on claude-sonnet-5.
//
// MEASURED against the real prompt as of issue #41 (`analyze-form-prompt.ts`), which is what the
// original 6000 here was a placeholder for ("refine once it exists"). 6000 was not conservative —
// it under-reserved every call by ~3.5x, which on a hard credit ceiling with auto-reload off is
// the wrong direction to be wrong in.
//
// TWO THINGS DRIVE THE NUMBER, AND THE SECOND IS EASY TO MISS:
//   1. Size. The assembled prompt is ~57k characters at Elite (system + user text + the tool
//      schema, which is ~13k characters of descriptions and is billed as input like everything
//      else in `tools`).
//   2. Claude Sonnet 5's NEW TOKENIZER, which produces "approximately 30% more tokens for the
//      same text" than Sonnet 4.6. The familiar ~3.5-4 chars/token rule of thumb is a PRE-Sonnet-5
//      heuristic and silently under-counts here. Budgeting at ~2.7 chars/token instead puts the
//      Elite worst case at ~21.5k tokens (plus the ~474-token forced-tool system prompt).
//      Anthropic's own migration guidance is blunt about this: "Don't reuse counts measured
//      against earlier models; recount against Claude Sonnet 5."
//
// 24000 rounds that up with ~11% headroom. `analyze-form-prompt.deno.test.ts`'s "the spend gate's
// estimate still covers the real prompt" test re-measures the assembled prompt at 2.7 chars/token
// and fails if it ever outgrows this constant again.
//
// Still deliberately conservative in the two ways that matter: it rounds up, and it prices every
// input token as uncached even though the prompt sets `cache_control: ephemeral` over the
// knowledge + tools prefix, so the steady state is a 0.1x cache read. Erring high only ever makes
// the gate stricter, never laxer.
//
// TODO(#44): pin this exactly with Anthropic's `/v1/messages/count_tokens` endpoint (it is free
// and does not consume credits) before the first production call, and replace the heuristic.
// RAISED 24000 -> 25500 on 2026-09-06, when the per-pillar `safety` declaration
// (`pace.ts`'s `PaceSafety`) was added to the output schema — its descriptions ride in the prompt
// four times, once per pillar. `analyze-form-prompt.deno.test.ts`'s spend-gate test measures the
// real assembled prompt (~24.5k) and fails if this constant ever falls under it again.
export const SYSTEM_PROMPT_TOKENS_ESTIMATE = 25500;

// docs/architecture.md step 7: "max_tokens 4-8k", tier-scaled per step 6's verbosity dial (Free
// gets scores + one line per pillar and no drills; Pro fuller feedback + injury flags + drills;
// Elite a small bump over Pro). Worst case assumes the model uses the full output budget every
// time, matching the design spec's own "rough worst-case per analysis" framing.
export const MAX_OUTPUT_TOKENS_BY_TIER: Record<AnalysisTier, number> = {
  free: 4000,
  pro: 6000,
  elite: 8000,
};

// -------------------------------------------------------------------------------------------
// The measured worst case each budget must cover (2026-10-06, after PR #250's deeper `analysis`)
// -------------------------------------------------------------------------------------------
//
// A truncation (`stop_reason: 'max_tokens'`) is never usable: it releases the reservation as
// `model_error` and the runner gets a 503 with no result. Because identical evidence costs the
// same tokens on the next try, an undersized budget fails every retry of the same clip, so a
// budget must cover the WORST realistic output at the effort production actually sends. These are
// the largest single-call `output_tokens` (thinking + text) observed per tier x medium, and the
// effort they were observed at. A sample taken at a HIGHER effort than production is a valid upper
// bound (higher effort only spends more thinking), never a lower one.
//
// Worth knowing before touching any number here:
//   - PR #250 (Pro 5-7 / Elite 7-9 `analysis` sentences per assessed pillar) roughly doubled Pro
//     video output at effort `low` (1,374-1,520 -> 2,804-3,043) and grew Elite/8 by ~40%
//     (2,011-2,614 -> 3,496). See `stride-burst-latency.results.json` for the pre-#250 baseline.
//   - Run-to-run spread on identical frames is ~±15% (Elite/8, low, N=7: 2,011-2,614).
//   - At effort `medium` a paid four-pillar video spends 6,000+ tokens in ~70-75s, which is why the
//     grounding eval's old `--effort medium` default truncated Pro (run 37411823324) while
//     production (`low`) never did. Raising `max_tokens` cannot rescue `medium`: at the measured
//     ~80 tokens/s the 80s per-attempt timeout (`MODEL_CALL_TIMEOUT_MS`) caps a single attempt at
//     ~6,400 tokens, so a bigger budget only turns a fast truncation into a slow timeout. Moving
//     `ANALYZE_FORM_EFFORT` off `low` therefore means re-measuring this table first.
//
// `ai-pricing.test.ts` fails if any budget drops below `requiredOutputBudget` of its measured
// worst case; `analyze-form-prompt.deno.test.ts` fails if that headroom-scaled worst case could
// not even be generated inside one attempt's timeout, or if this table's effort stops matching
// `ANALYZE_FORM_EFFORT`.
export type MeasuredMedia = 'photo' | 'video';

export interface MeasuredOutput {
  /** Largest observed `usage.output_tokens` for one call. */
  outputTokens: number;
  /** `output_config.effort` the sample ran at — production's or higher. */
  effort: 'low' | 'medium';
  /** Where the number came from, so the next person can re-run it. */
  source: string;
}

/** The effort every `low` row above was measured at; must equal `ANALYZE_FORM_EFFORT`. */
export const MEASURED_OUTPUT_EFFORT = 'low' as const;

/** Run-to-run spread on identical frames (Elite/8, low, N=7: max/mean ~1.13). */
export const OUTPUT_VARIANCE_FACTOR = 1.15;

/** Required budget over a sample taken AT production effort: the spread above, plus ~30% for
 * prompt drift between re-measurements. A sample taken at a higher effort already sits 1.6-2x
 * above its `low` equivalent (paid video: 6,000+ vs 3,043, 6,080 vs 3,768), so it needs only
 * `OUTPUT_VARIANCE_FACTOR` on top — see `requiredOutputBudget`. */
export const OUTPUT_BUDGET_HEADROOM = 1.5;

/** Measured end-to-end output throughput (tokens / wall-clock second, input processing included)
 * of the slowest paid-video call: 6,080 tokens in 75.3s (Elite, medium, run 37411823324). */
export const MEASURED_OUTPUT_TOKENS_PER_SECOND = 80;

export const MEASURED_WORST_OUTPUT_TOKENS: Record<AnalysisTier, Record<MeasuredMedia, MeasuredOutput>> = {
  free: {
    // No post-#250 `low` sample yet; the `medium` CI samples are upper bounds.
    photo: { outputTokens: 1307, effort: 'medium', source: 'grounding eval still-free, run 37411823324' },
    video: { outputTokens: 2995, effort: 'medium', source: 'grounding eval stride-video-free, run 37411823324' },
  },
  pro: {
    photo: { outputTokens: 2044, effort: 'medium', source: 'grounding eval still-pro, run 37411823324' },
    video: { outputTokens: 3043, effort: 'low', source: 'grounding eval stride-video-pro, 2026-10-06 (real Arakawa clip: 2,804)' },
  },
  elite: {
    // A photo assesses at most two pillars from one frame, so it never outgrows the tier's video.
    photo: { outputTokens: 3768, effort: 'low', source: 'bounded by the Elite video row' },
    video: { outputTokens: 3768, effort: 'low', source: 'grounding eval stride-video-elite 5 frames, 2026-10-06 (real Arakawa clip at 8 frames: 3,496)' },
  },
};

export interface TokenEstimate {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Worst-case token estimate for a call, from inputs known before the model is ever invoked:
 * frame count and tier. The gate's daily cap is checked against the $ value derived from this,
 * and `record_ai_call` falls back to that estimate wholesale when a call errors with no usage
 * data at all — so overestimating trades a slightly tighter cap for never under-counting real
 * risk, which is the intended direction of error.
 */
export function estimateTokensForCall(frameCount: number, tier: AnalysisTier): TokenEstimate {
  if (!Number.isFinite(frameCount) || frameCount < 1) {
    throw new RangeError(`frameCount must be a finite number >= 1, got ${frameCount}`);
  }
  return {
    inputTokens: SYSTEM_PROMPT_TOKENS_ESTIMATE + frameCount * TOKENS_PER_FRAME,
    outputTokens: MAX_OUTPUT_TOKENS_BY_TIER[tier],
  };
}

export interface CallTokens {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
}

/**
 * Rate application across all four token fields — the same formula `record_ai_call` runs in SQL
 * against `public.ai_model_pricing`, mirrored here so the pre-call estimate and the "no usage
 * data" settle fallback are computed the same way a real settle would be. Cache-write tokens
 * cost MORE than a plain input token (`cacheWriteMultiplier`, 1.25x by default); cache-read
 * tokens cost much LESS (`cacheReadMultiplier`, 0.10x). Output tokens are never eligible for
 * either multiplier. Missing/undefined fields are treated as zero, never `NaN`.
 */
export function computeCostUsd(pricing: ModelPricing, tokens: CallTokens): number {
  const billableInputTokens =
    (tokens.inputTokens ?? 0) +
    (tokens.cacheCreationInputTokens ?? 0) * pricing.cacheWriteMultiplier +
    (tokens.cacheReadInputTokens ?? 0) * pricing.cacheReadMultiplier;

  const inputCost = (billableInputTokens * pricing.inputUsdPerMtok) / 1_000_000;
  const outputCost = ((tokens.outputTokens ?? 0) * pricing.outputUsdPerMtok) / 1_000_000;

  return inputCost + outputCost;
}

export class UnknownModelError extends Error {
  constructor(public readonly model: string) {
    super(`No pricing entry for model "${model}"`);
    this.name = 'UnknownModelError';
  }
}

function pricingFor(model: string): ModelPricing {
  const pricing = AI_MODEL_PRICING[model];
  if (!pricing) {
    throw new UnknownModelError(model);
  }
  return pricing;
}

/** Worst-case pre-call $ estimate for a given frame count/tier, at `model`'s list price. */
export function estimateCostUsd(model: string, frameCount: number, tier: AnalysisTier): number {
  const pricing = pricingFor(model);
  const tokens = estimateTokensForCall(frameCount, tier);
  return computeCostUsd(pricing, {
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
  });
}

/**
 * The smallest `max_tokens` that covers a measured worst case with headroom: x
 * `OUTPUT_BUDGET_HEADROOM` for a sample at production effort, x `OUTPUT_VARIANCE_FACTOR` for an
 * upper-bound sample taken at a higher effort.
 */
export function requiredOutputBudget(sample: MeasuredOutput): number {
  const factor =
    sample.effort === MEASURED_OUTPUT_EFFORT ? OUTPUT_BUDGET_HEADROOM : OUTPUT_VARIANCE_FACTOR;
  return Math.ceil(sample.outputTokens * factor);
}
