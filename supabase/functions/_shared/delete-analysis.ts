/**
 * The purge-and-delete core for `DELETE /functions/v1/analysis/:id` (issue #57), closing issue
 * #3 (deleting an analysis orphaned its Storage frames forever — a privacy defect, not a
 * storage-cost one).
 *
 * Deliberately free of any `npm:`/Deno-only import, same discipline as `ai-guard.ts`: this is
 * the orchestration/decision logic, fully unit-testable with injected fakes (see
 * `__tests__/delete-analysis.deno.test.ts`), and the real Deno/`npm:@supabase/supabase-js`
 * client wiring lives in `delete-analysis-client.ts`, imported only by
 * `supabase/functions/analysis/index.ts`.
 *
 * ORDERING, AND WHY (binding — do not swap this): purge Storage FIRST, then mark the row
 * deleted. If the row were marked deleted first and the Storage purge then failed, the analysis
 * would disappear from the user's view while its frames — images of a person's body — kept
 * living in the bucket: exactly the failure issue #3 exists to close, just reached through this
 * function instead of a raw client DELETE. Purging first means a failure leaves the row exactly
 * as it was (still visible, not marked deleted) and returns a `purge_failed` outcome instead of
 * a false "deleted" — nothing is ever orphaned-looking-deleted.
 *
 * IDEMPOTENCY: `deleteAnalysis()` always attempts the Storage purge, REGARDLESS of whether the
 * row is already soft-deleted. Two reasons this matters, not one:
 *   1. A retried DELETE call (network flake, client retry logic) must converge, not error. Since
 *      the purge is itself idempotent (re-listing an already-empty prefix costs one API call and
 *      finds nothing to remove), calling it again on an already-deleted analysis is a safe no-op
 *      that still reports `{ deleted: true }`.
 *   2. `public.analyses` still carries a client-facing soft-delete UPDATE policy (issue #2,
 *      restricted to the `deleted_at: null -> now()` transition on the caller's own row) that
 *      does NOT go through this function or purge anything. A user (or any caller holding the
 *      publishable key + their own JWT) can soft-delete a row directly via `supabase-js`,
 *      bypassing this endpoint entirely and leaving its frames orphaned. Always attempting the
 *      purge here — keyed on the caller's own id and the path param alone, never gated on the
 *      row's current `deleted_at` — means that IF the client ever does call this endpoint for
 *      that analysis (the expected product flow), the purge still happens even though the row
 *      was already soft-deleted through the other path. This narrows, but does not fully close,
 *      that gap: nothing can force a client to call this endpoint at all. See this issue's
 *      summary for the residual-risk note (a future reconciliation job or an AFTER UPDATE
 *      trigger would close it completely; out of scope here — #2's migration is settled).
 *
 * AUTHORIZATION: `findById` is looked up with NO ownership filter (the real client bypasses RLS
 * with the service-role key, same as every other privileged RPC in this codebase), and ownership
 * is then checked explicitly in code (`row.user_id !== callerUserId`) — never assumed from RLS,
 * never trusted from the request. This is what makes the "not yours" refusal a real code path
 * with its own test, not an accident of a WHERE clause.
 *
 * PURGE BY PREFIX, NEVER BY `media_paths` (the #88/#57 settled contract — see
 * `docs/architecture.md` "Planned — media pipeline" and CLAUDE.md's Secrets & env section): the
 * prefix `{callerUserId}/{analysisId}/` is constructed from the caller's own id and the path
 * param alone, never read off the row. A crash between an upload and its `settle_analysis` call
 * can leave objects under a prefix whose row's `media_paths` is still empty — iterating
 * `media_paths` would leave those behind forever, which is the exact bug #88 already fixed on
 * the write side. This also means a malicious id (someone else's analysis id) purges nothing:
 * the prefix is always rooted at the CALLER's own id, so at most it probes an empty prefix under
 * their own namespace — no cross-user object deletion is reachable through this path regardless
 * of the ownership check below.
 */

export interface AnalysisOwnershipRow {
  id: string;
  user_id: string;
  deleted_at: string | null;
}

/** Minimal shape of what `deleteAnalysis()` needs from `public.analyses`, service-role only. */
export interface AnalysesTable {
  findById(id: string): Promise<AnalysisOwnershipRow | null>;
  /**
   * Sets `deleted_at` on a still-not-deleted row owned by `userId`. Must be a no-op (not an
   * error) when the row is already deleted — `updated: false` signals exactly that, not a
   * failure. The real implementation matches on `deleted_at is null`, mirroring the same
   * "duplicate/late call is a safe no-op" idiom `settle_analysis`/`release_analysis` already use
   * elsewhere in this schema (see `docs/architecture.md`'s "Quota RPC family").
   */
  markDeleted(id: string, userId: string): Promise<{ updated: boolean }>;
}

export interface StorageEntry {
  name: string;
  /**
   * True for a pseudo-directory entry (Supabase Storage's `list()` returns these with `id:
   * null`), meaning `collectFiles` must recurse into it rather than treat it as a removable
   * object. This is the exact nested-prefix trap `docs/privacy-checklist-m7.md` calls out: a
   * flat, non-recursive list "removes nothing, and orphans every frame — while reporting
   * success."
   */
  isFolder: boolean;
}

