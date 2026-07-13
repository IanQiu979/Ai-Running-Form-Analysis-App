/**
 * Session storage adapter for supabase-js — the "LargeSecureStore" pattern (issue #38,
 * `docs/status.md` Known Issue #13; torn-write hardening is a same-branch follow-up requested
 * in review, see "STABLE KEY, PER-WRITE IV" below).
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
 * STABLE KEY, PER-WRITE IV (torn-write hardening): the key and the ciphertext live in two
 * separate stores (SecureStore, AsyncStorage) that cannot be written atomically as a pair.
 * Supabase's own documented recipe generates a FRESH key on every write, which means every
 * single `setItem` is a two-store transaction — and a `setItem` that is interrupted between
 * the two writes (app killed, device out of storage, the write throws) leaves either a new key
 * paired with an old blob, or an old key paired with a new blob. AES-CTR does not error on a
 * wrong key/IV — it produces well-formed-looking garbage — so the next `getItem` would silently
 * "succeed" with nonsense, and the session is gone with no explanation (the same bug class as
 * issue #5: a real failure laundered into "no session").
 *
 * This class instead generates the AES-256 key exactly ONCE per storage key (`_getOrCreateKey`,
 * below) and reads it back on every subsequent read/write. After that first write there is no
 * longer a key/blob *pair* to tear — SecureStore is never written to again for that key, and
 * every later `setItem` touches only AsyncStorage (a single store, so nothing to interleave a
 * torn write across). CTR mode stays safe with a stable key because a fresh random 16-byte IV
 * (the AES block size — independent of the AES-256 key length) is generated on every write and
 * prepended to the ciphertext it belongs to, so the keystream is never reused even though the
 * key doesn't change; this is the whole reason the "fresh key every write" trick was needed in
 * the first place, and a per-write IV removes that need. See `getItem`'s doc comment for
 * exactly what surviving window this narrows the torn-write problem to (it is not fully
 * eliminated — the very first write for a storage key still touches two stores), why that
 * residual window is benign, and what happens when a stored blob turns out to be undecryptable
 * anyway (corrupted, torn, or genuinely tampered).
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

/** AES block size — always 16 bytes regardless of key length (AES-128/192/256 all use it),
 * and CTR mode's counter/IV is exactly this size. Hex-encoded, this is a fixed 32-char prefix
 * on every ciphertext this class writes, letting `_decrypt` split it back out deterministically
 * without needing a delimiter. */
const IV_BYTES = 16;
const IV_HEX_LENGTH = IV_BYTES * 2;

type SessionRestoreFailureListener = (storageKey: string) => void;

let sessionRestoreFailureListeners: SessionRestoreFailureListener[] = [];

/**
 * Subscribe to be told when `LargeSecureStore` had to discard a stored session instead of
 * restoring it — decrypted-but-not-valid-JSON, a decrypt that threw outright, or no SecureStore
 * key on file for an AsyncStorage blob that exists. `getItem`'s return type (`string | null`,
 * `SupportedStorage`'s contract) has no room to carry a reason; this is the side channel that
 * lets the app layer distinguish "we genuinely have no session" from "we HAD one and it could
 * not be restored," so it can say something honest instead of landing the user on sign-in with
 * no explanation. `lib/session-provider.tsx` is the consumer — same principle as issue #5's
 * `deepLinkAuthError` there, deliberately named differently so the two additions merge cleanly.
 * Returns an unsubscribe function.
 */
export function onSessionRestoreFailure(listener: SessionRestoreFailureListener): () => void {
  sessionRestoreFailureListeners.push(listener);
  return () => {
    sessionRestoreFailureListeners = sessionRestoreFailureListeners.filter((l) => l !== listener);
  };
}

function notifySessionRestoreFailure(storageKey: string): void {
  for (const listener of sessionRestoreFailureListeners) {
    listener(storageKey);
  }
}

