/**
 * Session storage adapter for supabase-js — the "LargeSecureStore" pattern (issue #38,
 * `docs/status.md` Known Issue #13).
 *
 * PROBLEM THIS REPLACES: `lib/supabase.ts` used to pass `storage: AsyncStorage` straight to
 * `createClient`. AsyncStorage is plaintext on disk — a stolen, rooted, or jailbroken phone
 * (or any process that can read the app's sandbox) gets a full working session, refresh token
 * included. Fine when nothing sat behind the session (M1); no longer fine once M2 starts
 * gating a private bucket of body-image media on it.
 *
 * WHY NOT JUST `storage: SecureStore`: expo-secure-store enforces (a `console.warn` today per
 * its own source, `node_modules/expo-secure-store/src/SecureStore.ts` — a thrown error in a
 * future SDK version) a ~2048-byte ceiling per stored value (`VALUE_BYTES_LIMIT` in
 * `expo-secure-store/src/byteCounter.ts`). A Supabase session — access token (JWT) + refresh
 * token + the full user object, including `user_metadata`/`app_metadata` — routinely exceeds
 * that once an account has any identities or custom claims attached. A naive swap works for a
 * small demo session and silently stops persisting sessions for real accounts; that's the
 * exact bug this issue exists to prevent, not a hypothetical.
 *
 * THE FIX (Supabase's own documented recipe — see the Expo/React Native quickstart): never
 * put the session itself in SecureStore. Generate a random AES-256 key, store *that* (64 hex
 * chars, always the same size) in SecureStore, and use it to encrypt the actual session JSON
 * before writing the ciphertext to AsyncStorage — unencrypted-but-opaque, with no size limit.
 * SecureStore ends up holding only a secret key that never grows regardless of session size;
 * AsyncStorage ends up holding data that's useless without that key. This is what actually
 * satisfies the 2048-byte limit for *any* session size, not just typical ones — proven in
 * `lib/__tests__/secure-storage.test.ts`'s oversized-session case.
 *
 * A fresh random key is generated on every `setItem` (never reused across writes), which is
 * also what keeps AES-CTR mode safe here without tracking a nonce/counter across calls: CTR
 * only breaks down when the same key+counter pair encrypts two different messages, and a
 * brand-new random key each call means that pair is never repeated.
 */
import type { SupportedStorage } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as aesjs from 'aes-js';
import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** AES-256. 32 bytes -> 64 hex chars once encoded for SecureStore — far under the 2048-byte
 * per-value limit no matter how large the session payload this key protects grows to. */
const AES_KEY_BYTES = 32;

export class LargeSecureStore implements SupportedStorage {
  private async _encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = getRandomBytes(AES_KEY_BYTES);
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));

    // The only thing that ever reaches SecureStore: a fixed 64-hex-char key, regardless of
    // how large `value` (the session JSON) is.
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));

    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async _decrypt(key: string, value: string): Promise<string | null> {
    const encryptionKeyHex = await SecureStore.getItemAsync(key);
    if (!encryptionKeyHex) {
      return null;
    }

    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(encryptionKeyHex),
      new aesjs.Counter(1)
    );
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));

    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  async getItem(key: string): Promise<string | null> {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      return null;
    }

    // Migration path (issue #38): before this change, `lib/supabase.ts` wrote the session
    // straight into AsyncStorage as plaintext JSON — that is exactly what is sitting under
    // this key for the app's existing real accounts today. Every ciphertext this class writes
    // is a hex string (`aesjs.utils.hex.fromBytes` only ever emits `[0-9a-f]`), which can
    // never start with '{'; a legacy plaintext session, being a JSON object, always does.
    // Detect that and migrate transparently instead of falling through to `_decrypt` (which
    // would find no SecureStore key for a value it never wrote, return null, and read to
    // supabase-js as "no session" — silently signing the user out on their first launch after
    // this update, the same class of bug as issue #5).
    if (raw.startsWith('{')) {
      try {
        JSON.parse(raw);
      } catch {
        // Leading '{' but not valid JSON: not the legacy plaintext format after all, and not
        // ciphertext either (ciphertext is pure hex, never '{'). Unreadable either way.
        return null;
      }

      // Best-effort re-encrypt-and-persist so this session is protected going forward. If it
      // fails (e.g. SecureStore momentarily unavailable), still return the legacy plaintext
      // value below rather than lose the session — the next successful getItem/setItem pair
      // completes the migration.
      await this.setItem(key, raw).catch(() => {});
      return raw;
    }

    try {
      return await this._decrypt(key, raw);
    } catch {
      // Ciphertext that will not decrypt — corrupted, or its SecureStore key vanished
      // independently of the AsyncStorage blob (e.g. app data partially cleared). This is
      // genuinely unrecoverable, not a case of dropping a good session: returning null here
      // is a legitimate sign-out, and `SessionProvider` (lib/session-provider.tsx) already
      // treats a null session as "show sign-in", not a crash.
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    const encrypted = await this._encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }
}

/**
 * Platform fallback. expo-secure-store has no web implementation — confirmed against the
 * installed package: `node_modules/expo-secure-store/src/ExpoSecureStore.web.ts` exports an
 * empty `{}`, so on web every `SecureStore.*Async` call above would throw
 * ("getValueWithKeyAsync is not a function") instead of degrading gracefully. `npm run web` is
 * a supported command in this project (CLAUDE.md), so this cannot be left to throw.
 *
 * Deliberate choice: on web, skip the SecureStore/AES layer entirely and use AsyncStorage
 * directly (react-native-web backs it with `localStorage`) — unencrypted, exactly like this
 * project's behavior everywhere before issue #38. This is not a new weakness introduced for
 * web specifically: browsers have no Keychain/Keystore equivalent to move to, and every other
 * web app's session sits in `localStorage` or a cookie under the same threat model. The actual
 * fix in this issue — Keychain/Keystore-backed storage — lands for iOS/Android, which is this
 * project's real target (an Expo/React Native app, part of the PACE family per CLAUDE.md);
 * `npm run web` is a dev convenience, not a shipping target.
 *
 * Exposed as a factory (rather than resolving `Platform.OS` inline at the call site) so both
 * branches are directly unit-testable without mocking the `react-native` module.
 */
export function createSecureSessionStorage(
  platformOS: typeof Platform.OS = Platform.OS
): SupportedStorage {
  if (platformOS === 'web') {
    return AsyncStorage;
  }
  return new LargeSecureStore();
}

export const secureSessionStorage = createSecureSessionStorage();
