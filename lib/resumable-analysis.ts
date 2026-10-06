/**
 * THE SESSION-EXPIRED RESUME (captain's ruling, 2026-10-06): when `analyze-form` answers
 * `unauthorized` because the runner's session ended mid-analysis, the frames they already
 * extracted are KEPT, they are sent to sign in, and the SAME analysis is retried automatically —
 * the same `AnalyzeFormRequest` object, so the same idempotency key and byte-identical frames.
 *
 * WHY THE SAME OBJECT IS SAFE TO SEND TWICE. `analyze-form` is idempotent on
 * `(user_id, idempotencyKey)`: a 401 is answered before anything is reserved, so the resumed call
 * is the first one the server ever counts; and if any earlier attempt under the key did reserve,
 * the server replays or refuses it rather than running the model again (`flow.ts`'s
 * `handleExisting`; `supabase/functions/analyze-form/__tests__/flow.deno.test.ts` proves both).
 * Changing the frames under one key is refused server-side (`idempotency_identity_mismatch`) —
 * which is why this module hands back the very object it was given, never a rebuilt one.
 *
 * ACCOUNT-SCOPED. The hold carries the user id the analysis started under. `takeResumableAnalysis`
 * returns it only to that same user; any other user — or no user — DISCARDS it, so one account's
 * frames can never be submitted under another account's session (RLS and the per-user key would
 * refuse to cross accounts anyway; this keeps the bytes from ever being sent).
 *
 * MEMORY ONLY. Plain module state, like `lib/analyze-form.ts`'s mailbox it feeds: never written to
 * AsyncStorage, SecureStore, a file, or the photo library, and gone when the process ends. Images
 * of people's bodies are not persisted to resume a convenience.
 *
 * CLEARED on: a delivered result, Cancel / Back / "Start new analysis", a NEW analysis being staged
 * (`app/capture/extracting.tsx`), a user-initiated sign-out (`lib/sign-out.ts`'s default), and any
 * take by a different account. The one sign-out that keeps it is the expired-session panel's own
 * "Sign in and retry", which exists to resume it.
 */
import type { AnalyzeFormRequest } from './analyze-form';

/**
 * How long a hold may wait for the runner to sign back in. Long enough to find a password; short
 * enough that an analysis the runner has forgotten about never starts by surprise on a later
 * sign-in, and the frames do not sit in memory for the rest of the session.
 */
export const RESUME_HOLD_TTL_MS = 15 * 60 * 1000;

type Hold = { request: AnalyzeFormRequest; userId: string; heldAt: number };

let hold: Hold | null = null;

/**
 * Bumped by every `discardResumableAnalysis()`. An Analyzing attempt reads it when it starts
 * (`currentResumeGeneration`) and passes it back to `holdForResume`; a 401 that arrives AFTER the
 * runner cancelled, went back, or started something new carries a stale generation and is refused.
 * Without this, a late answer to an attempt the runner walked away from would re-arm the hold and
 * silently resubmit it on their next sign-in.
 */
let generation = 0;

/** The generation an attempt must quote to `holdForResume`. Read when the attempt starts. */
export function currentResumeGeneration(): number {
  return generation;
}

/**
 * Keeps `request` for `userId` until it is taken, discarded, or expires. Refused (a no-op) for an
 * empty user id, or when `attemptGeneration` is stale — see `generation`. Replaces any earlier hold.
 */
export function holdForResume(
  request: AnalyzeFormRequest,
  userId: string,
  attemptGeneration: number,
  now: number = Date.now()
): void {
  if (!userId || attemptGeneration !== generation) return;
  hold = { request, userId, heldAt: now };
}

/**
 * One-shot: the held request when `currentUserId` is exactly the user it was held for and the hold
 * has not expired. The hold is cleared synchronously BEFORE returning, whatever the outcome, so it
 * can resume at most once; for any other user, or none, it is discarded — a different account never
 * inherits these frames, even later.
 */
export function takeResumableAnalysis(
  currentUserId: string | null | undefined,
  now: number = Date.now()
): AnalyzeFormRequest | null {
  const held = hold;
  hold = null;
  if (!held || !currentUserId || held.userId !== currentUserId) return null;
  if (now - held.heldAt > RESUME_HOLD_TTL_MS) return null;
  return held.request;
}

/** Drops the hold, if any, and retires every attempt in flight (see `generation`). */
export function discardResumableAnalysis(): void {
  hold = null;
  generation += 1;
}

/**
 * Drops a hold that belongs to anyone but `userId` — `lib/session-provider.tsx` calls this the
 * moment a session for a user appears, so a different account's sign-in clears the frames even
 * before Home mounts. A hold for this same user is left for Home to take.
 */
export function discardResumableAnalysisUnlessOwnedBy(userId: string): void {
  if (hold && hold.userId !== userId) discardResumableAnalysis();
}

/** Whether frames are being kept for a resume — for display and tests, never for a decision. */
export function hasResumableAnalysis(): boolean {
  return hold !== null;
}
