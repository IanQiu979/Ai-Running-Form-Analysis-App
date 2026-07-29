/**
 * Locks `lib/first-run.ts`'s contract (spec 2026-07-26 §4, Phase 2 plan Task 2): a device-scoped,
 * once-per-install marker that must never throw, since a storage read failure must never trap a
 * user behind (or hide behind) the first-run intro.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { hasSeenFirstRun, markFirstRunSeen } from '../first-run';

describe('first-run marker', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('defaults to not-seen on a fresh install', async () => {
    expect(await hasSeenFirstRun()).toBe(false);
  });

  it('is seen after being marked', async () => {
    await markFirstRunSeen();
    expect(await hasSeenFirstRun()).toBe(true);
  });

  it('a corrupt or unreadable stored value fails safe to not-seen, never throws', async () => {
    await AsyncStorage.setItem('pace.firstRunSeen.v1', 'not-json-or-a-boolean');
    await expect(hasSeenFirstRun()).resolves.toBe(false);
  });
});
