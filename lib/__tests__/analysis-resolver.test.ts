import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

const mockRpc = supabase.rpc as jest.MockedFunction<typeof supabase.rpc>;

import { resolveAnalysisRequest } from '../analysis-resolver';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('resolveAnalysisRequest', () => {
  it('uses the authenticated resolver RPC and returns its owner-scoped row', async () => {
    const row = {
      id: 'c0000000-0000-0000-0000-000000000003',
      status: 'delivered' as const,
      result: { tier: 'free' },
      is_fallback: false,
    };
    mockRpc.mockResolvedValue({ data: row, error: null } as never);

    await expect(resolveAnalysisRequest('request-key')).resolves.toEqual(row);
    expect(mockRpc).toHaveBeenCalledWith('resolve_analysis_request', {
      p_idempotency_key: 'request-key',
    });
  });

  it('returns null when no canonical or legacy request row belongs to the session', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null } as never);

    await expect(resolveAnalysisRequest('missing-key')).resolves.toBeNull();
  });

  it('throws on RPC errors so reconciliation callers can preserve their pending marker', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'network down' } } as never);

    await expect(resolveAnalysisRequest('request-key')).rejects.toThrow(
      'resolve_analysis_request failed: network down'
    );
  });

  it('rejects malformed RPC data rather than routing to an arbitrary analysis id', async () => {
    mockRpc.mockResolvedValue({
      data: { id: 'not-an-id', status: 'delivered', result: {}, is_fallback: false },
      error: null,
    } as never);

    await expect(resolveAnalysisRequest('request-key')).rejects.toThrow(
      'resolve_analysis_request returned an invalid row'
    );
  });
});
