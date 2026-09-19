/**
 * Deno-only `SignUpClient` (`signup-with-captcha.ts`'s injected interface) built on real
 * `supabase-js` clients. Lives outside `signup-with-captcha.ts` because it touches
 * `npm:@supabase/supabase-js` and `Deno.env` (through `supabase-keys.ts`), keeping that file
 * Deno/Jest-portable — same split `_shared/purchase-tier-client.ts` uses for
 * `_shared/purchase-tier.ts`'s `RpcClient`.
 *
 * TWO CALLS, TWO KEYS (issue #48 residual, 2026-09-19). Account creation goes through
 * `auth.admin.createUser` with the SECRET key, then a session is minted with a plain
 * `auth.signInWithPassword` on the PUBLISHABLE key. Until this change the function proxied one
 * unprivileged `auth.signUp()` — which is GoTrue's `/auth/v1/signup`, the very route the
 * `before-user-created` hook (`supabase/migrations/20260919140000_before_user_created_hook.sql`)
 * now closes for the `email` provider so that no account can be created without the Turnstile
 * check that runs in front of this client. The admin API is the one creation path GoTrue does
 * not route through that hook, and it still runs the same password-strength checks
 * (`minimum_password_length`, HIBP when enabled) as `/signup` did, so nothing relaxes.
 *
 * The secret key is used for exactly one call and never leaves this module; `signInWithPassword`
 * deliberately uses the publishable key so the returned session is an ordinary user session,
 * identical to what the sign-in screen gets.
 *
 * `createSignUpClient(auth?)` takes the two auth surfaces as an injectable pair so the outcome
 * mapping below is unit-tested (`__tests__/signup-client.deno.test.ts`) without a live project;
 * the default builds them from the platform-injected env.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.110.2';
import type { SessionPayload, SignUpClient, SignUpOutcome } from './signup-with-captcha.ts';
import { getPublishableKey, getSecretKey, getSupabaseUrl } from './supabase-keys.ts';

/** The subset of `supabase-js` this client depends on — narrow so tests can fake it. */
export interface AuthErrorLike {
  message: string;
  code?: string | null;
  status?: number;
  /** `AuthWeakPasswordError` carries this; every other `AuthError` does not. */
  reasons?: unknown;
}

export interface SessionLike {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type: string;
  user: { id: string; email?: string };
}

export interface SignUpAuthSurface {
  /** `auth.admin.createUser` on a secret-key client. */
  createUser(params: { email: string; password: string; email_confirm: boolean }): Promise<{
    data: { user: { id: string; email?: string } | null };
    error: AuthErrorLike | null;
  }>;
  /** `auth.signInWithPassword` on a publishable-key client. */
  signInWithPassword(params: { email: string; password: string }): Promise<{
    data: { session: SessionLike | null };
    error: AuthErrorLike | null;
  }>;
}

function defaultAuthSurface(): SignUpAuthSurface {
  const url = getSupabaseUrl();
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, getSecretKey(), options);
  const user = createClient(url, getPublishableKey(), options);
  return {
    createUser: (params) => admin.auth.admin.createUser(params),
    signInWithPassword: (params) => user.auth.signInWithPassword(params),
  };
}

/** GoTrue's code for `POST /admin/users` on an already-registered address. */
const EMAIL_EXISTS_CODE = 'email_exists';

function isWeakPassword(error: AuthErrorLike): error is AuthErrorLike & { reasons: string[] } {
  // `AuthWeakPasswordError` carries a `.reasons` array (e.g. `['length']`, `['pwned']`, or both)
  // alongside every other `AuthError` field — duck-typed rather than imported via
  // `isAuthWeakPasswordError` to avoid pulling in `@supabase/auth-js` as a second package just
  // for one type guard. The admin API raises the same error class as `/signup` does.
  return Array.isArray(error.reasons) && error.reasons.every((r) => typeof r === 'string');
}

function toSessionPayload(session: SessionLike): SessionPayload {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
    expiresAt: session.expires_at ?? null,
    tokenType: session.token_type,
  };
}

export function createSignUpClient(auth: SignUpAuthSurface = defaultAuthSurface()): SignUpClient {
  return {
    async signUp(email: string, password: string): Promise<SignUpOutcome> {
      // `email_confirm: true` because `mailer_autoconfirm` governs `/signup` only; the admin API
      // creates an unconfirmed user unless told otherwise, and an unconfirmed user cannot sign in
      // with a password (`email_not_confirmed`), which would turn every sign-up into a dead end.
      const created = await auth.createUser({ email, password, email_confirm: true });

      if (created.error) {
        const { error } = created;
        if (error.code === EMAIL_EXISTS_CODE) {
          return { outcome: 'email_in_use' };
        }
        if (isWeakPassword(error)) {
          return { outcome: 'weak_password', message: error.message, reasons: error.reasons };
        }
        return { outcome: 'error', message: error.message, code: error.code ?? null };
      }

      const signedIn = await auth.signInWithPassword({ email, password });

      if (signedIn.error || !signedIn.data.session) {
        // The account exists at this point. Surface it as the sessionless branch the handler
        // already maps to a 500 (`no_session`) rather than as a 400 the user would retry into
        // `email_in_use`; the sign-in screen recovers them with the password they just chose.
        return {
          outcome: 'created_no_session',
          user: { id: created.data.user?.id ?? '', email: created.data.user?.email ?? null },
        };
      }

      const { session } = signedIn.data;
      return {
        outcome: 'created',
        session: toSessionPayload(session),
        user: { id: session.user.id, email: session.user.email ?? null },
      };
    },
  };
}
