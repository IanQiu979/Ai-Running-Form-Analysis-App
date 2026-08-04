/**
 * A plain module-level mailbox for handing a Free-tier sample result from `app/analyzing.tsx` to
 * `app/result/sample.tsx`, mirroring `lib/analyze-form.ts`'s own `pendingRequest` mailbox
 * one-for-one (same file's header explains why: this handoff carries a full `PaceResult` plus a
 * `data:` URI of the user's photo, both far past what's sane to round-trip through expo-router's
 * serialized route params). Kept in its own file rather than folded into `lib/analyze-form.ts`
 * because this handoff never touches the wire — it exists entirely between two screens, after the
 * `analyze-form` response has already been parsed.
 */
import type { PaceResult } from '@shared/pace';

export interface PendingSampleResult {
  result: PaceResult;
  /** A `data:image/jpeg;base64,...` URI built client-side from the frame already in memory — see
   * `app/analyzing.tsx`. `null` only in the defensive case of an empty frame array, which the
   * server-enforced photo-must-be-one-frame rule should make unreachable in practice. */
  heroDataUri: string | null;
}

let pendingSampleResult: PendingSampleResult | null = null;

export function setPendingSampleResult(value: PendingSampleResult): void {
  pendingSampleResult = value;
}

/** One-shot read: returns the pending sample and clears it, same semantics as
 * `takePendingAnalyzeFormRequest` — a later re-read (fast refresh, a second screen instance, a
 * direct/cold navigation) returns `null` rather than replaying a stale sample. */
export function takePendingSampleResult(): PendingSampleResult | null {
  const value = pendingSampleResult;
  pendingSampleResult = null;
  return value;
}
