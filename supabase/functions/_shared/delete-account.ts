/**
 * The purge-and-delete core for `POST /functions/v1/delete-account` (issue #58) — in-app account
 * deletion. This is an **App Store submission blocker** (Guideline 5.1.1(v): an app with account
 * creation must offer in-app account deletion) and the hard gate on publishing
 * `docs/privacy-policy.md` at all (`docs/status.md` Known Issue #15: "the policy promises it, and
 * publication is gated on it being real").
 *
 * Same split as `delete-analysis.ts`, for the same reason: no `npm:`/Deno-only import lives here,
 * so this orchestration logic is fully unit-testable with injected fakes (see
 * `__tests__/delete-account.deno.test.ts`). The real Deno/`npm:@supabase/supabase-js` wiring is in
 * `delete-account-client.ts`, imported only by `supabase/functions/delete-account/index.ts`.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ORDER: storage objects → rows → auth user. THE ORDER IS THE DESIGN.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * It is the reverse of what feels natural, and inverting it is unrecoverable. Delete the auth user
 * first and the cascade (`profiles.id references auth.users(id) on delete cascade` →
 * `analyses.user_id references profiles(id) on delete cascade`) takes every row with it. Storage
 * is not in that graph: `storage.objects` has NO foreign key to `auth.users`, so every frame —
 * images of a person's body — survives, under a `{user_id}/` prefix whose owner no longer exists.
 * Un-enumerable from the rows (they're gone), un-ownable (no user), and nothing else in the system
 * will ever clean them up. Permanently orphaned, on the one code path whose entire purpose is to
 * leave nothing behind. Echo V1's `delete-user/` exists precisely because of this (Ruling 6).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * PURGE BY PREFIX, NEVER BY `media_paths` — and NEVER by walking `analyses` rows.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * The purge target is the single prefix `{userId}/`, built from the JWT-verified caller id alone.
 * It is never derived from a row. That is what makes this sweep strictly stronger than anything
 * row-driven, and it closes three orphan sources at once, without special-casing any of them:
 *   1. Rows whose `media_paths` is empty because `analyze-form` crashed between the frame upload
 *      and its `settle_analysis` call (the write-side bug #88 already fixed — the read side must
 *      not reintroduce it).
 *   2. Rows already **soft-deleted** through issue #2's client-facing `deleted_at` UPDATE policy,
 *      whose frames were never purged and whose `media_paths` the redact trigger has since
 *      blanked — `docs/status.md` Known Issue #19, which a row-driven sweep would silently miss
 *      and this one cannot.
 *   3. Objects under a prefix with no row at all, from any cause we have not thought of. A prefix
 *      sweep does not need to know why an object is there to delete it.
 * A `{userId}/` prefix is also the tightest possible blast radius: the caller can only ever purge
 * their own namespace, so no id in any request can reach another user's objects.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE NESTED-PREFIX TRAP — reused, not re-implemented.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Objects live at `{user_id}/{analysis_id}/frame-NN.jpg`. A flat `storage.list(userId)` returns the
 * `{analysis_id}` **pseudo-directories**, not files — passing those names to `remove()` deletes
 * NOTHING while reporting success, and orphans every frame. `docs/privacy-checklist-m7.md` names
 * this as the specific way a naive port of V1's `delete-user` fails. It is not re-solved here:
 * this module calls `purgePrefix()` from `delete-analysis.ts` (#57), which already recurses,
 * paginates, and — critically — **re-lists the prefix after removing and refuses to return unless
 * it comes back empty**. One implementation, two callers, one place it can ever be wrong.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * BLOCKING PURGE, not best-effort cleanup, and not orphan reconciliation. Deliberate.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * If the Storage purge fails, we STOP. No rows are deleted, the auth user is NOT deleted, and the
 * caller gets a real error (503, safe to retry) instead of a false "deleted". Echo V1's
 * best-effort pattern could delete the auth user while a failed `remove()` left frames un-ownable;
 * that failure mode is unreachable here by construction, not by care.
 *
 * Why blocking and not a reconciliation job: reconciliation needs a durable record of what still
 * needs cleaning, plus a scheduled worker, plus alerting on its own silent failure — three moving
 * parts, and it would be the ONLY thing standing between a failed purge and permanently un-ownable
 * body images. Blocking needs none of that, because the retry key is the user id, and the user id
 * still exists precisely BECAUSE we refused to delete the account. Every step below is idempotent,
 * so a retry converges rather than double-deleting: re-listing an already-empty prefix finds
 * nothing, deleting already-deleted rows affects zero rows, and deleting an already-deleted auth
 * user is treated as success. The failure is safe, the retry is free, and there is no window in
 * which the account is gone but the frames are not.
 *
 * The one thing blocking alone does NOT cover is a **concurrent** `analyze-form` call that uploads
 * frames after our purge but before the auth user is gone (its `reserve_analysis` row would have
 * been created before our row delete, so the upload lands under an already-swept prefix). That is
 * a real race, not a theoretical one, so a second sweep runs AFTER the auth user is deleted and
 * reports `orphans_remaining` if it cannot clear what reappeared.
 *
 * `orphans_remaining` IS A SUCCESS RESPONSE (`200`, `deleted: true`), NOT AN ERROR — fixed after
 * security/code review on PR #121 flagged the original `500` + mixed `{ deleted, error }` body as
 * both a contract violation (`docs/architecture.md` promises every non-2xx body is a clean
 * `{ error, code }`; the original body was neither shape) and unconsumable by a correct client: by
 * this point the storage purge, every row, AND the `auth.users` record are ALL already gone — the
 * account is irreversibly deleted. A client that sees a non-2xx and reports "still active, please
 * retry" would be lying on every clause (the account is not active, retrying cannot help, and the
 * user is holding an access token for a row that no longer exists). What failed is a cleanup step
 * with NO user-facing remedy, so the ops response belongs on the server — the error-level log two
 * lines below, naming the exact prefix, is what a human acts on. The client's job is just to sign
 * the user out and say the account is gone (see `httpStatusForAccountOutcome`/
 * `accountResponseBodyForOutcome` below for the corrected shape).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE CONSENT TRAIL: purge — explicitly, in code, NOT by inheriting the FK cascade.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * `consents.user_id references profiles(id) on delete cascade`, so deleting the account would
 * erase the Art. 9 consent record as a side effect nobody chose. `20260712020729_consents.sql`'s
 * own comment refuses to let that stand as the answer: "Whoever builds #57/#58 must make a
 * conscious purge-vs-retain-for-defence choice for this table specifically, not inherit this FK's
 * cascade by default."
 *
 * The choice made here is **purge**, and it is enforced by an explicit `rows.deleteConsents()`
 * step (see below) that would delete those rows even if the FK were changed tomorrow. Reasoning:
 *
 *   • GDPR Art. 17(3)(e) permits retaining data for the establishment/exercise/defence of legal
 *     claims — but it permits retaining what is NECESSARY for that defence. A retained consent row
 *     is keyed on `user_id` and nothing else. Deleting the account destroys every mapping we hold
 *     from a person to that UUID (email, identity, profile — all cascade out of `auth.users`). So
 *     if a former user later complains "you processed my health data without consent," we could not
 *     tell which archived UUID was theirs. The record would prove nothing about the claimant. It is
 *     not necessary for the defence, because it cannot BE used for the defence — so Art. 17(3)(e)
 *     does not reach it, and retaining it is just retention.
 *   • Making it usable would mean keeping a re-identifiable token of the person (their email, or a
 *     keyed hash of it) specifically so we can find them again after they asked to be forgotten.
 *     That is a materially more invasive retention than the one it defends against.
 *   • What actually answers a "no valid consent" complaint is systemic, and it survives: the
 *     `<ConsentGate />` component, `lib/consent.ts`, the append-only `public.consents` schema, and
 *     their tests all demonstrate that no upload is reachable without an affirmative, unbundled
 *     tick (Art. 7(1) is a duty to demonstrate consent, and a demonstrated *process* is what a
 *     regulator can be shown). And to an erasure complaint specifically, "we hold nothing about
 *     you" is the complete answer — one that a retained consent archive would actively undermine.
 *   • `docs/privacy-policy.md` says, today, "Deleting your account removes everything." Purging
 *     keeps that sentence literally true, and the policy is the thing this issue unblocks.
 *
 * REVISIT THIS IF: EU/UK users are admitted (the TestFlight beta currently excludes them — see
 * `docs/status.md` Known Issue #15), or the user base grows enough for a claim to be plausible. The
 * decision then is not "flip the FK" but "retain a bounded, keyed-hash consent archive with a
 * documented retention window and a privacy-policy disclosure" — a real design, not a default.
 * Because the purge is an explicit named step here, that change has exactly one place to happen.
 *
 * NOT purged, deliberately, and NOT this module's decision to make: `public.ai_call_log` is already
 * `on delete set null` on both FKs (`20260712210000_ai_spend_guardrails.sql`) — the spend ledger
 * survives, stripped of the two columns that could identify anyone. A farm cannot delete its own
 * cost evidence by deleting its account, and no personal data survives. That contract is settled;
 * this function relies on it and must not defeat it.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * AUTHORIZATION
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * `userId` is ALWAYS the id from a verified JWT (`auth.getUser()` in `index.ts` — a real round trip
 * to Supabase Auth, not a local decode), never a field from the request body. This function deletes
 * an account irreversibly; a caller-supplied id would make that a one-request account-deletion
 * weapon against any user whose UUID an attacker could guess or observe. There is no id parameter
 * on this endpoint at all — the only account anyone can delete is their own.
 */

