/**
 * `describeCooldownRemaining` — the cooldown countdown phrase, in its own module.
 *
 * Kept out of both `lib/quota.ts` and `lib/analysis-preflight.ts` because both need it and those
 * two already import each other's other exports; a shared pure helper here is what keeps that from
 * becoming a module cycle, the same split `lib/extraction-frame-cap.ts` took.
 */
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long a cooldown has left, as a phrase to drop into a sentence ("paused for {x}"), or `null`
 * when we genuinely do not know.
 *
 * `null` is returned for a missing, unparsable, or already-past `blockedUntil` — never a guess and
 * never "0 minutes". A stale reading whose expiry has passed is not evidence the cooldown has
 * lifted (only `reserve_analysis` can say that), so the caller falls back to wording that states
 * the pause without naming a time.
 *
 * Deliberately COARSE, and always hedged with "about": `blocked_until` is derived from a rolling
 * window over `released_at` timestamps, so a to-the-minute countdown would imply a precision the
 * underlying value does not have. The buckets mirror how the number is actually used — Free's
 * window is 24h, a paid period's remainder can be weeks.
 */
export function describeCooldownRemaining(
  blockedUntil: string | null,
  now: number = Date.now()
): string | null {
  if (!blockedUntil) return null;

  const until = new Date(blockedUntil).getTime();
  if (Number.isNaN(until)) return null;

  const remaining = until - now;
  if (remaining <= 0) return null;

  if (remaining < MINUTE_MS) return 'under a minute';
  if (remaining < HOUR_MS) {
    const minutes = Math.ceil(remaining / MINUTE_MS);
    return minutes === 1 ? 'about a minute' : `about ${minutes} minutes`;
  }
  if (remaining < DAY_MS) {
    const hours = Math.ceil(remaining / HOUR_MS);
    return hours === 1 ? 'about an hour' : `about ${hours} hours`;
  }
  const days = Math.ceil(remaining / DAY_MS);
  return days === 1 ? 'about a day' : `about ${days} days`;
}
