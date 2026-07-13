// `POST /functions/v1/delete-account` (issue #58) — in-app account deletion.
//
// An **App Store submission blocker** (Guideline 5.1.1(v)) and the hard gate on publishing
// `docs/privacy-policy.md` at all (`docs/status.md` Known Issue #15). Ported in spirit from Echo
// V1's `delete-user/` (Ruling 6), but NOT in implementation: V1's flat `storage.list(user_id)` is
// the exact trap this codebase's nested `{user_id}/{analysis_id}/frame.jpg` layout springs — see
// `_shared/delete-account.ts`'s header, which is where the entire design (delete order, the
// blocking purge, and the consent-trail decision) is written down and argued.
//
// This file is deliberately thin: all decision logic lives in `_shared/delete-account.ts` (fully
// unit-tested under Deno — `_shared/__tests__/delete-account.deno.test.ts`), and the Deno/`npm:`
// client wiring in `_shared/delete-account-client.ts`. Same three-way split as `analysis/index.ts`
// (#57), whose `purgePrefix` this reuses rather than re-implementing.
//
// METHOD: POST, per `docs/architecture.md`'s API table — and because `supabase.functions.invoke()`
// (what the client will call this with) issues a POST by default. There is no id in the path and no
// id in the body: the ONLY account this endpoint can delete is the authenticated caller's own.
//
// AUTH: the caller's identity is never trusted from the request body — the Authorization header's
// JWT is verified against Supabase Auth itself via `auth.getUser()` (a real round trip, not a local
// decode), which also rejects a missing/expired/malformed token outright. This matters more here
// than anywhere else in the codebase: this endpoint is irreversible, so an id read off the body
// would be a one-request account-deletion weapon against any user whose UUID could be guessed or
// observed. Same rule the reserve/settle RPCs live under.
//
// REAUTHENTICATION FRESHNESS (issue #124): a valid JWT is necessary but no longer sufficient. Right
// after the JWT is verified, `isReauthFresh` (`_shared/delete-account.ts`) checks that the SAME
// token also carries proof — via its `amr` claim — that the user presented a real credential
// (password or OAuth) within the last few minutes, not just that their session hasn't expired yet.
// A stolen access token is a valid token right up until it expires and can be kept "valid" forever
// by a silent background refresh, so "valid JWT" alone is not the bar for the single most
// destructive, least reversible action this product has. This runs BEFORE `createDeleteAccountDeps`
// / `deleteAccount` — a stale-session request never touches storage, rows, or the auth user at all.
// See `_shared/delete-account.ts`'s "REAUTHENTICATION FRESHNESS" section for the full reasoning,
// including why this is NOT a `{ confirm: "DELETE" }`-style body field (those protect against
// nothing against an attacker who already holds the token).
import { createClient } from 'npm:@supabase/supabase-js@2.110.2';
import {
  accountResponseBodyForOutcome,
  deleteAccount,
  httpStatusForAccountOutcome,
  isReauthFresh,
  type LogEvent,
} from '../_shared/delete-account.ts';
import { createDeleteAccountDeps } from '../_shared/delete-account-client.ts';

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
 * One structured JSON line per boundary crossed (invocation, storage purge, row delete, auth
 * delete, completion/failure, with durations). When a deletion silently half-succeeds in
 * production, these logs are the only evidence of WHERE it stopped — and they have to already
 * exist by then. The user id is included because it is the retry key and the only handle on a
 * `orphans_remaining` prefix that needs a human; no frame bytes, results, or emails are ever
 * logged.
 */
const log: LogEvent = (event) => {
  console.log(JSON.stringify({ fn: 'delete-account', ...event }));
};

/**
 * Verifies the caller's JWT against Supabase Auth and returns their user id. Throws (never returns
 * a fabricated/guessed id) on a missing, expired, or otherwise invalid token — the caller below
 * treats any throw here as `401 unauthorized`, the same fail-closed shape `analysis/index.ts` uses.
 */
async function resolveCallerUserId(authHeader: string): Promise<string> {
  const url = Deno.env.get('SUPABASE_URL');
  if (!url) {
    throw new Error('SUPABASE_URL is not set in the edge function environment');
  }
  const authClient = createClient(url, getPublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) {
    throw new Error('Invalid or expired session');
  }
  return data.user.id;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Only POST is supported on this route.', code: 'method_not_allowed' });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    log({ event: 'delete_account.unauthorized', reason: 'missing_authorization_header' });
    return jsonResponse(401, { error: 'Missing Authorization header.', code: 'unauthorized' });
  }

  let callerUserId: string;
  try {
    callerUserId = await resolveCallerUserId(authHeader);
  } catch {
    log({ event: 'delete_account.unauthorized', reason: 'invalid_or_expired_token' });
    return jsonResponse(401, { error: 'Invalid or expired session.', code: 'unauthorized' });
  }

  // Issue #124: a valid JWT alone is not enough for the single most destructive action this
  // product has — see this file's header and `_shared/delete-account.ts`'s "REAUTHENTICATION
  // FRESHNESS" section. `isReauthFresh` reads the SAME token string just verified above (never a
  // different one) and fails closed unless it carries a real credential presentation (password or
  // OAuth, via the `amr` claim) within the freshness window. Nothing is touched below this check
  // when it fails — no storage list, no row delete, no auth-user delete.
  const rawToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!isReauthFresh(rawToken)) {
    log({ event: 'delete_account.reauth_required', userId: callerUserId });
    return jsonResponse(401, {
      error: 'Please confirm this is really you before deleting your account.',
      code: 'reauth_required',
    });
  }

  const { rows, storage, auth } = createDeleteAccountDeps();
  const result = await deleteAccount(rows, storage, auth, { userId: callerUserId, log });

  return jsonResponse(httpStatusForAccountOutcome(result.outcome), accountResponseBodyForOutcome(result));
});
