/**
 * The pending-analysis marker (issue #140) — a follow-up to issue #64.
 *
 * #64 fixed background -> foreground reconciliation WHILE `app/analyzing.tsx` stays mounted: all
 * three server-side outcomes (`reserved` keeps waiting, `delivered` routes to the result,
 * `released` shows an honest failure with an exit). It could not fix a process KILL + cold
 * relaunch, because the thing it reconciles against — `lib/analyze-form.ts`'s one-shot
 * `pendingRequest` mailbox — is plain module state and does not survive a process restart. A user
 * whose app is killed mid-wait (exactly when the OS is most likely to kill it) lands back on Home
 * with nothing on screen ever having gone looking for the analysis they were charged for.
 *
 * THIS FILE is that "something." It persists a small, non-secret marker — just the
 * `idempotencyKey` (the same handle #64's own in-session reconciliation already keys on:
 * `reserve_analysis` guarantees at most one `analyses` row per `(user_id, idempotencyKey)`) plus
 * the `userId` that started it — the instant a real `analyze-form` request exists
 * (`app/analyzing.tsx`, issue #140's HANDOFF into that file). `app/(tabs)/index.tsx` reads it back
 * at startup and reconciles it against the live `analyses` row, exactly mirroring the three-way
 * branch `app/analyzing.tsx`'s own foreground-reconciliation effect already established:
 *   - no row yet, a transient read error, or `status: 'reserved'` -> still genuinely in flight (or
 *     not yet reconcilable) -> leave the marker in place and do nothing. `sweep_stale_reservations`
 *     (`supabase/migrations/20260713130000_stale_reservation_sweep.sql`) guarantees a *genuinely*
 *     dead reservation eventually becomes `released` on its own (15-minute backstop), so a
 *     perpetually-`reserved` row cannot wedge this into a forever-no-op — a later cold start will
 *     eventually see `released` and finish the job.
 *   - `status: 'delivered'` -> route to `/result/[id]`, clear the marker.
 *   - `status: 'released'` -> surface an honest, non-alarmed failure with an exit (Home is never a
 *     dead end to begin with — its own primary CTA and Settings link stay fully usable underneath),
 *     clear the marker.
 *
 * STORAGE CHOICE: plain `AsyncStorage`, NOT `lib/secure-storage.ts`'s Keychain/Keystore-backed
 * adapter. That adapter exists to protect a Supabase session (an access + refresh token pair) —
 * genuine credentials. An idempotency key is a random UUID with no standalone value (it cannot be
 * replayed into a request without also holding this user's own session, which secure-storage.ts
 * already protects), and the user id it's paired with is already visible to the app itself the
 * moment it's signed in. Routing it through SecureStore would gain no confidentiality and would
 * risk exactly the ~2KB-per-value ceiling that adapter's own header documents working around for a
 * much larger payload — pure downside for a marker this small and this non-sensitive. Reaching for
 * `@react-native-async-storage/async-storage` directly (already a transitive dependency of
 * secure-storage.ts, not a new one) matches this codebase's own precedent for "a plain module
 * holding one piece of persisted state" (`lib/consent.ts`'s doc comment, `lib/analyze-form.ts`'s
 * mailbox) — the only difference from those is this one specific piece of state has to survive a
 * process restart, which is exactly what AsyncStorage (and only AsyncStorage, of this app's two
 * storage primitives) is for.
 *
 * CROSS-ACCOUNT SAFETY: the marker carries the `userId` it was written under. `checkPendingAnalysis`
 * refuses to reconcile a marker against any session whose `user.id` does not match — including no
 * session at all (signed out) — and clears it on sight instead. This is belt-and-braces, not the
 * only thing standing between two accounts: RLS already scopes the `analyses` SELECT to
 * `auth.uid()`, so a query for user A's idempotency key made under user B's session would return
 * zero rows regardless (idempotency keys are per-request UUIDs, never shared across users) — this
 * check exists so a mismatched marker gets swept up and cleared the FIRST time any session sees it,
 * rather than being silently retried, forever, against a key that can never match.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';
import { isPaceAnalysisOutcome, type PaceAnalysisOutcome } from '@shared/pace';

const PENDING_ANALYSIS_STORAGE_KEY = 'pace.pendingAnalysis.v1';

export interface PendingAnalysisMarker {
  /** Reused verbatim from `AnalyzeFormRequest.idempotencyKey` (`lib/analyze-form.ts`) — never a
   * second, independently-minted identity for the same analysis. */
  idempotencyKey: string;
  /** The signed-in user's id at the moment the marker was written — see this file's header,
   * "CROSS-ACCOUNT SAFETY", for why this is checked before ever reconciling. */
  userId: string;
}

