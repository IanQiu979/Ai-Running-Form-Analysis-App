// Must run before @supabase/supabase-js touches `crypto` — see crypto-polyfill.ts for why.
import './crypto-polyfill';
// supabase-js's postgrest/storage clients use the `URL` global; Hermes' is incomplete.
import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';

import type { Database } from './database.types';
import { secureSessionStorage } from './secure-storage';

// Static dot access only (never destructured) — the expo/no-dynamic-env-var lint rule
// requires this, and CLAUDE.md documents why: EXPO_PUBLIC_* vars are inlined into the
// bundle at build time via static replacement, so dynamic/bracket access silently
// resolves to undefined instead of the real value.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copy ' +
      '.env.example to .env and fill in the Supabase project values (see CLAUDE.md § Secrets & env).'
  );
}

// The `Database` generic (lib/database.types.ts, generated from the live schema — issue #32)
// is what makes every `.from(...)`/`.rpc(...)` call below get checked against the real
// column/RPC shapes at compile time, instead of resolving to `any` and only failing at runtime.
export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
  auth: {
    // SecureStore-backed (Keychain/Keystore), not plaintext AsyncStorage — issue #38,
    // docs/status.md Known Issue #13. See lib/secure-storage.ts for the "LargeSecureStore"
    // design (SecureStore's ~2KB value limit vs. a full session payload), the transparent
    // migration for sessions written by the old plaintext adapter, and the web fallback.
    storage: secureSessionStorage,
    // Necessary but NOT sufficient on mobile on its own — the refresh ticker this enables does
    // not run while JS is suspended. lib/app-state.ts's AppState listener (started once from
    // lib/session-provider.tsx, issue #10) is what re-arms it on foreground / stops it on
    // background; see that file's header for the full contract.
    autoRefreshToken: true,
    persistSession: true,
    // The client never parses a session out of the current URL — deep-link OAuth
    // redirects are handled explicitly in lib/auth.ts (WebBrowser.openAuthSessionAsync
    // + createSessionFromUrl), not by supabase-js scanning window.location (which
    // doesn't meaningfully exist in React Native anyway).
    detectSessionInUrl: false,
    // Explicit even though it's supabase-js's own default — PKCE is what makes the
    // OAuth code exchange in lib/auth.ts valid, and the crypto polyfill above exists
    // specifically to keep this flow on real S256 rather than silently degrading.
    flowType: 'pkce',
  },
});
