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
  // ---------------------------------------------------------------------------------------
  // Screens 3-5 (issue #36): Source picker, Capture, Extracting. Lifted verbatim from
  // docs/design/copy-deck.md by key, same convention as every namespace above. A few keys
  // below are NEW — not in the deck — because the scenario they cover was never specced;
  // each is marked "NEW" at its definition and mirrored into copy-deck.md's Screen 3/4/5
  // tables (with the same "NEW key" annotation the deck already uses for
  // consent.upload.checkbox/error.record) rather than left undocumented.
  //
  // Also new to this file (not a reorganization of anything above): a handful of values below
  // are template FUNCTIONS, not plain strings — the deck's own convention for "{braces} mark a
  // runtime value" (capture.recording.timer's "{elapsed}s / 15s", upload.step.extracting's
  // "{current} / {total}"). No earlier screen needed a live-templated string at render time
  // (auth/home's one runtime value, PASSWORD_MIN_LENGTH, is fixed at module load, not
  // per-render), so there was no precedent to follow either way; a function keeps the
  // interpolation in one place instead of every call site re-building the same string.
  // ---------------------------------------------------------------------------------------
  sourcePicker: {
    title: 'Add your run',
    card: {
      upload: {
        title: 'Upload',
        subtitle: 'Choose a photo or video from your library.',
      },
      record: {
        title: 'Record',
        subtitle: 'Film a new clip in the app — muted, no microphone.',
      },
    },
    framingTip: 'Best read comes from a side-on shot — full body, good light.',
    permission: {
      library: {
        title: 'Pace AnalysisAI needs your photo library',
        body: 'To choose a running photo or video already saved on your phone. We only access what you pick.',
        cta: 'Allow library access',
        denied: {
          title: 'Photo library access is off',
          body: 'Turn on photo library access in Settings to upload a clip.',
          // Same string as shared.cta.openSettings in the deck; reused by value rather than
          // through a Copy.shared namespace, matching how app/(tabs)/index.tsx already
          // reuses "Retry" (home.quota.error.retry) instead of introducing one.
          cta: 'Open Settings',
          secondary: 'Record instead',
        },
      },
    },
    // NEW — not in the deck. A library-picked video (unlike an in-app recording, which
    // `CameraView`'s own `maxDuration` prevents from ever exceeding the cap) can be
    // arbitrarily long, so this is the one path that actually needs its own copy for
    // `lib/media-caps.ts`'s `'clipTooLong'` violation.
    error: {
      clipTooLong: {
        title: 'This clip is longer than 15 seconds',
        body: 'Pick a shorter clip, or record a new one in the app — recording stops automatically at 15 seconds.',
      },
      // NEW — not in the deck. Shared with app/capture/extracting.tsx's pre-flight check
      // (a library pick this large is caught here, before ever navigating to Extracting).
      fileTooLarge: {
        title: 'This file is too large to analyze',
        body: 'Choose a smaller photo or video, or record a new clip in the app.',
      },
    },
  },
  capture: {
    title: 'Record your run',
    overlay: {
      tip: 'Stand side-on, full body in frame, about 10 metres back. Level the camera and shoot in good light.',
      muted: 'Recording is muted — no audio, no microphone.',
    },
    recording: {
      autoCap: 'Clips stop automatically at 15 seconds.',
      // {elapsed} is templated at the call site (app/capture/record.tsx), not here — it's a
      // live value, same convention as home.quota.pro.remaining's {remaining}/{limit}.
      timer: (elapsedSeconds: number) => `${elapsedSeconds}s / 15s`,
    },
    permission: {
      camera: {
        title: 'Pace AnalysisAI needs your camera',
        body: 'To record your running form. Recording is muted — we never access your microphone.',
        cta: 'Allow camera access',
        denied: {
          title: 'Camera access is off',
          body: 'Turn on camera access in Settings to record your form. Recording is muted — we never access your microphone.',
          cta: 'Open Settings', // same string as shared.cta.openSettings — see the note above.
          secondary: 'Upload from library instead',
        },
      },
    },
  },
  // Screen 5 ("Uploading / Extracting" in the deck). Renamed in comments only, not in the
  // key namespace (kept as `upload` to match the deck's own key prefix, e.g.
  // `upload.step.extracting`) — there is no client-side "uploading %" step to show anymore:
  // since issue #88 (live), the client never uploads anything; `analyze-form` (M4) writes the
  // frames server-side, after the model call. The deck's own "Ambiguities" #2 already flags
  // this order as superseded by the Ruling-1 pipeline; this file follows the live contract,
  // extraction only.
  upload: {
    title: 'Preparing your analysis',
    step: {
      extracting: (current: number, total: number) => `Extracting frames ${current} / ${total}`,
    },
    // NEW — not in the deck (which only specs the network-upload failure copy below). This is
    // `lib/frames.ts`'s FrameBudgetExceededError surfaced honestly: the fully-extracted frame
    // set is over the analyze-form request budget. Retrying with the same clip would produce
    // the same result, so there is no retry CTA here — only a way back to choose differently.
    error: {
      budgetExceeded: {
        title: 'This clip is too large to analyze',
        body: 'Its extracted frames add up to more data than one analysis can send. Try a shorter clip or a lower-resolution recording.',
      },
      // NEW — not in the deck. Any other extraction failure (a corrupt file, a native-module
      // error) — distinct from budgetExceeded because retrying the same input CAN succeed here.
      extractionFailed: {
        title: "Couldn't process this clip",
        body: 'Something went wrong preparing your frames. Try again or choose a different clip.',
      },
    },
    // NEW — not in the deck. `analyze-form` (M4, issue #44) doesn't exist yet, so this is
    // where the frame set currently has to stop — see app/capture/extracting.tsx's header
    // comment. "Done" is the deck's own shared.cta.done ("Dismisses a screen with no further
    // action needed"), which is exactly true today.
    ready: {
      title: 'Frames ready',
      body: (frameCount: number) => `${frameCount} frame${frameCount === 1 ? '' : 's'} extracted and ready for analysis.`,
      cta: 'Done',
    },
  },
} as const;
