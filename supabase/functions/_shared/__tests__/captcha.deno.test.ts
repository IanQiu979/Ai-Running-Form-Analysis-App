/**
 * Regression locks for `_shared/captcha.ts`'s `TurnstileVerifier` — the server-side Cloudflare
 * Turnstile check `signup-with-captcha/index.ts` runs before ever calling
 * `supabase.auth.signUp()` (issue #12/Known Issue #12). Stubs the global `fetch` (the only
 * network call this module makes) rather than hitting Cloudflare's real siteverify endpoint —
 * same technique this repo's other Deno tests use for outbound HTTP (see e.g.
 * `analyze-form/__tests__/flow.deno.test.ts`'s Anthropic-call stubbing, if present).
 *
 * DENO-ONLY, DELIBERATELY (issue #90 convention): named `.deno.test.ts` so `jest.config.js`'s
 * `testPathIgnorePatterns` skips it and only `deno test` (`npm run test:edge`) runs it.
 */
import { TurnstileVerifier } from '../captcha.ts';

function assertEquals(actual: unknown, expected: unknown, message?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(message ?? `Expected ${e}, got ${a}`);
  }
}

/** Swaps `globalThis.fetch` for the duration of `fn`, always restoring it afterward — even if
 * `fn` throws — so one test's stub can never leak into another. */
async function withStubbedFetch(
  stub: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).fetch = stub;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test('TurnstileVerifier: success: true resolves true', async () => {
  await withStubbedFetch(
    async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
    async () => {
      const verifier = new TurnstileVerifier('secret');
      const result = await verifier.verify('token-abc', null);
      assertEquals(result, true);
    },
  );
});

Deno.test('TurnstileVerifier: success: false resolves false', async () => {
  await withStubbedFetch(
    async () =>
      new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }), { status: 200 }),
    async () => {
      const verifier = new TurnstileVerifier('secret');
      const result = await verifier.verify('bad-token', null);
      assertEquals(result, false);
    },
  );
});

Deno.test('TurnstileVerifier: a non-2xx response resolves false, not a throw', async () => {
  await withStubbedFetch(
    async () => new Response('Internal Server Error', { status: 500 }),
    async () => {
      const verifier = new TurnstileVerifier('secret');
      const result = await verifier.verify('token-abc', null);
      assertEquals(result, false);
    },
  );
});

Deno.test('TurnstileVerifier: a malformed JSON body resolves false, not a throw', async () => {
  await withStubbedFetch(
    async () => new Response('not json', { status: 200 }),
    async () => {
      const verifier = new TurnstileVerifier('secret');
      const result = await verifier.verify('token-abc', null);
      assertEquals(result, false);
    },
  );
});

Deno.test('TurnstileVerifier: a network failure resolves false, not a throw — fails closed', async () => {
  await withStubbedFetch(
    async () => {
      throw new TypeError('network error');
    },
    async () => {
      const verifier = new TurnstileVerifier('secret');
      const result = await verifier.verify('token-abc', null);
      assertEquals(result, false);
    },
  );
});

Deno.test('TurnstileVerifier: posts the secret, response, and remoteip as form fields', async () => {
  let capturedBody: string | null = null;
  let capturedUrl: string | null = null;
  await withStubbedFetch(
    async (input, init) => {
      capturedUrl = String(input);
      capturedBody = init?.body ? String(init.body) : null;
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    },
    async () => {
      const verifier = new TurnstileVerifier('my-secret');
      await verifier.verify('my-token', '9.8.7.6');
    },
  );
  assertEquals(capturedUrl, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  const params = new URLSearchParams(capturedBody ?? '');
  assertEquals(params.get('secret'), 'my-secret');
  assertEquals(params.get('response'), 'my-token');
  assertEquals(params.get('remoteip'), '9.8.7.6');
});

Deno.test('TurnstileVerifier: omits remoteip entirely when null', async () => {
  let capturedBody: string | null = null;
  await withStubbedFetch(
    async (_input, init) => {
      capturedBody = init?.body ? String(init.body) : null;
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    },
    async () => {
      const verifier = new TurnstileVerifier('my-secret');
      await verifier.verify('my-token', null);
    },
  );
  const params = new URLSearchParams(capturedBody ?? '');
  assertEquals(params.has('remoteip'), false);
});
