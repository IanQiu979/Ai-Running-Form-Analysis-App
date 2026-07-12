/**
 * Classifies an Expo permission hook's response into the UI states the design brief and copy
 * deck actually name (issue #36): a soft-ask before the OS prompt, a denied state that always
 * offers a real recovery path, and granted. One pure function so
 * `app/capture/index.tsx` (photo library) and `app/capture/record.tsx` (camera) derive the same
 * states from the same rules instead of two independently hand-rolled `if` chains that could
 * drift — both screens' permissions come from Expo's shared `PermissionResponse` shape
 * (`expo-modules-core`, re-exported by both `expo-camera` and `expo-image-picker`).
 */
import type { PermissionResponse } from 'expo-modules-core';

export type MediaPermissionState =
  /** The hook's `get: true` default check hasn't resolved yet — `useXPermissions()` returns
   * `null` until then. */
  | 'checking'
  /** Never asked. Show the soft-ask panel (rationale + a button that calls `requestPermission`). */
  | 'undetermined'
  /** Denied — either just now or previously/externally revoked. Always offer a real way out:
   * `canAskAgain` decides whether that's another in-app prompt or the OS Settings app (see
   * `permissionRecoveryAction` below), never which COPY panel renders — the copy deck has one
   * "denied" panel per permission, not a second one for this distinction. */
  | 'denied'
  | 'granted';

export function classifyPermission(
  permission: PermissionResponse | null | undefined
): MediaPermissionState {
  if (!permission) return 'checking';
  if (permission.granted) return 'granted';
  if (permission.status === 'undetermined') return 'undetermined';
  return 'denied';
}

export type PermissionRecoveryAction = 'request' | 'settings';

/**
 * What the denied panel's CTA should DO when pressed — as distinct from what it says (the copy
 * deck fixes that string to "Open Settings" for both camera and library, so this only decides
 * behavior). iOS denies permanently on first refusal (`canAskAgain` is always `false` once
 * denied), so `'settings'` is the only reachable case on this issue's gated platform; Android
 * can leave `canAskAgain: true` after a first denial, where re-requesting in-app resolves it
 * without a context switch — still labelled "Open Settings" (the deck has no separate string for
 * this narrower, non-iOS case), but it does the more helpful thing rather than a mislabeled one.
 */
export function permissionRecoveryAction(
  permission: PermissionResponse | null | undefined
): PermissionRecoveryAction {
  return permission?.canAskAgain ? 'request' : 'settings';
}
