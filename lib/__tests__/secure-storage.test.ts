/**
 * Regression locks for `lib/secure-storage.ts` (issue #38, `docs/status.md` Known Issue #13).
 *
 * This is a security fix, so "compiles and does a happy-path round trip" is not enough — three
 * things a naive implementation gets wrong are exactly what this suite pins down:
 *
 *   1. SecureStore's ~2048-byte per-value limit (case group "oversized session"). A session
 *      adapter that just proxies `storage: SecureStore` works for a tiny fixture and silently
 *      stops persisting real sessions once the access token + refresh token + user object
 *      cross ~2KB. The load-bearing assertion isn't "it round-trips" — it's that the value
 *      handed to `SecureStore.setItemAsync` is a fixed 64-hex-char AES key, never the session
 *      itself, no matter how large the session gets.
 *   2. The migration path (case group "legacy plaintext migration"). Before this change,
 *      `lib/supabase.ts` wrote the session straight into AsyncStorage as plaintext JSON — that
 *      is exactly what's sitting there today for the app's 2 real accounts. An adapter that
 *      just tries to decrypt whatever it finds returns null for that plaintext (no matching
 *      SecureStore key exists yet), which supabase-js reads as "no session" — a silent,
 *      unexplained sign-out on the very first launch after this update. That is the same bug
 *      class as issue #5, and it's the case this suite treats as load-bearing, not incidental.
 *   3. Torn writes (case group "stable key, per-write IV" and "corrupted/torn state"). The AES
 *      key (SecureStore) and the ciphertext (AsyncStorage) live in two stores that cannot be
 *      written atomically. An adapter that regenerates the key on every write turns every
 *      `setItem` into a two-store transaction that can be interrupted mid-way — leaving a new
 *      key paired with an old blob, or vice versa — and AES-CTR does NOT error on a wrong
 *      key/IV pairing, it produces well-formed-looking garbage. The load-bearing assertions
 *      here are: (a) the key is created once and reused, so there is no key/blob pair left to
 *      tear after the first write; (b) a decrypt that "succeeds" under the wrong key/IV is
 *      still caught (via a JSON-validity check, not just exception handling) and never handed
 *      to supabase-js as if it were real; (c) when that happens, the broken state is cleared
 *      and reported via `onSessionRestoreFailure`, not silently presented as "no session" —
 *      the same bug class issue #5 fixed for the OAuth redirect path.
 *
 * `aes-js` runs for real here (it's pure JS, no native module) — only `expo-secure-store` and
 * `expo-crypto` are mocked, both because they wrap native modules Jest has no device for.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import {
  createSecureSessionStorage,
  LargeSecureStore,
  onSessionRestoreFailure,
} from '../secure-storage';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

// Deterministic but non-repeating: a different "random" value on every call. Exercised by both
// the (now one-time) AES key generation and the per-write IV generation — see the module doc
// in lib/secure-storage.ts for why the IV, not the key, is what has to vary per write now.
jest.mock('expo-crypto', () => {
  let calls = 0;
  return {
    getRandomBytes: jest.fn((byteCount: number) => {
      calls += 1;
      const bytes = new Uint8Array(byteCount);
      for (let i = 0; i < byteCount; i++) {
        bytes[i] = (i * 7 + calls * 13) % 256;
      }
      return bytes;
    }),
  };
});

const mockGetItemAsync = SecureStore.getItemAsync as jest.MockedFunction<
  typeof SecureStore.getItemAsync
>;
const mockSetItemAsync = SecureStore.setItemAsync as jest.MockedFunction<
  typeof SecureStore.setItemAsync
>;
const mockDeleteItemAsync = SecureStore.deleteItemAsync as jest.MockedFunction<
  typeof SecureStore.deleteItemAsync
>;

const KEY = 'sb-test-project-ref-auth-token';

/** Backs the mocked expo-secure-store with a plain in-memory Map, reset fresh each test. */
let secureStoreState: Map<string, string>;

