/**
 * The `delete-account` client (issue #53, made real 2026-07-13 per a security-audit finding — see
 * below) — request/response types matching the documented `POST /functions/v1/delete-account`
 * contract, the injectable `DeleteAccountClient` `app/settings.tsx` calls through, a real
 * `supabase.functions.invoke` implementation, a dev/test-only mock, and the binding the screen
 * actually uses.
 *
 * `submitToEdgeFunction` below calls through issue #46's shared `lib/functions-client.ts`
 * (`invokeFunction`) rather than `supabase.functions.invoke` directly — that file now owns the
 * `FunctionsHttpError`/`FunctionsRelayError`/`FunctionsFetchError` unwrap this file used to do
 * inline; see its header for why. This file is left owning only what's specific to THIS endpoint:
 * the 200 success shape, and narrowing the wrapper's generic `code: string` to the three codes
 * `delete-account` actually emits.
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
 * `DeleteAccountErrorCode` below is a HAND-MAINTAINED MIRROR of
 * `supabase/functions/_shared/delete-account.ts`'s `DeleteAccountErrorCode` (plus this client's own
 * `reauth_required`/`unknown` additions), not an import of it — this file cannot import across the
 * `supabase/functions/` boundary. #121/#58 merged and deployed 2026-07-26; the codes are confirmed
 * to match as of this writing. If a future change to the server's outcome union isn't mirrored here,
 * an unrecognized `code` on the `'http'` branch still folds safely into `GENERIC_UNKNOWN_ERROR`
 * rather than crashing — see `isServerDeleteAccountErrorCode` below — so drift degrades gracefully,
 * it does not break silently as a false success.
 *
 * `delete-account` (#58/#121) is deployed to the live project as of 2026-07-26, verified live end
 * to end on a throwaway account (`docs/architecture.md`'s "Current — `POST /functions/v1/delete-account`"
 * section; `docs/status.md` Known Issue #35). See `docs/status.md` for current status.
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
 *
 * ⚠️ ISSUE #124: the server can now ALSO reject a structurally valid, unexpired request with
 * `code: 'reauth_required'` — a valid JWT is no longer sufficient authorization for this one
 * endpoint (see `supabase/functions/_shared/delete-account.ts`'s "REAUTHENTICATION FRESHNESS"
 * section for why: a stolen access token is still a valid token, and this is the single most
 * destructive, least reversible action the product has). The reauthentication helpers below —
 * `getReauthProvider`, `reauthenticateWithPassword`, `reauthenticateWithGoogle` — are what
 * `app/settings.tsx` calls to satisfy that gate: re-present the SAME kind of credential the
 * session was originally established with, which mints a fresh session the server will accept,
 * then retry `submit()` once. This is a SERVER-ENFORCED gate, not a client-side nicety — these
 * helpers exist only to let the client cooperate with a check the edge function runs regardless of
 * whether the client calls them at all.
 */
import type { Session } from '@supabase/supabase-js';

import { signInWithGoogle } from './auth';
import { mapAuthError } from './auth-errors';
import { invokeFunction } from './functions-client';
import { supabase } from './supabase';

const EDGE_FUNCTION_NAME = 'delete-account';

