/**
 * Regression locks for `_shared/signup-client.ts` — the admin-API account-creation path behind
 * `signup-with-captcha` (issue #48 residual, 2026-09-19). The two `supabase-js` surfaces it uses
 * (`auth.admin.createUser` on the secret key, `auth.signInWithPassword` on the publishable key)
 * are injected as a fake here, so what is proven is the ORDER of the calls, the arguments each
 * receives, and the mapping from GoTrue's answers to `SignUpOutcome` — not the network.
 *
 * DENO-ONLY, DELIBERATELY (issue #90 convention): named `.deno.test.ts` so `jest.config.js`'s
 * `testPathIgnorePatterns` skips it and only `deno test` (`npm run test:edge`) runs it. Importing
 * the module pulls `npm:@supabase/supabase-js`, which is why it cannot be a Jest test.
 */
import {
  createSignUpClient,
  type AuthErrorLike,
  type SessionLike,
  type SignUpAuthSurface,
} from '../signup-client.ts';

function assertEquals(actual: unknown, expected: unknown, message?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(message ?? `Expected ${e}, got ${a}`);
  }
}

const EMAIL = 'runner@example.com';
const PASSWORD = 'aRealStrongPassw0rd!9x';
const USER = { id: 'user-1', email: EMAIL };
const SESSION: SessionLike = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_in: 3600,
  expires_at: 1893456000,
  token_type: 'bearer',
  user: USER,
};

class FakeAuth implements SignUpAuthSurface {
  calls: string[] = [];
  createUserArgs: unknown[] = [];
  signInArgs: unknown[] = [];

  constructor(
    private createUserResult: { user: typeof USER | null; error: AuthErrorLike | null },
    private signInResult: { session: SessionLike | null; error: AuthErrorLike | null } = {
      session: SESSION,
      error: null,
    },
  ) {}

  createUser(params: { email: string; password: string; email_confirm: boolean }) {
    this.calls.push('createUser');
    this.createUserArgs.push(params);
    return Promise.resolve({
      data: { user: this.createUserResult.user },
      error: this.createUserResult.error,
    });
  }

  signInWithPassword(params: { email: string; password: string }) {
    this.calls.push('signInWithPassword');
    this.signInArgs.push(params);
    return Promise.resolve({
      data: { session: this.signInResult.session },
      error: this.signInResult.error,
    });
  }

  deleteUserResult: { error: AuthErrorLike | null } = { error: null };
  deletedUserIds: string[] = [];
  deleteUser(userId: string) {
    this.calls.push('deleteUser');
    this.deletedUserIds.push(userId);
    return Promise.resolve(this.deleteUserResult);
  }
}

Deno.test('signup-client: creates through the admin API, confirmed, then signs in for a session', async () => {
  const auth = new FakeAuth({ user: USER, error: null });
  const outcome = await createSignUpClient(auth).signUp(EMAIL, PASSWORD);

  assertEquals(auth.calls, ['createUser', 'signInWithPassword']);
  // `email_confirm: true` is load-bearing: the admin API ignores `mailer_autoconfirm`, and an
  // unconfirmed user cannot sign in with a password.
  assertEquals(auth.createUserArgs, [{ email: EMAIL, password: PASSWORD, email_confirm: true }]);
  assertEquals(auth.signInArgs, [{ email: EMAIL, password: PASSWORD }]);
  assertEquals(outcome, {
    outcome: 'created',
    session: {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 3600,
      expiresAt: 1893456000,
      tokenType: 'bearer',
    },
    user: USER,
  });
});

Deno.test('signup-client: a missing expires_at becomes null, not undefined', async () => {
  const { expires_at: _dropped, ...withoutExpiry } = SESSION;
  const auth = new FakeAuth({ user: USER, error: null }, { session: withoutExpiry, error: null });
  const outcome = await createSignUpClient(auth).signUp(EMAIL, PASSWORD);
  if (outcome.outcome !== 'created') throw new Error(`expected created, got ${outcome.outcome}`);
  assertEquals(outcome.session.expiresAt, null);
});