beforeEach(async () => {
  await AsyncStorage.clear();
  secureStoreState = new Map();

  mockGetItemAsync.mockReset().mockImplementation(async (key) => secureStoreState.get(key) ?? null);
  mockSetItemAsync.mockReset().mockImplementation(async (key, value) => {
    secureStoreState.set(key, value);
  });
  mockDeleteItemAsync.mockReset().mockImplementation(async (key) => {
    secureStoreState.delete(key);
  });
});

describe('LargeSecureStore — basic round trip', () => {
  it('encrypts on setItem and decrypts back the exact original value on getItem', async () => {
    const store = new LargeSecureStore();
    const session = JSON.stringify({ access_token: 'tok', refresh_token: 'refresh' });

    await store.setItem(KEY, session);
    const result = await store.getItem(KEY);

    expect(result).toBe(session);
  });

  it('never writes the plaintext session into AsyncStorage', async () => {
    const store = new LargeSecureStore();
    const session = JSON.stringify({ access_token: 'super-secret-token' });

    await store.setItem(KEY, session);

    const rawAsyncStorageValue = await AsyncStorage.getItem(KEY);
    expect(rawAsyncStorageValue).not.toBe(session);
    expect(rawAsyncStorageValue).not.toContain('super-secret-token');
  });

  it('getItem returns null for a key that was never written', async () => {
    const store = new LargeSecureStore();
    expect(await store.getItem('sb-never-written-auth-token')).toBeNull();
  });

  it('removeItem clears both the AsyncStorage ciphertext and the SecureStore key', async () => {
    const store = new LargeSecureStore();
    await store.setItem(KEY, JSON.stringify({ access_token: 'tok' }));

    await store.removeItem(KEY);

    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    expect(mockDeleteItemAsync).toHaveBeenCalledWith(KEY);
    expect(await store.getItem(KEY)).toBeNull();
  });
});

describe('LargeSecureStore — stable key, per-write IV (torn-write hardening)', () => {
  it('creates the SecureStore key once and reuses it on later writes, varying only the IV', async () => {
    const store = new LargeSecureStore();

    await store.setItem(KEY, JSON.stringify({ access_token: 'first' }));
    expect(mockSetItemAsync).toHaveBeenCalledTimes(1); // the one-time key creation
    const keyAfterFirstWrite = secureStoreState.get(KEY);
    const firstCiphertext = await AsyncStorage.getItem(KEY);

    await store.setItem(KEY, JSON.stringify({ access_token: 'second' }));
    // Still exactly once — the second write only READ the key, it did not recreate it. This is
    // the core of the fix: after the first write there is no further SecureStore write for this
    // key, so there is no longer a key/blob pair that a torn write could tear apart.
    expect(mockSetItemAsync).toHaveBeenCalledTimes(1);
    expect(secureStoreState.get(KEY)).toBe(keyAfterFirstWrite);

    const secondCiphertext = await AsyncStorage.getItem(KEY);
    // Same key, but the leading 32 hex chars (the IV) must differ between writes — reusing a
    // key with a reused IV is exactly the CTR-mode keystream-reuse hazard a fresh key every
    // write used to paper over.
    const firstIv = (firstCiphertext as string).slice(0, 32);
    const secondIv = (secondCiphertext as string).slice(0, 32);
    expect(firstIv).not.toBe(secondIv);

    expect(await store.getItem(KEY)).toBe(JSON.stringify({ access_token: 'second' }));
  });

  it('serializes concurrent first-writes for the same key so only one AES key is ever created', async () => {
    // The exact race named in review: two setItem calls, both starting before either has found
    // an existing key, must not each generate and store a DIFFERENT key — only one of them
    // should win the key creation, and the other must read that same key back rather than
    // clobbering it with its own.
    const store = new LargeSecureStore();
    const sessionA = JSON.stringify({ access_token: 'first-writer' });
    const sessionB = JSON.stringify({ access_token: 'second-writer' });

    await Promise.all([store.setItem(KEY, sessionA), store.setItem(KEY, sessionB)]);

    // Only one key was ever created in SecureStore, no matter which setItem's blob "won" the
    // final AsyncStorage write.
    expect(mockSetItemAsync).toHaveBeenCalledTimes(1);

    // And whichever blob ended up stored, it decrypts correctly under that one key — neither
    // writer's blob was orphaned by a different, clobbering key (which would show up here as a
    // failed decrypt/JSON-parse instead of one of the two real values).
    const finalValue = await store.getItem(KEY);
    expect([sessionA, sessionB]).toContain(finalValue);
  });
});

