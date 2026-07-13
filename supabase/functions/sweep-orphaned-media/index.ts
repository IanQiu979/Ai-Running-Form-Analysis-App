// `POST /functions/v1/sweep-orphaned-media` (issue #137) — the schedule `_shared/storage-sweep.ts`
// never got. That file is a tested purge orchestrator (list → remove → verify) over the
// `public.list_orphaned_media_prefixes` detection RPC (`20260713152000_storage_user_budget.sql`),
// but nothing has ever called it: orphaned `{user_id}/{analysis_id}/` prefixes in the private
// `media` bucket accumulate unswept, and the failure mode is a Supabase plan upgrade nobody chose
// (free-plan storage is 1 GB total / 5 GB egress per month — this org is on Pro, but the same
// unbounded-growth problem still costs real money there).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// ROUTE DECISION — Supabase Dashboard Cron Job → this edge function, NOT pg_cron+pg_net+Vault.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// The issue posed two options. This picks the Dashboard Cron Job route, for reasons specific to
// THIS sweep (not a blanket "always prefer Dashboard cron" rule):
//
//   1. `storage.objects` is Postgres METADATA only (storage-sweep.ts's own header) — actually
//      removing an object requires the real Storage HTTP API, which no SQL statement can reach.
//      Unlike `sweep_stale_reservations()` (`20260713130000_stale_reservation_sweep.sql`, pure
//      row bookkeeping, scheduled via `cron.schedule()` calling a SQL function DIRECTLY — no HTTP
//      hop, no credential, needed), THIS sweep cannot avoid an HTTP hop no matter which route wins.
//      That migration's own "Design Decision 3" made the direct-SQL choice specifically BECAUSE it
//      could dodge the HTTP-hop-needs-a-credential problem entirely; this sweep cannot, so its
//      reasoning for avoiding `pg_net`+Vault does not resolve in the same direction here — it
//      resolves the OPPOSITE way, once the HTTP hop is a given either way.
//   2. Given the HTTP hop is unavoidable, the question becomes: who holds the credential that
//      authorizes it, and where does it get provisioned? `pg_net.http_post` from inside a
//      `cron.schedule(...)` call needs a credential in its request headers, which needs to live in
//      Supabase Vault — and a migration file (checked into git) can never safely provision the
//      ACTUAL secret VALUE into Vault (same problem that migration's Design Decision 3 already
//      names). Confirmed live via read-only `list_extensions`: `pg_net` is NOT even installed on
//      this project today (`pg_cron` is, from that same migration) — route (b) would need a NEW
//      `create extension pg_net` migration on top of the Vault-provisioning gap.
//   3. A Supabase Dashboard Cron Job targeting an Edge Function is the platform's own built-in
//      answer to "schedule an HTTP call, keep the credential out of git": the header (holding the
//      shared secret below) is configured in the Dashboard, never in a repo file, never in a
//      migration. This is a config/deploy-time decision, same category CLAUDE.md already reserves
//      for `ANTHROPIC_API_KEY` (`.env`/`supabase secrets set`, never source) — just applied to a
//      Cron Job's headers instead of a function's runtime env.
//   4. Org is on the Pro plan (confirmed — `docs/status.md`), where Dashboard Cron Jobs are fully
//      available; nothing about this route needs Pro specifically (Free plan has it too), but it
//      rules out "we're gated by plan" as a reason to prefer the other route.
//
// THIS ROUTE IS NOT YET ARMED. Building this function does not schedule it — no code in this repo
// can create a Dashboard Cron Job; that is a Studio UI action only Ian can take. See this issue's
// final report for the exact steps (deploy command, secret, Cron Job configuration).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// AUTH — a shared secret, not a user JWT. See `core.ts`'s `checkCronAuth` for the mechanics.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Every other endpoint in this codebase (`analyze-form`, `analysis`, `delete-account`,
// `quota-status`, `purchase-tier`) verifies the CALLER'S OWN identity via `auth.getUser()` — that
// pattern has no meaning here, because a Cron Job has no user session to present. Instead:
//   - This function MUST be deployed with `--no-verify-jwt` (Ian's step — see the final report).
//     Without it, Supabase's platform gateway rejects every Cron Job request before this file's
//     code ever runs, since a Cron Job carries no Supabase Auth JWT either.
//   - `checkCronAuth` then does the real gating: the `X-Cron-Secret` header must match
//     `SWEEP_ORPHANED_MEDIA_SECRET` (an env var ONLY this function reads, set via
//     `supabase secrets set` — never a repo file, never `EXPO_PUBLIC_*`), compared in constant
//     time. No ordinary authenticated user's JWT is sufficient, by construction — there is no code
//     path here that even looks at an `Authorization` header. Missing/misconfigured secret fails
//     CLOSED (denied), never open.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// DRY-RUN BY DEFAULT — the sharp edge this file exists to respect.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// The sweeper deletes user media (images of people's bodies). `parseSweepRequest` (`core.ts`)
// defaults `dryRun` to `true`: an empty/absent request body — exactly what a freshly wired-up but
// not-yet-reviewed Cron Job sends — reports what WOULD be deleted without deleting anything. Live
// deletion is armed only by an explicit `{"dryRun": false}` in the Cron Job's configured request
// body, a deliberate act Ian takes after reviewing dry-run output in the function logs. Dry-run
// never calls `sweepOrphanedMediaPrefixes()` (the real purge) at all — it calls the SAME detection
// RPC directly and stops, so there is no code path where a dry-run request can accidentally reach
// `storage.remove()`.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// IDEMPOTENCY / RESUMABILITY — no synthetic request-ID needed; this is GC, not a payment.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// A retried or overlapping invocation is a safe no-op by construction, not by a bolted-on
// idempotency key: `list_orphaned_media_prefixes` recomputes its candidate set fresh on every call
// (a prefix a previous run already purged no longer appears — it has zero objects and so fails the
// RPC's own `having` clause), and `sweepOrphanedMediaPrefixes`'s list→remove→verify idiom already
// treats an empty/already-purged prefix as a trivial success (see `storage-sweep.ts`'s own test:
// "a prefix with zero remaining objects (already-empty) still reports purged with objectCount 0").
// Two genuinely concurrent invocations racing the same prefix both list the same objects and both
// call `remove()` — Storage's `remove()` on an already-removed path is not an error, so this
// degrades to redundant work, never a double-delete or a thrown error. `limit` bounds how much work
// any single invocation can do (see `core.ts`'s `MAX_LIMIT`); whatever one run doesn't reach is
// picked up on the schedule's next tick.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// ALERTING — KNOWN GAP, stated rather than silently left.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// This function returns a non-2xx status on total failure (auth denial aside) and logs a
// structured line at every boundary (invocation received, RPC call made, purge outcome, duration).
// The Supabase Dashboard's Cron Job run history surfaces failed HTTP statuses, and edge function
// logs carry these structured lines — but neither is wired to active paging (a human notified the
// moment this starts failing or starts reporting a growing candidateCount every tick). That is
// `uptime-healthcheck`/`observability-setup` territory per AGENTS.md's routing table, explicitly
// out of scope here, same "known gap, stated rather than silently left" idiom
// `sweep_stale_reservations()`'s own migration header already uses for its own observability gap.
import { sweepOrphanedMediaPrefixes } from '../_shared/storage-sweep.ts';
import { createSweepDeps, getCronSecret } from './client.ts';
import { CRON_SECRET_HEADER, checkCronAuth, httpStatusForAuthDenial, normalizeCandidateRows, parseSweepRequest } from './core.ts';

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** One structured JSON line per boundary crossed — same "invocation received, external call made,
 * result, duration" shape `delete-account/index.ts`'s own `log` uses. No frame bytes, user ids
 * beyond the bucket prefix, or secrets are ever logged. When this scheduled job silently stops
 * running, these logs — surfaced in Supabase's edge function log viewer — are the only evidence,
 * and they have to exist before that happens, not be added after. */
