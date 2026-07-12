/**
 * The `delete-account` client seam (issue #53) — the request/response types matching
 * `docs/architecture.md`'s "Planned — API" row for `POST /functions/v1/delete-account`, the
 * injectable `DeleteAccountClient` `app/settings.tsx` calls through, a dev-only mock, and the
 * binding the screen actually uses.
 *
 * `delete-account` (issue #58) DOES NOT EXIST YET. Nothing in this file calls Supabase, an edge
 * function, or any network endpoint — `deleteAccountClient` below is bound to the mock so the
 * Settings screen's delete flow is runnable and reviewable today. #58 drops its real
 * implementation in by replacing that one binding at the bottom of this file; every type above it
 * is the seam and should not need to change. This mirrors `lib/analyze-form.ts` (issue #80), which
 * established this pattern against the then-unbuilt `analyze-form`.
 *
 * WHY A SEAM AND NOT A DIRECT `supabase.functions.invoke` CALL: the screen must be able to render
 * and be reviewed — including its confirm, pending, and failure states — before the function it
 * calls exists. Binding to a mock keeps the screen honest (it really does await a client and
 * really does branch on the result) without pretending the backend is there.
 *
 * ⚠️ THE CLIENT IS NOT THE AUTHORITY. This module sends an intent; the edge function performs the
 * purge (storage objects → rows → auth user, in that strict order — see #58). Nothing here may
 * ever delete a row, an object, or a user itself, and a `{ ok: true }` here means the SERVER said
 * it purged, never that this file decided it did.
 */

/**
 * The documented 200 response (`docs/architecture.md` "Planned — API"): `{ deleted: true }`.
 *
 * Typed as the literal `true`, not `boolean`, on purpose: there is no such thing as a successful
 * `delete-account` response that reports `deleted: false`. A server that wanted to say "I did not
 * delete" would have to use the error branch, which is exactly what `DeleteAccountError` is for.
 */
export interface DeleteAccountSuccess {
  deleted: true;
}

/**
 * Every non-2xx `delete-account` response body (`docs/architecture.md` "Error contract": "every
 * non-2xx response body is structured `{ error, code }`"). Same shape as `AnalyzeFormError` in
 * `lib/analyze-form.ts` — the contract is app-wide, not per-function.
 *
 * `code` matters here more than it does for most calls: #58's purge is ordered storage → rows →
 * auth user precisely so a partial failure NEVER leaves the auth user deleted while their frames
 * survive un-ownable. A failure code therefore means "nothing was destroyed that we can't still
 * reach" — which is why the screen's failure copy can honestly tell the user their account is
 * still there.
 */
export interface DeleteAccountError {
  error: string;
  code: string;
}

export type DeleteAccountResult =
  | { ok: true; data: DeleteAccountSuccess }
  | { ok: false; error: DeleteAccountError };

/**
 * The seam #58 drops its real implementation into. A conforming implementation:
 *  - resolves `{ ok: true, data: { deleted: true } }` only for a 200 — i.e. only once the server
 *    has actually completed the storage → rows → auth-user purge;
 *  - resolves — never rejects — `{ ok: false, error }` for any DOCUMENTED non-2xx response (a
 *    `503 purge_failed`, a `403`, etc.);
 *  - MAY reject (throw) only for a genuinely unexpected failure: no connectivity, or an exception
 *    thrown before any response was received.
 *
 * `app/settings.tsx` folds a rejection into the same failure copy as a documented error, because
 * the user-facing truth is identical in both cases: the account was NOT deleted, and it is safe to
 * try again. It takes no arguments — the function authenticates and identifies the user from the
 * JWT alone (`docs/architecture.md`: "JWT | —"). A client that named the user to delete would be a
 * vulnerability, not a convenience.
 */
export interface DeleteAccountClient {
  submit(): Promise<DeleteAccountResult>;
}

// -------------------------------------------------------------------------------------------
// Dev mock — stands in for #58 so the Settings delete flow is runnable and reviewable today.
// Every branch the screen renders (success, a documented failure, and an unexpected throw) is
// reachable by constructing a differently-configured mock. Nothing here deletes anything, calls
// Supabase, or touches an edge function.
// -------------------------------------------------------------------------------------------

export type MockDeleteAccountOutcome = 'deleted' | 'failed' | 'thrown';

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

export function createMockDeleteAccountClient(
  options: MockDeleteAccountClientOptions = {}
): DeleteAccountClient {
  const delayMs = options.delayMs ?? 1200;
  const outcome = options.outcome ?? 'deleted';

  return {
    async submit(): Promise<DeleteAccountResult> {
      await wait(delayMs);

      switch (outcome) {
        case 'deleted':
          return { ok: true, data: { deleted: true } };
        case 'failed':
          return {
            ok: false,
            error: {
              error: 'The account could not be deleted.',
              code: 'purge_failed',
            },
          };
        case 'thrown':
          throw new Error('Mock delete-account failure (simulated network/unexpected error).');
      }
    },
  };
}

/**
 * The seam's current binding. #58 swaps this line for the real implementation once
 * `supabase/functions/delete-account` exists and is deployed; nothing else in this file, and
 * nothing in `app/settings.tsx`, needs to change to pick it up.
 *
 * ⚠️ Until that swap lands, tapping "Delete account and data" DOES NOT DELETE ANYTHING. The
 * screen is wired end-to-end and the confirmation is real, but the purge is mocked — see
 * `docs/status.md`. Do not ship a build to a real user with this binding still pointing at the
 * mock: it would tell them their account was deleted when it was not, which is precisely the
 * class of lie App Store Guideline 5.1.1(v) exists to prevent.
 */
export const deleteAccountClient: DeleteAccountClient = createMockDeleteAccountClient();
