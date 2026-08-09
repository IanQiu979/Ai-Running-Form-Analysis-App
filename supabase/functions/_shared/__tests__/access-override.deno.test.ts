import {
  ALL_USERS_UNLIMITED_ACCESS_ENV,
  isAllUsersUnlimitedAccess,
} from '../access-override.ts';

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
}

Deno.test('ALL_USERS_UNLIMITED_ACCESS uses the documented, easy-to-find env name', () => {
  assertEquals(ALL_USERS_UNLIMITED_ACCESS_ENV, 'ALL_USERS_UNLIMITED_ACCESS');
});

Deno.test('all-users override is strict opt-in and case/whitespace tolerant', () => {
  for (const enabled of ['true', 'TRUE', '  True  ']) {
    assertEquals(isAllUsersUnlimitedAccess(enabled), true);
  }
  for (const disabled of [undefined, '', 'false', '1', 'yes', 'tru']) {
    assertEquals(isAllUsersUnlimitedAccess(disabled), false);
  }
});
