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
 * THE HEAVY-ACCOUNT SWEEP: BOUNDED CONCURRENCY OVER ANALYSIS PREFIXES — issue #125.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * `purgePrefix()` above is UNMODIFIED and stays the only implementation of the recursive,
 * paginated, verified per-prefix purge — the "one place it can ever be wrong" property just above
 * is not touched by any of this. What changes here is who calls it, and how many calls are allowed
 * to be in flight at once, for an ACCOUNT prefix specifically.
 *
 * The original account sweep handed the whole `{userId}/` prefix to a single `purgePrefix()` call,
 * whose internal recursion (`collectFiles()` in `delete-analysis.ts`) walks every `{analysis_id}/`
 * sub-prefix ONE AT A TIME, sequentially `await`ing each `list()` before starting the next. That is
 * fine for `delete-analysis.ts`'s own callers (one analysis, capped at 8 frames, one sub-prefix)
 * but an ACCOUNT spans every analysis the user has ever run: a long-lived Elite account (30
 * analyses/period, per `purchase-tier.ts`) accumulates hundreds of sub-prefixes over a couple of
 * years. Hundreds of sequential network round trips in one edge-function invocation is exactly the
 * "runs fine for months, then times out permanently with no code change" cliff #125 exists to
 * remove — and because the purge is deliberately BLOCKING (see below), a sweep that times out
 * deletes NOTHING. The account is not partially deleted, it is not deleted, and the users who trip
 * this are precisely the ones with the most data — i.e. the ones with the strongest claim to
 * erasure. `purgeAccountPrefix()` below fixes this without touching `delete-analysis.ts`:
 *
 *   1. Lists the account root itself — one paginated level, the one bit of walking duplicated here
 *      rather than reused, because `delete-analysis.ts`'s recursion has no seam to inject
 *      concurrency into and is out of scope for this fix (nine other agents share that file's
 *      surface) — to discover the sibling `{analysis_id}/` sub-prefixes.
 *   2. Purges each sub-prefix with the unchanged `purgePrefix()` (still doing its own recursion,
 *      removal, and post-remove verification), dispatched through `mapWithConcurrency()` at a
 *      bounded fan-out (`ACCOUNT_PURGE_CONCURRENCY` — see its own comment for the number and why).
 *      Round-trip COUNT is not reduced — Storage's `list()` is a hierarchical, one-level-at-a-time
 *      API, not a flat recursive walk, so there is no single call that replaces N per-prefix
 *      listings. What changes is how many of those round trips are in flight simultaneously, which
 *      is what actually determines wall-clock time: network latency, not bandwidth, is the
 *      bottleneck for a sweep this shape, so overlapping requests cuts elapsed time by roughly the
 *      concurrency factor even though the total call count is unchanged.
 *   3. A soft wall-clock budget (`ACCOUNT_PURGE_DEADLINE_MS`) is checked before every new sub-prefix
 *      purge is dispatched. Once it is spent, no NEW purge starts — in-flight ones are allowed to
 *      finish, since their `remove()` calls already went out and are real, not something to race
 *      against — and the whole sweep fails closed with the SAME `purge_failed` outcome any other
 *      purge failure produces (a real 503, retryable; no new outcome, no drift in the contract
 *      `lib/delete-account.ts` — out of scope for this fix — already hand-mirrors). The platform's
 *      own kill is not something this function can catch or respond to at all; a soft deadline means
 *      the caller gets a structured, logged, retryable answer instead of a bare connection drop.
 *
 * CHECKPOINTING IS FREE, NOT BUILT. Each sub-prefix purge is independently list → remove → verify.
 * When one succeeds, its objects are REALLY gone from Storage — durably, with no bookkeeping of our
 * own — before the next one even starts. A retry after a timeout re-lists the account root and
 * finds FEWER sub-prefixes, because an emptied `{analysis_id}/` no longer exists as a
 * pseudo-directory at all once nothing lives under it — so the retry does strictly less work than
 * the attempt before it, for free. The retry key is still the user id (unchanged — see
 * AUTHORIZATION below), and Storage itself is the checkpoint: no new table, no new column, no new
 * failure mode of its own to keep consistent with the purge. This is the cheapest fix that removes
 * the cliff, chosen over a persisted checkpoint row because the property a checkpoint would buy — a
 * retry does less work than the attempt before it — already falls out of purging sub-prefixes
 * independently rather than collecting the whole account before removing anything.
 *
 *  * ═══════════════════════════════════════════════════════════════════════════════════════════════
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
 *
 * A valid JWT is necessary but, as of issue #124, no longer SUFFICIENT — see the "REAUTHENTICATION
 * FRESHNESS" section below, and `index.ts`, for the second gate that now runs before this function
 * is ever called.
 */

