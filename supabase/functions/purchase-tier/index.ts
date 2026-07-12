// `POST /functions/v1/purchase-tier` (issue #51) — the dummy purchase, and the ONLY legitimate
// writer to `public.subscriptions`.
//
//     { tier, source: "dummy" }  ->  200 { tier, periodStart, periodEnd }
//
// The contract is deliberately identical to V2.2's so v2 can swap `source` to real receipt
// verification without changing its shape. No real money moves in v1: there is no IAP and no
// Stripe (real IAP is Apple-gated and post-MVP — `docs/blocked-on-apple.md`). Dummy is
// TestFlight-only and MUST NOT ship to a public App Store release as-is.
//
// *** DEPENDS ON A MIGRATION THAT IS WRITTEN, NOT APPLIED ***
// `pace_purchase_tier` (`supabase/migrations/20260713120000_purchase_tier_function.sql`) has not
// been pushed to the live project as of this commit — issue #51's hard constraint forbids applying
// it from this worktree. This function will fail with `purchase_unavailable` (500) against
// production until that migration lands. Same footing `quota-status` (#50) and `analysis` (#57)
// shipped on: built and Deno-tested, not deployed.
//
// WHY THIS FUNCTION EXISTS AT ALL — the one thing to understand before editing it:
// `public.subscriptions` grants the client SELECT and NOTHING ELSE. It has no INSERT/UPDATE policy
// for `authenticated`, deliberately, because one would let any authenticated user self-grant elite
// tier for free with a single REST call — Echo V1's schema.sql shipped exactly that policy and had
// to remove it (see `20260711150100_subscriptions.sql`'s comment, which is a scar, not
// documentation). THIS FUNCTION IS THE REPLACEMENT FOR THAT POLICY. If a change here ever starts to
// feel like it would be easier with a client-side insert policy, that is the exact wrong turn, and
// it has already been made once in this codebase's lineage.
//
// This file is deliberately thin: request validation and response shaping live in
// `_shared/purchase-tier.ts` (Deno/Jest-portable, unit-tested — see
// `_shared/__tests__/purchase-tier.deno.test.ts`), and the tier write + period anchoring + the
// idempotency semantics live atomically in the `pace_purchase_tier` SQL function. This is just the
// HTTP/auth glue, same split as `quota-status/index.ts` and `analysis/index.ts`.
//
// AUTH: the caller's identity is NEVER trusted from the request body — a `user_id` in the body is
// not read by any code path here or in `_shared/purchase-tier.ts` (which reads exactly `tier` and
// `source`). The Authorization header's JWT is verified against Supabase Auth itself via
// `auth.getUser()` (a real round trip, not a local decode), which also rejects a missing/expired/
// malformed token outright. Anon requests carry no Authorization header and are refused at the same
// check. That verified id is the only one that reaches the RPC. On an endpoint that hands out paid
// tiers for free, this is the difference between "grant myself elite" and "grant anyone elite".
import { createClient } from 'npm:@supabase/supabase-js@2.110.2';
import {
  httpStatusForPurchase,
  parsePurchaseRequest,
  purchaseTier,
  responseBodyForPurchase,
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
  // this app, and a silent one is unauditable. Never log the token or the raw body.
  console.log(
    JSON.stringify({
      fn: 'purchase-tier',
      event: 'purchase_requested',
      userId: callerUserId,
      tier,
      source,
    })
  );

  try {
    const result = await purchaseTier(createPurchaseTierClient(), callerUserId, tier);

    console.log(
      JSON.stringify({
        fn: 'purchase-tier',
        event: 'purchase_completed',
        userId: callerUserId,
        tier: result.tier,
        // `outcome` is the repurchase/idempotency signal — 'unchanged' means this was a replay and
        // the period anchor was (correctly) left alone. Logged, never returned: the V2.2 response
        // contract is exactly three fields.
        outcome: result.outcome,
        purchasedAt: result.purchasedAt,
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        durationMs: Date.now() - startedAt,
      })
    );

    return jsonResponse(httpStatusForPurchase(), responseBodyForPurchase(result));
  } catch (err) {
    // A DB-side failure (including "pace_purchase_tier does not exist" if this is ever hit before
    // its migration is applied — see this file's header) is never the caller's fault, and never a
    // 4xx. Never leak the raw Postgres/network error message to the client: it is the only thing
    // here that could disclose schema internals.
    console.error(
      JSON.stringify({
        fn: 'purchase-tier',
        event: 'purchase_failed',
        userId: callerUserId,
        tier,
        durationMs: Date.now() - startedAt,
        message: err instanceof Error ? err.message : String(err),
      })
    );
    return jsonResponse(500, {
      error: 'Could not complete your purchase. Please try again shortly.',
      code: 'purchase_unavailable',
    });
  }
});
