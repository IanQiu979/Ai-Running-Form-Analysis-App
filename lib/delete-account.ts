/**
 * The `delete-account` client (issue #53, made real 2026-07-13 per a security-audit finding — see
 * below) — request/response types matching the documented `POST /functions/v1/delete-account`
 * contract, the injectable `DeleteAccountClient` `app/settings.tsx` calls through, a real
 * `supabase.functions.invoke` implementation, a dev/test-only mock, and the binding the screen
 * actually uses.
 *
 * ⚠️ HISTORY, because it matters for what to trust here: this file originally shipped bound to the
 * mock, on the theory that #58 (the edge function) would "drop its real implementation in by
 * replacing that one binding." A security audit on PR #122 (F1) caught that this handoff had no
 * owner — #58/#121's file list is entirely under `supabase/functions/`; it never touches this
 * file — so the swap this file promised would never happen, the mock would ship to production
 * bound as the real client, and "Delete account and data" would tell a user their account, every
 * analysis, and every stored frame were gone while none of it was. This file now implements the
 * real client directly, against the contract below. The mock is TEST-ONLY, and is made impossible
 * to bind in a release build — see `createMockDeleteAccountClient`'s `__DEV__` guard.
 *
 * ⚠️ THE CONTRACT BELOW MAY STILL DRIFT. `supabase/functions/_shared/delete-account.ts` (PR #121,
 * branch `feat/58-delete-account`) is the real source of truth and was mid-flight in a parallel
 * worktree when this was written; it does not exist on `main` yet, and this file — bound by the
 * hard constraint "do NOT edit anything under `supabase/functions/`" — cannot import its types.
 * `DeleteAccountErrorCode` below is therefore a HAND-MAINTAINED MIRROR of
 * `DeleteAccountResult['outcome']` from that file, not an import of it. Once #121/#58 merges,
 * whoever does it should replace this mirror with `import type { DeleteAccountErrorCode } from
 * '@shared/delete-account'` (the same `@shared/*` alias `@shared/pace` already uses) and delete
 * this warning once the codes are confirmed to match — see the type's own doc comment for the
 * exact table this was built against.
 *
 * ⚠️ THE FUNCTION IS NOT DEPLOYED. This client calls a real endpoint, but until #121 merges AND is
 * deployed to the live Supabase project (neither of which is this PR's job — "do not deploy
 * anything, do not touch the live Supabase project"), that endpoint does not exist. Calling it
 * today gets a 404, which `submitToEdgeFunction` below folds into the same honest, retryable
 * `{ ok: false, error: { code: 'unknown' } }` every other unrecognized failure gets — never a false
 * success. See `docs/status.md` for the up-to-date status of #121.
 *
 * WHY A SEAM, STILL, EVEN THOUGH THE REAL IMPLEMENTATION IS NOW HERE: `DeleteAccountClient` stays
 * an interface with an injectable mock so the screen's confirm/pending/success/failure states stay
 * reviewable and unit-testable without a live function to call — same reasoning `lib/analyze-form.ts`
 * (#80) used, now proven out end-to-end rather than left as a promise.
 *
 * ⚠️ THE CLIENT IS NOT THE AUTHORITY. This module sends a request; the edge function performs the
 * purge (storage objects → rows → auth user, in that strict order — see #58). Nothing here may
 * ever delete a row, an object, or a user itself, and an `{ ok: true }` here means the SERVER said
 * it purged, never that this file decided it did.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from './supabase';

const EDGE_FUNCTION_NAME = 'delete-account';

/**
 * Every retryable failure `code` #58's `delete-account` can send on a non-2xx response, per the
 * contract settled 2026-07-13 (server side still mid-flight in PR #121 — see this file's header):
 *
 * | Outcome            | Status | Body                                                         |
 * |--------------------|--------|--------------------------------------------------------------|
 * | Full success       | 200    | `{ deleted: true, purgedObjectCount, consentEventsPurged }`  |
 * | `orphans_remaining`| 200    | `{ deleted: true, orphansRemaining: true, … }`                |
 * | `purge_failed`     | 503    | `{ error, code: 'purge_failed' }`                             |
 * | `rows_failed`      | 503    | `{ error, code: 'rows_failed' }`                              |
 * | `auth_delete_failed`| 503   | `{ error, code: 'auth_delete_failed' }`                       |
 *
 * The two 200 outcomes are BOTH successes on this client — see `DeleteAccountSuccessOutcome` — so
 * they are deliberately NOT part of this error-code union. `orphans_remaining` is not a failure:
 * the account is fully, irreversibly deleted in that case (see `parseSuccessBody` below).
 *
 * `'unknown'` is NOT one of the server's codes — it is this client's own bucket for a failure the
 * contract above doesn't name at all: a relay/network error, a 401 (expired session), a 404 (the
 * function isn't deployed yet — see this file's header), or a 200/503 body that doesn't parse as
 * documented. Collapsing those into one of the THREE SERVER codes above would misreport what the
 * server actually said (or didn't); a fourth, honestly-unknown code keeps that distinction instead
 * of pretending to know more than the response told us.
 */