describe('LargeSecureStore — the 2048-byte SecureStore limit (issue #38 core requirement)', () => {
  // A realistic oversized Supabase session: JWT-shaped access token, refresh token, and a user
  // object with metadata — the exact shape that pushes a real session past 2KB.
  const OVERSIZED_SESSION = JSON.stringify({
    access_token: `eyJhbGciOiJIUzI1NiJ9.${'a'.repeat(1200)}.signature`,
    refresh_token: 'r'.repeat(400),
    expires_in: 3600,
    expires_at: 1999999999,
    token_type: 'bearer',
    user: {
      id: '11111111-1111-1111-1111-111111111111',
      email: 'user@example.com',
      user_metadata: { full_name: 'Test User', note: 'm'.repeat(600) },
      app_metadata: { provider: 'email', providers: ['email'] },
    },
  });

  it('fixture is actually larger than the SecureStore value limit (sanity check on the test itself)', () => {
    // expo-secure-store's own limit — see node_modules/expo-secure-store/src/byteCounter.ts.
    expect(OVERSIZED_SESSION.length).toBeGreaterThan(2048);
  });

  it('never passes the oversized session itself to SecureStore.setItemAsync', async () => {
    const store = new LargeSecureStore();

    await store.setItem(KEY, OVERSIZED_SESSION);

    expect(mockSetItemAsync).toHaveBeenCalledTimes(1);
    const [secureStoreKey, secureStoreValue] = mockSetItemAsync.mock.calls[0];
    expect(secureStoreKey).toBe(KEY);
    // 32-byte AES-256 key, hex-encoded: always exactly 64 chars, regardless of session size.
    expect(secureStoreValue).toHaveLength(64);
    expect(secureStoreValue.length).toBeLessThan(2048);
  });

  it('round-trips the oversized session exactly, via the (unbounded) AsyncStorage-held ciphertext', async () => {
    const store = new LargeSecureStore();

    await store.setItem(KEY, OVERSIZED_SESSION);

    // The stored blob is now `<32-char IV><ciphertext>`, still unbounded in AsyncStorage.
    const ciphertext = await AsyncStorage.getItem(KEY);
    expect(ciphertext).not.toBeNull();
    expect(ciphertext).not.toBe(OVERSIZED_SESSION);
    expect(ciphertext).not.toContain('access_token');
    expect((ciphertext as string).length).toBeGreaterThan(2048); // AsyncStorage has no such limit

    const roundTripped = await store.getItem(KEY);
    expect(roundTripped).toBe(OVERSIZED_SESSION);
  });
});