import { DEFAULT_PAGE_SIZE, purgePrefix, type StorageBucket } from './delete-analysis.ts';

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// REAUTHENTICATION FRESHNESS — issue #124.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AUTHORIZATION (above) establishes WHO is calling — a verified JWT, always. This section adds a
// second, independent gate: HOW RECENTLY that identity was actually proven with a real credential
// (password or OAuth), not just "is the access token currently valid." Those are different
// questions. A stolen or leaked access token is still a VALID token — `auth.getUser()` verifies it
// happily — right up until it expires, and `autoRefreshToken: true` (lib/supabase.ts) means a
// device that silently refreshes in the background keeps producing valid tokens indefinitely
// without the user ever re-entering a credential. For most endpoints in this app that's exactly
// the mobile-auth UX you want. It is NOT fine for the one endpoint whose entire job is
// irreversible, unrecoverable destruction of an account and every stored frame in it (see this
// file's own header). That is the gap issue #124 closes.
//
// THE MECHANISM: Supabase Auth's `amr` (Authentication Methods Reference) JWT claim — an array of
// `{ method, timestamp }` entries, one per authentication EVENT (not per token). Confirmed against
// Supabase's own docs (`guides/auth/auth-mfa`'s FAQ, "How do I check when a user went through
// MFA?"), which recommends exactly this pattern verbatim: "you can mandate that access will only
// be granted... to users who have recently signed in with a password," read off the most recent
// `amr` entry's timestamp. Crucially, this is NOT the same signal as the JWT's own `iat`
// (issued-at): `iat` advances on every silent token refresh (a new access token is minted, with a
// new `iat`, every time `autoRefreshToken` fires) even though the user did nothing — so an
// `iat`-based check would be exactly the kind of control this issue explicitly warns against, one
// that "looks like a control, protects against nothing," since a stolen persisted session can
// trivially keep producing tokens with a recent `iat` just by refreshing. `amr` timestamps do not
// move on a refresh; they only move when the user actually re-presents a credential.
//
// DEFENSIVE BELT-AND-SUSPENDERS: Supabase's JWT field reference separately lists `token_refresh`
// as a POSSIBLE `amr.method` value (distinct from the MFA guide's authoritative "currently
// recognized" list, which does not include it), and this project's own live Supabase project had
// no populated `auth.mfa_amr_claims` rows to settle, empirically, whether an ordinary silent
// refresh ever appends one. Rather than depend on that being resolved correctly forever,
// `token_refresh` entries are explicitly EXCLUDED when computing "how long ago did the user last
// prove who they are" below (`NON_ASSURANCE_AMR_METHODS`) — so even if a future GoTrue version
// starts stamping refreshes into `amr`, this check cannot be silently defeated by one.
//
// DECODE, NEVER VERIFY, HERE. `decodeJwtPayload` below reads the claims out of the token string
// WITHOUT checking its signature — that is safe, and only safe, because every caller of
// `isReauthFresh` is required to call it on the exact same token string `index.ts` already
// verified via a real round trip to Supabase Auth (`auth.getUser()`, in `resolveCallerUserId`).
// This module never establishes trust in a token; it only reads claims out of one that's already
// trusted. Any malformed, empty, or missing `amr` fails CLOSED (`isReauthFresh` returns `false`,
// forcing reauthentication) — the same fail-closed default every other check in this file uses.
//
// WHAT COUNTS AS "RECENT": `REAUTH_FRESHNESS_WINDOW_SECONDS` below. 5 minutes — generous enough
// that a user who taps "Delete account," is asked to re-enter their password or redo Google
// sign-in, and does so without excessive fumbling should not see a second rejection, but tight
// enough that it means what "recent" has to mean for an irreversible action: a credential
// presented within the last few minutes, not "at some point during a session that could be weeks
// old."
//
// WHAT THIS IS NOT: not a `{ confirm: "DELETE" }` field, not a re-typed email, not a password
// echoed in the request body. All three protect against nothing here — an attacker holding a
// stolen token composes the request themselves and sends whatever field is asked for. This gate
// instead demands something an attacker holding only a token cannot produce: proof, from
// Supabase Auth itself, that the real credential was presented recently.
//
// WHERE THE GATE LIVES: `index.ts`, not `deleteAccount()` itself. It runs BEFORE `deleteAccount()`
// is ever called — a stale-session request never reaches the purge at all — and is reported as its
// own 401 (`code: 'reauth_required'`), parallel to the existing `unauthorized` 401s for a missing
// or invalid token. It is deliberately NOT folded into `DeleteAccountResult`/`DeleteAccountErrorCode`
// below: those describe outcomes of a purge that has already started; this is a precondition on
// starting one at all, exactly like the missing-Authorization-header and invalid-JWT checks that
// already precede it in `index.ts`.
export interface AmrEntry {
  method: string;
  timestamp: number;
}

