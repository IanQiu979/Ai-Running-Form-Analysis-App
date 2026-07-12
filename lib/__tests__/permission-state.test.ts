import type { PermissionResponse } from 'expo-modules-core';
import { PermissionStatus } from 'expo-modules-core';

import { classifyPermission, permissionRecoveryAction } from '../permission-state';

function response(overrides: Partial<PermissionResponse>): PermissionResponse {
  return {
    status: PermissionStatus.UNDETERMINED,
    expires: 'never',
    granted: false,
    canAskAgain: true,
    ...overrides,
  };
}

describe('classifyPermission', () => {
  it('is "checking" for null (the hook has not resolved its initial get() yet)', () => {
    expect(classifyPermission(null)).toBe('checking');
  });

  it('is "checking" for undefined', () => {
    expect(classifyPermission(undefined)).toBe('checking');
  });

  it('is "granted" whenever granted is true, regardless of status', () => {
    expect(classifyPermission(response({ granted: true, status: PermissionStatus.GRANTED }))).toBe(
      'granted'
    );
  });

  it('is "undetermined" when never asked', () => {
    expect(
      classifyPermission(response({ granted: false, status: PermissionStatus.UNDETERMINED }))
    ).toBe('undetermined');
  });

  it('is "denied" when refused', () => {
    expect(classifyPermission(response({ granted: false, status: PermissionStatus.DENIED }))).toBe(
      'denied'
    );
  });
});

describe('permissionRecoveryAction', () => {
  it('is "settings" once canAskAgain is false (iOS after any denial, or Android "don\'t ask again")', () => {
    expect(permissionRecoveryAction(response({ canAskAgain: false }))).toBe('settings');
  });

  it('is "request" when canAskAgain is still true (Android, first denial)', () => {
    expect(permissionRecoveryAction(response({ canAskAgain: true }))).toBe('request');
  });

  it('is "settings" for null/undefined — fails to the always-correct path', () => {
    expect(permissionRecoveryAction(null)).toBe('settings');
    expect(permissionRecoveryAction(undefined)).toBe('settings');
  });
});
