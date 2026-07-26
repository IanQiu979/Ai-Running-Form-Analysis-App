/**
 * Regression locks for `_shared/supabase-keys.ts` — the one parser every edge function now reads
 * its platform API keys through.
 *
 * WHY THIS SUITE EXISTS. The ten local copies this module replaced accepted only a JSON ARRAY and
 * otherwise fell through to `return raw`, so the platform's actual value —
 * `{"default":"sb_publishable_..."}` — was handed to `createClient()` as the API key verbatim.
 * GoTrue rejected it, `auth.getUser()` failed, and every authenticated function returned 401 to
 * valid JWTs for days (found 2026-07-26; see the module header). The single most important
 * assertion below is therefore the obvious one: a `{"default":"…"}` object must yield the INNER
 * key and never the raw JSON string.
 *
 * DENO-ONLY, DELIBERATELY (issue #90 convention, same as `quota-status.deno.test.ts`'s header):
 * named `.deno.test.ts` so `jest.config.js`'s `testPathIgnorePatterns` skips it and only
 * `deno test` (`npm run test:edge`) runs it. Unlike most `_shared` suites this one genuinely
 * cannot run under Jest — the subject reads `Deno.env`, which is why `test:edge` passes
 * `--allow-env`.
 */
import { getPublishableKey, getSecretKey, getSupabaseUrl } from '../supabase-keys.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertEquals(actual: unknown, expected: unknown, message?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(message ?? `Expected ${e}, got ${a}`);
  }
}

function assertThrows(fn: () => unknown, message: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

const ENV_VARS = ['SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_SECRET_KEYS', 'SUPABASE_URL'] as const;

/**
 * Runs `body` with the three env vars set exactly as given (an omitted name is unset), then
 * restores whatever the process had before. `deno test` shares one process across test steps, so
 * leaking a value here would silently couple these cases to each other — and to any other suite.
 */
function withEnv(vars: Partial<Record<(typeof ENV_VARS)[number], string>>, body: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const name of ENV_VARS) {
    previous.set(name, Deno.env.get(name));
    const next = vars[name];
    if (next === undefined) {
      Deno.env.delete(name);
    } else {
      Deno.env.set(name, next);
    }
  }
  try {
    body();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) {
        Deno.env.delete(name);
      } else {
        Deno.env.set(name, value);
      }
    }
  }
}

const PUBLISHABLE = 'sb_publishable_abc123';
const SECRET = 'sb_secret_xyz789';

// ---------------------------------------------------------------------------
// 1. The documented platform shape — the exact case that was broken
// ---------------------------------------------------------------------------

Deno.test('the documented {"default":"…"} object yields the inner key, never the raw JSON string', () => {
  const rawPublishable = JSON.stringify({ default: PUBLISHABLE });
  const rawSecret = JSON.stringify({ default: SECRET });

  withEnv({ SUPABASE_PUBLISHABLE_KEYS: rawPublishable, SUPABASE_SECRET_KEYS: rawSecret }, () => {
    assertEquals(getPublishableKey(), PUBLISHABLE, 'publishable key must be unwrapped from the object');
    assertEquals(getSecretKey(), SECRET, 'secret key must be unwrapped from the object');

    // The regression itself, stated as its own assertion: returning `raw` here is what 401'd the
    // whole authenticated surface.
    if (getPublishableKey() === rawPublishable) {
      throw new Error('getPublishableKey() returned the raw JSON blob — this is the outage regression');
    }
    if (getSecretKey() === rawSecret) {
      throw new Error('getSecretKey() returned the raw JSON blob — this is the outage regression');
    }
  });
});

Deno.test('an object with other named keys alongside "default" still picks "default"', () => {
  const raw = JSON.stringify({ rotating: 'sb_secret_old', default: SECRET, spare: 'sb_secret_spare' });
  withEnv({ SUPABASE_SECRET_KEYS: raw }, () => {
    assertEquals(getSecretKey(), SECRET, 'the key named "default" must win over any sibling');
  });
});

// ---------------------------------------------------------------------------
// 2. The other accepted shapes
// ---------------------------------------------------------------------------

Deno.test('an object with no "default" falls back to the first usable string value', () => {
  // A project whose only key was renamed. Any valid key of this class beats a total outage over a
  // naming choice — see the module's own comment on this branch.
  const raw = JSON.stringify({ renamed: SECRET });
  withEnv({ SUPABASE_SECRET_KEYS: raw }, () => {
    assertEquals(getSecretKey(), SECRET);
  });
});

Deno.test('a bare non-JSON key string is used as-is (the local --env-file shape)', () => {
  withEnv({ SUPABASE_SECRET_KEYS: SECRET }, () => {
    assertEquals(getSecretKey(), SECRET);
  });
});

Deno.test('a JSON array of key strings uses the first entry (the old parser\'s shape, still supported)', () => {
  withEnv({ SUPABASE_PUBLISHABLE_KEYS: JSON.stringify([PUBLISHABLE, 'sb_publishable_second']) }, () => {
    assertEquals(getPublishableKey(), PUBLISHABLE);
  });
});

Deno.test('a JSON-quoted single key string is accepted', () => {
  withEnv({ SUPABASE_SECRET_KEYS: JSON.stringify(SECRET) }, () => {
    assertEquals(getSecretKey(), SECRET);
  });
});

// ---------------------------------------------------------------------------
// 3. The throw paths — fail loudly rather than hand createClient() a fake key
// ---------------------------------------------------------------------------

Deno.test('an unset env var throws rather than returning an empty key', () => {
  withEnv({}, () => {
    assertThrows(() => getPublishableKey(), 'an unset SUPABASE_PUBLISHABLE_KEYS must throw');
    assertThrows(() => getSecretKey(), 'an unset SUPABASE_SECRET_KEYS must throw');
    assertThrows(() => getSupabaseUrl(), 'an unset SUPABASE_URL must throw');
  });
});

Deno.test('valid JSON of an unusable shape throws rather than silently degrading', () => {
  const unusable = [
    JSON.stringify({}),
    JSON.stringify({ default: '' }),
    JSON.stringify({ default: 42 }),
    JSON.stringify([]),
    JSON.stringify([42]),
    JSON.stringify(null),
    JSON.stringify(7),
  ];
  for (const raw of unusable) {
    withEnv({ SUPABASE_SECRET_KEYS: raw }, () => {
      assertThrows(() => getSecretKey(), `${raw} is not a usable key and must throw`);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. SUPABASE_URL — a plain string, no parsing
// ---------------------------------------------------------------------------

Deno.test('getSupabaseUrl returns the injected URL verbatim', () => {
  withEnv({ SUPABASE_URL: 'https://example.supabase.co' }, () => {
    assertEquals(getSupabaseUrl(), 'https://example.supabase.co');
  });
});
