/**
 * The shared edge-function invocation wrapper (issue #46). Every `lib/*.ts` client that calls an
 * edge function should call `invokeFunction()` here instead of `supabase.functions.invoke()`
 * directly.
 *
 * THE PROBLEM THIS SOLVES: every edge function in this app returns a non-2xx response body
 * structured `{ error, code }` (`docs/architecture.md`'s "Error contract": "every non-2xx
 * response body is structured `{ error, code }`" — see e.g. `supabase/functions/delete-account
 * /index.ts`, `.../analysis/index.ts`, `.../quota-status/index.ts`, `.../purchase-tier/index.ts`,
 * `.../analyze-form/index.ts`, all of whose `jsonResponse(status, { error, code })` calls share
 * this exact shape). But `supabase.functions.invoke()` does not hand that body back directly — a
 * non-2xx response is thrown as a generic `FunctionsHttpError` whose body is only reachable via
 * `await error.context.json()` (verified against the installed `@supabase/functions-js`'s
 * `FunctionsClient.invoke`: `if (!response.ok) { throw new FunctionsHttpError(response); }`, with
 * `response` becoming `error.context`). Without one shared place that does that unwrap, every
 * caller has to know it — and a caller that forgets shows the user "Something went wrong" instead
 * of the specific, actionable `code` the server sent, e.g. `reserve_analysis`'s `quota_exceeded`,
 * which issue #52's paywall is supposed to key off of.
 *
 * THE OTHER FAILURE MODES. `supabase.functions.invoke()` can also throw `FunctionsRelayError`
 * (the Supabase relay could not reach the function) or `FunctionsFetchError` (the request never
 * got a response at all — offline, DNS failure, timeout) — verified against the same source:
 * `response = await this.fetch(...).catch((fetchError) => { throw new
 * FunctionsFetchError(fetchError) })`, and a relay check (`x-relay-error` header) right after.
 * NEITHER carries a server-authored body — there is no `{ error, code }` to read, because no
 * server response (or no relayed one) was ever produced. `invokeFunction()` reports these as
 * `kind: 'network'`, distinct from a genuine HTTP error with a body, so a caller never fabricates
 * a `code` for a failure the server never got the chance to describe.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO: validate `code` against any one endpoint's known set
 * of codes. Each endpoint has its own — `delete-account`'s three (`purge_failed` / `rows_failed` /
 * `auth_delete_failed`) share nothing with `analyze-form`'s (`quota_exceeded`,
 * `too_many_failed_attempts`, `frame_cap_exceeded`, `validation_failed`, …) or `purchase-tier`'s
 * (`rate_limited`, `not_found`, `invalid_tier`, …). `code` on the `'http'` branch below is exactly
 * the string the server sent, typed only as `string`; narrowing it into a specific union — and
 * folding an unrecognized code into an honest "unknown" bucket rather than trusting it blindly —
 * is each call site's own job. See `lib/delete-account.ts`'s `isServerDeleteAccountErrorCode` for
 * the established pattern this wrapper is designed to slot under.
 */
import { FunctionsHttpError, type FunctionInvokeOptions } from '@supabase/supabase-js';

import { supabase } from './supabase';

/**
 * `'http'`      — the function ran and returned a non-2xx response whose body parsed as the
 *                 documented `{ error, code }` shape (both fields present and `string`-typed).
 *                 `code` is exactly what the server sent — see this file's header for why it is
 *                 not narrowed any further here.
 * `'network'`   — `FunctionsRelayError`, `FunctionsFetchError`, or anything else
 *                 `supabase.functions.invoke()` resolves/throws that isn't a `FunctionsHttpError`
 *                 — no server response was ever produced (or relayed) to read a body from.
 * `'malformed'` — a `FunctionsHttpError` WAS thrown (a response was received), but its body
 *                 either wasn't valid JSON or didn't match the documented `{ error, code }` shape
 *                 — e.g. a 404 HTML page from a route that isn't deployed yet
 *                 (`lib/delete-account.ts`'s header describes exactly this case). Kept distinct
 *                 from `'network'` because a response DID arrive, and distinct from `'http'`
 *                 because there is no `code` to read from it.
 */
export type InvokeFunctionError =
  | { kind: 'http'; error: string; code: string }
  | { kind: 'network' }
  | { kind: 'malformed' };

export type InvokeFunctionResult<T> = { ok: true; data: T } | { ok: false; error: InvokeFunctionError };

/** Narrow, defensive parse of a non-2xx JSON body — never trusts the shape blindly. */
function parseHttpErrorBody(body: unknown): { error: string; code: string } | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (typeof record.error !== 'string' || typeof record.code !== 'string') return null;
  return { error: record.error, code: record.code };
}

/**
 * Calls `supabase.functions.invoke(name, options)` and unwraps its result into the discriminated
 * shape above. NEVER REJECTS — every failure `supabase.functions.invoke()` can produce (a
 * returned `error`, or an unexpected synchronous throw) resolves into `{ ok: false, error }`
 * instead, so callers do not need a try/catch around this call.
 */
export async function invokeFunction<T = unknown>(
  name: string,
  options?: FunctionInvokeOptions
): Promise<InvokeFunctionResult<T>> {
  try {
    const { data, error } = await supabase.functions.invoke(name, options);

    if (!error) {
      return { ok: true, data: data as T };
    }

    if (error instanceof FunctionsHttpError) {
      try {
        const body = parseHttpErrorBody(await (error.context as Response).json());
        if (body) {
          return { ok: false, error: { kind: 'http', ...body } };
        }
      } catch {
        // The body wasn't valid JSON at all — falls through to 'malformed' below.
      }
      return { ok: false, error: { kind: 'malformed' } };
    }

    // FunctionsRelayError, FunctionsFetchError, or anything else — no body to read.
    return { ok: false, error: { kind: 'network' } };
  } catch {
    // A synchronous throw from invoke() itself — not observed in the installed
    // @supabase/functions-js (its whole body is wrapped in try/catch — see `FunctionsClient.js`),
    // kept as a last-resort backstop, same reasoning `lib/delete-account.ts` documents for its own
    // equivalent catch.
    return { ok: false, error: { kind: 'network' } };
  }
}
