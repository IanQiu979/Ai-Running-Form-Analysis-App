# Change Log

Running history of behavior-changing work, newest first. Each entry is a dated `## YYYY-MM-DD`
heading followed by a bulleted list of what changed (and why, where it's not obvious). When you
make a behavior-changing commit, add a bullet under today's date — create a new heading at the
**top** of the file if there isn't one yet for today. Don't rewrite or delete past entries.

## 2026-07-12

- **Repo audit: seven small, self-contained M1 bugs fixed in one pass (closes #13, #14, #19,
  #22, #23, #31, #33).** Each had a prescribed, mechanical fix in its issue and needed no design
  decision; everything larger or ambiguous found in the same read-through was left as an issue
  rather than fixed inline.
  - `app/_layout.tsx` — both splash-screen calls (`preventAutoHideAsync`, `hideAsync`) can reject
    and neither was caught (#31). Also caught `Linking.getInitialURL()`'s rejection in
    `lib/session-provider.tsx`, the same class of unhandled promise, found in the same pass.
  - `app/(tabs)/index.tsx` — Home's root is now a `ScrollView` with `flexGrow: 1` (the pattern
    sign-in already used), so large Dynamic Type sizes reflow instead of clipping with no way to
    reach the CTA (#19); the loading state renders `Copy.home.quota.loading` ("Checking your
    plan…") next to the spinner instead of leaving the deck key unused and screen readers with
    nothing to announce (#14); the quota Retry button gets `HitTarget.min` on both axes, up from
    ~28pt (#13); and the sign-out link gets the pressed-state dim every other touchable has (#22).
  - `app/(auth)/sign-in.tsx` — pressed and disabled/busy no longer render at the same opacity
    (#23): `buttonPressed` (0.6) and `buttonDisabled` (0.4) are now separate, matching Home's
    meaning of the two tokens. The mode-toggle link gets press feedback (#22).
  - Deleted the unreferenced create-expo-app template UI — `external-link`, `hello-wave`,
    `parallax-scroll-view`, `ui/collapsible`, `themed-text`, `themed-view`, `hooks/use-theme-color`
    and the four `react-logo` assets (#33). `themed-text` held `#0a7ea4`, the last hardcoded color
    outside `constants/theme.ts`. `haptic-tab` and `ui/icon-symbol` are the only components left,
    both live via `(tabs)/_layout.tsx`.
- **Trimmed the sign-in error that promised a password reset the app doesn't have (closes #18).**
  `auth.error.invalidCredentials` is now "Email or password doesn't match. Try again." — the
  clause "or reset your password" is gone from both `docs/design/copy-deck.md` (Screen 1) and
  `constants/copy.ts`. There is no forgot-password link, no reset screen, and no
  `resetPasswordForEmail` call anywhere in the repo, and this is the error a returning user is
  most likely to hit, so it was routing them at a capability that does not exist. Ian's call
  (2026-07-12) was to trim the copy rather than build the flow; a real reset flow is an auth
  feature (new screen + deep-link/redirect config) and would be filed separately.
- **Closed #65 (M7: remaining empty/error/offline states) as not planned, no code changed.** It
  was an umbrella whose two halves both belong elsewhere. Wiring the deck's states into screens
  3–11 is blocked — those screens don't exist (M2–M6 not started) — and lifting a screen's copy
  keys is part of building that screen, not a polish pass afterwards, so it belongs in each
  milestone's own issue rather than a standing M7 one. Its actionable half (the M1 audit's
  missing deck keys) was already covered by #30, #17, #9, and #18. The audit found gaps wider
  than those issues recorded; they're now comments on #30 (a third hardcoded string,
  `title: 'Home'` in `app/(tabs)/_layout.tsx`, plus hardcoded `'Pro'`/`'Elite'` in
  `describeReadyQuota`) and #9 (the `8` is triplicated across `config.toml`, `sign-in.tsx`, and
  the `copy.ts` string, and the rule is still invisible until the user fails).
- **Merged the three open PRs to `main` and cleared the Apple-blocked work out of the tracker.**
  - Merged PR #73 (client-side HIBP check), PR #72 (privacy policy + labels + consent design),
    and PR #75 (EAS init + icon/splash) into `main`, resolving the conflicts between them. All
    three had added an entry under this date, and all three had edited `docs/status.md`.
  - **One real integration bug surfaced only in the merge:** #73 added HIBP as a new third party
    and made `docs/privacy-checklist-m7.md` require the policy to name it — while #72, written in
    parallel, drafted a policy that never mentioned HIBP at all. Each PR was self-consistent; the
    two merged together were not. `docs/privacy-policy.md` now discloses HIBP/Cloudflare
    (k-anonymity: the password never leaves the device; HIBP sees an IP + timestamp).
  - **New [`docs/blocked-on-apple.md`](blocked-on-apple.md).** Everything needing the Apple
    Developer Program is tracked in that file instead of in GitHub issues, so the open-issue list
    holds only work that is actionable today. Issues #66 (EAS/TestFlight pipeline) and #67 (Sign
    in with Apple) were **deleted** and reproduced verbatim there; #68 and #69 were **rewritten**
    to keep only their non-Apple halves.
  - #69 was retitled — it is **not** Apple-blocked. Its trigger is the first dev build, and
    `eas.json`'s `development` profile builds for the iOS simulator with no Apple account.
  - **Closed #26** (splash / Android adaptive-icon colors) — fully fixed by PR #75.
  - `jest.config.js` now ignores `.claude/worktrees/`. Those worktrees carry their own
    `node_modules` and a duplicate copy of the test suite, so `npm test` was discovering the
    copies and failing two suites that pass in the real tree. Added to `.gitignore` as well.
- **Implemented the client-side HaveIBeenPwned leaked-password check (issue #70)** — the
  follow-up to the 2026-07-11 M1 security audit's HTTP 402 finding below: Supabase's
  server-side leaked-password protection is Pro-plan-gated and stays unenabled, so this adds an
  equivalent check ourselves instead of waiting on a plan upgrade.
  - New `lib/hibp.ts`: `checkPasswordBreached(password)` SHA-1s the password on-device
    (`expo-crypto`), sends only the first 5 hex chars of the hash to HIBP's free, keyless Pwned
    Passwords range API (`api.pwnedpasswords.com`, Cloudflare-fronted) with `Add-Padding: true`,
    and matches the remaining 35 chars locally — k-anonymity means the plaintext password and
    the full hash never leave the device.
  - Wired into `app/(auth)/sign-in.tsx`'s sign-up branch only, called before
    `supabase.auth.signUp`: a breached password hard-blocks account creation (no account is
    ever created); an unreachable/timed-out HIBP fails open and lets the signup proceed —
    deliberate, since a bypassable client-side check must not block a real signup on a
    third-party outage.
  - Adjacent fix: `mapAuthError` used to swallow Supabase's "password should be at least 8
    characters" into the generic error, telling a user with a too-short password nothing
    actionable. Added a specific `auth.error.passwordTooShort` mapping, plus a new
    `auth.error.passwordBreached` copy key — both added to `docs/design/copy-deck.md` first,
    then lifted into `constants/copy.ts`, per the deck's rule against hand-writing copy in JSX.
  - `lib/__tests__/hibp.test.ts` — 15 tests, mutation-verified, covering the correctness traps
    called out in `lib/hibp.ts`'s header comment (padding rows never count as a match,
    case-insensitive suffix compare, uppercase-before-slice, non-2xx/timeout/network-throw all
    fold to `unavailable`, and a privacy assertion that only the 5-char prefix ever appears in
    the outbound request URL).
  - **Known, deliberate limits — this does not close issue #70.** The check is client-side and
    therefore bypassable: anyone can call the Supabase Auth API directly and set a breached
    password, so it protects real users from reused breached passwords but is not server-side
    enforcement — the Pro-plan upgrade is still the real fix. It runs on sign-up only; there is
    no password-reset/change-password flow in the app yet, and one built later must call
    `checkPasswordBreached` too. Not applicable to Google OAuth, which has no password.
  - `docs/architecture.md`'s `lib/` layout and Supabase-config sections updated to distinguish
    the still-unapplied server-side setting from the new client-side mitigation.
    `docs/privacy-checklist-m7.md`'s data inventory gained a row for `api.pwnedpasswords.com`,
    plus a standing requirement to deny/drop that URL if a crash or analytics SDK is ever added
    (its request URL is a durable, identity-linked password-hash-prefix fingerprint otherwise).
- **Issue #68 (M7 privacy gate) — the unblocked slice.** The issue's two in-app items (consent
  line, result disclaimer) are blocked on M2/M4, which don't exist yet; the rest was buildable
  now and is done.
  - `docs/privacy-policy.md` — new, the publishable policy text. **Publication is ON HOLD**:
    the data controller's legal name/country and a contact email are unresolved, and
    publication is additionally gated on in-app account deletion actually shipping (App Store
    Guideline 5.1.1(v)). Guarded by a `DO NOT PUBLISH` HTML comment.
  - `docs/app-store-privacy-labels.md` — new, the exact App Store Connect / Play Data Safety
    answers so submission is a lookup rather than a re-derivation.
  - **Corrected a material factual error before it could ship.** The draft policy (and
    `docs/privacy-checklist-m7.md`, its source) claimed Anthropic retains data for a ~30-day
    "trust-and-safety window." Verified against Anthropic's live retention docs: that is
    backwards — 30 days is the *ordinary* window, and content flagged by Anthropic's automated
    safety systems may be retained **up to two years**, a carve-out that survives even Zero
    Data Retention. The draft also wrongly promised ZDR would "close this window entirely."
    This matters here specifically: the payload is images of bodies in running kit, the class
    of image most likely to be a safety-classifier false positive.
  - **Consent upgraded to an Art. 9-grade design (Ian's call).** The drafted Continue/Cancel
    modal is an affirmative act but not *explicit* consent, and it never named health data at
    all — so it could not carry Art. 9. `consent.upload.*` in `docs/design/copy-deck.md` now
    has a `consent.upload.checkbox` key naming the health processing and Anthropic by name,
    with the primary CTA disabled until it's ticked. M2 must build this variant.
  - **Fixed invalid-consent copy.** `consent.upload.body` said "Your photo or video is stored
    privately" and `settings.privacy.body` contradicted itself in a single string — but the
    original video never leaves the device (Ruling 1). Misinformed consent is invalid consent;
    both are now frames-only.
  - **Label answers: declare more, not less.** Added `Health & Fitness → Health` (the
    injury-risk flags are health data regardless of whether the runner's note ever ships) and
    `Usage Data → Product Interaction`, resolving two policy-vs-label contradictions that App
    Review specifically checks for.
  - **Decisions recorded:** TestFlight beta excludes EU/UK testers (keeps GDPR out of scope for
    the beta, avoiding an Art. 27 representative); the policy will be hosted from a new public
    repo via GitHub Pages (this repo is private on GitHub Free, where Pages is unavailable —
    and pointing Pages at `/docs` would leak internal planning docs).
  - **New for counsel:** the Australian Privacy Act's small-business exemption does **not**
    apply to a business holding health information (s6D(4)(b)) — an app producing injury-risk
    assessments plausibly qualifies, which would make this a full APP entity regardless of
    size. Flagged in the checklist.
  - Checklist stale items resolved: the camera/photo-library permission strings *are* present
    in `app.json` (landed in `943d04b`), so that MUST box and conflict #3 are now ticked.
  - Verified no analytics/crash SDK: `package.json` is clean (no Sentry/Segment/Firebase/
    RevenueCat/Amplitude/Mixpanel/PostHog/Bugsnag/AppsFlyer/Facebook, and no `expo-updates`).
- **EAS project initialized** (GitHub issue #66, groundwork only — the pipeline is still
  blocked, see below). `eas init` created `@ianbeatingpros/pace-analysis-ai`
  (`d19968ff-22b8-4851-8e74-087aeb9846b0`); `app.json` gained `extra.eas.projectId` and a
  top-level `owner: "ianbeatingpros"`. `owner` was added deliberately, not left to the default:
  without it, EAS resolves a project by slug against whoever is currently logged in, which
  silently breaks the same `eas build` command on another machine or in CI.
- **New `eas.json`**, four build profiles. `eas.json` is parsed with a strict Joi schema (plain
  `JSON.parse`) and cannot contain comments, so the reasoning below lives here, not in the file:
  - `development` — dev client, internal distribution, `ios.simulator: true`, Android APK.
    `ios.simulator: true` is what makes an iOS build possible **at all** today — there is no
    Apple Developer account, so a real-device iOS build has nowhere to get a provisioning
    profile from.
  - `development-device` — extends `development`, `ios.simulator: false`. Written but unusable:
    blocked on the Apple Developer account (an on-device build needs an ad-hoc provisioning
    profile).
  - `preview` — internal distribution, Android APK.
  - `production` — `autoIncrement`, Android app-bundle.
  - `submit.production` — an empty placeholder; the App Store Connect app ID and Apple team ID
    land once Apple exists.
- **EAS server-side env vars created** (project scope) for `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, in all three environments (development/preview/
  production), at visibility **`sensitive`, deliberately not `secret`** — recording the
  reasoning so a future session doesn't "harden" it and break things. `EXPO_PUBLIC_*` is
  inlined in plain text into the compiled bundle regardless of how EAS stores it, so anyone who
  installs the app can extract it — the key's real protection is Supabase RLS, not secrecy.
  `secret` visibility is **write-only** (unreadable via the dashboard, `env:list`, *and*
  `env:pull`), so it would buy zero security while destroying recoverability: no `eas env:pull`
  onto a new machine, and no diffing the EAS value against the live Supabase ref when a build
  points at the wrong backend. `ANTHROPIC_API_KEY` was verified **absent** from all three EAS
  environments and must stay that way — it belongs only in `supabase secrets`, per `CLAUDE.md`
  § Secrets & env. Worth stating plainly: a build missing these vars does not degrade —
  `lib/supabase.ts` throws at module import, so the app hard-crashes on the splash screen.
- **Real app icon + splash art landed, replacing the Expo template defaults — closes GitHub
  issue #26.** Design is "The Gait Plate" (`docs/design/frontend-design-brief.md` §1): a ground
  rule, a posture line leaning off it, a short detached arc marking the lean angle (drawn like a
  goniometer/biomechanics annotation), and a filled landing marker at the vertex — the one point
  of color, `score.strong` (`#2E7D5B`), deliberately **not** `accent` (`#2F6BEB`), which the
  brief reserves for the primary CTA alone.
  - New `assets/source/*.svg` (`mark-light`, `mark-dark`, `mark-mono`, `mark-favicon`) is now
    the versioned source of the art, not hand-edited PNGs.
  - New `scripts/generate-app-assets.js` + `npm run assets` rasterizes the SVGs into the six
    PNGs in `assets/images/` that `app.json` points at. `sharp` added as a devDependency — the
    machine had no rasterizer at all before this. The PNGs are build outputs: edit the SVGs, run
    `npm run assets`, never hand-edit the PNGs.
  - `icon.png` is deliberately flattened onto the bone field with **no alpha channel**: iOS
    applies its own corner mask, and App Store Connect rejects an icon that carries
    transparency. The generator script hard-fails if alpha ever reappears on that file — this
    rule is enforced in code, not just documented, so it can't silently regress.
  - New `assets/images/splash-icon-dark.png` and a new `dark.image` key in `app.json`'s
    `expo-splash-screen` plugin config. This goes beyond what issue #26 asked for (a dark splash
    **background color** swap only), and the reason matters: the splash mark is dark ink drawn
    for the light (bone) field, so on the warm-graphite dark background it would have been
    near-invisible — and `app/_layout.tsx` deliberately holds the splash (
    `SplashScreen.preventAutoHideAsync()`, hidden only once fonts and the session check both
    resolve) for a real, visible duration, so an invisible mark would actually be seen.
  - Deleted `assets/images/android-icon-background.png`: issue #26 wanted a flat background
    **color** for the Android adaptive icon, so the PNG that used to hold a solid field was dead
    weight.
- **Issue #26 is closed by this work**: splash `backgroundColor` `#ffffff` → `#F4F1EA`, dark
  `#000000` → `#1A1712`; Android `adaptiveIcon.backgroundColor` `#E6F4FE` (Expo template pale
  blue) → `#F4F1EA`. All three are now `constants/theme.ts` tokens instead of template defaults.
- **Issue #66 stays open.** There is still no Apple Developer account, so there are no iOS
  credentials, no `eas build` for a device or the store, no `eas submit`, and no TestFlight
  pipeline — the second half of #66's title ("...and TestFlight pipeline") is not done. Sign in
  with Apple (#67, already `docs/status.md` Known Issue #3) is the same dependency. Removing
  `exp://**` from the Supabase redirect allowlist (#69) is still a required pre-first-EAS-build
  cleanup and has not been done. `docs/status.md` Known Issue #7 is split rather than closed to
  reflect this.

## 2026-07-11

- Executed Phase 0 of `docs/mvp-build-prompt.md` ("Reconcile before building anything"),
  committing the previous session's layer (the knowledge files, the `docs/design/` brief, and
  the build prompt itself) and closing the decision gate.
- **Ian answered the five remaining decision-gate items:**
  - Fallback/quota (#4): a validation-failed analysis becomes an honest, clearly-labelled
    partial result only when ≥2 pillars parsed, otherwise a clean failure; failures and
    fallbacks never burn quota (the atomic reserve is released), capped at 3 free retries per
    period against prompt-injection farming.
  - The numbers (#5): max clip length 15s; frames analyzed per tier — Free 1 / Pro 5 / Elite 8;
    max upload size 50MB pre-compress.
  - App name (#6): **"Pace AnalysisAI."** Repo/directory keeps the "V2.3" codename internally.
  - Apple Developer timing (#7): build email + Google sign-in in M1 now; add Sign in with Apple
    the moment an Apple Developer account exists, before TestFlight review.
  - Consent & privacy (#8): a one-line consent notice before first upload plus a Settings
    disclosure ship in v1; the full privacy policy and App Store privacy labels are tracked for
    M7, not dropped.
- Renamed the app in `app.json` to match decision #6: `name` "Pace AnalysisAI", `slug`
  `pace-analysis-ai` (dots removed — the previous slug was illegal), `scheme` "paceanalysisai",
  `ios.bundleIdentifier` and `android.package` both `com.ian.paceanalysisai` (follows V2.2's
  `com.ian.*` precedent).
- Synced all 14 rulings from `docs/mvp-build-prompt.md` §0-B into `planning/README.md`,
  `planning/01-brainstorm.md`, `planning/02-product-requirements.md`,
  `planning/03-engineering-requirements.md`, and `docs/architecture.md`: frames-only media
  pipeline (`media_path text` → `media_paths text[]`, direct-to-bucket upload, no video ever
  stored), the atomic reserve/settle quota RPC replacing count-then-insert, the idempotency-key
  design, the frame-sampling spec (5%–95% window, actual timestamps, ≤1568px/q≈0.7 downscale),
  V2.2's purchase-anchored quota-period arithmetic with Free as lifetime, the new
  `delete-account` edge function, the corrected Sonnet 5 model config (explicit thinking,
  4–8k `max_tokens`, forced tool call), the `{ error, code }` error contract and the
  `FunctionsHttpError`-unwrapping client note, the corrected 4-source-files-to-3-targets
  knowledge mapping (`drills.md` sourced from `ECHO_Framework_CORRECTED.md`, not
  `training_zones.md`/`workout_library.md`, which have zero drills), and the V1 ground-truth
  corrections (real enforcement lives in `anthropic-coach`, not `lib/subscription.ts`; V1 video
  "analysis" was one thumbnail at t=1s; V1 never persisted results).
- Updated `docs/status.md`: Known Issues #1 (app name) and #2 (illegal slug) marked resolved;
  #3 (Apple) records the timing decision; #9 (storage) updated to reflect frames-only retention.
  "Next action" now points at Phase 1 (the spine, M1) since the decision gate is fully closed.
- **Executed Phase 0.5 (the design layer) via four parallel agents**, closing its gate:
  - `ux-copywriter` → `docs/design/copy-deck.md`: the full copy deck — every screen state,
    permission rationales, the consent line, quota captions, and the disclaimer wording the
    brief called for but didn't fully write out.
  - `design-system` → rebuilt `constants/theme.ts` from the brief's §2 tokens (light+dark,
    score-band palette, spacing/radii/type scales), added `constants/contrast.ts`, and added
    `constants/__tests__/theme-contrast.test.ts` — a 61-assertion Jest proof every text/surface
    and band pair clears WCAG AA. **9 of the brief's intent values needed adjustment** to pass
    (darkened or lightened minimally); each old → new value is recorded inline in `theme.ts`
    next to the token it changed, not repeated here. Installed the three font families
    (`@expo-google-fonts/archivo`, `inter`, `ibm-plex-mono`) via `npx expo install`, which
    auto-added the `expo-font` plugin to `app.json`.
  - `motion-animation` → `docs/design/motion-consult.md`: confirmed every motion in brief §6 is
    implementable on the already-installed Reanimated/gesture-handler stack (no new
    dependencies) and specified the gaps the brief left open (wait-state pacing, reveal
    triggers, reduced-motion mapping) as binding spec for `frontend-builder`.
  - `privacy-compliance` → `docs/privacy-checklist-m7.md`: a ranked MUST/SHOULD privacy and
    compliance checklist gating M7 (App Store privacy labels, consent upgrade, data inventory,
    retention limits), which surfaced two new decisions for Ian, added to `docs/status.md` as
    Known Issues #10 and #11: (a) `knowledge/injury_flags.md` assumes a user-supplied free-text
    injury/pain note that has no field or screen anywhere in `planning/02` or the design brief —
    ship it (a new health-data channel needing its own consent + label) or drop it for MVP,
    decide before M3/M4; (b) no dollar figure exists anywhere for the Pro/Elite paywall, needed
    before M5.
  - Also fixed a dangling cross-reference in `docs/design/frontend-design-brief.md` screen 6:
    it cited "build prompt Ruling 15" for the Retry/Cancel-must-never-trap-the-user rule, but
    the build prompt's rulings end at 14. Replaced the citation with the rule stated inline.
- `CLAUDE.md`'s Secrets & env section's media bullet was corrected to frames-only wording
  (extracted frames are what's stored; the full-resolution video never leaves the device).

- **Ian closed the two decisions Phase 0.5 surfaced** (asked and answered same day):
  - **Runner's note: dropped for MVP.** The analysis runs on frames alone; no free-text
    injury/pain note field ships. `knowledge/injury_flags.md`'s note-handling guidance is
    dormant — M3's prompt adaptation excludes it (under Ian's certification review), and the
    `analyze-form` contract stays note-free. Revisit post-TestFlight (if shipped later it's a
    health-data channel with its own consent + privacy-label cost).
  - **Paywall pricing: Pro $6.99 / Elite $14.99 per month** — display prices for the M5 dummy
    paywall, chosen over Echo V1's $4.99/$9.99 as a higher anchor; real IAP (post-MVP) can
    re-decide. `docs/design/copy-deck.md`'s `{{price}}` placeholders resolved.
- **Executed Phase 1 — the spine (M1)** on `feat/m1-spine`, four commits, built/reviewed/audited
  same day:
  - `943d04b` — `supabase init` (`config.toml`, `supabase/.gitignore`, project linked to
    `vputdomdlknvthnzritt`); `app.json` got the `expo-camera` + `expo-image-picker` plugins with
    the copy deck's exact `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` strings,
    mic permission stripped on both platforms (`microphonePermission: false` on both plugins,
    `recordAudioAndroid: false`) — verified via a throwaway prebuild that no
    `NSMicrophoneUsageDescription` lands in `Info.plist` and `RECORD_AUDIO` is actively removed
    from the Android manifest.
  - `2b1e6f6` — the DB spine, **7 migrations applied live** (`supabase db push`, advisors
    clean): `profiles` (auto-created via an `auth.users` trigger), `subscriptions` (no row =
    free), `analyses` (`UNIQUE(user_id, idempotency_key)`, `media_paths text[]`,
    reserved/delivered/released lifecycle), the `reserve_analysis`/`settle_analysis`/
    `release_analysis` RPC family (service-role-only, `pg_advisory_xact_lock`-serialized
    concurrency, Free 1 lifetime / Pro 10 / Elite 30 purchase-anchored month-end-clamped
    periods, 3-failed-attempt anti-farming cap), and the private `media` Storage bucket (5MB
    cap, `image/jpeg` only, path-owner RLS).
  - `31098f0` — the auth spine: `lib/supabase.ts` + `lib/crypto-polyfill.ts` (Hermes has no
    WebCrypto, so PKCE silently degrades S256→plain without it — the root cause behind Echo
    V1's "invalid flow state" failures, fixed with an `expo-crypto` shim), `lib/auth.ts` (browser
    OAuth for Google), `lib/session-provider.tsx` + `Stack.Protected` guards, `app/(auth)/sign-in`
    per design-brief screen 1, and the M1 empty Home per screen 2 (RLS-scoped, display-only
    quota). Fonts wired at the root layout; the template Explore tab and modal deleted.
  - `5f14b22` — code-review fixes (splash-screen `.catch` on a rejected session read, Home's
    quota error state with last-known-value + Retry + focus refetch, a `crypto-polyfill`
    byteOffset fix, Android OAuth double-exchange dedupe, hardcoded dimensions replaced with
    `ControlHeight`/`HitTarget`/`Opacity` tokens) plus auth config hardening
    (`minimum_password_length` 6→8).
  - **Security audit: no Critical or High findings**; 5 findings fixed same-day (above).
    Two config discoveries recorded in `supabase/config.toml`'s `[auth]` block rather than lost:
    the hosted project has **no signup rate-limit field** at all (`sign_in_sign_ups` is
    CLI/self-hosted-only; the Management API silently drops it), so CAPTCHA is the only real
    anti-farming lever; and **HaveIBeenPwned leaked-password rejection is Pro-plan-gated** —
    attempting to enable it returned HTTP 402, so it's documented as deferred, not applied.
  - **Live auth config changes** (via a scoped Management API PATCH — `site_url`,
    `uri_allow_list`, `mailer_autoconfirm` only; `supabase config push` deliberately not run
    against this project, see `config.toml`'s warning): `site_url` set to the app's own
    `paceanalysisai://` scheme (no web frontend); the redirect allowlist replaced a stale
    pre-rename entry (`v23photovideoanalysis://google-auth`) with
    `paceanalysisai://oauth-callback`, `paceanalysisai://**`, and `exp://**` (Expo Go dev
    testing); `mailer_autoconfirm` turned on deliberately — no transactional email provider or
    confirmation-pending screen exists yet, so requiring email confirmation would dead-end a
    fresh signup; `minimum_password_length` raised 6→8.
  - **`ANTHROPIC_API_KEY` rotated by Ian**, placed in the gitignored `supabase/functions/.env`
    for local dev, and pushed to production via `supabase secrets set` (confirmed present in the
    secrets list) — the long-standing M4 blocker (Known Issue #4) is gone.
  - Supabase CLI confirmed logged in and linked to the project for the session.
- Replaced `AGENTS.md`'s "How much process to run" tier table with a mandatory **Subagent Usage
  Policy** (written by `doc-writer` to Ian's spec): LOW / MEDIUM / HIGH-CRITICAL severity tiers
  with a required minimum subagent chain per tier (HIGH runs the full 7-step
  plan → architecture review → implement → test → security/review → docs → final-QA chain, and
  keeps the existing hot list — auth, RLS, payments, uploaded media, edge functions, schema,
  `analyze-form`), a category → agent lookup reaching all 70 subagents in `~/.claude/agents/`,
  an explicit no-skipping rule (same-message user override only), and a default-to-the-higher-tier
  escalation rule. This deliberately supersedes the old table's inline-first philosophy
  ("spawning a subagent is the expensive path"); delegation is now the default for anything
  non-trivial. `CLAUDE.md` needed no change — nothing in it contradicts the new policy.

## 2026-07-10

- Added `typecheck` (`tsc --noEmit`) and `test` (`jest`) npm scripts alongside the existing
  `start`/`ios`/`android`/`web`/`lint`.
- Added `jest.config.js` (jest-expo preset, mirrors the transform-ignore setup needed for
  `@supabase` and `react-native-url-polyfill`, `passWithNoTests: true` since the repo has no
  test files yet) and `jest.setup.js` (AsyncStorage mock).
- Ignored `.superpowers/` in `.gitignore`.
- Rewrote `CLAUDE.md` from a bare `@AGENTS.md` include into the full project doc: what this is,
  architecture at a glance, commands, secrets & env, git etiquette, code conventions, testing,
  and keep-these-docs-updated.
- Extended `AGENTS.md` with the pinned-SDK note (Expo SDK 54, `expo ~54.0.34`) and the rule
  that an SDK upgrade must update the versioned-docs link in the same commit.
- Added `docs/change_log.md`, `docs/status.md`, and `docs/architecture.md` to give future
  sessions persistent, accurate project memory — using V2.3's own milestones (M1–M7, from
  `planning/02-product-requirements.md`), not V2.2's.
- Repaired `.env`. `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` had lost its `KEY=`, leaving the line
  with no `=` at all, so dotenv skipped it and the key never loaded — the Supabase client would
  have thrown on first import. Also deleted the two dead `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID`
  placeholders: the browser OAuth flow keeps Google's client ID and secret in the Supabase
  dashboard, and no source file reads them. Verified via `npm run lint`, whose loader output now
  exports both Supabase vars and no Google vars. Because `.env` is gitignored, this entry is the
  only record of that change.
- Rewrote `AGENTS.md` into an agent routing map. All 70 subagents in `~/.claude/agents/` are now
  mapped to the task each one owns, grouped by phase (plan / build / design / verify / test /
  ship / config), with read-only agents marked `°`. Routing rows point back at `CLAUDE.md`'s
  rules rather than restating them, so the two can't drift. The pinned-SDK note stays as the
  opening section; the file is held to 100 lines.
- Added a "How much process to run" tier table to `AGENTS.md`. Severity, not file count, decides
  how many steps run: Trivial edits go straight in, Small edits get `verifier` and stop, and any
  change to auth, RLS, payments, uploaded media, edge functions, schema, or the `analyze-form`
  flow runs the full plan → build → verify → review → docs chain **even as a one-file diff**.
  Small work stays inline because spawning a subagent is the expensive path — it starts cold and
  re-derives context the session already has.
- `CLAUDE.md` now says what its bare `@AGENTS.md` include actually pulls in: the routing map, and
  that the rules in `CLAUDE.md` bind every agent it names.
- Fixed "can't open the project in Expo Go". Root cause: `expo-dev-client` is a dependency, so
  `expo start` defaults to a development build and advertises
  `exp+v2.3-photo-video-analysis://expo-development-client/?url=…` — a deep link Expo Go cannot
  open. Nothing was wrong with the network or the phone. Added a `start:go` script
  (`expo start --go`), which serves `exp://192.168.x.x:8081` and reports "Using Expo Go";
  verified by running it. Pressing `s` in the dev server does the same thing at runtime.
  `expo-dev-client` was deliberately kept — a dev build is still the right target for Android and
  for any future custom native module.
