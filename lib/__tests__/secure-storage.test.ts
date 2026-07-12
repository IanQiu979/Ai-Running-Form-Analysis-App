/**
 * Regression locks for `lib/secure-storage.ts` (issue #38, `docs/status.md` Known Issue #13).
 *
 * This is a security fix, so "compiles and does a happy-path round trip" is not enough — the
 * two things a naive swap gets wrong are exactly what this suite pins down:
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
 *
 * `aes-js` runs for real here (it's pure JS, no native module) — only `expo-secure-store` and
 * `expo-crypto` are mocked, both because they wrap native modules Jest has no device for.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { createSecureSessionStorage, LargeSecureStore } from '../secure-storage';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

// Deterministic but non-repeating: a fresh "random" key on every call, matching the real
// contract this class relies on (see lib/secure-storage.ts's module doc: a brand-new key per
// `setItem` is what keeps AES-CTR mode safe here without tracking a nonce across calls).
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

  it('generates a fresh SecureStore key on every setItem, not a reused one', async () => {
    const store = new LargeSecureStore();
    await store.setItem(KEY, JSON.stringify({ access_token: 'first' }));
    const firstKey = secureStoreState.get(KEY);

    await store.setItem(KEY, JSON.stringify({ access_token: 'second' }));
    const secondKey = secureStoreState.get(KEY);

    expect(firstKey).not.toBe(secondKey);
    // And the second write still decrypts correctly under its own new key.
    expect(await store.getItem(KEY)).toBe(JSON.stringify({ access_token: 'second' }));
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

describe('LargeSecureStore — unreadable ciphertext fails closed, not open', () => {
  it('returns null (a legitimate sign-out) instead of throwing when the SecureStore key is corrupt', async () => {
    // A SecureStore entry exists for this key (so this is NOT the "never written" branch)
    // but it decodes to the wrong AES key length — simulates corrupted/tampered stored state.
    secureStoreState.set(KEY, '1234'); // 2 bytes, not a valid 16/24/32-byte AES key
    await AsyncStorage.setItem(KEY, 'aabbccdd'); // some hex-shaped ciphertext

    const store = new LargeSecureStore();
    const result = await store.getItem(KEY);

    expect(result).toBeNull();
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
