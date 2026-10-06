/**
 * The Preparing (`app/capture/extracting.tsx`) and Analysing (`app/analyzing.tsx`) screens'
 * pure display decisions (2026-10-06 redesign, Claude Design "Preparing & Analysing — V23"): which
 * checklist rows are done, which stop state a failure maps to, which step of Upload / Read /
 * Result is lit. No React, no I/O, no clock — `lib/__tests__/loading-screens.test.ts`.
 *
 * NOTHING HERE DECIDES ANYTHING. Every input is a state the screens already own — the pre-flight's
 * answer, the extraction's real progress count, `lib/analyzing-machine.ts`'s phase and caption
 * pacing — and every output is only what to draw for it. In particular the Upload / Read / Result
 * track is a projection of the machine's EXISTING steps; it invents no progress of its own.
 */
import type { QuotaStatus } from '@shared/quota-status';

import type { AnalyzingCaptionPhase, AnalyzingState } from './analyzing-machine';

// -------------------------------------------------------------------------------------------
// Preparing
// -------------------------------------------------------------------------------------------

export type MediaKind = 'photo' | 'video';

/** Where Preparing is in its own work. `checking` is the pre-flight round trip. */
export type PreparingStage = 'checking' | 'extracting' | 'ready';

export type ChecklistStatus = 'done' | 'now' | 'todo';

export type ChecklistRow = {
  key: 'quota' | 'frames' | 'ready';
  status: ChecklistStatus;
};

/**
 * The three-row checklist: Quota checked -> Extracting frames (or Loading your photo) -> Ready for
 * analysis. Each row is `done`, `now` (the one in progress), or `todo`.
 */
export function preparingChecklist(stage: PreparingStage): ChecklistRow[] {
  const order: PreparingStage[] = ['checking', 'extracting', 'ready'];
  const at = order.indexOf(stage);
  const keys: ChecklistRow['key'][] = ['quota', 'frames', 'ready'];
  return keys.map((key, i) => ({
    key,
    // `ready` is the end state, not a step in progress: when it is reached every row is done.
    status: stage === 'ready' || i < at ? 'done' : i === at ? 'now' : 'todo',
  }));
}

/**
 * The quota row's value: the server's own `remaining`, or nothing at all. A pre-flight that failed
 * open (`quota: null`) stated no number, so none is shown — the row still completes, because the
 * check DID run, but it never names a count the server did not give.
 */
export function quotaRemaining(quota: QuotaStatus | null): number | null {
  return quota && typeof quota.remaining === 'number' ? quota.remaining : null;
}

/** The badge's parts: media, then (for a video once the count is known) the tier when it is
 *  Elite — the one tier whose frame count differs — and the frame count. */
export function preparingBadgeParts(
  mediaType: MediaKind,
  frameTotal: number | null,
  tier: QuotaStatus['tier'] | null
): ('photo' | 'video' | 'elite' | { frames: number })[] {
  if (mediaType === 'photo') return ['photo'];
  if (frameTotal === null) return ['video'];
  return tier === 'elite' ? ['video', 'elite', { frames: frameTotal }] : ['video', { frames: frameTotal }];
}

/**
 * The hero numeral: the frame being pulled now (the page's "3 / 5" while two are done), clamped to
 * the total so a finished extraction reads "5 / 5", never "6 / 5".
 */
export function preparingHeroIndex(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(done, 0) + 1, total);
}

export type TileStatus = 'done' | 'now' | 'todo';

/** Frame tile `index` (0-based) given `done` frames completed out of `total`. */
export function preparingTileStatus(index: number, done: number, total: number): TileStatus {
  if (index < done) return 'done';
  if (index === done && done < total) return 'now';
  return 'todo';
}

/** What the out-of-analyses panel shows: the paid version (period + reset) or the Free one. */
export type QuotaPanel =
  | { kind: 'paid'; used: number; limit: number; resetsAt: string | null }
  | { kind: 'free'; used: number; limit: number }
  | { kind: 'unknown' };

/**
 * Free is ONE analysis for life, with no reset (`QuotaStatus.isLifetime`). A paid plan resets at
 * `periodEnd`. With no reading at all the panel states neither — `unknown` draws the title and the
 * way to the plans, without numbers.
 */
export function quotaPanel(quota: QuotaStatus | null): QuotaPanel {
  if (!quota) return { kind: 'unknown' };
  if (quota.isLifetime || quota.tier === 'free') return { kind: 'free', used: quota.used, limit: quota.limit };
  return { kind: 'paid', used: quota.used, limit: quota.limit, resetsAt: quota.periodEnd };
}

