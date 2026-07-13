// `POST /functions/v1/purchase-tier` (issue #51) — the dummy purchase, and the ONLY legitimate
// writer to `public.subscriptions`.
//
//     { tier, source: "dummy" }  ->  200 { tier, periodStart, periodEnd }
//                                ->  429 { error, code: "rate_limited" }
//
// The contract is deliberately identical to V2.2's so v2 can swap `source` to real receipt
// verification without changing its shape. No real money moves in v1: there is no IAP and no
// Stripe (real IAP is Apple-gated and post-MVP — `docs/blocked-on-apple.md`).
//
// *** DEPENDS ON A MIGRATION THAT IS WRITTEN, NOT APPLIED ***
// `pace_purchase_tier` (`supabase/migrations/20260713120000_purchase_tier_function.sql`) has not
// been pushed to the live project as of this commit — issue #51's hard constraint forbids applying
// it from this worktree. This function will fail with `purchase_unavailable` (500) against
// production until that migration lands. Same footing `quota-status` (#50) and `analysis` (#57)
// shipped on: built and Deno-tested, not deployed.
//
// ============================================================================================
// DEPLOYMENT GATE — READ THIS BEFORE DEPLOYING THIS FUNCTION, NOT AFTER
// ============================================================================================
// A 2026-07-13 security audit (PR #123) found this endpoint is a $0 self-grant of the highest
// paid tier, reachable by anyone on the internet, THE MOMENT it is deployed to a project with
// open signup — which is this project's current state (`enable_signup = true`,
// `enable_confirmations = false` in `supabase/config.toml`; `POST /auth/v1/signup` with a
// throwaway address returns a valid access token immediately, no human involved). Full chain:
// pull the publishable key out of any build (it's inlined in plaintext by design) -> sign up ->
// POST this endpoint with tier=elite -> live `reserve_analysis` now grants 30 analyses / 8-frame
// cap instead of free's 1/1 -> burn them to trip the shared `ai_ops_config` daily spend cap ($10)
// -> every real user's `analyze-form` is denied for the rest of the day -> repeat with a fresh
// signup. Cost to attacker: $0. This comment previously said "TestFlight-only, MUST NOT ship to a
// public App Store release as-is" — that was a comment, not a control, and did nothing to stop
// any of the above the moment the function was deployed at all, public release or not.
//
// THE CONTROL: `PURCHASE_TIER_DUMMY_ENABLED` must be the exact string `"true"` in this function's
// environment, or every request — including malformed ones, including anon ones with no
// Authorization header at all — gets an identical 404, checked BEFORE the HTTP method, BEFORE the
// Authorization header, BEFORE anything about the request is inspected. The response is
// indistinguishable from the route not existing: same status, same generic body, regardless of
// *why* it was refused, so a prober cannot tell "disabled" apart from "disabled-but-you're-on-an-
// allowlist-anyway" by diffing responses.
//
// *** PURCHASE_TIER_DUMMY_ENABLED MUST NEVER BE SET IN PRODUCTION SECRETS. *** It exists only for
// a TestFlight-with-closed-testers build, and even there `supabase secrets set` should scope it as
// narrowly as the deployment story allows. Tracked as a release blocker in `docs/status.md`.
//
// Optional second lever, cheap defense-in-depth once the flag above IS on:
// `PURCHASE_TIER_ALLOWED_USER_IDS` — a comma-separated list of user ids. If set (non-empty), only
// those callers may use this endpoint even with the flag on; everyone else gets the same 404.
// Unset/empty means no additional restriction beyond the master flag.
//
// See `_shared/purchase-tier.ts`'s `checkDeploymentGate` for the portable decision logic (unit
// tested); this file only reads the two Deno env vars and calls it.
//
// WHY THIS FUNCTION EXISTS AT ALL — the one thing to understand before editing it:
// `public.subscriptions` grants the client SELECT and NOTHING ELSE (and, as of this same audit,
// no INSERT/UPDATE/DELETE/TRUNCATE privilege either — see the migration). It has no INSERT/UPDATE
// policy for `authenticated`, deliberately, because one would let any authenticated user
// self-grant elite tier for free with a single REST call — Echo V1's schema.sql shipped exactly
// that policy and had to remove it (see `20260711150100_subscriptions.sql`'s comment, which is a
// scar, not documentation). THIS FUNCTION IS THE REPLACEMENT FOR THAT POLICY. If a change here
// ever starts to feel like it would be easier with a client-side insert policy, that is the exact
// wrong turn, and it has already been made once in this codebase's lineage.
//
// This file is deliberately thin: request validation and response shaping live in
// `_shared/purchase-tier.ts` (Deno/Jest-portable, unit-tested — see
// `_shared/__tests__/purchase-tier.deno.test.ts`), and the tier write + period anchoring + the
// idempotency semantics live atomically in the `pace_purchase_tier` SQL function. This is just the
// HTTP/auth/gate glue, same split as `quota-status/index.ts` and `analysis/index.ts`.
//
// AUTH: the caller's identity is NEVER trusted from the request body — a `user_id` in the body is
// not read by any code path here or in `_shared/purchase-tier.ts` (which reads exactly `tier` and
// `source`). The Authorization header's JWT is verified against Supabase Auth itself via
// `auth.getUser()` (a real round trip, not a local decode), which also rejects a missing/expired/
// malformed token outright. Anon requests carry no Authorization header and are refused at the same
// check. That verified id is the only one that reaches the RPC (and the only one the optional
// allowlist above is ever checked against). On an endpoint that hands out paid tiers for free, this
// is the difference between "grant myself elite" and "grant anyone elite".
import { createClient } from 'npm:@supabase/supabase-js@2.110.2';
import { errorClassOf, hashUserId, logEvent, newRequestId } from '../_shared/log.ts';
import {
  checkDeploymentGate,
  httpStatusForPurchase,
  parsePurchaseRequest,
  purchaseTier,
  responseBodyForPurchase,
  type DeploymentGateConfig,
} from '../_shared/purchase-tier.ts';
import { createPurchaseTierClient } from '../_shared/purchase-tier-client.ts';

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

