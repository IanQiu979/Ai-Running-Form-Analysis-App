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
    wordmark: 'Pace Analysis AI',
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
    // ---------------------------------------------------------------------------------------
    // THE ENTRY-SCREEN SCROLL CONTENT (2026-09-04, the V2.3 redesign). NOT in
    // docs/design/copy-deck.md and NOT copy-certified — new strings, flagged as such the same way
    // every other post-deck addition in this file is.
    //
    // WHY IT EXISTS: `app/(auth)/sign-in.tsx` is the front door — there is no separate onboarding
    // route — and until now it said the app's name, one value-prop line, and nothing else. A
    // stranger had to create an account to find out what the thing measures. This is the scroll
    // reveal below the fold that answers that first.
    //
    // VOICE RULES, and they are the reason this reads the way it does rather than like a landing
    // page: (1) it says what the app LOOKS AT, never what it will do for you — no promise of
    // faster times, no "unlock your potential"; (2) it states the photo/video limit UP FRONT
    // rather than letting a new user discover it after paying attention to a result, which is the
    // same honesty rule `pillar.notAssessed` follows; (3) it names what the product is NOT, because
    // "one thing, done properly" is the actual pitch (CLAUDE.md: no training plans, no logging, no
    // chat); (4) no second CTA lives down here — the sign-in controls are above this section, and
    // a screen gets ONE primary action (see `Accent` in constants/theme.ts).
    // ---------------------------------------------------------------------------------------
    about: {
      eyebrow: 'What it reads',
      heading: 'Four things, every time.',
      intro:
        'Every analysis looks at the same four things in the same order, so a run you submit today and one you submit in a month are actually comparable.',
      pillar: {
        posture: {
          label: 'Posture',
          body: 'Where your head, chest and hips sit over your feet — the line everything else is built on.',
        },
        armSwing: {
          label: 'Arm swing',
          body: 'What your arms are doing, and whether they are working with your legs or against them.',
        },
        cadence: {
          label: 'Cadence',
          body: 'How often your feet land. Usually the one thing you can change this week and feel.',
        },
        elasticity: {
          label: 'Elasticity',
          body: 'How much you get back from the ground — whether you spring off it or sink into it.',
        },
      },
      // The limit, stated before anyone has spent anything on it. `lib/frames.ts` and the
      // analyze-form flow enforce it; this is the reader-facing statement of the same fact, and it
      // deliberately says which two rather than "some pillars may not be assessed".
      limit: {
        eyebrow: 'What a photo can tell you',
        body: 'A single photo can answer posture and arm swing. Cadence and elasticity need movement, so they need video. Either way the result says which of the four it actually assessed — it never fills the gap with a guess.',
      },
      // The negative space. Kept last because it is the closing argument, not the opening one.
      scope: {
        eyebrow: 'What it is not',
        body: 'No training plans. No mileage log. No chat. One careful read of your form, and what to do about it.',
      },
    },
    signUp: {
      submit: 'Create account',
      link: 'New here? Create an account',
      // Issue #12/Known Issue #12 — shown INSTEAD of the Turnstile widget on either of the two
      // ways `lib/turnstile-config.ts` can fail to resolve a usable config: `EXPO_PUBLIC_
      // TURNSTILE_SITE_KEY` is unset, OR a site key is set but no base URL can be derived from
      // `EXPO_PUBLIC_TURNSTILE_HOSTNAME`/`EXPO_PUBLIC_SUPABASE_URL` (a widget with no hostname is
      // a guaranteed Cloudflare 110200). The two are deliberately indistinguishable to the
      // reader — neither is theirs to fix — and are told apart by a `__DEV__`-only warning there.
      // Sign-up genuinely cannot complete without a captcha token (supabase/functions/
      // signup-with-captcha verifies one server-side), so the submit button stays disabled — this
      // is the *reason* the user was previously never given. Deliberately mirrors
      // `paywall.purchase.error.unavailable`'s idiom, for the same reasons recorded there: it does
      // NOT say "something went wrong" (nothing did — this is a build that was shipped without a
      // key), it does NOT name the env var or the feature it gates, and it points at the one
      // action still open to the reader. `a11yHint` is the same fact for a screen reader, carried
      // on the disabled button itself, because a sighted user infers the link between the button
      // and the adjacent card from proximity and a screen-reader user cannot.
      unavailable: {
        title: "Creating an account isn't available right now",
        body: "This build can't run the security check new accounts need. If you already have an account, you can still sign in.",
        a11yHint: "Disabled — creating an account isn't available in this build.",
      },
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
      // The "or reset your password" clause is back (issue #18's closing condition): the route it
      // points at now exists — app/(auth)/reset-password.tsx, reached from the "Forgot password?"
      // link on sign-in (issue #81). Before that, this clause pointed at nothing and was a dead
      // end dressed up as help.
      //
      // The Google clause is the third dead end this string had. An account created through
      // "Continue with Google" has NO password at all, so typing that same email into this form
      // returns GoTrue's `invalid_credentials` — byte-identical to a genuine wrong password,
      // deliberately, because saying "that email is Google-only" would leak which emails exist.
      // Without this sentence the user's only readable conclusion is "sign-in is broken", which
      // is exactly what happened during live testing on 2026-08-11. Naming the provider as a
      // possibility (not a fact about this email) fixes the dead end while leaking nothing —
      // this string is shown for EVERY credential failure, so it discloses no account state.
      invalidCredentials:
        "Email or password doesn't match. Try again, reset your password, or use Continue with Google if that's how you signed up.",
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
      // --- issue #12 NEW keys start — NOT in docs/design/copy-deck.md, NOT copy-certified.
      // Sign-up only (see supabase/functions/signup-with-captcha) — sign-in never shows the
      // Turnstile widget, so never surfaces these.
      captchaLoadFailed: "The verification check couldn't load. Check your connection and try again.",
      captchaExpired: 'The verification check expired. Please complete it again.',
      captchaInvalid: "That verification check didn't go through. Please try again.",
      // --- issue #12 NEW keys end ---
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
      // --- issues #54/#15 additions start — lifted verbatim from docs/design/copy-deck.md
      // §Screen 2, "Ambiguities and calls made" #1. Three branch states for a used-up quota:
      // Free (no tier below it) and Pro (Elite exists above it) get a relabeled, actionable
      // CTA; Elite (nothing above it) keeps the plain "Analyze my form" label and renders
      // disabled instead — see `analyzeDisabled` below.
      upgradeToAnalyze: 'Upgrade to analyze',
      upgradeForMore: 'Upgrade for more',
      // Deck value is identical to `analyze` above by design (§Screen 2's row for this key:
      // "Render disabled/greyed rather than relabeled") — kept as its own key anyway, matching
      // this file's established convention of lifting every deck key even when two share one
      // literal string (see `quota.pro.remaining` / `quota.elite.remaining` below).
      analyzeDisabled: 'Analyze my form',
      // --- issues #54/#15 additions end ---
    },
    quota: {
      // Temporary all-users test mode. The server is the authority for `unlimited: true`; this
      // string contains no quota number that could drift when the flag is later removed.
      unlimited: 'Elite access · Unlimited analyses',
      free: {
        available: '1 free analysis available',
      },
      exhausted: {
        free: "You've used your free analysis",
        // --- issues #54/#15 additions start — lifted verbatim from the deck §Screen 2.
        pro: "You've used all {limit} analyses this period — renews {date}",
        elite: "You've used all {limit} analyses this period — renews {date}",
        // --- issues #54/#15 additions end ---
      },
      // --- issues #54/#15 additions start — lifted verbatim from the deck §Screen 2. Pro and
      // Elite get their own key even though the string is identical, matching the deck's own
      // separate table rows rather than collapsing them into one shared key it doesn't define.
      pro: {
        remaining: '{remaining} of {limit} analyses left this period',
      },
      elite: {
        remaining: '{remaining} of {limit} analyses left this period',
      },
      renewsOn: 'Renews {date}',
      // NEW key, not in the deck. `pace_quota_status`'s response
      // (`supabase/functions/_shared/quota-status.ts`) can report `blocked: true` (issue #6's
      // anti-farm cap) independently of `remaining` — a user can have quota left and still be
      // refused right now. The deck has no copy for this state; kept short and generic rather
      // than inventing detailed anti-farm messaging the deck was never asked to write.
      blocked: "You can't start a new analysis right now. Try again later.",
      // --- issues #54/#15 additions end ---
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
    // NEW key group, nested inside the existing `home:` namespace (issue #140's own instruction:
    // no new top-level namespace). Not in the copy deck — #64/#140's process-kill recovery is
    // newer than the deck. Shown when `lib/pending-analysis.ts`'s startup check finds an
    // analysis that was `released` (the server gave up on it) while the app that started it was
    // dead. Deliberately no "delivered" copy here: that outcome routes straight to
    // `/result/[id]` with no interstitial, same as a normal success. Reuses
    // `analyzing.error.failed`'s "coach, not scold" tone (plain text, no Semantic.error) rather
    // than inventing a second voice for the same underlying fact.
    pending: {
      released: {
        title: "Your last analysis didn't go through",
        body: "It wasn't counted against your quota — start a new one whenever you're ready.",
        dismiss: 'Dismiss',
      },
    },
  },
  consent: {
    upload: {
      title: 'Before you upload',
      body: 'Your frames are stored privately until you delete them. We send them to Anthropic, our AI provider, to analyse your form. The analysis produces health-related feedback about you, including injury-risk flags.',
      checkbox:
        'I consent to my images being analysed to produce health-related feedback, and to Anthropic processing them to do so.',
      // NEW key (issue #94). `docs/privacy-policy.md`'s "Age and other people in your media"
      // section already states a 16+ minimum; nothing asked or recorded it anywhere in the app.
      // Shown alongside `checkbox` above, on the same once-ever first-upload screen — both must
      // be ticked before the primary CTA enables (see components/consent-gate.tsx).
      age: {
        checkbox: "I confirm I'm 16 or older.",
      },
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
      // NEW namespace (issue #94). The gap #68's self-consent copy above doesn't cover: that
      // checkbox is "I consent to MY images" by construction, so it says nothing when the
      // uploader is filming someone else — the most obvious real use of a running-form analyzer
      // built by a running coach. This screen asks who is actually in the frame, EVERY time (not
      // once-ever like the block above — see components/consent-gate.tsx's docblock for why),
      // and requires a fresh attestation whenever the answer is "someone else."
      subject: {
        title: "Who's in this photo or video?",
        body: "Let us know if you're submitting your own running form, or someone else's — like an athlete you coach or a friend.",
        option: {
          me: 'This is me',
          other: 'Someone else',
        },
        thirdParty: {
          checkbox:
            "I confirm the person in this photo or video has agreed to this analysis — or, if they're under 16, their parent or guardian has agreed on their behalf — and I consent to Anthropic processing their images to produce this feedback.",
        },
        cta: {
          // A template function, not a plain string — the deck's own convention for a
          // runtime-templated value (see this file's header note on capture.recording.timer).
          // The label differs by answer: choosing "This is me" gives no NEW consent (the block
          // above already covers self-processing), so it reads as plain navigation; choosing
          // "Someone else" is itself the affirmative attestation act, so the button names that.
          primary: (subject: 'me' | 'other') => (subject === 'other' ? 'I confirm — continue' : 'Continue'),
          secondary: 'Cancel',
        },
        error: {
          record:
            "We couldn't record your confirmation, so nothing has been uploaded. Check your connection and try again.",
        },
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
        // Design polish pass: the deck's "Your analysis didn't go through" wraps to two lines
        // at `FontSize.xxl` in `app/analyzing.tsx`'s ErrorPanel — shortened to fit one line
        // without losing the "your analysis, not a system-wide failure" framing. Deviates from
        // docs/design/copy-deck.md; that doc is updated to match in the same pass.
        title: 'Your analysis failed',
        body: "The analysis service didn't return a usable result. This one wasn't counted against your quota — try again.",
      },
      timeout: {
        title: 'Analysis timed out',
        body: "The read took too long to finish. This one wasn't counted against your quota — try again.",
      },
      // NEW — not in the deck. L7 (v23-ux-audit-r1): a session that expired mid-wait used to
      // collapse into the same generic "service didn't return a usable result" copy as a real
      // server error, even though the honest, actionable difference (sign in again, not just
      // retry) is already known client-side via the server's own `unauthorized` error code.
      unauthorized: {
        title: "You've been signed out",
        body: "Your session ended before this could finish. This one wasn't counted against your quota — sign in and try again.",
      },
      // NEW (not in docs/design/copy-deck.md): both released-reservation dead ends — the server's
      // 409 `previous_attempt_failed`, and issue #64's `released` phase found by foreground
      // reconciliation. Retrying reuses the same idempotency key, which `reserve_analysis` answers
      // with the same already-released row — so a Retry in either case can only ever fail the same
      // way. Wording mirrors the server's own message ("Start a new analysis to try again").
      previousAttemptFailed: {
        // Design polish pass: "That analysis didn't finish" wraps to two lines at `FontSize.xxl`
        // — shortened to fit one line down to the narrowest supported width (iPhone SE/mini,
        // 375pt). Deviates from docs/design/copy-deck.md; updated there too.
        title: 'Analysis stopped',
        body: "An earlier attempt at this one stopped before it completed. It wasn't counted against your quota — start a new analysis to try again.",
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
        startNew: 'Start a new analysis',
        cancel: 'Cancel',
        // NEW — not in the deck. Distinct from `retry`: the `unauthorized` panel's primary
        // action signs the user out (via lib/sign-out.ts) rather than resubmitting under the
        // same expired session, so it needs its own label. Reuses `settings.signOut.cta`'s
        // wording rather than inventing new phrasing for the same action.
        signOut: 'Sign out',
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
        // NEW key, not in the deck (2026-09-06). The runner DID send a video and exactly one
        // frame of it reached the analysis, so neither `needsVideo` ("not a photo") nor `angle` is
        // a true sentence about their upload. Written only by `analyze-form/flow.ts`'s
        // normalization, via `PaceNotAssessedReason`'s server-authored `singleFrameFromVideo`.
        // States WHAT happened and not WHY: the frame count is decided on the device, and
        // `lib/extraction-frame-cap.ts` falls back to a single frame whenever it cannot read the
        // caller's quota — so "your plan only allowed one" would be a guess, and a false one for a
        // paying user whose lookup failed.
        singleFrameFromVideo: 'Not assessed — only one frame of your video could be analysed.',
        // NEW key, not in the deck. `supabase/functions/_shared/pace.ts`'s own doc comment on
        // `PaceNotAssessedReason` says a model response is NOT structurally required to report
        // exactly 'angle' | 'needsVideo' — an honest "couldn't assess this" that names some
        // other reason (or none at all) must still render as not-assessed, never be dropped or
        // treated as a shape violation. Also doubles as the overall headline's not-assessed
        // fallback text when every pillar comes back null (`PaceOverall.band === null`).
        generic: "Not assessed — the media didn't support scoring this.",
      },
      a11yLabel: '{pillar}, {score} out of 100, {band}.',
      // --- pillar-detail-modal NEW keys start — NOT in docs/design/copy-deck.md, NOT
      // copy-certified. `flagsLabel`/`drillsLabel` distinguish the injury-risk-flag sub-list from
      // the corrective-drill sub-list, which previously rendered with byte-identical styling and
      // no label at all — a user couldn't tell "this is a risk to watch for" from "this is an
      // exercise to try" at a glance. Chosen to match the app's calm, non-alarmist tone (see
      // `constants/theme.ts`'s notes on "caution not alarm") rather than clinical headings like
      // "Flags"/"Drills". `detail.*` covers the new per-pillar detail modal's own controls.
      flagsLabel: 'Watch for',
      drillsLabel: 'Try this',
      detail: {
        a11yLabel: '{pillar} details',
        a11yHint: 'Opens the full detail for this pillar.',
        close: 'Close',
      },
      // --- pillar-detail-modal NEW keys end ---
    },
    hero: {
      altText: 'Your running frame, marked with posture and ground lines.',
    },
    partial: {
      banner: {
        title: 'Partial read',
        body: "We could confidently score {n} of 4 pillars from this {medium}. The rest are marked not assessed — we don't guess at a score.",
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
      // NEW key, not in the deck — H5 (v23-ux-audit-r1): an all-not-assessed result used to
      // offer only "Back to Home", a dead end for a Free user who has just spent their one-ever
      // analysis on nothing.
      tryAnother: 'Try another clip',
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
  // Screen 8 — Past Analyses (issue #55). Lifted verbatim by key from docs/design/copy-deck.md §
  // Screen 8, same convention as every namespace above. The deck's `history.compare.*` keys
  // (Elite comparison, §9 "Compare (Elite, minimal)") are deliberately NOT included here — #55's
  // scope is the list + delete, not the Compare screen, which doesn't exist yet; adding copy for
  // a route nothing routes to would be exactly the dead key `settings`'s own header comment
  // above warns against. Add them back in the same change that builds Compare.
  history: {
    // Design polish pass: "Past Analyses" wraps to two lines at `FontSize.display` (64pt) in
    // both this screen's KineticText header and the tab bar label — shortened to fit one line.
    // Deviates from docs/design/copy-deck.md; that doc is updated to match in the same pass.
    title: 'History',
    loading: 'Loading your analyses…',
    empty: {
      title: 'No analyses yet',
      body: 'Your analyses will live here.',
      cta: 'Analyze my form',
    },
    item: {
      a11yLabel: 'Analysis from {date}, overall {score} out of 100, {band}.',
      // --- issue #55 NEW keys start — NOT in docs/design/copy-deck.md, CERTIFIED by Ian 2026-07-13.
      // `a11yLabelNotAssessed`: an analysis whose overall is honestly null (every pillar not
      // assessed — `@shared/pace`'s `PaceOverall` doc comment: "never a fabricated overall built
      // from zero real data") still needs a real VoiceOver sentence, mirroring
      // `result.pillar.notAssessed.generic`'s same "never stringify null as a score" rule.
      a11yLabelNotAssessed: 'Analysis from {date}, not assessed.',
      // `deleteCta`: the deck specs the confirmation dialog a delete opens (`delete.confirm.*`
      // below) but not a label for the row's own delete trigger — this screen's chosen affordance
      // is a tappable control per row (design brief §8 offers "swipe/long-press" as alternatives;
      // a persistent tap target reads correctly to VoiceOver without a gesture to discover).
      deleteCta: 'Delete',
      // --- issue #62 NEW keys start — NOT in docs/design/copy-deck.md, NOT copy-certified (a11y
      // announcement text, never rendered visually). Per-row delete label, so VoiceOver/TalkBack
      // tells the user WHICH analysis a given Delete control removes instead of announcing the
      // bare word "Delete" identically for every row (issue #62 audit finding #2). Mirrors
      // `a11yLabel` / `a11yLabelNotAssessed` above: a not-assessed overall still gets an honest
      // sentence, never a fabricated score.
      deleteA11yLabel: 'Delete analysis from {date}, overall {score} out of 100, {band}.',
      deleteA11yLabelNotAssessed: 'Delete analysis from {date}, not assessed.',
      // --- issue #62 NEW keys end ---
      // --- issue #55 NEW keys end ---
    },
    delete: {
      confirm: {
        title: 'Delete this analysis?',
        body: "This removes the result and its saved frames. This can't be undone.",
        cta: {
          primary: 'Delete analysis',
          // Deck says "Reuse shared.cta.cancel" — no Copy.shared namespace exists in this
          // codebase yet (see e.g. `analyzing.error.cta`'s own note above); duplicated by value
          // instead, same as every other screen so far.
          secondary: 'Cancel',
        },
      },
      // --- issue #55 NEW keys start — NOT in the deck. The deck covers the confirm dialog but
      // not a failed delete's own outcome, a real state per CLAUDE.md ("build the states, not
      // just the happy view").
      error: {
        title: "Couldn't delete this analysis",
        body: 'Check your connection and try again.',
        // Reuses `settings.alertDismiss`'s wording ("OK") by value, not by reference — same
        // no-Copy.shared convention as `delete.confirm.cta.secondary` above.
        dismiss: 'OK',
      },
      // --- issue #55 NEW keys end ---
    },
    // --- issue #55 NEW keys start — NOT in the deck. §5's states checklist names "Past Analyses
    // list" as a LOADING state but not a load-FAILURE state; mirrors `result.error.*`'s identical
    // addition for the single-result screen.
    error: {
      loadFailed: "Couldn't load your past analyses.",
      retry: 'Retry',
    },
    // The Compare screen existed but History exposed no route to it, leaving the feature
    // unreachable through normal app navigation. Compare independently enforces Elite, so this
    // entry point never re-derives tier client-side; it appears once there are two rows to pick.
    compare: {
      cta: 'Compare two analyses',
      a11yHint: 'Opens the comparison picker.',
    },
    // --- issue #55 NEW keys end ---
  },
  // Screen 9 — Compare (Elite, minimal) (issue #60, Ruling 13 — docs/status.md, 2026-07-10:
  // "two stored results side by side, per-pillar deltas... resist growing it into a
  // trends/progress feature"). Lifted verbatim by key from docs/design/copy-deck.md § Screen 9,
  // same convention as every namespace above. `history.compare.*` (the entry-point keys under §
  // Screen 8 — "Compare two analyses" / the locked-tier banner) are deliberately NOT added here:
  // they live under the `history` namespace, which is another lane's file lane for this issue
  // (app/(tabs)/history.tsx) — see this change's own HANDOFF note for the exact patch that lane
  // needs, including the copy.ts diff for those specific keys.
  compare: {
    title: 'Compare',
    picker: {
      prompt: 'Pick two analyses to compare.',
      cta: 'Compare',
    },
    empty: {
      title: 'Not enough analyses yet',
      body: 'Save two analyses to compare them side by side.',
    },
    vs: 'vs',
    delta: {
      positive: '+{n} {pillar}',
      // U+2212 MINUS SIGN, not a hyphen-minus — the deck is explicit ("Use the minus sign (−,
      // U+2212), not a hyphen") because a screen reader can pronounce the two differently.
      negative: '−{n} {pillar}',
      none: 'No change',
      a11yLabel: '{pillar} changed by {delta} points, from {oldScore} to {newScore}.',
      // --- issue #60 NEW keys start — NOT in docs/design/copy-deck.md. The deck's three delta
      // strings above (positive/negative/none) all assume both sides of the comparison carry a
      // real score; they have no string for "one or both sides is honestly not-assessed." That
      // is exactly the trap issue #60 calls out by name: rendering a null-vs-scored pillar as a
      // delta of zero would be a fabricated number, the same "never stringify null as a score"
      // rule `result.pillar.notAssessed.*` and `history.item.a11yLabelNotAssessed` both exist to
      // prevent for their own screens. These two keys are this screen's version of that rule.
      notAssessed: 'Not assessed in one or both analyses',
      notAssessedA11yLabel: '{pillar}, not assessed in one or both analyses.',
      // --- issue #60 NEW keys end ---
    },
    // --- issue #60 NEW keys start — NOT in the deck. §5's states checklist and § Screen 9's own
    // table cover the picker's empty state but not a plan/list fetch failure, or the locked-tier
    // gate this screen must independently show (Elite tier is read fresh from `quota-status` on
    // this screen too, not trusted from how the user navigated here — CLAUDE.md: "the client ...
    // is never the authority"). Mirrors `history.error.*` / `result.error.*`'s identical
    // additions for their own screens.
    loading: 'Loading your analyses…',
    error: {
      loadFailed: "Couldn't load your past analyses.",
      retry: 'Retry',
    },
    // Duplicated BY VALUE from the deck's `history.compare.locked.*` (§ Screen 8) rather than
    // imported across namespaces — matching this file's own established convention for a string
    // the deck marks "Reuse ..." but this codebase has no Copy.shared namespace for (see e.g.
    // `analyzing.error.cta`'s identical note). Shown when this screen's own fresh tier read comes
    // back non-Elite, independent of whichever entry point got the user here.
    locked: {
      title: 'Compare is an Elite feature',
      body: 'Upgrade to Elite to compare two of your analyses side by side.',
      cta: 'See plans',
    },
    // Reuses `settings.back`/`paywall.back`'s exact wording, by value, same no-Copy.shared
    // convention. Also doubles as "back to picker" while two analyses are already selected — see
    // app/compare.tsx.
    back: 'Back',
    // --- issue #60 NEW keys end ---
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
      // The deck's `settings.plan.cta`. It was written but deliberately left unrendered until
      // there was a Paywall route for it to point at (issue #52) — that route now exists.
      cta: 'See plans',
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

    // ----------------------------------------------------------------------------------------
    // --- issue #124 NEW copy starts — NOT in the copy deck, CERTIFIED by Ian 2026-07-13. Reviewed and certified. ---
    //
    // The delete-account edge function now requires proof of a RECENT real credential (password or
    // OAuth), not just a valid session, before it will run the purge (server-side gate — see
    // supabase/functions/_shared/delete-account.ts's "REAUTHENTICATION FRESHNESS" section). These
    // strings cover the step-up flow that satisfies it: a password re-entry prompt for email/
    // password accounts, a heads-up before re-running Google sign-in for OAuth accounts, and the
    // honest failure copy for the cases neither can resolve. Written to the deck's own rules (name
    // the outcome, no jargon, don't blame the user) but NOT reviewed by ux-copywriter or Ian.
    // Mirror into copy-deck.md § Screen 11 once approved, same as issue #53's NEW copy above.
    // ----------------------------------------------------------------------------------------
    reauth: {
      passwordPrompt: {
        title: "Confirm it's you",
        body: 'For your security, deleting your account needs a recent sign-in. Enter your password to continue.',
        placeholder: 'Password',
        cta: {
          primary: 'Confirm and delete',
          secondary: 'Cancel',
        },
      },
      googlePrompt: {
        title: "Confirm it's you",
        body:
          "For your security, deleting your account needs a recent sign-in. You'll be asked to sign in with Google again, then your account will be deleted.",
        cta: {
          primary: 'Continue with Google',
          secondary: 'Cancel',
        },
      },
      // The screen has no reauthentication flow for a provider other than password/Google today —
      // said plainly rather than silently doing nothing when `getReauthProvider` returns 'unknown'.
      unsupportedProvider: {
        title: "We can't confirm it's you",
        body: 'Sign out and sign back in, then try deleting your account again.',
      },
      error: {
        title: "That didn't work",
        genericBody: "We couldn't confirm it's you. Check your connection and try again.",
        // The sign-in screen's `auth.error.invalidCredentials` cannot be reused here: it offers
        // "Continue with Google" as a possibility, which is true at sign-in (any account may be
        // Google-backed) but known-false in this sheet — it opens only when `getReauthProvider`
        // says the signed-in account is a password account, and it has no Google button to press.
        // The email is not in question here either; the user is already signed in.
        wrongPassword: "That password doesn't match. Try again.",
        // Reached only if the RETRY after a successful reauthentication is ALSO rejected as stale
        // (e.g. clock skew) — distinct from genericBody because the user just did what was asked
        // and it still didn't take, which deserves its own honest explanation rather than looking
        // like the same generic failure.
        stillRequired: {
          title: "We still couldn't confirm it's you",
          body: "That didn't go through in time. Wait a moment, then try deleting your account again.",
        },
      },
    },
    // --- issue #124 NEW copy ends ---
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
  // Screen 10 — Paywall (dummy) (issue #52). Lifted verbatim by key from docs/design/copy-deck.md
  // § Screen 10, same convention as every namespace above. Displayed prices are decided (Ian,
  // 2026-07-11): Pro $6.99/mo, Elite $14.99/mo — the deck's own `{{price}}` placeholders resolve
  // to these two literal strings, typed directly rather than templated off a shared numeric
  // constant (CLAUDE.md is explicit these are DISPLAY prices only; real IAP is post-MVP and there
  // is no numeric price token anywhere in this codebase to template off of). Tier name/price/
  // detail strings below duplicate `tier.*.name` above BY VALUE rather than referencing it — the
  // same by-value-reuse convention `home.quota.tier` already established in this file (see that
  // key's own comment) for a screen that needs a tier label before/without pulling in the whole
  // `Copy.tier` namespace as a dependency.
  paywall: {
    title: 'Choose your plan',
    // Same string as settings.back / shared.cta.back (deck §0) — reused by value, matching how
    // every screen before this one has handled shared.cta.* (see settings.back's own comment).
    back: 'Back',
    gate: {
      // Free tier's REAL, model-backed 1 real analysis, capped for life (captain's ruling,
      // 2026-09-06 — this replaces the retired zero-model-call sample). Never claim an upgrade
      // unlocks anything this product cannot certify: no promised pillar count, no cadence figure,
      // no ground-contact comparison — see `paywall.tier.*` below for the same discipline.
      free: {
        title: "You've used your free analysis",
        body: 'Your one lifetime Free analysis is used. See what Pro and Elite add below.',
      },
      paid: {
        title: "You're out of analyses this period",
        // {limit} and {renewsOn} are always live values read off a fresh quota-status response
        // (lib/subscription.ts's QuotaStatus.limit / formatRenewalDate(periodEnd)) — never a
        // constant here, per CLAUDE.md's "never authoritative on the client" rule.
        body: (limit: number, renewsOn: string) =>
          `You've used all ${limit} analyses this period. It renews ${renewsOn}. Upgrade for more each period.`,
      },
    },
    tier: {
      // Every `detail` below is scoped to what this product can actually certify (2026-09-06
      // ruling): no promised pillar count, no cadence figure, no left/right ground-contact
      // comparison — only certified flags/drills, and only "when supported" by the evidence.
      free: {
        name: 'Free',
        price: '$0',
        detail: 'Your 1 real analysis, from a single photo or frame — no injury-risk flags or drills.',
      },
      pro: {
        name: 'Pro',
        price: '$6.99 / month',
        detail:
          'Additional analyses each period, plus multi-frame evidence when your footage supports it — certified injury-risk flags and drills when supported.',
      },
      elite: {
        name: 'Elite',
        price: '$14.99 / month',
        detail:
          'Everything in Pro, plus deeper feedback per pillar and a side-by-side comparison with your past analyses.',
      },
    },
    footnote: 'Elite adds a little more detail and comparison — not a different analysis.',
    cta: {
      upgrade: {
        pro: 'Upgrade to Pro',
        elite: 'Upgrade to Elite',
      },
      current: 'Current plan',
    },
    // ----------------------------------------------------------------------------------------
    // --- issue #52 NEW copy starts — NOT in the copy deck, CERTIFIED by Ian 2026-07-13. Reviewed and certified. ---
    //
    // `alertDismiss` — dismisses the purchase result Alert below. Same value and role as
    // `settings.alertDismiss` ("Dismisses an informational alert"), duplicated by value rather
    // than cross-referenced — this file's own established convention (see `home.quota.tier`'s
    // comment) for a screen that needs a string another namespace already has without pulling
    // that whole namespace in as a dependency, doubly relevant here since another agent owns the
    // `settings:` block concurrently.
    //
    // The deck's Screen 10 table only specs the three static tier cards (above) and the two
    // 402-triggered gate banners (above) — it never covers what happens DURING or AFTER tapping
    // an "Upgrade" CTA: no pending/success/failure copy exists for the dummy purchase at all.
    // Written to the deck's own voice rules (plain, calm, name the outcome, never claim a state
    // that isn't true, no jargon) but NOT reviewed by ux-copywriter or Ian — mirror into
    // copy-deck.md § Screen 10 once approved, same precedent as every other NEW block in this
    // file (issues #36/#53/#56).
    // ----------------------------------------------------------------------------------------
    alertDismiss: 'OK',
    plan: {
      loading: 'Checking your plan…',
      error: "Couldn't load your plan.",
      retry: 'Retry',
      // Screen-reader-only label — same reasoning as settings.plan.retryA11yLabel (this screen
      // can show this Retry next to a purchase-error Retry, and two controls both named "Retry"
      // are indistinguishable to a screen reader).
      retryA11yLabel: 'Retry loading your plan',
    },
    purchase: {
      pending: 'Upgrading…',
      success: {
        title: (tierName: string) => `You're on ${tierName} now`,
        body: 'Your new plan is active.',
      },
      error: {
        // lib/subscription.ts's PurchaseErrorCode 'not_found' — the dummy purchase-tier endpoint
        // is deployed and live (docs/architecture.md, issue #51) but gated behind
        // PURCHASE_TIER_DUMMY_ENABLED (default OFF; currently unset on the live project — Known
        // Issue #21). This code gets this honest, non-alarming copy: it does not say "something
        // went wrong" (nothing did) and it does not name the feature flag.
        unavailable: {
          title: "Upgrading isn't available yet",
          body: "This build can't complete an upgrade right now. Check back soon.",
        },
        // code: 'rate_limited' — the same account called purchase-tier again within 3 seconds of
        // its own last write.
        rateLimited: {
          title: 'One at a time',
          body: 'Give it a moment before trying again.',
        },
        // Every other failure (network, an unrecognized code, a malformed response) — honest and
        // retryable, matching this file's other generic-failure strings (e.g. the "check your
        // connection and try again" idiom in settings.deleteAccountState.error.body).
        generic: {
          title: "Your upgrade didn't go through",
          body: 'Nothing was charged. Check your connection and try again.',
        },
      },
    },
    // --- issue #52 NEW copy ends ---
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
        title: 'Pace Analysis AI needs your photo library',
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
        title: 'Pace Analysis AI needs your camera',
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
      // NEW — not in the deck. `lib/frames.ts`'s InsufficientFramesError: the clip decoded, but
      // too few of its frames landed on genuinely different instants to read motion from. Like
      // budgetExceeded and unlike extractionFailed, this is deterministic for a given clip — the
      // same footage through the same pipeline collides identically — so there is no retry CTA,
      // only a way back to choose different footage. Worded for a runner, not a decoder: no
      // "frame rate", no "fps", no "decoder".
      unsupportedFootage: {
        title: "This clip won't work for a full analysis",
        body: 'Its frames are too close to identical to show your body moving between them — that usually means the clip was re-recorded or exported from another app. Try a clip recorded straight from your camera at normal speed.',
      },
      // NEW — not in the deck. Any other extraction failure (a corrupt file, a native-module
      // error) — distinct from budgetExceeded because retrying the same input CAN succeed here.
      extractionFailed: {
        title: "Couldn't process this clip",
        body: 'Something went wrong preparing your frames. Try again or choose a different clip.',
      },
    },
    // NEW — not in the deck. Was a genuine stopping point ("Done" -> Home) until issue #135
    // wired this screen's one control to hand off into `/analyzing` — reuses `home.cta.analyze`'s
    // exact wording ("Analyze my form") rather than inventing a distinct label for what is, from
    // the user's point of view, the same action: starting an analysis of what's now ready.
    ready: {
      title: 'Frames ready',
      body: (frameCount: number) => `${frameCount} frame${frameCount === 1 ? '' : 's'} extracted and ready for analysis.`,
      cta: 'Analyze my form',
    },
  },
  // Cross-cutting — Offline (issue #93). Lifted verbatim from copy-deck.md's own "Cross-cutting —
  // Offline" section, NOT from Screen 5's `upload.offline.*` table — that table is explicitly
  // marked "Not implemented" (the #36 update note: there is no client-upload network step left to
  // drop offline mid-way through, issue #88). These are the two states that DO have a live
  // implementation: `banner` for `components/offline-banner.tsx` (mounted globally,
  // `app/_layout.tsx`), and `blocked` for the pre-flight gate a network-dependent action (an
  // `analyze-form` submit) shows instead of attempting the call while offline. `blocked.body`'s
  // "nothing has been sent yet" is load-bearing copy, not decoration — brief §5's rule is "never
  // claim 'saved' when it isn't," and this is the one state guaranteed to be shown BEFORE any
  // network attempt, so it's the one place that claim is always true by construction.
  offline: {
    banner: "You're offline — capture still works, but upload and analysis need a connection.",
    blocked: {
      title: "You're offline",
      body: 'This needs an internet connection. Reconnect and try again — nothing has been sent yet.',
      // Deck says "Reuse shared.cta.retry" — no Copy.shared namespace exists (see the note at
      // `analyzing.error.cta` above); every other reuse of this string duplicates it by value
      // instead, so this matches that established convention rather than introducing the first
      // shared namespace here.
      cta: 'Retry',
    },
  },
} as const;
