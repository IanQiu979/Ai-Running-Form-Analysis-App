/**
 * Google browser-OAuth flow, ported from Echo V1's working pattern
 * (react-native-supabase-practice/app/onboarding.tsx `handleSocialSignIn`), adapted to use
 * expo-auth-session's own `QueryParams.getQueryParams` helper instead of V1's hand-rolled
 * URL parsing. `getQueryParams` uses `new URL(...)` internally, which already strips/ignores
 * an empty trailing `#` fragment correctly — V1 needed a manual `.split('#')[0]` workaround
 * for exactly that case (a bare `#` Supabase appends to the redirect gluing onto the code
 * value and failing PKCE exchange with "invalid flow state, no valid flow state found");
 * the official helper doesn't have that bug, so it isn't ported here.
 *
 * Flow: skipBrowserRedirect + WebBrowser.openAuthSessionAsync intercepts the redirect at the
 * browser layer (ASWebAuthenticationSession / Custom Tabs) and resolves with the final URL
 * directly — no app route ever needs to exist at the redirect path for this to work. The
 * session-provider's Linking listener (lib/session-provider.tsx) is a defensive second path
 * for the rarer case where the OS delivers the redirect as a deep link instead (e.g. the
 * browser session was dismissed before openAuthSessionAsync's promise resolved).
 */
import { makeRedirectUri } from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from './supabase';

// Required once at module scope per Expo's own docs (supabase.com/docs/guides/auth/native-mobile-deep-linking) —
// completes the auth session on web when the redirect lands back on the page itself; a no-op
// on native, where openAuthSessionAsync intercepts the redirect before the OS ever navigates.
WebBrowser.maybeCompleteAuthSession();

// Explicit scheme (matches app.json's "scheme": "paceanalysisai") + path, same shape as V1's
// `makeRedirectUri({ scheme, path: 'oauth-callback' })` — gives a deterministic redirect URI
// that's allowlisted exactly in the live project (see supabase/config.toml's
// additional_redirect_urls comment for the exact entries and why).
export const oauthRedirectTo = makeRedirectUri({
  scheme: 'paceanalysisai',
  path: 'oauth-callback',
});

// Android double-delivery: expo-web-browser's openAuthSessionAsync polyfill races its own
// Linking listener against SessionProvider's listener, so the same OAuth redirect can reach
// createSessionFromUrl twice concurrently. Track codes already handed to
// exchangeCodeForSession so the loser of that race skips the exchange instead of throwing a
// consumed-code error.
const processedOAuthCodes = new Set<string>();

/**
 * Completes a PKCE OAuth exchange from a redirect URL — either the URL
 * WebBrowser.openAuthSessionAsync resolved with, or one delivered via a Linking 'url' event.
 * Returns null for a URL that isn't part of an auth redirect at all (no `code` or `error`
 * param), so callers can safely feed every deep link through this without it exploding on
 * unrelated links.
 */
export async function createSessionFromUrl(url: string) {
  const { params, errorCode } = QueryParams.getQueryParams(url);
  if (errorCode) throw new Error(errorCode);

  const oauthError = params.error_description ?? params.error;
  if (oauthError) throw new Error(oauthError);

  const { code } = params;
  if (!code) return null;
  if (processedOAuthCodes.has(code)) return null;
  processedOAuthCodes.add(code);

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
  return data.session;
}

/**
 * Starts Google sign-in/sign-up via the browser OAuth flow and completes the PKCE exchange.
 * Returns null on user cancel/dismiss (not an error — the caller shouldn't show an error
 * banner for a closed browser sheet). On success, supabase-js's own onAuthStateChange fires
 * from exchangeCodeForSession internally, so callers don't need to navigate manually — the
 * session-provider-driven Stack.Protected guard in app/_layout.tsx reacts to the new session.
 */
export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: oauthRedirectTo, skipBrowserRedirect: true },
  });
  if (error || !data?.url) {
    throw error ?? new Error('Unable to start Google sign-in.');
  }

  // preferEphemeralSession forces a fresh Google login form each time instead of silently
  // reusing a shared Safari cookie session, which was the actual root cause behind V1's
  // "invalid flow state" reports in practice (a stale silent session completing against an
  // already-consumed PKCE verifier) — ported from the same ground-truth fix.
  const result = await WebBrowser.openAuthSessionAsync(data.url, oauthRedirectTo, {
    preferEphemeralSession: true,
  });

  if (result.type === 'cancel' || result.type === 'dismiss') return null;
  if (result.type !== 'success' || !result.url) {
    throw new Error('Sign-in did not complete. Ensure the redirect URL is registered in Supabase.');
  }

  return createSessionFromUrl(result.url);
}