function isPendingAnalysisMarker(value: unknown): value is PendingAnalysisMarker {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.idempotencyKey === 'string' && typeof record.userId === 'string';
}

// -------------------------------------------------------------------------------------------
// Storage — every operation is best-effort. Losing a write, a read, or a clear here degrades
// exactly one thing (this issue's own reconciliation), never a security boundary and never
// something worth surfacing as a UI error over whatever the caller is already showing — see this
// file's header for why the confidentiality bar is low. Callers never need their own try/catch.
// -------------------------------------------------------------------------------------------

/** Called by `app/analyzing.tsx` the instant a real request exists (issue #140's HANDOFF into
 * that file) — before the `analyzeFormClient.submit()` call, so a kill in the first instants of
 * the wait is still covered, not just a kill later on. */
export async function setPendingAnalysisMarker(marker: PendingAnalysisMarker): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_ANALYSIS_STORAGE_KEY, JSON.stringify(marker));
  } catch {
    // Best-effort only (see this file's header) — losing this write just means a kill during
    // THIS one analysis cannot be reconciled, no worse than the total gap before this issue.
  }
}

/**
 * One-shot-safe read: returns the persisted marker, or `null` if there is none, it fails to
 * parse, or it doesn't have the shape this module writes (e.g. a future format change). A
 * malformed value is cleared on the way out rather than left to fail the same parse forever.
 */
export async function getPendingAnalysisMarker(): Promise<PendingAnalysisMarker | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(PENDING_ANALYSIS_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (isPendingAnalysisMarker(parsed)) {
      return parsed;
    }
  } catch {
    // Falls through to the clear-and-return-null below, same treatment as a recognized-but-
    // wrong shape — either way this value can never be reconciled.
  }

  await clearPendingAnalysisMarker();
  return null;
}

/** Called once a marker has been authoritatively reconciled (`delivered`/`released`), or the
 * marker belongs to a different/no session — never for a `reserved`/not-found/error read, which
 * must leave the marker in place for a later check to retry. Also safe to call when there is
 * nothing stored at all. */
export async function clearPendingAnalysisMarker(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_ANALYSIS_STORAGE_KEY);
  } catch {
    // Same best-effort posture as setPendingAnalysisMarker above.
  }
}

// -------------------------------------------------------------------------------------------
// Reconciliation — a pure interpreter (unit-testable with plain objects, no network, no
// storage) plus the impure function that wires it to the marker and the live `analyses` row.
// Mirrors `app/analyzing.tsx`'s own foreground-reconciliation effect (issue #64) so the two stay
// in obvious lockstep; that effect's inline logic is not exported (it's local to that screen and
// out of this issue's file lane), so this is a deliberate, parallel re-derivation, not a shared
// import — same three-way branch, same columns.
// -------------------------------------------------------------------------------------------

/** The columns `checkPendingAnalysis` selects — identical to `app/analyzing.tsx`'s own
 * reconciliation read, deliberately: `idempotency_key` is not part of the projection because the
 * query already filters on it, matching that screen's own comment on why the DB id is never known
 * until an outcome names it. */
export interface PendingAnalysisRow {
  id: string;
  status: 'reserved' | 'delivered' | 'released';
  result: unknown;
  is_fallback: boolean;
}

