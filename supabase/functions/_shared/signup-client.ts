/**
 * Deno-only `SignUpClient` (`signup-with-captcha.ts`'s injected interface) that proxies
 * `supabase.auth.signUp()` via a real `supabase-js` client. Lives outside `signup-with-captcha.ts`
 * because it touches `npm:@supabase/supabase-js` and `Deno.env` (through `supabase-keys.ts`),
 * keeping that file Deno/Jest-portable — same split `_shared/purchase-tier-client.ts` uses for
 * `_shared/purchase-tier.ts`'s `RpcClient`.
 *
 * Built with the PUBLISHABLE key, not the service-role key — this is a plain, unprivileged
 * `signUp()` call, identical to what `app/(auth)/sign-in.tsx` used to call directly. See
 * `signup-with-captcha.ts`'s header for why that matters (GoTrue's own password-length/HIBP
 * enforcement stays intact, no admin API involved).
 */
import { createClient } from 'npm:@supabase/supabase-js@2.110.2';
import type { SignUpClient, SignUpOutcome } from './signup-with-captcha.ts';
import { getPublishableKey, getSupabaseUrl } from './supabase-keys.ts';

export function createSignUpClient(): SignUpClient {
  const client = createClient(getSupabaseUrl(), getPublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async signUp(email: string, password: string): Promise<SignUpOutcome> {
      const { data, error } = await client.auth.signUp({ email, password });

      if (error) {
        // `AuthWeakPasswordError` carries a `.reasons` array (e.g. `['length']`, `['pwned']`, or
        // both) alongside every other `AuthError` field — duck-typed rather than imported via
        // `isAuthWeakPasswordError` to avoid pulling in `@supabase/auth-js` as a second package
        // just for one type guard.
        const maybeReasons = (error as { reasons?: unknown }).reasons;
        if (Array.isArray(maybeReasons) && maybeReasons.every((r) => typeof r === 'string')) {
          return { outcome: 'weak_password', message: error.message, reasons: maybeReasons };
        }
        return { outcome: 'error', message: error.message, code: error.code ?? null };
      }

      if (!data.session) {
        // Ported from `app/(auth)/sign-in.tsx`'s existing detection: Supabase deliberately
        // returns `{ error: null, session: null }` for an already-registered email, with an
        // empty `identities` array as the only tell — it avoids leaking which emails exist by
        // erroring outright.
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          return { outcome: 'email_in_use' };
        }
        return {
          outcome: 'created_no_session',
          user: { id: data.user?.id ?? '', email: data.user?.email ?? null },
        };
      }

      const { session } = data;
      return {
        outcome: 'created',
        session: {
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          expiresIn: session.expires_in,
          expiresAt: session.expires_at ?? null,
          tokenType: session.token_type,
        },
        user: { id: session.user.id, email: session.user.email ?? null },
      };
    },
  };
}
