/**
 * In-app copy, lifted verbatim by key from `docs/design/copy-deck.md`.
 *
 * The deck keys every string `screen.section.element.state` and says to lift them verbatim
 * as each screen is built, grouped by screen in the order the brief lists them (§4) — this
 * file follows that structure but only carries the keys the screens built so far actually
 * use (App identity — the wordmark, Screen 1 — Sign in / Sign up, Screen 2 — Home / Analyze,
 * plus one Screen 11 — Settings key reused early because `settings.signOut.cta` needed a home
 * before the Settings screen itself exists — see app/(tabs)/index.tsx). Later phases extend
 * this file rather than duplicating strings inline in JSX; do not hand-write copy in a
 * component when a deck key exists for it.
 */

import { PASSWORD_MIN_LENGTH } from './validation';

export const Copy = {
  app: {
    // Exact casing, everywhere it appears as a string — never "PACE AnalysisAI" (copy-deck.md
    // intro). Currently only the sign-in wordmark; reuse this rather than retyping the name.
    name: 'Pace AnalysisAI',
  },
  auth: {
    valueProp:
      'Submit a photo or video of your run and get clear, specific feedback on your form.',
    cta: {
      google: 'Continue with Google',
      email: 'Continue with email',
    },
    email: {
      placeholder: 'Email',
    },
    password: {
      placeholder: 'Password',
      // Sign-up mode only (irrelevant on sign-in) — discloses the length rule before submit
      // instead of only after a failed attempt (issue #9). Templated off the same
      // PASSWORD_MIN_LENGTH constant as the pre-check in sign-in.tsx and the error string
      // below, so this and they can't drift from each other.
      rule: `Must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    },
    signIn: {
      submit: 'Sign in',
      link: 'Already have an account? Sign in',
    },
    signUp: {
      submit: 'Create account',
      link: 'New here? Create an account',
    },
    error: {
      // No "or reset your password" — there is no forgot-password link, reset screen, or
      // resetPasswordForEmail call anywhere in the app (issue #18). Only re-add that clause
      // in the same change that ships the route it points at.
      invalidCredentials: "Email or password doesn't match. Try again.",
      emailInUse: 'An account already exists with this email. Sign in instead.',
      generic: "Sign-in didn't go through. Try again.",
      passwordBreached:
        'That password has shown up in a data breach before. Pick a different one to keep your account secure.',
      // Templated off PASSWORD_MIN_LENGTH (constants/validation.ts), which must match
      // `minimum_password_length` in supabase/config.toml — that value is the only authority on
      // the actual rule (see app/(auth)/sign-in.tsx's client-side pre-check and `mapAuthError`,
      // both of which mirror it). Raising the config value without updating the constant would
      // make the copy lie to users.
      passwordTooShort: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    },
  },
  home: {
    // The tab label (app/(tabs)/_layout.tsx) — there is no separate on-screen heading: a
    // literal "Home" heading directly above a tab already labelled "Home" is redundant chrome,
    // dropped per issue #30's audit note (Home is a motif + a CTA, per the design brief, not a
    // headline screen).
    title: 'Home',
    cta: {
      analyze: 'Analyze my form',
    },
    quota: {
      free: {
        available: '1 free analysis available',
      },
      exhausted: {
        free: "You've used your free analysis",
      },
      loading: 'Checking your plan…',
      error: {
        stale: 'Showing your last known plan status.',
        // `home.quota.error.retry` is defined verbatim in the deck (§Screen 2), reusing
        // `shared.cta.retry`'s "Retry" string. `failed` has no deck entry — the deck only
        // covers the "stale" case (a prior successful fetch to fall back to); this is the
        // narrower case where the very first fetch fails and there is nothing to show yet.
        retry: 'Retry',
        failed: "Couldn't load your plan status.",
      },
    },
    empty: {
      caption: 'Nothing analyzed yet.',
    },
  },
  settings: {
    signOut: {
      cta: 'Sign out',
    },
  },
} as const;
