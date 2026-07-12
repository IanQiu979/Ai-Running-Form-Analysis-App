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
import type { Session } from '@supabase/supabase-js';
import { makeRedirectUri } from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import * as WebBrowser from 'expo-web-browser';

import { OAuthRedirectError } from './auth-errors';
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
// createSessionFromUrl twice concurrently — plus signInWithGoogle's own awaited call to it is a
// third potential caller for the same code.
//
// Issue #5: the previous fix for this (a `Set` of codes already "handed to
// exchangeCodeForSession", added to *before* the exchange resolved and never removed on
// failure) made the underlying bug worse, not safer. The loser of the race got `null` back with
// no way to tell "this code was legitimately consumed already" apart from "the winner's exchange
// just failed and its error was swallowed elsewhere" — which is exactly what happened:
// session-provider.tsx's Linking listener would lose the race, its exchange would throw, that
// throw was swallowed by a bare `.catch(() => {})`, and signInWithGoogle's own call then saw the
// code marked processed and returned `null` — which app/(auth)/sign-in.tsx treats as "user
// cancelled" and shows nothing.
//
// Caching the in-flight PROMISE instead of a "seen" flag fixes both problems at once: every
// caller racing on the same code awaits the exact same exchange and gets the exact same outcome
// — success or the real thrown error, never a silent `null`. The entry is removed once the
// exchange settles either way, so this doesn't grow unbounded (the old Set's other bug) and a
// reused code (rare, but not impossible) isn't stuck rejecting forever off a stale failure.
const inFlightExchanges = new Map<string, Promise<Session | null>>();

/**
 * Completes a PKCE OAuth exchange from a redirect URL — either the URL
 * WebBrowser.openAuthSessionAsync resolved with, or one delivered via a Linking 'url' event.
 *
 * Returns null for a URL that isn't part of an auth redirect at all (no `code` and no `error`
 * param), so callers can safely feed every deep link through this without it exploding on
 * unrelated links. Every OTHER path either resolves to a session or throws — it never swallows a
 * failure itself, so callers (app/(auth)/sign-in.tsx directly, and lib/session-provider.tsx for
 * the deep-link fallback path) are responsible for surfacing whatever they catch, typically via
 * `mapAuthError` (lib/auth-errors.ts). Throws `OAuthRedirectError` when the provider itself
 * reported an outcome in the redirect (e.g. `error=access_denied`); throws whatever
 * `exchangeCodeForSession` throws/returns for a genuine exchange failure (bad/expired code, a
 * missing or mismatched PKCE verifier, network).
 */
export async function createSessionFromUrl(url: string): Promise<Session | null> {
  const { params, errorCode } = QueryParams.getQueryParams(url);
  if (errorCode) throw new Error(errorCode);

  if (params.error) {
    throw new OAuthRedirectError(params.error, params.error_description);
  }

  const { code } = params;
  if (!code) return null;

  let exchange = inFlightExchanges.get(code);
  if (!exchange) {
    exchange = supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
      if (error) throw error;
      return data.session;
    });
    inFlightExchanges.set(code, exchange);
    // Cleanup only — deliberately swallows the rejection on THIS branch specifically. The real
    // rejection still reaches every caller awaiting `exchange` itself below; this second
    // listener exists solely to evict the map entry once the exchange settles and must not
    // itself surface as an unhandled rejection for a promise nobody else is watching.
    exchange.catch(() => {}).finally(() => {
      inFlightExchanges.delete(code);
    });
  }
  return exchange;
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
