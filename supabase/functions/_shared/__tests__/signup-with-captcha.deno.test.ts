/**
 * Regression locks for `_shared/signup-with-captcha.ts` — `POST /functions/v1/
 * signup-with-captcha` (issue #12/Known Issue #12), the Turnstile-gated replacement for calling
 * `supabase.auth.signUp()` directly. See that file's header for why this exists instead of
 * Supabase Auth's native `auth.captcha` (verified live to be project-wide, breaking sign-in too).
 *
 * Both dependencies (`CaptchaVerifier`, `SignUpClient`) are injected fakes here — no network, no
 * real `supabase-js` client, no `Deno.env`. `_shared/captcha.ts`'s `TurnstileVerifier` (the real
 * Cloudflare-calling implementation) and `_shared/signup-client.ts`'s `createSignUpClient` (the
 * real `supabase-js` proxy) are exercised only by the live app, not here — same reasoning
 * `purchase-tier.deno.test.ts` gives for testing `purchaseTier()` against a `FakeRpcClient`
 * rather than a live Postgres.
 *
 * DENO-ONLY, DELIBERATELY (issue #90 convention): named `.deno.test.ts` so `jest.config.js`'s
 * `testPathIgnorePatterns` skips it and only `deno test` (`npm run test:edge`) runs it.
 */
import {
  handleSignupWithCaptcha,
  parseSignupRequest,
  type CaptchaVerifier,
  type SignUpClient,
  type SignUpOutcome,
} from '../signup-with-captcha.ts';

function assertEquals(actual: unknown, expected: unknown, message?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(message ?? `Expected ${e}, got ${a}`);
  }
}

function assertTrue(value: boolean, message: string): void {
  if (!value) throw new Error(message);
}

class FakeCaptchaVerifier implements CaptchaVerifier {
  calls: Array<{ token: string; remoteIp: string | null }> = [];
  constructor(private result: boolean) {}
  verify(token: string, remoteIp: string | null): Promise<boolean> {
    this.calls.push({ token, remoteIp });
    return Promise.resolve(this.result);
  }
}

class FakeSignUpClient implements SignUpClient {
  calls: Array<{ email: string; password: string }> = [];
  constructor(private result: SignUpOutcome) {}
  signUp(email: string, password: string): Promise<SignUpOutcome> {
    this.calls.push({ email, password });
    return Promise.resolve(this.result);
  }
}

const VALID_BODY = { email: 'runner@example.com', password: 'aRealStrongPassw0rd!9x', captchaToken: 'tok-123' };

const SUCCESS_OUTCOME: SignUpOutcome = {
  outcome: 'created',
  session: {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresIn: 3600,
    expiresAt: 1893456000,
    tokenType: 'bearer',
  },
  user: { id: 'user-1', email: 'runner@example.com' },
};

// ---------------------------------------------------------------------------
// 1. Request validation
// ---------------------------------------------------------------------------

Deno.test('parseSignupRequest rejects a non-object body', () => {
  const result = parseSignupRequest('not an object');
  assertTrue(!result.ok, 'expected rejection');
  if (!result.ok) assertEquals(result.code, 'invalid_body');
});

Deno.test('parseSignupRequest rejects missing captchaToken', () => {
  const result = parseSignupRequest({ email: 'a@example.com', password: 'password123' });
  assertTrue(!result.ok, 'expected rejection');
  if (!result.ok) assertEquals(result.code, 'invalid_body');
});

Deno.test('parseSignupRequest rejects an empty-string field', () => {
  const result = parseSignupRequest({ email: '', password: 'password123', captchaToken: 'tok' });
  assertTrue(!result.ok, 'expected rejection');
});

Deno.test('parseSignupRequest trims email and captchaToken but not password', () => {
  const result = parseSignupRequest({
    email: '  runner@example.com  ',
    password: 'password123',
    captchaToken: '  tok-123  ',
  });
  assertTrue(result.ok, 'expected success');
  if (result.ok) {
    assertEquals(result.request.email, 'runner@example.com');
    assertEquals(result.request.captchaToken, 'tok-123');
    assertEquals(result.request.password, 'password123');
  }
});

// ---------------------------------------------------------------------------
// 2. handleSignupWithCaptcha — the gate itself
// ---------------------------------------------------------------------------

Deno.test('handleSignupWithCaptcha: invalid body never reaches the captcha check', async () => {
  const captcha = new FakeCaptchaVerifier(true);
  const signUp = new FakeSignUpClient(SUCCESS_OUTCOME);
  const result = await handleSignupWithCaptcha({ captchaVerifier: captcha, signUpClient: signUp }, {}, null);
  assertEquals(result.status, 400);
  if (result.status !== 200) assertEquals(result.body.code, 'invalid_body');
  assertEquals(captcha.calls.length, 0, 'captcha must not be checked for a malformed body');
  assertEquals(signUp.calls.length, 0, 'signUp must not be called for a malformed body');
});