/**
 * `amr.method` values that must NEVER count as evidence of a just-presented credential — see this
 * section's header. `token_refresh` is excluded defensively even though Supabase's authoritative
 * "currently recognized" list (the MFA guide FAQ) does not include it: if a future Supabase Auth
 * version ever does stamp a refresh into `amr`, this set is what keeps that from silently
 * reintroducing the exact "looks like a control, isn't one" bug issue #124 exists to close.
 */
const NON_ASSURANCE_AMR_METHODS = new Set(['token_refresh']);

/**
 * How recent a real credential presentation (password or OAuth, per `amr`) must be for
 * `POST /functions/v1/delete-account` to proceed. See this section's header for the reasoning.
 * Exported so `index.ts` need not hardcode it and a test can assert against the same constant.
 */
export const REAUTH_FRESHNESS_WINDOW_SECONDS = 5 * 60;

/**
 * Decodes (never verifies — see this section's header) the payload segment of a JWT. Returns
 * `null` for anything that doesn't parse as a three-segment JWT with a JSON-object payload —
 * callers must treat `null` as "no evidence of anything," which is what makes the overall check
 * fail closed rather than throw.
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const decoded = atob(padded);
    const parsed: unknown = JSON.parse(decoded);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Narrow, defensive parse of the `amr` claim — never trusts the shape blindly. Malformed entries
 *  are dropped rather than crashing the whole check. */
function parseAmrClaims(payload: Record<string, unknown> | null): AmrEntry[] {
  const raw = payload?.amr;
  if (!Array.isArray(raw)) return [];
  const entries: AmrEntry[] = [];
  for (const item of raw) {
    if (
      item !== null &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).method === 'string' &&
      typeof (item as Record<string, unknown>).timestamp === 'number'
    ) {
      entries.push({
        method: (item as { method: string }).method,
        timestamp: (item as { timestamp: number }).timestamp,
      });
    }
  }
  return entries;
}

/**
 * The most recent `amr` timestamp that counts as a real credential presentation — the max over
 * every entry EXCEPT `NON_ASSURANCE_AMR_METHODS` (defensive; see this section's header). `null`
 * when there is nothing usable at all: an undecodable token, no `amr` claim, or an `amr` whose
 * only entries are excluded methods. Exported for direct unit testing, independent of the
 * now()/window logic in `isReauthFresh` below.
 */
export function extractMostRecentAssuranceTimestamp(jwt: string): number | null {
  const entries = parseAmrClaims(decodeJwtPayload(jwt)).filter((e) => !NON_ASSURANCE_AMR_METHODS.has(e.method));
  if (entries.length === 0) return null;
  return Math.max(...entries.map((e) => e.timestamp));
}

