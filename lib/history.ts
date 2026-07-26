/**
 * The Past Analyses list (issue #55) — the client half of "every analysis is retrievable after
 * an app restart" (M6's gate). `app/(tabs)/history.tsx` is the thin I/O-glue-plus-render half;
 * this file owns everything worth unit-testing (CLAUDE.md § Testing: "New logic added to `lib/`
 * ... should get a test alongside it. Screens are not unit-tested for now."), mirroring the split
 * `lib/analysis-result.ts` / `app/result/[id].tsx` already established for the single-result
 * screen — `readHistoryRow` below is that file's `readAnalysisRow`, generalized to a list.
 *
 * THE MEDIA RULE (CLAUDE.md § Secrets & env — not negotiable): the `media` Storage bucket is
 * PRIVATE. There are NO public URLs. Frames are reachable only via short-TTL signed URLs or an
 * authenticated read. `signFrameStrip` below is the only thing in this file that touches Storage,
 * and it always asks for a short TTL (`FRAME_STRIP_SIGNED_URL_TTL_SECONDS`, ~1h per
 * `docs/architecture.md` "Current — media pipeline": "short-TTL (~1h, regenerated on open)"),
 * mints one fresh on every screen open rather than caching a long-lived one, and never logs the
 * signed URL it gets back — a leaked long-TTL link is a durable link to an image of someone's
 * body.
 *
 * SOFT DELETE, AND WHY THIS FILE FILTERS TWICE: `deleted_at` is a SOFT delete — the row survives
 * (RLS's `user_id = auth.uid()` still returns it to its owner) and only `result`/`media_paths`
 * are redacted server-side the instant it's set (the same redact trigger `lib/analysis-result.ts`
 * documents). `fetchHistoryList`'s query asks for `deleted_at is null` server-side, AND
 * `readHistoryRow` re-checks it in code — never trusting one layer alone to keep a soft-deleted
 * row off the list, the same "don't trust RLS alone" discipline
 * `supabase/functions/_shared/delete-analysis.ts`'s ownership check documents for itself.
 *
 * "HANDLE A ROW WHOSE MEDIA IS GONE WITHOUT CRASHING" (issue #55's own instruction): two
 * independent things can leave a delivered row with nothing to show as a thumbnail —
 * `media_paths` can legitimately be `[]` (the settle-before-upload ordering from #130 means a
 * frame upload can fail non-fatally after a real result was already delivered — see
 * `docs/architecture.md` step 10's "a frame that fails to upload ... does NOT fail the request;
 * it only shortens the Past Analyses frame strip"), and a path that IS present can still fail to
 * sign (the object never made it, or the narrowed-not-closed delete-during-upload race documented
 * at `docs/status.md` Known Issue #26). `signFrameStrip` folds BOTH into the same empty-array
 * result — a per-row "no thumbnail" state, never a thrown error that would take the whole list
 * down over one row's media.
 */
import { supabase } from './supabase';
import { invokeFunction } from './functions-client';
import { Copy } from '@/constants/copy';
import { ScoreBandLabel } from '@/constants/theme';
import { isPaceAnalysisOutcome, type PaceAnalysisOutcome } from '@shared/pace';

// -------------------------------------------------------------------------------------------
// Reading the list — pure interpretation, mirrors lib/analysis-result.ts's readAnalysisRow.
// -------------------------------------------------------------------------------------------

/** The columns `fetchHistoryList` selects from `public.analyses` — a subset of the full row
 * (`docs/architecture.md` "Current — DB schema"), matching `lib/analysis-result.ts`'s
 * `AnalysisRow` plus the two fields a LIST needs that a single-result fetch doesn't: `id` (to
 * navigate/delete) and `created_at` (to date and order the rows). `result` is typed `unknown` on
 * purpose, same reasoning as that file: it's `jsonb` on the wire, and `isPaceAnalysisOutcome` is
 * what actually proves its shape, not a cast asserting it. */
export interface HistoryAnalysisRow {
  id: string;
  created_at: string;
  status: 'reserved' | 'delivered' | 'released';
  result: unknown;
  is_fallback: boolean;
  media_paths: string[];
  media_type: 'photo' | 'video';
  deleted_at: string | null;
}