export type DeleteAccountErrorCode = 'purge_failed' | 'rows_failed' | 'auth_delete_failed' | 'unknown';

function isServerDeleteAccountErrorCode(
  value: unknown
): value is Exclude<DeleteAccountErrorCode, 'unknown'> {
  return value === 'purge_failed' || value === 'rows_failed' || value === 'auth_delete_failed';
}

/**
 * `'deleted'` — the ordinary case: storage, rows, and the auth user are all gone.
 * `'orphansRemaining'` — the account is JUST AS GONE (irreversibly — there is no account left to
 * retry deleting), but the post-delete sweep found objects it could not clear, almost always a
 * concurrent upload landing mid-delete. `app/settings.tsx` must treat both as success — sign the
 * user out either way — and must show `'orphansRemaining'` its own honest, retry-free copy rather
 * than folding it into the plain-success silence.
 */
export type DeleteAccountSuccessOutcome = 'deleted' | 'orphansRemaining';

export interface DeleteAccountSuccess {
  outcome: DeleteAccountSuccessOutcome;
}

/**
 * Every non-2xx `delete-account` response body (the app-wide error contract: every non-2xx body
 * is structured `{ error, code }`). `error` is carried on the type but deliberately NOT what
 * `app/settings.tsx` renders — this codebase's established convention (`app/analyzing.tsx` never
 * surfaces `AnalyzeFormError.error` verbatim either) is to map a `code` through vetted, static
 * in-app copy rather than putting an un-reviewed server string directly in front of a user.
 */
export interface DeleteAccountError {
  error: string;
  code: DeleteAccountErrorCode;
}

export type DeleteAccountResult =
  | { ok: true; data: DeleteAccountSuccess }
  | { ok: false; error: DeleteAccountError };

/**
 * A conforming implementation:
 *  - resolves `{ ok: true, data: { outcome: 'deleted' | 'orphansRemaining' } }` only for a 200 —
 *    i.e. only once the server has actually completed the storage → rows → auth-user purge;
 *  - resolves — never rejects — `{ ok: false, error }` for any documented non-2xx response;
 *  - MAY reject (throw) only for a genuinely unexpected failure the implementation cannot itself
 *    fold into the above (in practice, `submitToEdgeFunction` below folds essentially everything
 *    `supabase.functions.invoke` can produce into a resolved result — see its own comments — so a
 *    real throw from it should be rare; the mock's `'thrown'` outcome exists to prove the screen
 *    still handles one if it happens).
 *
 * `app/settings.tsx` folds a rejection into the same failure copy as a documented error, because
 * the user-facing truth is identical in both cases: the account was NOT confirmed deleted, and it
 * is safe to try again. It takes no arguments — the function authenticates and identifies the user
 * from the JWT alone. A client that named the user to delete would be a vulnerability, not a
 * convenience.
 */
export interface DeleteAccountClient {
  submit(): Promise<DeleteAccountResult>;
}

// -------------------------------------------------------------------------------------------
// Real implementation.
// -------------------------------------------------------------------------------------------

/** Defensive, narrow parse of a 200 body — never trusts the shape blindly. A 200 that doesn't
 *  parse as documented is NOT treated as a success (see the caller): claiming deletion on a shape
 *  we don't recognize would be exactly the false claim of erasure F1 exists to prevent. */
function parseSuccessBody(body: unknown): DeleteAccountSuccess | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (record.deleted !== true) return null;
  return { outcome: record.orphansRemaining === true ? 'orphansRemaining' : 'deleted' };
}

/** Defensive, narrow parse of a non-2xx JSON body. */
function parseErrorBody(body: unknown): { error: string; code: unknown } | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (typeof record.error !== 'string') return null;
  return { error: record.error, code: record.code };
}

const GENERIC_UNKNOWN_ERROR: DeleteAccountError = {
  error: 'The account could not be deleted.',
  code: 'unknown',
};

/**
 * Calls the real `delete-account` edge function. `supabase.functions.invoke` resolves — it does
 * NOT reject — for both a success and an HTTP-error response (verified against the installed
 * `@supabase/functions-js`'s `FunctionsClient.invoke`, whose whole body is wrapped in a try/catch
 * that returns `{ data: null, error }` rather than letting anything escape as a rejection); a
 * `catch` around the call below exists only as a last-resort backstop for something even that
 * implementation doesn't anticipate, matching this file's own `DeleteAccountClient` contract
 * ("MAY reject only for a genuinely unexpected failure").
 */