describe('LargeSecureStore — legacy plaintext migration (issue #38 migration requirement)', () => {
  const legacySession = JSON.stringify({
    access_token: 'legacy-plaintext-access-token',
    refresh_token: 'legacy-plaintext-refresh-token',
    user: { id: 'legacy-user-id', email: 'existing-user@example.com' },
  });

  it('returns the legacy plaintext session instead of null, so an existing account is not signed out', async () => {
    // Simulate the pre-#38 world: plaintext JSON already sitting in AsyncStorage (written by
    // the old `storage: AsyncStorage` adapter), and nothing yet in SecureStore for this key —
    // exactly the state of the app's 2 real accounts the first time they open the app post-fix.
    await AsyncStorage.setItem(KEY, legacySession);
    expect(secureStoreState.has(KEY)).toBe(false);

    const store = new LargeSecureStore();
    const result = await store.getItem(KEY);

    expect(result).toBe(legacySession);
  });

  it('re-encrypts the legacy session into AsyncStorage and stores a SecureStore key for it', async () => {
    await AsyncStorage.setItem(KEY, legacySession);

    const store = new LargeSecureStore();
    await store.getItem(KEY);

    const nowStored = await AsyncStorage.getItem(KEY);
    expect(nowStored).not.toBe(legacySession);
    expect(nowStored).not.toContain('legacy-plaintext-access-token');
    expect(secureStoreState.has(KEY)).toBe(true);
  });

  it('a second read after migration goes through the normal encrypted path and still returns the original session', async () => {
    await AsyncStorage.setItem(KEY, legacySession);

    const store = new LargeSecureStore();
    await store.getItem(KEY); // triggers migration
    const secondRead = await store.getItem(KEY); // now reads back through _decrypt

    expect(secondRead).toBe(legacySession);
  });

  it('still returns the legacy session even if the migration write itself fails', async () => {
    await AsyncStorage.setItem(KEY, legacySession);
    mockSetItemAsync.mockRejectedValueOnce(new Error('SecureStore momentarily unavailable'));

    const store = new LargeSecureStore();
    const result = await store.getItem(KEY);

    // The session must not be lost over a storage hiccup during migration.
    expect(result).toBe(legacySession);
  });

  it('does not treat malformed JSON starting with "{" as a legacy session', async () => {
    await AsyncStorage.setItem(KEY, '{not valid json');

    const store = new LargeSecureStore();
    const result = await store.getItem(KEY);

    expect(result).toBeNull();
  });
});