export class LargeSecureStore implements SupportedStorage {
  /**
   * Serializes "read the AES key, or create it if this is the first write" per storage key.
   * Without this, two `setItem` calls racing on the very first write for the same key (e.g. two
   * auth events firing close together before anything has ever been persisted) could each find
   * no key in SecureStore, each generate a DIFFERENT random key, and each write it — the last
   * `SecureStore.setItemAsync` to land wins, silently orphaning whichever blob was encrypted
   * under the other key. A per-key promise chain (not a real OS-level lock) is sufficient
   * because the actual hazard is concurrent `await`s interleaving within this one running JS
   * process — the only place `setItem` calls for the same key can genuinely race. It does not
   * and cannot protect against two independent OS processes; that is not a real scenario for a
   * single-instance mobile app (a killed process cannot race anything — a relaunch runs after
   * it, not alongside it).
   */
  private keyCreationLocks = new Map<string, Promise<unknown>>();

  private async _runExclusive<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.keyCreationLocks.get(lockKey) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    // A "safe" tail that always resolves (never rejects) so one failed call doesn't wedge every
    // later call queued behind it — only `run` itself, returned below, carries the real outcome.
    this.keyCreationLocks.set(
      lockKey,
      run.catch(() => undefined)
    );
    return run;
  }

  private async _getOrCreateKey(key: string): Promise<Uint8Array> {
    return this._runExclusive(key, async () => {
      const existingHex = await SecureStore.getItemAsync(key);
      if (existingHex) {
        return aesjs.utils.hex.toBytes(existingHex);
      }

      const newKey = getRandomBytes(AES_KEY_BYTES);
      await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(newKey));
      return newKey;
    });
  }

  private async _encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = await this._getOrCreateKey(key);
    const iv = getRandomBytes(IV_BYTES);
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(iv));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));

    // IV travels with the ciphertext it belongs to — this, not a fresh key every write, is what
    // keeps CTR mode safe now that the key is stable (see class doc). Fixed 32-char hex prefix.
    return aesjs.utils.hex.fromBytes(iv) + aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  /**
   * Returns the decrypted plaintext, or `null` specifically when there is no SecureStore key on
   * file to decrypt with (see `getItem` for what that means now that the key is stable, not
   * per-write). Throws for anything else that makes the ciphertext unreadable — too short to
   * contain an IV, or a key/IV of the wrong byte length once hex-decoded (`aes-js`'s `Counter`
   * and `AES` constructors both validate size and throw). Deliberately does NOT attempt to
   * validate that the decrypted bytes are a real session — a decrypt that "succeeds" with wrong
   * key/IV material produces well-formed-looking garbage, not an exception, so that check
   * belongs in the caller (`getItem`), which knows what a valid result should look like
   * (parseable JSON) and this method does not.
   */
  private async _decrypt(key: string, value: string): Promise<string | null> {
    const encryptionKeyHex = await SecureStore.getItemAsync(key);
    if (!encryptionKeyHex) {
      return null;
    }

    if (value.length < IV_HEX_LENGTH) {
      throw new Error('Stored value is too short to contain an IV');
    }

    const ivHex = value.slice(0, IV_HEX_LENGTH);
    const cipherHex = value.slice(IV_HEX_LENGTH);
    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(encryptionKeyHex),
      new aesjs.Counter(aesjs.utils.hex.toBytes(ivHex))
    );
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(cipherHex));

    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  /** Deletes whatever is stored under `key` in both stores and tells any subscriber
   * (`onSessionRestoreFailure`) that a stored session was discarded as unreadable — as opposed
   * to `removeItem`, which is a normal, intentional removal (e.g. sign-out) and does not
   * notify. `Promise.allSettled` so a failure removing one of the two doesn't stop the other,
   * and doesn't throw a second exception out of what is already an error-recovery path. */
  private async _clearCorrupted(key: string): Promise<void> {
    await Promise.allSettled([AsyncStorage.removeItem(key), SecureStore.deleteItemAsync(key)]);
    notifySessionRestoreFailure(key);
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
      const decrypted = await this._decrypt(key, raw);

      if (decrypted === null) {
        // AsyncStorage has a blob, but SecureStore has no key for it. With a STABLE key
        // (this class no longer rotates it per write), a torn write cannot produce this state
        // on its own: `setItem` always creates the key BEFORE it ever writes a blob, so a
        // process killed between the two leaves no blob at all, not a blob with no key — the
        // ordinary and correctly-handled "nothing was ever persisted" case above. The only
        // ways to reach this branch are the key being removed independently of the blob (a
        // sign-out's `removeItem` racing a concurrent read — narrow, and no worse than the
        // sign-out already correctly landing the user on sign-in with nothing to restore) or
        // the SecureStore entry being cleared by something outside this app (OS keychain
        // reset, manual tampering). Neither is "there was never a session"; treat it as
        // unreadable, not silently absent.
        throw new Error('No SecureStore key on file for a stored ciphertext blob');
      }

      // A decrypt that does not throw is NOT proof the plaintext is real. This is the crux of
      // the torn-write hazard: AES-CTR run with a mismatched key/IV (the residual torn-write
      // window above, or any other bit-level corruption) produces well-formed-looking garbage
      // bytes, not an error. A Supabase session is always a JSON object, so this is the actual
      // validity check — without it, garbage would sail through to supabase-js looking like a
      // real (broken) session instead of being caught here.
      JSON.parse(decrypted);
      return decrypted;
    } catch {
      // Deliberately NOT "return null" and stop there (see module doc): that would present a
      // real, previously-good session that failed to restore as indistinguishable from a user
      // who was simply never signed in — the exact bug class issue #5 fixed for the OAuth
      // redirect path. Clear the broken pairing so it can't linger and keep failing the same
      // way forever, and tell any subscriber so the app layer can say something honest instead
      // of silently landing the user on sign-in with no explanation.
      await this._clearCorrupted(key);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    const encrypted = await this._encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  }

  /** Intentional removal (sign-out, account deletion) — does not notify
   * `onSessionRestoreFailure`; there is nothing to explain to the user here; they asked for it. */
  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }
}