/** Minimal shape of what `deleteAnalysis()` needs from the private `media` Storage bucket. */
export interface StorageBucket {
  list(prefix: string, options: { limit: number; offset: number }): Promise<StorageEntry[]>;
  remove(paths: string[]): Promise<{ error: string | null }>;
}

export type DeleteAnalysisResult =
  | { outcome: 'deleted'; alreadyDeleted: boolean; purgedObjectCount: number }
  | { outcome: 'not_found' }
  | { outcome: 'not_yours' }
  | { outcome: 'purge_failed'; reason: string };

export interface DeleteAnalysisParams {
  analysisId: string;
  callerUserId: string;
  /** Test-only seam — production callers should never pass this (see DEFAULT_PAGE_SIZE below). */
  pageSize?: number;
}

/** Supabase Storage's `list()` accepts up to 1000 per page; used as the real default. */
export const DEFAULT_PAGE_SIZE = 1000;

/**
 * Defensive bound on recursion depth while walking a Storage prefix. The real object layout is
 * flat (`{user_id}/{analysis_id}/frame-NN.jpg`, one level below the prefix this function is
 * given), so normal operation never approaches this — it exists only to turn a pathological or
 * maliciously deep folder structure into a loud failure instead of a runaway function that hits
 * the platform's wall-clock limit.
 */
const MAX_LIST_DEPTH = 8;

export async function deleteAnalysis(
  analyses: AnalysesTable,
  storage: StorageBucket,
  params: DeleteAnalysisParams
): Promise<DeleteAnalysisResult> {
  const row = await analyses.findById(params.analysisId);
  if (!row) {
    return { outcome: 'not_found' };
  }
  if (row.user_id !== params.callerUserId) {
    return { outcome: 'not_yours' };
  }

  const prefix = `${params.callerUserId}/${params.analysisId}/`;
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

  let purgedObjectCount: number;
  try {
    purgedObjectCount = await purgePrefix(storage, prefix, pageSize);
  } catch (err) {
    // Storage purge failed (or a leftover object survived the verification pass below). The row
    // is deliberately left untouched — see the ordering note at the top of this file. A retry of
    // this same call converges once the underlying Storage problem clears.
    return { outcome: 'purge_failed', reason: err instanceof Error ? err.message : String(err) };
  }

  const { updated } = await analyses.markDeleted(params.analysisId, params.callerUserId);
  return { outcome: 'deleted', alreadyDeleted: !updated, purgedObjectCount };
}

/**
 * Lists, removes, then re-lists the prefix to confirm it is actually empty — "delete the Storage
 * objects first, verify, then the row" (issue #57's own ordering directive). A `remove()` call
 * that silently drops some paths (rather than surfacing an error) is exactly what the
 * verification pass is for: this function only returns normally when a follow-up list against
 * the same prefix comes back empty, not merely when `remove()` reported no error.
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
    throw new Error(
      `Storage prefix "${prefix}" still has objects after purge — refusing to mark the analysis deleted.`
    );
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

// ---------------------------------------------------------------------------
// HTTP mapping — pure, tested here rather than eyeballed in index.ts.
// ---------------------------------------------------------------------------

export function httpStatusForOutcome(outcome: DeleteAnalysisResult['outcome']): number {
  switch (outcome) {
    case 'deleted':
      return 200;
    case 'not_found':
      return 404;
    case 'not_yours':
      return 403;
    case 'purge_failed':
      // Not the caller's fault (a storage-side problem), same "never a 4xx for our own failure"
      // idiom `ai-guard.ts`'s `httpStatusForGateDeny` already uses in this codebase — signals
      // safe-to-retry rather than "you did something wrong."
      return 503;
  }
}

/** Structured `{ error, code }` body matching `docs/architecture.md`'s error contract. */
export function responseBodyForOutcome(result: DeleteAnalysisResult): Record<string, unknown> {
  switch (result.outcome) {
    case 'deleted':
      return { deleted: true, alreadyDeleted: result.alreadyDeleted };
    case 'not_found':
      return { error: 'No analysis exists with that id.', code: 'not_found' };
    case 'not_yours':
      return { error: 'This analysis does not belong to the authenticated user.', code: 'not_yours' };
    case 'purge_failed':
      return {
        error: 'Could not remove the stored media for this analysis. Nothing was deleted — please try again.',
        code: 'purge_failed',
      };
  }
}

// ---------------------------------------------------------------------------
// Request-parsing helpers — pure, tested here.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Extracts the trailing `:id` path segment from a `DELETE /functions/v1/analysis/:id` (or the
 * bare `/analysis/:id` a deployed function actually sees — Supabase strips `/functions/v1`
 * before routing) request URL. Returns `null` if there is no id segment at all (a bare
 * `/analysis` call), not an empty string, so callers can treat "no id" and "bad id" the same way.
 */
export function parseAnalysisIdFromUrl(rawUrl: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(rawUrl).pathname;
  } catch {
    return null;
  }
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return null;
  }
  const last = segments[segments.length - 1];
  return last === 'analysis' ? null : last;
}
