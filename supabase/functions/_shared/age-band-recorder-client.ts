// Deno-only factory for `age-band-recorder.ts`'s `AgeBandRpc` — a secret-key supabase-js client,
// because `pace_record_age_band` is EXECUTE-granted to `service_role` only (the migration revokes
// it from `anon`/`authenticated` so PostgREST never exposes it to a client). Imported by
// `signup-with-captcha/index.ts` and `record-age-band/index.ts`; never by the portable modules or
// their tests. Same shape as `quota-status-client.ts`; the key parsing is `supabase-keys.ts`'s
// (CLAUDE.md: never a local copy).
import { createClient } from 'npm:@supabase/supabase-js@2.110.2';
import type { AgeBandRpc } from './age-band-recorder.ts';
import { getSecretKey, getSupabaseUrl } from './supabase-keys.ts';

export function createAgeBandRpc(): AgeBandRpc {
  const client = createClient(getSupabaseUrl(), getSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    rpc: async (fn, args) => {
      const { error } = await client.rpc(fn, args);
      return { error: error ? { message: error.message } : null };
    },
  };
}
