/**
 * Orchestration for issue #7's orphan-detection backstop: find `media`-bucket prefixes with no
 * corresponding, non-deleted `public.analyses` row (via the read-only
 * `public.list_orphaned_media_prefixes` RPC, `20260713152000_storage_user_budget.sql`) and purge
 * them through the real Storage API.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE MIGRATION. `storage.objects` is Postgres METADATA
 * only — deleting a row there does not delete the underlying object from the store. Only the
 * Storage HTTP API does that. A migration cannot safely reach that API itself (no `pg_net` +
 * Vault secret provisioned from a migration file — the same reasoning
 * `20260713130000_stale_reservation_sweep.sql`'s own "DESIGN DECISION 3" already documents for
 * the sibling stale-reservation sweep), so the migration stops at DETECTION and this module is
 * the ACTION half, callable from Deno the same way `ai-guard.ts` was built as a tested,
 * dependency-free orchestration layer before `analyze-form` (its caller) existed yet.
 *
 * NOT YET WIRED TO ANYTHING. There is no scheduled edge function in this repo that calls
 * `sweepOrphanedMediaPrefixes()` — creating one (an `index.ts` under a new
 * `supabase/functions/<name>/`, plus a Supabase Dashboard Cron Job or `pg_cron` trigger pointing
 * at it) is a `jobs-queues-edge` + deploy/config task outside this file's lane. See this issue's
 * `NEEDS-IAN` note for the scheduling decision itself (Dashboard Cron Job vs. `pg_net`+Vault) —
 * this module is the tested building block that decision will call into, not the decision.
 *
 * WHY THIS DOESN'T IMPORT `delete-analysis.ts`'s `purgePrefix`. That function does the identical
 * list→remove→verify idiom this file needs, but importing it would couple this new file to
 * another agent's file mid-flight in a parallel worktree — outside this issue's file lane. The
 * ~30 lines are reimplemented independently below rather than shared; if the two ever need a
 * single implementation, that is a follow-up refactor once both branches have merged, not
 * something to force here.
 *
 * Deliberately free of any `npm:`/Deno-only import, same discipline as `ai-guard.ts` and
 * `delete-analysis.ts`: pure orchestration, fully unit-testable with injected fakes (see
 * `__tests__/storage-sweep.deno.test.ts`). A future `storage-sweep-client.ts` would own the real
 * `npm:@supabase/supabase-js` wiring, mirroring `ai-guard-client.ts` / `delete-analysis-client.ts`
 * — not written here because nothing calls it yet.
 *
 * RACE NOTE: a prefix this module purges was, at detection time (inside the RPC), older than
 * `olderThan` (default 15 minutes, matching `sweep_stale_reservations`'s own threshold) with no
 * owning row. A row appearing for that exact `{user_id}/{analysis_id}/` prefix between detection
 * and this purge would require a fresh `analyses` insert landing on the exact same
 * previously-orphaned random UUID — not a realistic race, unlike the delete-during-upload window
 * documented elsewhere (`docs/status.md` Known Issue #26, owned by `delete-analysis.ts`, out of
 * scope here). The staleness threshold is the intended margin, same idiom as the reservation
 * sweep's own Design Decision 1.
 */

/** One row from `public.list_orphaned_media_prefixes`. */
export interface OrphanedPrefixRow {
  userId: string;
  analysisId: string;
  prefix: string;
  objectCount: number;
  oldestObjectAt: string;
}

/** Minimal shape of a Supabase client's `.rpc()` — matches `@supabase/supabase-js`'s own return
 * shape closely enough to unit-test against without importing it (same seam `ai-guard.ts` uses). */
export interface RpcClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>
  ): Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface StorageEntry {
  name: string;
  /** True for a pseudo-directory entry (Supabase Storage's `list()` returns these with `id:
   * null`) — see `delete-analysis.ts`'s identical note on why a flat, non-recursive walk would
   * silently orphan nested objects while reporting success. */
  isFolder: boolean;
}

/** Minimal shape of what this module needs from the private `media` Storage bucket. */
export interface StorageBucket {
  list(prefix: string, options: { limit: number; offset: number }): Promise<StorageEntry[]>;
  remove(paths: string[]): Promise<{ error: string | null }>;
}

export interface SweepOrphanedMediaParams {
  /** Passed through to `list_orphaned_media_prefixes`'s `p_older_than`. Postgres `interval`
   * literal syntax, e.g. `'15 minutes'` (the RPC's own default). */
  olderThan?: string;
  /** Passed through to `list_orphaned_media_prefixes`'s `p_limit`. */
  limit?: number;
  /** Test-only seam — production callers should never pass this (see DEFAULT_PAGE_SIZE below). */
  pageSize?: number;
}