import { DEFAULT_PAGE_SIZE, purgePrefix, type StorageBucket } from './delete-analysis.ts';

/**
 * The row-level surface `deleteAccount()` needs, service-role only (RLS is bypassed; `authenticated`
 * holds no DELETE grant on any of these tables, which is why this cannot be a client operation).
 * Each method must be a safe no-op when there is nothing to do — that is what makes a retry after a
 * partial failure converge instead of erroring.
 */
export interface AccountRows {
  /**
   * Hard-deletes every `public.consents` row for this user. THE CONSENT-TRAIL DECISION, made
   * explicit — see this file's header. The FK cascade from `profiles` would also remove these, but
   * relying on that would mean the most consequential privacy choice in this function is invisible
   * in its code and untested. This step is called BEFORE `deleteProfile()`, so it is the step that
   * actually destroys them, and its test asserts exactly that.
   */
  deleteConsents(userId: string): Promise<{ deletedCount: number }>;
  /**
   * Hard-deletes the `public.profiles` row, which cascades to `subscriptions` and `analyses` (and
   * through `analyses`, nothing else — `ai_call_log` is `on delete set null`, by design). Returns
   * `{ deleted: false }` when no row existed: a retry after a partial failure, or an auth user who
   * never got a profile row, both land here and both are successes, not errors.
   */
  deleteProfile(userId: string): Promise<{ deleted: boolean }>;
}