/** A uniform 404, indistinguishable regardless of WHY the gate refused — see this file's
 * "DEPLOYMENT GATE" header. Never customize this body per reason; that would itself leak. */
function notFoundResponse(): Response {
  return jsonResponse(404, { error: 'Not found.', code: 'not_found' });
}

/**
 * Reads the deployment-gate env vars. Deno-only (`Deno.env`), so it lives here and nowhere else —
 * `_shared/purchase-tier.ts`'s `checkDeploymentGate` takes the parsed result as a plain argument
 * and stays portable/unit-testable without touching `Deno.env` at all.
 */
function readDeploymentGateConfig(): DeploymentGateConfig {
  const enabled = Deno.env.get('PURCHASE_TIER_DUMMY_ENABLED') === 'true';

  const rawAllowlist = Deno.env.get('PURCHASE_TIER_ALLOWED_USER_IDS');
  const allowedUserIds =
    rawAllowlist && rawAllowlist.trim().length > 0
      ? rawAllowlist
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
      : null;

  return { enabled, allowedUserIds };
}

/**
 * Verifies the caller's JWT against Supabase Auth and returns their user id. Throws (never returns
 * a fabricated/guessed id) on a missing, expired, or otherwise invalid token — the caller below
 * treats any throw here as `401 unauthorized`, same fail-closed shape `quota-status/index.ts` and
 * `analysis/index.ts` already use (kept as a separate copy per their own "limit blast radius"
 * rationale, doubly relevant while other agents work in `_shared/` concurrently).
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
  const startedAt = Date.now();
  // Issue #85 — correlates every log line below for this one invocation.
  const requestId = newRequestId();

  // Gate check FIRST — before the HTTP method, before the Authorization header, before anything
  // about this specific request is inspected. If the master flag is off, this route must behave
  // as close to "does not exist" as possible for every caller, with zero exceptions. See this
  // file's "DEPLOYMENT GATE" header.
  const gateConfig = readDeploymentGateConfig();
  if (!gateConfig.enabled) {
    return notFoundResponse();
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Only POST is supported on this route.', code: 'method_not_allowed' });
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

  // The allowlist (if configured) is checked against the JWT-verified id only — never anything
  // from the request body. A miss gets the exact same 404 the master-flag-off path returns, so a
  // caller cannot tell "the feature is off entirely" apart from "it's on but you're not a tester".
  const gateDecision = checkDeploymentGate(gateConfig, callerUserId);
  if (!gateDecision.allowed) {
    logEvent({
      level: 'warn',
      fn: 'purchase-tier',
      event: 'purchase_gate_denied',
      requestId,
      userId: await hashUserId(callerUserId),
      reason: 'not_on_allowlist',
    });
    return notFoundResponse();
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse(400, {
      error: 'Request body must be valid JSON of the form { tier, source: "dummy" }.',
      code: 'invalid_body',
    });
  }

  const validation = parsePurchaseRequest(rawBody);
  if (!validation.ok) {
    return jsonResponse(400, { error: validation.error, code: validation.code });
  }
  const { tier, source } = validation.request;

  // Structured log at the boundary — a tier grant is the single most security-relevant write in
  // this app, and a silent one is unauditable. Never log the token or the raw body. Routed through
  // `_shared/log.ts` (issue #85): `userId` is now the hashed pseudonym, not the raw `auth.uid`,
  // and `requestId` ties this line to whichever of `purchase_completed`/`purchase_rate_limited`/
  // `purchase_failed` follows below.
  logEvent({
    level: 'info',
    fn: 'purchase-tier',
    event: 'purchase_requested',
    requestId,
    userId: await hashUserId(callerUserId),
    tier,
    source,
  });

  try {
    const result = await purchaseTier(createPurchaseTierClient(), callerUserId, tier);

    logEvent({
      level: result.outcome === 'rate_limited' ? 'warn' : 'info',
      fn: 'purchase-tier',
      event: result.outcome === 'rate_limited' ? 'purchase_rate_limited' : 'purchase_completed',
      requestId,
      userId: await hashUserId(callerUserId),
      tier: result.tier,
      // `outcome` is the repurchase/idempotency signal — 'unchanged' means this was a replay and
      // the period anchor was (correctly) left alone; 'rate_limited' means this call was refused
      // outright. Logged, never returned as-is in a 200: the V2.2 success contract is exactly
      // three fields, and a rate-limited response gets its own error-shaped body instead.
      outcome: result.outcome,
      purchasedAt: result.purchasedAt,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
      durationMs: Date.now() - startedAt,
    });

    return jsonResponse(httpStatusForPurchase(result), responseBodyForPurchase(result));
  } catch (err) {
    // A DB-side failure (including "pace_purchase_tier does not exist" if this is ever hit before
    // its migration is applied — see this file's header) is never the caller's fault, and never a
    // 4xx. Never leak the raw Postgres/network error message to the client: it is the only thing
    // here that could disclose schema internals.
    //
    // Issue #85: this log line used to carry `message: err.message` — a raw Postgres error can
    // echo the offending value of a violated constraint (e.g. a unique-constraint message names
    // the duplicate key), which is exactly the kind of accidental PII leak this issue exists to
    // close. `errorClass` (the error's constructor name only) replaces it.
    logEvent({
      level: 'error',
      fn: 'purchase-tier',
      event: 'purchase_failed',
      requestId,
      userId: await hashUserId(callerUserId),
      tier,
      durationMs: Date.now() - startedAt,
      errorClass: errorClassOf(err),
    });
    return jsonResponse(500, {
      error: 'Could not complete your purchase. Please try again shortly.',
      code: 'purchase_unavailable',
    });
  }
});