export type PrefixSweepOutcome =
  | { prefix: string; outcome: 'purged'; objectCount: number }
  | { prefix: string; outcome: 'purge_failed'; reason: string };

export interface SweepOrphanedMediaResult {
  candidateCount: number;
  outcomes: PrefixSweepOutcome[];
}

/** Supabase Storage's `list()` accepts up to 1000 per page; used as the real default. */
export const DEFAULT_PAGE_SIZE = 1000;

/** Same defensive recursion bound as `delete-analysis.ts` — the real layout is flat
 * (`{user_id}/{analysis_id}/frame-NN.jpg`), so this only guards against a pathological or
 * maliciously deep folder structure turning into a runaway function. */
const MAX_LIST_DEPTH = 8;

const DEFAULT_OLDER_THAN = '15 minutes';
const DEFAULT_RPC_LIMIT = 500;

/**
 * Finds orphaned `media` prefixes via `list_orphaned_media_prefixes` and purges each one,
 * independently. A single prefix's purge failing (a Storage API hiccup, a leftover object
 * surviving verification) must never stop the rest of the batch — same resilience idiom
 * `sweep_stale_reservations()`'s own batch-limit-then-next-cron-tick philosophy uses, applied
 * per-prefix instead of per-run.
 */
export async function sweepOrphanedMediaPrefixes(
  rpc: RpcClient,
  storage: StorageBucket,
  params: SweepOrphanedMediaParams = {}
): Promise<SweepOrphanedMediaResult> {
  const { data, error } = await rpc.rpc('list_orphaned_media_prefixes', {
    p_older_than: params.olderThan ?? DEFAULT_OLDER_THAN,
    p_limit: params.limit ?? DEFAULT_RPC_LIMIT,
  });

  if (error) {
    throw new Error(`list_orphaned_media_prefixes failed: ${error.message}`);
  }

  const rows = normalizeRows(data);
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const outcomes: PrefixSweepOutcome[] = [];

  for (const row of rows) {
    try {
      const objectCount = await purgePrefix(storage, row.prefix, pageSize);
      outcomes.push({ prefix: row.prefix, outcome: 'purged', objectCount });
    } catch (err) {
      outcomes.push({
        prefix: row.prefix,
        outcome: 'purge_failed',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { candidateCount: rows.length, outcomes };
}

/** The RPC returns snake_case columns (Postgres convention); this module's public types are
 * camelCase (this repo's TS convention) — this is the one translation seam between them. */
function normalizeRows(data: unknown): OrphanedPrefixRow[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      userId: String(r.user_id),
      analysisId: String(r.analysis_id),
      prefix: String(r.prefix),
      objectCount: Number(r.object_count),
      oldestObjectAt: String(r.oldest_object_at),
    };
  });
}

/**
 * Lists, removes, then re-lists the prefix to confirm it is actually empty — identical
 * list→remove→verify idiom to `delete-analysis.ts`'s `purgePrefix`, reimplemented independently
 * here (see this file's header for why it isn't imported). Throws on any failure — callers must
 * treat a throw as "this prefix's objects may still exist," never assume success.
 */
async function purgePrefix(storage: StorageBucket, prefix: string, pageSize: number): Promise<number> {
  const filePaths: string[] = [];
  await collectFiles(storage, prefix, filePaths, 0, pageSize);

  if (filePaths.length > 0) {
    const { error } = await storage.remove(filePaths);
    if (error) {
      throw new Error(`Failed to remove ${filePaths.length} object(s) under "${prefix}": ${error}`);
    }
  }

  const remaining = await storage.list(prefix, { limit: 1, offset: 0 });
  if (remaining.length > 0) {
    throw new Error(`Storage prefix "${prefix}" still has objects after purge.`);
  }

  return filePaths.length;
}

/** Recursively walks `prefix`, paginating each folder level, collecting full object paths. */
async function collectFiles(
  storage: StorageBucket,
  prefix: string,
  out: string[],
  depth: number,
  pageSize: number
): Promise<void> {
  if (depth > MAX_LIST_DEPTH) {
    throw new Error(`Storage prefix "${prefix}" nests deeper than ${MAX_LIST_DEPTH} levels; refusing to recurse further.`);
  }

  let offset = 0;
  for (;;) {
    const entries = await storage.list(prefix, { limit: pageSize, offset });
    for (const entry of entries) {
      const fullPath = `${prefix}${entry.name}`;
      if (entry.isFolder) {
        await collectFiles(storage, `${fullPath}/`, out, depth + 1, pageSize);
      } else {
        out.push(fullPath);
      }
    }
    if (entries.length < pageSize) {
      break;
    }
    offset += pageSize;
  }
}
