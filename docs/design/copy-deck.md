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
> **Pace AnalysisAI** — that casing, everywhere it appears as a string (not "PACE AnalysisAI").
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
| `auth.signIn.submit` | "Sign in" | |
| `auth.signUp.submit` | "Create account" | |
| `auth.signUp.link` | "New here? Create an account" | Text link on the sign-in screen, not a second button (brief §4.1). |
| `auth.signIn.link` | "Already have an account? Sign in" | Text link on the sign-up screen. |
| `auth.error.invalidCredentials` | "Email or password doesn't match. Try again or reset your password." | Sign-in fails on bad credentials. |
| `auth.error.emailInUse` | "An account already exists with this email. Sign in instead." | Sign-up with a taken email. |
| `auth.error.generic` | "Sign-in didn't go through. Try again." | Any other auth failure — provisional until Phase 1 wires real Supabase error codes; replace with a specific string per code where one exists rather than falling back to this by default. |
| `auth.error.passwordBreached` | "That password has shown up in a data breach before. Pick a different one to keep your account secure." | Sign-up: the submitted password matches a known-breached password (client-side HaveIBeenPwned range-API check, issue #70 — Supabase's server-side version is Pro-plan-gated). Blocks account creation; no jargon ("pwned," "hash," "HaveIBeenPwned") and no blaming the user — reused passwords are common, the copy just asks for a different one. |
| `auth.error.passwordTooShort` | "Password must be at least 8 characters." | Sign-up: Supabase rejects the password on length. Previously fell through to the generic error, telling the user nothing they could act on. |

---

## Screen 2 — Home / Analyze

| Key | String | Shows when |
|---|---|---|
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
| `sourcePicker.permission.library.title` | "Pace AnalysisAI needs your photo library" | Soft-ask shown before the OS prompt, first time Upload is tapped. |
| `sourcePicker.permission.library.body` | "To choose a running photo or video already saved on your phone. We only access what you pick." | |
| `sourcePicker.permission.library.cta` | "Allow library access" | Triggers the OS permission prompt. |
| `sourcePicker.permission.library.denied.title` | "Photo library access is off" | User previously denied or later revoked the permission. |
| `sourcePicker.permission.library.denied.body` | "Turn on photo library access in Settings to upload a clip." | |
| `sourcePicker.permission.library.denied.cta` | "Open Settings" | Reuse `shared.cta.openSettings`; deep-links to the app's OS Settings page. |
| `sourcePicker.permission.library.denied.secondary` | "Record instead" | Offers the other path so the user isn't stuck — routes to Capture. |

---

## Screen 4 — Capture

| Key | String | Shows when |
|---|---|---|
| `capture.title` | "Record your run" | Screen header. |
| `capture.overlay.tip` | "Stand side-on, full body in frame, about 10 metres back. Level the camera and shoot in good light." | Overlaid on the camera preview alongside the faint full-body figure outline, per brief §4.4. |
| `capture.overlay.muted` | "Recording is muted — no audio, no microphone." | Shown once near the record button; states the privacy feature plainly rather than leaving a silent recording unexplained. |
| `capture.recording.autoCap` | "Clips stop automatically at 15 seconds." | Shown before/while recording. |
| `capture.recording.timer` | "{elapsed}s / 15s" | Live counter while recording. |
| `capture.permission.camera.title` | "Pace AnalysisAI needs your camera" | Soft-ask before the OS prompt, first time Record is tapped. |
| `capture.permission.camera.body` | "To record your running form. Recording is muted — we never access your microphone." | States what the permission is for, per Apple review + the rule that a permission prompt must say what the app does with it. |
| `capture.permission.camera.cta` | "Allow camera access" | Triggers the OS permission prompt. |
| `capture.permission.camera.denied.title` | "Camera access is off" | User previously denied or later revoked the permission. |
| `capture.permission.camera.denied.body` | "Turn on camera access in Settings to record your form. Recording is muted — we never access your microphone." | |
| `capture.permission.camera.denied.cta` | "Open Settings" | Reuse `shared.cta.openSettings`. |
| `capture.permission.camera.denied.secondary` | "Upload from library instead" | Offers the other path so the user isn't stuck — routes back to the Upload card. |

### iOS `Info.plist` strings (for Phase 1 — paste into `app.json`, either via `ios.infoPlist` directly or the `expo-camera` / `expo-image-picker` config-plugin permission props)

| Key | String | Info.plist key |
|---|---|---|
| `infoPlist.cameraUsage` | "Used to record a video or photo of your running form for analysis. Recording is muted — Pace AnalysisAI never accesses your microphone." | `NSCameraUsageDescription` |
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

| Key | String | Shows when |
|---|---|---|
| `upload.title` | "Preparing your analysis" | Screen header, covers both steps. |
| `upload.step.extracting` | "Extracting frames {current} / {total}" | Local frame extraction, `frames.ts` running — no network yet. |
| `upload.step.uploading` | "Uploading {percent}%" | Extracted frames uploading direct-to-bucket. |
| `upload.error.title` | "Upload didn't go through" | Frame upload fails. |
| `upload.error.body` | "We couldn't upload your frames — check your connection and try again." | |
| `upload.error.cta.retry` | "Retry" | Reuse `shared.cta.retry`. |
| `upload.error.cta.cancel` | "Cancel" | Reuse `shared.cta.cancel`; returns to the source picker. |
| `upload.offline.title` | "You're offline" | Connectivity drops mid-upload. |
| `upload.offline.body` | "Uploading needs a connection. Reconnect and try again — nothing has been saved yet." | Explicit "nothing saved yet" honors the "never claim saved when it isn't" rule (brief §5). |
| `upload.offline.cta` | "Retry" | Reuse `shared.cta.retry`. |

---

## Screen 6 — Analyzing

| Key | String | Shows when |
|---|---|---|
| `analyzing.title` | "Analyzing" | Screen header. |
| `analyzing.step.reading` | "Reading your form…" | Early client-side step list, per brief §4.6. |
| `analyzing.step.scoring` | "Scoring the four pillars…" | |
| `analyzing.longWait` | "Still analyzing — a full read takes a moment." | Calm static line after the honesty threshold (no fake progress bar, no spinner-forever). |
| `analyzing.error.failed.title` | "Your analysis didn't go through" | Model response failed structural validation twice (retry-once, then fail). |
| `analyzing.error.failed.body` | "The analysis service didn't return a usable result. This one wasn't counted against your quota — try again." | Explicitly says quota wasn't burned, per the task's requirement. |
| `analyzing.error.timeout.title` | "Analysis timed out" | The vision call exceeds the wait threshold with no response. |
| `analyzing.error.timeout.body` | "The read took too long to finish. This one wasn't counted against your quota — try again." | |
| `analyzing.error.cta.retry` | "Retry" | Reuse `shared.cta.retry`. |
| `analyzing.error.cta.cancel` | "Cancel" | Reuse `shared.cta.cancel`; returns to Home. Retry/Cancel must never trap the user — every error state needs an exit. |

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
| `history.title` | "Past Analyses" | Tab header. |
| `history.loading` | "Loading your analyses…" | List fetch in flight. |
| `history.empty.title` | "No analyses yet" | No history. |
| `history.empty.body` | "Your analyses will live here." | Per brief §4.8, verbatim. |
| `history.empty.cta` | "Analyze my form" | The one action that fills the empty state (rule 4) — routes into the capture flow. |
| `history.item.a11yLabel` | "Analysis from {date}, overall {score} out of 100, {band}." | VoiceOver label for each list row. |
| `history.delete.confirm.title` | "Delete this analysis?" | Swipe/long-press → delete. |
| `history.delete.confirm.body` | "This removes the result and its saved frames. This can't be undone." | States both halves of the purge (row + frames), matching Ruling 6. |
| `history.delete.confirm.cta.primary` | "Delete analysis" | Names the destruction (rule 3), not "OK." |
| `history.delete.confirm.cta.secondary` | "Cancel" | Reuse `shared.cta.cancel`. |
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