/**
 * `true` only if `jwt` carries a real, non-excluded `amr` entry timestamped within
 * `windowSeconds` of `now()`. Fails CLOSED (`false`) for anything it cannot positively confirm is
 * recent — an undecodable token, a missing `amr`, or a most-recent timestamp older than the
 * window — so the caller's default, on any doubt, is to demand reauthentication rather than
 * assume it.
 */
export function isReauthFresh(
  jwt: string,
  now: () => number = Date.now,
  windowSeconds: number = REAUTH_FRESHNESS_WINDOW_SECONDS
): boolean {
  const mostRecent = extractMostRecentAssuranceTimestamp(jwt);
  if (mostRecent === null) return false;
  const ageSeconds = now() / 1000 - mostRecent;
  return ageSeconds <= windowSeconds;
}

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
  /**
   * Test-only seam — production callers should never pass this. Caps how many analysis-prefix
   * purges run at once during the account-level sweep. See ACCOUNT_PURGE_CONCURRENCY.
   */
  listConcurrency?: number;
  /**
   * Test-only seam — production callers should never pass this. Overrides the storage-purge
   * phase's soft wall-clock budget. See ACCOUNT_PURGE_DEADLINE_MS.
   */
  purgeDeadlineMs?: number;
  /**
   * Test-only seam — production callers should never pass this. Overrides the post-delete
   * sweep's soft wall-clock budget. See ACCOUNT_POST_DELETE_SWEEP_DEADLINE_MS.
   */
  postDeleteSweepDeadlineMs?: number;
  /**
   * Test-only seam — production callers should never pass this. Injects a fake clock so
   * budget-exceeded tests are deterministic instead of racing a real timer. Defaults to `Date.now`.
   */
  now?: () => number;
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

/**
 * Max analysis-prefix purges allowed in flight at once during the account-level sweep — issue
 * #125. Bounded on purpose: the issue is explicit that an unbounded `Promise.all` over every
 * sub-prefix would just trade one failure mode (a purge that times out) for another (a burst of
 * simultaneous requests large enough to trip Storage's own rate limiting, or exhaust the edge
 * function's outbound connection pool) — "do not fire unbounded parallelism at Storage."
 *
 * 8 is a modest, single-digit fan-out: enough to cut wall-clock time by close to an order of
 * magnitude for the realistic worst case this issue names (a multi-year Elite account with a few
 * hundred analyses — see the header's "THE HEAVY-ACCOUNT SWEEP" section for the arithmetic), while
 * keeping the number of simultaneous in-flight requests low enough that it reads as normal traffic
 * to Storage rather than a burst. It is a different axis from `REMOVE_BATCH_SIZE` (which bounds the
 * SIZE of one call's payload) — this bounds how many calls are outstanding at once — and the two are
 * deliberately independent constants, not derived from one another.
 */
export const ACCOUNT_PURGE_CONCURRENCY = 8;

/**
 * Soft wall-clock budget, in ms, for the STORAGE-PURGE PHASE (step 1) of an account delete —
 * issue #125. `analyze-form/flow.ts`'s `ANALYZE_FORM_REQUEST_DEADLINE_MS` (105s from request
 * entry; `ANALYZE_FORM_DEADLINE_MS` is the 85s model window inside it) is sized against a
 * documented external ceiling (the client's own polling timeout); this function has no equivalent
 * client-side constraint to size against, and this repo does not pin an exact number for the
 * Supabase edge runtime's own wall-clock limit. So this budget is deliberately conservative rather
 * than tuned to a known ceiling: 60s is enough, at `ACCOUNT_PURGE_CONCURRENCY`-way fan-out, to clear
 * several hundred analysis prefixes in one invocation (comfortably past the realistic worst case —
 * see the header), while leaving large headroom under any plausible platform limit for the fast,
 * bounded work that follows (row deletes, the auth-user delete, and the response itself). Revisit
 * once the actual platform ceiling for this project is confirmed.
 *
 * A spent budget does NOT fail differently from any other purge failure — see `purgeAccountPrefix`
 * below: it throws a plain `Error`, caught by the same `try/catch` in `deleteAccount()` that handles
 * a real Storage outage, producing the same `purge_failed` outcome (503, retryable, nothing
 * deleted). This is deliberate: adding a distinct outcome would mean a new member on
 * `DeleteAccountResult`/`DeleteAccountErrorCode`, which `lib/delete-account.ts` hand-mirrors and
 * this fix is barred from touching (see the header) — so it would silently fall back to that
 * client's generic `'unknown'` bucket instead of the specific, already-correct `purge_failed` copy.
 * Reusing the existing outcome keeps the response contract, and every existing caller of it, exactly
 * as it was.
 */
