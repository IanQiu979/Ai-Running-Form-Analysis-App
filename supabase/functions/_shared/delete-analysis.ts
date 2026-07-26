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
 * `docs/architecture.md` "Current — media pipeline" and CLAUDE.md's Secrets & env section): the
 * prefix `{callerUserId}/{analysisId}/` is constructed from the caller's own id and the path
 * param alone, never read off the row. A crash between an upload and its `settle_analysis` call
 * can leave objects under a prefix whose row's `media_paths` is still empty — iterating
 * `media_paths` would leave those behind forever, which is the exact bug #88 already fixed on
 * the write side. This also means a malicious id (someone else's analysis id) purges nothing:
 * the prefix is always rooted at the CALLER's own id, so at most it probes an empty prefix under
 * their own namespace — no cross-user object deletion is reachable through this path regardless
 * of the ownership check below.
 *
 * THE SECOND PURGE (issue #132 — found in code review of #130, tracked as `docs/status.md` Known
 * Issue #26): purging Storage first (A) and marking the row deleted second (B) closes the
 * failure-leaves-nothing-orphaned case in the paragraph above, but since #130, `analyze-form`
 * settles the row BEFORE uploading its frames — so a row can be `'delivered'` (deletable) while
 * its frames are still uploading. If an in-flight `attach_media_paths` commits in the gap between
 * A and B, the row still has `deleted_at IS NULL` at that instant, so the attach SUCCEEDS (from
 * its own point of view the row is live) and `safeAttachFrames` correctly does not purge. Then B
 * commits and the `redact_analyses_on_soft_delete` trigger wipes `media_paths` back to `'{}'` —
 * every frame uploaded after A's verification list is now stranded under a prefix whose purge
 * already ran and reported empty, named by nothing in the database.
 *
 * Once B has committed, `deleted_at` is set, and `attach_media_paths`'s `deleted_at is null`
 * guard means the attach path refuses from that moment on (and `flow.ts` purges on that refusal)
 * — so ANY object still under the prefix after B is, by construction, an orphan from exactly this
 * race. `deleteAnalysis()` therefore purges the SAME prefix a second time, immediately after B
 * commits, reusing `purgePrefix()` — never reimplemented, never keyed on `media_paths`. This is
 * only run when B just performed the real `deleted_at` transition (`updated === true`); a repeat
 * call that finds the row ALREADY deleted (`alreadyDeleted`) or that never finds the row at all
 * (`not_found`) skips it — there is no fresh A→B gap on those paths for it to close. On the
 * overwhelmingly common path nothing landed in the gap, so the second purge costs exactly one
 * `list()` against an already-empty prefix. A non-zero second-purge count means a real orphan was
 * caught, and is logged as such (`delete_analysis.second_purge_caught_orphan`) rather than
 * silently folded away. If the second purge itself cannot fully clear the prefix, `purgePrefix`'s
 * fail-closed verification throws — and since B already committed, that throw cannot be answered
 * with `purge_failed` (nothing about the delete is retryable at that point; the row is gone
 * either way), so it is reported as `orphans_remaining`: a success from the caller's standpoint,
 * logged at error level (`delete_analysis.second_purge_failed`) as the sole alarm, mirroring
 * `delete-account.ts`'s own post-delete-sweep outcome for the identical shape of problem.
 *
 * This narrows, but does not close, the OTHER orphan door: Known Issue #19, the client-side
 * soft-delete path (issue #2's UPDATE policy) that never calls this endpoint at all. Read them
 * together — different door, same orphan class.
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

/** Structured log sink — one event per boundary crossed. Defaults to a no-op; see `deleteAnalysis`. */
export type LogEvent = (event: Record<string, unknown>) => void;

export type DeleteAnalysisResult =
  | { outcome: 'deleted'; alreadyDeleted: boolean; purgedObjectCount: number }
  | { outcome: 'not_found' }
  | { outcome: 'not_yours' }
  | { outcome: 'purge_failed'; reason: string }
  /**
   * The row IS fully deleted (`markDeleted` committed) but the second purge — the #132 sweep for
   * a frame that landed in the A/B gap — could not fully clear the prefix. Not retryable (there
   * is nothing left to retry: the row is gone either way), so this is a SUCCESS outcome, same
   * shape as `delete-account.ts`'s `orphans_remaining`, not folded into `purge_failed`. The
   * `delete_analysis.second_purge_failed` error-level log this triggers is the only alarm; see
   * the file header's "THE SECOND PURGE" section.
   */
  | { outcome: 'orphans_remaining'; reason: string; purgedObjectCount: number };

export interface DeleteAnalysisParams {
  analysisId: string;
  callerUserId: string;
  /** Test-only seam — production callers should never pass this (see DEFAULT_PAGE_SIZE below). */
  pageSize?: number;
  /** Optional structured log sink; defaults to a no-op so tests stay silent unless they opt in. */
  log?: LogEvent;
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
  const log: LogEvent = params.log ?? (() => {});

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

  if (!updated) {
    // The row was ALREADY deleted before this call (a retry, or the client-side soft-delete
    // bypass — issue #2/#19). This call's own markDeleted did not just perform the deleted_at
    // transition, so there is no fresh A/B gap for the second purge to close here — see the file
    // header's "THE SECOND PURGE" section for why that gap only exists around a real transition.
    return { outcome: 'deleted', alreadyDeleted: true, purgedObjectCount };
  }

  // SECOND PURGE (#132): markDeleted just committed the real deleted_at transition, so any object
  // that lands under this same prefix from this point on can only be the #132 race — an
  // attach_media_paths that committed between the purge above and this line, while the row still
  // looked live. Re-running the same, unmodified purgePrefix() against the same prefix is always
  // safe (idempotent, fails closed) and on the common path costs one list() against an empty
  // prefix.
  let secondPurgeObjectCount: number;
  try {
    secondPurgeObjectCount = await purgePrefix(storage, prefix, pageSize);
  } catch (err) {
    // The row is already deleted and that cannot be undone — reporting `purge_failed` here would
    // wrongly tell the client to retry a delete that already happened. purgePrefix's fail-closed
    // verification means this only throws when an object demonstrably still exists (or a real
    // Storage-side error), so this is exactly `delete-account.ts`'s `orphans_remaining` shape: a
    // success that must still be alerted on loudly, because there is nothing left to retry.
    const reason = err instanceof Error ? err.message : String(err);
    log({
      event: 'delete_analysis.second_purge_failed',
      level: 'error',
      analysisId: params.analysisId,
      userId: params.callerUserId,
      reason,
    });
    return { outcome: 'orphans_remaining', reason, purgedObjectCount };
  }

  if (secondPurgeObjectCount > 0) {
    // A real orphan was caught by the #132 sweep — always worth seeing, never folded away silently.
    log({
      event: 'delete_analysis.second_purge_caught_orphan',
      level: 'warn',
      analysisId: params.analysisId,
      userId: params.callerUserId,
      secondPurgeObjectCount,
    });
  }

  return {
    outcome: 'deleted',
    alreadyDeleted: false,
    purgedObjectCount: purgedObjectCount + secondPurgeObjectCount,
  };
}

/**
 * Lists, removes, then re-lists the prefix to confirm it is actually empty — "delete the Storage
 * objects first, verify, then the row" (issue #57's own ordering directive). A `remove()` call
 * that silently drops some paths (rather than surfacing an error) is exactly what the
 * verification pass is for: this function only returns normally when a follow-up list against
 * the same prefix comes back empty, not merely when `remove()` reported no error.
 *
 * Exported (issue #58) so `delete-account.ts` can run the identical recursive, paginated,
 * verified purge over the whole-account prefix `{user_id}/` — one level shallower than this
 * function's usual `{user_id}/{analysis_id}/`, which is precisely what its recursion already
 * handles. The object-deletion logic exists exactly once, in this file, and both delete paths
 * call it: the nested-prefix trap can therefore only ever be fixed (or broken) in one place.
 * Throws on any failure — callers must treat a throw as "nothing may be deleted downstream."
 */
export async function purgePrefix(storage: StorageBucket, prefix: string, pageSize: number): Promise<number> {
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
    // Both `deleted` and `orphans_remaining` are 200: by the time `orphans_remaining` is reached
    // the row is already gone, so a non-2xx would tell the client to retry an operation that
    // already succeeded — same reasoning as `delete-account.ts`'s `httpStatusForAccountOutcome`.
    case 'deleted':
    case 'orphans_remaining':
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
    case 'orphans_remaining':
      // Success shape, not the error shape — the row really is deleted. `orphansRemaining: true`
      // is a client hint with no retry affordance, because there is nothing left to retry; the
      // actionable detail lives only in the error-level `delete_analysis.second_purge_failed` log.
      return { deleted: true, orphansRemaining: true };
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
