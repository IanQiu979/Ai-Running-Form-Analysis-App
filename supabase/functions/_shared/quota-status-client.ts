// Deno-only Supabase client factory for `GET /functions/v1/quota-status` (issue #50). Imported
// only by `supabase/functions/quota-status/index.ts` — never by `quota-status.ts` or its tests,
// which is what keeps that orchestration logic Deno/Jest-portable, same split as `ai-guard.ts`
// (portable) / `ai-guard-client.ts` (this file's sibling and near-exact template). NOT
// typechecked by `npm run typecheck` (see `tsconfig.json`'s `exclude` for the whole
// `supabase/functions` tree); IS checked by `deno check` (`npm run typecheck:edge`).
//
// CLAUDE.md: "Supabase auto-injects SUPABASE_URL, SUPABASE_PUBLISHABLE_KEYS, and
// SUPABASE_SECRET_KEYS into edge functions at runtime. Never set these by hand." The secret-key
// env var is plural (key-rotation-safe) — getSecretKey() accepts either a bare key string or a
// JSON array and always uses the first entry, mirroring `ai-guard-client.ts`'s /
// `delete-analysis-client.ts`'s own copy of this same helper (kept as a separate copy here
// rather than a shared import, same "limit this file's blast radius" reasoning
// `delete-analysis-client.ts`'s header already states, doubly relevant here since other agents
// may be touching `_shared/` concurrently — see issue #50's brief).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.2';
import type { RpcClient } from './quota-status.ts';
import { getSecretKey } from './supabase-keys.ts';

/**
 * A service-role Supabase client, satisfying the minimal `RpcClient` interface `getQuotaStatus()`
 * needs. `pace_quota_status` is granted to `service_role` only (per its migration —
 * `20260712233000_quota_status_function.sql`, written but NOT applied as of issue #50) —
 * `anon`/`authenticated` cannot call it, so this must never be swapped for a client built from
 * the caller's own JWT. This client is used ONLY to call `pace_quota_status`; the caller's own
 * identity is resolved separately in `index.ts` via a publishable-key client scoped to their
 * Authorization header (same split `analysis/index.ts` uses) — never trusted from the request
 * body, since a GET has none, or from any client-supplied user id.
 *
 * Wraps `client.rpc()` in an `async` function rather than returning the client's `.rpc` method
 * directly: `@supabase/supabase-js`'s `rpc()` returns a `PostgrestFilterBuilder` — thenable, but
 * not structurally a `Promise` (missing `catch`/`finally`/`Symbol.toStringTag`) — which
 * `deno check` correctly rejects against `RpcClient.rpc()`'s declared `Promise<...>` return type.
 * This is the exact issue #90/#91 `ai-guard-client.ts` bug; avoided here from the start by
 * copying its fix rather than rediscovering it.
 */
export function createQuotaStatusClient(): RpcClient {
  const url = Deno.env.get('SUPABASE_URL');
  if (!url) {
    throw new Error('SUPABASE_URL is not set in the edge function environment');
  }
  const client: SupabaseClient = createClient(url, getSecretKey(), {
    auth: { persistSession: false },
  });
  return {
    rpc: async (fn, args) => {
      const result = await client.rpc(fn, args);
      return result;
    },
  };
}