function log(event: Record<string, unknown>): void {
  console.log(JSON.stringify({ fn: 'sweep-orphaned-media', ...event }));
}

Deno.serve(async (req) => {
  const startedAt = Date.now();

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Only POST is supported on this route.', code: 'method_not_allowed' });
  }

  const auth = checkCronAuth(req.headers.get(CRON_SECRET_HEADER), getCronSecret());
  if (!auth.authorized) {
    log({ event: 'sweep.unauthorized', reason: auth.reason });
    return jsonResponse(httpStatusForAuthDenial(auth.reason), {
      error: 'Unauthorized.',
      code: 'unauthorized',
    });
  }

  let rawBody: unknown = null;
  const bodyText = await req.text();
  if (bodyText.trim().length > 0) {
    try {
      rawBody = JSON.parse(bodyText);
    } catch {
      return jsonResponse(400, { error: 'Request body must be valid JSON.', code: 'invalid_request' });
    }
  }

  const parsed = parseSweepRequest(rawBody);
  if (!parsed.ok) {
    return jsonResponse(400, { error: parsed.error, code: 'invalid_request' });
  }
  const { dryRun, olderThan, limit } = parsed.options;

  log({ event: 'sweep.invoked', dryRun, olderThan, limit });

  let deps;
  try {
    deps = createSweepDeps();
  } catch (err) {
    // A missing secret (SUPABASE_URL / SUPABASE_SECRET_KEYS) — loud, never silent, same posture
    // `analyze-form/index.ts` takes for its own `createAnalyzeFormDeps()` failure. Nothing has
    // touched the RPC or Storage at this point.
    log({ event: 'sweep.misconfigured', message: err instanceof Error ? err.message : String(err) });
    return jsonResponse(500, { error: 'Sweep is not available right now.', code: 'misconfigured' });
  }

  try {
    if (dryRun) {
      const { data, error } = await deps.rpc.rpc('list_orphaned_media_prefixes', {
        p_older_than: olderThan,
        p_limit: limit,
      });
      if (error) {
        throw new Error(`list_orphaned_media_prefixes failed: ${error.message}`);
      }
      const candidates = normalizeCandidateRows(data);
      const durationMs = Date.now() - startedAt;
      log({ event: 'sweep.dry_run_complete', candidateCount: candidates.length, durationMs });
      return jsonResponse(200, {
        mode: 'dry_run',
        candidateCount: candidates.length,
        candidates,
        durationMs,
      });
    }

    const result = await sweepOrphanedMediaPrefixes(deps.rpc, deps.storage, { olderThan, limit });
    const purgedCount = result.outcomes.filter((o) => o.outcome === 'purged').length;
    const failedCount = result.outcomes.filter((o) => o.outcome === 'purge_failed').length;
    const durationMs = Date.now() - startedAt;
    log({
      event: 'sweep.purge_complete',
      candidateCount: result.candidateCount,
      purgedCount,
      failedCount,
      durationMs,
    });
    return jsonResponse(200, {
      mode: 'purge',
      candidateCount: result.candidateCount,
      outcomes: result.outcomes,
      durationMs,
    });
  } catch (err) {
    // The detection RPC itself failed (permission error, transient DB issue) — never reported as
    // a clean empty sweep. A non-2xx here is what makes a failure visible in the Cron Job's run
    // history (see this file's header, "ALERTING").
    const durationMs = Date.now() - startedAt;
    log({ event: 'sweep.failed', message: err instanceof Error ? err.message : String(err), durationMs });
    return jsonResponse(502, { error: 'Sweep failed.', code: 'sweep_failed' });
  }
});
