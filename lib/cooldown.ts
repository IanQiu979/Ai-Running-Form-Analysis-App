/**
 * When a temporary block clears, as a clock time a runner can act on — the ONE formatter both
 * surfaces that can report the Free zero-pillar cooldown use (review r8-1).
 *
 * Two callers, two inputs, one output, which is why this is a `lib/` function rather than a helper
 * inside either screen:
 *
 *   - HOME pre-flights the cooldown from `quota-status`'s `blockedUntil` (an ISO timestamp), so a
 *     runner in cooldown never extracts frames on device and uploads them only to be refused.
 *   - THE ANALYZING SCREEN, for the resubmission that slips through anyway (a stale quota reading,
 *     a second device), reports the 429's own `retryAfterSeconds`.
 *
 * A CLOCK TIME, never a duration, and that is deliberate: "in 14 minutes" is stale the moment it
 * renders and turns any panel that lingers into a lie, while "at 3:42 PM" stays true however long
 * the user looks at it. `Intl.DateTimeFormat` with no explicit locale follows the device's own
 * 12/24-hour convention.
 *
 * Returns `null` — never a guess, never "soon" — for anything it cannot compute honestly: a
 * missing or unparsable timestamp, a non-finite duration, or a block that has already expired.
 * Each caller decides what to say when there is no time to state; none of them may invent one.
 */

/** Formats an absolute instant as a short local clock time. `null` for an invalid date. */
export function formatCooldownClockTime(target: Date): string | null {
  if (Number.isNaN(target.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(target);
}

/**
 * `quota-status`'s `blockedUntil` (ISO 8601) as a clock time. `null` when the field is absent,
 * unparsable, or already in the past — a block that has expired has no time worth stating, and
 * the caller should say nothing rather than name a moment that has been and gone.
 */
export function cooldownEndsAt(blockedUntil: string | null, now: Date = new Date()): string | null {
  if (!blockedUntil) return null;
  const target = new Date(blockedUntil);
  if (Number.isNaN(target.getTime()) || target.getTime() <= now.getTime()) return null;
  return formatCooldownClockTime(target);
}

/**
 * A `retryAfterSeconds` duration from an `analyze-form` 429, as a clock time. `null` for a missing,
 * non-finite, or non-positive value — the server sends this only when it is actually throttling,
 * so anything else is a body we cannot read rather than a wait we can describe.
 */
export function cooldownEndsIn(
  retryAfterSeconds: number | undefined,
  now: Date = new Date()
): string | null {
  if (typeof retryAfterSeconds !== 'number' || !Number.isFinite(retryAfterSeconds)) return null;
  if (retryAfterSeconds <= 0) return null;
  return formatCooldownClockTime(new Date(now.getTime() + retryAfterSeconds * 1000));
}