export const ACCOUNT_PURGE_DEADLINE_MS = 60_000;

/**
 * Soft wall-clock budget, in ms, for the POST-DELETE SWEEP (step 4) — issue #125. Deliberately
 * smaller than `ACCOUNT_PURGE_DEADLINE_MS`: by the time step 4 runs, every `{analysis_id}/`
 * sub-prefix step 1 emptied has already vanished from the account root's listing (Storage does not
 * keep an empty pseudo-directory around), so step 4's own top-level list only ever finds whatever
 * reappeared from a concurrent `analyze-form` upload racing the delete — normally zero, occasionally
 * a small handful, never "every analysis again." 20s is generous for that shape of work while still
 * failing closed quickly if Storage itself is unhealthy at exactly the wrong moment.
 */
export const ACCOUNT_POST_DELETE_SWEEP_DEADLINE_MS = 20_000;

/**
 * Runs `fn` over `items` with at most `limit` calls in flight at once — the primitive
 * `purgeAccountPrefix` uses to turn N sequential per-analysis `purgePrefix()` calls into N/`limit`
 * sequential ROUNDS instead. Neither of the two obvious alternatives is right here: one call at a
 * time is the bug this file exists to fix, and `Promise.all(items.map(fn))` fires every call at
 * once regardless of `items.length` — exactly the unbounded parallelism issue #125 warns against.
 *
 * Fails fast: once any call rejects, no NEW call is started (each worker stops pulling from the
 * shared cursor before its next item), but calls already in flight are allowed to run to
 * completion rather than abandoned — a Storage `remove()` that already went out is a real side
 * effect, not something to race against or pretend didn't happen. The FIRST rejection observed is
 * what this function throws once every worker has settled; nothing is left unawaited, so an
 * unhandled-rejection warning from a later, discarded failure is not possible.
 *
 * Generic and dependency-free on purpose — exported so its concurrency-bound and ordering
 * properties get their own direct unit tests, independent of the Storage-specific fakes the rest of
 * this file's tests use.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  if (items.length === 0) {
    return results;
  }

  let nextIndex = 0;
  let firstError: unknown;
  let hasError = false;

  async function worker(): Promise<void> {
    for (;;) {
      if (hasError) {
        return;
      }
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) {
        return;
      }
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        if (!hasError) {
          hasError = true;
          firstError = err;
        }
        return;
      }
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (hasError) {
    throw firstError;
  }
  return results;
}

/**
 * The account-level storage sweep — issue #125. See the header's "THE HEAVY-ACCOUNT SWEEP" section
 * for the full design; this is the implementation of the three-part fix described there: enumerate
 * the account root's own sub-prefixes, purge them through `purgePrefix()` (unchanged, imported from
 * `delete-analysis.ts`) at a bounded concurrency, and fail closed on a spent time budget rather than
 * risk being killed mid-sweep with no response at all.
 *
 * Any thrown error here — a real Storage failure, a verification failure (something survived the
 * purge), or a spent time budget — is indistinguishable to the caller: `deleteAccount()` catches it
 * exactly as it always did and returns `purge_failed`. Nothing beyond Storage is ever touched by
 * this function; rows and the auth user are the caller's job, strictly after this resolves.
 */