/**
 * The Supabase Auth **admin** API — `auth.admin.deleteUser`, which requires the service-role key.
 * Nothing weaker can remove an `auth.users` row, which is why this function must run server-side
 * with a secret key and can never be a client call.
 */
export interface AuthAdmin {
  /** Hard-deletes the `auth.users` row. Must resolve (not throw) if the user is already gone. */
  deleteUser(userId: string): Promise<void>;
}

/** Structured log sink — one event per boundary crossed. See `index.ts` for the production wiring. */
export type LogEvent = (event: Record<string, unknown>) => void;

/**
 * The three outcomes that are genuinely retryable failures — nothing (or not everything) was
 * destroyed, and a client can act on the code. Exported as its own union, not a bare `string`, so
 * `accountResponseBodyForOutcome`'s switch is exhaustive and a caller (this file, or the client
 * consuming the response) gets a compiler error on a missed case rather than a silently-ignored
 * code. `orphans_remaining` is deliberately NOT a member: it is not a failure a client can retry
 * its way out of (see `DeleteAccountResult` below), so it never appears in an `{ error, code }`
 * body — it appears in a success body instead.
 */
export type DeleteAccountErrorCode = 'purge_failed' | 'rows_failed' | 'auth_delete_failed';

export type DeleteAccountResult =
  | {
      outcome: 'deleted';
      /** Objects removed by the pre-delete sweep. Proves the purge ran; asserted by #59's tests. */
      purgedObjectCount: number;
      /** Consent events destroyed. The consent-trail decision, observable in the response. */
      consentEventsPurged: number;
      /** False when the auth user had no `profiles` row (a retry, or a half-provisioned account). */
      profileExisted: boolean;
    }
  /** Storage purge failed. NOTHING was deleted — no rows, no auth user. Retry converges. */
  | { outcome: 'purge_failed'; reason: string }
  /** Storage is clean but a row delete failed. The account still exists. Retry converges. */
  | { outcome: 'rows_failed'; reason: string; purgedObjectCount: number }
  /** Storage and rows are gone but `auth.users` survives. No personal data remains. Retry converges. */
  | { outcome: 'auth_delete_failed'; reason: string; purgedObjectCount: number }
  /**
   * The account is FULLY DELETED — storage, rows, and the `auth.users` record are all gone — but
   * the post-delete sweep found objects it could not remove, almost certainly a concurrent
   * `analyze-form` upload that landed mid-delete. This is a SUCCESS from the caller's standpoint
   * (nothing about it is retryable — there is no account left to authenticate a retry with) and is
   * mapped to `200`/`deleted: true` by `httpStatusForAccountOutcome`/`accountResponseBodyForOutcome`
   * below, never to an `{ error, code }` shape. It must still be alerted on, never swallowed — that
   * alerting is the error-level log this outcome triggers in `deleteAccount()`, not the HTTP
   * response, because there is no user-side remedy for it to drive. Carries `consentEventsPurged`
   * (rows were already deleted in step 2 by the time this outcome is reached) so the success body
   * is complete rather than a degraded one.
   */
  | { outcome: 'orphans_remaining'; reason: string; purgedObjectCount: number; consentEventsPurged: number };

