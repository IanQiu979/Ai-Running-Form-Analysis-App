/**
 * Locks for `lib/countdown.ts` — the Preparing screen's cooldown countdown and reset date.
 *
 * The property that matters most: the clock rounds UP, so "00:00" is only ever drawn once the time
 * has genuinely passed. A clock that rounded down would read 00:00 for the last 999 ms of a pause
 * the server is still enforcing. Every clock-reading function takes `now` explicitly here.
 *
 * `formatResetDate` is locale dependent, so it is asserted against the same `Intl` formatting the
 * module uses (the `lib/__tests__/cooldown.test.ts` pattern), never a hardcoded "1 Nov".
 */
import {
  daysUntil,
  formatCountdown,
  formatCountdownCompact,
  formatResetDate,
  msUntil,
  remainingFraction,
} from '../countdown';

const NOW = new Date('2026-10-06T12:00:00.000Z').getTime();
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}

describe('msUntil', () => {
  it('returns the milliseconds left until a future time', () => {
    expect(msUntil(isoAt(NOW + 42 * SECOND), NOW)).toBe(42 * SECOND);
  });

  it('returns null for a missing or unparsable time rather than guessing', () => {
    expect(msUntil(null, NOW)).toBeNull();
    expect(msUntil(undefined, NOW)).toBeNull();
    expect(msUntil('', NOW)).toBeNull();
    expect(msUntil('not a date', NOW)).toBeNull();
  });

  it('floors a time that has already passed at zero, never negative', () => {
    expect(msUntil(isoAt(NOW - 5 * MINUTE), NOW)).toBe(0);
    expect(msUntil(isoAt(NOW), NOW)).toBe(0);
  });
});

describe('formatCountdown (the countdown card figure)', () => {
  it('reads MM:SS under an hour', () => {
    expect(formatCountdown(42 * SECOND)).toBe('00:42');
    expect(formatCountdown(59 * MINUTE + 59 * SECOND)).toBe('59:59');
  });

  it('switches to H:MM:SS from one hour up', () => {
    expect(formatCountdown(HOUR)).toBe('1:00:00');
    expect(formatCountdown(23 * HOUR + 59 * MINUTE + 59 * SECOND)).toBe('23:59:59');
  });

  it('rounds a partial second UP, so a pause still in force never reads 00:00', () => {
    expect(formatCountdown(200)).toBe('00:01');
    expect(formatCountdown(59 * MINUTE + 59 * SECOND + 1)).toBe('1:00:00');
  });

  it('reads 00:00 at exactly zero and for a negative remainder', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-5 * SECOND)).toBe('00:00');
  });
});

describe('formatCountdownCompact (the disabled Continue button figure)', () => {
  it('leaves minutes unpadded under an hour', () => {
    expect(formatCountdownCompact(42 * SECOND)).toBe('0:42');
    expect(formatCountdownCompact(12 * MINUTE + 5 * SECOND)).toBe('12:05');
  });

  it('reads H:MM:SS from one hour up', () => {
    expect(formatCountdownCompact(3 * HOUR + 12 * MINUTE + 5 * SECOND)).toBe('3:12:05');
  });

  it('rounds a partial second up, and reads 0:00 only at zero', () => {
    expect(formatCountdownCompact(200)).toBe('0:01');
    expect(formatCountdownCompact(0)).toBe('0:00');
  });
});

describe('remainingFraction (the draining bar)', () => {
  it('is the share of the starting window still to run', () => {
    expect(remainingFraction(30 * SECOND, 60 * SECOND)).toBe(0.5);
  });

  it('clamps to [0, 1]', () => {
    expect(remainingFraction(90 * SECOND, 60 * SECOND)).toBe(1);
    expect(remainingFraction(-1, 60 * SECOND)).toBe(0);
  });

  it('is 0 when the starting window is zero or negative, never NaN or Infinity', () => {
    expect(remainingFraction(10 * SECOND, 0)).toBe(0);
    expect(remainingFraction(10 * SECOND, -1)).toBe(0);
    expect(remainingFraction(0, 0)).toBe(0);
  });
});

describe('daysUntil', () => {
  it('rounds a partial day up', () => {
    expect(daysUntil(isoAt(NOW + 2 * DAY + HOUR), NOW)).toBe(3);
    expect(daysUntil(isoAt(NOW + 3 * DAY), NOW)).toBe(3);
  });

  it('never reads below 1 for any future time', () => {
    expect(daysUntil(isoAt(NOW + SECOND), NOW)).toBe(1);
    expect(daysUntil(isoAt(NOW + 1), NOW)).toBe(1);
  });

  it('returns null for a past, present, missing or unparsable time', () => {
    expect(daysUntil(isoAt(NOW - DAY), NOW)).toBeNull();
    expect(daysUntil(isoAt(NOW), NOW)).toBeNull();
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil(undefined, NOW)).toBeNull();
    expect(daysUntil('not a date', NOW)).toBeNull();
  });
});

describe('formatResetDate', () => {
  it('formats the reset as the device locale short day-and-month', () => {
    const iso = '2026-11-01T12:00:00.000Z';
    const expected = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(
      new Date(iso)
    );
    expect(formatResetDate(iso)).toBe(expected);
  });

  it('returns null for a missing or unparsable date rather than naming one', () => {
    expect(formatResetDate(null)).toBeNull();
    expect(formatResetDate(undefined)).toBeNull();
    expect(formatResetDate('')).toBeNull();
    expect(formatResetDate('not a date')).toBeNull();
  });
});
