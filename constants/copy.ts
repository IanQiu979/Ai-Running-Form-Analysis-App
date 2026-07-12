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
      passwordBreached:
        'That password has shown up in a data breach before. Pick a different one to keep your account secure.',
      // The literal "8" here must match `minimum_password_length` in supabase/config.toml —
      // that value is the only authority on the actual rule (see app/(auth)/sign-in.tsx's
      // client-side pre-check and `mapAuthError`, both of which mirror it). Raising the config
      // value without updating this string would make the copy lie to users.
      passwordTooShort: 'Password must be at least 8 characters.',
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
  consent: {
    upload: {
      title: 'Before you upload',
      body: 'Your frames are stored privately until you delete them. We send them to Anthropic, our AI provider, to analyse your form. The analysis produces health-related feedback about you, including injury-risk flags.',
      checkbox:
        'I consent to my images being analysed to produce health-related feedback, and to Anthropic processing them to do so.',
      link: {
        privacy: 'Privacy details in Settings',
      },
      cta: {
        primary: 'I consent — continue',
        secondary: 'Cancel',
      },
      error: {
        record:
          "We couldn't record your consent, so nothing has been uploaded. Check your connection and try again.",
      },
    },
  },
  result: {
    disclaimer: {
      footer:
        'This is not medical advice. PACE analyzes visible running form and flags movement patterns that research associates with elevated injury risk — it does not diagnose injuries or conditions. Form assessment from a photo or short video is an estimate, not a lab measurement. If you have pain, swelling, or a persistent problem, or before making a big change to how you run, consult a doctor or a qualified sports physiotherapist.',
    },
  },
  settings: {
    signOut: {
      cta: 'Sign out',
    },
  },
} as const;
