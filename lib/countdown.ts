/**
 * The Preparing screen's two measured times (2026-10-06): the cooldown COUNTDOWN read off the
 * pre-flight's `blockedUntil`, and the out-of-analyses panel's RESET date read off the server's
 * `periodEnd`. Pure, clock-injected, no React — `lib/__tests__/countdown.test.ts`.
 *
 * WHY A REAL COUNTDOWN NOW. `lib/cooldown-remaining.ts` deliberately states a cooldown coarsely
 * ("about 2 hours"), because `blocked_until` is derived from a rolling window and is an estimate.
 * The captain's 2026-10-06 ruling for the redesigned Preparing screen is to count it down to the
 * second anyway. What keeps that honest is what happens at zero: nothing unlocks on the client.
 * The screen only offers "Continue", which asks the server again (`fetchAnalysisPreflight`) — a
 * reading whose time has passed is still not evidence the pause has lifted.
 */

const SECOND_MS = 1000;
const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;
const DAY_MS = 24 * HOUR_S * SECOND_MS;

/** Milliseconds from `now` until `iso`, floored at zero; `null` for a missing or unparsable time. */
export function msUntil(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return null;
  return Math.max(0, target - now);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Whole seconds left, rounded UP — a clock that reads 00:00 must mean the time has passed. */
function secondsLeft(ms: number): number {
  return Math.ceil(Math.max(0, ms) / SECOND_MS);
}

/**
 * The countdown card's figure: `MM:SS` under an hour (the page's "00:42"), `H:MM:SS` from an hour
 * up — a Free cooldown window can run to 24 hours, and "1440:00" is not a time anyone reads.
 */
export function formatCountdown(ms: number): string {
  const total = secondsLeft(ms);
  const hours = Math.floor(total / HOUR_S);
  const minutes = Math.floor((total % HOUR_S) / MINUTE_S);
  const seconds = total % MINUTE_S;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** The disabled Continue button's figure: the page's "0:42" — unpadded minutes, then `H:MM:SS`. */
export function formatCountdownCompact(ms: number): string {
  const total = secondsLeft(ms);
  const hours = Math.floor(total / HOUR_S);
  const minutes = Math.floor((total % HOUR_S) / MINUTE_S);
  const seconds = total % MINUTE_S;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * The share of the window still to run, for the countdown card's draining bar. `startMs` is how
 * much was left when the screen first saw the pause — the server does not say when the window
 * opened, so the bar drains from "now" rather than pretending to know.
 */
export function remainingFraction(remainingMs: number, startMs: number): number {
  if (!(startMs > 0)) return 0;
  return Math.min(1, Math.max(0, remainingMs / startMs));
}

/** Whole days until `iso`, rounded up, never below 1 for a future time; `null` when unknown or past. */
export function daysUntil(iso: string | null | undefined, now: number = Date.now()): number | null {
  const ms = msUntil(iso, now);
  if (ms === null || ms === 0) return null;
  return Math.max(1, Math.ceil(ms / DAY_MS));
}

/** The reset date as a short local date ("1 Nov" / "Nov 1", by the device's locale); `null` when unknown. */
export function formatResetDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date);
}
