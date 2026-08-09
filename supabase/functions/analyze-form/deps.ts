// Deno-only wiring for `analyze-form` (issue #44): the service-role Supabase client (RPCs,
// consents, Storage) and the Anthropic Messages call. Imported ONLY by `index.ts` — never by
// `flow.ts` or its tests, which is what keeps the orchestration (and every contract rule in it)
// unit-testable under `deno test` with zero network and, crucially, ZERO ANTHROPIC SPEND. Same
// split as `ai-guard.ts`/`ai-guard-client.ts` and `delete-analysis.ts`/`delete-analysis-client.ts`.
//
// NOT typechecked by `npm run typecheck` (tsconfig excludes the whole `supabase/functions` tree —
// it runs on Deno, a different module/type system); IS checked by `deno check`
// (`npm run typecheck:edge`).
//
// SECRETS. `ANTHROPIC_API_KEY` is read from `Deno.env` here and NOWHERE ELSE in the repo. It has no
// `EXPO_PUBLIC_` prefix, is never in `.env`, and never crosses the wire to a client: the model call
// happens on this server, and the client only ever sees the parsed `{ result, analysisId,
// isFallback }`. Locally it lives in `supabase/functions/.env` (gitignored); in production it is
// set with `supabase secrets set`. `SUPABASE_URL` / `SUPABASE_SECRET_KEYS` are auto-injected by the
// platform — never set by hand (CLAUDE.md).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.2';
import { isAllUsersUnlimitedAccess } from '../_shared/access-override.ts';
import type { RpcClient } from '../_shared/ai-guard.ts';
import type { AnalyzeFormRequest } from '../_shared/analyze-form-prompt.ts';
import type { AnthropicMessageResponse } from '../_shared/analyze-form-validation.ts';
import { logEvent, type LogLevel } from '../_shared/log.ts';
import type {
  AnalyzeFormDeps,
  ConsentReader,
  FrameStorage,
  ModelCallResult,
  ModelCaller,
} from './flow.ts';
import { getSecretKey } from '../_shared/supabase-keys.ts';

const MEDIA_BUCKET = 'media';

/** Verified against the live Messages API docs 2026-07-12 (platform.claude.com/docs/en/api/messages
 * — "Required HTTP Headers: X-Api-Key, anthropic-version: 2023-06-01, Content-Type"), not recalled
 * from memory. */
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/** Never let a provider error message flow into a user-facing response or an unbounded log line. */
const MAX_ERROR_SNIPPET = 500;

/**
 * The Anthropic Messages call. NEVER throws: every failure — a non-2xx, a network error, an abort —
 * comes back as a typed `{ ok: false }`, because `flow.ts` must be able to release the reservation
 * and settle the spend ledger on the way out, and an exception thrown through it would be one more
 * path that could forget.
 *
 * `timeoutMs` is enforced with a real `AbortController`, and an abort is reported as `kind:
 * 'timeout'` specifically so it can be released as `'provider_timeout'` rather than `'model_error'`
 * — both are server-fault and neither counts against the anti-farming cap, but the ops signal is
 * worth keeping honest.
 */