/**
 * Every retryable failure `code` #58's `delete-account` can send on a non-2xx response, per the
 * contract settled 2026-07-13 (server side still mid-flight in PR #121 — see this file's header),
 * plus `reauth_required` added by issue #124:
 *
 * | Outcome            | Status | Body                                                         |
 * |--------------------|--------|--------------------------------------------------------------|
 * | Full success       | 200    | `{ deleted: true, purgedObjectCount, consentEventsPurged }`  |
 * | `orphans_remaining`| 200    | `{ deleted: true, orphansRemaining: true, … }`                |
 * | `purge_failed`     | 503    | `{ error, code: 'purge_failed' }`                             |
 * | `rows_failed`      | 503    | `{ error, code: 'rows_failed' }`                              |
 * | `auth_delete_failed`| 503   | `{ error, code: 'auth_delete_failed' }`                       |
 * | `reauth_required`  | 401    | `{ error, code: 'reauth_required' }`                          |
 *
 * The two 200 outcomes are BOTH successes on this client — see `DeleteAccountSuccessOutcome` — so
 * they are deliberately NOT part of this error-code union. `orphans_remaining` is not a failure:
 * the account is fully, irreversibly deleted in that case (see `parseSuccessBody` below).
 *
 * `reauth_required` is unlike the other three: it is NOT retryable by simply calling `submit()`
 * again unchanged — the server refused before touching anything because the session's most recent
 * proof of a real credential (password or OAuth, via the JWT's `amr` claim) is too old. It is
 * retryable only after the caller satisfies that — see `reauthenticateWithPassword`/
 * `reauthenticateWithGoogle` below, which `app/settings.tsx` calls before retrying `submit()`.
 *
 * `'unknown'` is NOT one of the server's codes — it is this client's own bucket for a failure the
 * contract above doesn't name at all: a relay/network error, a 401 with no recognized code, a
 * gateway error page rather than this endpoint's JSON, or a 200/503 body that doesn't parse
 * as documented. Collapsing those into one of the FOUR SERVER codes above would misreport what the
 * server actually said (or didn't); a fifth, honestly-unknown code keeps that distinction instead
 * of pretending to know more than the response told us.
 */
export type DeleteAccountErrorCode =
  | 'purge_failed'
  | 'rows_failed'
  | 'auth_delete_failed'
  | 'reauth_required'
  | 'unknown';

function isServerDeleteAccountErrorCode(
  value: unknown
): value is Exclude<DeleteAccountErrorCode, 'unknown'> {
  return (
    value === 'purge_failed' ||
    value === 'rows_failed' ||
    value === 'auth_delete_failed' ||
    value === 'reauth_required'
  );
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

const GENERIC_UNKNOWN_ERROR: DeleteAccountError = {
  error: 'The account could not be deleted.',
  code: 'unknown',
};

/**
 * Calls the real `delete-account` edge function through issue #46's shared `invokeFunction`
 * wrapper, which already does the `supabase.functions.invoke` unwrap (a `FunctionsHttpError`'s
 * body is only reachable via `await error.context.json()` — see `lib/functions-client.ts`'s
 * header) and NEVER REJECTS. The only thing left for this file to do is what's specific to THIS
 * endpoint: parse the 200 success shape, and narrow `invokeFunction`'s generic `code: string` down
 * to the three codes `delete-account` actually emits via `isServerDeleteAccountErrorCode` —
 * `invokeFunction` deliberately does not know any one endpoint's code set (see its header).
 */
async function submitToEdgeFunction(): Promise<DeleteAccountResult> {
  const result = await invokeFunction(EDGE_FUNCTION_NAME, { method: 'POST' });

  if (result.ok) {
    const success = parseSuccessBody(result.data);
    if (success) {
      return { ok: true, data: success };
    }
    // A 200 whose body we don't recognize is not a success we can act on.
    return { ok: false, error: GENERIC_UNKNOWN_ERROR };
  }

  // `kind: 'http'` is the only branch with a real, server-authored `code` to read — `'network'`
  // (a relay/fetch failure) and `'malformed'` (a non-2xx response whose body wasn't the documented
  // shape, e.g. a gateway error page rather than this endpoint's JSON) both carry
  // no such code, and collapse into the same generic, honestly-unknown
  // failure below — as does an HTTP code this endpoint doesn't recognize as one of its own.
  if (result.error.kind === 'http' && isServerDeleteAccountErrorCode(result.error.code)) {
    return { ok: false, error: { error: result.error.error, code: result.error.code } };
  }

  return { ok: false, error: GENERIC_UNKNOWN_ERROR };
}

/** The real client. Bound below as `deleteAccountClient` — the binding a production build ships. */
export function createDeleteAccountClient(): DeleteAccountClient {
  return { submit: submitToEdgeFunction };
}

// -------------------------------------------------------------------------------------------
// Step-up reauthentication (issue #124). See this file's header for why these exist at all: the
// server can reject an otherwise-valid `submit()` call with `code: 'reauth_required'`, and these
// are what `app/settings.tsx` calls to satisfy that before retrying. Neither function touches
// `delete-account` itself — they only refresh the LOCAL session, which `submit()`'s own
// `supabase.functions.invoke()` call reads fresh at call time, so a retry automatically carries
// whatever the most recent successful reauthentication produced with no manual token wiring.
// -------------------------------------------------------------------------------------------

/**
 * Which credential to ask the user to re-present, read off the CURRENT session's provider.
 * `'unknown'` is the safe default for a provider this screen has no reauthentication flow for —
 * there is only one today, Google — so the caller can show an honest "can't confirm it's you,
 * sign out and back in" message instead of silently doing nothing or guessing at a flow.
 */
export type ReauthProvider = 'password' | 'google' | 'unknown';

export function getReauthProvider(session: Session | null): ReauthProvider {
  const provider = session?.user.app_metadata?.provider;
  if (provider === 'email') return 'password';
  if (provider === 'google') return 'google';
  return 'unknown';
}

export interface ReauthResult {
  ok: boolean;
  /** Set only when `ok` is false AND there is something to show the user (a wrong password, a
   *  real failure). Absent — not just empty — when the user themselves cancelled; see `cancelled`. */
  error?: string;
  /** True only for a user-initiated cancel (closed the OAuth browser sheet). Never set alongside `error` — a cancel is not a failure to report. */
  cancelled?: boolean;
}

/**
 * Re-presents a password credential for the CURRENTLY signed-in user. Mirrors
 * `app/(auth)/sign-in.tsx`'s own `signInWithPassword` call exactly and reuses the same
 * `mapAuthError` (`lib/auth-errors.ts`), so a wrong password reads identically here as it does at
 * sign-in — no second, drifted copy of "invalid credentials" to keep in sync.
 */
export async function reauthenticateWithPassword(email: string, password: string): Promise<ReauthResult> {
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: mapAuthError(err) };
  }
}

