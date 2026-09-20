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
import type { AgeBandChoice } from '../age-band.ts';
import type { AgeBandRecorder, RecordAgeBandOutcome } from '../age-band-recorder.ts';
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
  deletedUserIds: string[] = [];
  constructor(private result: SignUpOutcome) {}
  signUp(email: string, password: string): Promise<SignUpOutcome> {
    this.calls.push({ email, password });
    return Promise.resolve(this.result);
  }
  deleteUser(userId: string): Promise<void> {
    this.deletedUserIds.push(userId);
    return Promise.resolve();
  }
}

/** The age-band write, faked. Records every call so a test can prove what was persisted (or not). */
class FakeAgeBandRecorder implements AgeBandRecorder {
  calls: Array<{ userId: string; choice: AgeBandChoice }> = [];
  constructor(private result: RecordAgeBandOutcome = { outcome: 'recorded' }) {}
  record(userId: string, choice: AgeBandChoice): Promise<RecordAgeBandOutcome> {
    this.calls.push({ userId, choice });
    return Promise.resolve(this.result);
  }
}

/** Every handler test injects the three deps; the recorder defaults to "it worked". */
function deps(captcha: CaptchaVerifier, signUp: SignUpClient, recorder: AgeBandRecorder = new FakeAgeBandRecorder()) {
  return { captchaVerifier: captcha, signUpClient: signUp, ageBandRecorder: recorder };
}

// An adult sign-up is the baseline body; the 13–17 arms below spell out their own.
const VALID_BODY = {
  email: 'runner@example.com',
  password: 'aRealStrongPassw0rd!9x',
  captchaToken: 'tok-123',
  ageBand: '18_plus',
};
const MINOR_BODY = { ...VALID_BODY, ageBand: '13_17', guardianConsent: true };

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
    ageBand: '18_plus',
  });
  assertTrue(result.ok, 'expected success');
  if (result.ok) {
    assertEquals(result.request.email, 'runner@example.com');
    assertEquals(result.request.captchaToken, 'tok-123');
    assertEquals(result.request.password, 'password123');
    assertEquals(result.request.ageChoice, { ageBand: '18_plus', guardianConsent: false });
  }
});

// ---------------------------------------------------------------------------
// 1b. The age choice (2026-09-20) — the three refusals, all before the CAPTCHA is spent
// ---------------------------------------------------------------------------

Deno.test('parseSignupRequest refuses a body with no ageBand as age_band_required', () => {
  const { ageBand: _omitted, ...withoutBand } = VALID_BODY;
  const result = parseSignupRequest(withoutBand);
  assertTrue(!result.ok, 'expected rejection');
  if (!result.ok) assertEquals(result.code, 'age_band_required');
});

Deno.test('parseSignupRequest refuses an unrecognised band (under 13 is not offered) as age_band_required', () => {
  for (const ageBand of ['under_13', '16_plus', 18, '', null]) {
    const result = parseSignupRequest({ ...VALID_BODY, ageBand });
    assertTrue(!result.ok, `expected rejection for ${JSON.stringify(ageBand)}`);
    if (!result.ok) assertEquals(result.code, 'age_band_required');
  }
});

Deno.test('parseSignupRequest refuses 13_17 without the guardian attestation as guardian_consent_required', () => {
  for (const guardianConsent of [undefined, false, 'true', 1, null]) {
    const result = parseSignupRequest({ ...VALID_BODY, ageBand: '13_17', guardianConsent });
    assertTrue(!result.ok, `expected rejection for guardianConsent=${JSON.stringify(guardianConsent)}`);
    if (!result.ok) assertEquals(result.code, 'guardian_consent_required');
  }
});

Deno.test('parseSignupRequest accepts 13_17 with guardianConsent: true', () => {
  const result = parseSignupRequest(MINOR_BODY);
  assertTrue(result.ok, 'expected success');
  if (result.ok) assertEquals(result.request.ageChoice, { ageBand: '13_17', guardianConsent: true });
});

