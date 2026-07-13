// `DELETE /functions/v1/analysis/:id` (issue #57) — closes issue #3 (deleting an analysis
// orphaned its Storage frames forever). This is the ONLY user-facing hard-delete path in the
// app: `public.analyses` grants the client SELECT plus a soft-delete UPDATE restricted to the
// `deleted_at` column (issue #2), and `storage.objects` grants the client SELECT only (issue
// #88) — neither role can remove anything on its own. See `docs/architecture.md`'s "Planned —
// API" table and `_shared/delete-analysis.ts`'s header comment for the full design rationale
// (ordering, idempotency, and the authorization model). This file is deliberately thin: all
// decision logic lives in `_shared/delete-analysis.ts` (fully unit-tested under Deno — see
// `_shared/__tests__/delete-analysis.deno.test.ts`); this is just the HTTP/auth glue, same split
// as `ai-guard.ts` (tested) vs. this function's own use of `ai-guard-client.ts`'s pattern
// (`delete-analysis-client.ts`, untested — nothing pure to test in a thin Deno/npm: factory).
//
// AUTH: the caller's identity is never trusted from the request — the Authorization header's
// JWT is verified against Supabase Auth itself via `auth.getUser()` (a real round trip, not a
// local decode), which also rejects a missing/expired/malformed token outright (`error` set,
// falls into the 401 branch below). Anon requests carry no Authorization header at all and are
// refused at the same check.
import { createClient } from 'npm:@supabase/supabase-js@2.110.2';
import {
  deleteAnalysis,
  httpStatusForOutcome,
  isValidUuid,
  parseAnalysisIdFromUrl,
  responseBodyForOutcome,
  type LogEvent,
} from '../_shared/delete-analysis.ts';
import { createDeleteAnalysisDeps } from '../_shared/delete-analysis-client.ts';
import { hashUserId, logEvent, newRequestId, type LogLevel } from '../_shared/log.ts';

function getPublishableKey(): string {
  const raw = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (!raw) {
    throw new Error('SUPABASE_PUBLISHABLE_KEYS is not set in the edge function environment');
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
      return parsed[0];
    }
  } catch {
    // Not JSON — a single bare key string. Fall through and use it as-is.
  }
  return raw;
}

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
 * `lib/consent.ts` already uses on the client side of this codebase.
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
  if (req.method !== 'DELETE') {
    return jsonResponse(405, { error: 'Only DELETE is supported on this route.', code: 'method_not_allowed' });
  }

  const id = parseAnalysisIdFromUrl(req.url);
  if (!id || !isValidUuid(id)) {
    return jsonResponse(400, { error: 'A valid analysis id is required in the URL path.', code: 'invalid_id' });
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

  const { analyses, storage } = createDeleteAnalysisDeps();
  // Issue #132. `deleteAnalysis` purges Storage a second time after the row is marked deleted, to
  // catch frames from an `attach_media_paths` that committed in the gap. When that second purge
  // actually finds something, it means a real orphan was caught — and when it FAILS, images of a
  // person's body are still sitting in the bucket after the user asked for them to be deleted.
  // Both are emitted as structured events, and the log sink defaults to a no-op — so without this
  // line the alarm exists but nothing can hear it. Same wiring as delete-account/index.ts.
  //
  // Issue #85: routed through `_shared/log.ts`'s `logEvent()` rather than a bare `console.log`.
  // `_shared/delete-analysis.ts` (not owned by this issue's lane) builds each event with the raw
  // `callerUserId` and sometimes its own `level` ('warn'/'error' on the orphan-catching paths) —
  // this wrapper swaps the raw id for the pre-computed hash and normalizes the level, without
  // changing what `deleteAnalysis` itself decides to log or when.
  const requestId = newRequestId();
  const userIdHash = await hashUserId(callerUserId);
  const log: LogEvent = (event) => {
    const { userId, level, event: eventName, ...rest } = event;
    logEvent({
      level: (typeof level === 'string' ? level : 'info') as LogLevel,
      fn: 'analysis',
      requestId,
      userId: typeof userId === 'string' ? userIdHash : null,
      ...rest,
      event: typeof eventName === 'string' ? eventName : 'delete_analysis.unknown',
    });
  };
  const result = await deleteAnalysis(analyses, storage, { analysisId: id, callerUserId, log });

  return jsonResponse(httpStatusForOutcome(result.outcome), responseBodyForOutcome(result));
});
