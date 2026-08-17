# V2.3 — Copy Deck

> Companion to [`frontend-design-brief.md`](frontend-design-brief.md). Covers every string the
> brief's 11 screens and states need but doesn't fully write out: permission rationales, consent,
> error/empty/offline states, framing guidance, quota captions, paywall copy, the disclaimer +
> stop-running language, and tier labels. `frontend-builder` should lift these verbatim — keyed
> `screen.section.element.state`, grouped by screen in the order the brief lists them (§4).
>
> **Voice, held everywhere:** plain, calm, specific, coach-not-scold. No "Oops," no exclamation
> marks in errors, no apologizing twice, no judgment-loaded language about bodies. Buttons name
> the outcome, not "Submit" / "OK." Sentence case throughout. App display name is exactly
> **Pace Analysis AI** — that casing, everywhere it appears as a string (not "PACE AnalysisAI" or
> the glued "Pace AnalysisAI").
> Free tier copy never promises more than 1 lifetime analysis, and paid-tier quota copy never
> says "this month" — it's "this period" or a renewal date, because periods are purchase-day-
> anchored, not calendar months.
>
> `{braces}` mark a runtime value (a count, a date, a pillar name). Every destructive confirm
> button names the destruction (rule: a hurried user only reads the button).

---

## 0. Shared components (defined once, reused by key)

Buttons and micro-copy that recur across screens. Define once in code, reference everywhere below
rather than re-typing — keeps the voice from drifting screen to screen.

| Key | String | Notes |
|---|---|---|
| `shared.cta.retry` | "Retry" | Any recoverable failure. |
| `shared.cta.cancel` | "Cancel" | Any confirm/error modal's non-destructive exit. Must actually navigate the user somewhere sane (back to Home or the source picker) — never leave them stranded on a dead screen. |
| `shared.cta.openSettings` | "Open Settings" | Permission-denied states; deep-links to the OS Settings app. |
| `shared.cta.seePlans` | "See plans" | Routes to Paywall. |
| `shared.cta.done` | "Done" | Dismisses a screen with no further action needed. |
| `shared.cta.back` | "Back" | Simple back navigation. |

## 1. Tier labels (shared)

| Key | String |
|---|---|
| `tier.free.name` | "Free" |
| `tier.pro.name` | "Pro" |
| `tier.elite.name` | "Elite" |

## 2. Score bands (shared — used by every pillar row and VoiceOver string)

| Key | String | Score range |
|---|---|---|
| `band.needsWork` | "Needs work" | 0–49 |
| `band.developing` | "Developing" | 50–69 |
| `band.solid` | "Solid" | 70–84 |
| `band.strong` | "Strong" | 85–100 |

---

## Screen 1 — Sign in / Sign up