Deno.test('parseSignupRequest ignores a stray guardianConsent on an 18_plus body', () => {
  const result = parseSignupRequest({ ...VALID_BODY, guardianConsent: true });
  assertTrue(result.ok, 'expected success');
  if (result.ok) assertEquals(result.request.ageChoice.guardianConsent, false);
});

Deno.test('handleSignupWithCaptcha: an age refusal is a 400 by name and never spends the captcha token', async () => {
  for (const [body, code] of [
    [{ ...VALID_BODY, ageBand: undefined }, 'age_band_required'],
    [{ ...VALID_BODY, ageBand: 'under_13' }, 'age_band_required'],
    [{ ...VALID_BODY, ageBand: '13_17' }, 'guardian_consent_required'],
  ] as const) {
    const captcha = new FakeCaptchaVerifier(true);
    const signUp = new FakeSignUpClient(SUCCESS_OUTCOME);
    const recorder = new FakeAgeBandRecorder();
    const result = await handleSignupWithCaptcha(deps(captcha, signUp, recorder), body, null);
    assertEquals(result.status, 400);
    if (result.status !== 200) assertEquals(result.body.code, code);
    assertEquals(captcha.calls.length, 0, 'the token must survive an age refusal');
    assertEquals(signUp.calls.length, 0);
    assertEquals(recorder.calls.length, 0);
  }
});

Deno.test('handleSignupWithCaptcha: an 18_plus sign-up records the band (no consent) before returning the session', async () => {
  const captcha = new FakeCaptchaVerifier(true);
  const signUp = new FakeSignUpClient(SUCCESS_OUTCOME);
  const recorder = new FakeAgeBandRecorder();
  const result = await handleSignupWithCaptcha(deps(captcha, signUp, recorder), VALID_BODY, null);
  assertEquals(result.status, 200);
  assertEquals(recorder.calls, [{ userId: 'user-1', choice: { ageBand: '18_plus', guardianConsent: false } }]);
  assertEquals(signUp.deletedUserIds, []);
});

Deno.test('handleSignupWithCaptcha: a 13_17 sign-up with the attestation records the band AND the consent', async () => {
  const captcha = new FakeCaptchaVerifier(true);
  const signUp = new FakeSignUpClient(SUCCESS_OUTCOME);
  const recorder = new FakeAgeBandRecorder();
  const result = await handleSignupWithCaptcha(deps(captcha, signUp, recorder), MINOR_BODY, null);
  assertEquals(result.status, 200);
  if (result.status === 200) assertEquals(result.body.session?.accessToken, 'access-token');
  assertEquals(recorder.calls, [{ userId: 'user-1', choice: { ageBand: '13_17', guardianConsent: true } }]);
});

Deno.test('handleSignupWithCaptcha: the band is recorded on the sessionless success too', async () => {
  const captcha = new FakeCaptchaVerifier(true);
  const signUp = new FakeSignUpClient({ outcome: 'created_no_session', user: { id: 'user-9', email: null } });
  const recorder = new FakeAgeBandRecorder();
  const result = await handleSignupWithCaptcha(deps(captcha, signUp, recorder), VALID_BODY, null);
  assertEquals(result.status, 500);
  if (result.status !== 200) assertEquals(result.body.code, 'no_session');
  assertEquals(recorder.calls.map((c) => c.userId), ['user-9']);
});

Deno.test('handleSignupWithCaptcha: a failed band write rolls the account back and fails the whole attempt', async () => {
  for (const outcome of [
    { outcome: 'unavailable', message: 'function pace_record_age_band does not exist' },
    { outcome: 'refused', code: 'profile_not_found' },
  ] as const) {
    const captcha = new FakeCaptchaVerifier(true);
    const signUp = new FakeSignUpClient(SUCCESS_OUTCOME);
    const recorder = new FakeAgeBandRecorder(outcome);
    const result = await handleSignupWithCaptcha(deps(captcha, signUp, recorder), MINOR_BODY, null);
    assertEquals(result.status, 500);
    if (result.status !== 200) assertEquals(result.body.code, 'age_band_record_failed');
    assertEquals(signUp.deletedUserIds, ['user-1'], 'the bandless account must not survive');
  }
});