// -------------------------------------------------------------------------------------------
// Analysing
// -------------------------------------------------------------------------------------------

/** The four progress artboards: a. uploading, b. finding your stride, c. still analyzing, d. done. */
export type AnalysingPhase = 'uploading' | 'finding' | 'longWait' | 'done';

/** `null` when the machine is in a stop state, which draws the failure layout instead. */
export function analysingPhase(state: AnalyzingState, caption: AnalyzingCaptionPhase): AnalysingPhase | null {
  if (state.phase === 'succeeded') return 'done';
  if (state.phase !== 'waiting') return null;
  if (caption.kind === 'longWait') return 'longWait';
  return caption.stepKey === 'uploading' ? 'uploading' : 'finding';
}

export type TrackStep = { key: 'upload' | 'read' | 'result'; status: ChecklistStatus };

/**
 * Upload / Read / Result. Uploading lights Upload; finding and the long wait light Read (the same
 * machine step, held); done completes all three — the result screen is what comes next.
 */
export function analysingTrack(phase: AnalysingPhase): TrackStep[] {
  const at = phase === 'uploading' ? 0 : phase === 'done' ? 3 : 1;
  return (['upload', 'read', 'result'] as const).map((key, i) => ({
    key,
    status: i < at ? 'done' : i === at ? 'now' : 'todo',
  }));
}

/** Every stop state the Analysing screen can end in, one layout each. */
export type AnalysingStop =
  | 'failed'
  | 'timeout'
  // 409 `analysis_in_progress`: an earlier attempt under this key is still running server-side.
  | 'inProgress'
  // 410 `analysis_deleted`: the analysis under this key was delivered, then deleted.
  | 'deleted'
  | 'unauthorized'
  | 'offline'
  | 'released'
  | 'paused'
  | 'zeroPillarCooldown';

/**
 * The stop state for a machine state, or `null` while it is still running (or succeeded). A 402
 * `quota_exceeded` is also `null`: the screen routes it straight to the paywall, so it never draws.
 */
export function analysingStop(state: AnalyzingState): AnalysingStop | null {
  switch (state.phase) {
    case 'timedOut':
      return 'timeout';
    case 'offline':
      return 'offline';
    case 'released':
      return 'released';
    case 'failed':
      switch (state.code) {
        case 'quota_exceeded':
          return null;
        case 'unauthorized':
          return 'unauthorized';
        case 'previous_attempt_failed':
          return 'released';
        case 'analysis_in_progress':
          return 'inProgress';
        case 'analysis_deleted':
          return 'deleted';
        case 'too_many_failed_attempts':
          return 'paused';
        case 'zero_pillar_cooldown':
          return 'zeroPillarCooldown';
        default:
          return 'failed';
      }
    default:
      return null;
  }
}

/** Whether Retry can genuinely succeed from this stop — the machine's own `retry` rule. */
export function stopIsRetryable(stop: AnalysingStop): boolean {
  // `inProgress`: a Retry under the same key replays the earlier attempt once it has settled.
  return stop === 'failed' || stop === 'timeout' || stop === 'offline' || stop === 'inProgress';
}

/**
 * Whether "Not counted against your quota" is TRUE for this state. Only where the server is known
 * not to have charged:
 *   - NOT a timeout, nor a submit that threw (no `code`): the client giving up, or losing the
 *     response, does not stop the server, which may still finish and settle the analysis;
 *   - NOT the client's own `unknown` code: it also covers a 200 this client could not validate,
 *     where the server DID settle and keep the quota (`lib/analyze-form.ts`);
 *   - NOT `inProgress` (the earlier attempt will be charged when it settles) nor `deleted` (it was
 *     delivered, and charged, before it was deleted).
 * A server-authored failure code is answered after the reservation is released
 * (docs/architecture.md step 9), and every other stop never reserved at all.
 */
export function stopIsUncounted(stop: AnalysingStop, state: AnalyzingState): boolean {
  if (stop === 'timeout' || stop === 'inProgress' || stop === 'deleted') return false;
  if (stop === 'failed') {
    const code = state.phase === 'failed' ? state.code : undefined;
    return typeof code === 'string' && code !== 'unknown';
  }
  return true;
}

/** The page's `mm:ss` clock (the analysis is bounded at 120 s, so minutes never pass 99). */
export function formatElapsed(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