/**
 * SSR/static-export-safe stand-in for the web branch below (issue #119). `expo export
 * --platform web`'s static rendering prerenders every route in Node, where `window` does not
 * exist — but `@react-native-async-storage/async-storage`'s web implementation reaches for
 * `window.localStorage` completely unguarded (see
 * `node_modules/@react-native-async-storage/async-storage/lib/commonjs/AsyncStorage.js`), so
 * returning it as-is during prerender throws `ReferenceError: window is not defined` the
 * instant `supabase.auth` touches storage — which it does eagerly (GoTrueClient's constructor
 * kicks off session recovery itself, before any React effect runs), so this was unreachable to
 * guard from `lib/session-provider.tsx`. A no-op here is correct, not just crash-safe: a
 * prerendered page genuinely cannot see the browser's localStorage, so "no session" is the
 * only honest answer during prerender. The hydrated client bundle re-runs this module in an
 * actual browser (`window` defined there), and gets the real localStorage-backed AsyncStorage
 * from the branch below, same as always.
 */
const noopWebStorage: SupportedStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

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
 * Exposed as a factory (rather than resolving `Platform.OS`/`window` inline at the call site)
 * so all branches are directly unit-testable without mocking the `react-native` module or a
 * global.
 */
export function createSecureSessionStorage(
  platformOS: typeof Platform.OS = Platform.OS,
  hasWindow: boolean = typeof window !== 'undefined'
): SupportedStorage {
  if (platformOS === 'web') {
    return hasWindow ? AsyncStorage : noopWebStorage;
  }
  return new LargeSecureStore();
}

export const secureSessionStorage = createSecureSessionStorage();
