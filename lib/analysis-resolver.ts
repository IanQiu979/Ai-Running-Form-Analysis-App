import { supabase } from './supabase';

export interface AnalysisRequestResolution {
  id: string;
  status: 'reserved' | 'delivered' | 'released';
  result: unknown;
  is_fallback: boolean;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAnalysisRequestResolution(value: unknown): value is AnalysisRequestResolution {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    UUID_PATTERN.test(row.id) &&
    (row.status === 'reserved' || row.status === 'delivered' || row.status === 'released') &&
    typeof row.is_fallback === 'boolean' &&
    'result' in row
  );
}

/**
 * Resolve either the owner request key or a canonical-result alias through the authenticated,
 * owner-scoped RPC. The claim tables and their content fingerprints remain service-only.
 */
export async function resolveAnalysisRequest(
  idempotencyKey: string
): Promise<AnalysisRequestResolution | null> {
  const { data, error } = await supabase.rpc('resolve_analysis_request', {
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    throw new Error(`resolve_analysis_request failed: ${error.message}`);
  }
  if (data === null) return null;
  if (!isAnalysisRequestResolution(data)) {
    throw new Error('resolve_analysis_request returned an invalid row');
  }
  return data;
}
