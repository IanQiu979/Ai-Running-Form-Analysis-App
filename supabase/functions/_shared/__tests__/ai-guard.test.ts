/**
 * Regression locks for `ai-guard.ts` — the orchestration layer `analyze-form` (#44, not built
 * here) is required to call around every Anthropic request. These tests mock the RPC transport
 * (`RpcClient`) rather than a real Postgres connection, so they prove the CONTRACT: what
 * `gateAiCall`/`recordAiCall` send to `gate_ai_call`/`record_ai_call` and how they interpret the
 * response — specifically the three refusal cases the issue calls out (cap exceeded, kill switch
 * on, breaker open) and that settle accounting round-trips correctly. They cannot prove the SQL
 * functions themselves behave correctly under concurrency — that needs a live/local Postgres,
 * which this repo has no harness for yet (see the design spec's "Testing" section and this
 * task's summary for why live verification against the hosted project was not run here).
 */
import {
  gateAiCall,
  gateDenyResponseBody,
  httpStatusForGateDeny,
  recordAiCall,
  type GateDenyReason,
  type RpcClient,
} from '../ai-guard';

function mockClient(response: { data: unknown; error: { message: string } | null }): RpcClient {
  return { rpc: jest.fn().mockResolvedValue(response) };
}

describe('gateAiCall', () => {
  it('returns allowed:true with the callId and estimate on a fresh allow', async () => {
    const client = mockClient({
      data: { allowed: true, call_id: 'call-1', estimated_usd: 0.0512 },
      error: null,
    });
    const result = await gateAiCall(client, {
      userId: 'u1',
      estimatedInputTokens: 7600,
      estimatedOutputTokens: 4000,
    });
    expect(result).toEqual({ allowed: true, callId: 'call-1', estimatedUsd: 0.0512 });
  });

  it('forwards params to gate_ai_call by the RPC arg names the SQL function expects', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { allowed: true, call_id: 'c', estimated_usd: 1 },
      error: null,
    });
    await gateAiCall(
      { rpc },
      {
        userId: 'u1',
        estimatedInputTokens: 100,
        estimatedOutputTokens: 200,
        analysisId: 'a1',
      }
    );
    expect(rpc).toHaveBeenCalledWith('gate_ai_call', {
      p_user_id: 'u1',
      p_estimated_input_tokens: 100,
      p_estimated_output_tokens: 200,
      p_model: 'claude-sonnet-5',
      p_analysis_id: 'a1',
    });
  });

  it('refuses the call when the kill switch is off (allowed:false, reason:"killed")', async () => {
    const client = mockClient({
      data: { allowed: false, reason: 'killed', disabled_reason: 'maintenance' },
      error: null,
    });
    const result = await gateAiCall(client, {
      userId: 'u1',
      estimatedInputTokens: 1,
      estimatedOutputTokens: 1,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe('killed');
      expect(result.detail).toEqual({ disabled_reason: 'maintenance' });
    }
  });

  it('refuses the call when the daily cap would be exceeded (allowed:false, reason:"daily_cap")', async () => {
    const client = mockClient({
      data: { allowed: false, reason: 'daily_cap', spent_usd: 9.98, estimated_usd: 0.05, cap_usd: 10 },
      error: null,
    });
    const result = await gateAiCall(client, {
      userId: 'u1',
      estimatedInputTokens: 1,
      estimatedOutputTokens: 1,
    });
    expect(result).toMatchObject({ allowed: false, reason: 'daily_cap' });
  });

  it('refuses the call when the circuit breaker is open (allowed:false, reason:"breaker_open")', async () => {
    const client = mockClient({
      data: { allowed: false, reason: 'breaker_open', breaker: { open: true, consecutive_failures: 5 } },
      error: null,
    });
    const result = await gateAiCall(client, {
      userId: 'u1',
      estimatedInputTokens: 1,
      estimatedOutputTokens: 1,
    });
    expect(result).toMatchObject({ allowed: false, reason: 'breaker_open' });
  });

  it('throws on a transport/DB error rather than returning a silent allow', async () => {
    const client = mockClient({ data: null, error: { message: 'connection reset' } });
    await expect(
      gateAiCall(client, { userId: 'u1', estimatedInputTokens: 1, estimatedOutputTokens: 1 })
    ).rejects.toThrow(/gate_ai_call failed/);
  });
});

describe('recordAiCall', () => {
  it('settles a call and reports the real cost the RPC returned, unchanged (accounting round-trips)', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { ok: true, already_settled: false, status: 'success', actual_usd: 0.0421 },
      error: null,
    });
    const result = await recordAiCall(
      { rpc },
      {
        callId: 'call-1',
        status: 'success',
        usage: { inputTokens: 7600, outputTokens: 3200 },
      }
    );
    expect(rpc).toHaveBeenCalledWith('record_ai_call', {
      p_call_id: 'call-1',
      p_status: 'success',
      p_input_tokens: 7600,
      p_output_tokens: 3200,
      p_cache_creation_input_tokens: null,
      p_cache_read_input_tokens: null,
      p_analysis_id: null,
    });
    expect(result).toMatchObject({ ok: true, alreadySettled: false, status: 'success', actualUsd: 0.0421 });
  });

  it('reports alreadySettled:true on a retried settle without throwing (idempotent)', async () => {
    const client = mockClient({
      data: { ok: true, already_settled: true, status: 'success', actual_usd: 0.0421 },
      error: null,
    });
    const result = await recordAiCall(client, { callId: 'call-1', status: 'success' });
    expect(result.alreadySettled).toBe(true);
    expect(result.actualUsd).toBe(0.0421);
  });

  it('sends null usage fields for a cancelled settle (the caller never had usage to report)', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { ok: true, already_settled: false, status: 'cancelled', actual_usd: 0 },
      error: null,
    });
    await recordAiCall({ rpc }, { callId: 'call-1', status: 'cancelled' });
    expect(rpc).toHaveBeenCalledWith(
      'record_ai_call',
      expect.objectContaining({
        p_status: 'cancelled',
        p_input_tokens: null,
        p_output_tokens: null,
        p_cache_creation_input_tokens: null,
        p_cache_read_input_tokens: null,
      })
    );
  });

  it('throws on a transport/DB error', async () => {
    const client = mockClient({ data: null, error: { message: 'timeout' } });
    await expect(recordAiCall(client, { callId: 'call-1', status: 'model_error' })).rejects.toThrow(
      /record_ai_call failed/
    );
  });
});

describe('httpStatusForGateDeny / gateDenyResponseBody', () => {
  const reasons: GateDenyReason[] = ['killed', 'breaker_open', 'daily_cap', 'unknown_model', 'invalid_estimate'];

  it.each(reasons)('maps deny reason "%s" to 503, not a 4xx — it is the brake, not the caller\'s fault', (reason) => {
    expect(httpStatusForGateDeny(reason)).toBe(503);
  });

  it('returns a structured { error, code } body matching the project error contract', () => {
    const body = gateDenyResponseBody('daily_cap', { spent_usd: 9.98 });
    expect(body.code).toBe('daily_cap');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
    expect(body.detail).toEqual({ spent_usd: 9.98 });
  });
});