export interface DeleteAccountParams {
  /** ALWAYS from a verified JWT. Never from the request body. See the header's AUTHORIZATION note. */
  userId: string;
  /** Test-only seam — production callers should never pass this. */
  pageSize?: number;
  /** Test-only seam — production callers should never pass this. See REMOVE_BATCH_SIZE. */
  removeBatchSize?: number;
  /** Optional structured log sink; defaults to a no-op so tests stay silent unless they opt in. */
  log?: LogEvent;
}

/**
 * Max paths handed to a single Storage `remove()` call.
 *
 * `purgePrefix()` collects every object under the prefix and removes them in ONE call. For
 * `delete-analysis` that is bounded by the per-analysis frame cap (~10 objects) and is fine. For an
 * ACCOUNT, the prefix spans every analysis the user ever ran: an Elite user two years in could sit
 * on thousands of objects, and a single `remove()` with thousands of paths in its request body is
 * exactly the call that starts failing on request size — at which point the blocking purge does its
 * job, refuses to delete anything, and the heaviest users become **permanently undeletable**. That
 * is the classic "runs fine for six months, then breaks with no code change" failure, and on this
 * code path it would breach App Store Guideline 5.1.1(v) for precisely the users least willing to
 * wait.
 *
 * So the work is bounded here rather than left to grow. `batchedRemove()` below wraps the injected
 * bucket so `purgePrefix` — unchanged, and still the only implementation of the recursion — issues
 * removes in fixed-size batches instead of one unbounded call.
 */
export const REMOVE_BATCH_SIZE = 500;

/**
 * Wraps a `StorageBucket` so `remove()` chunks its input into `batchSize`-sized calls. `list()` is
 * passed straight through (it is already paginated by `purgePrefix`).
 *
 * Stops at the first failing batch and reports its error: earlier batches have already been
 * removed, which is safe — the purge is idempotent, a retry re-lists and finishes the job, and
 * `purgePrefix`'s own post-remove verification will refuse to report success while anything
 * survives. Partial progress toward "no frames left" is never the dangerous direction; partial
 * progress toward "no account left" is, and that cannot happen here because a failed remove aborts
 * the whole delete before a single row is touched.
 */
export function batchedRemove(storage: StorageBucket, batchSize: number = REMOVE_BATCH_SIZE): StorageBucket {
  return {
    list: (prefix, options) => storage.list(prefix, options),
    async remove(paths) {
      for (let i = 0; i < paths.length; i += batchSize) {
        const { error } = await storage.remove(paths.slice(i, i + batchSize));
        if (error) {
          return { error };
        }
      }
      return { error: null };
    },
  };
}

