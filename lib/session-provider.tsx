import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { Copy } from '@/constants/copy';

import { startAppStateSync } from './app-state';
import { createSessionFromUrl } from './auth';
import { mapAuthError } from './auth-errors';
import { onSessionRestoreFailure } from './secure-storage';
import { supabase } from './supabase';

type SessionContextValue = {
  /** null = signed out; undefined would mean "not checked yet", which `isLoading` covers instead. */
  session: Session | null;
  /** True until the initial getSession() check resolves. Gates routing so a signed-in user
   * never flashes the sign-in screen, and a signed-out user never flashes Home, on cold start. */
  isLoading: boolean;
  /**
   * Issue #5: a mapped, user-readable message when the Linking-listener path below — the
   * deep-link fallback for an OAuth redirect that didn't complete inside signInWithGoogle's own
   * awaited call (lib/auth.ts) — fails. That awaited call is where app/(auth)/sign-in.tsx's own
   * try/catch lives; this path runs independently of it (that's the whole reason it exists, per
   * the comment below), so a failure here has nowhere else to surface unless this provider
   * carries it out itself. `createSessionFromUrl` only ever throws for a URL that really was
   * part of an auth redirect (a provider error or a genuine exchange failure) — it returns null,
   * not a rejection, for any unrelated deep link — so every value landing here is guaranteed
   * auth-relevant and safe to show. Null when there's nothing to report.
   */
  deepLinkAuthError: string | null;
  /** Consumed by app/(auth)/sign-in.tsx so a stale message doesn't linger into the next attempt. */
  clearDeepLinkAuthError: () => void;
  /**
   * Issue #38: a user-readable message when `lib/secure-storage.ts` had to discard a stored
   * session instead of restoring it (torn write, corrupted/rotated key, tampered data) — see
   * that module's `onSessionRestoreFailure`. `getSession()`'s storage read can only come back as
   * "there is a session" or "there is none" (that's `SupportedStorage`'s whole contract), so
   * without this a real, previously-good session that failed to restore is indistinguishable
   * from a user who was simply never signed in — the exact bug class issue #5 fixed for the
   * OAuth redirect path, which is why both live side by side here. `Copy.auth.error.generic`
   * ("Sign-in didn't go through. Try again.") is reused rather than a purpose-written string:
   * the copy deck's own guidance for that key is to fall back to it for "any other auth failure"
   * that doesn't have a specific string yet, and this genuinely doesn't have one — see
   * `lib/secure-storage.ts`'s module doc for why a more precise string ("we couldn't restore
   * your saved sign-in") is future `ux-copywriter` work, not invented here. Null when there's
   * nothing to report.
   */
  corruptedSessionError: string | null;
  /** Consumed by app/(auth)/sign-in.tsx so a stale message doesn't linger into the next attempt. */
  clearCorruptedSessionError: () => void;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

/**
 * Owns the single source of truth for auth state, via supabase.auth.onAuthStateChange —
 * app/_layout.tsx wraps the app in this and gates its Stack.Protected groups on `session`.
 *
 * Also carries a defensive fallback for the OAuth redirect: WebBrowser.openAuthSessionAsync
 * (lib/auth.ts) is the primary path and handles the exchange itself, but if the browser sheet
 * gets dismissed before that promise resolves (e.g. the app was backgrounded mid-flow), the OS
 * may still deliver the redirect as a plain deep link. Listening for it here means that case
 * completes sign-in too instead of leaving the user stuck on the sign-in screen after a
 * successful Google auth. `createSessionFromUrl` already no-ops on any URL that isn't part of
 * an auth redirect, so feeding every deep link through this is safe — and, since issue #5, a
 * FAILED exchange on this path is reported through `deepLinkAuthError` instead of discarded, so
 * app/(auth)/sign-in.tsx can show it even though this path runs outside that screen's own
 * try/catch.
 */
export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [deepLinkAuthError, setDeepLinkAuthError] = useState<string | null>(null);
  const [corruptedSessionError, setCorruptedSessionError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    // Registered BEFORE getSession() below runs, not after: getSession()'s own storage read is
    // what can trigger `onSessionRestoreFailure` (lib/secure-storage.ts), and this has to be
    // subscribed in time to catch that specific call, not just later ones (a token refresh,
    // say). Both live in the same effect for exactly that ordering guarantee.
    const unsubscribeRestoreFailure = onSessionRestoreFailure(() => {
      if (isMounted) setCorruptedSessionError(Copy.auth.error.generic);
    });

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!isMounted) return;
        setSession(data.session);
        setIsLoading(false);
      })
      .catch(() => {
        // A rejected AsyncStorage read (real on Android) must not leave isLoading=true
        // forever — that would hold the splash screen up indefinitely (app/_layout.tsx's
        // isReady gate). Signed-out is the safe fallback; onAuthStateChange below still
        // fires normally if a session shows up later.
        if (isMounted) {
          setSession(null);
          setIsLoading(false);
        }
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!isMounted) return;
      setSession(newSession);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      unsubscribeRestoreFailure();
    };
  }, []);

  // Issue #10: the ONE AppState listener in this app (lib/app-state.ts) — re-arms Supabase's
  // token-refresh ticker on foreground and stops it on background, since autoRefreshToken: true
  // alone (lib/supabase.ts) does not survive JS being suspended. Also the foundation issue #64's
  // Analyzing-screen reconciliation subscribes to via `onAppForeground`, rather than registering
  // its own second listener — see lib/app-state.ts's header for why that matters.
  useEffect(() => {
    return startAppStateSync();
  }, []);

  useEffect(() => {
    let isMounted = true;

    // Issue #5: this used to be `.catch(() => {})` on both branches below — every failure here
    // (a provider-denied redirect, an expired/mismatched PKCE verifier, a network error) was
    // discarded with nothing shown to the user, who'd simply land back on sign-in wondering what
    // happened. `createSessionFromUrl`'s contract (see its doc comment in lib/auth.ts) makes this
    // safe to always surface: it returns null, not a rejection, for any deep link that isn't
    // part of an auth redirect at all, so nothing lands in this catch except a genuine
    // auth-relevant failure.
    function reportDeepLinkFailure(err: unknown) {
      if (isMounted) setDeepLinkAuthError(mapAuthError(err));
    }

    // Catches a redirect already pending when the app launches cold (e.g. the OS relaunched
    // the app to deliver it) in addition to ones that arrive while already running.
    Linking.getInitialURL()
      .then((url) => {
        if (url) createSessionFromUrl(url).catch(reportDeepLinkFailure);
      })
      .catch(() => {});

    const subscription = Linking.addEventListener('url', ({ url }) => {
      createSessionFromUrl(url).catch(reportDeepLinkFailure);
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  const clearDeepLinkAuthError = useCallback(() => setDeepLinkAuthError(null), []);
  const clearCorruptedSessionError = useCallback(() => setCorruptedSessionError(null), []);

  const value = useMemo(
    () => ({
      session,
      isLoading,
      deepLinkAuthError,
      clearDeepLinkAuthError,
      corruptedSessionError,
      clearCorruptedSessionError,
    }),
    [
      session,
      isLoading,
      deepLinkAuthError,
      clearDeepLinkAuthError,
      corruptedSessionError,
      clearCorruptedSessionError,
    ]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
