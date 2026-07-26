// Deno-only Supabase client factory for `DELETE /functions/v1/analysis/:id` (issue #57).
// Imported only by `supabase/functions/analysis/index.ts` — never by `delete-analysis.ts` or its
// tests, which is what keeps that orchestration logic Deno/Jest-portable, same split as
// `ai-guard.ts` (portable) / `ai-guard-client.ts` (this file's sibling, Deno-only, untested for
// the same reason: it is a thin factory over `Deno.env`/`npm:` globals that only exist at edge-
// function runtime — nothing pure to unit-test here). NOT typechecked by `npm run typecheck`
// (see `tsconfig.json`'s `exclude` for the whole `supabase/functions` tree); IS checked by
// `deno check` (`npm run typecheck:edge`).
//
// CLAUDE.md: "Supabase auto-injects SUPABASE_URL, SUPABASE_PUBLISHABLE_KEYS, and
// SUPABASE_SECRET_KEYS into edge functions at runtime. Never set these by hand." The secret-key
// env var is plural (key-rotation-safe) — getSecretKey() accepts either a bare key string or a
// JSON array and always uses the first entry, mirroring ai-guard-client.ts's own helper (kept as
// a separate copy here rather than a shared import, to keep this file's blast radius — and any
// merge collision with the parallel #44/#58 work also touching `_shared/` — limited to this one
// file).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.2';
import type { AnalysesTable, AnalysisOwnershipRow, StorageBucket } from './delete-analysis.ts';
import { getSecretKey } from './supabase-keys.ts';

const MEDIA_BUCKET = 'media';

/**
 * A service-role Supabase client's `analyses`/Storage surface, satisfying `AnalysesTable` and
 * `StorageBucket`. Service-role bypasses RLS entirely (verified live against the hosted project
 * before writing this function: `service_role` holds unrestricted table-level grants on both
 * `public.analyses` and `storage.objects`), so this can read any row and purge any prefix — the
 * ownership check in `deleteAnalysis()` is the only thing standing between that and a
 * cross-user delete, which is why it happens in code, not in a WHERE clause here.
 */
export function createDeleteAnalysisDeps(): { analyses: AnalysesTable; storage: StorageBucket } {
  const url = Deno.env.get('SUPABASE_URL');
  if (!url) {
    throw new Error('SUPABASE_URL is not set in the edge function environment');
  }
  const client: SupabaseClient = createClient(url, getSecretKey(), {
    auth: { persistSession: false },
  });

  const analyses: AnalysesTable = {
    async findById(id) {
      const { data, error } = await client
        .from('analyses')
        .select('id, user_id, deleted_at')
        .eq('id', id)
        .maybeSingle();
      if (error) {
        throw new Error(`Failed to look up analysis "${id}": ${error.message}`);
      }
      return (data as AnalysisOwnershipRow | null) ?? null;
    },

    async markDeleted(id, userId) {
      // `.is('deleted_at', null)` is what makes this a safe no-op on a retry or on a row the
      // client already soft-deleted directly (issue #2's UPDATE policy): the WHERE clause then
      // matches zero rows, `data` comes back empty, and `updated: false` tells the caller this
      // was already done rather than treating it as a failure. The trigger installed by
      // `20260712040000_analyses_quota_soft_delete.sql` (`redact_analyses_on_soft_delete`, a
      // plain table trigger — it fires for any role, not just `authenticated`) stamps the real
      // `deleted_at` and redacts `result`/`media_paths` regardless of what value is sent here.
      const { data, error } = await client
        .from('analyses')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .select('id');
      if (error) {
        throw new Error(`Failed to mark analysis "${id}" deleted: ${error.message}`);
      }
      return { updated: (data?.length ?? 0) > 0 };
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
      // signal `delete-analysis.ts`'s nested-prefix recursion depends on.
      return (data ?? []).map((entry) => ({ name: entry.name, isFolder: entry.id === null }));
    },

    async remove(paths) {
      const { error } = await client.storage.from(MEDIA_BUCKET).remove(paths);
      return { error: error ? error.message : null };
    },
  };

  return { analyses, storage };
}