export async function deleteAccount(
  rows: AccountRows,
  rawStorage: StorageBucket,
  auth: AuthAdmin,
  params: DeleteAccountParams
): Promise<DeleteAccountResult> {
  const { userId } = params;
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const log: LogEvent = params.log ?? (() => {});
  const prefix = `${userId}/`;
  const startedAt = Date.now();

  // Bound the removes here, not at the call site, so the bound holds no matter who calls this.
  const storage = batchedRemove(rawStorage, params.removeBatchSize ?? REMOVE_BATCH_SIZE);

  log({ event: 'delete_account.started', userId });

  // ── 1. STORAGE OBJECTS ───────────────────────────────────────────────────────────────────────
  // Blocking. A failure here ends the request with nothing deleted — see the header. `purgePrefix`
  // recurses into every `{analysis_id}/` sub-prefix, paginates each level, and re-lists afterwards
  // to prove the prefix is empty; it throws unless it is.
  let purgedObjectCount: number;
  try {
    purgedObjectCount = await purgePrefix(storage, prefix, pageSize);
  } catch (err) {
    const reason = errorMessage(err);
    log({ event: 'delete_account.purge_failed', userId, reason, durationMs: Date.now() - startedAt });
    return { outcome: 'purge_failed', reason };
  }
  log({ event: 'delete_account.storage_purged', userId, purgedObjectCount });

  // ── 2. ROWS ──────────────────────────────────────────────────────────────────────────────────
  // Consents first and explicitly (the consent-trail decision — header), then the profile, whose
  // cascade takes `subscriptions` and `analyses`. Rows go BEFORE the auth user, not because the
  // cascade would fail, but because doing it here keeps every deletion a decision this function
  // makes and a test can observe, rather than a side effect of an FK we did not write.
  let consentEventsPurged: number;
  let profileExisted: boolean;
  try {
    const consents = await rows.deleteConsents(userId);
    consentEventsPurged = consents.deletedCount;
    log({ event: 'delete_account.consents_purged', userId, consentEventsPurged });

    const profile = await rows.deleteProfile(userId);
    profileExisted = profile.deleted;
    log({ event: 'delete_account.rows_deleted', userId, profileExisted });
  } catch (err) {
    const reason = errorMessage(err);
    log({ event: 'delete_account.rows_failed', userId, reason, durationMs: Date.now() - startedAt });
    return { outcome: 'rows_failed', reason, purgedObjectCount };
  }

  // ── 3. AUTH USER ─────────────────────────────────────────────────────────────────────────────
  // Last. Once this succeeds the user id can never authenticate again, so anything that still
  // needed it had to happen above.
  try {
    await auth.deleteUser(userId);
  } catch (err) {
    const reason = errorMessage(err);
    log({ event: 'delete_account.auth_delete_failed', userId, reason, durationMs: Date.now() - startedAt });
    return { outcome: 'auth_delete_failed', reason, purgedObjectCount };
  }
  log({ event: 'delete_account.auth_user_deleted', userId });

  // ── 4. POST-DELETE SWEEP ─────────────────────────────────────────────────────────────────────
  // Closes the concurrency race the blocking purge cannot: an `analyze-form` call in flight during
  // steps 1-3 can upload frames into a prefix we already swept. Re-running the (idempotent) purge
  // costs one `list()` when nothing reappeared, which is the overwhelmingly common case.
  try {
    const sweptAfter = await purgePrefix(storage, prefix, pageSize);
    if (sweptAfter > 0) {
      log({ event: 'delete_account.post_delete_sweep_removed_objects', userId, sweptAfter, level: 'warn' });
    }
  } catch (err) {
    const reason = errorMessage(err);
    // The account is gone and cannot be restored, so this cannot be fixed by a retry from the
    // client — it needs a human. Loud, structured, error-level, and naming the exact prefix: this
    // log is the ONLY alarm for this outcome, since the HTTP response is (correctly) a 200 with no
    // retry affordance — see accountResponseBodyForOutcome's doc comment for why.
    log({ event: 'delete_account.orphans_remaining', userId, prefix, reason, level: 'error', durationMs: Date.now() - startedAt });
    return { outcome: 'orphans_remaining', reason, purgedObjectCount, consentEventsPurged };
  }

  log({
    event: 'delete_account.completed',
    userId,
    purgedObjectCount,
    consentEventsPurged,
    profileExisted,
    durationMs: Date.now() - startedAt,
  });
  return { outcome: 'deleted', purgedObjectCount, consentEventsPurged, profileExisted };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// HTTP mapping — pure, tested here rather than eyeballed in index.ts.
// ---------------------------------------------------------------------------

/**
 * Status/body matrix (settled centrally after PR #121 review, so this endpoint and the #122
 * client agent build to the identical contract without diverging):
 *
 * | Outcome             | Status | Body                                                            |
 * |----------------------|--------|-----------------------------------------------------------------|
 * | `deleted`            | 200    | `{ deleted: true, purgedObjectCount, consentEventsPurged }`      |
 * | `orphans_remaining`  | 200    | `{ deleted: true, orphansRemaining: true, purgedObjectCount, consentEventsPurged }` |
 * | `purge_failed`       | 503    | `{ error, code: 'purge_failed' }`                                |
 * | `rows_failed`        | 503    | `{ error, code: 'rows_failed' }`                                 |
 * | `auth_delete_failed` | 503    | `{ error, code: 'auth_delete_failed' }`                          |
 *
 * INVARIANT, enforced by construction (and by a test): NO response body ever carries both
 * `deleted` and `error`/`code`. A body has exactly one shape or the other — the success shape
 * (optionally with `orphansRemaining: true` bolted on) or the `{ error, code }` shape. The
 * original implementation violated this for `orphans_remaining` (a `500` with both `deleted: true`
 * and `error`/`code` present) and that shape is not just off-contract, it's unconsumable: a client
 * has to choose one branch, and whichever it picks, the other half of the body was pointless.
 */
export function httpStatusForAccountOutcome(outcome: DeleteAccountResult['outcome']): number {
  switch (outcome) {
    // Both `deleted` and `orphans_remaining` are 200: from the caller's standpoint the account is
    // gone in both cases, and that is the only fact an HTTP status can usefully carry here. See
    // `DeleteAccountResult`'s `orphans_remaining` doc comment for why it is not an error status —
    // by the time it is reached, storage, rows, AND the auth user are already fully deleted, so a
    // non-2xx would tell the client to retry an operation that (a) already succeeded and (b) can
    // only ever 401 on retry, since the account no longer exists to authenticate as.
    case 'deleted':
    case 'orphans_remaining':
      return 200;
    // Nothing was destroyed that a retry cannot redo, and none of these are the caller's fault —
    // 503 signals "our side, safe to retry", the same idiom `delete-analysis.ts` and `ai-guard.ts`
    // already use rather than blaming the client with a 4xx for a server-side failure.
    case 'purge_failed':
    case 'rows_failed':
    case 'auth_delete_failed':
      return 503;
  }
}

/**
 * Maps every outcome to exactly one of the two body shapes in the matrix above — never both. The
 * error-message text lives here (not spread across the three failure branches) partly for
 * locality, but mainly to make it visually obvious at a glance that no failure branch spells
 * `deleted`, and the one branch that does (`orphans_remaining`) never spells `error`/`code`.
 */
export function accountResponseBodyForOutcome(result: DeleteAccountResult): Record<string, unknown> {
  switch (result.outcome) {
    case 'deleted':
      return {
        deleted: true,
        purgedObjectCount: result.purgedObjectCount,
        consentEventsPurged: result.consentEventsPurged,
      };
    case 'orphans_remaining':
      // Success shape, not the error shape — see the matrix and DeleteAccountResult's doc comment.
      // The account really is gone; `orphansRemaining: true` is a client hint (e.g. "some stored
      // media may take longer to purge") with no retry affordance attached, because there is
      // nothing left for the client to retry. The actionable response — the exact `{user_id}/`
      // prefix a human must go clean — lives only in the error-level log `deleteAccount()` emits;
      // it is deliberately NOT this body's job to carry ops detail to an end user.
      return {
        deleted: true,
        orphansRemaining: true,
        purgedObjectCount: result.purgedObjectCount,
        consentEventsPurged: result.consentEventsPurged,
      };
    case 'purge_failed':
      return errorBody('purge_failed', 'Could not remove your stored frames, so nothing was deleted. Your account is unchanged — please try again.');
    case 'rows_failed':
      return errorBody('rows_failed', 'Your stored frames were removed but your account could not be deleted. Please try again.');
    case 'auth_delete_failed':
      return errorBody('auth_delete_failed', 'Your data was deleted but your sign-in could not be removed. Please try again.');
  }
}

/** Builds the `{ error, code }` shape — and only that shape — for the three retryable failures. */
function errorBody(code: DeleteAccountErrorCode, error: string): Record<string, unknown> {
  return { error, code };
}
