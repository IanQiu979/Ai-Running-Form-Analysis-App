/**
 * In-app copy, keyed by `docs/design/copy-deck.md`.
 *
 * TONE (2026-09-12, captain's user-audit): professional and restrained. Short sentences, no
 * contractions, no exclamation marks, no emoji, no jokes; technical terms (cadence, stride, ground
 * contact, pillar) used precisely. Every string below was rewritten to that register in one pass;
 * the deck's string columns predate it and this file is the live source of truth for wording. Key
 * names and the deck's "shows when" rules are unchanged. Consent/legal sentences (`consent.*`, the
 * medical disclaimer, the privacy summary) were shortened without changing what they assert.
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
  // ---------------------------------------------------------------------------------------
  // THE ENTRY FLOW (2026-09-13, the V23 redesign — pages V23-02 Hero and V23-03 Details, with
  // V23-04's pillar boxes). NOT in docs/design/copy-deck.md; the wording is the captain-approved
  // Claude Design pages', lifted verbatim. Since 2026-09-20 the hero and the story are ONE
  // scroll (`app/(auth)/welcome.tsx`, with `components/pillar-story.tsx`) that ends at
  // `app/(auth)/sign-in.tsx`; the two cues below are that decision's — "Scroll down" on the
  // hero, and the sign-up entry at the story's end. No "Continue" remains in the entry flow.
  // ---------------------------------------------------------------------------------------
  entry: {
    hero: {
      cue: 'Scroll down',
      // The hero is one drawn figure with four measured callouts. Sighted users read the callouts
      // off the drawing; this is the same content as one sentence for a screen reader.
      a11yLabel:
        'A line-drawn runner annotated with the four pillars: posture, forward lean 6 degrees; arm swing, elbow angle 90 degrees; cadence, 176 steps per minute; elasticity, ground contact 230 milliseconds.',
      callout: {
        posture: { name: 'Posture', sub: 'forward lean', unit: '°' },
        armSwing: { name: 'Arm swing', sub: 'elbow angle', unit: '°' },
        cadence: { name: 'Cadence', sub: 'steps per minute', unit: 'spm' },
        elasticity: { name: 'Elasticity', sub: 'ground contact', unit: 'ms' },
      },
    },
    details: {
      title: 'What your run is telling you',
      lede: 'One photo of your stride, read against the science of running form.',
      // The story's intro section carries this as its one paragraph; the page's "What it reads"
      // label above it came off with the 2026-09-20 story (one section holds at most three type
      // sizes: Display, H2, Body).
      reads:
        'Four things a coach looks at first: how you stand over your feet, what your arms do, how often you land, and how much the ground gives back.',
      // Sits above the first pillar box, in `ink2`: the boxes are buttons, and nothing else on
      // the section says so.
      hint: 'Tap a pillar for details',
      // V23-04: the closed box shows `name`; the open box adds the description and the metric
      // with its healthy range. Values are the pages' starting numbers (Ian to confirm ranges).
      pillar: {
        posture: {
          name: 'Posture',
          desc: 'Where your head, chest and hips sit over your feet — the line everything else is built on.',
          metric: '6°',
          range: 'forward lean · norm 5–10°',
        },
        armSwing: {
          name: 'Arm swing',
          desc: 'What your arms are doing, and whether they are working with your legs or against them.',
          metric: '90°',
          range: 'elbow angle · norm 85–100°',
        },
        cadence: {
          name: 'Cadence',
          desc: 'How often your feet land. Usually the one thing you can change this week and feel.',
          metric: '176 spm',
          range: 'steps per minute · norm 165–185',
        },
        elasticity: {
          name: 'Elasticity',
          desc: 'How much you get back from the ground — whether you spring off it or sink into it.',
          metric: '230 ms',
          range: 'ground contact · norm 200–280 ms',
        },
      },
      close: 'Close',
      // The sign-up entry at the end of the last pillar section; it pushes the sign-up screen,
      // whose title is the same words.
      cue: 'Get started',
    },
  },
  auth: {
    // V23-06 (2026-09-13): the page's eyebrow and Display title. The old wordmark / value-prop /
    // "about" scroll content came off this screen with the redesign — the hero and the pillars
    // story (`Copy.entry`) carry what the app does now.
    eyebrow: 'Run better tomorrow',
    title: 'Get started',
    cta: {
      google: 'Continue with Google',
    },
    email: {
      placeholder: 'Email',
    },
    password: {
      placeholder: 'Password',
      // The password rule, carried as the field's `accessibilityHint` in sign-up mode — the rule
      // stated proactively instead of only after the user fails it (issue #9). Templated off
      // the same `PASSWORD_MIN_LENGTH` constant as `error.passwordTooShort` below, so the two
      // strings can't drift from each other.
      hint: `At least ${PASSWORD_MIN_LENGTH} characters.`,
    },
    // V23-06's consent line under the fields: a 12 pt checkbox and one line of fine print with
    // "Terms" and "Privacy Policy" underlined. Split into parts so the screen can underline the
    // two names without a second string. "I am", not the page's "I'm" — the tone rule above
    // (no contractions) outranks a two-glyph difference on the artboard. NOTE: the underlines are
    // the page's styling and not links — the Terms are unpublished, and the Privacy Policy
    // (published; opened from Settings via `PRIVACY_POLICY_URL`) sits inside the checkbox's own
    // tap target; the screen says so in its own comment.
    consent: {
      // 2026-09-20: the age claim moved OUT of this line and into `ageBand` below (an explicit
      // choice, recorded server-side), so this is now the Terms + Privacy agreement alone and is
      // required for every age band.
      prefix: 'I agree to the ',
      terms: 'Terms',
      and: ' and ',
      privacy: 'Privacy Policy',
      a11yLabel: 'I agree to the Terms and Privacy Policy',
      // The future-uploads attestation (2026-09-20) — granted once, at sign-up or first Google
      // use, and covers every upload the account ever makes (`lib/consent.ts`'s
      // FUTURE_UPLOADS_ATTESTATION_CONSENT), replacing the old per-upload subject-attestation
      // flow. Drawn by `components/upload-consent-checkbox.tsx`, below the Terms line on the
      // sign-up form.
      futureUploads: {
        checkbox:
          'I confirm that any photo or video I upload or record now or later shows only myself, or someone who has agreed to this analysis.',
      },
      // The one sentence that keeps `UPLOAD_HEALTH_CONSENT` (`upload.health.v1`) meaning what it
      // did when the key was minted: uploads are health-related data and AI processes them.
      // Names Anthropic in the affirmative act itself (captain, 2026-09-21; the processor must be
      // named in the consent copy, not one link away — `docs/privacy-checklist-m7.md` SHOULD).
      // Drawn as the first sentence of the same checkbox row, so the one tick covers both.
      healthProcessing:
        'Photos and videos you upload are health-related data, processed by AI (Anthropic) to analyze your running form.',
    },
    // The age choice (captain's plan, approved 2026-09-20; mirrors V2.2's guardian-consent block,
    // IanQiu979/Ai-Customized-Running-Plan-App#123). Two options — under 13 is not offered, and
    // `eligibility` says so instead. Choosing 13–17 reveals `guardian.checkbox`, the parent or
    // guardian attestation, whose wording follows V2.2's `legal.ts` sentence as closely as this
    // file's register allows ("Privacy Policy" capitalised as the rest of this screen names it);
    // it is the one new key `constants/__tests__/copy-tone.test.ts` exempts, because its meaning
    // — WHO agreed, to WHAT — is what the server records against a policy version, and rewording
    // it is a legal change, not a copy edit. Counsel review of the attestation is a public-launch
    // item. Drawn by components/age-band-choice.tsx on the sign-up form and on the one-time
    // screen an OAuth-created account gets (components/age-band-gate.tsx).
    ageBand: {
      legend: 'Your age',
      eligibility: 'Pace Analysis AI is for ages 13 and up.',
      option: {
        adult: '18 or older',
        minor: '13–17 — my parent or guardian agrees',
      },
      a11y: {
        adult: 'I am 18 or older',
        minor: 'I am 13 to 17 and my parent or guardian agrees',
      },
      guardian: {
        checkbox:
          'I am 13–17, and a parent or guardian has read the Privacy Policy and agrees to it on my behalf.',
      },
    },
    // The one-time age screen for an account that Google (or, later, Apple) created: no request
    // body of ours travels through an OAuth exchange, so the band is asked for on first use and
    // recorded by `record-age-band`. The Terms + Privacy agreement was already ticked before the
    // OAuth sheet opened (`handleGoogleSignIn`), so this screen asks only the age question.
    ageGate: {
      eyebrow: 'One more step',
      title: 'Confirm your age',
      body: 'Select your age range to continue. This is recorded once, with your account.',
      submit: 'Continue',
      signOut: 'Sign out',
      loading: 'Checking your account…',
      error: {
        load: 'Your account details could not be loaded. Check your connection and try again.',
        retry: 'Retry',
        // Distinct from `auth.error.generic`: nothing about the account failed, one write did.
        save: 'Your age choice could not be saved. Check your connection and try again.',
        // The band IS on file when this shows; it is the consent rows that did not land.
        consent: 'Your age choice was saved, but your consent could not be recorded. Check your connection and try again.',
      },
      // A Google account ticked the Terms and the photo or video statement on the sign-in screen
      // before the browser round trip; the consent rows are written when this screen's Continue
      // is confirmed, so the line above the button restates what that confirm records.
      consentReminder:
        'Continuing records your acceptance of the Terms and Privacy Policy, your confirmation that any photo or video you upload shows only yourself or someone who has agreed to this analysis, and your consent to AI processing of your uploads as health-related data.',
    },
    signIn: {
      submit: 'Sign in',
      // The footer's two halves: a `ink2` prompt and an underlined `ink` link (V23-06).
      switchPrompt: 'Already have an account?',
      switchLink: 'Sign in',
    },
    signUp: {
      submit: 'Create account',
      switchPrompt: 'New here?',
      switchLink: 'Create an account',
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
        title: 'Account creation is unavailable',
        body: 'This build cannot run the verification step new accounts require. Existing accounts can still sign in.',
        a11yHint: 'Disabled. Account creation is unavailable in this build.',
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
      // V23-06 (2026-09-14): the consent checkbox gates account creation in the submit handler
      // itself, not only on the button — the keyboard's return key reaches the handler with the
      // button still disabled. Local, no server contacted, like the three keys above.
      consentRequired: 'Agree to the Terms and Privacy Policy to continue.',
      // 2026-09-20: the two age gates, local first (the submit handler refuses before any network
      // call, like `consentRequired`) and echoed by the server's `age_band_required` /
      // `guardian_consent_required` codes should a client ever reach it without them.
      ageBandRequired: 'Select your age range to continue.',
      guardianConsentRequired:
        'Confirm that a parent or guardian has read the Privacy Policy and agrees to it on your behalf.',
      // 2026-09-20: the future-uploads attestation gates account creation the same local-first
      // way as `consentRequired` above.
      futureUploadsConsentRequired: 'Confirm the photo or video statement to continue.',
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
        'Email or password is incorrect. Try again, reset your password, or use Continue with Google if the account was created that way.',
      emailInUse: 'An account with this email already exists. Sign in instead.',
      generic: 'Sign-in failed. Try again.',
      passwordBreached:
        'This password appears in a known data breach. Choose a different one.',
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
      signInExpired: 'Sign-in expired before completing. Try again.',
      // --- issue #12 NEW keys start — NOT in docs/design/copy-deck.md, NOT copy-certified.
      // Sign-up only (see supabase/functions/signup-with-captcha) — sign-in never shows the
      // Turnstile widget, so never surfaces these.
      captchaLoadFailed: 'The verification check failed to load. Check your connection and try again.',
      captchaExpired: 'The verification check expired. Complete it again.',
      captchaInvalid: 'The verification check failed. Try again.',
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
        title: 'Reset password',
        body: 'Enter your email to receive a reset link.',
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
          body: 'If an account exists for {email}, a reset link has been sent.',
        },
        error: {
          // Not an enumeration risk despite being a distinct message: `auth.rate_limit.email_sent`
          // (supabase/config.toml) is a per-project/IP limit, not a per-account one, so hitting it
          // says nothing about whether `{email}` itself has an account.
          rateLimited: 'Too many attempts. Wait a few minutes and try again.',
          generic: 'The email could not be sent. Check your connection and try again.',
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
        checking: 'Confirming link…',
        success: {
          title: 'Password updated',
          body: 'You are signed in with your new password.',
        },
        error: {
          // Covers both a link Supabase reports as expired/already-used AND a link with no
          // recovery params at all (e.g. opened directly, not via the emailed link) — both are
          // honestly the same actionable state: nothing here can be recovered, request a new one.
          expiredLink: {
            title: 'Link expired',
            body: 'Reset links are single-use and time-limited. Request a new one.',
            cta: 'Request a new link',
          },
          // `mapAuthError`'s generic fallback (`Copy.auth.error.generic`) says "Sign-in didn't go
          // through" — wrong frame for a failed password *update*, so this gets its own string
          // rather than reusing that one.
          generic: 'The password could not be updated. Try again.',
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
      analyze: 'Start analysis',
      // --- issues #54/#15 additions start — lifted verbatim from docs/design/copy-deck.md
      // §Screen 2, "Ambiguities and calls made" #1. Three branch states for a used-up quota:
      // Free (no tier below it) and Pro (Elite exists above it) get a relabeled, actionable
      // CTA; Elite (nothing above it) keeps the plain "Start analysis" label and renders
      // disabled instead — see `analyzeDisabled` below.
      upgradeToAnalyze: 'Upgrade to analyze',
      upgradeForMore: 'Upgrade for more',
      // Deck value is identical to `analyze` above by design (§Screen 2's row for this key:
      // "Render disabled/greyed rather than relabeled") — kept as its own key anyway, matching
      // this file's established convention of lifting every deck key even when two share one
      // literal string (see `quota.pro.remaining` / `quota.elite.remaining` below).
      analyzeDisabled: 'Start analysis',
      // --- issues #54/#15 additions end ---
    },
    quota: {
      free: {
        available: '1 free analysis available',
      },
      exhausted: {
        free: 'Free analysis used',
        // --- issues #54/#15 additions start — lifted verbatim from the deck §Screen 2.
        pro: 'All {limit} analyses used this period. Renews {date}',
        elite: 'All {limit} analyses used this period. Renews {date}',
        // --- issues #54/#15 additions end ---
      },
      // --- issues #54/#15 additions start — lifted verbatim from the deck §Screen 2. Pro and
      // Elite get their own key even though the string is identical, matching the deck's own
      // separate table rows rather than collapsing them into one shared key it doesn't define.
      pro: {
        remaining: '{remaining} of {limit} analyses remaining this period',
      },
      elite: {
        remaining: '{remaining} of {limit} analyses remaining this period',
      },
      renewsOn: 'Renews {date}',
      // NEW key, not in the deck. `pace_quota_status`'s response
      // (`supabase/functions/_shared/quota-status.ts`) can report `blocked: true` (issue #6's
      // anti-farm cap) independently of `remaining` — a user can have quota left and still be
      // refused right now. The deck has no copy for this state; kept short and generic rather
      // than inventing detailed anti-farm messaging the deck was never asked to write.
      //
      // TWO VARIANTS, and which one renders is a statement about what we actually know. The same
      // response also carries `blocked_until`, so when `lib/cooldown-remaining.ts`'s
      // `describeCooldownRemaining` can turn it into a phrase, Home says how long is left rather
      // than an open-ended "later". `blocked` stays as the honest fallback for a missing,
      // unparsable, or already-past expiry — never a guessed or zeroed countdown.
      blocked: 'New analyses are unavailable at the moment. Try again later.',
      blockedFor: 'New analyses are unavailable for {remaining}.',
      zeroPillarCooldown: 'The last clip could not be read. Try again at {time}.',
      // --- issues #54/#15 additions end ---
      loading: 'Checking plan…',
      error: {
        stale: 'Showing last known plan status.',
        // `home.quota.error.retry` is defined verbatim in the deck (§Screen 2), reusing
        // `shared.cta.retry`'s "Retry" string. `failed` has no deck entry — the deck only
        // covers the "stale" case (a prior successful fetch to fall back to); this is the
        // narrower case where the very first fetch fails and there is nothing to show yet.
        retry: 'Retry',
        failed: 'Plan status unavailable.',
      },
    },
    empty: {
      // The dashed empty box's title (V23-07, second artboard). The page's string is this key's
      // existing value verbatim, so it keeps its name rather than gaining a duplicate `title`.
      caption: 'No analyses yet.',
      // NEW key (V23-07): the sentence under the title in the same box. Not in the copy deck —
      // the Cadence Arcs empty state carried the title alone.
      body: 'Submit a photo or video of your run for a precise assessment of your form.',
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
        title: 'Last analysis did not complete',
        body: 'It was not counted against your quota. Start a new one when ready.',
        dismiss: 'Dismiss',
      },
    },
  },
  // Screen 6 — Analyzing (issue #80). `title` and `longWait` are the deck's; the status lines
  // are V23-05's (2026-09-13): "Uploading your photo" / "Finding your stride" / "Done".
  analyzing: {
    title: 'Analyzing',
    step: {
      // The page says "photo". A video submission never uploads the video — only the frames
      // extracted on the device leave it (CLAUDE.md, Ruling 1) — so that branch names the frames
      // rather than claiming an upload the app deliberately does not make.
      uploading: (mediaType: 'photo' | 'video') =>
        mediaType === 'video' ? 'Uploading your frames' : 'Uploading your photo',
      finding: 'Finding your stride',
    },
    // Shown once the result has landed, for V23-05's 300 ms hold before the result fades in.
    done: 'Done',
    longWait: 'Still analyzing. A full read takes a moment.',
    error: {
      failed: {
        // Design polish pass: the deck's "Your analysis didn't go through" wraps to two lines
        // at `FontSize.xxl` in `app/analyzing.tsx`'s ErrorPanel — shortened to fit one line
        // without losing the "your analysis, not a system-wide failure" framing. Deviates from
        // docs/design/copy-deck.md; that doc is updated to match in the same pass.
        title: 'Analysis failed',
        body: 'The analysis service did not return a usable result. This attempt was not counted against your quota. Try again.',
      },
      timeout: {
        title: 'Analysis timed out',
        body: 'The read exceeded the time limit. This attempt was not counted against your quota. Try again.',
      },
      // NEW — not in the deck. L7 (v23-ux-audit-r1): a session that expired mid-wait used to
      // collapse into the same generic "service didn't return a usable result" copy as a real
      // server error, even though the honest, actionable difference (sign in again, not just
      // retry) is already known client-side via the server's own `unauthorized` error code.
      unauthorized: {
        title: 'Signed out',
        body: 'Your session ended before the analysis could finish. This attempt was not counted against your quota. Sign in and try again.',
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
        body: 'An earlier attempt stopped before completing. It was not counted against your quota. Start a new analysis to try again.',
      },
      zeroPillarCooldown: {
        title: 'No readable frames',
        body: '{message} Try again at {time}.',
        bodyUnknownTime: '{message} Try again in a few minutes.',
        // The lead sentence normally comes from the server (its 429 owns the one-sentence style
        // rule). This is the local stand-in for the one case that would otherwise render NOTHING:
        // a body carrying this `code` with a blank `error`. The panel excludes itself from the
        // generic retryable branch, so an empty body there is not a worse message — it is no
        // panel and no CTA at all, on a screen whose other exits are gone. Deliberately says only
        // what the code itself already tells us, and never guesses a time.
        fallbackMessage: 'The last clip could not be read.',
      },
      cta: {
        // The deck says "Reuse shared.cta.retry" / "shared.cta.cancel" — no Copy.shared
        // namespace exists in this codebase yet. Every screen shipped so far (Home's
        // `quota.error.retry`, the since-deleted ConsentGate's `cta.secondary`) has likewise duplicated the
        // literal string under its own key rather than introducing one; following that
        // established precedent here instead of unilaterally adding an app-wide namespace
        // from this screen's issue (out of scope per issue #80: "do NOT reorganize
        // constants/copy.ts").
        retry: 'Retry',
        startNew: 'Start new analysis',
        cancel: 'Cancel',
        // NEW — not in the deck. Distinct from `retry`: the `unauthorized` panel's primary
        // action signs the user out (via lib/sign-out.ts) rather than resubmitting under the
        // same expired session, so it needs its own label. Reuses `settings.signOut.cta`'s
        // wording rather than inventing new phrasing for the same action.
        signOut: 'Sign out',
        backHome: 'Back to Home',
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
        angle: 'Not assessed. Requires a side-on view.',
        needsVideo: 'Not assessed. Requires video.',
        // NEW key, not in the deck (2026-09-06). The runner DID send a video and exactly one
        // frame of it reached the analysis, so neither `needsVideo` ("not a photo") nor `angle` is
        // a true sentence about their upload. Written only by `analyze-form/flow.ts`'s
        // normalization, via `PaceNotAssessedReason`'s server-authored `singleFrameFromVideo`.
        // States WHAT happened and not WHY: the frame count is decided on the device, and a
        // single frame can still reach the server from a client build that predates the stride
        // burst — so "your plan only allowed one" would be a guess, and since #89 (2026-09-19)
        // a false one on every tier: Free video is a 5-frame burst too.
        singleFrameFromVideo: 'Not assessed. Only one frame of the video was analyzed.',
        // NEW key, not in the deck. `supabase/functions/_shared/pace.ts`'s own doc comment on
        // `PaceNotAssessedReason` says a model response is NOT structurally required to report
        // exactly 'angle' | 'needsVideo' — an honest "couldn't assess this" that names some
        // other reason (or none at all) must still render as not-assessed, never be dropped or
        // treated as a shape violation. Also doubles as the overall headline's not-assessed
        // fallback text when every pillar comes back null (`PaceOverall.band === null`).
        generic: 'Not assessed. The media did not support scoring.',
      },
      a11yLabel: '{pillar}, {score} out of 100, {band}.',
      // --- pillar-detail-modal NEW keys start — NOT in docs/design/copy-deck.md, NOT
      // copy-certified. `flagsLabel`/`drillsLabel` distinguish the injury-risk-flag sub-list from
      // the corrective-drill sub-list, which previously rendered with byte-identical styling and
      // no label at all — a user couldn't tell "this is a risk to watch for" from "this is an
      // exercise to try" at a glance. Originally "Watch for"/"Try this"; renamed to the plain
      // technical terms on 2026-09-12 (captain's audit: the app's copy read too informal). The
      // labels now name the thing precisely rather than softening it. `detail.*` covers the new
      // per-pillar detail modal's own controls.
      flagsLabel: 'Risk flags',
      drillsLabel: 'Drills',
      // The label above a pillar's certified stop-running note (`PaceSafety.note`,
      // `supabase/functions/_shared/pace.ts`). The note itself is never written here — it is the
      // model's certified sentence, carried structurally on `pillar.safety` and rendered verbatim.
      // This label exists so the note cannot be mistaken for more coaching: it is the one thing on
      // this screen that is not advice about form. Named plainly, like its two neighbours above
      // (2026-09-12 register): it says what the block is, not how alarmed to be.
      safetyLabel: 'Safety notice',
      detail: {
        a11yLabel: '{pillar} details',
        a11yHint: 'Opens full detail for this pillar.',
        close: 'Close',
      },
      // --- pillar-detail-modal NEW keys end ---
    },
    hero: {
      // Reworded 2026-09-20 when the drawn annotation overlay was removed: the label describes
      // only the frame itself, not marks that no longer draw.
      altText: 'Running frame from your submission.',
    },
    partial: {
      banner: {
        title: 'Partial read',
        body: '{n} of 4 pillars scored from this {medium}. The rest are marked not assessed; no score is estimated.',
      },
    },
    // NEW keys, not in the deck. The deck covers this screen's happy/partial/disclaimer states
    // but not "the fetch of the stored row itself failed" — a real state per CLAUDE.md ("build
    // the states, not just the happy view") and issue #56's own "Retry/Cancel must never trap
    // the user in a dead end."
    error: {
      notFound: 'Analysis not found.',
      loadFailed: 'Analysis could not be loaded.',
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
    loadingFromHistory: 'Loading result…',
    disclaimer: {
      footer:
        'This is not medical advice. PACE assesses visible running form and flags movement patterns that research associates with elevated injury risk. It does not diagnose injuries or conditions. Form assessment from a photo or short video is an estimate, not a laboratory measurement. If you have pain, swelling or a persistent problem, or before making a significant change to how you run, consult a doctor or a qualified sports physiotherapist.',
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
    loading: 'Loading analyses…',
    empty: {
      title: 'No analyses yet',
      body: 'Completed analyses appear here.',
      cta: 'Start analysis',
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
        body: 'This removes the result and its stored frames. This cannot be undone.',
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
        title: 'Analysis could not be deleted',
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
      loadFailed: 'Analyses could not be loaded.',
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
      prompt: 'Select two analyses to compare.',
      cta: 'Compare',
    },
    empty: {
      title: 'Not enough analyses yet',
      body: 'Two analyses are required for a comparison.',
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
    loading: 'Loading analyses…',
    error: {
      loadFailed: 'Analyses could not be loaded.',
      retry: 'Retry',
    },
    // Duplicated BY VALUE from the deck's `history.compare.locked.*` (§ Screen 8) rather than
    // imported across namespaces — matching this file's own established convention for a string
    // the deck marks "Reuse ..." but this codebase has no Copy.shared namespace for (see e.g.
    // `analyzing.error.cta`'s identical note). Shown when this screen's own fresh tier read comes
    // back non-Elite, independent of whichever entry point got the user here.
    locked: {
      title: 'Compare is an Elite feature',
      body: 'Upgrade to Elite to compare two analyses side by side.',
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
        body: 'You can sign in again at any time.',
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
        body: 'This permanently deletes your account, every analysis and every stored frame. This cannot be undone.',
        cta: {
          primary: 'Delete account and data',
          secondary: 'Cancel',
        },
      },
    },
    privacy: {
      // Captain's 2026-09-20 polish pass: the two long paragraphs this card used to carry are
      // gone — one sentence stays here, and the full disclosure lives behind the `privacyPolicy`
      // link row below, not repeated inline. That one sentence still has to name the facts a
      // user giving consent again from the row below (`consent.restore`) is consenting to:
      // Anthropic processing, video never leaving the device, private storage, removal on delete.
      summary:
        'Frames are processed by Anthropic to produce your feedback, the original video never leaves your device, and frames are stored privately until you delete them.',
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
      loading: 'Checking plan…',
      error: 'Plan could not be loaded.',
      retry: 'Retry',
      // Screen-reader-only label. The VISIBLE text stays the deck's "Retry", but this screen can
      // show two Retry buttons at once (plan + consent, if both reads fail), and two controls
      // whose accessible name is the bare word "Retry" are indistinguishable to a screen reader —
      // you hear "Retry… Retry" and cannot tell which does what. Naming the target fixes that
      // without changing what anyone sees. Same pattern as the deck's own `result.pillar.a11yLabel`.
      retryA11yLabel: 'Retry loading plan',
      // The deck's `settings.plan.cta`. It was written but deliberately left unrendered until
      // there was a Paywall route for it to point at (issue #52) — that route now exists.
      cta: 'See plans',
      // V23-12 (2026-09-14): the Plan section's second row label, beside the renewal date read
      // off the live `QuotaStatus.periodEnd`. Only rendered for a paid tier — Free is lifetime and
      // has no renewal, so the row is absent rather than blank.
      renews: 'Renews',
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
        title: 'Signed out on this device',
        body: 'You are signed out on this device. The server could not be reached to end your other sessions, so they may still be active. Sign in again with a connection, then sign out to end them everywhere.',
      },
      // `stillSignedIn`: the state the audit found missing. Here retrying is NOT theatre — the
      // local session a retry would authenticate with is still fully intact, unlike the case
      // above — so this offers a real retry instead of just an acknowledgement.
      stillSignedIn: {
        title: 'Still signed in',
        body: 'The server could not be reached, so nothing changed. You remain signed in here and on other devices. Check your connection and try again.',
        cta: {
          primary: 'Try again',
          secondary: 'Cancel',
        },
      },
    },
    deleteAccountState: {
      pending: 'Deleting account…',
      // `orphansRemaining: true` is a SUCCESS, not a failure (audit finding F2) — the account IS
      // gone, irreversibly. The only thing that didn't finish is clearing a handful of stray
      // objects (almost always a concurrent upload landing mid-delete), which is why there is no
      // retry here: there is no account left to retry deleting.
      success: {
        orphansRemaining: {
          title: 'Account deleted',
          body: 'Your account and its data are deleted. A small amount of stored media may take longer to clear. Contact support if that is a concern.',
        },
      },
      error: {
        title: 'Account could not be deleted',
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
      //
      // V23-12 (2026-09-14): the Privacy card's consent ROW label — "Consent" on the left, the
      // withdraw action or the withdrawn status on the right, the same label/value shape as
      // every other settings row.
      label: 'Consent',
      status: {
        granted: 'You have consented to health-related analysis of your uploaded frames.',
        withdrawn: 'You have not consented to health-related analysis. Nothing will be analyzed until you give consent here.',
        // An account with no consent row at all — it predates the sign-up consent, or its grant
        // was dropped. Not a withdrawal, so no withdrawal language and no action: the first
        // upload or recording records it (`app/capture/index.tsx`'s self-heal).
        none: 'Consent is recorded when you first upload or record.',
        loading: 'Checking consent…',
        // hasConsented() THROWS on any query failure and must not be guessed either way (see
        // lib/consent.ts — it fails closed on purpose). So we say we don't know, rather than
        // rendering either status falsely.
        error: 'Consent status could not be loaded.',
        retry: 'Retry',
        // Screen-reader-only — see `settings.plan.retryA11yLabel` for why both Retries need one.
        retryA11yLabel: 'Retry loading consent status',
      },
      withdraw: {
        cta: 'Withdraw consent',
        confirm: {
          title: 'Withdraw consent?',
          // The honest scope, and the part users most often get wrong: withdrawing consent is not
          // erasure. Art. 7(3) withdrawal stops future processing; it does not retroactively
          // delete what is already stored. Saying so plainly — and pointing at the control that
          // DOES erase — is the difference between an honest control and a false comfort.
          body: 'Nothing will be analyzed until you give consent again here. This does not delete frames or analyses already stored. Use Delete account for that.',
          cta: {
            primary: 'Withdraw consent',
            secondary: 'Cancel',
          },
        },
        error: {
          title: 'Consent could not be fully withdrawn',
          // Two rows are written (health + future-uploads attestation), so a failure is NOT
          // provably "nothing changed" — one insert may have landed. Withdrawals are append-only,
          // so tapping again is always safe; the user must never walk away believing they
          // withdrew when the record may still show a live consent.
          body: 'Consent could not be fully withdrawn. Check your connection and tap Withdraw consent again.',
        },
      },
      // Giving consent again after a withdrawal (Art. 7(3) in reverse: as easy as withdrawing).
      // Sits beside the withdrawn status; the card's own summary above the row restates the
      // disclosure this grants against, and the full policy is one row down.
      restore: {
        cta: 'Give consent',
        // Two rows are written (health + future-uploads attestation), so — exactly like
        // `withdraw.error` above — a failure here is NOT provably "nothing changed": the first
        // insert may have landed. Grants are append-only, so tapping again is always safe.
        error: {
          title: 'Consent could not be fully saved',
          body: 'Consent could not be fully saved. Check your connection and tap Give consent again.',
        },
      },
    },
    privacyPolicy: {
      // The Settings row that opens the published policy (`PRIVACY_POLICY_URL` in
      // `constants/links.ts`; issue #202). Captain-certified 2026-09-19: the row is a link and
      // the former "not yet published" line is gone — the certified disclosure that precedes it
      // on the screen is unchanged.
      label: 'Full privacy policy',
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
        title: 'Confirm your identity',
        body: 'Deleting your account requires a recent sign-in. Enter your password to continue.',
        placeholder: 'Password',
        cta: {
          primary: 'Confirm and delete',
          secondary: 'Cancel',
        },
      },
      googlePrompt: {
        title: 'Confirm your identity',
        body:
          'Deleting your account requires a recent sign-in. You will be asked to sign in with Google again; your account will then be deleted.',
        cta: {
          primary: 'Continue with Google',
          secondary: 'Cancel',
        },
      },
      // The screen has no reauthentication flow for a provider other than password/Google today —
      // said plainly rather than silently doing nothing when `getReauthProvider` returns 'unknown'.
      unsupportedProvider: {
        title: 'Identity could not be confirmed',
        body: 'Sign out and sign in again, then retry deleting your account.',
      },
      error: {
        title: 'Confirmation failed',
        genericBody: 'Your identity could not be confirmed. Check your connection and try again.',
        // The sign-in screen's `auth.error.invalidCredentials` cannot be reused here: it offers
        // "Continue with Google" as a possibility, which is true at sign-in (any account may be
        // Google-backed) but known-false in this sheet — it opens only when `getReauthProvider`
        // says the signed-in account is a password account, and it has no Google button to press.
        // The email is not in question here either; the user is already signed in.
        wrongPassword: 'Incorrect password. Try again.',
        // Reached only if the RETRY after a successful reauthentication is ALSO rejected as stale
        // (e.g. clock skew) — distinct from genericBody because the user just did what was asked
        // and it still didn't take, which deserves its own honest explanation rather than looking
        // like the same generic failure.
        stillRequired: {
          title: 'Confirmation still required',
          body: 'The confirmation did not complete in time. Wait a moment, then retry deleting your account.',
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
    title: 'Choose a plan',
    // Same string as settings.back / shared.cta.back (deck §0) — reused by value, matching how
    // every screen before this one has handled shared.cta.* (see settings.back's own comment).
    back: 'Back',
    gate: {
      // Free tier's REAL, model-backed 1 real analysis, capped for life (captain's ruling,
      // 2026-09-06 — this replaces the retired zero-model-call sample). Never claim an upgrade
      // unlocks anything this product cannot certify: no promised pillar count, no cadence figure,
      // no ground-contact comparison — see `paywall.tier.*` below for the same discipline.
      free: {
        title: 'Free analysis used',
        body: 'Your single lifetime Free analysis has been used. Pro and Elite are outlined below.',
      },
      paid: {
        title: 'No analyses remaining this period',
        // {limit} and {renewsOn} are always live values read off a fresh quota-status response
        // (lib/subscription.ts's QuotaStatus.limit / formatRenewalDate(periodEnd)) — never a
        // constant here, per CLAUDE.md's "never authoritative on the client" rule.
        body: (limit: number, renewsOn: string) =>
          `All ${limit} analyses used this period. Renews ${renewsOn}. Upgrade for more each period.`,
      },
    },
    tier: {
      // Every `detail` below is scoped to what this product can actually certify (2026-09-06
      // ruling): no promised pillar count, no cadence figure, no left/right ground-contact
      // comparison — only certified flags/drills, and only "when supported" by the evidence.
      // Pro's 10 and Elite's 30 are display copies of the server-enforced per-period limits in
      // `public.reserve_analysis`; the client still never computes or enforces quota.
      // Free's detail changed 2026-09-19 (issue #89): a Free VIDEO now runs the same stride-burst
      // extraction as the paid tiers, so it no longer sells "a single frame". A photo is still one
      // frame on every tier, and the result screen says which pillars that leaves unassessed.
      free: {
        name: 'Free',
        price: '$0',
        detail: 'One analysis, from a photo or a short video. No injury-risk flags or drills.',
      },
      pro: {
        name: 'Pro',
        price: '$6.99 / month',
        detail:
          '10 analyses per period. Multi-frame evidence where footage supports it. Certified injury-risk flags and drills where supported.',
      },
      elite: {
        name: 'Elite',
        price: '$14.99 / month',
        detail:
          '30 analyses per period. Everything in Pro, plus deeper per-pillar feedback and side-by-side comparison of past analyses.',
      },
    },
    footnote: 'Elite adds detail and comparison, not a different analysis.',
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
      loading: 'Checking plan…',
      error: 'Plan could not be loaded.',
      retry: 'Retry',
      // Screen-reader-only label — same reasoning as settings.plan.retryA11yLabel (this screen
      // can show this Retry next to a purchase-error Retry, and two controls both named "Retry"
      // are indistinguishable to a screen reader).
      retryA11yLabel: 'Retry loading plan',
    },
    purchase: {
      pending: 'Upgrading…',
      success: {
        title: (tierName: string) => `Upgraded to ${tierName}`,
        body: 'Your new plan is active.',
      },
      error: {
        // lib/subscription.ts's PurchaseErrorCode 'not_found' — the dummy purchase-tier endpoint
        // is deployed and live (docs/architecture.md, issue #51) but gated behind
        // PURCHASE_TIER_DUMMY_ENABLED (default OFF; Known Issue #21 has the live project's
        // current state — on 2026-09-12 it was re-set with a captain-only allowlist, so every
        // non-allowlisted account still lands here). This code gets this honest, non-alarming
        // copy: it does not say "something went wrong" (nothing did) and it does not name the
        // feature flag.
        //
        // 2026-09-12 user-audit: the body used to read "This build can't complete an upgrade
        // right now. Check back soon." Both halves were false — there is no in-app purchase in
        // this app at all (no StoreKit/RevenueCat module; real IAP is Apple-gated,
        // docs/blocked-on-apple.md), so the 404 comes back from EVERY build, Expo Go or not, and
        // it will not clear on its own. Never blame the build here and never promise a retry
        // will succeed. "Your plan hasn't changed" rather than "you're still on Free": a Pro
        // account tapping Elite reaches this same branch. Locked by app/__tests__/paywall.test.tsx.
        unavailable: {
          title: 'Upgrades are not available yet',
          body: 'Purchasing a plan is not yet supported. Your plan has not changed, and you were not charged.',
        },
        // code: 'rate_limited' — the same account called purchase-tier again within 3 seconds of
        // its own last write.
        rateLimited: {
          title: 'Too soon',
          body: 'Wait a moment before trying again.',
        },
        // Every other failure (network, an unrecognized code, a malformed response) — honest and
        // retryable, matching this file's other generic-failure strings (e.g. the "check your
        // connection and try again" idiom in settings.deleteAccountState.error.body).
        generic: {
          title: 'Upgrade failed',
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
  // tables (with the same "NEW key" annotation the deck already used for the since-deleted
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
    title: 'Add footage',
    card: {
      upload: {
        title: 'Upload',
        subtitle: 'Select a photo or video from your library.',
      },
      record: {
        title: 'Record',
        subtitle: 'Record a new clip in the app. Muted; no microphone access.',
      },
    },
    framingTip: 'Side-on, full body, good light.',
    permission: {
      library: {
        title: 'Photo library access required',
        body: 'To select a running photo or video saved on your phone. Only the item you select is accessed.',
        cta: 'Allow library access',
        denied: {
          title: 'Photo library access is off',
          body: 'Enable photo library access in Settings to upload a clip.',
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
        title: 'Clip exceeds 15 seconds',
        body: 'Select a shorter clip, or record one in the app. Recording stops automatically at 15 seconds.',
      },
      // NEW — not in the deck. Shared with app/capture/extracting.tsx's pre-flight check
      // (a library pick this large is caught here, before ever navigating to Extracting).
      fileTooLarge: {
        title: 'File too large to analyze',
        body: 'Select a smaller photo or video, or record a new clip in the app.',
      },
      // Consent was withdrawn in Settings. Nothing here re-asks or re-grants it — that would
      // reverse an explicit withdrawal without the user acting — so the panel points at the one
      // place a consent can be given again.
      consentWithdrawn: {
        title: 'Consent withdrawn',
        body: 'You withdrew consent to health-related analysis. Give consent again in Settings before uploading or recording.',
        cta: 'Open Settings',
      },
    },
  },
  capture: {
    title: 'Record your run',
    // V23-10 (third artboard) draws these two as ONE line under the framing guide —
    // "Side-on, full body, good light. Muted." — so the tip matches `sourcePicker.framingTip`
    // word for word and the muted note is the single word the page shows. `app/capture/record.tsx`
    // joins them with a space; the tip drops out while recording and the note stays.
    overlay: {
      tip: 'Side-on, full body, good light.',
      muted: 'Muted.',
    },
    recording: {
      autoCap: 'Recording stops automatically at 15 seconds.',
      // {elapsed} is templated at the call site (app/capture/record.tsx), not here — it's a
      // live value, same convention as home.quota.pro.remaining's {remaining}/{limit}.
      timer: (elapsedSeconds: number) => `${elapsedSeconds}s / 15s`,
    },
    permission: {
      camera: {
        title: 'Camera access required',
        body: 'To record your running form. Recording is muted; the microphone is never accessed.',
        cta: 'Allow camera access',
        denied: {
          title: 'Camera access is off',
          body: 'Enable camera access in Settings to record your form. Recording is muted; the microphone is never accessed.',
          cta: 'Open Settings', // same string as shared.cta.openSettings — see the note above.
          secondary: 'Upload from library instead',
        },
      },
    },
    // Issue #232: `CameraView.recordAsync` rejects with a native `SimulatorNotSupported` error on
    // the iOS Simulator (no camera hardware), which used to surface as an uncaught LogBox toast.
    // Both keys route through the same `<ConfirmDialog>`; `simulatorUnsupported` names the cause
    // and points at the Upload path, `recordingFailed` is the honest fallback for every other
    // native rejection.
    recordingError: {
      simulatorUnsupported: {
        title: 'Recording is not available here',
        body: 'The simulator has no camera. Use a physical phone to record, or choose Upload to analyze an existing clip.',
        cta: 'Choose Upload',
      },
      recordingFailed: {
        title: 'Recording is not available',
        body: 'Recording could not start. Try again.',
        cta: 'Try again',
        secondary: 'Choose Upload', // same string as simulatorUnsupported.cta — shared on purpose.
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
    title: 'Preparing analysis',
    step: {
      extracting: (current: number, total: number) => `Extracting frames ${current} / ${total}`,
    },
    // NEW — not in the deck (which only specs the network-upload failure copy below). This is
    // `lib/frames.ts`'s FrameBudgetExceededError surfaced honestly: the fully-extracted frame
    // set is over the analyze-form request budget. Retrying with the same clip would produce
    // the same result, so there is no retry CTA here — only a way back to choose differently.
    error: {
      budgetExceeded: {
        title: 'Clip too large to analyze',
        body: 'The extracted frames exceed the data limit for one analysis. Use a shorter clip or a lower-resolution recording.',
      },
      // NEW — not in the deck. `lib/frames.ts`'s InsufficientFramesError: the clip decoded, but
      // too few of its frames landed on genuinely different instants to read motion from. Like
      // budgetExceeded and unlike extractionFailed, this is deterministic for a given clip — the
      // same footage through the same pipeline collides identically — so there is no retry CTA,
      // only a way back to choose different footage. Worded for a runner, not a decoder: no
      // "frame rate", no "fps", no "decoder".
      unsupportedFootage: {
        title: 'Clip unsuitable for full analysis',
        body: 'Consecutive frames are too similar to show movement, which usually indicates the clip was re-recorded or exported from another app. Use a clip recorded directly from the camera at normal speed.',
      },
      // NEW — not in the deck. Any other extraction failure (a corrupt file, a native-module
      // error) — distinct from budgetExceeded because retrying the same input CAN succeed here.
      extractionFailed: {
        title: 'Clip could not be processed',
        body: 'Frame extraction failed. Try again or select a different clip.',
      },
    },
    // NEW — not in the deck. Was a genuine stopping point ("Done" -> Home) until issue #135
    // wired this screen's one control to hand off into `/analyzing` — reuses `home.cta.analyze`'s
    // exact wording ("Start analysis") rather than inventing a distinct label for what is, from
    // the user's point of view, the same action: starting an analysis of what's now ready.
    ready: {
      title: 'Frames ready',
      body: (frameCount: number) => `${frameCount} frame${frameCount === 1 ? '' : 's'} extracted and ready for analysis.`,
      cta: 'Start analysis',
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
    banner: 'Offline. Capture is available; upload and analysis require a connection.',
    blocked: {
      title: 'Offline',
      body: 'This requires an internet connection. Reconnect and try again. Nothing has been sent.',
      // Deck says "Reuse shared.cta.retry" — no Copy.shared namespace exists (see the note at
      // `analyzing.error.cta` above); every other reuse of this string duplicates it by value
      // instead, so this matches that established convention rather than introducing the first
      // shared namespace here.
      cta: 'Retry',
    },
  },
  // Cross-cutting — the anti-farm COOLDOWN (issue #6's `too_many_failed_attempts`). NEW, not in
  // the deck. Shared by three surfaces that all report the same fact, so they cannot drift apart:
  // `app/capture/extracting.tsx`'s pre-flight refusal, `app/analyzing.tsx`'s panel for a server
  // 429 that beat the pre-flight, and (for the caption only) Home.
  //
  // WHAT THIS COPY IS FIXING. This state used to render `analyzing.error.failed` — "Your analysis
  // failed / The analysis service didn't return a usable result" — beside a Retry button. Every
  // part of that was wrong: nothing failed, the service was never called, and Retry resubmitted
  // into the identical refusal. So:
  //   - the TITLE names a pause, not a failure;
  //   - the BODY says what actually happened (several recent analyses could not be scored, which
  //     is precisely what `pace_is_farming_signal` counts) and states the time left when the
  //     server gave us one — `body` is the honest fallback when it did not;
  //   - "nothing was counted against your quota" is literally true here: a refused reserve never
  //     creates a row, so there is nothing to count;
  //   - there is NO retry CTA, because retrying cannot succeed until the window clears. The one
  //     control leaves for Home, which shows the same countdown.
  // Deliberately does NOT offer an upgrade: `analyze-form` maps this to 429 rather than 402 for
  // exactly that reason — selling a plan to someone we just throttled would be both wrong and
  // useless, since a purchase does not lift this window for the tier they are already on.
  analysisPause: {
    title: 'Analyses paused',
    bodyFor: (remaining: string) =>
      `Several recent analyses could not be scored, so new ones are paused for ${remaining}. Nothing was counted against your quota.`,
    body: 'Several recent analyses could not be scored, so new ones are paused for a short period. Nothing was counted against your quota.',
    // Reuses `settings.back`/`paywall.back`'s wording by value, this file's established convention
    // for a shared string (see `analyzing.error.cta`'s note on the absent Copy.shared namespace).
    cta: 'Back to Home',
  },
} as const;