function createModelCaller(apiKey: string): ModelCaller {
  return {
    async send(request: AnalyzeFormRequest, timeoutMs: number): Promise<ModelCallResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(ANTHROPIC_MESSAGES_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        if (!res.ok) {
          const detail = (await res.text().catch(() => '')).slice(0, MAX_ERROR_SNIPPET);
          return { ok: false, kind: 'error', message: `Anthropic returned ${res.status}: ${detail}` };
        }

        const response = (await res.json()) as AnthropicMessageResponse;
        return { ok: true, response };
      } catch (err) {
        if (controller.signal.aborted) {
          return { ok: false, kind: 'timeout', message: `Anthropic call exceeded ${timeoutMs}ms` };
        }
        return {
          ok: false,
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * The whole dependency bundle, built from the edge runtime's env. Throws (loudly, before any work)
 * if a secret is missing — a missing `ANTHROPIC_API_KEY` must be a 500 at the door, never a silent
 * degradation.
 */
export function createAnalyzeFormDeps(): AnalyzeFormDeps {
  const url = Deno.env.get('SUPABASE_URL');
  if (!url) {
    throw new Error('SUPABASE_URL is not set in the edge function environment');
  }
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set in the edge function environment');
  }

  const client: SupabaseClient = createClient(url, getSecretKey(), {
    auth: { persistSession: false },
  });

  // `rpc()` on supabase-js returns a thenable `PostgrestFilterBuilder`, not a structural `Promise`
  // (no `catch`/`finally`/`Symbol.toStringTag`), which `deno check` correctly rejects against
  // `RpcClient`'s declared return type. An `async` wrapper always returns a real Promise — same
  // call, same awaited result. (Identical to `ai-guard-client.ts`'s own note.)
  const rpc: RpcClient = {
    rpc: async (fn, args) => await client.rpc(fn, args),
  };

  const consents: ConsentReader = {
    /**
     * `select granted from public.consents where user_id = <jwt uid> and consent_key = $key order
     * by created_at desc limit 1` — the exact query issue #68 and Known Issue #14 specify. The
     * table is APPEND-ONLY: a withdrawal is a NEW row with `granted = false`, never a mutation, so
     * "newest row wins" is the only correct read and a `limit 1` without the `order by` would be a
     * silent bug that passes tests.
     *
     * Throws on a query error rather than returning `null`, because `flow.ts`'s `checkConsent()`
     * must be able to tell "no answer" from "we could not ask" — and refuses on both anyway. This
     * shape just makes the refusal on a DB error deliberate rather than accidental.
     */
    async latestGrant(userId, consentKey) {
      const { data, error } = await client
        .from('consents')
        .select('granted')
        .eq('user_id', userId)
        .eq('consent_key', consentKey)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error(`consent lookup failed: ${error.message}`);
      }
      if (!data) {
        return null;
      }
      return Boolean((data as { granted: boolean }).granted);
    },
  };

  const storage: FrameStorage = {
    /**
     * Service-role upload into the private `media` bucket. The client holds no INSERT on
     * `storage.objects` at all (#88 dropped the policy), so this is the only way a frame ever
     * lands — and it only ever runs AFTER `reserve_analysis` minted the row and the model call
     * succeeded, so a rejected or failed analysis leaves nothing behind.
     *
     * `upsert: true` makes a retried settle idempotent rather than a 409: the path is derived
     * deterministically from `{user_id}/{analysis_id}/frame-{NN}`, so re-uploading the same frame
     * for the same analysis is the same object, not a second one.
     */
    async upload(path, bytes, contentType) {
      const { error } = await client.storage.from(MEDIA_BUCKET).upload(path, bytes, {
        contentType,
        upsert: true,
      });
      return { error: error ? error.message : null };
    },

    /**
     * `list`/`remove` exist for ONE caller: `flow.ts`'s `safeAttachFrames`, which purges the prefix
     * it just wrote when `attach_media_paths` refuses with `row_deleted`/`not_found` — the user
     * deleted the analysis while its frames were still uploading, and `deleteAnalysis` purges
     * Storage BEFORE it marks the row, so our in-flight frames landed under a prefix whose purge
     * has already run (#130).
     *
     * Byte-for-byte the mapping `delete-account-client.ts` already uses against this same bucket,
     * so `purgePrefix` — which recurses, paginates, and verifies the prefix is empty afterwards —
     * is reused verbatim rather than reimplemented a third time.
     */
    async list(prefix, { limit, offset }) {
      const { data, error } = await client.storage.from(MEDIA_BUCKET).list(prefix, {
        limit,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) {
        throw new Error(`Failed to list storage prefix "${prefix}": ${error.message}`);
      }
      // Supabase Storage represents a pseudo-directory as an entry with `id: null` — the exact
      // signal `delete-analysis.ts`'s `purgePrefix` recursion depends on to avoid the nested-prefix
      // trap. Getting this mapping wrong is how a purge reports success while deleting nothing.
      return (data ?? []).map((entry) => ({ name: entry.name, isFolder: entry.id === null }));
    },

    async remove(paths) {
      const { error } = await client.storage.from(MEDIA_BUCKET).remove(paths);
      return { error: error ? error.message : null };
    },
  };

  return {
    rpc,
    allUsersUnlimitedAccess: isAllUsersUnlimitedAccess(
      Deno.env.get('ALL_USERS_UNLIMITED_ACCESS')
    ),
    consents,
    storage,
    model: createModelCaller(apiKey),
    log: (event) => {
      // One structured line per request — model/tier/tokens/latency/retried/fell-back. Routed
      // through `_shared/log.ts`'s `logEvent()` (issue #85) rather than a bare `console.log`: the
      // event's `userId` already arrived pre-hashed from `flow.ts` (`hashUserId()`), and
      // `redact()` runs over every field here too, as a second line of defense if this event's
      // shape ever grows a field that shouldn't be logged. Severity is derived from the HTTP
      // status actually returned, so a 5xx surfaces as `console.error` in Supabase's log explorer
      // without every caller having to compute that themselves.
      logEvent({ ...event, level: levelForStatus(event.status), fn: 'analyze-form' });
    },
  };
}

/** 5xx is server-fault and must be visibly loud; 4xx is an ordinary refusal (bad input, quota,
 * consent) and is worth keeping but not alarming on; 2xx is the happy path. */
function levelForStatus(status: number): LogLevel {
  if (status >= 500) {
    return 'error';
  }
  if (status >= 400) {
    return 'warn';
  }
  return 'info';
}
