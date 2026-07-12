/**
 * Regression locks for `ai-pricing.ts` — the pure estimate/cost math the AI spend gate (issue
 * #91) checks against the daily cap before a model call happens, and the fallback
 * `record_ai_call` uses when a call errors with no usage data at all. This is the one piece of
 * the guardrail explicitly designed to be Jest-testable (no Deno/npm: imports) even though the
 * gate itself lives in Postgres and the caller (`analyze-form`, #44) runs on Deno.
 */
import {
  AI_MODEL_PRICING,
  MAX_OUTPUT_TOKENS_BY_TIER,
  SYSTEM_PROMPT_TOKENS_ESTIMATE,
  TOKENS_PER_FRAME,
  UnknownModelError,
  computeCostUsd,
  estimateCostUsd,
  estimateTokensForCall,
} from '../ai-pricing';

describe('estimateTokensForCall', () => {
  it('adds the fixed system-prompt overhead to frameCount * TOKENS_PER_FRAME for input', () => {
    const estimate = estimateTokensForCall(5, 'pro');
    expect(estimate.inputTokens).toBe(SYSTEM_PROMPT_TOKENS_ESTIMATE + 5 * TOKENS_PER_FRAME);
  });

  it.each([
    ['free', MAX_OUTPUT_TOKENS_BY_TIER.free],
    ['pro', MAX_OUTPUT_TOKENS_BY_TIER.pro],
    ['elite', MAX_OUTPUT_TOKENS_BY_TIER.elite],
  ] as const)('uses the tier max as the worst-case output estimate (%s)', (tier, expected) => {
    expect(estimateTokensForCall(1, tier).outputTokens).toBe(expected);
  });

  it('rejects a frame count below 1 rather than silently estimating zero-frame cost', () => {
    expect(() => estimateTokensForCall(0, 'free')).toThrow(RangeError);
    expect(() => estimateTokensForCall(-1, 'free')).toThrow(RangeError);
  });

  it('rejects a non-finite frame count', () => {
    expect(() => estimateTokensForCall(Number.NaN, 'free')).toThrow(RangeError);
  });
});

describe('computeCostUsd', () => {
  const pricing = AI_MODEL_PRICING['claude-sonnet-5'];

  it('applies the plain input and output rates with no cache tokens', () => {
    // 1,000,000 input tokens @ $3/Mtok + 1,000,000 output tokens @ $15/Mtok = $18
    const cost = computeCostUsd(pricing, { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(18, 6);
  });

  it('applies the cache-write multiplier (1.25x) to cache_creation_input_tokens only', () => {
    const cost = computeCostUsd(pricing, { cacheCreationInputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(3 * 1.25, 6);
  });

  it('applies the cache-read multiplier (0.10x) to cache_read_input_tokens only', () => {
    const cost = computeCostUsd(pricing, { cacheReadInputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(3 * 0.1, 6);
  });

  it('sums all four token fields independently at their own rate — a single "tokens" field cannot do this', () => {
    const cost = computeCostUsd(pricing, {
      inputTokens: 500_000,
      outputTokens: 200_000,
      cacheCreationInputTokens: 100_000,
      cacheReadInputTokens: 300_000,
    });
    const expectedInputCost = (500_000 * 3 + 100_000 * 3 * 1.25 + 300_000 * 3 * 0.1) / 1_000_000;
    const expectedOutputCost = (200_000 * 15) / 1_000_000;
    expect(cost).toBeCloseTo(expectedInputCost + expectedOutputCost, 6);
  });

  it('treats missing/undefined/null token fields as zero, never NaN', () => {
    expect(computeCostUsd(pricing, {})).toBe(0);
    expect(
      computeCostUsd(pricing, {
        inputTokens: null,
        outputTokens: null,
        cacheCreationInputTokens: null,
        cacheReadInputTokens: null,
      })
    ).toBe(0);
  });
});

describe('estimateCostUsd', () => {
  it("lands in the design spec's rough worst-case order of magnitude for Free (1 frame, ~$0.05)", () => {
    // The design spec's $0.05 is itself a "rough worst-case" figure, not a target this module
    // reproduces exactly — SYSTEM_PROMPT_TOKENS_ESTIMATE and MAX_OUTPUT_TOKENS_BY_TIER are
    // deliberately conservative round numbers (see ai-pricing.ts), so this asserts the same
    // order of magnitude (a few cents), not a tight band.
    const cost = estimateCostUsd('claude-sonnet-5', 1, 'free');
    expect(cost).toBeGreaterThan(0.02);
    expect(cost).toBeLessThan(0.15);
  });

  it('strictly increases from Free (1 frame) to Pro (5 frames) to Elite (8 frames)', () => {
    const free = estimateCostUsd('claude-sonnet-5', 1, 'free');
    const pro = estimateCostUsd('claude-sonnet-5', 5, 'pro');
    const elite = estimateCostUsd('claude-sonnet-5', 8, 'elite');
    expect(pro).toBeGreaterThan(free);
    expect(elite).toBeGreaterThan(pro);
  });

  it('throws UnknownModelError for a model with no pricing entry, rather than estimating $0', () => {
    expect(() => estimateCostUsd('claude-opus-9', 1, 'free')).toThrow(UnknownModelError);
  });
});
