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
      // --- issue #17 NEW keys start — NOT in docs/design/copy-deck.md, NOT copy-certified.
      // `handleEmailSubmit` (app/(auth)/sign-in.tsx) previously collapsed every purely
      // client-side validation failure (empty email, empty password, malformed email) into
      // `generic` below — "Sign-in didn't go through. Try again." That is a lie: nothing was
      // ever sent, so "didn't go through" claims a network round-trip that never happened, and
      // "Try again" gives the user nothing to act on. It also said "Sign-in" even in signUp
      // mode, where the user wasn't signing in at all. These three keys are field-specific,
      // honest about being a local problem (no "try again", no implication a server rejected
      // anything), and mode-neutral so they read correctly in both signIn and signUp — see
      // `validateSignInForm` in lib/auth-errors.ts, the ONLY place these are produced. Mirror
      // into copy-deck.md § Screen 1 once reviewed, same as every other NEW block in this file.
      emailRequired: 'Enter your email.',
      emailInvalid: 'Enter a valid email address.',
      passwordRequired: 'Enter your password.',
      // --- issue #17 NEW keys end ---
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
    // Issue #81: password-reset flow. `reset.cta.forgotPassword` is the link
    // app/(auth)/sign-in.tsx needs (see that screen's owning agent's HANDOFF for the exact
    // snippet — not wired in from this file alone). `reset.request.*` is
    // app/(auth)/reset-password.tsx (the "enter your email" screen);
    // `reset.update.*` is app/(auth)/update-password.tsx (the "set a new password" screen
    // reached from the emailed link). Every runtime value is `{braced}` and substituted by the
    // calling screen via `.replace()`, matching lib/pace-readout.ts's existing convention —
    // never templated into the string at definition time the way `PASSWORD_MIN_LENGTH` is above,
    // since an email address isn't known until the user types it.
    reset: {
      cta: {
        forgotPassword: 'Forgot password?',
      },
      request: {
        title: 'Reset your password',
        body: "Enter your email and we'll send you a link to reset it.",
        cta: {
          send: 'Send reset link',
          backToSignIn: 'Back to sign in',
        },
        // Identical whether or not `{email}` has an account — the whole point of issue #81's
        // enumeration-safety requirement. lib/password-reset.ts's `requestPasswordReset` is what
        // actually guarantees this (see its own header): this is the ONLY success copy, never
        // branched on account existence.
        success: {
          title: 'Check your email',
          body: "If an account exists for {email}, we've sent a link to reset your password.",
        },
        error: {
          // Not an enumeration risk despite being a distinct message: `auth.rate_limit.email_sent`
          // (supabase/config.toml) is a per-project/IP limit, not a per-account one, so hitting it
          // says nothing about whether `{email}` itself has an account.
          rateLimited: 'Too many attempts. Wait a few minutes and try again.',
          generic: "We couldn't send that email. Check your connection and try again.",
        },
      },
      update: {
        title: 'Set a new password',
        password: {
          placeholder: 'New password',
        },
        cta: {
          submit: 'Update password',
          continue: 'Continue',
        },
        // Shown while app/(auth)/update-password.tsx is waiting to confirm the recovery link
        // (the `PASSWORD_RECOVERY` auth event) — a bounded wait, not a spinner-forever, per the
        // same "no fake progress, no spinner-forever" rule `analyzing.longWait` follows.
        checking: 'Confirming your link…',
        success: {
          title: 'Password updated',
          body: "You're all set — signed in with your new password.",
        },
        error: {
          // Covers both a link Supabase reports as expired/already-used AND a link with no
          // recovery params at all (e.g. opened directly, not via the emailed link) — both are
          // honestly the same actionable state: nothing here can be recovered, request a new one.
          expiredLink: {
            title: 'This link has expired',
            body: 'Password reset links only work once and expire after a while. Request a new one.',
            cta: 'Request a new link',
          },
          // `mapAuthError`'s generic fallback (`Copy.auth.error.generic`) says "Sign-in didn't go
          // through" — wrong frame for a failed password *update*, so this gets its own string
          // rather than reusing that one.
          generic: "We couldn't update your password. Try again.",
        },
      },
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
  // Screen 6 — Analyzing (issue #80). Lifted verbatim from docs/design/copy-deck.md.
  analyzing: {
    title: 'Analyzing',
    step: {
      reading: 'Reading your form…',
      scoring: 'Scoring the four pillars…',
    },
    longWait: 'Still analyzing — a full read takes a moment.',
    error: {
      failed: {
        title: "Your analysis didn't go through",
        body: "The analysis service didn't return a usable result. This one wasn't counted against your quota — try again.",
      },
      timeout: {
        title: 'Analysis timed out',
        body: "The read took too long to finish. This one wasn't counted against your quota — try again.",
      },
      cta: {
        // The deck says "Reuse shared.cta.retry" / "shared.cta.cancel" — no Copy.shared
        // namespace exists in this codebase yet. Every screen shipped so far (Home's
        // `quota.error.retry`, ConsentGate's `cta.secondary`) has likewise duplicated the
        // literal string under its own key rather than introducing one; following that
        // established precedent here instead of unilaterally adding an app-wide namespace
        // from this screen's issue (out of scope per issue #80: "do NOT reorganize
        // constants/copy.ts").
        retry: 'Retry',
        cancel: 'Cancel',
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
  // Screen 11 — Settings (issue #53, which also closes #27). Lifted verbatim by key from
  // docs/design/copy-deck.md § Screen 11, same convention as every namespace above. Keys the deck
  // defines but this screen does NOT render are deliberately absent rather than added unused:
  // `settings.plan.cta` ("See plans") and `settings.restorePurchases.cta` both route to a Paywall
  // (#52) and an IAP flow that do not exist — adding either would build a dead end, which the deck
  // itself warns against. #52 adds them back when it ships the route they point at.
  //
  // Several keys below are NEW — not in the deck — and are grouped in the explicitly delimited
  // block at the end of this namespace rather than scattered, because ALL of them need Ian's
  // review. Issue #27 called this out directly: "The copy deck has no `settings.signOut.error`
  // key — whichever answer wins needs one written."
  settings: {
    title: 'Settings',
    // The deck's own `shared.cta.back` ("Back", §0), reused by value under this screen's namespace
    // rather than through a `Copy.shared` namespace — the same call every screen before this one
    // made for "Retry" and "Cancel". See the note on `analyzing.error.cta`.
    back: 'Back',
    section: {
      account: 'Account',
      plan: 'Plan',
      privacy: 'Privacy',
    },
    signOut: {
      cta: 'Sign out',
      confirm: {
        title: 'Sign out?',
        body: 'You can sign back in anytime with the same account.',
        cta: {
          primary: 'Sign out',
          secondary: 'Cancel',
        },
      },
    },
    deleteAccount: {
      cta: 'Delete account',
      confirm: {
        title: 'Delete your account?',
        body: "This permanently deletes your account, every analysis, and every stored frame. This can't be undone.",
        cta: {
          primary: 'Delete account and data',
          secondary: 'Cancel',
        },
      },
    },
    privacy: {
      body: 'Your original photo or video never leaves your device. We extract a small number of still frames from it on your phone, and only those frames are uploaded — stored in a private location only you can access, and kept there until you delete the analysis or your account. To generate your results, the stored frames are sent to Anthropic, our AI provider, to analyze your form.',
      deleteNote:
        'Deleting an analysis removes its stored frames immediately. Deleting your account removes everything.',
    },

    // ----------------------------------------------------------------------------------------
    // --- issue #53 NEW copy starts — NOT in the copy deck, NOT copy-certified. Needs review. ---
    //
    // Every string below covers a state the deck never specced. They are written to the deck's own
    // stated rules (name the outcome, never claim a state that isn't true, no jargon, don't blame
    // the user) but they have NOT been through `ux-copywriter` or Ian. Mirror them into
    // copy-deck.md § Screen 11 once approved, the same way #36's and #56's NEW keys were.
    // ----------------------------------------------------------------------------------------
    /** Dismisses an informational alert (the three failure alerts below). One key, not three
     *  identical "OK"s — an alert's dismiss button is the same control every time it appears. */
    alertDismiss: 'OK',
    account: {
      email: {
        label: 'Email',
        // A session can carry no email (a provider that doesn't return one). Rare, but rendering
        // an empty row would look broken, and inventing an address would be worse.
        unknown: 'No email on this account.',
      },
    },
    plan: {
      // Same string as `home.quota.loading`, reused by value rather than through a shared
      // namespace — matching how this file already reuses "Retry" across screens.
      loading: 'Checking your plan…',
      error: "Couldn't load your plan.",
      retry: 'Retry',
      // Screen-reader-only label. The VISIBLE text stays the deck's "Retry", but this screen can
      // show two Retry buttons at once (plan + consent, if both reads fail), and two controls
      // whose accessible name is the bare word "Retry" are indistinguishable to a screen reader —
      // you hear "Retry… Retry" and cannot tell which does what. Naming the target fixes that
      // without changing what anyone sees. Same pattern as the deck's own `result.pillar.a11yLabel`.
      retryA11yLabel: 'Retry loading your plan',
    },
    signOutError: {
      // THE ISSUE #27 STRING(S). A security audit on PR #122 (finding F3) found a THIRD real
      // state here, not just the two below — see lib/sign-out.ts's header for the full
      // reasoning (verified against @supabase/auth-js's source, not guessed).
      //
      // `globalRevokeFailed`: auth-js cleared the LOCAL session even though the server-side
      // revoke failed, so "keep the user signed in and show an error" is not on the menu — by
      // the time we know it failed, they are already signed out on this device and the route
      // guard is tearing the screen down. The one thing we must not do is let a failed global
      // revoke look like a clean sign-out: on a shared or stolen device, "signed out" is the one
      // claim that has to be true. No jargon: no "token", no "revoke", no "session" as a noun.
      globalRevokeFailed: {
        title: 'Signed out here — but maybe not everywhere',
        body: "You're signed out on this device. We couldn't reach the server to end your other sessions, so they may still be active. Sign in again while you have a connection, then sign out to end them everywhere.",
      },
      // `stillSignedIn`: the state the audit found missing. Here retrying is NOT theatre — the
      // local session a retry would authenticate with is still fully intact, unlike the case
      // above — so this offers a real retry instead of just an acknowledgement.
      stillSignedIn: {
        title: "You're still signed in",
        body: "We couldn't reach the server, so nothing changed — you're still signed in here and everywhere else. Check your connection and try again.",
        cta: {
          primary: 'Try again',
          secondary: 'Cancel',
        },
      },
    },
    deleteAccountState: {
      pending: 'Deleting your account…',
      // `orphansRemaining: true` is a SUCCESS, not a failure (audit finding F2) — the account IS
      // gone, irreversibly. The only thing that didn't finish is clearing a handful of stray
      // objects (almost always a concurrent upload landing mid-delete), which is why there is no
      // retry here: there is no account left to retry deleting.
      success: {
        orphansRemaining: {
          title: 'Account deleted',
          body: 'Your account and everything in it are deleted. A small amount of stored media may take a little longer to finish clearing — contact support if that concerns you.',
        },
      },
      error: {
        title: "We couldn't delete your account",
        // Rewritten per audit finding F2: the previous string claimed "the account is still
        // active" as if that were always true on any failure. It is not — #58's purge runs
        // storage objects → rows → auth user in strict order, so DIFFERENT failure codes mean
        // DIFFERENT things actually got destroyed before it stopped (e.g. `auth_delete_failed`
        // means storage AND rows are already gone; only the sign-in record survives). A single
        // static "nothing changed" claim would be true for some failures and false for others —
        // exactly the "never claim a state that isn't true" violation the deck's §5 rule forbids.
        // This says only what is true across every retryable failure: some data may already be
        // gone, and retrying is safe (every step is idempotent).
        body: 'Some of your data may already have been removed. Check your connection and try again.',
      },
    },
    consent: {
      // The #68 restatement: Settings repeats the disclosure shown before the first upload, and is
      // where consent can be withdrawn (GDPR Art. 7(3): withdrawal must be as easy as giving it —
      // hence a plain row here, not a support email).
      status: {
        granted: "You've consented to health-related analysis of your uploaded frames.",
        withdrawn: "You haven't consented to health-related analysis. We'll ask again before your next upload.",
        loading: 'Checking your consent…',
        // hasConsented() THROWS on any query failure and must not be guessed either way (see
        // lib/consent.ts — it fails closed on purpose). So we say we don't know, rather than
        // rendering either status falsely.
        error: "Couldn't load your consent status.",
        retry: 'Retry',
        // Screen-reader-only — see `settings.plan.retryA11yLabel` for why both Retries need one.
        retryA11yLabel: 'Retry loading your consent status',
      },
      withdraw: {
        cta: 'Withdraw consent',
        confirm: {
          title: 'Withdraw consent?',
          // The honest scope, and the part users most often get wrong: withdrawing consent is not
          // erasure. Art. 7(3) withdrawal stops future processing; it does not retroactively
          // delete what is already stored. Saying so plainly — and pointing at the control that
          // DOES erase — is the difference between an honest control and a false comfort.
          body: "We'll ask for your consent again before your next upload, and won't analyze anything until you give it. This doesn't delete frames or analyses you've already stored — use Delete account for that.",
          cta: {
            primary: 'Withdraw consent',
            secondary: 'Cancel',
          },
        },
        error: {
          title: "We couldn't withdraw your consent",
          // Mirrors `consent.upload.error.record`'s rule for the grant path: say plainly that
          // nothing changed, so the user never walks away believing they withdrew when they
          // didn't. The consent row is append-only — a failed write means no row, means the
          // previous grant still stands, so "nothing has changed" is literally true here.
          body: "Nothing has changed — your consent is still on record. Check your connection and try again.",
        },
      },
    },
    privacyPolicy: {
      label: 'Full privacy policy',
      // The policy is DRAFTED but NOT PUBLISHED — docs/privacy-policy.md carries a DO NOT PUBLISH
      // guard because the data-controller legal identity, country, and contact email are still
      // unresolved (blocked on the Apple Developer account decision — docs/blocked-on-apple.md).
      // We therefore do not link out (there is no URL, and inventing one is not an option) and we
      // do not render the draft in-app either: it would show users placeholder legal identity and
      // rights promises they could not actually exercise, which is the precise failure the guard
      // exists to prevent. Instead we say where things stand and point at the disclosure that IS
      // certified and true today — the summary directly above it on this screen.
      pending:
        "The full policy isn't published yet. The summary above is the complete, current description of what we do with your data.",
    },
    // --- issue #53 NEW copy ends ---
  },
  // Shared tier labels — copy-deck.md § 1 ("Tier labels (shared)"), verbatim. Added by issue #53:
  // Settings is the second screen to need a tier name, which is the condition `home.quota.tier`'s
  // own note set for introducing the shared namespace ("Revisit if/when a second screen needs a
  // tier label"). Additive only — `home.quota.tier` is deliberately left exactly where it is
  // rather than migrated, since app/(tabs)/index.tsx is outside this issue's remit to restructure.
  tier: {
    free: 'Free',
    pro: 'Pro',
    elite: 'Elite',
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
