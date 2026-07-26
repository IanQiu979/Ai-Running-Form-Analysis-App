// Deno-only Supabase client factory for `POST /functions/v1/purchase-tier` (issue #51). Imported
// only by `supabase/functions/purchase-tier/index.ts` — never by `purchase-tier.ts` or its tests,
// which is what keeps that orchestration logic Deno/Jest-portable, same split as `quota-status.ts`
// (portable) / `quota-status-client.ts` (this file's sibling and near-exact template). NOT
// typechecked by `npm run typecheck` (see `tsconfig.json`'s `exclude` for the whole
// `supabase/functions` tree); IS checked by `deno check` (`npm run typecheck:edge`).
//
// CLAUDE.md: "Supabase auto-injects SUPABASE_URL, SUPABASE_PUBLISHABLE_KEYS, and
// SUPABASE_SECRET_KEYS into edge functions at runtime. Never set these by hand." The secret-key
// env var is plural (key-rotation-safe) — getSecretKey() accepts either a bare key string or a
// JSON array and always uses the first entry, mirroring `quota-status-client.ts`'s /
// `ai-guard-client.ts`'s / `delete-analysis-client.ts`'s own copy of this same helper (kept as a
// separate copy rather than a shared import, same "limit this file's blast radius" reasoning those
// headers state — other agents are editing `_shared/` concurrently).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.2';
import type { RpcClient } from './purchase-tier.ts';
import { getSecretKey } from './supabase-keys.ts';

/**
 * A service-role Supabase client, satisfying the minimal `RpcClient` interface `purchaseTier()`
 * needs.
 *
 * THE SERVICE ROLE IS THE WHOLE POINT, AND IT IS ALSO THE DANGER. `public.subscriptions` has a
 * SELECT policy and NO insert/update policy for `authenticated` — deliberately, because a
 * client-writable policy there would let any user self-grant elite for free with one REST call
 * (Echo V1 shipped exactly that policy and had to remove it; see
 * `20260711150100_subscriptions.sql`'s comment). This client, holding the service-role key, is
 * the ONLY thing that can write that table, and `pace_purchase_tier` is granted to `service_role`
 * only. So this client must never be swapped for one built from the caller's JWT — and, just as
 * importantly, it must never be used to RESOLVE the caller's identity. `index.ts` does that with a
 * separate publishable-key client scoped to the caller's Authorization header (same split
 * `quota-status/index.ts` and `analysis/index.ts` use); the id it derives is what gets passed to
 * `purchaseTier()`. Using this client for both jobs would mean a request body could name any user.
 *
 * Wraps `client.rpc()` in an `async` function rather than returning the client's `.rpc` method
 * directly: `@supabase/supabase-js`'s `rpc()` returns a `PostgrestFilterBuilder` — thenable, but
 * not structurally a `Promise` (missing `catch`/`finally`/`Symbol.toStringTag`) — which
 * `deno check` correctly rejects against `RpcClient.rpc()`'s declared `Promise<...>` return type.
 * This is the exact issue #90/#91 `ai-guard-client.ts` bug; avoided here from the start by copying
 * its fix rather than rediscovering it.
 */
export function createPurchaseTierClient(): RpcClient {
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