async function purgeAccountPrefix(
  storage: StorageBucket,
  userId: string,
  pageSize: number,
  concurrencyLimit: number,
  deadline: number,
  now: () => number
): Promise<number> {
  const prefix = `${userId}/`;

  // ── Enumerate the account root's own level ─────────────────────────────────────────────────
  // One paginated level, mirroring `collectFiles()`'s own top-level loop in `delete-analysis.ts`
  // (duplicated, not reused — see the header for why). Every folder entry is a sibling
  // `{analysis_id}/` prefix to purge independently; a bare file directly at the account root is
  // not expected by the real `{user_id}/{analysis_id}/frame.jpg` layout, but is still collected
  // and removed rather than silently ignored, so an unexpected object never survives a "successful"
  // delete.
  const subPrefixes: string[] = [];
  const topLevelFiles: string[] = [];
  let offset = 0;
  for (;;) {
    if (now() > deadline) {
      throw new Error(
        `Storage purge for "${prefix}" exceeded its time budget while still enumerating the account ` +
          `root — nothing was removed yet; retry to resume from the start.`
      );
    }
    const entries = await storage.list(prefix, { limit: pageSize, offset });
    for (const entry of entries) {
      if (entry.isFolder) {
        subPrefixes.push(`${prefix}${entry.name}/`);
      } else {
        topLevelFiles.push(`${prefix}${entry.name}`);
      }
    }
    if (entries.length < pageSize) {
      break;
    }
    offset += pageSize;
  }

  let purgedCount = 0;

  if (topLevelFiles.length > 0) {
    const { error } = await storage.remove(topLevelFiles);
    if (error) {
      throw new Error(`Failed to remove ${topLevelFiles.length} object(s) directly under "${prefix}": ${error}`);
    }
    purgedCount += topLevelFiles.length;
  }

  // ── Purge every sub-prefix, bounded-concurrently ───────────────────────────────────────────
  // Each `purgePrefix()` call is independently list → remove → verify (unchanged behavior). A
  // failure partway through — including a spent time budget, checked here before every new
  // dispatch — leaves whatever already succeeded durably removed and everything else untouched,
  // which is exactly the free checkpointing property the header describes: a retry re-enumerates
  // the account root and finds only what is left.
  let processedPrefixes = 0;
  await mapWithConcurrency(subPrefixes, concurrencyLimit, async (subPrefix) => {
    if (now() > deadline) {
      throw new Error(
        `Storage purge for "${prefix}" exceeded its time budget after removing ${purgedCount} ` +
          `object(s) across ${processedPrefixes}/${subPrefixes.length} analysis prefixes — the rest ` +
          `are UNCHANGED and durably intact (nothing partially deleted), and every prefix already ` +
          `cleared will not be re-listed on retry.`
      );
    }
    const count = await purgePrefix(storage, subPrefix, pageSize);
    purgedCount += count;
    processedPrefixes += 1;
    return count;
  });

  // ── Final verification across the whole account root ───────────────────────────────────────
  // Mirrors `purgePrefix()`'s own discipline: refuse to report success unless a fresh list of the
  // ENTIRE prefix (not just the sub-prefixes we knew about going in) comes back empty. This is what
  // catches a sub-prefix that reappeared from a concurrent upload after this function had already
  // listed it as done — the same race the caller's own step-4 post-delete sweep exists to close one
  // layer up.
  if (now() > deadline) {
    throw new Error(
      `Storage purge for "${prefix}" exceeded its time budget right after clearing all ` +
        `${subPrefixes.length} analysis prefixes (${purgedCount} object(s) removed) — retry to ` +
        `finish verification and continue.`
    );
  }
  const remaining = await storage.list(prefix, { limit: 1, offset: 0 });
  if (remaining.length > 0) {
    throw new Error(`Storage prefix "${prefix}" still has objects after purge — refusing to proceed.`);
  }

  return purgedCount;
}

