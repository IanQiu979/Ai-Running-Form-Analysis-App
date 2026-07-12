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

import { PASSWORD_MIN_LENGTH } from '@/constants/auth';

export const Copy = {
  auth: {
    // Placeholder for the real mark asset (`assets/source/mark-*.svg`, not wired in yet) —
    // rendered as plain `<Text>` in app/(auth)/sign-in.tsx. The copy deck (§Screen 1) requires
    // `valueProp` below to never restate the app name because "the logo already carries it";
    // that's only true once this becomes the actual mark. Swapping this string for the real
    // asset is future work (issue #30 only routes the existing string through the deck).
    wordmark: 'Pace AnalysisAI',
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
      // Shown under the password field, sign-up mode only (app/(auth)/sign-in.tsx) — the rule
      // stated proactively instead of only after the user fails it (issue #9). Templated off
      // the same `PASSWORD_MIN_LENGTH` constant as `error.passwordTooShort` below, so the two
      // strings can't drift from each other.
      hint: `At least ${PASSWORD_MIN_LENGTH} characters.`,
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
      // Templated off `PASSWORD_MIN_LENGTH` (constants/auth.ts) rather than a hardcoded "8" —
      // that constant is itself just a client-side echo, not the authority. The real rule is
      // `minimum_password_length` in supabase/config.toml; if that value ever changes,
      // PASSWORD_MIN_LENGTH must change with it in the same commit, or this string (and the
      // sign-up pre-check + `password.hint` above, both of which import the same constant)
      // will silently drift from what the server actually enforces.
      passwordTooShort: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
      // Issue #5. Google sign-in: the provider's redirect itself carried `error=access_denied`
      // (the user declined on Google's consent screen). Provider-neutral wording — Apple
      // sign-in (`auth.cta.apple`) reuses the same createSessionFromUrl path once it ships.
      signInCancelled: 'Sign-in was cancelled.',
      // Issue #5. Google sign-in: the client-stored PKCE verifier was missing or no longer
      // matched what the server had on file — see lib/auth-errors.ts's mapAuthError for the
      // exact error classes/codes this covers. Previously this failure was silently swallowed
      // (lib/session-provider.tsx's `.catch(() => {})`); the user landed back on sign-in with
      // no session and no explanation.
      signInExpired: 'Sign-in expired before it could finish. Try again.',
    },
  },
  home: {
    // No `home.title` key exists in the copy deck — §Screen 2 defines no title key for the
    // "Home" heading. Backfilled here (issue #30) so the heading in app/(tabs)/index.tsx and
    // the tab label in app/(tabs)/_layout.tsx share one string instead of two independent
    // "Home" literals. Whether Home should carry a redundant "Home" heading above a "Home" tab
    // label at all is a separate open design question, not resolved by this change.
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
      // Not a deck key — the deck's real tier labels are the shared `tier.pro.name` /
      // `tier.elite.name` (§1), but this screen is the only current consumer of a tier name at
      // all (`describeReadyQuota` in app/(tabs)/index.tsx), so issue #30 scopes the fix to
      // routing that one call site's hardcoded 'Pro'/'Elite' through the deck rather than
      // threading the shared namespace through a screen that doesn't otherwise need it. Revisit
      // if/when a second screen needs a tier label.
      tier: {
        pro: 'Pro',
        elite: 'Elite',
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
    // --- issue #56 additions start ---
    // The Screen 7 keys below are lifted verbatim from docs/design/copy-deck.md, except the
    // three explicitly marked NEW — those aren't in the deck and are added here, delimited, per
    // this issue's instruction ("if one is genuinely missing, add it in a clearly-delimited
    // block and say so").
    overall: {
      label: 'Overall',
    },
    pillar: {
      posture: { label: 'Posture' },
      armSwing: { label: 'Arm swing' },
      cadence: { label: 'Cadence' },
      elasticity: { label: 'Elasticity' },
      notAssessed: {
        angle: 'Not assessed — film side-on for this.',
        needsVideo: 'Not assessed — needs video, not a photo.',
        // NEW key, not in the deck. `supabase/functions/_shared/pace.ts`'s own doc comment on
        // `PaceNotAssessedReason` says a model response is NOT structurally required to report
        // exactly 'angle' | 'needsVideo' — an honest "couldn't assess this" that names some
        // other reason (or none at all) must still render as not-assessed, never be dropped or
        // treated as a shape violation. Also doubles as the overall headline's not-assessed
        // fallback text when every pillar comes back null (`PaceOverall.band === null`).
        generic: "Not assessed — the media didn't support scoring this.",
      },
      a11yLabel: '{pillar}, {score} out of 100, {band}.',
    },
    hero: {
      altText: 'Your running frame, marked with posture and ground lines.',
    },
    partial: {
      banner: {
        title: 'Partial read',
        body: "We could confidently score {n} of 4 pillars from this clip. The rest are marked not assessed — we don't guess at a score.",
      },
    },
    // NEW keys, not in the deck. The deck covers this screen's happy/partial/disclaimer states
    // but not "the fetch of the stored row itself failed" — a real state per CLAUDE.md ("build
    // the states, not just the happy view") and issue #56's own "Retry/Cancel must never trap
    // the user in a dead end."
    error: {
      notFound: "We couldn't find this analysis.",
      loadFailed: "Couldn't load this analysis.",
      retry: 'Retry',
    },
    cta: {
      done: 'Back to Home',
    },
    // Deck key `result.loadingFromHistory` — its table row sits under the Screen 8 (Past
    // Analyses) heading, but the key's own namespace (`result.*`, not `history.*`) and its
    // "Shows when" column ("Opening a stored result cold") both name this screen, not Screen 8's
    // list — kept under `result` here to match the key's actual namespace.
    loadingFromHistory: 'Loading your result…',
    disclaimer: {
      footer:
        'This is not medical advice. PACE analyzes visible running form and flags movement patterns that research associates with elevated injury risk — it does not diagnose injuries or conditions. Form assessment from a photo or short video is an estimate, not a lab measurement. If you have pain, swelling, or a persistent problem, or before making a big change to how you run, consult a doctor or a qualified sports physiotherapist.',
    },
    // --- issue #56 additions end ---
  },
  settings: {
    signOut: {
      cta: 'Sign out',
    },
  },
} as const;