async function submitToEdgeFunction(): Promise<DeleteAccountResult> {
  try {
    const { data, error } = await supabase.functions.invoke(EDGE_FUNCTION_NAME, { method: 'POST' });

    if (!error) {
      const success = parseSuccessBody(data);
      if (success) {
        return { ok: true, data: success };
      }
      // A 200 whose body we don't recognize is not a success we can act on.
      return { ok: false, error: GENERIC_UNKNOWN_ERROR };
    }

    // `FunctionsHttpError` is the ONLY branch with a real, documented `{ error, code }` body to
    // read — a `FunctionsRelayError` (Supabase's relay couldn't reach the function) or a
    // `FunctionsFetchError` (the request never got a response at all) carry no such body, and
    // both collapse into the same generic, honestly-unknown failure below.
    if (error instanceof FunctionsHttpError) {
      try {
        const body = parseErrorBody(await (error.context as Response).json());
        if (body && isServerDeleteAccountErrorCode(body.code)) {
          return { ok: false, error: { error: body.error, code: body.code } };
        }
      } catch {
        // The error response wasn't valid JSON (or had none) — e.g. the function doesn't exist
        // yet (a 404, plain text) because #58/#121 isn't deployed. Fall through.
      }
    }

    return { ok: false, error: GENERIC_UNKNOWN_ERROR };
  } catch {
    return { ok: false, error: GENERIC_UNKNOWN_ERROR };
  }
}

/** The real client. Bound below as `deleteAccountClient` — the binding a production build ships. */
export function createDeleteAccountClient(): DeleteAccountClient {
  return { submit: submitToEdgeFunction };
}

// -------------------------------------------------------------------------------------------
// Dev/test-only mock. Every branch the screen renders — plain success, the orphans-remaining
// success, each of the three server failure codes, an unrecognized/unknown failure, and an
// unexpected throw — is reachable by constructing a differently-configured mock. Nothing here
// calls Supabase or touches a network.
// -------------------------------------------------------------------------------------------

export type MockDeleteAccountOutcome =
  | 'deleted'
  | 'orphansRemaining'
  | 'purgeFailed'
  | 'rowsFailed'
  | 'authDeleteFailed'
  | 'unknownFailure'
  | 'thrown';

export interface MockDeleteAccountClientOptions {
  /** ms before resolving. Defaults to a beat long enough that the screen's pending state (a
   * disabled row + spinner) is actually visible in a manual review rather than flashing past —
   * a real purge walks a user's whole storage prefix and is not instant. */
  delayMs?: number;
  outcome?: MockDeleteAccountOutcome;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ⚠️ F1's tripwire. This mock existing at all is what let the ORIGINAL version of this file ship
 * bound to it with no owner for the swap to a real client — see this file's header. `__DEV__` is
 * `true` under Metro's dev server and under Jest (`react-native/jest/setup.js` sets it explicitly,
 * which is what keeps this suite's own tests able to construct the mock at all) and `false` in any
 * release/production JS bundle, so this throws at the first call to `submit()` in exactly the
 * build where silently lying about account deletion would matter — belt-and-suspenders alongside
 * `deleteAccountClient` below now being bound to the real client, not this one.
 */
export function createMockDeleteAccountClient(
  options: MockDeleteAccountClientOptions = {}
): DeleteAccountClient {
  const delayMs = options.delayMs ?? 1200;
  const outcome = options.outcome ?? 'deleted';

  return {
    async submit(): Promise<DeleteAccountResult> {
      if (!__DEV__) {
        throw new Error(
          'createMockDeleteAccountClient() must never run outside a dev/test build. ' +
            'deleteAccountClient must be bound to createDeleteAccountClient() in production.'
        );
      }

      await wait(delayMs);

      switch (outcome) {
        case 'deleted':
          return { ok: true, data: { outcome: 'deleted' } };
        case 'orphansRemaining':
          return { ok: true, data: { outcome: 'orphansRemaining' } };
        case 'purgeFailed':
          return {
            ok: false,
            error: { error: 'Could not remove your stored frames.', code: 'purge_failed' },
          };
        case 'rowsFailed':
          return {
            ok: false,
            error: { error: 'Your stored frames were removed but your account could not be deleted.', code: 'rows_failed' },
          };
        case 'authDeleteFailed':
          return {
            ok: false,
            error: { error: 'Your data was deleted but your sign-in could not be removed.', code: 'auth_delete_failed' },
          };
        case 'unknownFailure':
          return { ok: false, error: GENERIC_UNKNOWN_ERROR };
        case 'thrown':
          throw new Error('Mock delete-account failure (simulated network/unexpected error).');
      }
    },
  };
}

/**
 * The seam's binding. THIS IS NOW THE REAL CLIENT — fixed 2026-07-13 (F1): tapping "Delete account
 * and data" calls the actual `delete-account` edge function via `supabase.functions.invoke`.
 *
 * See this file's header for the two caveats that still apply: the exact response contract may
 * still drift until #121/#58 actually merges, and the function is not deployed yet, so calling
 * this in the live app today safely fails (never a false success) rather than succeeding.
 */
export const deleteAccountClient: DeleteAccountClient = createDeleteAccountClient();
