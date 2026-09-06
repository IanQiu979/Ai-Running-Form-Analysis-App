/**
 * Locks for `lib/cooldown.ts` (review r8-1). The property that matters: this formatter never
 * invents a time. Every input it cannot turn into a real future instant — absent, unparsable,
 * non-finite, already elapsed — comes back `null`, so the two surfaces that report a block are
 * forced to say "later" rather than name a moment the server never promised.
 *
 * The formatted string itself is locale/timezone dependent, so these assert the CONTRACT (a time
 * is produced, and it is the right instant) by comparing against the same `Intl` formatting the
 * module uses, never against a hardcoded "3:15 PM" that would fail on a machine set to 24-hour.
 */
import { cooldownEndsAt, cooldownEndsIn, formatCooldownClockTime } from '../cooldown';

const NOW = new Date('2026-09-06T15:00:00.000Z');

function expectedTimeFor(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso)
  );
}

describe('cooldownEndsAt (quota-status blockedUntil)', () => {
  it('formats a future block as the clock time it clears at', () => {
    expect(cooldownEndsAt('2026-09-06T15:15:00.000Z', NOW)).toBe(
      expectedTimeFor('2026-09-06T15:15:00.000Z')
    );
  });

  it('returns null for a block that has already passed', () => {
    expect(cooldownEndsAt('2026-09-06T14:59:00.000Z', NOW)).toBeNull();
  });

  it('returns null exactly at the boundary — a block clearing now is not a wait', () => {
    expect(cooldownEndsAt('2026-09-06T15:00:00.000Z', NOW)).toBeNull();
  });

  it('returns null for a missing or unparsable timestamp rather than guessing', () => {
    expect(cooldownEndsAt(null, NOW)).toBeNull();
    expect(cooldownEndsAt('not a date', NOW)).toBeNull();
    expect(cooldownEndsAt('', NOW)).toBeNull();
  });
});

describe('cooldownEndsIn (analyze-form retryAfterSeconds)', () => {
  it('turns a duration into the clock time it expires at, not a countdown', () => {
    // 900s past NOW — the same instant, stated as a time, so a panel left open does not go stale.
    expect(cooldownEndsIn(900, NOW)).toBe(expectedTimeFor('2026-09-06T15:15:00.000Z'));
  });

  it('returns null for a missing, zero, negative, or non-finite duration', () => {
    expect(cooldownEndsIn(undefined, NOW)).toBeNull();
    expect(cooldownEndsIn(0, NOW)).toBeNull();
    expect(cooldownEndsIn(-60, NOW)).toBeNull();
    expect(cooldownEndsIn(Number.NaN, NOW)).toBeNull();
    expect(cooldownEndsIn(Number.POSITIVE_INFINITY, NOW)).toBeNull();
  });

  it('agrees with cooldownEndsAt for the same instant — one wait, one answer', () => {
    // The pre-flight (Home, from an ISO timestamp) and the backstop (Analyzing, from a duration)
    // must never state two different times for the same block.
    expect(cooldownEndsIn(900, NOW)).toBe(cooldownEndsAt('2026-09-06T15:15:00.000Z', NOW));
  });
});

describe('formatCooldownClockTime', () => {
  it('returns null for an invalid date rather than "Invalid Date"', () => {
    expect(formatCooldownClockTime(new Date('nope'))).toBeNull();
  });
});
