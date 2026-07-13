// `POST /functions/v1/analyze-form` (issue #44 + #45) — THE core of the product. A side-on clip
// goes in; an honest, certified, well-parsed PACE result comes out, or an honest failure that costs
// the user nothing.
//
// This file is deliberately thin. All decision logic — consent, the AI spend gate, the atomic quota
// reserve, the vision call, structural validation, the retry, the honest-partial fallback, the
// frame upload, and settle-vs-release — lives in `flow.ts` (pure, fully unit-tested under Deno with
// fakes and zero API spend: see `__tests__/flow.deno.test.ts`) and `_shared/analyze-form-validation
// .ts` (#45). The real Deno/Supabase/Anthropic wiring lives in `deps.ts`. This is just HTTP and
// auth, the same split `analysis/index.ts` (#57) and `quota-status/index.ts` (#50) already use.
//
// AUTH — AND WHY IT IS THE WHOLE BALLGAME. The caller's identity is NEVER taken from the request:
// the Authorization header's JWT is verified against Supabase Auth itself via `auth.getUser()` (a
// real round trip, not a local decode), and the id it returns is the ONLY user id that reaches
// `flow.ts`. There is no field in the request body that could name a user. This matters more here
// than anywhere else in the codebase: `reserve_analysis`, `settle_analysis`, and `release_analysis`
// all take `p_user_id` as a plain argument and do no independent check — by design, since they are
// `service_role`-only — so a user id read from the body would forge reservations into someone
// else's quota and settle results into their history (`docs/status.md` Known Issue #14).
import { createClient } from 'npm:@supabase/supabase-js@2.110.2';
import { errorClassOf, hashUserId, logEvent, newRequestId } from '../_shared/log.ts';
import { runAnalyzeForm } from './flow.ts';
import { createAnalyzeFormDeps } from './deps.ts';

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
 * Verifies the caller's JWT against Supabase Auth and returns their user id. Throws (never returns
 * a fabricated or body-derived id) on a missing, expired, or malformed token — the caller below
 * treats any throw as `401`. Anon requests carry no Authorization header and are refused at the
 * same check. Kept as a local copy rather than a shared import, matching the rationale
 * `quota-status/index.ts` already records: it limits the blast radius of concurrent multi-agent
 * work in `_shared/`.
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
  // Issue #85 — minted once per invocation, before auth even runs, so it can correlate this
  // request's log lines regardless of how early it fails. Threaded into `runAnalyzeForm` below so
  // `flow.ts`'s own structured events (`ai_gate_denied`, `retry_gated_out`,
  // `honest_partial_fallback`, the final summary, ...) share the same id.
  const requestId = newRequestId();

  if (req.method !== 'POST') {
    return jsonResponse(405, {
      error: 'Only POST is supported on this route.',
      code: 'method_not_allowed',
    });
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

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse(400, {
      error: 'Request body must be valid JSON.',
      code: 'invalid_request',
    });
  }

  let deps;
  try {
    deps = createAnalyzeFormDeps();
  } catch (err) {
    // A missing secret (ANTHROPIC_API_KEY, SUPABASE_SECRET_KEYS, SUPABASE_URL). Loud, never silent:
    // an un-keyed function that degrades quietly would be indistinguishable from a working one that
    // simply never produces an analysis. Nothing has been reserved or charged at this point.
    console.error(
      'analyze-form: misconfigured environment',
      err instanceof Error ? err.message : err
    );
    logEvent({
      level: 'error',
      fn: 'analyze-form',
      event: 'misconfigured',
      requestId,
      userId: await hashUserId(callerUserId),
      errorClass: errorClassOf(err),
    });
    return jsonResponse(500, {
      error: 'Analysis is not available right now. Please try again shortly.',
      code: 'misconfigured',
    });
  }

  try {
    const { status, body } = await runAnalyzeForm(deps, { callerUserId, rawBody, requestId });
    return jsonResponse(status, body);
  } catch (err) {
    // `runAnalyzeForm` catches everything internally and always resolves — this is the belt to that
    // braces, so a bug in its own `finally` (the release/record/log block) can still only ever cost
    // the caller a structured 500, never an unhandled rejection with an empty body. Never leak the
    // raw error text to the client.
    console.error(
      'analyze-form: runAnalyzeForm rejected — this should be unreachable',
      err instanceof Error ? err.message : err
    );
    logEvent({
      level: 'error',
      fn: 'analyze-form',
      event: 'run_analyze_form_rejected',
      requestId,
      userId: await hashUserId(callerUserId),
      errorClass: errorClassOf(err),
    });
    return jsonResponse(500, {
      error: 'Something went wrong running that analysis.',
      code: 'internal_error',
    });
  }
});
