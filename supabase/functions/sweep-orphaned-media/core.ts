/**
 * Pure logic for `POST /functions/v1/sweep-orphaned-media` (issue #137) — the daily `pg_cron`
 * schedule for `_shared/storage-sweep.ts`'s tested purge orchestrator (issue #7's `sweepOrphanedMediaPrefixes`).
 * See `index.ts`'s header for the full picture (route decision, auth model, why this function
 * exists at all); this file is deliberately free of `Deno.env`/`npm:` imports so it is
 * unit-testable exactly like `_shared/storage-sweep.ts`'s own tests — fakes in, assertions out, no
 * live `Deno.serve` request needed. Same three-way split this codebase already uses for every edge
 * function (`analyze-form/flow.ts`+`deps.ts`+`index.ts`, `_shared/delete-account.ts`+
 * `-client.ts`+`delete-account/index.ts`): this file is the "flow.ts", `client.ts` is the "deps.ts",
 * `index.ts` is the HTTP glue.
 */

import type { OrphanedPrefixRow } from '../_shared/storage-sweep.ts';

// ---------------------------------------------------------------------------
// Auth — a shared secret, not a user JWT.
// ---------------------------------------------------------------------------

/** The header the Supabase Dashboard Cron Job (or any other scheduler) must send. Lowercase
 * because `Headers.get()` is case-insensitive but this repo's other header constants (none yet
 * exist) would need a single canonical casing to grep for — chosen lowercase to match how it will
 * actually appear if anyone inspects raw request logs. */
export const CRON_SECRET_HEADER = 'x-cron-secret';

export type AuthCheckResult =
  | { authorized: true }
  | { authorized: false; reason: 'missing_secret_config' | 'missing_header' | 'secret_mismatch' };

/**
 * Constant-time string comparison — guards the shared-secret check below against a timing
 * side-channel (an attacker measuring response latency to guess the secret one byte at a time).
 * Hand-rolled rather than pulled from an `npm:`/`jsr:` crypto helper: the entire point is to never
 * branch on a length or byte mismatch early, and a fixed-length XOR-accumulate over the LONGER of
 * the two strings does that with no dependency at all.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i++) {
    const charA = i < a.length ? a.charCodeAt(i) : 0;
    const charB = i < b.length ? b.charCodeAt(i) : 0;
    diff |= charA ^ charB;
  }
  return diff === 0;
}

/**
 * Gates this endpoint against everyone except whatever schedules it. There is deliberately no path
 * from an ordinary user's Supabase session JWT to `authorized: true` here — this is not
 * `analysis/index.ts`'s or `delete-account/index.ts`'s pattern (verify the CALLER'S OWN identity
 * via `auth.getUser()`), because a cron trigger has no user session to verify. Instead this
 * compares a single shared secret Ian sets via `supabase secrets set` (never a repo file, never
 * `EXPO_PUBLIC_*` — CLAUDE.md's "Secrets & env") against the `X-Cron-Secret` header the scheduler
 * is configured to send.
 *
 * FAILS CLOSED on every branch:
 *   - `expectedSecret` unset/empty (the production secret was never provisioned) → denied, never
 *     silently compared against `undefined`/empty string, which would otherwise let an equally
 *     empty header "match".
 *   - header missing → denied.
 *   - header present but wrong → denied, via the constant-time compare above.
 */
export function checkCronAuth(
  headerValue: string | null,
  expectedSecret: string | undefined | null
): AuthCheckResult {
  if (!expectedSecret) {
    return { authorized: false, reason: 'missing_secret_config' };
  }
  if (!headerValue) {
    return { authorized: false, reason: 'missing_header' };
  }
  if (!timingSafeEqual(headerValue, expectedSecret)) {
    return { authorized: false, reason: 'secret_mismatch' };
  }
  return { authorized: true };
}

// ---------------------------------------------------------------------------
// Request body — dry-run by default, bounded, validated.
// ---------------------------------------------------------------------------

export interface SweepRequestOptions {
  dryRun: boolean;
  olderThan: string;
  limit: number;
}

export type ParseRequestResult = { ok: true; options: SweepRequestOptions } | { ok: false; error: string };

