/**
 * In-app copy, lifted verbatim by key from `docs/design/copy-deck.md`.
 *
 * The deck keys every string `screen.section.element.state` and says to lift them verbatim
 * as each screen is built, grouped by screen in the order the brief lists them (§4) — this
 * file follows that structure but only carries the keys the screens built so far actually
 * use (Screen 1 — Sign in / Sign up, Screen 2 — Home / Analyze, plus one Screen 11 —
 * Settings key reused early because `settings.signOut.cta` needed a home before the Settings
 * screen itself exists — see app/(tabs)/index.tsx). Later phases extend this file rather than
 * duplicating strings inline in JSX; do not hand-write copy in a component when a deck key
 * exists for it.
 */

export const Copy = {
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
      invalidCredentials: "Email or password doesn't match. Try again or reset your password.",
      emailInUse: 'An account already exists with this email. Sign in instead.',
      generic: "Sign-in didn't go through. Try again.",
    },
  },
  home: {
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