export type PendingAnalysisReconciliation =
  /** Nothing was pending, or what was pending could not be attributed to the current session —
   * see `checkPendingAnalysis`'s cross-account guard. No UI, no marker left behind. */
  | { kind: 'none' }
  /** Still genuinely in flight (`status: 'reserved'`), not yet visible (no row, or a transient
   * read error), or a `delivered` row whose stored `result`/`is_fallback` fails structural
   * validation. The marker is left in place; a later check (the next cold start, since this
   * screen only checks once at startup) will retry. Never an error, never surfaced to the user —
   * same posture `app/analyzing.tsx`'s own reconciliation effect takes for the same cases. */
  | { kind: 'pending' }
  /** `status: 'delivered'` with a structurally valid outcome. The marker has already been
   * cleared by the time this is returned. */
  | { kind: 'delivered'; analysisId: string; outcome: PaceAnalysisOutcome }
  /** `status: 'released'` — the server gave up on it while nothing was watching. The marker has
   * already been cleared by the time this is returned. */
  | { kind: 'released'; analysisId: string };

/**
 * Pure interpretation of one already-fetched row (or its absence) into what the caller should do.
 * No I/O — the network read and the marker-clearing side effect both live in
 * `checkPendingAnalysis` below, which is what makes this function testable with plain objects.
 */
export function interpretPendingAnalysisRow(row: PendingAnalysisRow | null): PendingAnalysisReconciliation {
  if (!row) {
    return { kind: 'pending' };
  }

  if (row.status === 'delivered') {
    const outcome = { result: row.result, isFallback: row.is_fallback };
    // Structural validation only (CLAUDE.md: shape, never content) before trusting a row read
    // outside analyze-form's own response path — same discipline `app/analyzing.tsx`'s own
    // reconciliation effect documents for itself. An invalid shape here would be a genuine bug
    // elsewhere (settle_analysis only ever writes a validated PaceResult); rather than route to a
    // broken result screen, this falls through to 'pending' and leaves the marker for a retry.
    if (isPaceAnalysisOutcome(outcome)) {
      return { kind: 'delivered', analysisId: row.id, outcome };
    }
    return { kind: 'pending' };
  }

  if (row.status === 'released') {
    return { kind: 'released', analysisId: row.id };
  }

  // status === 'reserved'
  return { kind: 'pending' };
}

/**
 * Reads the persisted marker (if any), reconciles it against the current session and the live
 * `analyses` row, and clears the marker exactly when the outcome is authoritative
 * (`delivered`/`released`) or the marker cannot belong to this session. Never throws — every
 * failure path (no marker, wrong/no session, a query error, an exception) resolves `{ kind:
 * 'pending' }` or `{ kind: 'none' }` rather than rejecting, so a caller never needs its own
 * try/catch around this. `currentUserId` is `session?.user.id ?? null` at the call site
 * (`app/(tabs)/index.tsx`) — `null` covers both "signed out" and "session still loading" and is
 * always treated as "not this marker's owner."
 */
export async function checkPendingAnalysis(currentUserId: string | null): Promise<PendingAnalysisReconciliation> {
  const marker = await getPendingAnalysisMarker();
  if (!marker) {
    return { kind: 'none' };
  }

  if (!currentUserId || marker.userId !== currentUserId) {
    await clearPendingAnalysisMarker();
    return { kind: 'none' };
  }

  let row: PendingAnalysisRow | null;
  try {
    // No explicit user_id filter: RLS scopes this to the caller's own rows (same idiom
    // `lib/consent.ts`/`lib/history.ts` document for their own reads), and the cross-account
    // guard above already refuses to reach this line for a marker that isn't this session's own.
    const { data, error } = await supabase
      .from('analyses')
      .select('id, status, result, is_fallback')
      .eq('idempotency_key', marker.idempotencyKey)
      .maybeSingle();

    if (error) {
      return { kind: 'pending' };
    }
    row = data;
  } catch {
    return { kind: 'pending' };
  }

  const outcome = interpretPendingAnalysisRow(row);
  if (outcome.kind === 'delivered' || outcome.kind === 'released') {
    await clearPendingAnalysisMarker();
  }
  return outcome;
}
