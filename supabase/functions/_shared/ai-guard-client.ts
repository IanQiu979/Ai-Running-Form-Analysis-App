// Deno-only Supabase client factory for the AI spend gate (issue #91). Imported only by
// `supabase/functions/analyze-form` (#44, not built here) — never by `ai-guard.ts`,
// `ai-pricing.ts`, or any Jest test, which is what keeps those files Node/Jest-portable. This
// file is NOT typechecked by `npm run typecheck` (see `tsconfig.json`'s `exclude` — the whole
// `supabase/functions` tree runs under Deno, a different module/type system than the Expo app's
// `tsc` project) and is NOT covered by Jest — there's nothing pure to test here, it's a thin
// factory over Deno globals that only exist at edge-function runtime. It IS now checked by
// `deno check` (issue #90, wired as `npm run typecheck:edge`) — that check is what caught the
// `rpc()` return-type mismatch fixed below; see `createAiGuardClient`'s comment.
//
// CLAUDE.md: "Supabase auto-injects SUPABASE_URL, SUPABASE_PUBLISHABLE_KEYS, and
// SUPABASE_SECRET_KEYS into edge functions at runtime. Never set these by hand." The secret-key
// env var is plural (Supabase's key-rotation-safe API-keys system can hold more than one active
// secret key at once) — getSecretKey() below accepts either a bare key string or a JSON array
// and always uses the first entry, so it works whichever shape the runtime hands back.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.2';
import type { RpcClient } from './ai-guard.ts';
import { getSecretKey } from './supabase-keys.ts';

/**
 * A service-role Supabase client, satisfying the minimal `RpcClient` interface `gateAiCall()`
 * and `recordAiCall()` need. `gate_ai_call` / `record_ai_call` / `ai_spend_today` are all
 * granted to `service_role` only (see the migration) — `anon`/`authenticated` cannot call them,
 * so this must never be swapped for a client built from the caller's own JWT.
 *
 * Wraps `client.rpc()` in an `async` function rather than returning the client's `.rpc` method
 * (or the client itself) directly: `@supabase/supabase-js`'s `rpc()` returns a
 * `PostgrestFilterBuilder` — thenable, but not structurally a `Promise` (it's missing `catch`/
 * `finally`/`Symbol.toStringTag`), which `deno check` (issue #90) correctly rejects against
 * `RpcClient.rpc()`'s declared `Promise<...>` return type. An `async` wrapper always returns a
 * real `Promise`, satisfying the interface with no behavior change — same call, same awaited
 * result.
 */
export function createAiGuardClient(): RpcClient {
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
