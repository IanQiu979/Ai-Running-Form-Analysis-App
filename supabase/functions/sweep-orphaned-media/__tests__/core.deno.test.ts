/**
 * Regression locks for `sweep-orphaned-media/core.ts` (issue #137) — the auth gate, request
 * parsing/bounding, and dry-run row normalization behind the schedule `_shared/storage-sweep.ts`
 * never got wired to. These tests exercise pure functions only; the real Deno.serve wiring in
 * `index.ts` and the real Supabase client in `client.ts` are exercised only by deployment/manual
 * verification, matching this codebase's existing convention (`ai-guard-client.ts`,
 * `delete-account-client.ts` are likewise thin Deno/`npm:` factories with nothing pure left to
 * unit-test).
 *
 * DENO-ONLY, DELIBERATELY (issue #90 convention): named `.deno.test.ts` so `jest.config.js`'s
 * `testPathIgnorePatterns` skips it and only `deno test` (`npm run test:edge`) runs it.
 */
import {
  checkCronAuth,
  CRON_SECRET_HEADER,
  httpStatusForAuthDenial,
  normalizeCandidateRows,
  parseSweepRequest,
  timingSafeEqual,
} from '../core.ts';

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

// ---------------------------------------------------------------------------
// timingSafeEqual
// ---------------------------------------------------------------------------

Deno.test('timingSafeEqual: identical strings match', () => {
  assertTrue(timingSafeEqual('a-real-secret', 'a-real-secret'), 'identical strings must match');
});

Deno.test('timingSafeEqual: different strings of the same length do not match', () => {
  assertTrue(!timingSafeEqual('a-real-secret', 'a-fake-secret'), 'different strings must not match');
});

Deno.test('timingSafeEqual: different lengths do not match (and do not throw)', () => {
  assertTrue(!timingSafeEqual('short', 'a-much-longer-string'), 'different-length strings must not match');
  assertTrue(!timingSafeEqual('a-much-longer-string', 'short'), 'order must not matter');
});

Deno.test('timingSafeEqual: empty strings match only each other', () => {
  assertTrue(timingSafeEqual('', ''), 'two empty strings match');
  assertTrue(!timingSafeEqual('', 'x'), 'empty vs non-empty must not match');
});

// ---------------------------------------------------------------------------
// checkCronAuth — every branch fails closed
// ---------------------------------------------------------------------------

Deno.test('checkCronAuth: matching header and configured secret authorizes', () => {
  const result = checkCronAuth('the-secret', 'the-secret');
  assertEquals(result, { authorized: true });
});

Deno.test('checkCronAuth: unset server-side secret denies with missing_secret_config, even with a header present', () => {
  const result = checkCronAuth('anything', undefined);
  assertEquals(result, { authorized: false, reason: 'missing_secret_config' });
});

Deno.test('checkCronAuth: empty-string server-side secret denies with missing_secret_config (never matches an equally empty header)', () => {
  const result = checkCronAuth('', '');
  assertEquals(result, { authorized: false, reason: 'missing_secret_config' });
});

Deno.test('checkCronAuth: missing header denies with missing_header when a secret IS configured', () => {
  const result = checkCronAuth(null, 'the-secret');
  assertEquals(result, { authorized: false, reason: 'missing_header' });
});

Deno.test('checkCronAuth: wrong header value denies with secret_mismatch', () => {
  const result = checkCronAuth('the-wrong-secret', 'the-secret');
  assertEquals(result, { authorized: false, reason: 'secret_mismatch' });
});

Deno.test('checkCronAuth: every denial reason maps to HTTP 401', () => {
  assertEquals(httpStatusForAuthDenial('missing_secret_config'), 401);
  assertEquals(httpStatusForAuthDenial('missing_header'), 401);
  assertEquals(httpStatusForAuthDenial('secret_mismatch'), 401);
});

Deno.test('CRON_SECRET_HEADER is the documented lowercase header name', () => {
  assertEquals(CRON_SECRET_HEADER, 'x-cron-secret');
});

// ---------------------------------------------------------------------------
// parseSweepRequest — safe defaults, bounded, validated
// ---------------------------------------------------------------------------