/** One row `app/(tabs)/history.tsx` can render. `mediaPaths` may be `[]` — see this file's header
 * note on handling a row whose media is gone. */
export interface HistoryListItem {
  id: string;
  createdAt: string;
  mediaType: 'photo' | 'video';
  outcome: PaceAnalysisOutcome;
  mediaPaths: string[];
}

/**
 * Interprets one raw row into a list item, or `null` if it should not appear on the list at all.
 * Three raw situations all collapse into `null`, deliberately, same reasoning
 * `readAnalysisRow`'s doc comment gives for its own `'notFound'` state:
 *   - soft-deleted (`deleted_at` set — redacted server-side the moment that happens);
 *   - not yet delivered (`status` is `'reserved'` or `'released'`) — nothing was ever persisted
 *     to `result` for either, so there is nothing honest to show as a past analysis;
 *   - structurally invalid stored data (`result`/`is_fallback` fails `isPaceAnalysisOutcome`) —
 *     dropped silently rather than rendered as a broken row, since one corrupt row must never
 *     take the rest of a real list down with it.
 */
export function readHistoryRow(row: HistoryAnalysisRow): HistoryListItem | null {
  if (row.deleted_at !== null || row.status !== 'delivered') {
    return null;
  }

  const outcome = { result: row.result, isFallback: row.is_fallback };
  if (!isPaceAnalysisOutcome(outcome)) {
    return null;
  }

  return {
    id: row.id,
    createdAt: row.created_at,
    mediaType: row.media_type,
    outcome,
    mediaPaths: row.media_paths,
  };
}

/** Maps + filters a raw row set into the list `app/(tabs)/history.tsx` renders, preserving
 * whatever order the query returned (the real query orders `created_at desc` — see
 * `fetchHistoryList`; this function does not re-sort). */
export function readHistoryRows(rows: HistoryAnalysisRow[]): HistoryListItem[] {
  const items: HistoryListItem[] = [];
  for (const row of rows) {
    const item = readHistoryRow(row);
    if (item) items.push(item);
  }
  return items;
}

// -------------------------------------------------------------------------------------------
// Copy formatting — pure, so the interpolation logic is provable without a rendered screen.
// -------------------------------------------------------------------------------------------

/** `created_at` (an ISO timestamptz string) as a locale-formatted date, e.g. "Jul 12, 2026" —
 * used both for the on-screen date and `history.item.a11yLabel`'s `{date}`. No locale is passed
 * explicitly (`undefined`), so this follows the device's own locale rather than hardcoding one. */
export function formatHistoryDate(createdAtIso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(createdAtIso));
}

/**
 * `history.item.a11yLabel` ("Analysis from {date}, overall {score} out of 100, {band}.") with its
 * placeholders filled in. Falls back to `history.item.a11yLabelNotAssessed` when the overall is
 * honestly null (`PaceOverall`'s own doc comment: "Null when every pillar is not assessed — never
 * a fabricated overall built from zero real data") — same "never stringify null as a score" rule
 * `lib/pace-readout.ts`'s `overallA11yLabel` follows for the single-result screen.
 */
export function formatHistoryItemA11yLabel(item: HistoryListItem, formattedDate: string): string {
  const { overall } = item.outcome.result;
  if (overall.score === null || overall.band === null) {
    return Copy.history.item.a11yLabelNotAssessed.replace('{date}', formattedDate);
  }
  return Copy.history.item.a11yLabel
    .replace('{date}', formattedDate)
    .replace('{score}', String(overall.score))
    .replace('{band}', ScoreBandLabel[overall.band]);
}

/**
 * `history.item.deleteA11yLabel` ("Delete analysis from {date}, overall {score} out of 100,
 * {band}.") with its placeholders filled in — the per-row Delete control's own label, built from
 * the same date/score context as `formatHistoryItemA11yLabel` (issue #62 audit finding #2: the
 * bare static "Delete" label couldn't tell a screen-reader user which row's Delete they were
 * about to press). Falls back to `history.item.deleteA11yLabelNotAssessed` for the same honest
 * "never stringify null as a score" reason `formatHistoryItemA11yLabel` does.
 */
