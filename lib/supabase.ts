// Must run before @supabase/supabase-js touches `crypto` — see crypto-polyfill.ts for why.
import './crypto-polyfill';
// supabase-js's postgrest/storage clients use the `URL` global; Hermes' is incomplete.
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

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

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: AsyncStorage,
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