| Key | String | Shows when |
|---|---|---|
| `auth.valueProp` | "Submit a photo or video of your run and get clear, specific feedback on your form." | Below the logo, both sign-in and sign-up. One line, no restating the app name (the logo already carries it). |
| `auth.cta.google` | "Continue with Google" | |
| `auth.cta.apple` | "Continue with Apple" | Ships the moment an Apple Developer account exists (gate #8 in the build prompt) — string is ready now. |
| `auth.cta.email` | "Continue with email" | Opens the email/password fields. |
| `auth.email.placeholder` | "Email" | |
| `auth.password.placeholder` | "Password" | |
| `auth.password.hint` | "At least 8 characters." | Helper line under the password field, **sign-up mode only** (the rule is irrelevant when signing in to an existing account). Added for issue #24 — before it, the 8-character minimum was only ever revealed *after* a failed submit. The number is not typed here: `constants/copy.ts` templates it off `PASSWORD_MIN_LENGTH` (`constants/auth.ts`), which is tied by comment to `supabase/config.toml`'s `minimum_password_length` — the server remains the authority. If that server value changes, this string follows automatically. |
| `auth.signIn.submit` | "Sign in" | |
| `auth.signUp.submit` | "Create account" | |
| `auth.signUp.link` | "New here? Create an account" | Text link on the sign-in screen, not a second button (brief §4.1). |
| `auth.signIn.link` | "Already have an account? Sign in" | Text link on the sign-up screen. |
| `auth.error.invalidCredentials` | "Email or password doesn't match. Try again, reset your password, or use Continue with Google if that's how you signed up." | Sign-in fails on bad credentials. Two clauses were added back deliberately, each with the capability it names: the reset clause when issue #81 shipped `app/(auth)/reset-password.tsx` (it had been trimmed 2026-07-12, issue #18, precisely because no such route existed), and the Google clause on 2026-08-12 — a Google-created account has no password, so its email in this form returns the same `invalid_credentials` as a wrong password, and without the hint the user's only readable conclusion is "sign-in is broken", which is what happened in live testing. Naming Google as a *possibility* leaks nothing: this string shows for every credential failure, so it discloses no account state. Keep that rule — never let this string say anything true only of the email that was typed. |
| `auth.error.emailInUse` | "An account already exists with this email. Sign in instead." | Sign-up with a taken email. |
| `auth.error.generic` | "Sign-in didn't go through. Try again." | Any other auth failure — provisional until Phase 1 wires real Supabase error codes; replace with a specific string per code where one exists rather than falling back to this by default. |
| `auth.error.passwordBreached` | "That password has shown up in a data breach before. Pick a different one to keep your account secure." | Sign-up: the submitted password matches a known-breached password. Server-side HaveIBeenPwned rejection is enabled and is the authority (issue #70, closed 2026-07-12 — the org moved to Supabase Pro); `lib/hibp.ts`'s client-side range-API check runs first as a fast pre-check, and `mapAuthError` (`lib/auth-errors.ts`) shows this string either way. Blocks account creation; no jargon ("pwned," "hash," "HaveIBeenPwned") and no blaming the user — reused passwords are common, the copy just asks for a different one. |
| `auth.error.passwordTooShort` | "Password must be at least 8 characters." | Sign-up: Supabase rejects the password on length. Previously fell through to the generic error, telling the user nothing they could act on. |
| `auth.error.signInCancelled` | "Sign-in was cancelled." | Google sign-in (issue #5): the provider's own redirect carried `error=access_denied` — the user declined on Google's consent screen after the browser sheet had already "succeeded" from `WebBrowser`'s point of view, so the normal silent-cancel path (closing the sheet) never fires and the app has to say something or the user is left wondering if it worked. Provider-neutral wording on purpose — Apple sign-in (`auth.cta.apple`) will hit the same code path once it ships. |
| `auth.error.signInExpired` | "Sign-in expired before it could finish. Try again." | Google sign-in (issue #5): the PKCE verifier stored on-device was missing or no longer matched what the server had on file (lost/cleared storage, a different app install, or too much time passed between starting the browser flow and the redirect landing back). Previously this failure was silently swallowed — the user landed back on sign-in with nothing. |

### Password reset (issue #81) — NEW, CERTIFIED by Ian 2026-07-13

There was previously no way back into an email account for a user who forgot their password —
`auth.error.invalidCredentials`'s note above records that the earlier "…or reset your password"
clause was deliberately trimmed (issue #18) because no such flow existed yet. It now does. These
keys were written to this deck's own voice rules (plain, calm, name the outcome, no jargon) but
have **not** been reviewed by `ux-copywriter` or Ian — mirrored here from `constants/copy.ts`
verbatim, not reworded, per this doc's role as the source of truth once a key is settled. Treat as
a draft until certified.

| Key | String | Shows when |
|---|---|---|
| `auth.reset.cta.forgotPassword` | "Forgot password?" | New link on the sign-in screen (email/password mode), routes to the request screen below. |
| `auth.reset.request.title` | "Reset your password" | Screen header, `app/(auth)/reset-password.tsx`. |
| `auth.reset.request.body` | "Enter your email and we'll send you a link to reset it." | |
| `auth.reset.request.cta.send` | "Send reset link" | |
| `auth.reset.request.cta.backToSignIn` | "Back to sign in" | |
| `auth.reset.request.success.title` | "Check your email" | Request submitted — **shown identically regardless of whether the email has an account**, by design (`lib/password-reset.ts`'s `requestPasswordReset` is enumeration-safe; this is the only success message that flow can produce). |
| `auth.reset.request.success.body` | "If an account exists for {email}, we've sent a link to reset your password." | |
| `auth.reset.request.error.rateLimited` | "Too many attempts. Wait a few minutes and try again." | Supabase's per-project/IP `auth.rate_limit.email_sent` limit — not an enumeration risk, since it says nothing about whether `{email}` itself has an account. |
| `auth.reset.request.error.generic` | "We couldn't send that email. Check your connection and try again." | Any other request failure. |
| `auth.reset.update.title` | "Set a new password" | Screen header, `app/(auth)/update-password.tsx` — reached only via the emailed recovery link. |
| `auth.reset.update.password.placeholder` | "New password" | |
| `auth.reset.update.cta.submit` | "Update password" | |
| `auth.reset.update.cta.continue` | "Continue" | Shown after a successful update. |
| `auth.reset.update.checking` | "Confirming your link…" | Bounded wait while the screen confirms Supabase's `PASSWORD_RECOVERY` event landed — not a spinner-forever, same rule `analyzing.longWait` follows. |
| `auth.reset.update.success.title` | "Password updated" | |
| `auth.reset.update.success.body` | "You're all set — signed in with your new password." | |
| `auth.reset.update.error.expiredLink.title` | "This link has expired" | Covers both a link Supabase reports as expired/already-used AND a link opened with no recovery params at all — both are the same actionable state. |
| `auth.reset.update.error.expiredLink.body` | "Password reset links only work once and expire after a while. Request a new one." | |
| `auth.reset.update.error.expiredLink.cta` | "Request a new link" | Routes back to the request screen. |
| `auth.reset.update.error.generic` | "We couldn't update your password. Try again." | A genuine `updateUser` failure — deliberately its own string rather than reusing `auth.error.generic` ("Sign-in didn't go through"), the wrong frame for a failed password *update*. |

---

## Screen 2 — Home / Analyze

| Key | String | Shows when |
|---|---|---|
| `home.title` | "Home" | The screen's heading and its tab-bar label — one key, both call sites (`app/(tabs)/index.tsx` and `app/(tabs)/_layout.tsx`), which is the point: they must never drift. Added for issue #30, which found the string hand-written in both places. **Open design question, deliberately not settled here:** whether Home should carry a "Home" heading at all when the tab bar directly beneath it already says "Home" — the brief describes Home as "a motif + a CTA," not a headline screen. Resolve before M7's polish pass; if the heading is dropped, this key stays and serves the tab label alone. |
| `home.cta.analyze` | "Analyze my form" | Default primary CTA — user has quota remaining (Free: unused; Pro/Elite: remaining > 0). Fixed wording per brief §4.2. |
| `home.cta.upgradeToAnalyze` | "Upgrade to analyze" | Free tier, lifetime analysis already used. Routes to Paywall. Replaces `analyze` rather than reusing it — tapping this never starts an analysis, so the label must say so (see "ambiguities" at the end of this deck). |
| `home.cta.upgradeForMore` | "Upgrade for more" | Pro tier, period quota used up but an upgrade path (Elite) exists. Routes to Paywall. |
| `home.cta.analyzeDisabled` | "Analyze my form" | Elite tier, period quota used up — no higher tier to upgrade to. Render disabled/greyed rather than relabeled, paired with `home.quota.exhausted.elite` underneath. |
| `home.quota.free.available` | "1 free analysis available" | Free, unused. Never "this month." |
| `home.quota.exhausted.free` | "You've used your free analysis" | Free, used. |
| `home.quota.pro.remaining` | "{remaining} of {limit} analyses left this period" | Pro, quota remaining. e.g. "7 of 10 analyses left this period." |
| `home.quota.elite.remaining` | "{remaining} of {limit} analyses left this period" | Elite, quota remaining. |
| `home.quota.renewsOn` | "Renews {date}" | Secondary caption under the remaining-count line, Pro/Elite only — Free has no renewal, it's a one-time allotment. |
| `home.quota.exhausted.pro` | "You've used all {limit} analyses this period — renews {date}" | Pro, quota used up. |
| `home.quota.exhausted.elite` | "You've used all {limit} analyses this period — renews {date}" | Elite, quota used up. |
| `home.quota.loading` | "Checking your plan…" | Quota fetch in flight. |
| `home.quota.error.stale` | "Showing your last known plan status." | Quota-status fetch failed — show the last cached value with this quiet caption, not a blocking error. |
| `home.quota.error.failed` | "Couldn't load your plan status." | Quota fetch failed and there is no cached value to show (first load). Paired with the retry action. Backfilled 2026-07-11 from the M1 build — the deck originally only covered the has-cache case. |
| `home.quota.error.retry` | "Retry" | Small text action next to the stale/failed caption — reuse `shared.cta.retry`. |
| `home.quota.blocked` | "You can't start a new analysis right now. Try again later." | NEW key (issues #54/#15), CERTIFIED by Ian 2026-07-13. `pace_quota_status` can report `blocked: true` (issue #6's anti-farm cap) independently of `remaining` — a user can have quota left and still be refused right now. This deck never specced the state; kept short and generic rather than inventing detailed anti-farm messaging. |
| `home.recent.label` | "Your last analysis" | Heading above the most-recent gait-plate thumbnail, once history exists. |
| `home.empty.caption` | "Nothing analyzed yet." | Optional small line under the faint annotated-figure motif, before any history exists. The motif + CTA already carry the empty state per brief §4.2 — this is a one-line reinforcement, not required. |

---

## Screen 3 — Source picker

| Key | String | Shows when |
|---|---|---|
| `sourcePicker.title` | "Add your run" | Screen header. |
| `sourcePicker.card.upload.title` | "Upload" | |
| `sourcePicker.card.upload.subtitle` | "Choose a photo or video from your library." | |
| `sourcePicker.card.record.title` | "Record" | |
| `sourcePicker.card.record.subtitle` | "Film a new clip in the app — muted, no microphone." | Names the muted-by-design fact right on the card, not just inside Capture. |
| `sourcePicker.framingTip` | "Best read comes from a side-on shot — full body, good light." | One-line tip below the two cards, per brief §4.3. |
| `sourcePicker.permission.library.title` | "Pace Analysis AI needs your photo library" | Soft-ask shown before the OS prompt, first time Upload is tapped. |
| `sourcePicker.permission.library.body` | "To choose a running photo or video already saved on your phone. We only access what you pick." | |
| `sourcePicker.permission.library.cta` | "Allow library access" | Triggers the OS permission prompt. |
| `sourcePicker.permission.library.denied.title` | "Photo library access is off" | User previously denied or later revoked the permission. |
| `sourcePicker.permission.library.denied.body` | "Turn on photo library access in Settings to upload a clip." | |
| `sourcePicker.permission.library.denied.cta` | "Open Settings" | Reuse `shared.cta.openSettings`; deep-links to the app's OS Settings page. |
| `sourcePicker.permission.library.denied.secondary` | "Record instead" | Offers the other path so the user isn't stuck — routes to Capture. |
| `sourcePicker.error.clipTooLong.title` | "This clip is longer than 15 seconds" | NEW key (issue #36). A library-picked video, unlike an in-app recording (bounded by `CameraView`'s own `maxDuration`), can be arbitrarily long — `lib/media-caps.ts`'s `checkMediaCaps` catches it after the picker returns. |
| `sourcePicker.error.clipTooLong.body` | "Pick a shorter clip, or record a new one in the app — recording stops automatically at 15 seconds." | |
| `sourcePicker.error.fileTooLarge.title` | "This file is too large to analyze" | NEW key (issue #36). The picked photo/video exceeds `lib/media-caps.ts`'s 50MB pre-compress cap. Shared with `app/capture/extracting.tsx`'s pre-flight re-check. |
| `sourcePicker.error.fileTooLarge.body` | "Choose a smaller photo or video, or record a new clip in the app." | |

---

## Screen 4 — Capture

| Key | String | Shows when |
|---|---|---|
| `capture.title` | "Record your run" | Screen header. |
| `capture.overlay.tip` | "Stand side-on, full body in frame, about 10 metres back. Level the camera and shoot in good light." | Overlaid on the camera preview alongside the faint full-body figure outline, per brief §4.4. |
| `capture.overlay.muted` | "Recording is muted — no audio, no microphone." | Shown once near the record button; states the privacy feature plainly rather than leaving a silent recording unexplained. |
| `capture.recording.autoCap` | "Clips stop automatically at 15 seconds." | Shown before/while recording. |
| `capture.recording.timer` | "{elapsed}s / 15s" | Live counter while recording. |
| `capture.permission.camera.title` | "Pace Analysis AI needs your camera" | Soft-ask before the OS prompt, first time Record is tapped. |
| `capture.permission.camera.body` | "To record your running form. Recording is muted — we never access your microphone." | States what the permission is for, per Apple review + the rule that a permission prompt must say what the app does with it. |
| `capture.permission.camera.cta` | "Allow camera access" | Triggers the OS permission prompt. |
| `capture.permission.camera.denied.title` | "Camera access is off" | User previously denied or later revoked the permission. |
| `capture.permission.camera.denied.body` | "Turn on camera access in Settings to record your form. Recording is muted — we never access your microphone." | |
| `capture.permission.camera.denied.cta` | "Open Settings" | Reuse `shared.cta.openSettings`. |
| `capture.permission.camera.denied.secondary` | "Upload from library instead" | Offers the other path so the user isn't stuck — routes back to the Upload card. |

### iOS `Info.plist` strings (for Phase 1 — paste into `app.json`, either via `ios.infoPlist` directly or the `expo-camera` / `expo-image-picker` config-plugin permission props)

| Key | String | Info.plist key |
|---|---|---|
| `infoPlist.cameraUsage` | "Used to record a video or photo of your running form for analysis. Recording is muted — Pace Analysis AI never accesses your microphone." | `NSCameraUsageDescription` |
| `infoPlist.photoLibraryUsage` | "Used to choose an existing photo or video of your running form to analyze." | `NSPhotoLibraryUsageDescription` |

There is **no** `NSMicrophoneUsageDescription` — no microphone permission is ever requested, by
design. Don't add the key.

---

## Screen 5 — Uploading / Extracting

**Sequencing note:** per the build prompt's Ruling 1, frames are extracted **client-side first**
(no network needed) and only the small extracted frames are then uploaded direct-to-bucket — the
original video is never uploaded. The brief's prose (§4.5) lists "upload %, then extracting" in
the opposite order; this deck follows the engineering ruling as the source of truth. See
"Ambiguities" at the end.

**Update, issue #36 (2026-07-12):** issue #88 (merged, live) went further than the sequencing
note above — the client no longer uploads frames **at all**; `analyze-form` (M4) writes them
server-side, after the model call. `upload.step.uploading`/`upload.error.*`/`upload.offline.*`
below describe a client-upload step that no longer exists in the live contract and are **not**
implemented by `app/capture/extracting.tsx` — kept here as a record of the deck's original
design, not deleted, since a future direct-upload path (if one ever returns) would want the same
copy. `constants/copy.ts`'s `upload.*` namespace only implements `title`/`step.extracting` from
this table, plus the NEW keys below for states this table never covered (a local extraction
failure, not a network one).

| Key | String | Shows when |
|---|---|---|
| `upload.title` | "Preparing your analysis" | Screen header, covers both steps. |
| `upload.step.extracting` | "Extracting frames {current} / {total}" | Local frame extraction, `frames.ts` running — no network yet. |
| `upload.step.uploading` | "Uploading {percent}%" | Extracted frames uploading direct-to-bucket. **Not implemented** — see the #36 update note above. |
| `upload.error.title` | "Upload didn't go through" | Frame upload fails. **Not implemented** — see the #36 update note above. |
| `upload.error.body` | "We couldn't upload your frames — check your connection and try again." | |
| `upload.error.cta.retry` | "Retry" | Reuse `shared.cta.retry`. |
| `upload.error.cta.cancel` | "Cancel" | Reuse `shared.cta.cancel`; returns to the source picker. |
| `upload.offline.title` | "You're offline" | Connectivity drops mid-upload. **Not implemented** — see the #36 update note above. |
| `upload.offline.body` | "Uploading needs a connection. Reconnect and try again — nothing has been saved yet." | Explicit "nothing saved yet" honors the "never claim saved when it isn't" rule (brief §5). |
| `upload.offline.cta` | "Retry" | Reuse `shared.cta.retry`. |
| `upload.error.budgetExceeded.title` | "This clip is too large to analyze" | NEW key (issue #36). `lib/frames.ts`'s `FrameBudgetExceededError` — the fully-extracted frame set exceeds the `analyze-form` request budget. No retry CTA (only "Back" to the source picker): the same input would fail again. |
| `upload.error.budgetExceeded.body` | "Its extracted frames add up to more data than one analysis can send. Try a shorter clip or a lower-resolution recording." | |
| `upload.error.extractionFailed.title` | "Couldn't process this clip" | NEW key (issue #36). Any other extraction failure (corrupt file, native-module error, malformed route params) — distinct from budgetExceeded because retrying CAN succeed here, so this state offers Retry as well as Back. |
| `upload.error.extractionFailed.body` | "Something went wrong preparing your frames. Try again or choose a different clip." | |
| `upload.ready.title` | "Frames ready" | NEW key (issue #36). Extraction succeeded. There is no next screen yet — `analyze-form` (M4, issue #44) and the Analyzing wait screen (issue #80) don't exist — so this is a genuine, honest stopping point, not a placeholder implying more exists. |
| `upload.ready.body` | "{frameCount} frame(s) extracted and ready for analysis." | |
| `upload.ready.cta` | "Done" | Reuse `shared.cta.done` ("Dismisses a screen with no further action needed" — exactly true today). Returns to Home. M4 replaces this branch with the real handoff into analysis. |

---

## Screen 6 — Analyzing

| Key | String | Shows when |
|---|---|---|
| `analyzing.title` | "Analyzing" | Screen header. |
| `analyzing.step.reading` | "Reading your form…" | Early client-side step list, per brief §4.6. |
| `analyzing.step.scoring` | "Scoring the four pillars…" | |
| `analyzing.longWait` | "Still analyzing — a full read takes a moment." | Calm static line after the honesty threshold (no fake progress bar, no spinner-forever). |
| `analyzing.error.failed.title` | "Your analysis failed" | Model response failed structural validation twice (retry-once, then fail). Shortened from "Your analysis didn't go through" in the 2026-08-03 design polish pass — the original wraps to two lines at `FontSize.xxl` in `app/analyzing.tsx`'s `ErrorPanel`. |
| `analyzing.error.failed.body` | "The analysis service didn't return a usable result. This one wasn't counted against your quota — try again." | Explicitly says quota wasn't burned, per the task's requirement. |
| `analyzing.error.timeout.title` | "Analysis timed out" | The vision call exceeds the wait threshold with no response. |
| `analyzing.error.timeout.body` | "The read took too long to finish. This one wasn't counted against your quota — try again." | |
| `analyzing.error.cta.retry` | "Retry" | Reuse `shared.cta.retry`. |
| `analyzing.error.cta.cancel` | "Cancel" | Reuse `shared.cta.cancel`; returns to Home. Retry/Cancel must never trap the user — every error state needs an exit. |

### Released-reservation dead end (issue #128) — NEW, NOT YET CERTIFIED

This deck's Screen 6 table above assumes every error state can be retried. One cannot: when the
reservation behind this request was already released, a Retry re-submits the SAME idempotency key
and `reserve_analysis` hands the same released row straight back, so it can only fail identically
forever. Both routes into that state — the server's `409 previous_attempt_failed`, and issue #64's
`released` phase found by foreground reconciliation — show this copy, whose primary action starts a
new analysis instead. Written to this deck's own voice rules (plain, calm, name the outcome, never
claim a state that isn't true) but **not** reviewed by `ux-copywriter` or Ian — mirrored here
verbatim from `constants/copy.ts`, a draft until certified (`docs/status.md` Known Issue #34).

| Key | String | Shows when |
|---|---|---|
| `analyzing.error.previousAttemptFailed.title` | "Analysis stopped" | The reservation for this request was already released — server `409 previous_attempt_failed`, or issue #64's reconciled `released` phase. Shortened from "That analysis didn't finish" in the 2026-08-03 design polish pass — the original (and an interim "Analysis didn't finish") wraps to two lines at `FontSize.xxl` on the narrowest supported width (iPhone SE/mini, 375pt). |
| `analyzing.error.previousAttemptFailed.body` | "An earlier attempt at this one stopped before it completed. It wasn't counted against your quota — start a new analysis to try again." | Deliberately drops the bare "try again" the `failed`/`timeout` copy carries, which here would name an action that cannot work. |
| `analyzing.error.cta.startNew` | "Start a new analysis" | Primary action on that panel; routes to `/capture`, where the normal flow mints a fresh idempotency key. Cancel is still the second exit. |

---

## Screen 7 — Results

### The PACE readout

| Key | String | Shows when |
|---|---|---|
| `result.overall.label` | "Overall" | Headline number's label. |
| `result.pillar.posture.label` | "Posture" | |
| `result.pillar.armSwing.label` | "Arm swing" | |
| `result.pillar.cadence.label` | "Cadence" | |
| `result.pillar.elasticity.label` | "Elasticity" | |
| `result.pillar.notAssessed.angle` | "Not assessed — film side-on for this." | Pillar not assessable from the framing/angle given. Exact wording from the brief §3. |
| `result.pillar.notAssessed.needsVideo` | "Not assessed — needs video, not a photo." | Pillar needs motion (Cadence/Elasticity) but only a photo was submitted — preserves `pace_framework.md`'s own phrase, "needs video." |
| `result.pillar.a11yLabel` | "{pillar}, {score} out of 100, {band}." | VoiceOver announcement per pillar row, per brief §7. |
| `result.hero.altText` | "Your running frame, marked with posture and ground lines." | VoiceOver alt text for the annotated hero frame, per brief §7. |

### Partial result

| Key | String | Shows when |
|---|---|---|
| `result.partial.banner.title` | "Partial read" | The response validated with ≥2 but not all 4 pillars parsed. |
| `result.partial.banner.body` | "We could confidently score {n} of 4 pillars from this clip. The rest are marked not assessed — we don't guess at a score." | Never implies the missing pillars failed the runner; makes clear it's a medium/parse limitation, not a fabricated low score. |

### Disclaimer + stop-running (rendered on every result)

| Key | String | Shows when |
|---|---|---|
| `result.disclaimer.footer` | "This is not medical advice. PACE analyzes visible running form and flags movement patterns that research associates with elevated injury risk — it does not diagnose injuries or conditions. Form assessment from a photo or short video is an estimate, not a lab measurement. If you have pain, swelling, or a persistent problem, or before making a big change to how you run, consult a doctor or a qualified sports physiotherapist." | **Every** result screen, every tier, no exceptions — verbatim from `pace_framework.md`, already tight; no phrasing change needed beyond this being its final, shipped form. |
| `result.stopRunning.banner.visible` | "Before we talk form — what's visible here is a signal to get checked by a professional before running on it. Form fixes come after that." | A stop-running trigger is visibly present in the media (swelling, limp, favouring one side). Leads the result, above the PACE readout — never buried under form feedback. Shown to **all tiers**, including Free, overriding the normal Free = "no flags" gating (`injury_flags.md`'s stop-running section is explicit that this is universal). |
| `result.stopRunning.banner.reported` | "Before we talk form — what you're describing is a signal to get checked by a professional before running on it. Form fixes come after that." | The runner's own note reports a stop-running signal (sharp/worsening pain, Achilles pain). Same placement and tier rule as above. |
| `result.stopRunning.detail` | "Sharp or worsening pain, swelling, a limp, or Achilles pain that flares under load are all reasons to stop and get assessed before you run again." | Supporting line under either stop-running banner variant — restates `injury_flags.md`'s trigger list plainly, without diagnosing. |
| `result.cta.done` | "Back to Home" | Primary action once a result is read. |

---

## Screen 8 — Past Analyses

| Key | String | Shows when |
|---|---|---|
| `history.title` | "History" | Tab header (also the screen's own `KineticText` heading). Shortened from "Past Analyses" in the 2026-08-03 design polish pass — the original wraps to two lines at `FontSize.display` (64pt). |
| `history.loading` | "Loading your analyses…" | List fetch in flight. |
| `history.empty.title` | "No analyses yet" | No history. |
| `history.empty.body` | "Your analyses will live here." | Per brief §4.8, verbatim. |
| `history.empty.cta` | "Analyze my form" | The one action that fills the empty state (rule 4) — routes into the capture flow. |
| `history.item.a11yLabel` | "Analysis from {date}, overall {score} out of 100, {band}." | VoiceOver label for each list row. |
| `history.item.a11yLabelNotAssessed` | "Analysis from {date}, not assessed." | NEW key (issue #55), CERTIFIED by Ian 2026-07-13. An analysis whose overall is honestly null (every pillar not assessed) still needs a real VoiceOver sentence — mirrors `result.pillar.notAssessed.generic`'s "never stringify null as a score" rule. |
| `history.item.deleteCta` | "Delete" | NEW key (issue #55), CERTIFIED by Ian 2026-07-13. This deck specs the confirmation dialog (`history.delete.confirm.*` below) but not a label for the row's own delete trigger — the built screen's affordance is a persistent tappable control per row (design brief §8 offers swipe/long-press as alternatives; a persistent tap target reads correctly to VoiceOver with no gesture to discover). |
| `history.delete.confirm.title` | "Delete this analysis?" | Shown after the row's own Delete control (see `history.item.deleteCta` above). |
| `history.delete.confirm.body` | "This removes the result and its saved frames. This can't be undone." | States both halves of the purge (row + frames), matching Ruling 6. |
| `history.delete.confirm.cta.primary` | "Delete analysis" | Names the destruction (rule 3), not "OK." |
| `history.delete.confirm.cta.secondary` | "Cancel" | Reuse `shared.cta.cancel`. |
| `history.delete.error.title` | "Couldn't delete this analysis" | NEW key (issue #55), CERTIFIED by Ian 2026-07-13. This deck covers the confirm dialog but not a failed delete's own outcome. |
| `history.delete.error.body` | "Check your connection and try again." | |
| `history.delete.error.dismiss` | "OK" | Reuses `settings.alertDismiss`'s wording by value. |
| `history.error.loadFailed` | "Couldn't load your past analyses." | NEW key (issue #55), CERTIFIED by Ian 2026-07-13. This deck's §5 states checklist names a loading state for this list but not a load-FAILURE state; mirrors `result.error.*`'s identical addition for the single-result screen. |
| `history.error.retry` | "Retry" | Reuse `shared.cta.retry`. |
| `result.loadingFromHistory` | "Loading your result…" | Opening a stored result cold — regenerating the short-TTL signed URLs for its frames. |
| `history.compare.cta` | "Compare two analyses" | Elite tier, ≥2 analyses exist — entry point into the Compare screen. |
| `history.compare.locked.title` | "Compare is an Elite feature" | Free/Pro tier taps a locked compare entry point. |
| `history.compare.locked.body` | "Upgrade to Elite to compare two of your analyses side by side." | |
| `history.compare.locked.cta` | "See plans" | Reuse `shared.cta.seePlans`. |

---

## Screen 9 — Compare (Elite, minimal)

| Key | String | Shows when |
|---|---|---|
| `compare.title` | "Compare" | Screen header. |
| `compare.picker.prompt` | "Pick two analyses to compare." | Entry state — no selections made yet. |
| `compare.picker.cta` | "Compare" | Enabled once exactly two analyses are selected. |
| `compare.empty.title` | "Not enough analyses yet" | Fewer than 2 past analyses exist. |
| `compare.empty.body` | "Save two analyses to compare them side by side." | |
| `compare.vs` | "vs" | Connector between the two readouts. |
| `compare.delta.positive` | "+{n} {pillar}" | A pillar improved between the two selected analyses, e.g. "+6 Posture." |
| `compare.delta.negative` | "−{n} {pillar}" | A pillar declined, e.g. "−3 Cadence." Use the minus sign (−, U+2212), not a hyphen. |
| `compare.delta.none` | "No change" | A pillar's score is identical between the two. |
| `compare.delta.a11yLabel` | "{pillar} changed by {delta} points, from {oldScore} to {newScore}." | VoiceOver announcement per delta row. |

---

## Screen 10 — Paywall (dummy)

| Key | String | Shows when |
|---|---|---|
| `paywall.title` | "Choose your plan" | Screen header, whether reached voluntarily (Settings → See plans) or via a quota gate. |
| `paywall.gate.free.title` | "You've used your free analysis" | Reached because a 402 fired for a Free user (lifetime analysis already used). |
| `paywall.gate.free.body` | "Free includes one analysis, ever. Upgrade to Pro or Elite to keep going." | |
| `paywall.gate.paid.title` | "You're out of analyses this period" | Reached because a 402 fired for a Pro/Elite user (period quota used up). |
| `paywall.gate.paid.body` | "You've used all {limit} analyses this period. It renews {date}. Upgrade for more each period." | Never exposes the raw `402`/error code — states what happened, why, and the option. |
| `paywall.tier.free.name` | "Free" | Reuse `tier.free.name`. |
| `paywall.tier.free.price` | "$0" | |
| `paywall.tier.free.detail` | "1 analysis, once — try it before you commit. Certified PACE scores and one line of feedback per pillar. No drills." | |
| `paywall.tier.pro.name` | "Pro" | Reuse `tier.pro.name`. |
| `paywall.tier.pro.price` | "$6.99 / month" | Decided by Ian 2026-07-11 (dummy paywall display price; real IAP is post-MVP). |
| `paywall.tier.pro.detail` | "10 analyses per period. Full PACE analysis, injury-risk flags, and 1–2 corrective drills per issue." | |
| `paywall.tier.elite.name` | "Elite" | Reuse `tier.elite.name`. |
| `paywall.tier.elite.price` | "$14.99 / month" | Decided by Ian 2026-07-11, same caveat as Pro. |
| `paywall.tier.elite.detail` | "30 analyses per period. Everything in Pro, plus a bit more depth per pillar and side-by-side comparison between two past analyses." | |
| `paywall.footnote` | "Elite adds a little more detail and comparison — not a different analysis." | The honest detail-gradient line the brief calls for (§4.10): Pro→Elite is "more of it," never sold as a better analysis. |
| `paywall.cta.upgrade.pro` | "Upgrade to Pro" | Names the destination tier, not "Subscribe" or "Submit." |
| `paywall.cta.upgrade.elite` | "Upgrade to Elite" | |
| `paywall.cta.current` | "Current plan" | Disabled-state label on the user's own tier card. |

### Purchase pending/success/failure (issue #52) — NEW, CERTIFIED by Ian 2026-07-13

This deck's Screen 10 table above only ever specced the three static tier cards and the two
402-triggered gate banners — it never covered what happens DURING or AFTER tapping an "Upgrade"
CTA: no pending/success/failure copy existed for the dummy purchase at all. Written to this deck's
own voice rules (plain, calm, name the outcome, never claim a state that isn't true, no jargon)
but **not** reviewed by `ux-copywriter` or Ian — mirrored here verbatim from `constants/copy.ts`,
a draft until certified.

| Key | String | Shows when |
|---|---|---|
| `paywall.alertDismiss` | "OK" | Dismisses the purchase-result `Alert`. Same value/role as `settings.alertDismiss`. |
| `paywall.plan.loading` | "Checking your plan…" | The screen's own quota-status read is in flight. |
| `paywall.plan.error` | "Couldn't load your plan." | That read failed. |
| `paywall.plan.retry` | "Retry" | Reuse `shared.cta.retry` by value. |
| `paywall.plan.retryA11yLabel` | "Retry loading your plan" | Screen-reader-only label — this screen can show this Retry next to a purchase-error Retry, and two controls both named "Retry" are indistinguishable to a screen reader. |
| `paywall.purchase.pending` | "Upgrading…" | The dummy `purchase-tier` call is in flight. |
| `paywall.purchase.success.title` | "You're on {tierName} now" | A templated function, not a plain string. Purchase succeeded. |
| `paywall.purchase.success.body` | "Your new plan is active." | |
| `paywall.purchase.error.unavailable.title` | "Upgrading isn't available yet" | Code `not_found` — `purchase-tier` is deployed and live but gated behind `PURCHASE_TIER_DUMMY_ENABLED` (default OFF); see `constants/copy.ts`'s comment on this key for the current deployment state. Both cases collapse to the same honest, non-alarming copy; it does not name the feature flag. |
| `paywall.purchase.error.unavailable.body` | "This build can't complete an upgrade right now. Check back soon." | |
| `paywall.purchase.error.rateLimited.title` | "One at a time" | Code `rate_limited` — the same account called `purchase-tier` again within 3 seconds of its own last write. |
| `paywall.purchase.error.rateLimited.body` | "Give it a moment before trying again." | |
| `paywall.purchase.error.generic.title` | "Your upgrade didn't go through" | Every other failure (network, an unrecognized code, a malformed response). |
| `paywall.purchase.error.generic.body` | "Nothing was charged. Check your connection and try again." | |

---

## Screen 11 — Settings

| Key | String | Shows when |
|---|---|---|
| `settings.title` | "Settings" | Screen header. |
| `settings.section.account` | "Account" | |
| `settings.section.plan` | "Plan" | |
| `settings.section.privacy` | "Privacy" | |
| `settings.plan.current` | "{tier}" | Reuses the tier label strings. |
| `settings.plan.cta` | "See plans" | Reuse `shared.cta.seePlans`. |
| `settings.restorePurchases.cta` | "Restore purchases" | |
| `settings.signOut.cta` | "Sign out" | |
| `settings.signOut.confirm.title` | "Sign out?" | |
| `settings.signOut.confirm.body` | "You can sign back in anytime with the same account." | Not destructive, but confirms the intent since it's a one-tap account action. |
| `settings.signOut.confirm.cta.primary` | "Sign out" | |
| `settings.signOut.confirm.cta.secondary` | "Cancel" | Reuse `shared.cta.cancel`. |
| `settings.deleteAccount.cta` | "Delete account" | Row entry point. |
| `settings.deleteAccount.confirm.title` | "Delete your account?" | |
| `settings.deleteAccount.confirm.body` | "This permanently deletes your account, every analysis, and every stored frame. This can't be undone." | States the full scope of the purge (matches `delete-account`'s storage-objects → rows → auth-user order). |
| `settings.deleteAccount.confirm.cta.primary` | "Delete account and data" | Names the destruction fully (rule 3) — not "Delete" alone. |
| `settings.deleteAccount.confirm.cta.secondary` | "Cancel" | Reuse `shared.cta.cancel`. |
| `settings.privacy.body` | "Your original photo or video never leaves your device. We extract a small number of still frames from it on your phone, and only those frames are uploaded — stored in a private location only you can access, and kept there until you delete the analysis or your account. To generate your results, the stored frames are sent to Anthropic, our AI provider, to analyze your form." | Fuller Settings disclosure, matching the first-upload consent line's facts (frames-only, private + kept-until-deleted, sent to Anthropic for analysis). Corrected 2026-07-12: the previous string said frames were "stored" while also claiming videos were "stored in a private location" — self-contradictory, and factually wrong per Ruling 1 / `architecture.md` (the original video never leaves the device; only extracted frames are ever uploaded or stored). |
| `settings.privacy.deleteNote` | "Deleting an analysis removes its stored frames immediately. Deleting your account removes everything." | |

### Reauthentication (issue #124) — NEW, CERTIFIED by Ian 2026-07-13

`delete-account` now requires proof of a *recent* real credential (password or OAuth), not just a
valid session, before it runs the purge (server-side gate — see `_shared/delete-account.ts`'s
"REAUTHENTICATION FRESHNESS" section). These strings cover the step-up flow that satisfies it: a
password re-entry prompt for email/password accounts, a heads-up before re-running Google sign-in
for OAuth accounts, and honest failure copy for the cases neither can resolve. Written to this
deck's own rules (name the outcome, no jargon, don't blame the user) but **not** reviewed by
`ux-copywriter` or Ian — mirrored here verbatim from `constants/copy.ts`, a draft until certified.

| Key | String | Shows when |
|---|---|---|
| `settings.reauth.passwordPrompt.title` | "Confirm it's you" | Delete-account returns `reauth_required` for an email/password account. |
| `settings.reauth.passwordPrompt.body` | "For your security, deleting your account needs a recent sign-in. Enter your password to continue." | |
| `settings.reauth.passwordPrompt.placeholder` | "Password" | |
| `settings.reauth.passwordPrompt.cta.primary` | "Confirm and delete" | |
| `settings.reauth.passwordPrompt.cta.secondary` | "Cancel" | Reuse `shared.cta.cancel` by value. |
| `settings.reauth.googlePrompt.title` | "Confirm it's you" | Delete-account returns `reauth_required` for a Google account. |
| `settings.reauth.googlePrompt.body` | "For your security, deleting your account needs a recent sign-in. You'll be asked to sign in with Google again, then your account will be deleted." | A native `Alert` before the browser sheet opens, matching this screen's own idiom for every other destructive/step-up confirmation. |
| `settings.reauth.googlePrompt.cta.primary` | "Continue with Google" | |
| `settings.reauth.googlePrompt.cta.secondary` | "Cancel" | |
| `settings.reauth.unsupportedProvider.title` | "We can't confirm it's you" | The session's provider has no reauthentication flow built today — said plainly rather than silently doing nothing. |
| `settings.reauth.unsupportedProvider.body` | "Sign out and sign back in, then try deleting your account again." | |
| `settings.reauth.error.title` | "That didn't work" | The reauthentication attempt itself failed (wrong password, cancelled Google flow, network error). |
| `settings.reauth.error.genericBody` | "We couldn't confirm it's you. Check your connection and try again." | |
| `settings.reauth.error.wrongPassword` | "That password doesn't match. Try again." | The reauthentication password was rejected. Added 2026-08-12 because `auth.error.invalidCredentials` can't be reused here: it offers "Continue with Google," true at sign-in but known-false in this sheet (it opens only for a password account and has no Google button), and the email isn't in question — the user is already signed in. `lib/delete-account.ts`'s `mapReauthError` swaps in this one string and reuses `mapAuthError` for every other failure. |
| `settings.reauth.error.stillRequired.title` | "We still couldn't confirm it's you" | Reached only if the retry AFTER a successful reauthentication is also rejected as stale (e.g. clock skew) — distinct from the generic body because the user just did what was asked and it still didn't take. |
| `settings.reauth.error.stillRequired.body` | "That didn't go through in time. Wait a moment, then try deleting your account again." | |

---

## Cross-cutting — Consent (shown once, before the first-ever upload)

**Art. 9-grade consent (Ian's decision, 2026-07-12):** this is a checkbox-gated modal, not a
plain notice — the primary CTA stays disabled until the user actively ticks the checkbox,
and the copy names both Anthropic and the health-data outcome explicitly. This replaces the
earlier plain Continue/Cancel draft.

| Key | String | Shows when |
|---|---|---|
| `consent.upload.title` | "Before you upload" | Shown exactly once, the first time any user (any tier) attempts to submit a photo or video — gates the Source Picker → Capture/Upload handoff. Never shown again after acknowledged. |
| `consent.upload.body` | "Your frames are stored privately until you delete them. We send them to Anthropic, our AI provider, to analyse your form. The analysis produces health-related feedback about you, including injury-risk flags." | Corrected to the frames-only truth (the original video never leaves the device — see the Screen 11 fix note above) and names Anthropic and the health-data outcome explicitly, per the Art. 9-grade consent standard. |
| `consent.upload.checkbox` | "I consent to my images being analysed to produce health-related feedback, and to Anthropic processing them to do so." | NEW key. The affirmative-action element itself — unticked by default, required before the primary CTA enables. This is what makes the consent explicit and unbundled rather than implied by tapping through. |
| `consent.upload.link.privacy` | "Privacy details in Settings" | Points to `settings.privacy.body` for the fuller version. Unchanged. |
| `consent.upload.cta.primary` | "I consent — continue" | Proceeds into the upload/capture flow. **Disabled until `consent.upload.checkbox` is ticked.** |
| `consent.upload.cta.secondary` | "Cancel" | Reuse `shared.cta.cancel`; returns to the source picker without uploading anything. Unchanged. |
| `consent.upload.error.record` | "We couldn't record your consent, so nothing has been uploaded. Check your connection and try again." | NEW key. The consent write to `public.consents` failed. States plainly that nothing was sent — matching `offline.blocked.body`'s "nothing has been sent yet" rule (brief §5: never claim a state that isn't true). The gate stays up and the primary CTA stays available for a retry; the user is never advanced into the upload flow on a failed consent write. |
| `consent.upload.age.checkbox` | "I confirm I'm 16 or older." | NEW key (issue #94), CERTIFIED by Ian 2026-07-13. Shown on the same once-ever screen as `consent.upload.checkbox` above, its own checkbox, both required before the primary CTA enables. `docs/privacy-policy.md` already states a 16+ minimum; nothing had asked or recorded it anywhere in the app before this. |

### Subject attestation (issue #94) — NEW, CERTIFIED by Ian 2026-07-13

The gap the consent block above doesn't cover: `consent.upload.checkbox` is "I consent to **my**
images" by construction, so it says nothing when the uploader is filming someone else — the most
obvious real use of a running-form analyzer built by a running coach. This screen asks who is
actually in the frame, on **every** upload (not once-ever like the block above — the answer is a
property of the specific upload, not the account), and requires a fresh attestation whenever the
answer is "someone else." This is legally load-bearing (the Art. 9 obligation, an explicit
under-16 parent/guardian clause) and has **not** been reviewed by `ux-copywriter` or Ian — mirrored
here verbatim from `constants/copy.ts`, a draft until certified.

| Key | String | Shows when |
|---|---|---|
| `consent.upload.subject.title` | "Who's in this photo or video?" | Second, always-shown consent screen — every upload attempt, no once-ever shortcut. |
| `consent.upload.subject.body` | "Let us know if you're submitting your own running form, or someone else's — like an athlete you coach or a friend." | |
| `consent.upload.subject.option.me` | "This is me" | Records no new consent — self-processing is already covered by the once-ever health-consent block. |
| `consent.upload.subject.option.other` | "Someone else" | Requires the third-party checkbox below before the primary CTA enables. |
| `consent.upload.subject.thirdParty.checkbox` | "I confirm the person in this photo or video has agreed to this analysis — or, if they're under 16, their parent or guardian has agreed on their behalf — and I consent to Anthropic processing their images to produce this feedback." | Shown only when "Someone else" is selected. Recorded as its own, distinct `consent_key` every single time — never inherited from a prior attestation. |
| `consent.upload.subject.cta.primary` | "I confirm — continue" (subject: other) / "Continue" (subject: me) | A templated function, not a plain string (same convention as `capture.recording.timer`). "This is me" reads as plain navigation since no new consent is given; "Someone else" is itself the affirmative attestation act, so the button names that. |
| `consent.upload.subject.cta.secondary` | "Cancel" | Reuse `shared.cta.cancel` by value. |
| `consent.upload.subject.error.record` | "We couldn't record your confirmation, so nothing has been uploaded. Check your connection and try again." | The consent write failed — same "nothing sent yet" honesty rule as `consent.upload.error.record` above. |

## Cross-cutting — Offline

| Key | String | Shows when |
|---|---|---|
| `offline.banner` | "You're offline — capture still works, but upload and analysis need a connection." | Persistent light banner while offline, shown on the Source picker / Capture screens. Capture itself is not blocked; only the network-dependent steps are. |
| `offline.blocked.title` | "You're offline" | User attempts to upload or analyze while offline. |
| `offline.blocked.body` | "This needs an internet connection. Reconnect and try again — nothing has been sent yet." | Explicit "nothing sent yet" — never implies a save/queue that isn't actually implemented (brief §5: "never claim 'saved' when it isn't"). |
| `offline.blocked.cta` | "Retry" | Reuse `shared.cta.retry`. |

## Cross-cutting — Backgrounding recovery

| Key | String | Shows when |
|---|---|---|
| `toast.analysisFinishedInBackground.message` | "Your analysis finished — see Past Analyses." | On next app foreground/launch, when an analysis completed server-side while the app was backgrounded/suspended and the client never received the response (Ruling 12). |
| `toast.analysisFinishedInBackground.action` | "View" | Tap target on the toast — routes straight to the finished result in Past Analyses. |

---

## Ambiguities and calls made

1. **Home CTA when quota is exhausted.** The brief always shows `"Analyze my form"` as the fixed
   Home CTA (§4.2) and doesn't describe a disabled/relabeled state. Per copy rule 3 (label the
   button with the verb of the outcome) I judged that leaving `"Analyze my form"` active when a
   tap will only route to the Paywall is a small honesty gap, so I added three branch states:
   Free-exhausted → `"Upgrade to analyze"`, Pro-exhausted → `"Upgrade for more"` (an upgrade path
   exists), Elite-exhausted → the button stays labelled `"Analyze my form"` but renders **disabled**
   with a caption underneath (no higher tier to route to). Flagging this because it's a UI-state
   decision, not just wording, and `frontend-builder`/`design-system` should confirm the disabled
   treatment reads clearly rather than looking broken.
2. **Uploading/Extracting step order.** The brief's prose (§4.5) describes "upload %, then
   extracting frames" — but the build prompt's Ruling 1 (frames-only pipeline, decided after/
   alongside the brief) has frames extracted **client-side first**, then only those small frames
   uploaded. I followed the ruling as the more current, technically authoritative source and wrote
   `upload.step.extracting` before `upload.step.uploading`. Worth a one-line fix to the brief's §4.5
   prose so the two docs don't keep disagreeing.
3. **"Extra first-analysis line" vs. the consent line.** The task brief for this deck named both
   "the final disclaimer... + the extra first-analysis line (brief §5)" and, separately, the
   consent line. Re-reading `frontend-design-brief.md` §5, there are only two distinct items: the
   **Consent** bullet (shown once, before the first upload) and the **Disclaimer** bullet (shown on
   every result, always). I did not find a third, separate "first-analysis-only" disclaimer variant
   anywhere in the brief or the knowledge files, so I treated "the extra first-analysis line" as
   referring to the Consent bullet and did not invent a fourth string. If a distinct first-analysis
   disclaimer variant was intended, it isn't specified anywhere I could find — flagging rather than
   guessing.
4. **Paywall pricing.** ~~No dollar amount for Pro/Elite exists in any doc~~ **RESOLVED
   2026-07-11: Ian set Pro $6.99 / Elite $14.99 per month** (display prices for the dummy
   paywall; real IAP is post-MVP and can re-decide). The strings above carry the figures.
   Note the "/ month" here is the *price cadence*, which is fine — quota copy still never says
   "this month" because quota periods are purchase-day-anchored.
5. **Sign-out confirmation.** The brief doesn't specify whether Sign out needs a confirm step. I
   added a lightweight one (`settings.signOut.confirm.*`) since it's a common mobile pattern for an
   account-level action, but it's not load-bearing — `frontend-builder` can skip straight to
   `settings.signOut.cta` firing the sign-out directly if a confirm step is judged unnecessary.
6. **Consent/privacy copy corrected + redesigned to Art. 9 standard (2026-07-12).** Two real
   defects, found by a privacy-compliance review, are fixed in place: `consent.upload.body`
   previously said "Your photo or video is stored privately until you delete it" — false, since
   per Ruling 1 / `architecture.md` the original video never leaves the device, only extracted
   frames are stored; and `settings.privacy.body` contradicted itself in a single string
   (opened "Photos and videos you submit are stored in a private location," closed "We never
   store your original video"). Both are now frames-only and internally consistent. Separately,
   Ian decided the consent screen must meet a real GDPR Art. 9 standard: a checkbox the user
   must actively tick (`consent.upload.checkbox`, new key) gates the primary CTA
   (`consent.upload.cta.primary`, now "I consent — continue"), and the body names Anthropic and
   the health-data outcome by name instead of "our AI provider." This also resolves the privacy
   checklist's SHOULD item about naming Anthropic in the consent copy itself.