export function formatHistoryItemDeleteA11yLabel(item: HistoryListItem, formattedDate: string): string {
  const { overall } = item.outcome.result;
  if (overall.score === null || overall.band === null) {
    return Copy.history.item.deleteA11yLabelNotAssessed.replace('{date}', formattedDate);
  }
  return Copy.history.item.deleteA11yLabel
    .replace('{date}', formattedDate)
    .replace('{score}', String(overall.score))
    .replace('{band}', ScoreBandLabel[overall.band]);
}

// -------------------------------------------------------------------------------------------
// Listing — a plain RLS-guarded read (docs/architecture.md: "Direct Supabase-client reads
// (RLS-guarded, `user_id = auth.uid()`): list own `analyses`"), not an edge function.
// -------------------------------------------------------------------------------------------

const HISTORY_SELECT_COLUMNS = 'id, created_at, status, result, is_fallback, media_paths, media_type, deleted_at';

/**
 * Fetches the caller's own past analyses, newest first, ready-to-render only.
 *
 * THROWS on any query failure — fails closed, same convention `lib/consent.ts`'s `hasConsented`
 * documents for itself: silently returning `[]` on an error would be indistinguishable from a
 * user who genuinely has no history yet, which hides the outage. The caller
 * (`app/(tabs)/history.tsx`) is expected to catch this and render its own `error` state, exactly
 * like `app/result/[id].tsx` already does around its own `supabase.from('analyses')` call.
 */