Deno.test('handleSignupWithCaptcha: a rollback that itself fails still returns age_band_record_failed, and names the stranded account', async () => {
  const captcha = new FakeCaptchaVerifier(true);
  const signUp = new FakeSignUpClient(SUCCESS_OUTCOME);
  signUp.deleteUser = () => Promise.reject(new Error('admin API down'));
  const recorder = new FakeAgeBandRecorder({ outcome: 'unavailable', message: 'boom' });
  const failures: unknown[] = [];
  const result = await handleSignupWithCaptcha(
    { ...deps(captcha, signUp, recorder), onAgeBandWriteFailed: (f) => { failures.push(f); } },
    VALID_BODY,
    null,
  );
  assertEquals(result.status, 500);
  if (result.status !== 200) assertEquals(result.body.code, 'age_band_record_failed');
  assertEquals(failures, [{ userId: 'user-1', reason: 'boom', rolledBack: false }]);
});

Deno.test('handleSignupWithCaptcha: a successful rollback is reported as rolled back, with the refusal code as the reason', async () => {
  const captcha = new FakeCaptchaVerifier(true);
  const signUp = new FakeSignUpClient(SUCCESS_OUTCOME);
  const recorder = new FakeAgeBandRecorder({ outcome: 'refused', code: 'profile_not_found' });
  const failures: unknown[] = [];
  await handleSignupWithCaptcha(
    { ...deps(captcha, signUp, recorder), onAgeBandWriteFailed: (f) => { failures.push(f); } },
    VALID_BODY,
    null,
  );
  assertEquals(failures, [{ userId: 'user-1', reason: 'profile_not_found', rolledBack: true }]);
});

Deno.test('handleSignupWithCaptcha: an async failure hook settles before the 500 is returned', async () => {
  const captcha = new FakeCaptchaVerifier(true);
  const signUp = new FakeSignUpClient(SUCCESS_OUTCOME);
  const recorder = new FakeAgeBandRecorder({ outcome: 'unavailable', message: 'boom' });
  const order: string[] = [];
  const result = await handleSignupWithCaptcha(
    {
      ...deps(captcha, signUp, recorder),
      onAgeBandWriteFailed: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push('logged');
      },
    },
    VALID_BODY,
    null,
  );
  order.push('returned');
  assertEquals(result.status, 500);
  assertEquals(order, ['logged', 'returned']);
});

Deno.test('handleSignupWithCaptcha: a failure hook that rejects does not mask the 500', async () => {
  const captcha = new FakeCaptchaVerifier(true);
  const signUp = new FakeSignUpClient(SUCCESS_OUTCOME);
  const recorder = new FakeAgeBandRecorder({ outcome: 'unavailable', message: 'boom' });
  const result = await handleSignupWithCaptcha(
    { ...deps(captcha, signUp, recorder), onAgeBandWriteFailed: () => Promise.reject(new Error('log sink down')) },
    VALID_BODY,
    null,
  );
  assertEquals(result.status, 500);
  if (result.status !== 200) assertEquals(result.body.code, 'age_band_record_failed');
  assertEquals(signUp.deletedUserIds, ['user-1']);
});

Deno.test('handleSignupWithCaptcha: a band that is somehow already on file is accepted, not rolled back', async () => {
  const captcha = new FakeCaptchaVerifier(true);
  const signUp = new FakeSignUpClient(SUCCESS_OUTCOME);
  const recorder = new FakeAgeBandRecorder({ outcome: 'already_recorded' });
  const result = await handleSignupWithCaptcha(deps(captcha, signUp, recorder), VALID_BODY, null);
  assertEquals(result.status, 200);
  assertEquals(signUp.deletedUserIds, []);
});

