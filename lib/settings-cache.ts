import type { ConsentState } from './consent';
import type { QuotaStatus } from './subscription';

export type SettingsSnapshot = {
  plan?: QuotaStatus;
  consent?: ConsentState;
};

const snapshots = new Map<string, SettingsSnapshot>();
const generations = new Map<string, number>();

function quotaStatusEquals(left: QuotaStatus, right: QuotaStatus): boolean {
  return (
    left.tier === right.tier &&
    left.used === right.used &&
    left.limit === right.limit &&
    left.remaining === right.remaining &&
    left.frameCap === right.frameCap &&
    left.isLifetime === right.isLifetime &&
    left.periodStart === right.periodStart &&
    left.periodEnd === right.periodEnd &&
    left.blocked === right.blocked &&
    left.blockedReason === right.blockedReason &&
    left.blockedUntil === right.blockedUntil
  );
}

export function getSettingsSnapshot(userId: string): SettingsSnapshot | undefined {
  return snapshots.get(userId);
}

export function getSettingsSnapshotGeneration(userId: string): number {
  return generations.get(userId) ?? 0;
}

export function updateSettingsSnapshot(
  userId: string,
  partial: Partial<SettingsSnapshot>,
  expectedGeneration?: number
): boolean {
  if (expectedGeneration !== undefined && expectedGeneration !== getSettingsSnapshotGeneration(userId)) return false;

  const current = snapshots.get(userId);
  const planChanged =
    partial.plan !== undefined && (current?.plan === undefined || !quotaStatusEquals(current.plan, partial.plan));
  const consentChanged = partial.consent !== undefined && current?.consent !== partial.consent;

  if (!planChanged && !consentChanged) return false;

  snapshots.set(userId, { ...current, ...partial });
  return true;
}

export function clearSettingsSnapshot(userId: string): void {
  snapshots.delete(userId);
  generations.set(userId, getSettingsSnapshotGeneration(userId) + 1);
}
