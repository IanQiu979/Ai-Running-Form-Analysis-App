import {
  clearSettingsSnapshot,
  getSettingsSnapshot,
  getSettingsSnapshotGeneration,
  updateSettingsSnapshot,
} from '../settings-cache';

const PRO_QUOTA = {
  tier: 'pro' as const,
  used: 2,
  limit: 5,
  remaining: 3,
  frameCap: 6,
  isLifetime: false,
  periodStart: '2026-09-12T00:00:00Z',
  periodEnd: '2026-10-12T00:00:00Z',
  blocked: false,
  blockedReason: null,
  blockedUntil: null,
};

const FREE_QUOTA = {
  ...PRO_QUOTA,
  tier: 'free' as const,
  used: 0,
  limit: 1,
  remaining: 1,
  frameCap: 1,
  isLifetime: true,
  periodStart: null,
  periodEnd: null,
};

afterEach(() => {
  clearSettingsSnapshot('user-a');
  clearSettingsSnapshot('user-b');
});

describe('settings cache', () => {
  it('keeps each user\'s snapshot private to that user', () => {
    updateSettingsSnapshot('user-a', { plan: PRO_QUOTA, consent: 'granted' });
    updateSettingsSnapshot('user-b', { plan: FREE_QUOTA, consent: 'withdrawn' });

    expect(getSettingsSnapshot('user-a')).toEqual({ plan: PRO_QUOTA, consent: 'granted' });
    expect(getSettingsSnapshot('user-b')).toEqual({ plan: FREE_QUOTA, consent: 'withdrawn' });
  });

  it('merges a partial update without discarding the other cached setting', () => {
    updateSettingsSnapshot('user-a', { plan: PRO_QUOTA, consent: 'granted' });

    expect(updateSettingsSnapshot('user-a', { consent: 'withdrawn' })).toBe(true);
    expect(getSettingsSnapshot('user-a')).toEqual({ plan: PRO_QUOTA, consent: 'withdrawn' });
  });

  it('reports false when a partial update leaves the snapshot unchanged', () => {
    updateSettingsSnapshot('user-a', { plan: PRO_QUOTA, consent: 'granted' });

    expect(updateSettingsSnapshot('user-a', { plan: { ...PRO_QUOTA } })).toBe(false);
    expect(updateSettingsSnapshot('user-a', { consent: 'granted' })).toBe(false);
  });

  it('removes a user\'s snapshot without touching another user', () => {
    updateSettingsSnapshot('user-a', { plan: PRO_QUOTA });
    updateSettingsSnapshot('user-b', { consent: 'granted' });

    clearSettingsSnapshot('user-a');

    expect(getSettingsSnapshot('user-a')).toBeUndefined();
    expect(getSettingsSnapshot('user-b')).toEqual({ consent: 'granted' });
  });

  it('rejects a stale guarded update after clearing the user snapshot', () => {
    const generationBeforeClear = getSettingsSnapshotGeneration('user-a');
    updateSettingsSnapshot('user-a', { plan: PRO_QUOTA });

    clearSettingsSnapshot('user-a');

    expect(getSettingsSnapshotGeneration('user-a')).toBe(generationBeforeClear + 1);
    expect(updateSettingsSnapshot('user-a', { consent: 'granted' }, generationBeforeClear)).toBe(false);
    expect(getSettingsSnapshot('user-a')).toBeUndefined();
  });

  it('allows an unguarded update after clear for a confirmed local setting change', () => {
    updateSettingsSnapshot('user-a', { plan: PRO_QUOTA });
    clearSettingsSnapshot('user-a');

    expect(updateSettingsSnapshot('user-a', { consent: 'withdrawn' })).toBe(true);
    expect(getSettingsSnapshot('user-a')).toEqual({ consent: 'withdrawn' });
  });
});