Deno.test('handleSignupWithCaptcha: a failed captcha check blocks signup entirely — this is the whole point', async () => {
  const captcha = new FakeCaptchaVerifier(false);
  const signUp = new FakeSignUpClient(SUCCESS_OUTCOME);
  const result = await handleSignupWithCaptcha({ captchaVerifier: captcha, signUpClient: signUp }, VALID_BODY, '1.2.3.4');
  assertEquals(result.status, 400);
  if (result.status !== 200) assertEquals(result.body.code, 'captcha_invalid');
  assertEquals(captcha.calls.length, 1);
  assertEquals(captcha.calls[0], { token: 'tok-123', remoteIp: '1.2.3.4' });
  assertEquals(signUp.calls.length, 0, 'signUp must never be called once the captcha check fails');
});

Deno.test('handleSignupWithCaptcha: a passed captcha check proceeds to signUp and returns the session', async () => {
  const captcha = new FakeCaptchaVerifier(true);
  const signUp = new FakeSignUpClient(SUCCESS_OUTCOME);
  const result = await handleSignupWithCaptcha({ captchaVerifier: captcha, signUpClient: signUp }, VALID_BODY, null);
  assertEquals(result.status, 200);
  assertEquals(signUp.calls.length, 1);
  assertEquals(signUp.calls[0], { email: 'runner@example.com', password: 'aRealStrongPassw0rd!9x' });
  if (result.status === 200) {
    assertEquals(result.body.session?.accessToken, 'access-token');
    assertEquals(result.body.user.id, 'user-1');
  }
});

Deno.test('handleSignupWithCaptcha: email already registered maps to email_in_use, 400', async () => {
  const captcha = new FakeCaptchaVerifier(true);
  const signUp = new FakeSignUpClient({ outcome: 'email_in_use' });
  const result = await handleSignupWithCaptcha({ captchaVerifier: captcha, signUpClient: signUp }, VALID_BODY, null);
  assertEquals(result.status, 400);
  if (result.status !== 200) assertEquals(result.body.code, 'email_in_use');
});

Deno.test('handleSignupWithCaptcha: a breached-only password maps to weak_password_pwned, 400', async () => {
  const captcha = new FakeCaptchaVerifier(true);
  const signUp = new FakeSignUpClient({
    outcome: 'weak_password',
    message: 'Password is known to be weak and easy to guess, please choose a different one.',
    reasons: ['pwned'],
  });
  const result = await handleSignupWithCaptcha({ captchaVerifier: captcha, signUpClient: signUp }, VALID_BODY, null);
  assertEquals(result.status, 400);
  if (result.status !== 200) assertEquals(result.body.code, 'weak_password_pwned');
});

Deno.test('handleSignupWithCaptcha: a too-short-only password maps to weak_password_length, 400', async () => {
  const captcha = new FakeCaptchaVerifier(true);
  const signUp = new FakeSignUpClient({
    outcome: 'weak_password',
    message: 'Password should be at least 8 characters.',
    reasons: ['length'],
  });
  const result = await handleSignupWithCaptcha({ captchaVerifier: captcha, signUpClient: signUp }, VALID_BODY, null);
  assertEquals(result.status, 400);
  if (result.status !== 200) assertEquals(result.body.code, 'weak_password_length');
});

Deno.test('handleSignupWithCaptcha: a password that is both too short AND breached prioritizes weak_password_length', async () => {
  const captcha = new FakeCaptchaVerifier(true);
  const signUp = new FakeSignUpClient({
    outcome: 'weak_password',
    message: 'Password should be at least 8 characters, and is known to be weak.',
    reasons: ['length', 'pwned'],
  });
  const result = await handleSignupWithCaptcha({ captchaVerifier: captcha, signUpClient: signUp }, VALID_BODY, null);
  assertEquals(result.status, 400);
  if (result.status !== 200) assertEquals(result.body.code, 'weak_password_length');
});

Deno.test('handleSignupWithCaptcha: created_no_session fails safe with a 500, never a bare 200', async () => {
  const captcha = new FakeCaptchaVerifier(true);
  const signUp = new FakeSignUpClient({ outcome: 'created_no_session', user: { id: 'user-1', email: null } });
  const result = await handleSignupWithCaptcha({ captchaVerifier: captcha, signUpClient: signUp }, VALID_BODY, null);
  assertEquals(result.status, 500);
  if (result.status !== 200) assertEquals(result.body.code, 'no_session');
});

Deno.test('handleSignupWithCaptcha: an unexpected signUp error maps to signup_failed, 400', async () => {
  const captcha = new FakeCaptchaVerifier(true);
  const signUp = new FakeSignUpClient({ outcome: 'error', message: 'Something odd', code: null });
  const result = await handleSignupWithCaptcha({ captchaVerifier: captcha, signUpClient: signUp }, VALID_BODY, null);
  assertEquals(result.status, 400);
  if (result.status !== 200) assertEquals(result.body.code, 'signup_failed');
});