/**
 * Re-runs the SAME Google OAuth flow used at sign-in (`lib/auth.ts`'s `signInWithGoogle` —
 * imported and called directly, never duplicated, so this stays exactly as correct as the
 * already-audited sign-in path, including its PKCE/redirect handling). `null` from
 * `signInWithGoogle` means the user dismissed the browser sheet — reported as `cancelled`, not an
 * error, matching how `app/(auth)/sign-in.tsx` treats the same return value.
 */
export async function reauthenticateWithGoogle(): Promise<ReauthResult> {
  try {
    const session = await signInWithGoogle();
    if (session === null) {
      return { ok: false, cancelled: true };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: mapAuthError(err) };
  }
}

// -------------------------------------------------------------------------------------------
// Dev/test-only mock. Every branch the screen renders — plain success, the orphans-remaining
// success, each of the four server failure codes, an unrecognized/unknown failure, and an
// unexpected throw — is reachable by constructing a differently-configured mock. Nothing here
// calls Supabase or touches a network.
// -------------------------------------------------------------------------------------------

export type MockDeleteAccountOutcome =
  | 'deleted'
  | 'orphansRemaining'
  | 'purgeFailed'
  | 'rowsFailed'
  | 'authDeleteFailed'
  | 'reauthRequired'
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
        case 'reauthRequired':
          return {
            ok: false,
            error: {
              error: 'Please confirm this is really you before deleting your account.',
              code: 'reauth_required',
            },
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
 * The seam's binding. THIS IS THE REAL CLIENT — fixed 2026-07-13 (F1): tapping "Delete account
 * and data" calls the actual `delete-account` edge function via `supabase.functions.invoke`, and
 * that function has been deployed to the live project since 2026-07-26 — see this file's header.
 */
export const deleteAccountClient: DeleteAccountClient = createDeleteAccountClient();