Deno.test('parseSweepRequest: null/undefined body defaults to a safe dry run', () => {
  assertEquals(parseSweepRequest(null), { ok: true, options: { dryRun: true, olderThan: '15 minutes', limit: 500 } });
  assertEquals(parseSweepRequest(undefined), {
    ok: true,
    options: { dryRun: true, olderThan: '15 minutes', limit: 500 },
  });
});

Deno.test('parseSweepRequest: an empty object body also defaults to a safe dry run', () => {
  assertEquals(parseSweepRequest({}), { ok: true, options: { dryRun: true, olderThan: '15 minutes', limit: 500 } });
});

Deno.test('parseSweepRequest: dryRun: false is honored explicitly — the only way to arm a real purge', () => {
  const result = parseSweepRequest({ dryRun: false });
  assertEquals(result, { ok: true, options: { dryRun: false, olderThan: '15 minutes', limit: 500 } });
});

Deno.test('parseSweepRequest: olderThan and limit override the defaults when valid', () => {
  const result = parseSweepRequest({ dryRun: false, olderThan: '1 hour', limit: 42 });
  assertEquals(result, { ok: true, options: { dryRun: false, olderThan: '1 hour', limit: 42 } });
});

Deno.test('parseSweepRequest: a non-boolean dryRun is rejected, not coerced', () => {
  const result = parseSweepRequest({ dryRun: 'false' });
  assertTrue(!result.ok, 'a string dryRun must be rejected');
});

Deno.test('parseSweepRequest: an empty-string olderThan is rejected', () => {
  const result = parseSweepRequest({ olderThan: '   ' });
  assertTrue(!result.ok, 'a blank olderThan must be rejected');
});

Deno.test('parseSweepRequest: a non-positive or non-integer limit is rejected', () => {
  assertTrue(!parseSweepRequest({ limit: 0 }).ok, 'zero must be rejected');
  assertTrue(!parseSweepRequest({ limit: -5 }).ok, 'negative must be rejected');
  assertTrue(!parseSweepRequest({ limit: 1.5 }).ok, 'non-integer must be rejected');
  assertTrue(!parseSweepRequest({ limit: 'lots' }).ok, 'non-numeric must be rejected');
});

Deno.test('parseSweepRequest: a limit above MAX_LIMIT is clamped down, not rejected — bounds the work without erroring a well-meaning caller', () => {
  const result = parseSweepRequest({ limit: 1_000_000 });
  assertTrue(result.ok, 'an oversized limit must still be accepted');
  if (result.ok) {
    assertEquals(result.options.limit, 1000, 'limit must be clamped to MAX_LIMIT (1000)');
  }
});

Deno.test('parseSweepRequest: an array body is rejected (must be a JSON object)', () => {
  const result = parseSweepRequest([1, 2, 3]);
  assertTrue(!result.ok, 'an array body must be rejected');
});

Deno.test('parseSweepRequest: a scalar body is rejected (must be a JSON object)', () => {
  assertTrue(!parseSweepRequest('dryRun').ok, 'a bare string body must be rejected');
  assertTrue(!parseSweepRequest(42).ok, 'a bare number body must be rejected');
});

// ---------------------------------------------------------------------------
// normalizeCandidateRows — matches _shared/storage-sweep.ts's own (private) normalizeRows exactly
// ---------------------------------------------------------------------------

Deno.test('normalizeCandidateRows: translates snake_case RPC rows into camelCase', () => {
  const rows = normalizeCandidateRows([
    {
      user_id: 'user-a',
      analysis_id: 'analysis-1',
      prefix: 'user-a/analysis-1/',
      object_count: 3,
      oldest_object_at: '2026-07-01T00:00:00Z',
    },
  ]);
  assertEquals(rows, [
    {
      userId: 'user-a',
      analysisId: 'analysis-1',
      prefix: 'user-a/analysis-1/',
      objectCount: 3,
      oldestObjectAt: '2026-07-01T00:00:00Z',
    },
  ]);
});

Deno.test('normalizeCandidateRows: non-array input normalizes to an empty list, never throws', () => {
  assertEquals(normalizeCandidateRows(null), []);
  assertEquals(normalizeCandidateRows(undefined), []);
  assertEquals(normalizeCandidateRows('not-an-array'), []);
});

Deno.test('normalizeCandidateRows: an empty array stays empty', () => {
  assertEquals(normalizeCandidateRows([]), []);
});
