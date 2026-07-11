import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { createSessionFromUrl } from './auth';
import { supabase } from './supabase';

type SessionContextValue = {
  /** null = signed out; undefined would mean "not checked yet", which `isLoading` covers instead. */
  session: Session | null;
  /** True until the initial getSession() check resolves. Gates routing so a signed-in user
   * never flashes the sign-in screen, and a signed-out user never flashes Home, on cold start. */
  isLoading: boolean;
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
 * an auth redirect, so feeding every deep link through this is safe.
 */
export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

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
    };
  }, []);

  useEffect(() => {
    // Catches a redirect already pending when the app launches cold (e.g. the OS relaunched
    // the app to deliver it) in addition to ones that arrive while already running.
    Linking.getInitialURL().then((url) => {
      if (url) createSessionFromUrl(url).catch(() => {});
    });

    const subscription = Linking.addEventListener('url', ({ url }) => {
      createSessionFromUrl(url).catch(() => {});
    });

    return () => subscription.remove();
  }, []);

  const value = useMemo(() => ({ session, isLoading }), [session, isLoading]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
