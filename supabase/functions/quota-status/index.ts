// `GET /functions/v1/quota-status` (issue #50) — the server-authoritative read that makes #54
// (Home's quota display) honest instead of a client-side guess. CLAUDE.md: "Tier, quota, frame
// cap, and analysis are server-only (edge functions); the client may display tier/quota state but
// is never the authority for it." `app/(tabs)/index.tsx:82` currently violates that by deriving
// quota from its own `subscriptions` + `analyses` count query; this function is what #54 must
// replace it with. See `docs/architecture.md`'s "Planned — API" table for the documented
// contract and `_shared/quota-status.ts`'s header comment for how this function's counting
// agrees with `reserve_analysis`'s.
//
// *** DEPENDS ON A MIGRATION THAT IS WRITTEN, NOT APPLIED ***
// `pace_quota_status` (`supabase/migrations/20260712233000_quota_status_function.sql`) has not
// been pushed to the live project as of this commit — issue #50's hard constraint forbids
// applying it from this worktree. This function will fail with a `db_error` (see below) against
// production until that migration lands. Same footing `analysis/index.ts` (#57) shipped on:
// built and Deno-tested, not deployed.
//
// This is deliberately thin: all decision/shaping logic lives in `_shared/quota-status.ts`
// (Deno/Jest-portable, unit-tested under Deno — see `_shared/__tests__/quota-status.deno.test.ts`);
// this file is just the HTTP/auth glue, same split as `analysis/index.ts`.
//
// AUTH: the caller's identity is never trusted from the request — there is no request body on a
// GET, and no user-id query param either. The Authorization header's JWT is verified against
// Supabase Auth itself via `auth.getUser()` (a real round trip, not a local decode), which also
// rejects a missing/expired/malformed token outright. Anon requests carry no Authorization header
// and are refused at the same check. This mirrors `analysis/index.ts`'s `resolveCallerUserId`
// exactly (kept as a separate copy per that file's own "limit blast radius" rationale, extended
// here to cover concurrent multi-agent work on `_shared/`).
import { createClient } from 'npm:@supabase/supabase-js@2.110.2';
import { errorClassOf, hashUserId, logEvent, newRequestId } from '../_shared/log.ts';
import { getQuotaStatus, httpStatusForQuotaStatus, responseBodyForQuotaStatus } from '../_shared/quota-status.ts';
import { createQuotaStatusClient } from '../_shared/quota-status-client.ts';
import { getPublishableKey } from '../_shared/supabase-keys.ts';

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Verifies the caller's JWT against Supabase Auth and returns their user id. Throws (never
 * returns a fabricated/guessed id) on a missing, expired, or otherwise invalid token — the
 * caller below treats any throw here as `401 unauthorized`, same fail-closed shape
 * `analysis/index.ts` and `lib/consent.ts` already use elsewhere in this codebase.
 */
async function resolveCallerUserId(authHeader: string): Promise<string> {
  const url = Deno.env.get('SUPABASE_URL');
  if (!url) {
    throw new Error('SUPABASE_URL is not set in the edge function environment');
  }
  const authClient = createClient(url, getPublishableKey(), {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) {
    throw new Error('Invalid or expired session');
  }
  return data.user.id;
}

Deno.serve(async (req) => {
  // Issue #85 — minted once per invocation; correlates this request's log line(s) even though
  // today there is normally at most one (the failure path below).
  const requestId = newRequestId();
  const startedAt = Date.now();

  if (req.method !== 'GET') {
    return jsonResponse(405, { error: 'Only GET is supported on this route.', code: 'method_not_allowed' });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse(401, { error: 'Missing Authorization header.', code: 'unauthorized' });
  }

  let callerUserId: string;
  try {
    callerUserId = await resolveCallerUserId(authHeader);
  } catch {
    return jsonResponse(401, { error: 'Invalid or expired session.', code: 'unauthorized' });
  }

  try {
    const status = await getQuotaStatus(createQuotaStatusClient(), callerUserId);
    return jsonResponse(httpStatusForQuotaStatus(), responseBodyForQuotaStatus(status));
  } catch (err) {
    // A DB-side failure (including "pace_quota_status does not exist" if this is ever hit before
    // its migration is applied — see this file's header) is never the caller's fault, and never
    // a 4xx. Never leak the raw Postgres/network error message to the client.
    console.error('quota-status: pace_quota_status call failed', err instanceof Error ? err.message : err);
    // Issue #85 — this endpoint had NO structured logging at all before this line: a failed
    // `quota-status` call (e.g. the migration-not-yet-applied `db_error` this file's header warns
    // about) was as invisible as the `analyze-form` gap the issue is named for.
    logEvent({
      level: 'error',
      fn: 'quota-status',
      event: 'quota_status_failed',
      requestId,
      userId: await hashUserId(callerUserId),
      errorClass: errorClassOf(err),
      durationMs: Date.now() - startedAt,
      outcome: 'db_error',
    });
    return jsonResponse(500, {
      error: 'Could not determine your current quota. Please try again shortly.',
      code: 'quota_status_unavailable',
    });
  }
});
