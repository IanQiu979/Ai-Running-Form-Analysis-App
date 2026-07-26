// Deno-only Supabase client + secret wiring for `sweep-orphaned-media` (issue #137).
//
// WHY THIS ISN'T IN `_shared/`. `_shared/storage-sweep.ts`'s own header comment anticipated this
// exact file: "A future `storage-sweep-client.ts` would own the real `npm:@supabase/supabase-js`
// wiring... not written here because nothing calls it yet." That "future" is this issue — but this
// issue's owned file lane (per the parallel-worktree file-ownership rule this batch runs under) is
// `supabase/functions/sweep-orphaned-media/**` only; `storage-sweep.ts` itself and the rest of
// `_shared/` are other lanes' territory this round. Keeping the client wiring local to this
// function's own directory gets the same result (a thin, testable seam between pure logic and the
// real network) without touching a file outside this issue's lane.
//
// Mirrors `_shared/delete-account-client.ts` / `_shared/ai-guard-client.ts`'s pattern exactly:
// service-role client construction, the `SUPABASE_SECRET_KEYS` array-or-bare-string parsing, and —
// per `ai-guard-client.ts`'s own comment — wrapping `client.rpc()` in an `async` function because
// `@supabase/supabase-js`'s `.rpc()` returns a `PostgrestFilterBuilder` (thenable, but not
// structurally a `Promise`), which `deno check` correctly rejects against `RpcClient.rpc()`'s
// declared `Promise<...>` return type.
//
// NOT typechecked by `npm run typecheck` (tsconfig.json excludes all of `supabase/functions/`); IS
// checked by `deno check` (`npm run typecheck:edge`).
//
// CLAUDE.md: "Supabase auto-injects SUPABASE_URL, SUPABASE_PUBLISHABLE_KEYS, and
// SUPABASE_SECRET_KEYS into edge functions at runtime. Never set these by hand." The one secret
// THIS file reads that Supabase does NOT inject — `SWEEP_ORPHANED_MEDIA_SECRET` — is Ian's to set,
// once, via `supabase secrets set` (production) / `supabase/functions/.env` (local dev). It is the
// shared secret `core.ts`'s `checkCronAuth` compares the `X-Cron-Secret` header against; it must
// NEVER be the same value as any client-facing key and must NEVER get an `EXPO_PUBLIC_` prefix.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.2';
import type { RpcClient, StorageBucket } from '../_shared/storage-sweep.ts';
import { getSecretKey } from '../_shared/supabase-keys.ts';

const MEDIA_BUCKET = 'media';

/** Deliberately NOT thrown on missing — `checkCronAuth` (`core.ts`) treats a missing/undefined
 * expected secret as an explicit `missing_secret_config` deny, not a crash. A 500 here would be
 * indistinguishable in the Dashboard Cron Job's run history from a real infrastructure failure; a
 * clean 401 with a `missing_secret_config` reason in the structured log is a far faster diagnosis
 * the one time this actually happens (the secret not yet provisioned in production). */
export function getCronSecret(): string | null {
  return Deno.env.get('SWEEP_ORPHANED_MEDIA_SECRET') ?? null;
}

export interface SweepDeps {
  rpc: RpcClient;
  storage: StorageBucket;
}

/**
 * A service-role Supabase client satisfying both `RpcClient` (for the `list_orphaned_media_prefixes`
 * detection RPC, service_role-only per `20260713152000_storage_user_budget.sql`'s own grant) and
 * `StorageBucket` (for the real `media`-bucket list/remove calls `_shared/storage-sweep.ts`'s
 * `sweepOrphanedMediaPrefixes` needs to actually purge anything — `storage.objects` grants
 * `authenticated` SELECT only, so this must never be swapped for a client built from a caller's own
 * JWT).
 */
export function createSweepDeps(): SweepDeps {
  const url = Deno.env.get('SUPABASE_URL');
  if (!url) {
    throw new Error('SUPABASE_URL is not set in the edge function environment');
  }
  const client: SupabaseClient = createClient(url, getSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rpc: RpcClient = {
    rpc: async (fn, args) => {
      const result = await client.rpc(fn, args);
      return result;
    },
  };

  const storage: StorageBucket = {
    async list(prefix, { limit, offset }) {
      const { data, error } = await client.storage.from(MEDIA_BUCKET).list(prefix, {
        limit,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) {
        throw new Error(`Failed to list storage prefix "${prefix}": ${error.message}`);
      }
      // Supabase Storage represents a pseudo-directory as an entry with `id: null` — the exact
      // signal `storage-sweep.ts`'s `collectFiles` recursion depends on to avoid the nested-prefix
      // trap (same note `delete-account-client.ts`/`delete-analysis-client.ts` carry).
      return (data ?? []).map((entry) => ({ name: entry.name, isFolder: entry.id === null }));
    },

    async remove(paths) {
      const { error } = await client.storage.from(MEDIA_BUCKET).remove(paths);
      return { error: error ? error.message : null };
    },
  };

  return { rpc, storage };
}