export async function fetchHistoryList(): Promise<HistoryListItem[]> {
  // No `user_id` filter: RLS scopes SELECT to the owner (same note `lib/consent.ts` makes for its
  // own query). `deleted_at is null` IS filtered explicitly, even though `readHistoryRow` also
  // checks it — see this file's header for why that's deliberate double coverage, not redundancy.
  // `status = 'delivered'` is filtered here too, purely to shrink the payload — `readHistoryRow`
  // is the actual authority on which rows render, not this query.
  const { data, error } = await supabase
    .from('analyses')
    .select(HISTORY_SELECT_COLUMNS)
    .is('deleted_at', null)
    .eq('status', 'delivered')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Could not load past analyses: ${error.message}`);
  }

  return readHistoryRows(data ?? []);
}

// -------------------------------------------------------------------------------------------
// Frame-strip thumbnails — short-TTL signed URLs only. See this file's header, "THE MEDIA RULE".
// -------------------------------------------------------------------------------------------

/** The private frame bucket (`supabase/migrations/20260711150500_media_storage_bucket.sql`) —
 * same bucket name `app/result/[id].tsx` uses for its own hero-frame signed URL. */
export const MEDIA_BUCKET = 'media';

/** "~1h, regenerated on open" per `docs/architecture.md` "Current — media pipeline" — matches
 * `app/result/[id].tsx`'s `HERO_SIGNED_URL_TTL_SECONDS` exactly; kept as this file's own named
 * constant rather than importing that screen's local one, since a screen's own constants aren't
 * meant to be a shared module (that file doesn't export it). */
export const FRAME_STRIP_SIGNED_URL_TTL_SECONDS = 60 * 60;

/** One entry of `storage.createSignedUrls`' batch response — see `parseSignedUrlBatch` below. */
export interface SignedUrlBatchEntry {
  path: string | null;
  signedUrl: string | null;
  error: string | null;
}

/**
 * Extracts just the usable signed URLs from a batch `createSignedUrls` response, in whatever
 * order the batch call returned them. Storage.js's batch call reports success/failure PER PATH
 * (`{ path, signedUrl, error }`) rather than failing the whole batch when one object is missing —
 * this function is what turns that into "the frame strip this row can actually show": any entry
 * with no `signedUrl` (the object is gone, expired race, etc. — see this file's header) is
 * silently dropped, never thrown. A row with every entry dropped ends up with an empty strip, a
 * real and expected state `app/(tabs)/history.tsx` renders as "no thumbnail", not a crash.
 */
export function parseSignedUrlBatch(results: SignedUrlBatchEntry[] | null | undefined): string[] {
  if (!results) return [];
  const urls: string[] = [];
  for (const entry of results) {
    if (entry.signedUrl) urls.push(entry.signedUrl);
  }
  return urls;
}

/**
 * Signs every path in `mediaPaths` for short-TTL display as one row's frame strip. Best-effort
 * only, same reasoning `app/result/[id].tsx`'s own `resolveHeroImageUri` documents for itself: a
 * frame strip that fails to resolve is a "no thumbnail" state for that one row, never a reason to
 * fail the whole list. Never throws.
 */
export async function signFrameStrip(mediaPaths: string[]): Promise<string[]> {
  if (mediaPaths.length === 0) return [];

  try {
    const { data, error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrls(mediaPaths, FRAME_STRIP_SIGNED_URL_TTL_SECONDS);
    if (error) return [];
    return parseSignedUrlBatch(data);
  } catch {
    return [];
  }
}

// -------------------------------------------------------------------------------------------
// Delete — DELETE /functions/v1/analysis/:id (issue #57), via the shared invokeFunction wrapper.
// Same seam shape as lib/delete-account.ts: a plain async function, no injectable interface,
// since (unlike delete-account) there is no pre-existing mock-binding history to guard against —
// this file is the first and only caller.
// -------------------------------------------------------------------------------------------

/**
 * Every retryable failure `code` `DELETE /functions/v1/analysis/:id` can send (per
 * `docs/architecture.md`'s API table and `supabase/functions/_shared/delete-analysis.ts`'s
 * `responseBodyForOutcome`): `not_found` (404), `not_yours` (403), `purge_failed` (503).
 * `'unknown'` is this client's own bucket for anything the contract above doesn't name — a
 * relay/network error, a 401, a 404 from the ROUTE not existing at all versus the documented
 * `not_found` outcome, or a body that doesn't parse as documented — same reasoning
 * `lib/delete-account.ts`'s `DeleteAccountErrorCode` documents for its own `'unknown'` bucket.
 */
export type HistoryDeleteErrorCode = 'not_found' | 'not_yours' | 'purge_failed' | 'unknown';

function isServerHistoryDeleteErrorCode(value: unknown): value is Exclude<HistoryDeleteErrorCode, 'unknown'> {
  return value === 'not_found' || value === 'not_yours' || value === 'purge_failed';
}

export interface HistoryDeleteSuccess {
  alreadyDeleted: boolean;
}

export interface HistoryDeleteError {
  error: string;
  code: HistoryDeleteErrorCode;
}

export type HistoryDeleteResult = { ok: true; data: HistoryDeleteSuccess } | { ok: false; error: HistoryDeleteError };

/** Defensive, narrow parse of a 200 body — never trusts the shape blindly, same discipline
 * `lib/delete-account.ts`'s `parseSuccessBody` documents for itself. */
function parseDeleteSuccessBody(body: unknown): HistoryDeleteSuccess | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (record.deleted !== true) return null;
  return { alreadyDeleted: record.alreadyDeleted === true };
}

const GENERIC_DELETE_ERROR: HistoryDeleteError = {
  error: 'This analysis could not be deleted.',
  code: 'unknown',
};

/**
 * Calls `DELETE /functions/v1/analysis/:id` through `lib/functions-client.ts`'s `invokeFunction`,
 * which already does the `FunctionsHttpError`/`FunctionsRelayError`/`FunctionsFetchError` unwrap
 * and NEVER REJECTS. The function name passed to `invoke()` is `analysis/{id}` — supabase-js
 * builds the request URL as `${functionsUrl}/${functionName}`, so this produces exactly
 * `.../functions/v1/analysis/{id}`, the path `parseAnalysisIdFromUrl`
 * (`_shared/delete-analysis.ts`) expects. NEVER REJECTS — resolves `{ ok: false, error }` for
 * every documented and undocumented failure alike, mirroring `lib/delete-account.ts`'s contract.
 */
export async function deleteHistoryAnalysis(analysisId: string): Promise<HistoryDeleteResult> {
  const result = await invokeFunction(`analysis/${analysisId}`, { method: 'DELETE' });

  if (result.ok) {
    const success = parseDeleteSuccessBody(result.data);
    if (success) {
      return { ok: true, data: success };
    }
    // A 200 whose body we don't recognize is not a success we can act on.
    return { ok: false, error: GENERIC_DELETE_ERROR };
  }

  if (result.error.kind === 'http' && isServerHistoryDeleteErrorCode(result.error.code)) {
    return { ok: false, error: { error: result.error.error, code: result.error.code } };
  }

  return { ok: false, error: GENERIC_DELETE_ERROR };
}