Deno.test('signup-client: email_exists maps to email_in_use and never attempts a sign-in', async () => {
  const auth = new FakeAuth({
    user: null,
    error: { message: 'A user with this email address has already been registered', code: 'email_exists', status: 422 },
  });
  const outcome = await createSignUpClient(auth).signUp(EMAIL, PASSWORD);
  assertEquals(outcome, { outcome: 'email_in_use' });
  // Signing in with an attacker-supplied password against an existing account would turn this
  // route into a password oracle; the sign-in must only ever follow a creation.
  assertEquals(auth.calls, ['createUser']);
});

Deno.test('signup-client: a weak-password error keeps its reasons array', async () => {
  const auth = new FakeAuth({
    user: null,
    error: {
      message: 'Password should be at least 8 characters.',
      code: 'weak_password',
      status: 422,
      reasons: ['length', 'pwned'],
    },
  });
  const outcome = await createSignUpClient(auth).signUp(EMAIL, PASSWORD);
  assertEquals(outcome, {
    outcome: 'weak_password',
    message: 'Password should be at least 8 characters.',
    reasons: ['length', 'pwned'],
  });
  assertEquals(auth.calls, ['createUser']);
});

Deno.test('signup-client: a weak_password code WITHOUT a reasons array is a plain error', async () => {
  const auth = new FakeAuth({
    user: null,
    error: { message: 'weak', code: 'weak_password', status: 422, reasons: 'length' },
  });
  const outcome = await createSignUpClient(auth).signUp(EMAIL, PASSWORD);
  assertEquals(outcome, { outcome: 'error', message: 'weak', code: 'weak_password' });
});

Deno.test('signup-client: any other creation error is surfaced with its code, null when absent', async () => {
  const withCode = new FakeAuth({
    user: null,
    error: { message: 'Unable to validate email address: invalid format', code: 'validation_failed', status: 400 },
  });
  assertEquals(await createSignUpClient(withCode).signUp('not-an-email', PASSWORD), {
    outcome: 'error',
    message: 'Unable to validate email address: invalid format',
    code: 'validation_failed',
  });

  const withoutCode = new FakeAuth({ user: null, error: { message: 'boom' } });
  assertEquals(await createSignUpClient(withoutCode).signUp(EMAIL, PASSWORD), {
    outcome: 'error',
    message: 'boom',
    code: null,
  });
});

Deno.test('signup-client: created but sign-in failed is created_no_session with the new user', async () => {
  const auth = new FakeAuth(
    { user: USER, error: null },
    { session: null, error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 } },
  );
  const outcome = await createSignUpClient(auth).signUp(EMAIL, PASSWORD);
  assertEquals(outcome, { outcome: 'created_no_session', user: USER });
  assertEquals(auth.calls, ['createUser', 'signInWithPassword']);
});

Deno.test('signup-client: created but sign-in returned no session and no error is created_no_session', async () => {
  const auth = new FakeAuth({ user: USER, error: null }, { session: null, error: null });
  const outcome = await createSignUpClient(auth).signUp(EMAIL, PASSWORD);
  assertEquals(outcome, { outcome: 'created_no_session', user: USER });
});

Deno.test('signup-client: deleteUser (the age-band rollback) calls the admin API and treats user_not_found as done', async () => {
  const auth = new FakeAuth({ user: USER, error: null });
  await createSignUpClient(auth).deleteUser(USER.id);
  assertEquals(auth.deletedUserIds, [USER.id]);

  auth.deleteUserResult = { error: { message: 'User not found', code: 'user_not_found', status: 404 } };
  await createSignUpClient(auth).deleteUser(USER.id); // resolves: nothing left to roll back

  auth.deleteUserResult = { error: { message: 'Database error', code: 'unexpected_failure', status: 500 } };
  let threw = false;
  try {
    await createSignUpClient(auth).deleteUser(USER.id);
  } catch (err) {
    threw = (err as Error).message.includes('Database error');
  }
  assertEquals(threw, true, 'any other admin error propagates so the handler can log it');
});

Deno.test('signup-client: a successful create that returns no user id is refused before sign-in, never carried as an empty id', async () => {
  const auth = new FakeAuth({ user: null, error: null });
  const outcome = await createSignUpClient(auth).signUp(EMAIL, PASSWORD);
  assertEquals(outcome, { outcome: 'error', message: 'Account creation returned no user id.', code: 'no_user_id' });
  assertEquals(auth.calls, ['createUser']);
});