describe('LargeSecureStore — torn/corrupted state fails closed AND is reported, not silently absorbed', () => {
  it('a blob with no matching SecureStore key is treated as corrupted, cleared, and reported (not "no session")', async () => {
    // With a stable key, a torn `setItem` cannot itself produce "blob present, key absent" —
    // the key is always written before the blob (see class doc in lib/secure-storage.ts). This
    // state can still arise if the SecureStore entry is removed independently of the blob (a
    // narrow removeItem/read race, or the OS keychain being reset out from under the app) —
    // constructed directly here to prove the defensive handling regardless of how it's reached.
    await AsyncStorage.setItem(KEY, `${'ab'.repeat(16)}${'cd'.repeat(20)}`); // IV+ciphertext-shaped hex

    const onFailure = jest.fn();
    const unsubscribe = onSessionRestoreFailure(onFailure);
    try {
      const store = new LargeSecureStore();
      const result = await store.getItem(KEY);

      expect(result).toBeNull();
      expect(onFailure).toHaveBeenCalledWith(KEY);
      expect(await AsyncStorage.getItem(KEY)).toBeNull(); // cleared, doesn't loop forever
    } finally {
      unsubscribe();
    }
  });

  it('a torn/truncated blob shorter than one IV is treated as corrupted, cleared, and reported', async () => {
    secureStoreState.set(KEY, '11'.repeat(32)); // a validly-shaped 32-byte key IS present
    await AsyncStorage.setItem(KEY, 'ab12'); // but the blob is far too short to hold a 16-byte IV

    const onFailure = jest.fn();
    const unsubscribe = onSessionRestoreFailure(onFailure);
    try {
      const store = new LargeSecureStore();
      const result = await store.getItem(KEY);

      expect(result).toBeNull();
      expect(onFailure).toHaveBeenCalledWith(KEY);
      expect(await AsyncStorage.getItem(KEY)).toBeNull();
    } finally {
      unsubscribe();
    }
  });

  it('a SecureStore key of the wrong byte length throws inside decrypt and is treated as corrupted', async () => {
    // A validly-shaped ciphertext blob (IV + some ciphertext), but the "key" decodes to the
    // wrong length for AES — aes-js's own Counter/AES constructors throw on this, exercising
    // getItem's try/catch path specifically (as opposed to the JSON-validity path below).
    secureStoreState.set(KEY, '1234'); // 2 bytes, not a valid 16/24/32-byte AES key
    await AsyncStorage.setItem(KEY, `${'ab'.repeat(16)}${'cd'.repeat(20)}`);

    const onFailure = jest.fn();
    const unsubscribe = onSessionRestoreFailure(onFailure);
    try {
      const store = new LargeSecureStore();
      const result = await store.getItem(KEY);

      expect(result).toBeNull();
      expect(onFailure).toHaveBeenCalledWith(KEY);
      expect(await AsyncStorage.getItem(KEY)).toBeNull();
    } finally {
      unsubscribe();
    }
  });

  it('THE CORE HAZARD: a decrypt that succeeds under the wrong key produces garbage, not an exception — and must still be caught', async () => {
    // This is exactly what review flagged: AES-CTR does not error on a mismatched key/IV pair,
    // it silently produces well-formed-looking garbage bytes. Write a real session, then swap
    // in a DIFFERENT but still validly-shaped (32-byte) key — simulating the residual
    // torn-write/corruption window — and prove the garbage plaintext this produces is neither
    // returned as if it were real NOR silently swallowed as "no session".
    const store = new LargeSecureStore();
    const session = JSON.stringify({ access_token: 'a-real-session', refresh_token: 'r' });
    await store.setItem(KEY, session);

    const wrongButValidLengthKey = '42'.repeat(32); // 32 bytes, decodes fine, but is NOT the real key
    secureStoreState.set(KEY, wrongButValidLengthKey);

    const onFailure = jest.fn();
    const unsubscribe = onSessionRestoreFailure(onFailure);
    try {
      const result = await store.getItem(KEY);

      // Must not be the real session (that would mean the garbage-check didn't run) and must
      // not be some OTHER non-null garbage string either (that would mean it decrypted "ok"
      // and was handed back as if it were real) — null is the only acceptable outcome, paired
      // with the failure actually being reported below.
      expect(result).toBeNull();
      expect(onFailure).toHaveBeenCalledWith(KEY);
      expect(await AsyncStorage.getItem(KEY)).toBeNull();
    } finally {
      unsubscribe();
    }
  });

  it('onSessionRestoreFailure unsubscribe actually stops further notifications', async () => {
    const onFailure = jest.fn();
    const unsubscribe = onSessionRestoreFailure(onFailure);
    unsubscribe();

    secureStoreState.set(KEY, '1234'); // forces the corrupted path
    await AsyncStorage.setItem(KEY, `${'ab'.repeat(16)}${'cd'.repeat(20)}`);
    const store = new LargeSecureStore();
    await store.getItem(KEY);

    expect(onFailure).not.toHaveBeenCalled();
  });
});

describe('createSecureSessionStorage — web fallback (issue #38 platform requirement)', () => {
  it('returns AsyncStorage directly on web, never touching expo-secure-store', async () => {
    const storage = createSecureSessionStorage('web');

    expect(storage).toBe(AsyncStorage);

    await storage.setItem(KEY, JSON.stringify({ access_token: 'web-session' }));
    expect(mockSetItemAsync).not.toHaveBeenCalled();

    const stored = await storage.getItem(KEY);
    expect(stored).toBe(JSON.stringify({ access_token: 'web-session' }));
  });

  it('returns a LargeSecureStore instance on ios and android', () => {
    expect(createSecureSessionStorage('ios')).toBeInstanceOf(LargeSecureStore);
    expect(createSecureSessionStorage('android')).toBeInstanceOf(LargeSecureStore);
  });
});