Deno.test('handleSignupWithCaptcha: a failed captcha never reaches the band write', async () => {
  const captcha = new FakeCaptchaVerifier(false);
  const signUp = new FakeSignUpClient(SUCCESS_OUTCOME);
  const recorder = new FakeAgeBandRecorder();
  const result = await handleSignupWithCaptcha(deps(captcha, signUp, recorder), MINOR_BODY, null);
  assertEquals(result.status, 400);
  assertEquals(recorder.calls.length, 0);
});

// ---------------------------------------------------------------------------
// 2. handleSignupWithCaptcha — the gate itself
// ---------------------------------------------------------------------------

Deno.test('handleSignupWithCaptcha: invalid body never reaches the captcha check', async () => {
  const captcha = new FakeCaptchaVerifier(true);
  const signUp = new FakeSignUpClient(SUCCESS_OUTCOME);
  const result = await handleSignupWithCaptcha(deps(captcha, signUp), {}, null);
  assertEquals(result.status, 400);
  if (result.status !== 200) assertEquals(result.body.code, 'invalid_body');
  assertEquals(captcha.calls.length, 0, 'captcha must not be checked for a malformed body');
  assertEquals(signUp.calls.length, 0, 'signUp must not be called for a malformed body');
});

Deno.test('handleSignupWithCaptcha: a failed captcha check blocks signup entirely — this is the whole point', async () => {
  const captcha = new FakeCaptchaVerifier(false);
  const signUp = new FakeSignUpClient(SUCCESS_OUTCOME);
  const result = await handleSignupWithCaptcha(deps(captcha, signUp), VALID_BODY, '1.2.3.4');
  assertEquals(result.status, 400);
  if (result.status !== 200) assertEquals(result.body.code, 'captcha_invalid');
  assertEquals(captcha.calls.length, 1);
  assertEquals(captcha.calls[0], { token: 'tok-123', remoteIp: '1.2.3.4' });
  assertEquals(signUp.calls.length, 0, 'signUp must never be called once the captcha check fails');
});

Deno.test('handleSignupWithCaptcha: a passed captcha check proceeds to signUp and returns the session', async () => {
  const captcha = new FakeCaptchaVerifier(true);
  const signUp = new FakeSignUpClient(SUCCESS_OUTCOME);
  const result = await handleSignupWithCaptcha(deps(captcha, signUp), VALID_BODY, null);
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
  const result = await handleSignupWithCaptcha(deps(captcha, signUp), VALID_BODY, null);
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
  const result = await handleSignupWithCaptcha(deps(captcha, signUp), VALID_BODY, null);
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
  const result = await handleSignupWithCaptcha(deps(captcha, signUp), VALID_BODY, null);
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
  const result = await handleSignupWithCaptcha(deps(captcha, signUp), VALID_BODY, null);
  assertEquals(result.status, 400);
  if (result.status !== 200) assertEquals(result.body.code, 'weak_password_length');
});

Deno.test('handleSignupWithCaptcha: created_no_session fails safe with a 500, never a bare 200', async () => {
  const captcha = new FakeCaptchaVerifier(true);
  const signUp = new FakeSignUpClient({ outcome: 'created_no_session', user: { id: 'user-1', email: null } });
  const result = await handleSignupWithCaptcha(deps(captcha, signUp), VALID_BODY, null);
  assertEquals(result.status, 500);
  if (result.status !== 200) assertEquals(result.body.code, 'no_session');
});

Deno.test('handleSignupWithCaptcha: an unexpected signUp error maps to signup_failed, 400', async () => {
  const captcha = new FakeCaptchaVerifier(true);
  const signUp = new FakeSignUpClient({ outcome: 'error', message: 'Something odd', code: null });
  const result = await handleSignupWithCaptcha(deps(captcha, signUp), VALID_BODY, null);
  assertEquals(result.status, 400);
  if (result.status !== 200) assertEquals(result.body.code, 'signup_failed');
});