/** Matches `_shared/storage-sweep.ts`'s own `DEFAULT_OLDER_THAN` / `DEFAULT_RPC_LIMIT` — kept as
 * a separate literal here (not imported) since those two are module-private in that file, and
 * re-deriving the same two constants costs nothing while keeping this file's only import from
 * `storage-sweep.ts` a type-only one. */
const DEFAULT_OLDER_THAN = '15 minutes';
const DEFAULT_LIMIT = 500;

/** Hard clamp on the RPC's `p_limit`, independent of whatever a caller (or a fat-fingered Cron Job
 * body edit) asks for. This is the "bound the work" guarantee: even a request body containing
 * `{"limit": 1000000}` cannot make one invocation try to walk an unbounded number of prefixes —
 * whatever a run doesn't reach is picked up on the schedule's next tick, same self-healing design
 * `sweep_stale_reservations()`'s own `p_batch_limit` uses (`20260713130000_stale_reservation_sweep.sql`). */
const MAX_LIMIT = 1000;

/**
 * Parses and validates the optional JSON request body. Defaults to `dryRun: true` — SAFE BY
 * DEFAULT. This is a scheduled job that deletes images of people's bodies; an empty/absent body
 * (exactly what a freshly wired-up Dashboard Cron Job sends before anyone has reviewed its output)
 * must never silently start deleting things. Arming live deletion is an explicit, deliberate act:
 * editing the Cron Job's request body to `{"dryRun": false}` — see `index.ts`'s header and this
 * issue's final report for the exact manual step.
 */
export function parseSweepRequest(raw: unknown): ParseRequestResult {
  if (raw === null || raw === undefined) {
    return { ok: true, options: { dryRun: true, olderThan: DEFAULT_OLDER_THAN, limit: DEFAULT_LIMIT } };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const body = raw as Record<string, unknown>;

  let dryRun = true;
  if (body.dryRun !== undefined) {
    if (typeof body.dryRun !== 'boolean') {
      return { ok: false, error: '"dryRun" must be a boolean.' };
    }
    dryRun = body.dryRun;
  }

  let olderThan = DEFAULT_OLDER_THAN;
  if (body.olderThan !== undefined) {
    if (typeof body.olderThan !== 'string' || body.olderThan.trim().length === 0) {
      return { ok: false, error: '"olderThan" must be a non-empty string (a Postgres interval literal).' };
    }
    olderThan = body.olderThan;
  }

  let limit = DEFAULT_LIMIT;
  if (body.limit !== undefined) {
    if (typeof body.limit !== 'number' || !Number.isInteger(body.limit) || body.limit < 1) {
      return { ok: false, error: '"limit" must be a positive integer.' };
    }
    limit = Math.min(body.limit, MAX_LIMIT);
  }

  return { ok: true, options: { dryRun, olderThan, limit } };
}

// ---------------------------------------------------------------------------
// Dry-run reporting — read-only, never touches Storage.
// ---------------------------------------------------------------------------

/**
 * Same snake_case → camelCase translation as `_shared/storage-sweep.ts`'s own (module-private)
 * `normalizeRows`, reimplemented independently here rather than exported+imported from that
 * read-only file — matching this codebase's established file-lane-independence idiom (see
 * `storage-sweep.ts`'s own header, "WHY THIS DOESN'T IMPORT `delete-analysis.ts`'s `purgePrefix`").
 * Used ONLY for the dry-run report path: the live purge path calls `sweepOrphanedMediaPrefixes()`
 * directly, which does its own normalization internally and this file never duplicates that.
 */
export function normalizeCandidateRows(data: unknown): OrphanedPrefixRow[] {
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

// ---------------------------------------------------------------------------
// HTTP status mapping
// ---------------------------------------------------------------------------

export type AuthDenialReason = Extract<AuthCheckResult, { authorized: false }>['reason'];

export function httpStatusForAuthDenial(reason: AuthDenialReason): number {
  // Every denial reason is a 401 from the caller's point of view — `missing_secret_config` is a
  // SERVER misconfiguration, but responding 500 there would leak "the secret isn't set yet" as a
  // distinguishable signal from "you sent the wrong secret", which is worse for an endpoint whose
  // entire job is to look identical to an unauthorized request either way. The distinction is only
  // ever visible server-side, in the structured log line `index.ts` emits before returning.
  void reason;
  return 401;
}
