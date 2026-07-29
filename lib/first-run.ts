/**
 * The first-run intro's once-per-install marker (Phase 2 plan Task 2, spec 2026-07-26 §4).
 *
 * STORAGE CHOICE: plain `AsyncStorage`, not `lib/consent.ts`'s server-backed, account-scoped
 * model. The first-run intro is a fact about THIS DEVICE INSTALL, not this account — it must not
 * gate sign-in, so it has to resolve before any session exists. Same reasoning
 * `lib/pending-analysis.ts`'s header already gives for its own marker: a plain, non-secret,
 * device-scoped flag that only needs to survive a process restart.
 *
 * The version lives in the key (`consent.ts`'s own convention) so a future content change to the
 * intro can re-show it by minting `pace.firstRunSeen.v2`, without a migration.
 *
 * `hasSeenFirstRun` never throws. A read failure or a corrupt stored value both resolve to
 * `false` (fail safe to "show it") — worst case a returning user sees the intro once more, which
 * is a far smaller cost than a thrown error blocking the first screen the app ever shows.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const FIRST_RUN_SEEN_KEY = 'pace.firstRunSeen.v1';

export async function hasSeenFirstRun(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(FIRST_RUN_SEEN_KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function markFirstRunSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(FIRST_RUN_SEEN_KEY, 'true');
  } catch {
    // Best-effort only: if this write fails, the intro may show again next cold start — the
    // failure mode this whole module accepts rather than ever throwing into a caller that isn't
    // expecting to handle it (see this file's header).
  }
}
