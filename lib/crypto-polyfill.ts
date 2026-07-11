/**
 * WebCrypto polyfill for React Native (Hermes).
 *
 * Hermes does not expose the WebCrypto API. Supabase's PKCE OAuth flow needs
 * `crypto.getRandomValues` (to generate the code verifier) and
 * `crypto.subtle.digest('SHA-256', ...)` (to build the code challenge) — see
 * `@supabase/auth-js`'s `generatePKCEVerifier` / `generatePKCEChallenge` in
 * `lib/helpers.js`. Without a real `crypto.subtle`, `generatePKCEChallenge` silently
 * falls back to the `plain` challenge method instead of `S256` (it only warns via
 * `console.warn`, never throws), which is a real but weaker PKCE variant — ground-truthed
 * in Echo V1 (`react-native-supabase-practice/lib/cryptoPolyfill.ts`) as the cause of
 * Google sign-in failing with "invalid flow state, no valid flow state found" there.
 * This shim backs both calls with `expo-crypto` (already a dependency) so PKCE always
 * uses real SHA-256, matching what the server-side flow-state check expects.
 *
 * Must be imported before `@supabase/supabase-js` creates any client — see
 * `lib/supabase.ts`, which imports this file first for exactly that reason. Existing
 * implementations are left untouched; this only fills in what Hermes doesn't provide.
 */
import * as ExpoCrypto from 'expo-crypto';

// `any` is deliberate here, not a shortcut: this file's only job is monkey-patching globals
// that TypeScript's DOM lib types (Crypto.subtle is declared read-only) don't model as
// mutable, and every write below is guarded by a typeof/existence check that only fills in
// what's actually missing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;

if (!g.crypto) {
  g.crypto = {};
}

if (typeof g.crypto.getRandomValues !== 'function') {
  g.crypto.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => {
    if (array === null) return array;
    ExpoCrypto.getRandomValues(array as unknown as Uint8Array | Int8Array | Uint16Array);
    return array;
  }) as Crypto['getRandomValues'];
}

if (!g.crypto.subtle) {
  g.crypto.subtle = {};
}

if (typeof g.crypto.subtle.digest !== 'function') {
  const ALGO_MAP: Record<string, ExpoCrypto.CryptoDigestAlgorithm> = {
    'SHA-1': ExpoCrypto.CryptoDigestAlgorithm.SHA1,
    'SHA-256': ExpoCrypto.CryptoDigestAlgorithm.SHA256,
    'SHA-384': ExpoCrypto.CryptoDigestAlgorithm.SHA384,
    'SHA-512': ExpoCrypto.CryptoDigestAlgorithm.SHA512,
  };

  g.crypto.subtle.digest = (async (
    algorithm: AlgorithmIdentifier,
    data: BufferSource
  ): Promise<ArrayBuffer> => {
    const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
    const expoAlgo = ALGO_MAP[name];
    if (!expoAlgo) throw new Error(`Unsupported digest algorithm: ${name}`);
    const bytes =
      data instanceof Uint8Array
        ? data
        : new Uint8Array('buffer' in data ? data.buffer : (data as ArrayBuffer));
    const digest = await ExpoCrypto.digest(expoAlgo, bytes);
    return digest as ArrayBuffer;
  }) as SubtleCrypto['digest'];
}