export async function deleteAccount(
  rows: AccountRows,
  rawStorage: StorageBucket,
  auth: AuthAdmin,
  params: DeleteAccountParams
): Promise<DeleteAccountResult> {
  const { userId } = params;
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const listConcurrency = params.listConcurrency ?? ACCOUNT_PURGE_CONCURRENCY;
  const now = params.now ?? Date.now;
  const log: LogEvent = params.log ?? (() => {});
  const prefix = `${userId}/`;
  const startedAt = now();

  // Bound the removes here, not at the call site, so the bound holds no matter who calls this.
  const storage = batchedRemove(rawStorage, params.removeBatchSize ?? REMOVE_BATCH_SIZE);

  log({ event: 'delete_account.started', userId });

  // ── 1. STORAGE OBJECTS ───────────────────────────────────────────────────────────────────────
  // Blocking. A failure here ends the request with nothing deleted — see the header. `purgeAccountPrefix`
  // (issue #125) enumerates the account root, then purges every `{analysis_id}/` sub-prefix through
  // the unchanged, unmodified `purgePrefix()` at a bounded concurrency, and fails closed — the same
  // `purge_failed` outcome as any other Storage failure — if its soft wall-clock budget runs out
  // before every sub-prefix is cleared. See ACCOUNT_PURGE_CONCURRENCY/ACCOUNT_PURGE_DEADLINE_MS.
  let purgedObjectCount: number;
  try {
    purgedObjectCount = await purgeAccountPrefix(
      storage,
      userId,
      pageSize,
      listConcurrency,
      startedAt + (params.purgeDeadlineMs ?? ACCOUNT_PURGE_DEADLINE_MS),
      now
    );
  } catch (err) {
    const reason = errorMessage(err);
    log({ event: 'delete_account.purge_failed', userId, reason, durationMs: now() - startedAt });
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
    log({ event: 'delete_account.rows_failed', userId, reason, durationMs: now() - startedAt });
    return { outcome: 'rows_failed', reason, purgedObjectCount };
  }

  // ── 3. AUTH USER ─────────────────────────────────────────────────────────────────────────────
  // Last. Once this succeeds the user id can never authenticate again, so anything that still
  // needed it had to happen above.
  try {
    await auth.deleteUser(userId);
  } catch (err) {
    const reason = errorMessage(err);
    log({ event: 'delete_account.auth_delete_failed', userId, reason, durationMs: now() - startedAt });
    return { outcome: 'auth_delete_failed', reason, purgedObjectCount };
  }
  log({ event: 'delete_account.auth_user_deleted', userId });

  // ── 4. POST-DELETE SWEEP ─────────────────────────────────────────────────────────────────────
  // Closes the concurrency race the blocking purge cannot: an `analyze-form` call in flight during
  // steps 1-3 can upload frames into a prefix we already swept. Re-running the (idempotent) purge
  // costs one `list()` when nothing reappeared, which is the overwhelmingly common case.
  try {
    const sweptAfter = await purgeAccountPrefix(
      storage,
      userId,
      pageSize,
      listConcurrency,
      now() + (params.postDeleteSweepDeadlineMs ?? ACCOUNT_POST_DELETE_SWEEP_DEADLINE_MS),
      now
    );
    if (sweptAfter > 0) {
      log({ event: 'delete_account.post_delete_sweep_removed_objects', userId, sweptAfter, level: 'warn' });
    }
  } catch (err) {
    const reason = errorMessage(err);
    // The account is gone and cannot be restored, so this cannot be fixed by a retry from the
    // client — it needs a human. Loud, structured, error-level, and naming the exact prefix: this
    // log is the ONLY alarm for this outcome, since the HTTP response is (correctly) a 200 with no
    // retry affordance — see accountResponseBodyForOutcome's doc comment for why.
    log({ event: 'delete_account.orphans_remaining', userId, prefix, reason, level: 'error', durationMs: now() - startedAt });
    return { outcome: 'orphans_remaining', reason, purgedObjectCount, consentEventsPurged };
  }

  log({
    event: 'delete_account.completed',
    userId,
    purgedObjectCount,
    consentEventsPurged,
    profileExisted,
    durationMs: now() - startedAt,
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
