# Change Log

Running history of behavior-changing work, newest first. Each entry is a dated `## YYYY-MM-DD`
heading followed by a bulleted list of what changed (and why, where it's not obvious). When you
make a behavior-changing commit, add a bullet under today's date — create a new heading at the
**top** of the file if there isn't one yet for today. Don't rewrite or delete past entries.

## 2026-08-07 (comprehensive audit: temporary unlimited Elite access + correctness fixes)

- Added the strict, server-only `ALL_USERS_UNLIMITED_ACCESS` override for the captain's complete
  test pass. When enabled, additive service-role wrapper RPCs make every authenticated account run
  the real Elite analysis path with the Elite 8-frame cap and unlimited analysis-count quota;
  disabling the flag immediately restores the original hardened entitlement/quota RPCs. Purchase
  flows, immutable analysis history, soft-delete exploit protection, auth, consent, request limits,
  idempotency/locking, and AI spend guardrails are unchanged.
- Extended the quota-status contract with explicit `unlimited: true` plus null `limit`/`remaining`,
  and wired Home, video extraction, Paywall, and Settings to represent that state without a fake
  numeric ceiling. Settings now reads the same server-authoritative endpoint as the other plan UI
  instead of querying subscriptions directly and disagreeing with temporary server entitlements.
- Wired the already-built Compare feature into normal navigation: History now shows “Compare two
  analyses” when at least two stored results exist. Compare keeps its own fresh server-side Elite
  entitlement check rather than trusting the entry point.
- Fixed Paywall offering an Elite user an active “Upgrade to Pro” downgrade. The lower-tier CTA is
  now absent for Elite while the actual purchase/subscription flow remains unchanged.
- Added regression coverage for flag parsing, edge-flow RPC selection, unlimited quota parsing/UI,
  and migration security/invariants. The full Jest gate now runs in-band: several unrelated RNTL
  suites exceeded their 5-second test timeout only under full parallel worker contention, while
  passing in isolation, so deterministic serial execution replaces host-load false failures. Full
  audit receipt: `docs/audit-v2.3-comprehensive-2026-08-07.md`.

## 2026-08-08 (sign-in: scroll-reveal restructuring with LowPolyField zoom)

- **Restructured `app/(auth)/sign-in.tsx` into a scroll-based reveal**, now that
  `components/low-poly-field.tsx`'s shared animation bug is fixed (see the entry above). The mark
  no longer sits absolutely-positioned behind the wordmark at `Opacity.disabled` as translucent
  atmosphere (the old `headerMarkBox`/`headerMark` styles and `SPLASH_MARK_SIZE` constant are
  gone); it gets its own full-opacity section (`MARK_SIZE` 220, up from the old 160) revealed by a
  "cool zoom" (0.62 → 1 scale, 0 → 1 opacity) as the user scrolls to it. The transition runs on
  `Motion.curve.calm` (`constants/theme.ts`'s hero-reveal curve) via `Animated.ScrollView` +
  `useScrollViewOffset`, interpolated against the mark section's own measured `onLayout` offset
  rather than a guessed pixel constant. `LowPolyField` is mounted unconditionally throughout —
  only the wrapping `Animated.View`'s opacity/scale respond to scroll — so its internal
  shatter/gait loop is never restarted or gated. `useReducedMotion()` renders every section
  statically (no scroll-gated transform); no section is ever gated behind scroll for any user, so
  every control stays reachable. New `testID="sign-in-mark"` plus regression coverage in
  `app/(auth)/__tests__/sign-in.test.tsx` and `sign-in-no-captcha-key.test.tsx` locks all controls
  mounted and reachable on first render, normal and reduced-motion, without simulating a scroll
  event. Auth logic, validation, and the email/password form's behavior are unchanged. Verified via
  full typecheck/lint/test and a static web export render of `/sign-in`; a manual simulator pass
  (scroll feel, animation persistence, end-to-end sign-in) is still needed before merge — no booted
  simulator or browser-automation tool was available in this environment.

## 2026-08-08 (Home tab cleanup: logo removed, type-scale drift fixed)

- **Removed the `LowPolyField` mark from the Home tab's top bar entirely** (`app/(tabs)/index.tsx`,
  `testID="home-mark"`) — it never got restyled when the rest of the redesign landed on
  `app/result/[id].tsx` (see the memory note on Phase 1's scope), and the captain called its
  presence there clutter. The wordmark `Eyebrow` and the settings `CircleIconButton` already sat on
  a `flex`/`space-between` row, so removing the mark reflows the row naturally with no dead gap and
  no compensating style needed.
- **Removed a duplicate "Home" `Eyebrow` label that only appeared in the quota card's `ready` state**
  — the loading and error states of the same card never rendered it, so the card's height/hierarchy
  shifted depending on quota status, and the text duplicated the wordmark one scroll-length above it.
- **Fixed a type-scale drift**: `pendingReleasedTitle` used `FontSize.md` even though its own
  comment claims parity with `components/partial-result-banner.tsx`'s "same neutral-surface
  treatment" — that component's title is actually `FontSize.lg`. Home's banner title now matches.
  Every other repeated text role on this screen (`quotaCaption`, `quotaStaleCaption`, the two
  `Eyebrow` labels, the ticker) was already internally consistent, and `heroLine`'s
  `FontSize.xxl` + `LineHeight.display` pairing already matches the app-wide "large headline"
  convention used in `capture/extracting.tsx`, `reset-password.tsx`, `update-password.tsx`,
  `paywall.tsx`, and `compare.tsx` — left unchanged.

## 2026-08-08 (result screens: pillar-row cleanup + per-pillar detail modal)

- **Cleanup pass on `<PaceReadout>`'s pillar rows** (shared by `app/result/[id].tsx` and
  `app/result/sample.tsx`, so both screens got the same treatment automatically). The flags
  (injury-risk) and drills (corrective exercise) sub-lists used to render back-to-back with
  byte-identical styling and no label distinguishing the two — fixed with `<Eyebrow>` micro-labels
  ("Watch for" / "Try this", new `Copy.result.pillar.flagsLabel`/`drillsLabel` keys) above each,
  plus a thin `colors.hairline` divider between the coaching feedback and that block (only when the
  block is non-empty, so it never leads to nothing). Removed a redundant `marginTop` on `subList`
  now that `pillarRow`'s own `gap` plus the new divider already establish the rhythm. Every value
  used is an existing token from `constants/theme.ts` — no new colors/spacing/type sizes.
- **New feature: per-pillar detail.** Each pillar row now has a small info-icon `<CircleIconButton>`
  (`accessibilityLabel` via new `pillarDetailA11yLabel` helper in `lib/pace-readout.ts`) that opens
  `components/pillar-detail-modal.tsx` — a full-screen `Modal` reusing `app/settings.tsx`'s
  step-up-reauth modal pattern (the only precedent in this codebase), showing that pillar's
  score/band or its honest not-assessed reason, full coaching feedback, and the same labeled
  flags/drills lists. Renders exactly the `PacePillarResult` fields already in the contract —
  nothing fabricated. Dismissible via a labeled close button and `onRequestClose` (Android back);
  unlike the row's own not-assessed text, nothing in the modal is hidden from the accessibility
  tree, since the modal has no duplicate spoken announcement standing in for it.
- New tests: `components/__tests__/pillar-detail-modal.test.tsx`, plus additions to
  `components/__tests__/pace-readout.test.tsx` and `lib/__tests__/pace-readout.test.ts`.

## 2026-08-08 (in-app recording measured its own clip wrong; the "single frame" report is the free tier's cap)

- **Investigated a report that the record path (`app/capture/record.tsx` → `app/capture/extracting.tsx`)
  extracts only one frame per video, and found that symptom is the FREE TIER WORKING AS SPECIFIED,
  not a defect.** `planning/02-product-requirements.md`'s tier table gives Free "1 frame (photo, or
  one frame from video)", `PACE_FRAME_CAP.free` is 1, and the live project's `pace_quota_status`
  returns `{"tier":"free","frame_cap":1}` for the reporting account — `public.subscriptions` has
  zero rows, so every account there resolves to Free. Verified the client chain is intact and
  carries whatever count the server hands it: driving the real `extracting.tsx` +
  `lib/extraction-frame-cap.ts` + `lib/frames.ts` against an Elite quota response produced 8
  distinct thumbnails at 8 distinct requested times and staged all 8 frames and 8 timestamps for
  `analyze-form`. Not a loop that runs once, not an early return, not a race. **Raising Free's video
  frame cap is a product/pricing decision and is deliberately NOT made here.**
- **Fixed the real, record-path-only defect the reproduction surfaced: the screen reported a
  wall-clock span as the recorded clip's duration.** `recordAsync` reports no duration, so the
  screen measures the clip itself — but it stamped `Date.now()` on the record tap and again at the
  moment `recordAsync`'s promise RESOLVED. That promise settles after the movie file is finalized,
  which is not part of the clip, so the reported duration always overshot. Two consequences, both
  live since the screen was written (issue #36, 2026-07-12 — `handleRecordPress` was byte-identical
  until now, so this never worked rather than regressed):
  - **A full-length recording was always rejected.** `recordAsync` is given
    `maxDuration: MAX_CLIP_DURATION_MS / 1000`, so the camera hard-stops at exactly 15.000s of
    media; the span around it is strictly greater than 15000ms, and `extracting.tsx`'s pre-flight
    `checkMediaCaps` rejects `durationMs > 15000` as `clipTooLong`. The app refused the longest
    clips its own recorder produced — the ones with the most motion to analyze.
  - **Frames were sampled past the end of the clip.** `lib/frames.ts`'s `sampleTimestamps` spreads
    samples across the 5%–95% window of whatever duration it is handed, so an inflated duration
    pushed the late samples at or beyond the real last frame. iOS's `AVAssetImageGenerator` leaves
    `requestedTimeToleranceBefore` at `.positiveInfinity` for a time past the asset's duration
    (`expo-video-thumbnails`' `VideoThumbnailsModule.swift`), so those came back as the SAME final
    still — duplicate frames where the analysis was supposed to see motion.
- **The fix**: new `lib/recorded-clip-duration.ts` (`measureRecordedClipDurationMs`) clamps the
  measurement to the recorder's own `maxDuration` guarantee, and `record.tsx` now stamps the stop
  time where it calls `stopRecording()` rather than where the promise resolves. Stated honestly in
  both files: this closes the tail (finalization) error and the `clipTooLong` false rejection, but
  NOT the head (camera start-up) error — no expo-camera SDK 54 API reports when recording actually
  began, and no installed module can read a duration off the finished file. Do not paper over the
  remainder with a guessed constant.
- **Tests**: new `lib/__tests__/recorded-clip-duration.test.ts` (clamp, the `clipTooLong` case it
  prevents, and the `0` guards that keep a bad stamp out of `sampleTimestamps`' `RangeError`), new
  `app/capture/__tests__/record.test.tsx` (screen-level — proves which `durationMs` the screen
  actually pushes; verified red on the pre-fix code at `Expected: 15000, Received: 15400`), and two
  additions to `app/capture/__tests__/extracting.test.tsx`: a full-length clip must reach extraction
  rather than error, and every extracted frame + timestamp must survive the handoff to
  `/analyzing` (that mailbox seam had no coverage, and a truncation there would look exactly like
  the extraction bug it isn't).

## 2026-08-08 (`LowPolyField`'s morph was silently frozen on every screen it renders on)

- **Fixed `components/low-poly-field.tsx`'s per-vertex morph animation, dead since the #169
  redesign.** Root cause: `MorphingFacet` animated a `<Polygon points=...>` via
  `useAnimatedProps`/`Animated.createAnimatedComponent`. `react-native-svg`'s `Polygon` only
  turns `points` into the `d` its native view draws inside `Polygon`'s own JS
  `render()`/`setNativeProps` override — but under Fabric (`newArchEnabled: true`), Reanimated's
  `animatedProps` commits straight to the native host view on the UI thread, bypassing both, so
  the animated `points` prop was silently inert: the shared value advanced every frame, nothing
  ever repainted, and the mark stayed frozen at `DEFAULT_POSE`. Reproduced live on an iOS
  simulator with Reduce Motion confirmed off (ruling that gate out), then confirmed via a
  `useAnimatedReaction` probe that the driver was in fact advancing while screenshots showed no
  visual change. Fixed by animating a `<Path d=...>` instead — `d` is a real, untranslated native
  prop — while leaving the reduced-motion static-render branch on `Polygon` untouched, since it
  has no animated props. One shared-component fix; not patched per-screen. Affects every screen
  that renders `LowPolyField`: `app/(auth)/sign-in.tsx`, `app/(tabs)/index.tsx`,
  `app/analyzing.tsx`, `app/capture/extracting.tsx`. Regression-locked in
  `components/__tests__/low-poly-field.test.tsx` (asserts the animating facets are built on
  `Path`, never `Polygon`, using `react-test-renderer`'s `findAllByType` since RNTL's `render`
  collapses both to the same host SVG node).

## 2026-08-07 (`expo-network` ruled out as cruft; netinfo locked in as the single connectivity source)

- **Investigated an uncommitted, unexplained `expo-network` install and concluded it is leftover
  cruft, not an abandoned partial fix.** It was `npm install`ed into a working copy of this app and
  never committed; `npm ls` reports it `extraneous`, and it has **zero references** in `app/`,
  `lib/`, `components/`, `hooks/`, `constants/`, `supabase/`, `.maestro/` or `docs/`. Nothing in
  the repo — no commit, no changelog entry, no issue — has ever mentioned it.
- **No code adopts it, because there is nothing left for it to do.** Connectivity detection landed
  in full on 2026-07-13 (issue #93, commit `997070c`) on `@react-native-community/netinfo`:
  `lib/connectivity.ts` exports the live `useIsOffline()` behind the global
  `components/offline-banner.tsx` and the one-shot `checkConnectivity()` pre-flight gate, which
  **is** wired at its intended call site (`app/analyzing.tsx:183`, ahead of
  `analyzeFormClient.submit()`). `expo-network` overlaps that rather than extending it.
- **Ruled out the `TypeError: Network request failed` bug class a sibling app (workout-v2.2) hit
  over Expo tunnel mode on a physical device — this app has no foothold for it.** The client reads
  a hosted `https://` Supabase URL from `EXPO_PUBLIC_SUPABASE_URL`, and there is no `http://` and
  no `localhost`/`127.0.0.1` anywhere in app source; tunnel mode tunnels Metro's *bundler*, not the
  app's own `fetch` calls, so device→Supabase reachability never depends on it. `eas.json`'s
  `development-local`/`preview-local` profiles do pin `http://127.0.0.1:54321`, but both declare
  `ios.simulator: true`, where sharing the Mac host's loopback is the documented point (issue #84).
  `lib/functions-client.ts` already folds the `FunctionsFetchError` that surfaces as "Network
  request failed" into `kind: 'network'`, distinct from a server-authored `{ error, code }`.
- **Added a dependency-manifest regression lock** (`lib/__tests__/connectivity.test.ts`, new
  `connectivity dependency contract` block) asserting that `@react-native-community/netinfo` is
  declared and that no competing connectivity library (`expo-network`, `react-native-offline`,
  `react-native-network-info`, netinfo's pre-rename `@react-native-community/net-info`) is declared
  beside it. Verified it actually fails — adding `expo-network` to `package.json` reproduces the
  captain's exact local state and the test fails naming the package. This is the enforcement that
  makes the finding stick: two independent connectivity sources classify NetInfo's indeterminate
  "connected, reachability still probing" state differently, so the banner and the pre-flight gate
  could disagree about whether the device is online — the "never claim a state that isn't true"
  failure issue #93 exists to prevent.
- **No dependency was removed in this commit because none was ever committed.** The `expo-network`
  entry lives only in the captain's uncommitted `package.json`/`package-lock.json`; clearing it on
  that machine is `npm uninstall expo-network` (or reverting those two files), after which this
  repo already forbids it coming back silently.
- Follow-up noted, deliberately NOT changed here: `mapAuthError` (`lib/auth-errors.ts`) has no
  network branch, so a genuine offline failure during sign-in surfaces as the generic
  `Copy.auth.error.generic` rather than the certified `Copy.offline.blocked.*` strings. Real, but
  it is a copy-deck decision, not part of this investigation.

## 2026-08-07 (sign-in wordmark mid-word wrap fixed — `components/kinetic-text.tsx`)

- **Fixed a real-device bug**: the animated sign-in wordmark ("Pace Analysis AI") wrapped
  mid-word — "Analysis" rendered as "Analysi" on one line and a lone "s" on the next. Root cause:
  `KineticText` splits copy into one word per `Animated.Text` flex item in a `flexWrap` row; at
  `FontSize.display` (64pt) a single long word's flex item can measure wider than the row (narrow
  device or Dynamic Type scaled up), and Yoga constrains it to the remaining width rather than
  letting it overflow, so native `Text` line-breaks it internally by character. The component's own
  doc comment claimed this was "guarded anyway by the parent's Dynamic Type reflow" — that reflow
  doesn't exist; the comment was wrong and has been corrected in place.
- Fix: every word in `KineticText`'s `Word` component now carries `numberOfLines={1}` +
  `adjustsFontSizeToFit` + `minimumFontScale={0.6}` — the same Dynamic Type guard
  `pace-readout.tsx`'s overall-score numeral already uses — so an over-wide word shrinks to fit its
  line instead of breaking or clipping. Fix lives in the shared component, so it applies to every
  `KineticText` caller (`analyzing.tsx`, `paywall.tsx`, `settings.tsx`, `compare.tsx`,
  `capture/record.tsx`, `(tabs)/history.tsx`, `(tabs)/index.tsx`, `reset-password.tsx`,
  `update-password.tsx`), not just sign-in.
- New regression test in `components/__tests__/kinetic-text.test.tsx` locks in the shrink-to-fit
  props on the sign-in wordmark's words. Verified live on an iPhone 17 Pro simulator: "Pace" /
  "Analysis AI" renders on two lines with no mid-word break.
- The animation itself (opacity/`translateY` via `useAnimatedStyle`) was not touched by this fix.
  A captain report that the reveal "looked like a still image" when the wrap bug was visible could
  not be conclusively reproduced or ruled out live — screen-recording the ~700ms per-word stagger
  during a cold dev-client launch was unreliable in this environment (CPU contention from
  bundling/the native dev-menu overlay meant capture frequently skipped straight from
  pre-mount to fully-settled with no intermediate frame, even at native ~50-100fps). Metro logs
  showed no runtime errors from the added props. Flagging for a live check by an agent/human with
  a warm (non-cold) launch and unobstructed capture, rather than asserting it's fine from here.

## 2026-08-06 (`purchase-tier` dummy flag turned OFF, not allowlisted — decision `purchase-tier-dummy-flag-now`)

- **No app code changed — a production secret change plus docs.** Captain decision
  `purchase-tier-dummy-flag-now`: unset `PURCHASE_TIER_DUMMY_ENABLED` entirely rather than maintain
  the `PURCHASE_TIER_ALLOWED_USER_IDS` allowlist adopted 2026-08-05 — the captain is the only
  tester right now, so the self-grant-tier dummy-purchase mechanism isn't needed, closing the abuse
  path `data/v23-launch-audit-r1/report.md` measured live (a throwaway account could self-grant
  Elite for $0 via `POST /functions/v1/purchase-tier {"tier":"elite","source":"dummy"}`).
- Ran `supabase secrets unset PURCHASE_TIER_DUMMY_ENABLED --project-ref vputdomdlknvthnzritt` and
  `supabase secrets unset PURCHASE_TIER_ALLOWED_USER_IDS --project-ref vputdomdlknvthnzritt`
  against the live `v2.3Analysis` project — no redeploy needed, `purchase-tier/index.ts` reads
  `Deno.env.get('PURCHASE_TIER_DUMMY_ENABLED') === 'true'`, so unset (or any non-`"true"` value)
  already disables the gate; unsetting (not `"false"`) matches the code's actual check and drops
  the now-pointless allowlist secret too.
- **Verified live, the same way the original audit verified the vulnerability**: signed up a fresh
  throwaway account and got `404 {"error":"Not found.","code":"not_found"}` from
  `POST /functions/v1/purchase-tier {"tier":"elite","source":"dummy"}`; `quota-status` afterward
  showed `tier: free, limit: 1, frameCap: 1` — no tier granted. `supabase secrets list` confirms
  both variable names are absent from the live secret set.
- Updated `docs/status.md` Known Issue #21 (RESOLVED, replacing the 2026-08-05 allowlist state) and
  `docs/blocked-on-apple.md` item 7 (RESOLVED, no longer a pre-submission blocker); updated
  `docs/architecture.md`'s three `purchase-tier`-live-state references to match.

## 2026-08-06 (sweep-orphaned-media scheduled daily — issue #137, decision `orphan-sweep-scheduling-mechanism`)

- **Scheduled the existing, already-tested `sweep-orphaned-media` edge function** on a recurring
  daily `pg_cron` job (`sweep-orphaned-media-daily`, `0 9 * * *` UTC) against the live project, via
  `supabase/migrations/20260806090000_sweep_orphaned_media_cron.sql`. Chose `pg_cron`+`pg_net`+
  Supabase Vault over a Dashboard Cron Job because this environment has no interactive Studio UI
  login but does have direct SQL/CLI access (functionally equivalent to what the Dashboard's own
  Cron Jobs integration does under the hood). The `X-Cron-Secret` value is provisioned in Vault via
  `vault.create_secret` and read by name only (`vault.decrypted_secrets`) inside the migration's SQL
  body — never inlined as a literal in any committed file. See `docs/architecture.md`'s "Current —
  orphan-purge action, scheduled daily" and `docs/status.md` Known Issue #32.
- **Fixed a real production blocker found along the way:** the function was live with
  `verify_jwt: true`, which would have 401'd every cron call at the platform gateway before its own
  `X-Cron-Secret` check ever ran. Redeployed with `--no-verify-jwt` and pinned that setting in
  `supabase/config.toml`'s `[functions.sweep-orphaned-media]` so a future plain deploy can't regress
  it.
- **Still dry-run only, deliberately.** The scheduled request body is `{}`, which `parseSweepRequest`
  defaults to `dryRun: true` — flipping to live deletion of user media (`{"dryRun": false}`) is a
  separate decision reserved for a human, not made here.
- **Verified live end-to-end:** `cron.job` shows the active schedule (`jobid` 2), and a manual
  `net.http_post` using the same statement the schedule runs returned `200` with a dry-run report
  (`candidateCount: 0`).

## 2026-08-06 (Google auth white-screen — real dev build produced, decision `google-auth-fix-path` option A)

- **No code changed.** Built and ran the first real Expo development build (`eas build --profile
  development --platform ios`, build `c424ce3d-0014-4b8a-a62b-f80b8a6240c4`) to retire the Expo Go
  LAN-IP redirect that causes issue #69's white screen. `eas.json`'s `development` profile needed
  no changes — `developmentClient: true` / `ios.simulator: true` / `environment: development` was
  already correctly shaped, and the EAS `development` environment already carries the right
  `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (verified via `eas env:list`).
  Build succeeded, installed and launched cleanly on an iOS 17 Pro simulator via `eas build:run` —
  no crash, no white screen at the dev-client launcher.
- **Verified live, server-side, before assuming anything from `config.toml`:** queried the hosted
  project's real auth config (Management API) and confirmed `uri_allow_list` already contains
  `paceanalysisai://oauth-callback` and `paceanalysisai://**`, and Google is enabled with a real
  `client_id`/`secret` on file. No allowlist change was made — nothing needed adding, and
  `exp://**` was deliberately left in place (see the reason below).
- **Did not confirm the actual OAuth tap-through.** Could not simulate a tap/click on this
  machine's iOS Simulator from this session — GUI-scripting attempts failed on missing Accessibility
  permission, and a full-desktop screenshot taken while debugging surfaced unrelated windows/content
  outside this task's scope, so that debugging path was stopped rather than pursued further. Auth
  logs show no new sign-in attempts in this window, consistent with "not attempted" rather than
  "attempted and failed." See `docs/status.md` Known Issue #7's 2026-08-06 update for the full
  detail and what's still needed before `exp://**` can be dropped (issue #69's actual remaining
  action).

## 2026-08-05 (Launch-audit fix batch r1 — #171 shipped to production; honest sign-up failure state)

- **Shipped PR #171 to production, migration first** (v23-launch-audit-r1 §5.1, report bug B2).
  `main` had been three commits ahead of the live project since 2026-07-26: the migration
  `20260804120000_pace_current_tier_function.sql` was merged but never applied, and `analyze-form`
  was last deployed *before* the fix. The live consequence was concrete and expensive — every Free
  signup burned a real paid Anthropic call on the user's own photo (the audit measured $0.1023),
  spent their one lifetime slot, and then the shipped copy told them they had only seen a sample.
  Order was forced and observed: `supabase db push` (migration ledger 24 → 25, latest version now
  `20260804120000`), verify `public.pace_current_tier` exists, *then*
  `supabase functions deploy analyze-form` (v7 → v8). Deploying in the other order would have 500'd
  every request, since `currentTier` deliberately throws rather than defaulting to free.
  **Verified live after deploy, not assumed:** a fresh Free account posting one frame got back
  exactly `{result, isSample: true}` — keys `['isSample','result']`, **no `analysisId`** — with
  `quota-status` still reading `used: 0, remaining: 1` afterwards, and **zero** new `ai_call_log`
  rows (count held at 9), zero new `analyses` rows, zero new storage objects. That is the $0 the
  #171 design promised, and it makes `constants/copy.ts`'s "you've viewed the sample" wording true
  for the first time. Throwaway test accounts were deleted and the project verified back to its
  pre-test baseline (2 users / 3 analyses / 3 media objects / 9 AI calls).
  Also confirmed while testing: `public.consents` grants `authenticated` a **column-level** INSERT
  on `(consent_key, granted)` only (`20260712030617_consents_grant_hardening.sql`), so a write that
  names `user_id` explicitly is denied — `lib/consent.ts` is already correct in omitting it. Noted
  because the denial surfaces as a table-level "permission denied for table consents" and reads
  like a broken policy when it is a working one.
- **The sign-up button now says why it's disabled instead of dead-ending silently**
  (v23-launch-audit-r1 §3.1/§5.2, report bug B1). `app/(auth)/sign-in.tsx` rendered the Turnstile
  widget only when `EXPO_PUBLIC_TURNSTILE_SITE_KEY` was set; with the key unset it rendered
  *nothing*, so no token could ever arrive and "Create account" stayed permanently greyed out with
  no explanation. The audit reproduced this against a real build and found the key empty in every
  environment it could read, including the dev client built the same day. The missing-key branch
  now renders an explicit `<SurfaceCard>` notice (`Copy.auth.signUp.unavailable`) in the widget's
  place. **This does not make sign-up work** — only a real site key can, since
  `supabase/functions/signup-with-captcha` verifies the token server-side — and the button
  correctly stays disabled; what changed is that the failure is now visible and explained, the same
  degrade-honestly contract `paywall.purchase.error.unavailable` already follows. The copy avoids
  "something went wrong" (nothing did), never names the env var, and points the reader at the one
  action still open to them (sign in, if they already have an account). A screen-reader user gets
  the same fact via `accessibilityHint` on the disabled button, since they cannot infer the link
  from proximity to the card. Locked by `app/(auth)/__tests__/sign-in-no-captcha-key.test.tsx` — a
  separate file because `TURNSTILE_SITE_KEY` is captured at module-evaluation time and
  `jest.resetModules()` + re-`require` hands the screen a second React instance, breaking every
  hook; Jest's per-file module registry is what actually isolates the two cases. Verified the new
  tests fail against the pre-fix screen before landing them.
- **Closed the `$0` Elite self-grant by narrowing it to an allowlist** (§5.3; captain's decision
  was "narrow, not shut off", reversing the 2026-07-26 call recorded in Known Issue #21).
  `PURCHASE_TIER_DUMMY_ENABLED` stays `true` so tier testing keeps working, but
  `PURCHASE_TIER_ALLOWED_USER_IDS` — previously **unset**, which is why `checkDeploymentGate`
  was allowing *every* authenticated caller — is now set to the captain's own two account uids,
  comma-separated. **Pure secret config, zero code change:** `purchase-tier/index.ts` already read
  both vars and already collapsed "flag off" and "not on the allowlist" into the same
  indistinguishable `404`, precisely so this lever could be pulled without a deploy.
  Verified live: a freshly created third account got `404 not_found` from
  `POST /functions/v1/purchase-tier {"tier":"elite","source":"dummy"}` and stayed on
  `tier: free, limit: 1, frameCap: 1` — the audit had recorded `200` and `limit: 30, frameCap: 8`
  for that identical sequence hours earlier. Took effect with no redeploy. The stored value was
  confirmed exactly without printing it: `supabase secrets list` returns a SHA256 per value, and
  both secrets matched their expected digests. Throwaway account deleted; project back to baseline
  (2 users / 3 analyses / 9 AI calls) with the captain's `pro:active` subscription untouched.
  **This closes only the `$0`-Elite half of the chain** — raw `POST /auth/v1/signup` is still
  unauthenticated and unthrottled, since Turnstile gates only the app's own button and never the
  GoTrue endpoint, so throwaway accounts can still be created; they just can't self-grant a paid
  tier any more. What throttles raw signup remains an open decision. See `docs/status.md` Known
  Issue #21 for the full updated live state.

## 2026-08-05 (Sign-in wordmark reads as three words again)

- **`Copy.auth.wordmark` fixed from `'Pace AnalysisAI'` to `'Pace Analysis AI'`** (captain's call,
  reversing the 2026-08-04 note that called the two-word wrap "the hero lockup working as
  designed" — see that entry above). `components/kinetic-text.tsx` splits its `children` string on
  whitespace to animate each word independently; with no space between "Analysis" and "AI" it only
  ever produced two word-tokens, and the second one visually read as "AnalysisAI." The fix is a
  three-word, two-space string so `<KineticText>` naturally treats it as three independent words.
  Checked every other rendering of the app name: `app/(tabs)/index.tsx`'s Home heading reads
  `Copy.home.title` ("Home"), a separate key, so it was never affected. The permission soft-ask
  copy (`sourcePicker.permission.library.title`, `capture.permission.camera.title`) and every
  doc/planning reference to the app's actual name
  ("Pace AnalysisAI," one compound word) are untouched — those are the product name, not this
  wordmark's display treatment, and out of scope for this fix. Added a regression test
  (`components/__tests__/kinetic-text.test.tsx`) asserting the wordmark splits into exactly three
  word-tokens.
- **Investigated a second captain report — "the sign-in animation doesn't play at all" — and
  confirmed it is not a code defect.** Built and ran a real native iOS Simulator dev client
  (`npx expo run:ios`) rather than reasoning from source alone. Confirmed via injected debug
  logging: `useReducedMotion()` correctly returns `false`; every `<KineticText>` word's
  `useEffect` fires with the correct per-word delay; the JS-side Reanimated version
  (`_REANIMATED_VERSION_JS`) matches the native side (`_REANIMATED_VERSION_CPP`) exactly
  (4.1.7 == 4.1.7), which is only possible if Reanimated's native module is properly linked and
  reachable — ruling out a broken babel/worklets pipeline (also verified `babel-preset-expo`
  correctly auto-selects `react-native-worklets/plugin`, the correct v4 plugin, since this repo
  has no `babel.config.js` and relies on Metro's built-in default preset). Disabling
  `experiments.reactCompiler` and rebuilding ruled out a React Compiler/Reanimated interaction.
  **Conclusive test**: temporarily stretched `Motion.duration.gentle` to 60000ms and logged
  `Date.now()` at each word's animation start and completion (`withTiming`'s `finished` callback)
  straight to the Metro console on a real device — no screenshots, no timing guesswork. Each word's
  completion landed within ~150-350ms of its own `delay + 60000ms` mark, exactly on schedule: the
  animation genuinely runs for its full configured duration and reliably fires its completion
  callback. Screenshots taken well before that 60s mark (as early as ~32s in) already looked fully
  settled — not because the animation had stopped, but because `Motion.curve.calm`
  (`cubic-bezier(0.22, 1, 0.36, 1)`, an aggressive ease-out) visually plateaus near full opacity
  long before the timing driver's nominal end, the same shape that made every earlier
  short-duration (~570ms) screenshot look identical: the motion is real but front-loaded and fast.
  No code change made for this half of the report — the animation is working as designed, just
  quick enough on a glance to read as absent.

## 2026-08-05 (UX audit fix batch — `v23-ux-audit-r1`)

- **H4 follow-up — `/result/sample` is now a real member of `app/_layout.tsx`'s Stack, matching
  `result/[id]`.** The earlier H4 fix (declarative `<Redirect href="/" />` on a missing pending
  sample) had a gap: this route was never declared as a `<Stack.Screen>` anywhere, so on a genuine
  cold/direct navigation (a fresh tab, not an in-app push) the route was never a real navigator
  member for the `<Redirect>` to fire from, and the screen dead-ended blank instead. Fixed by
  declaring it inside the session-guarded block, same placement as `result/[id]`.
- **H1 — Free-tier pre-purchase copy now matches the already-approved sample-preview policy.**
  `constants/copy.ts`'s Free tier detail, quota-available, and quota-exhausted strings used to
  promise a "certified" real read of the user's own upload even though PR #171 already made Free
  a zero-model-call labeled sample. Rewritten to describe a worked example honestly, per the
  captain's 2026-07-26 approval — no real analysis was restored for Free.
- **H2 — sign-in's decorative mark no longer draws through the wordmark.** Shrunk from 260pt to
  160pt, given its own absolutely-positioned, clipped, `zIndex: -1` layout box behind the header
  (`app/(auth)/sign-in.tsx`) instead of overhanging it.
- **H3 — a systemic WCAG AA contrast failure (`opacity` dimming `text.primary` on the page
  gradient, which is only proven at full opacity) is fixed at all 6 sites it turned out to exist
  at** (`capture/index.tsx`, `settings.tsx`, `paywall.tsx`, `compare.tsx`, and both auth screens'
  `passwordHint`) and locked with a new regression test,
  `app/__tests__/gradient-opacity-guard.test.ts`, that scans every `<ScreenGradient>` screen's
  style objects for the `opacity` + `color: colors.text.*` combination.
- **H4 — the cold-nav crash on `/analyzing` and `/result/sample`** (a mount-effect
  `router.replace('/')` that fires before the root navigator has mounted) **is now a declarative
  `<Redirect href="/" />`.** `app/result/[id].tsx` was also named in the audit but, on inspection,
  never had this pattern — it already renders an `'unavailable'` state instead of navigating on
  mount, so nothing needed to change there.
- **H5/M1/M2 — a zero-pillar result is no longer a dead end.** `app/result/[id].tsx` adds a
  primary "Try another clip" CTA (→ `/capture`) when zero pillars scored; `pace-readout.tsx`
  renders a not-assessed pillar's bar track dashed/transparent instead of shape-identical to a
  filled bar; the partial-read banner (`partial-result-banner.tsx`) now gates on
  `scoredPillarCount < 4` rather than the server's `isFallback` flag, so a photo submission that
  legitimately scores 2 of 4 pillars gets the disclosure too.
- **M3 — the partial-read banner says "photo" for a photo submission**, not always "clip"
  (`lib/pace-readout.ts`'s `formatPartialBannerBody` now takes `mediaType`).
- **M4 — the global offline banner no longer covers screen headers.** It's rendered in normal
  flow ahead of `<Stack>` in `app/_layout.tsx` instead of as an absolute overlay, so it pushes
  content down while visible instead of drawing over it.
- **M5 (partial) — History's top bar now has a Settings entry point**, matching Home's. The
  broader "one header primitive per screen role" consistency pass was left alone — it's a real
  design call across many screens, out of a mechanical audit-fix's judgment to make unilaterally.
- **M6 — the floating tab bar's "HOME"/"HISTORY" labels no longer clip** (explicit `lineHeight`
  added to `tabBarLabelStyle`).
- **M7 — the Paywall's Free card no longer goes blank while the plan fetch is loading or
  errored** (the common case the audit actually observed) — it now shows the "Current plan" chip
  by default and only hides it once a fetch confirms a paid tier.
- **M8 — the Paywall's plan-load error state is wrapped in `<SurfaceCard>`**, matching every
  other error state in the app.
- **M9 — `<GlassFrost>` self-clips to `Radius.pill` on `PillButton`'s secondary variant** as a
  defensive second clip alongside the parent's existing `overflow: 'hidden'`. Unverified visually
  (no browser/device tooling in this pass) — see the code comment for the reasoning.
- **M10 — `/result/sample`'s terminal CTA is now the upgrade** ("Analyse my own form — upgrade" →
  `/paywall`), with "Back to Home" demoted to a ghost button beneath it.
- **L1-L4, L7, L8 — small polish**: Cancel affordance on both extraction wait states; the
  extracting screen's error state no longer says "Preparing your analysis" and "Couldn't process
  this clip" at once; `/update-password`'s expired state gained a "Back to sign in" ghost button;
  its "Confirming your link…" wait now shows the same mark every other wait state uses; a session
  that expires mid-`/analyzing` now gets distinct, actionable copy instead of the generic
  service-failure string; Home's top-bar mark's `text.secondary`-on-gradient use is now a written,
  deliberate exemption in `constants/theme.ts` rather than an unresolved ambiguity. L5 (floating
  labels on auth inputs) and L6 (a connectivity pre-flight check on the capture flow, which has no
  actual network call to gate) were judged out of scope for this batch — see the PR description.
- **Review follow-up — Paywall's Free-tier gate copy brought in line with H1.** `constants/copy.ts`'s
  `paywall.gate.free` title/body still promised "your free analysis" after H1 above rewrote the
  pre-purchase Free copy to the sample-preview framing; this was the same captain-approved policy,
  not a new decision, so it was updated the same way.
- **Review follow-up (L7) — the `analyzing` screen's `unauthorized` error CTA now signs the user
  out instead of offering Retry.** Retry there would resubmit under the same expired session that
  just failed; the CTA now calls `lib/sign-out.ts`'s `signOut()` (the same helper `app/settings.tsx`
  uses) and lets `app/_layout.tsx`'s route guard redirect to sign-in, guarded by an `isMountedRef`
  against a post-unmount `setState` if sign-out resolves after the screen has already unmounted.

## 2026-08-04 (Free tier is now a zero-model-call sample preview, not a real analysis)

- **Free tier makes ZERO Anthropic model calls, ever (captain-approved 2026-07-26).** Previously
  Free ran the exact same `analyze-form` code path as Pro/Elite (only prompt verbosity differed);
  now a new side-effect-free RPC, `pace_current_tier` (`supabase/migrations/
  20260804120000_pace_current_tier_function.sql`), runs right after consent and before the AI
  spend gate to learn the caller's tier without reserving a row or spending a quota slot. A
  `'free'` result short-circuits the whole request: no AI gate, no `reserve_analysis`, no model
  call, no `analyses` row, no frame upload — the response is `200 { result: FREE_SAMPLE_PACE_RESULT,
  isSample: true }`, a hand-authored, never-persisted, Pro-depth sample result
  (`supabase/functions/_shared/analyze-form-sample.ts`). Pro/Elite are completely unchanged — same
  gate → reserve → model → retry → settle path as before, and a regression test asserts they
  still call the model exactly once. On any `pace_current_tier` RPC failure or an unrecognized
  tier value, the request fails as a `500 internal_error` — deliberately not defaulting to
  `'free'` (would silently swallow a paying user's real analysis) or to a paid tier (the actual
  spend risk).
- **The client shows the sample next to the user's own uploaded photo, honestly labeled as a
  preview, with an upgrade path immediately adjacent.** `lib/analyze-form.ts`'s
  `AnalyzeFormSuccess` is now a discriminated union (`kind: 'result' | 'sample'`) rather than a
  bolted-on nullable field, since a sample has nothing DB-backed to reconcile against.
  `app/analyzing.tsx` routes a `kind: 'sample'` response to a new static route,
  `app/result/sample.tsx` (never `/result/[id]`, which would try to fetch a row that was never
  created) — staged through a new one-shot mailbox, `lib/pending-sample-result.ts`, carrying the
  fabricated result plus a `data:image/jpeg;base64,...` URI built client-side from the frame
  already in memory (nothing is uploaded to Storage for a sample). The new screen renders a
  `<SampleResultBanner>` (`components/sample-result-banner.tsx`) above the PACE readout stating
  plainly this is an example of Pro's output, not a read of the user's actual photo, with an
  upgrade CTA inside the same banner — the App Store policy / refund-dispute control this whole
  feature exists for. New copy: `Copy.result.sample.*` in `constants/copy.ts`. No subscription
  price is encoded anywhere in this change (pricing is a separate, later decision).
- **Known gap, tracked, not fixed here (docs/status.md Known Issue #36, GitHub issue #170):** Free
  tier's sample path is no longer rate-limited per user — `reserve_analysis`'s lifetime cap and
  anti-farming counter no longer apply to it, since the whole point is to skip that RPC entirely.
  Flagged MEDIUM by both a threat-modeling and a security-review pass; the only remaining bound is
  the existing global per-request size cap. Filed as a follow-up rather than expanding this
  change's scope into new abuse-prevention infrastructure.

## 2026-08-03 (design polish pass — heading copy, motion-budget doc reconciliation)

- **Redesigned `components/low-poly-field.tsx`'s mark: shatter-into-a-running-figure, replacing
  the `scatter`/`stride`/`gather` 3-pose cycle entirely.** New cycle: an abstract `DEFAULT_POSE`
  shatters apart, reassembles into a runner that cycles a full gait (contact → load → toe-off →
  swing → knee drive → landing, `RUNNER_KEYFRAMES`, 8 phases × 3 loops), then shatters back to
  the default and holds. The shatter is a genuine fly-apart-and-reassemble (each vertex explodes
  outward from the field's centre through a shared waypoint, not a straight-line dissolve) on the
  two transitions that cross the abstract/runner boundary; plain gait-to-gait steps stay a
  straight eased morph. The runner's pose is grounded in `knowledge/pace_framework.md`: a ~7°
  whole-body lean from the ankles (Posture), a compact landing under the hip rather than reaching
  ahead (Cadence — deliberately not the overstride silhouette PACE flags), a deepest-knee-bend
  load phase with a subtle hip-height bob (Elasticity), and a bent-elbow front-to-back arm swing
  contralateral to the legs (Arm swing). `FACET_COUNT` moved 9 → 17, reached by rendering the
  gait keyframes to SVG and iterating until the figure read as a runner, not a guessed number.
  Reduced motion still renders `DEFAULT_POSE` statically, unanimated, zero Reanimated work
  scheduled — the abstract mark, never a held gait-cycle instant (which would misleadingly imply
  in-progress motion). The component's `poses` prop is gone (there is now exactly one cycle, so
  callers no longer choose one) — all four consumers (`app/(auth)/sign-in.tsx`,
  `app/(tabs)/index.tsx`, `app/analyzing.tsx`, `app/capture/extracting.tsx`) updated to the
  simplified `color`/`size`/`style`/`testID` API. Verified visually via a live Expo web render
  (the runner reads clearly across multiple gait phases; the shatter is a legible burst of
  shards, not a chaotic dissolve) in addition to the full `typecheck && lint && test` gate.
- **Investigated the reported "morphing mark isn't playing" (PRs #163-#165).** Found no code
  regression: `components/low-poly-field.tsx` is unchanged since #165, its own test suite (per-
  vertex morph, reduced-motion still-frame) passes, and a live Expo web render of `/sign-in`
  showed the SVG `<Polygon>` geometry genuinely changing every ~2.5s, matching the authored
  `scatter`→`gather` pose cycle exactly. No fix applied here — flagged back to the captain in case
  what was seen was a stale native build, since nothing in the diff since #165 touches this file,
  `hooks/use-reduced-motion.ts`, `constants/theme.ts`'s `Motion` tokens, or the Reanimated/worklets
  toolchain.
- **Shortened three headings that wrapped to two lines against their own container width**,
  measured against the real `Archivo_700Bold`/`600SemiBold` font metrics (not estimated): `Copy.
  history.title` ("Past Analyses" → "History", `FontSize.display` 64pt), `Copy.analyzing.error.
  failed.title` ("Your analysis didn't go through" → "Your analysis failed"), and `Copy.analyzing.
  error.previousAttemptFailed.title` ("That analysis didn't finish" → "Analysis stopped", after an
  interim "Analysis didn't finish" still wrapped at the narrowest supported width, iPhone SE/mini
  375pt). `docs/design/copy-deck.md` updated in the same pass so the prescribed copy doesn't go stale.
  Checked every other `accessibilityRole="header"` heading in the app the same way (precise font-
  metric measurement, not character counting) — none of the rest exceed two lines, and the sign-in
  wordmark's two-line wrap ("Pace" / "AnalysisAI") is the hero lockup working as designed, not a
  copy problem.
- **Reconciled `docs/design/frontend-design-brief.md` §6.1** ("the motion budget," amended
  2026-07-26): it still said "nothing else animates... no per-word reveals, no marquees or
  tickers," which PRs #164/#165 already contradicted on merge (`components/kinetic-text.tsx`,
  `components/marquee.tsx`, and the low-poly ambient field all shipped after that line was
  written and were never reconciled against it). Marked the line superseded and recorded the
  actual current budget instead of leaving the stale rule in place to mislead the next reader.
- **General cleanliness pass**: verified `/sign-in` (light + dark, mobile viewport, sign-in and
  sign-up modes) renders cleanly via a live Expo web render — no element overlap (checked the
  low-poly mark's actual DOM bounds against the form fields below it: 64px of clear space, not
  the collision a first glance at a screenshot suggested), and a repo-wide grep found no
  hardcoded colors/spacing outside `constants/theme.ts`. Screens gated behind a real Supabase
  session (Home, Result, Settings, Paywall, Compare, History) could not be rendered in this
  environment (placeholder `.env`, no live backend) — no changes made there beyond the copy-deck
  fixes above; flagging this as an open gap rather than guessing at "messy" without evidence.

## 2026-08-03 (diagnosed: "the analyzer crashes" was a stale `node_modules`, not an app bug)

- **Root cause found and confirmed reproducible; no tracked file was wrong.** The captain reported
  the photo/video analyzer erroring or crashing instead of completing. Reproduced by running this
  worktree's own gate: `npm run typecheck` failed immediately with `Cannot find module
  'react-native-webview' or its corresponding type declarations.` in `components/turnstile-widget.tsx`,
  and `expo start --web` confirmed the same failure at the Metro-bundling level (`Metro error:
  ... Unable to resolve module react-native-webview`). Metro bundles the whole JS dependency graph
  in one pass — `app/(auth)/sign-in.tsx` imports `turnstile-widget.tsx` at the top level (not
  lazily) — so an unresolvable import anywhere in that graph fails the ENTIRE app bundle, not just
  the sign-up screen. That is exactly the shape of "the analyzer crashes rather than completing":
  the analyze flow was never reached because nothing in the app could load.
  - **What was actually wrong:** this worktree's `node_modules/` (installed 2026-08-02, before the
    Turnstile PR #166 landed 2026-08-03 01:23) never got `react-native-webview` installed, even
    though PR #166 correctly added it to both `package.json` and `package-lock.json` — `npm ls
    react-native-webview` showed it declared but not present on disk. `package.json`/
    `package-lock.json` were never wrong; `node_modules` was simply never brought back in sync
    with the lockfile after that dependency landed.
  - **Fix: `npm ci`** (not `npm install`, which pointlessly rewrote the pin to `^13.15.0` in both
    files) — a clean install from the existing lockfile, restoring `node_modules` to match
    `package-lock.json` exactly, with zero diff to either tracked file.
  - **Verified afterward:** `npm run typecheck && npm run lint && npm test` all clean (68/68 Jest
    suites, 1128 Jest tests, 389 Deno tests), and `expo start --web` now bundles the full app
    (1462 modules) with no resolution errors — the only remaining error there is the expected
    "copy `.env.example` to `.env`" guard for an unconfigured local environment, not a bug.
  - **Why no code changed:** the repository's own CI (`.github/workflows/ci.yml`) already runs
    `npm ci` from a clean checkout on every push/PR, so this class of drift cannot reach `main`
    or a review build — it is purely local/worktree `node_modules` going stale relative to a
    lockfile that gained a new dependency. **Anyone hitting an "Unable to resolve module" crash
    after pulling latest `main`, especially right after a commit that added a dependency, should
    run `npm ci` before assuming it's an app bug.**

## 2026-08-03 (CAPTCHA on signup — Known Issue #12, resolved via a custom edge function)

- **Signup is now Turnstile-gated; sign-in is untouched.** Closes Known Issue #12: the hosted
  Supabase project has no signup rate-limit field and `mailer_autoconfirm` is on, so a disposable
  signup was unthrottled and worth ~4 potential Anthropic calls once `analyze-form` (M4) went
  live, which it now has.
  - **Native `auth.captcha` was tried and reverted, live, within minutes, on 2026-08-02.** It's
    project-wide, not per-endpoint: enabling it (`security_captcha_enabled = true`, provider
    `turnstile`, via the same scoped Management API PATCH mechanism `password_hibp_enabled` uses)
    made `POST /auth/v1/token?grant_type=password` (sign-in) 400 with `captcha_failed` too,
    confirmed by direct testing against the live project, not doc-reading. Known Issue #12
    explicitly does not want sign-in gated, and there is no server-side knob to scope
    `auth.captcha` to signup only — so it was reverted (`security_captcha_enabled = false`,
    verified by a follow-up sign-in test returning the normal `invalid_credentials` error) and
    stays disabled, permanently, in `supabase/config.toml`.
  - **The actual fix: `supabase/functions/signup-with-captcha`.** It verifies the Turnstile token
    itself (`_shared/captcha.ts`, Cloudflare's siteverify API, fails CLOSED on any network/parse
    failure) and, only if that passes, proxies a plain, unprivileged `supabase.auth.signUp()`
    call using the publishable key (`_shared/signup-client.ts`) — no admin/service-role API
    involved, so `minimum_password_length`/`password_hibp_enabled` keep being enforced by GoTrue
    exactly as before. The already-registered-email non-enumeration behavior (`{ session: null }`
    with an empty `identities` array) and the weak-password length-vs-pwned precedence are both
    ported from `app/(auth)/sign-in.tsx`'s prior inline logic.
  - **Client**: `components/turnstile-widget.tsx` hosts Cloudflare's `turnstile/v0/api.js` inside
    a minimal `react-native-webview` HTML shell (no first-party RN SDK exists) and bridges its
    callbacks back via `postMessage`. `app/(auth)/sign-in.tsx` renders it only in sign-up mode,
    disables submit until a token arrives, and calls `lib/signup-with-captcha.ts`'s
    `signUpWithCaptcha` instead of `supabase.auth.signUp` directly; on success it hydrates the
    on-device session via `supabase.auth.setSession` (`lib/session-provider.tsx`'s
    `onAuthStateChange` treats this identically to a session from `signInWithPassword`). Turnstile
    tokens are single-use — the widget is reset after every submit attempt, success or failure.
  - **Secrets**: `TURNSTILE_SECRET_KEY` (the real key, captain-provided) is set via
    `supabase secrets set` on the hosted project — never committed, never `EXPO_PUBLIC_*`. The
    site key (`0x4AAAAAAEEhQ-XT-o1iB6kd`, safe to expose client-side by Cloudflare's own design) is
    read from `EXPO_PUBLIC_TURNSTILE_SITE_KEY`. Local dev (`supabase/functions/.env`, gitignored)
    and `eas.json`'s `development-local`/`preview-local` profiles use Cloudflare's public,
    documented "always passes" test key pair instead of the real one, so local testing doesn't
    depend on the real widget's domain restrictions.
  - **Verified live**: a request with no `captchaToken` gets `400 invalid_body`; a request with a
    garbage token gets `400 captcha_invalid`. The "succeeds with a valid token" path is proven by
    the full Deno + Jest test suite (a fake `CaptchaVerifier` returning `true`, exercising the real
    `signUp` proxy end to end) — no browser-automation tool was available in this session to solve
    a live Turnstile challenge, which would be the only way to prove it more strongly than that.
  - New tests: `supabase/functions/_shared/__tests__/{captcha,signup-with-captcha}.deno.test.ts`,
    `lib/__tests__/signup-with-captcha.test.ts`, `components/__tests__/turnstile-widget.test.tsx`,
    plus new cases in `lib/__tests__/auth-errors.test.ts` for `mapSignupWithCaptchaError`.

## 2026-08-02 (the bold pass — the three things the Calm redesign declined)

The redesign below deliberately declined three things and flagged each. The captain asked for all
three. This pass builds on that redesign rather than reversing any of it: `Radius.card` stays 24,
history rows stay score-led, Delete keeps its visible word, the result screen stays titleless. No
behaviour, routing, auth, RLS, schema, edge-function or copy-string changed.

- **Glass is genuinely translucent on controls now — and the boundary was NOT traded away.** The
  old `Glass` contract banned glass from being an interactive control's fill, on the true premise
  that an 8–13% wash reads ~1.1:1 and can never meet WCAG 1.4.11's 3:1. That premise conflated a
  control's FILL with its BOUNDARY, which are independent. So the fill is frosted and the **ring**
  pays the 3:1: `<PillButton variant="secondary">`, `<CircleIconButton>` and `<GlassCard>` now
  render `components/ui/glass-frost.tsx` (a real `expo-blur` backdrop blur under the `Glass` token)
  behind a `control.border` ring. **No control lost its boundary guarantee.**
  - **`Colors.*.control.border` retuned in both schemes** (light `#7986A6` → `#6C7A9D`, dark
    `#6B77A0` → `#D4D7E3`). This is a **widened** guarantee, and it closes a real gap the redesign
    shipped: the old ring was proven only against the three opaque surfaces, but since the redesign
    every control sits on `Gradient.page` — where it measured **1.43 / 1.83 / 2.38:1** (dark) and
    **2.94 / 2.85 / 2.86:1** (light), well under the 3:1 it advertised. The new values are solved
    against surfaces + wash + every glass composite. Dark had to go *lighter*: the only darker
    colour clearing the darkest stop is pure black, at exactly 3.00:1.
  - **New `Glass.*.control`** (frosted control fill) and **`Glass.*.chrome`** (canvas-tinted, the
    only tone proven for BOTH text roles). `chrome` is what lets the **floating tab bar become
    translucent** without demoting its inactive `text.secondary` label — a white-tinted glass bar
    tops out near 3.7:1 there, short of AA, which is exactly why the redesign kept it opaque.
  - **The counter-guard was kept, not loosened.** `text.secondary` on white-tinted glass over the
    wash still genuinely fails AA (1.8–3.0:1 dark), so that assertion states the same truth it
    always did; it now iterates `WhiteTintedGlassTones` so the new `control` tone is covered too.
  - **What the captain's choice actually cost** (stated here so it is not left to the diff): a
    frosted control's affordance now rests on a 1pt ring instead of a solid fill, and its label
    falls from 15.81:1 on the old opaque `surface.raised` to **4.72:1** worst case — still AA,
    **no longer AAA**. Nothing dropped below AA.
- **The low-poly mark morphs per-vertex.** The captain lifted the standing `react-native-svg` ban
  for this purpose, and **the now-false ruling in `components/annotation-lines.tsx`'s header was
  corrected rather than left to mislead**. A facet is an SVG `<Polygon>` and a pose is three
  independent vertices, so a triangle genuinely becomes a *different* triangle — a CSS
  border-triangle is always isoceles about its own axis and could only move/scale/rotate.
  `annotation-lines.tsx` itself stays on plain views: that was re-evaluated and declined on merit
  (a straight line has no internal geometry to morph), not blocked.
- **The aperture is restored AND consumed.** `components/aperture.tsx` — a permanent radial
  vignette, plus a six-bladed even-odd iris and an `expo-blur` rack focus that play once — now wraps
  the result hero. It **composes with** the existing duotone frame and annotation wireframe rather
  than fighting them: the vignette is tinted in the same `background` the grade uses (a neutral
  black would have greyed the grade), it stays fully clear inside 62% of the radius so the ground
  rule's ends survive, and the wireframe is **sequenced behind** the iris via the new
  `AnnotationLines.startDelayMs` instead of drawing underneath a shut iris.
  - **It was rebuilt from its description, not recovered.** The redesign deleted it before
    committing, so it is in no commit — `git rev-list --all --objects | grep aperture` is empty and
    PR #164's file list carries neither it nor `expo-blur`. Recorded in its header.
- **Reduced motion still suppresses movement, never content, and each fallback is locked by a test.**
  The mark renders pose 0's real vertices as plain un-animated polygons (asserted at the geometry,
  so "it rendered" cannot pass on an empty box); the aperture keeps its vignette and drops only the
  iris and rack focus, and still fires `onOpened` so the hero is never stranded mid-sequence.
- **Dependencies:** `expo-blur` and `react-native-svg` added — both first-party/Expo-managed, both
  requested by the captain's decision.
- **Tests:** 1099 Jest (was 1003) + 369 Deno passing; typecheck and lint clean. The contrast proof
  alone went from 117 to 179 assertions.

## 2026-08-02 (the Calm redesign — shape, type, spacing, component and motion layer)

The follow-up the palette swap below was not: a recolor was only ever half the ask. This pass moves
the app's **shape, type scale, spacing rhythm, component vocabulary and motion register** onto the
Calm reference's design language, building on the colour layer rather than touching it. `Colors`,
`Score`, `Semantic`, `Accent` and `Gradient` are unchanged. Every screen in the app is restyled;
none of them changed what they DO.

- **`constants/theme.ts`** — additive except for one deliberate reversal.
  - **`Radius.card` reversed, 0 → 24.** Spec 2026-07-26 §3.3 set it to 0 on the argument that "a
    sharp corner reads as a printed document, a rounded one reads as a generic app card". That was
    right for "The Gait Plate" and is wrong for Calm, where every surface is generously rounded and
    the softness IS the brand. Keeping 0 would have left the app reading as a technical readout
    wearing Calm's colours. Added alongside: `Radius.tile` (16, for anything nested inside a card)
    and `Radius.hero` (32, for full-bleed media); `sheet` 12 → 28.
  - **New `Glass`** — translucent panel roles, with a narrow, enforced contract: glass carries
    `text.primary` ONLY, and is never an interactive control's fill or boundary (an 8–12% wash
    reads ~1.15:1 against the page gradient and cannot meet WCAG 1.4.11's 3:1 at any alpha that is
    still translucent). Buttons therefore keep opaque fills with a proven `control.border` ring.
  - **New `Tracking`, `LineHeight`, `Elevation`, `ControlHeight.pill`/`.circle`.**
  - **`Motion` gains a longer expressive register** — `duration.gentle`/`.epic`/`.cinematic`,
    `curve.calm`/`.morph`/`.linear`, and a `stagger` scale. The original three durations and two
    curves are untouched, so every already-tuned moment keeps its exact timing.
- **New design primitives.** `components/ui/screen-gradient.tsx` (the first consumer `Gradient.page`
  has ever had — it was shipped unused by the palette swap), `surface-card.tsx` (`SurfaceCard` +
  `GlassCard`), `pill-button.tsx`, `circle-icon-button.tsx`, `eyebrow.tsx`; plus the expressive
  layer: `components/kinetic-text.tsx` (per-word reveal), `marquee.tsx` (the pillar ticker), and
  `low-poly-field.tsx` (a morphing triangle mark, built from CSS border-triangles — this repo's
  no-`react-native-svg` ruling is inherited, not relitigated).
- **`components/ui/notched-card.tsx` deleted** (with its test). The notched, square-cornered plate
  was the signature shape of the language this replaces; `SurfaceCard` supersedes it.
- **Every screen restyled** — gradient backdrop, pill controls, circular back/settings buttons,
  display-scale headings, opaque cards for anything the wash cannot carry. The floating tab bar is
  now inset and rounded (`app/(tabs)/_layout.tsx` exports `TAB_BAR_CLEARANCE`, which tab screens
  pad by, since an absolute bar reserves no layout space).
- **`app/_layout.tsx` now builds a real React Navigation `Theme` from the tokens.** This was the
  follow-up `app/(tabs)/_layout.tsx`'s issue-#12 comment named, forced here: screens render a
  gradient over a transparent SafeAreaView, so stock `DefaultTheme`'s white card flashed underneath
  on every push transition.
- **Accessibility held, and proven.** `theme-contrast.test.ts` now **composites** the `Glass` alphas
  over every backdrop they may legally sit on (all three gradient stops plus `background`) and
  proves `text.primary` clears 4.5:1 on each — plus a counter-guard proving `text.secondary` over
  dark glass on the wash genuinely fails, so the narrow contract cannot be quietly widened. Every
  text role that used to sit on an opaque `background` and now sits on the wash was raised to
  `text.primary`, since the gradient is proven for that tone only. Touch targets unchanged at ≥44pt.
- **Reduced motion is honoured by every new primitive**, and in each case by suppressing MOVEMENT
  rather than content: the gradient stops drifting, the low-poly mark renders as a still mark, the
  marquee does not scroll (and its duplicate copy is not even mounted), kinetic text does one
  crossfade instead of a stagger. New tests lock all four.
- **Tests:** 1003 passing (was 949). Three existing suites were updated, not weakened —
  `theme-tokens.test.ts`'s `Radius.card` lock now locks 24 with the reversal documented at the
  assertion, and two suites that queried split kinetic text by `getByText` now query the accessible
  label, which is what a screen reader actually receives.

## 2026-08-02 (the Calm colour scheme — a palette swap, colours only)

Replaces V2.3's warm graphite/bone colour layer with the Calm app's blue/violet scheme, derived by
sampling the reference capture (`V2.3-Calm-Design-References-calm-screens.png`) pixel-by-pixel
rather than from its prose description. **Colours only** — `FontFamily`, `FontSize`, `Spacing`,
`Radius` (including `Radius.card: 0`), `Motion`, `ControlHeight`, `ControlWidth`, `ContentWidth`,
`HitTarget`, `CheckboxSize`, `Opacity` and `SystemFont` are byte-identical (verified by diffing the
whole block against `HEAD`). No component was restructured, no layout changed, no screen added.

- **`constants/theme.ts`** — `Colors`, `Score`, `Semantic.error` and `Accent` re-derived; the
  achieved contrast ratios are quoted at every token, as the file's convention requires.
  - Dark is the faithful copy. The reference ships **two registers**: a blue→periwinkle→violet page
    wash, and a night canvas for its player/index screens. The flat, contrast-bearing `background`/
    `surface.*` roles take the night canvas (with the wash's periwinkle cast); the wash becomes the
    new `Gradient` token. Putting the bright mid-gradient blue in `background` was tried and
    rejected — it lifts `surface.raised` until the ≥4.5:1 floor for score-band text lands above
    pure green's luminance, making four distinguishable score hues arithmetically impossible.
  - Light is derived, not invented (Calm has no light mode): same hue family, inverted lightness.
  - Score bands moved into the cool register — coral 14° / gold 44° / jade 145° / teal 178°, all
    ≥30° apart and every separation wider than the warm ramp's (whose `good`/`strong` sat 5°
    apart). Each band is solved to a **common target ratio per role** rather than to its own bare
    minimum, so the four read as one scale instead of four different visual weights.
  - `Accent` is now the reference's periwinkle-violet glow, shipped darker than the sampled
    `#9988F7` because white-on-accent ≥4.5:1 and accent-on-`surface.raised` ≥3:1 leave only a
    narrow luminance band. Calm's own value carries white at 2.92:1 and does not meet AA there.
    That same floor is what caps how light the dark surface stack can go.
- **`constants/theme.ts` — new `Gradient` export.** One role, `page` (an ordered stop array per
  scheme), because one role is all any screen consumes; no speculative variants. Its dark stops are
  sampled off the reference's **content** screens, not the splash, whose sky-blue top carries white
  at only 2.28:1. **Contract: it carries `text.primary` only** — secondary text and score colours
  go on a surface, which is how the reference behaves too (one white headline on the wash,
  everything else on a glass card).
- **`constants/__tests__/theme-contrast.test.ts`** — 12 new assertions proving every gradient stop
  against its scheme's `text.primary`; the stops are iterated from the export, so a stop added
  later is proven the moment it ships. **No existing assertion was weakened, skipped or deleted** —
  the suite computes ratios from the live exports and had no hardcoded expected values to update.
  85 → 97 tests, all green.
- **`app.json`** — the splash and Android adaptive-icon background colours were hardcoded copies of
  the old tokens (`#F4F1EA`/`#1A1712`) and would otherwise have flashed bone-then-blue on every
  cold start. Retargeted to the new `Colors.light.background`/`Colors.dark.background`. These must
  stay literal (JSON can't import the token), so they need a manual edit on any future swap.
- **`components/duotone-frame.tsx`** — comment only. Its grade already reads
  `Colors[scheme].background`, so it followed the swap with no code change; the header's rationale
  ("brief §2 chose a warm graphite/bone base") was simply no longer true.
- **`docs/design/frontend-design-brief.md`** — §2 rewritten to describe the shipped palette, so
  `theme.ts`'s "Source of truth: … §2" header claim stays true. §1's one sentence naming the base
  as warm graphite/bone was corrected in place, with a superseded note.
- **Known gap, deliberately not fixed here:** `assets/source/mark-{light,dark,favicon}.svg` still
  carry the old bone/graphite field, and the rasterized icon/splash PNGs derived from them are
  unchanged. Re-cutting that art is asset regeneration, not a token swap, and sits outside this
  change's scope. Filed as a follow-up rather than half-done. `scripts/generate-app-assets.js`'s
  mirrored background hexes were also updated to the new tokens (a stranded pair the initial grep
  missed, being `.ts`/`.json`-scoped), so the constants are correct, but the committed PNGs it
  produces have not been re-rasterized — they still show the old field until someone runs
  `npm run assets` after the SVGs above are updated.

## 2026-07-29 (V2.3 redesign, Phase 2 — the three animated moments)

Implements `docs/superpowers/plans/2026-07-29-redesign-phase-2-animated-moments.md`, which
implements §4 of `docs/superpowers/specs/2026-07-26-redesign-design.md`. **Zero net-new runtime
dependencies** — `react-native-svg` still isn't a dependency of this project.

- **`components/annotation-lines.tsx`** — the single primitive behind all three moments: 1-3
  fixed-geometry hairlines drawn on via `scaleX` (never `width`), reduced-motion aware. Callers own
  their own *when*; this owns only the *how*.
- **`lib/first-run.ts`** — a device-scoped, AsyncStorage-backed once-per-install marker, not
  `lib/consent.ts`'s account-scoped model, because the first-run intro must not gate sign-in.
- **Moment 1** (`components/launch-intro.tsx`, wired into `app/_layout.tsx`) — the ground rule
  alone, <=400ms, every cold start. Interruptible (real accessible "Skip intro" button, not hidden
  decoration) and warm-start-safe by construction: `RootLayoutNav` doesn't remount across
  background/foreground, so there's nothing to persist for "don't replay on a warm start."
- **Moment 2** (`components/first-run-intro.tsx`, wired into `app/_layout.tsx`) — all three lines
  draw onto `components/framing-guide.tsx`'s existing figure (reused, not rebuilt), once per
  install, sequenced after moment 1.
- **Moment 3** — `components/duotone-frame.tsx` now always renders the three hairlines as
  permanent hero decoration (fixed geometry — `@shared/pace` still carries no real per-joint
  coordinates); only the draw-on animation is one-time, gated to a fresh analysis's first open.
  `components/pace-readout.tsx`'s existing bar/numeral reveal now waits for that draw via a new
  `revealReady` prop (default `true`, so every other call site is unaffected) before starting,
  matching the spec's "lines, then bars" sequencing. The actual gate
  (`lib/pace-readout.ts`'s `isRevealTriggered`) is a pure function with its own test, since driving
  Reanimated's real timing from an RNTL test isn't an established pattern in this repo.
- **`docs/design/frontend-design-brief.md` §6.1** now names all three moments as built rather than
  budgeted-for-later. The budget itself is unchanged: exactly three moments animate, nothing else.

## 2026-07-27 (repo hygiene — the recovered analysis_usage ledger is preserved, and quarantined)

- **`docs/superseded/` is new, and is deliberately dead SQL.**
  `20260712124139_analysis_usage_ledger.sql` was recovered from the Supabase preview branch
  `issue-2-analysis-usage-ledger` before that branch was deleted. It was never in a migration set
  and was never applied anywhere; production fixed issue #2 the other way, via
  `20260712040000_analyses_quota_soft_delete.sql` + `20260712230000_analyses_client_delete_removed.sql`.
  It is kept only for the reasoning in its header comments — the quota-reset exploit, the
  equivalence proof between the old and new counting rules, and the accepted residual. Why and
  what lives in [`docs/superseded/README.md`](superseded/README.md); no schema or runtime behavior
  changed.
- **`supabase/migrations/__tests__/superseded_not_applied.test.ts`** makes the quarantine a gate
  rather than a comment: `supabase db push` globs every `.sql` under `supabase/migrations/`, and
  the ledger's `20260712124139` timestamp sorts *between* the two migrations that replaced it, so
  a stray copy would interleave into the middle of quota-accounting history. The suite fails if a
  superseded file reappears there by name or by content hash under a different name, and also if
  either superseding migration disappears.

## 2026-07-27 (V2.3 redesign, Phase 1 — the static layer)

Implements `docs/superpowers/plans/2026-07-26-redesign-phase-1-static-layer.md`, which implements
§3 of `docs/superpowers/specs/2026-07-26-redesign-design.md`. **No animation and no new runtime
dependency beyond one font package** — the three animated moments are Phase 2 and have their own
plan. `docs/design/frontend-design-brief.md` §2 and §6 are amended in the same change so the brief
stays the source of truth.

- **The type scale gained a ceiling.** `FontSize.display` (64) and `.hero` (96) join the brief's
  six steps, which keep their exact values — so no screen changes unless it deliberately opts in.
  The diagnosis behind this: the original six spanned 13→32, a ratio of 2.5×, which is *why* no
  screen had typographic hierarchy. Use at most one `display`-or-larger element per screen.
- **A fourth type role, `FontFamily.prose` (Newsreader), for coaching prose only.** Per-pillar
  feedback, flag details, and drill instructions are a coach's writing, not UI chrome, and rendering
  them in the same family as a button label is part of what made results read as generated text.
  Every control, label, and sub-list title stays Inter; every measured value stays IBM Plex Mono.
  `@expo-google-fonts/newsreader` is the only package added in this whole phase.
- **`Radius.card` 8 → 0.** The one non-additive change, and deliberate: a sharp corner reads as a
  printed document, a rounded one as a generic app card. This touches every existing card in the
  app. `sheet` (12) and `pill` (999) are unchanged — a pill is still a pill.
- **`Spacing.editorial` (96)** for the single large vertical gap separating a result's hero from its
  readout. Above the brief's ramp on purpose; once per screen.
- **`components/duotone-frame.tsx` (new)** renders a stored frame full-bleed and graded toward the
  warm base, instead of inset as a rounded thumbnail. The grade is a low-opacity warm *overlay*,
  never a hue rotation of the subject: the brief chose a warm base specifically because it flatters
  skin tones, and a cold duotone of the kind used on machinery photography is clinical on a human
  body. `GRADE_OPACITY` is a single named constant so it can be lowered — or the grade dropped to
  background-only — once it has been judged on a real body.
- **`components/ui/notched-card.tsx` (new)** is the result container: a die-cut rectangle rather
  than a rounded card, built from two plain `View`s. **No SVG** — `react-native-svg` is not a
  dependency of this project and did not become one.
  - The notch is *stroked*, not just filled, and that is a correction made during implementation
    rather than a flourish. Measured, the `background` colour it is painted in sits at 1.07:1
    against `surface.base` and 1.13:1 against `surface.raised` (1.08 / 1.19 dark) — all far below
    perceptible, so a fill-only notch would have been invisible on every surface this card can sit
    on and the shape signal the spec is buying would never have arrived on device. A 1pt `hairline`
    stroke carries the cut edge; `hairline` is the right token by its own definition (decorative
    rules and ticks, not a control boundary), so no contrast floor is being dodged.
  - `overflow: 'hidden'` on the card is load-bearing, not incidental: it clips the outer half of
    each straddling circle so what renders is an arc bitten out of the edge rather than a dot
    sitting on top. Both facts are locked by tests.
- **`app/result/[id].tsx` is the ONE screen this phase restyles.** Home, capture, history and
  settings are deliberately untouched and inherit only the `Radius.card` change. The result screen
  adopts the hero numeral, the full-bleed graded frame, the editorial gap, and the notched card
  (on `surface.raised`, so its pillar rows do not vanish into their own container). The
  `not medical advice` disclaimer footer and every accessibility label are unchanged.
- **Dynamic Type is guarded, not hoped for** (brief §7 forbids clipping the score readout): the
  overall numeral carries `adjustsFontSizeToFit` with `minimumFontScale={0.5}`, and its row now
  wraps so the band word drops beneath the numeral instead of being pushed off the edge.
  Caveat worth knowing: the first-reveal path renders `AnimatedOverallNumeral`, a `TextInput`,
  which cannot take `adjustsFontSizeToFit` — that path is the one to watch at 96pt.

**Not yet verified:** the visual judgement in the plan's Task 6 Step 8 — numeral behaviour at the
largest Dynamic Type setting, whether the notches read as die-cut on a real screen, and whether the
duotone grade flatters or deadens real skin. The implementing environment had no `.env` (so no
Supabase, so the result screen could not be opened) and no real analysis or body photograph. The
iOS bundle was built end to end and every new symbol resolves, so this is a "how does it look"
gap, not a "does it work" gap. See the plan's closing section for the three open questions.

## 2026-07-26 (paying users were silently getting free-tier frame extraction)

- **Pro/Elite videos are now extracted at the caller's real frame cap, read off the server.**
  `app/capture/extracting.tsx` hardcoded `const EXTRACTION_TIER: PaceTier = 'free'` and used it for
  both the progress total and the actual `extractFrames` call, so **every paying user's video was
  extracted down to Free's single frame**. Cadence and Elasticity are the two PACE pillars derived
  from motion over time and cannot be scored from one still, so a Pro/Elite user paid for an
  analysis that was quietly degraded to the free product. The hardcode's justifying comment ("there
  is no wired, authoritative way to read the caller's tier on the client yet") was true when written
  and had since gone stale: `quota-status` went live 2026-07-26 and its `QuotaStatus` already
  carries an authoritative `frameCap`.
- **The cap comes from the server's `frameCap`, never from a client-side per-tier lookup.** New
  `lib/extraction-frame-cap.ts` owns the decision: `resolveVideoFrameCap` (pure) maps a
  `QuotaStatusResult` to a frame count, and `fetchVideoFrameCap` performs one `quota-status` call
  bounded by `QUOTA_WAIT_TIMEOUT_MS` (4s — same single-network-call budget as `lib/hibp.ts`'s
  `TOTAL_TIMEOUT_MS`). There is deliberately no `PACE_FRAME_CAP[quota.tier]` anywhere in it:
  CLAUDE.md is explicit that the client is never the authority for a frame cap, so re-deriving a
  paid entitlement from a client table would have reintroduced the same class of bug it fixes.
- **`extractFrames` no longer takes a tier.** `lib/frames.ts`'s second parameter changed from
  `tier: PaceTier` to `videoFrameCap: number`, and the module no longer imports `PACE_FRAME_CAP` at
  all — the tier→cap table lookup that made the hardcode possible is gone from the extraction path.
  `PACE_FRAME_CAP` is still pinned against `reserve_analysis`'s own hardcoded caps by the existing
  agreement test.
- **Failure degrades to the free cap, deliberately and visibly; never upward.** A failed,
  unauthorized, timed-out, or nonsensical (`0`/negative/`NaN`/fractional) response resolves to
  `FALLBACK_VIDEO_FRAME_CAP` (= `PACE_FRAME_CAP.free`), because a lookup that failed tells us
  nothing about entitlement and assuming a paid cap would hand a free or signed-out user Elite's
  frame count on a network blip. An absurd server value is clamped to the same global ceiling
  `analyze-form` already enforces, so it cannot become thousands of on-device thumbnail calls.
- **Progress total and extracted count can no longer disagree.** They were two independent reads of
  the same constant; the screen now resolves one number and passes it to both the caption and
  `extractFrames`. A new bounded `preparing` state (spinner only, under the screen's existing
  "Preparing your analysis" title — no new copy-deck string) covers the window before the total is
  known, so the caption never names a frame count the extraction will not produce.
- **Photos are untouched:** always exactly one frame, and that path makes no `quota-status` call at
  all, so no quota failure can affect a photo submission.
- **Tests:** new `lib/__tests__/extraction-frame-cap.test.ts` (21 cases) covers the paid-tier path,
  every documented error code, the timeout, and the nonsense-`frameCap` branches; the screen suite
  `app/capture/__tests__/extracting.test.tsx` grew end-to-end locks asserting the count
  `extractFrames` is actually *called* with for Pro/Elite, the free-cap fallback, that photos never
  call quota, and that the new async phase did not reintroduce issue #147's render loop. Verified by
  mutation: forcing the resolver back to always-free fails 10 of the 31 new cases.

## 2026-07-26 (issue #128 — the analyze-form client is real; first live backend deploy of the analysis path)

- **🚨 `PURCHASE_TIER_DUMMY_ENABLED=true` IS NOW SET ON THE LIVE PROJECT, AND IT IS A RELEASE
  BLOCKER.** By explicit captain decision (2026-07-26), the deployment gate that a security audit
  put on `purchase-tier` (PR #123) is **switched on** for the live `v2.3Analysis` project
  (`vputdomdlknvthnzritt`), so Pro/Elite can be self-granted for $0 during development. The captain
  **declined** to narrow it with `PURCHASE_TIER_ALLOWED_USER_IDS`, so it is currently reachable by
  **any account that can sign up** — which, with open signup and no email confirmation, means
  anyone on the internet. The $0-self-grant → burn-the-shared-daily-AI-cap → deny-every-real-user
  chain in `docs/status.md` Known Issue #21 is therefore **live right now**. This is a known,
  accepted, temporary development risk — **not** a resolution of that issue. **It MUST be unset
  (`supabase secrets unset PURCHASE_TIER_DUMMY_ENABLED`, not set to `"false"`) before any
  TestFlight build or public release.** Restated in Known Issue #21 and added as an explicit
  pre-submission step in `docs/blocked-on-apple.md`'s order of operations.
- **#128 — `lib/analyze-form.ts` now calls the real `analyze-form` edge function.** It was bound to
  `createMockAnalyzeFormClient()`, which mints a `Crypto.randomUUID()` and writes **no database
  row**, so `app/result/[id].tsx` queried an id nothing backed and every upload in the real app
  dead-ended on "We couldn't find this analysis" — verified live, `select count(*) from
  public.analyses` had returned 0 rows, ever. #44 built the edge function but its file list never
  touched `lib/`, so the promised binding swap had no owner. This is the same ownerless-seam bug a
  security audit caught in `lib/delete-account.ts` (PR #122, F1), and the fix is deliberately
  identical: `createAnalyzeFormClient()` is the real client and is what `analyzeFormClient` binds;
  it goes through `lib/functions-client.ts`'s shared `invokeFunction` (#46) rather than
  `supabase.functions.invoke` directly; and the mock is kept for tests/dev but **throws in a
  release bundle** behind a `__DEV__` guard so it can never silently become the production client
  again. The client also structurally validates the 200 body and **refuses a non-UUID
  `analysisId`**, turning what used to be a silent dead end on the result screen into an honest,
  retryable failure on the Analyzing screen. A regression test asserts the shipped binding calls
  the edge function.
- **Deployed to the live project (first time for the analysis path):** `analyze-form` (was never
  deployed), plus redeploys of `quota-status` and `purchase-tier`. **No migrations were applied** —
  all 24 repo migrations, including `pace_quota_status` and `pace_purchase_tier`, were already
  present on the live database with `SECURITY DEFINER` + pinned `search_path` intact;
  `docs/status.md`'s M5 row claiming they were "not applied to any database" was stale.
- **FIXED — every authenticated edge function was answering `401 unauthorized` to valid JWTs.**
  `quota-status`, `analyze-form`, `purchase-tier`, and `delete-account` all rejected freshly-minted
  tokens; edge logs show `quota-status` 401ing on *every* invocation in the retained window,
  the captain's own app included. Cause: `SUPABASE_PUBLISHABLE_KEYS`/`SUPABASE_SECRET_KEYS` hold a
  JSON **object** keyed by name (`{"default":"sb_publishable_..."}`), but a parser duplicated in
  **ten** files only accepted a JSON *array* and fell through to `return raw` — handing the entire
  JSON string to `createClient()` as the API key. Fixed with one shared
  `_shared/supabase-keys.ts`; all ten copies now delegate to it. Verified live: `quota-status` now
  returns real data. **All six edge functions are now deployed carrying the fix**: `analyze-form`,
  `quota-status`, and `purchase-tier` first, then `delete-account`, `analysis`, and
  `sweep-orphaned-media` at 2026-07-26T03:41:28Z once the deploy authority was extended. Verified
  live: `analysis` returned `404 not_found` for a `DELETE` of a non-existent uuid (auth passed,
  nothing destroyed), and `delete-account` returned `200 {"deleted": true}` on a purpose-made
  throwaway account, exercising both the publishable-key parse (auth) and the secret-key parse
  (service-role purge); the throwaway user was confirmed gone and nothing else was affected.
  ⚠️ `sweep-orphaned-media` is deployed and typechecked but **not exercised** — it is gated on an
  `X-Cron-Secret` shared secret rather than a user JWT, and that secret was deliberately not
  guessed or printed, so its live runtime behavior is unverified.
- **VERIFIED LIVE — the analysis flow now works end to end.** A real upload produced
  `public.analyses` row `b144d29b-…` with `status: delivered`, `is_fallback: false`, a structurally
  valid PACE result (overall 55/mid; cadence and elasticity honestly `null` for a single photo),
  and one frame at `{user_id}/{analysis_id}/frame-01.jpg` in the private bucket. Read back through
  RLS as the owner, `readAnalysisRow` resolves to `ready` — a real result screen. `analyses` went
  from **0 rows, ever** to a delivered row. Quota moved 0 → 1 used.
- **VERIFIED LIVE — the dummy purchase moves tier.** `purchase-tier` with `source: "dummy"` granted
  pro (limit 10 / frameCap 5) then elite (30 / 8), confirmed by `quota-status` and by the
  `subscriptions` row; `purchased_at` did **not** move on the repurchase, so the idempotent
  period anchor holds.
- **The Analyzing screen no longer offers a Retry that cannot work.** Binding the real client made a
  previously unreachable dead end live: Retry re-submits the same request with the same
  `idempotencyKey` (by design — that rule is what stops a client-side timeout from double-running
  the analysis or double-burning quota, and it is unchanged), but a failed attempt releases the
  reservation, so `reserve_analysis` hands back the same released row and `analyze-form` answers
  `409 previous_attempt_failed` forever. That code now renders its own panel — new copy
  `analyzing.error.previousAttemptFailed.title`/`.body` — whose primary action is **Start a new
  analysis** (`analyzing.error.cta.startNew`), routing back to `/capture` so the normal flow mints a
  fresh key. Issue #64's `released` phase, reached by foreground reconciliation instead of by a live
  response, is the same dead end and now shows the same panel and the same action; it previously
  reused the `failed` copy, which ends "— try again", while offering no action but Cancel.
- **`UNKNOWN_ANALYZE_FORM_ERROR` no longer promises the analysis wasn't counted against quota.**
  That reassurance is true for the network and unreadable-body branches, but **false** on the branch
  where the server returned a 200 the client then refused to render (a non-UUID `analysisId`, or a
  result failing `isPaceAnalysisOutcome`): there the reservation was **settled**, not released, so
  the quota was spent. One constant covers all three branches, so it now says only what is true on
  all three — the analysis could not be displayed, check Past Analyses. The code stays `'unknown'`
  and the unvalidatable body is still rejected.
- The new `analyzing.error.previousAttemptFailed.*` and `cta.startNew` strings are **uncertified** —
  added to `docs/status.md` Known Issue #34's inventory awaiting `ux-copywriter`/Ian review.

## 2026-07-25 (Bucket A infra + test hardening — local Supabase stack, real-Postgres property tests)

- **#62 — M7 full-app accessibility pass.** `accessibility-reviewer`° swept every screen in
  `app/` and shared component in `components/` (M2–M6 screens, now that they all exist) against
  the design-brief §7 floor; `accessibility-implementer` fixed what it found. Full defect list at
  `docs/a11y-audit-62.md`. Highlights: **`components/pace-readout.tsx`'s `PillarRow` was
  collapsing its entire body into one opaque VoiceOver/TalkBack node** — `accessible` +
  `accessibilityLabel` sat on the row's outer container, so every pillar's `feedback`, `flags`,
  and `drills` (the paid tier's whole coaching payload) were structurally unreachable on every
  result screen and in `app/compare.tsx`; now scoped to just the header summary. Past Analyses'
  per-row Delete button announced the static word "Delete" for every row regardless of which
  analysis it would remove — now interpolates date/score via a new
  `formatHistoryItemDeleteA11yLabel` (`lib/history.ts`), mirroring the existing
  `formatHistoryItemA11yLabel` pattern. `components/consent-gate.tsx`'s `useAnnounce` only ever
  spoke `error`; phase transitions (`checking` → `health`/`subject`, `health` → `subject`) swapped
  the whole screen silently — folded into the same announcement, mirroring
  `app/capture/extracting.tsx`. Four screen titles (`app/analyzing.tsx`, `app/capture/index.tsx`,
  `app/(tabs)/history.tsx`, `app/(tabs)/index.tsx`) were missing `accessibilityRole="header"`
  that their sibling screens already had, breaking VoiceOver rotor navigation. One hit target
  (`app/(tabs)/index.tsx`'s `pendingReleasedDismiss`) had `minHeight: HitTarget.min` but no
  matching `minWidth`. Contrast (61-assertion token test), Dynamic Type, reduced motion, and
  decorative-element hiding were all audited and found already correct — no changes needed there.
- **#92 — a local, non-production Supabase environment now exists.** `supabase start` (local
  Docker) stands up the full stack; all 24 migrations apply cleanly via `supabase db reset`.
  Required `supabase/config.toml`'s `auto_expose_new_tables = true` to be set — without it a fresh
  local stack does not grant `service_role` table access the way the live production project
  already has (verified live). See `docs/architecture.md`'s "Current — local Supabase stack"
  section for the full story.
- **#49 — RPC concurrency, idempotent replay, and month-end period arithmetic, proved against a
  real Postgres.** New `supabase/functions/_shared/integration/quota-rpc.local.ts`: two concurrent
  `reserve_analysis` calls for the same user's last slot (exactly one wins), a same-idempotency-key
  race (never double-reserves), replaying a `released` reservation (returns the existing row, not a
  new one), the documented `pace_add_months_clamped` walk (Jan 31 → Feb 28 → Mar 31 → Apr 30, a
  leap-year Feb 29, and a negative `n`), and free-lifetime vs. pro-period quota enforcement.
- **#59 — zero-orphaned-storage-objects, proved against real Postgres and real Storage.** New
  `supabase/functions/_shared/integration/delete-purge.local.ts`: calls the actual
  `deleteAnalysis`/`deleteAccount` functions (via their real production client factories) against
  real uploaded frames, asserting from the Storage side (`storage.list()` after the delete) — never
  from the row side — that nothing survives, across nested `{user}/{analysis}/` prefixes and
  multiple analyses per account, plus idempotent-retry-after-delete for both.
- Both new test files are named `*.local.ts` (not `*.test.ts`/`*.deno.test.ts`) so they stay out of
  `npm test`'s default discovery — they need the local stack running. Run via
  `npm run test:edge:local` (see `supabase/functions/_shared/integration/README.md`).
- **Known Issue #20 resolved** — `docs/design/motion-consult.md`'s nav-param example said
  `results/[id]` (plural); corrected to `result/[id]` (singular), matching the actual built route.
- **#84 — the first EAS simulator build.** Two new `eas.json` profiles, `development-local` and
  `preview-local`, both with inline `env` pointing at issue #92's local Supabase stack rather than
  the shared EAS `development`/`preview` Environments (which hold sensitive, presumably-production
  credentials this work must never touch). `preview-local` (standalone, no dev-client) is the one
  actually usable for E2E — a `developmentClient: true` build needs a live Metro connection and a
  first-run dev-menu overlay that fights scripted automation.
- **#86 — the `.maestro/` E2E flows executed for real for the first time**, against the
  `preview-local` build. Found and fixed four real bugs sitting in the checked-in-but-never-run
  flow files: an invalid `wait:` command (two files), subflows missing the `appId` this Maestro
  CLI version requires, a stale tap target that predates issue #16's sign-in-form fix, and a
  cold-launch timing race. Sign-up through the sign-in screen is now confirmed correct by direct
  visual verification. A full clean pass was not achieved in this sandbox — diagnosed as Maestro's
  own iOS accessibility-tree bridge intermittently failing to resolve text a screenshot from the
  same failed assertion shows is genuinely on screen, not an app, script, or timing-budget problem.
  See `.maestro/README.md`'s 2026-07-25 update for the full diagnosis and how to get a clean run.

## 2026-07-13 (second parallel batch — 10 worktrees; the core flow finally connects end to end)

A second same-day batch, dispatched one worktree + one agent per issue. All merged to
`integrate/batch-2026-07-13b`, `typecheck && lint && test` green (836 Jest + 338 Deno), and the
web export pre-renders every screen including the two new ones. Read the caveats — several lanes
correctly did *nothing* because their issue's premise was stale.

- **#135 — Capture now hands off to Analyzing. THE CORE FLOW WAS NOT CONNECTED.** `app/capture/
  extracting.tsx`'s "Frames ready" state had exactly one control — "Done" — which returned to
  Home. A user could record, watch frames extract, and then simply leave; the one thing this
  product does never reached the analyzer. The CTA (now `upload.ready.cta` = "Analyze my form",
  reusing Home's existing wording) mints an idempotency key, builds the request via the existing
  `toAnalyzeFormRequest()`, stages it in `lib/analyze-form.ts`'s one-shot mailbox, and routes to
  `/analyzing`. Frames deliberately do NOT travel through route params — up to 5 MB of base64
  into a serialized URL. Half the issue was stale: `app/analyzing.tsx` already *read* that mailbox;
  nothing ever wrote to it.
- **#136 — a 402 `quota_exceeded` now opens the paywall.** `AnalyzeFormError.code` was discarded by
  the `'failed'` event, so an exhausted user would have seen the generic error panel with a **Retry
  button that resubmits into the same exhausted quota** — a dead-end loop and a live paywall bypass
  the moment #128 swaps in the real client. `code` is now threaded through
  `lib/analyzing-machine.ts` (typed against the real error union) and `app/analyzing.tsx` routes
  `quota_exceeded` to `/paywall` instead of rendering a retry.
- **#93 — the offline pre-flight gate is wired.** Detection and the global banner already shipped;
  only the *gate* was missing. `checkConnectivity()` now runs immediately before
  `analyzeFormClient.submit()` — not on screen mount, because connectivity changes while waiting in
  a dead zone and again on Retry. Offline is its own machine phase, **not folded into `failed`**, so
  the screen can honestly say "nothing has been sent yet" — true *by construction*, since submit()
  is never called and the timeout never starts. Capture and record are deliberately NOT gated: they
  never touch the network (#88 removed client-side upload), and the copy deck says so explicitly.
- **#140 — an analysis that finishes after a process kill is now surfaced.** #64 only handled
  background→foreground while the screen stayed mounted; a kill drops `lib/analyze-form.ts`'s
  module-state mailbox. New `lib/pending-analysis.ts` persists a marker (keyed on the same
  `idempotency_key` #64 reconciles on, in AsyncStorage — not a credential, so not SecureStore) and
  Home checks it once per cold start. Guarded against cross-account leakage. **The subtle part:**
  the marker is cleared on `succeeded`/`released`/Cancel but deliberately NOT on `failed`/`timedOut`
  (a client-perceived timeout does not prove the *server* stopped). Without the succeeded-clear, a
  normal analysis would leave a stale marker and every later cold start would resurrect an
  already-viewed result.
- **#85 — structured edge-function logging (`supabase/functions/_shared/log.ts`). NO client crash
  SDK, deliberately.** Both `docs/app-store-privacy-labels.md` and the M7 privacy checklist rest on
  "no analytics or crash SDK is present"; adding Sentry would silently invalidate them. Redaction is
  enforced **twice, independently**: an exact-key denylist (`frames`, `mediaPaths`, `result`, tokens,
  `email`) *plus* a value-pattern scan (email/JWT/`data:` URI/bucket-path/signed-URL/base64 shapes)
  that catches forbidden content under a key nobody listed. `userId` is SHA-256 hashed at every call
  site. Instruments `analyze-form`'s real failure paths (kill switch, circuit breaker, retry-gated,
  timeout, honest-partial fallback), all correlated by one `requestId`. **Fixed a real leak:**
  `purchase-tier` was logging raw `err.message`, and Postgres unique-constraint violations echo the
  offending value. **#74 and #47 are NOT unblocked by this** — both need client-side visibility,
  which this deliberately does not add.
- **#60 — Elite compare (`app/compare.tsx` + `lib/compare.ts`).** Client-side diff of two stored
  results; no AI call, no quota burn, no edge function. A pillar that is `null` ("not assessed") on
  *either* side renders as not-assessed, **never a delta of zero** — the fabrication trap a diff view
  is most likely to fall into, now locked by a test that puts a real score on the opposite side.
  Registered inside `Stack.Protected` — an undeclared route file renders as an unguarded top-level
  screen.
- **#137 — the orphaned-media sweeper has an entrypoint (`supabase/functions/sweep-orphaned-media/`).
  IT IS NOT SCHEDULED — nothing runs it yet.** Route chosen on live evidence: `pg_net` is **not
  installed** (`pg_cron` is), and a migration in git can never safely carry a secret *value* into
  Vault, so the recommendation is a Supabase Dashboard Cron Job, not pg_cron+pg_net. **Dry-run is
  the default**; arming real deletion needs an explicit `{"dryRun": false}`. Auth is a shared secret,
  constant-time compared, failing closed — the first non-JWT-gated endpoint in the repo.
- **#37 — `lib/frames.ts` tests closed.** The suite already existed at full coverage; this added the
  gaps, chiefly a **regression lock tying `PACE_FRAME_CAP` to `reserve_analysis`'s hardcoded SQL
  literals** (free 1 / pro 5 / elite 8) and a proof that an unrecognized tier fails *safe* — zero
  frames, never more than the server allows. **Issue #37 contained an impossible acceptance
  criterion** ("assert keyframe-snapped timestamps are propagated"): neither expo-video-thumbnails
  native module exposes the decoded frame time (that is #112). No test was written to enshrine it.
- **#100 — CLOSED, no code. The `storage.objects` grant-all cannot be revoked by a migration, ever.**
  Re-derived live: the table is owned *and* granted by `supabase_storage_admin`; migrations run as
  `postgres`, which holds neither membership nor usage, so `REVOKE` **silently no-ops instead of
  erroring** — a text-level test over migration contents passes while the privilege is fully intact.
  `anon`/`authenticated` still hold `GRANT ALL` including **TRUNCATE**, which no RLS policy can
  filter; it is unreachable (schema not PostgREST-exposed) and the control of record is the
  `pace_media_object_guard` trigger. `public.analyses` IS genuinely hardened (owned by `postgres`).
  **Also corrected: `CLAUDE.md` claimed both grant migrations were unpushed. They are live.** That
  false claim had been sending agents after a phantom.

## 2026-07-13 (large parallel batch — 15 worktrees, 19 issues fully resolved, 4 partial)

A large parallel batch landed on `main` the same day as the entries below it (which predate this
batch). All code is merged and `typecheck && lint && test` is green. Grouped by area, newest work
first within each group; every "not applied"/"not deployed"/"partial" caveat below is load-bearing
— read it, not just the headline.

- **Four new migrations close real holes found reviewing #130 (issues #133, #8, #7, #100+#4) — all
  four are WRITTEN, NOT APPLIED to the live project.**
  - **`20260713150000_settle_analysis_deleted_at_guard.sql` (#133, HIGH).** `settle_analysis` never
    checked `deleted_at`, unlike the sibling guard #130 added to `attach_media_paths`. Sequence: a
    row is `'reserved'` → the user deletes it (soft-delete stamps `deleted_at`, the redact trigger
    nulls `result`/`media_paths`, but its `WHEN` clause only fires on the null→non-null transition,
    so it does NOT re-fire later) → the model call returns and `settle_analysis` matched on
    `status = 'reserved'` alone, so it wrote a real `result` and flipped `status = 'delivered'`
    straight onto the deleted row → a replay of `reserve_analysis`'s idempotent-existing branch then
    returned that live result with a 200 instead of the 410 the soft-delete contract promises. Fixed
    with `and deleted_at is null` added to the `UPDATE`'s `WHERE`, mirroring `attach_media_paths`'
    guard byte-for-byte; same signature, `create or replace`, no caller change needed —
    `release_analysis` deliberately does NOT get the same guard (it must still free a soft-deleted
    `'reserved'` row's quota slot). The migration also documents (no code change) why
    `reserve_analysis`'s existing null-result-on-`'delivered'` → 410 branch already covers every
    case this closes; it does not touch `reserve_analysis` at all, on purpose — a sibling migration
    in this same batch independently rewrites that function's body, and a second `create or replace`
    here would silently collide with it.
  - **`20260713151000_reserve_analysis_media_path_guard.sql` (#8).** #8 was filed against the
    *original* 5-arg `reserve_analysis`, which no longer exists — #88 (live since 2026-07-12)
    dropped `p_media_paths` from `reserve_analysis` entirely, moving path-recording to
    `settle_analysis`/`attach_media_paths` instead, both already namespace-guarded. Verified live
    against the production DB before writing this file: `reserve_analysis` really is 4-arg today,
    with no second overload. Re-adding a guarded `p_media_paths` parameter, as #8 as filed asked
    for, would not be a fix — it would reopen the pre-#88 bug (a client-named path before the row
    exists) and would break `analyze-form` outright (PostgREST cannot disambiguate a 4-argument call
    against two valid overloads and raises "function ... is not unique"). Fixed differently: a new
    table-level `CHECK` constraint, `analyses_media_paths_within_owner_namespace`, backed by a new
    `IMMUTABLE` helper `public.pace_media_paths_within_namespace` (the same prefix-match logic
    `settle_analysis`/`attach_media_paths` already enforce in their own bodies, lifted verbatim).
    This is strictly stronger than per-function guards — it holds for *every* writer, including a
    future RPC or a hand-run service-role `UPDATE` that forgets to guard itself, because Postgres
    enforces it at the row level. No backfill hazard: `public.analyses` was confirmed empty
    (`total_rows = 0`) before this was added.
  - **`20260713152000_storage_user_budget.sql` (#7).** #7 as filed assumed the client still
    uploaded frames directly, which is no longer true (#88); the original client-INSERT exploit is
    already closed. What was genuinely still open: nothing bounded object count/bytes per user, and
    nothing enforced that an object's `{analysis_id}` path segment actually named a real, owned,
    non-deleted `analyses` row. Fixed with a `BEFORE INSERT` trigger on `storage.objects` — a
    trigger, not an RLS policy, because `service_role` (the only role with a live write path today)
    bypasses RLS but not triggers. **Guard 1 (ownership):** rejects any object whose path doesn't
    parse into `{user_id}/{analysis_id}/...` naming a live, non-deleted `analyses` row owned by that
    user — the direct enforcement of frame-upload-ordering's "no object exists before the row that
    owns it" invariant at the one layer that holds even against a compromised or buggy service-role
    caller. **Guard 2 (budget):** caps each user at 3000 objects / 500 MiB in the `media` bucket,
    derived from Elite's worst-case quarter (30 analyses/period × 3.75 MiB/analysis worst case ≈
    337.5 MiB / 720 objects) with real headroom, while still capping any one account at half the
    entire Free-plan bucket. Plus a read-only `public.list_orphaned_media_prefixes` RPC (detection
    only — a migration cannot safely reach the Storage HTTP API to actually delete an object; see
    the next bullet) for a future scheduled purge.
  - **`20260713153000_grant_hardening.sql` (#100 + #4, closed together — same grant surface).**
    `storage.objects` still carried Supabase's legacy table-level grant-all (`INSERT`, `UPDATE`,
    `DELETE`, `TRUNCATE`, ...) to `authenticated`/`anon` — #88 (2026-07-12) dropped the client's
    INSERT/DELETE RLS *policies* but never touched the *grant* underneath, so the client was blocked
    only by policy absence, not by privilege (no defense in depth; TRUNCATE in particular bypasses
    RLS entirely, policy or not). Fixed: `revoke all on storage.objects from authenticated, anon`,
    re-granting `authenticated` only `SELECT` (needed for signed URLs), `anon` nothing. Also tightens
    `subscriptions`/`profiles` past a same-day-but-different-timestamp sibling migration's partial
    revoke (removes the stray `anon` SELECT/REFERENCES/TRIGGER neither table's RLS ever uses),
    restates `analyses`' already-live hardening (no-op, for a single self-contained answer), and
    revokes `set_updated_at()`'s EXECUTE from `anon`/`authenticated`/`public` (inert for the trigger
    itself — Postgres doesn't gate a trigger invocation on its function's EXECUTE grant — but closes
    the one function `#4`'s audit found still client-executable when its sibling `handle_new_user()`
    was correctly revoked). Timestamped to apply *after* the storage-budget migration above by
    design, since that migration's own header says it assumes this revoke already applies.
  - **None of these four are applied to production.** `docs/status.md` Known Issue #29 tracks the
    full, current list of unapplied migrations (now six, not four — see the #130 entry below and its
    own `attach_media_paths` sibling).
- **`deleteAnalysis()` purges Storage a SECOND time after `markDeleted` commits, closing the orphan
  window #130 narrowed but left open (issue #132; tracked as `docs/status.md` Known Issue #26).**
  `deleteAnalysis()` purges Storage first (A), marks the row deleted second (B) — reversing that
  order is the privacy defect #3 exists to prevent. Since #130 settles a row before its frames
  finish uploading, an in-flight `attach_media_paths` that commits in the gap between A and B still
  sees `deleted_at is null` at that instant, so it **succeeds**, and `safeAttachFrames` correctly
  does not purge on success — then B commits, the redact trigger wipes `media_paths` back to `'{}'`,
  and the frames it just wrote are stranded under a prefix whose purge already ran and reported
  empty. Fixed: `deleteAnalysis()` now runs the *same*, unmodified `purgePrefix()` a second time
  immediately after `markDeleted` actually performs the `deleted_at` transition (`updated === true`
  only — a retry that finds the row already deleted skips this, since there's no fresh gap to close
  on that path). On the common case this costs one `list()` against an already-empty prefix.
  - **New `orphans_remaining` outcome** (200, `{ deleted: true, orphansRemaining: true }`) for when
    the second purge itself throws — by that point the row is unambiguously gone, so `purge_failed`
    (503, retryable) would wrongly imply there's something left to retry. Mirrors
    `delete-account.ts`'s existing outcome of the same name and shape. A non-empty second purge
    (a real orphan caught) logs `delete_analysis.second_purge_caught_orphan` at `warn`; a failed
    second purge logs `delete_analysis.second_purge_failed` at `error` — the only alarm, since the
    HTTP response for `orphans_remaining` carries no actionable remedy. `supabase/functions/
    analysis/index.ts` now wires a real (`console.log`-based) `LogEvent` sink into `deleteAnalysis`
    instead of the default no-op, so these logs actually surface.
  - **Does not close Known Issue #19** (the client's direct soft-delete UPDATE policy bypassing this
    endpoint entirely) — different door, same orphan class, still open.
- **`delete-account` now requires a RECENT reauthentication, not just a valid session (issue #124,
  closing the Known-Issue-#22-adjacent gap flagged when #58 shipped).** A stolen or leaked access
  token is a *valid* token right up until it expires, and can be kept valid indefinitely by a silent
  background refresh (`autoRefreshToken: true`) with no credential ever re-presented — fine for
  ordinary endpoints, not fine for the one irreversible, unrecoverable action in this product.
  - **The mechanism**: Supabase Auth's `amr` (Authentication Methods Reference) JWT claim — an array
    of `{ method, timestamp }` entries, one per real authentication *event*. `isReauthFresh`
    (`supabase/functions/_shared/delete-account.ts`) reads the same already-verified token
    `index.ts`'s `auth.getUser()` call trusted, decodes (never re-verifies — decoding an
    already-trusted token's claims is safe; this module never itself establishes trust) its `amr`
    claim, and requires the most recent non-excluded entry to be within
    `REAUTH_FRESHNESS_WINDOW_SECONDS` (5 minutes) of now. Fails CLOSED on anything it can't
    positively confirm — an undecodable token, a missing `amr`, a stale timestamp — all force
    reauthentication rather than assume it.
  - **Deliberately NOT `iat` (issued-at).** `iat` advances on every silent token refresh even though
    the user did nothing, so an `iat`-based check would be exactly the "looks like a control,
    protects against nothing" trap this issue exists to close — a stolen persisted session could
    keep itself "recently authenticated" forever just by refreshing.
  - **Defensively excludes `token_refresh` from counting as assurance** (`NON_ASSURANCE_AMR_METHODS`)
    even though Supabase's authoritative "currently recognized" `amr` method list doesn't include
    it — this project's own live project has no populated `auth.mfa_amr_claims` rows to empirically
    confirm a refresh never gets stamped in, so the exclusion is there as a hedge against a future
    GoTrue version changing that silently.
  - **The gate runs in `index.ts`, before `createDeleteAccountDeps`/`deleteAccount` are ever
    called** — a stale-session request touches no storage, no rows, no auth user, and gets its own
    401 (`code: 'reauth_required'`), parallel to the existing missing/invalid-JWT 401s. It is
    deliberately not a `{ confirm: "DELETE" }`-style body field — that protects against nothing when
    the attacker already holds the token and composes the request themselves.
  - **Client step-up flow in `app/settings.tsx`**: on `reauth_required`, the screen now looks at the
    session's provider (`getReauthProvider`) and either opens a password re-entry modal
    (`reauthenticateWithPassword`) or re-runs Google sign-in via a warning `Alert` first
    (`reauthenticateWithGoogle`) — an unsupported provider gets an honest "we can't confirm it's
    you, sign out and back in" message rather than silently doing nothing. Exactly one retry loop:
    if the retry *also* comes back `reauth_required` (clock skew, a second concurrent stale
    request), the screen falls through to the ordinary failure copy instead of prompting a second
    time. New, uncertified `Copy.settings.reauth.*` — see the copy-deck section below.
- **A per-user orphan-purge action exists (`supabase/functions/_shared/storage-sweep.ts`, the
  ACTION half of #7's `list_orphaned_media_prefixes` detection RPC) but is WIRED TO NOTHING.** Pure,
  dependency-free orchestration (same discipline as `ai-guard.ts`/`delete-analysis.ts`), fully
  Deno-tested, deliberately not importing `delete-analysis.ts`'s `purgePrefix()` (would couple two
  parallel worktrees' files; the ~30-line list→remove→verify idiom is reimplemented independently
  instead — a follow-up refactor once both branches are stable, not forced here). No scheduled edge
  function calls it, and none exists in this repo — creating one (an `index.ts` under a new
  `supabase/functions/<name>/`, plus a Dashboard Cron Job or `pg_cron`+`pg_net`+Vault trigger) is
  explicitly out of this file's scope. See `docs/status.md`'s new Known Issue for this.
- **The Art. 9 consent gate is now TWO-PHASE (issues #68 restatement + #94: age gate and
  third-party-subject attestation).** `components/consent-gate.tsx` now gates three genuinely
  different things with two different lifecycles, not one:
  1. **Health-processing consent** (#68, unchanged) — once-ever.
  2. **Age confirmation, new (#94)** — "I confirm I'm 16 or older," also once-ever (age only moves
     one direction). `docs/privacy-policy.md` already stated a 16+ minimum; nothing had ever asked
     or recorded it. Shown on the same screen as (1), its own checkbox, its own `consent_key`.
  3. **Subject attestation, new (#94)** — "who is actually in this photo or video." This CANNOT be a
     once-ever grant: the answer is a property of the specific upload, not of the account (the same
     person filming themselves yesterday may film a coached athlete today). Runs on **every**
     presentation with no `hasConsented` short-circuit for a returning user — the previous
     shortcut (skip the whole gate for an already-consented user) is gone, because phase 'subject'
     has no "already answered" state to short-circuit on. Answering "This is me" costs one tap and
     records no new consent (the once-ever block already covers self-processing); answering
     "Someone else" requires a fresh checkbox attestation — including an explicit under-16
     parent/guardian clause — and records its own, distinct `consent_key` every time.
  - `app/capture/index.tsx` now always mounts the gate (it previously could skip straight past a
    returning consented user; that shortcut is structurally incompatible with phase 3).
  - **New, UNCERTIFIED copy**: `consent.upload.age.checkbox` and the whole `consent.upload.subject.*`
    namespace — legally load-bearing (the Art. 9 obligation, the under-16 clause) and not yet
    reviewed by `ux-copywriter` or Ian. See the copy-deck section below.
- **`app/paywall.tsx` + `lib/subscription.ts` built (issue #52) — the M5 dummy paywall, display-only
  by construction.** No tier limit or frame cap is hardcoded anywhere in either file — every
  count/limit shown is read fresh off `GET /functions/v1/quota-status`'s response
  (`lib/subscription.ts`'s own header names this as the exact trap issue #52 warns against by name,
  since Echo V1 once mistakenly believed enforcement lived in a file shaped like this one; it lived
  in the edge function, same as here). A **new regression test locks this**: it fails if any numeric
  tier constant is ever hardcoded in this file again. `purchaseTier()` calls
  `POST /functions/v1/purchase-tier` (#51, itself deploy-gated behind `PURCHASE_TIER_DUMMY_ENABLED`,
  default OFF — see `docs/status.md` Known Issue #21) through issue #46's shared `invokeFunction()`
  wrapper, never `supabase.functions.invoke` directly. Registered as a guarded top-level route in
  `app/_layout.tsx` (it was reachable, unguarded, via file-based routing the moment #52 landed on
  disk — declaring it inside the signed-in `Stack.Protected` block is what actually puts it behind
  the session). New, uncertified purchase pending/success/failure copy (`paywall.alertDismiss`,
  `paywall.plan.*`, `paywall.purchase.*`) — the deck's Screen 10 table only ever specced the three
  static tier cards and the two gate banners, never what happens during/after tapping Upgrade.
- **Home's client-side quota mirror is DELETED, replaced with one `quota-status` call (issues #54 +
  #15).** `app/(tabs)/index.tsx` previously hand-rolled its own `subscriptions` + `analyses` count
  query — a second, independent implementation of the exact counting logic `reserve_analysis` and
  `pace_quota_status` already own server-side, and one that could silently drift from it. New
  `lib/quota.ts` calls `GET /functions/v1/quota-status` through `invokeFunction()` and holds Home's
  pure quota→copy/CTA mapping as testable logic, not inlined JSX. Exhausted-quota CTAs (`"Upgrade to
  analyze"` / `"Upgrade for more"`) now open the real Paywall route instead of doing nothing. Also
  renders issue #6's anti-farm `blocked` state, which the old mirror had no way to represent at all
  (`pace_quota_status` can report `blocked: true` independently of `remaining`) — new, uncertified
  `home.quota.blocked` copy, since the deck never specced this state.
- **Past Analyses tab built (issues #55 + #12) — `app/(tabs)/history.tsx`, a second tab alongside
  Home.** New `lib/history.ts` owns list-fetching, per-row interpretation, and short-TTL signed-URL
  frame-strip minting (mirroring `lib/analysis-result.ts`'s split for the single-result screen);
  `fetchHistoryList` filters `deleted_at is null` server-side AND `readHistoryRow` re-checks it in
  code, never trusting one layer alone. Signed URLs are minted fresh on every screen open (never a
  long-lived cached one) and never logged — a leaked long-TTL link is a durable link to an image of
  someone's body. A row whose media can't be shown (an honestly-empty `media_paths` from a
  non-fatal post-settle frame-upload failure, or a path that fails to sign) folds into a per-row "no
  thumbnail" state rather than crashing the whole list. Delete routes through the same
  `DELETE /functions/v1/analysis/:id` this doc's #132 entry above describes. New, uncertified
  `history.item.a11yLabelNotAssessed`, `history.item.deleteCta`, and `history.delete.error.*` /
  `history.error.*` states the deck never specced (a load-failure state, a not-assessed VoiceOver
  label, a delete-trigger label). Elite's Compare screen (`history.compare.*`) is deliberately NOT
  built here — out of #55's scope.
  - **Tab bar chrome fixed (#12)**: React Navigation's stock cool-gray tab bar sat directly beneath
    this app's warm Gait Plate tokens — invisible with one tab, glaring the moment a second tab made
    the bar a real, always-visible piece of chrome. `(tabs)/_layout.tsx` now sets
    `tabBarStyle.backgroundColor`/`borderTopColor` to `surface.base`/`hairline` and
    `tabBarLabelStyle.fontFamily` to the app's own type family. **Partial, not full**: the root
    `ThemeProvider`'s `DefaultTheme`/`DarkTheme` in `app/_layout.tsx` (screen-transition
    backgrounds, any future header chrome outside `(tabs)`) is still React Navigation's stock
    palette — out of this file's lane, flagged as a follow-up.
- **One `AppState` listener, re-armed token refresh, and foreground reconciliation (issues #10 +
  #64).** New `lib/app-state.ts` is the app's ONE `AppState.addEventListener` call (a
  `started`-guard makes a second real registration fail loud rather than silently double-firing),
  wired from `lib/session-provider.tsx`'s top-level effect. On every transition into `'active'`: it
  re-arms `supabase.auth.startAutoRefresh()` (Supabase's own React Native guidance: the refresh
  ticker does not run while JS is suspended, so a backgrounded app can foreground with an expired
  token and nothing refreshing it) and then notifies every `onAppForeground` subscriber — a pub/sub
  seam, not a second listener, per #64's own text ("Do NOT add a second AppState handler").
  - **`app/analyzing.tsx` is the first (and only) subscriber (#64).** If the app is backgrounded
    (not killed) while still `waiting`, `analyzeFormClient.submit()`'s promise may never resolve
    even though the server-side `analyze-form` invocation runs to completion regardless. On every
    foreground, it re-reads the `analyses` row by `idempotency_key` (never `id` — the DB id isn't
    known client-side until a real response names it, and `reserve_analysis` guarantees at most one
    row per `(user, idempotency_key)`) via a plain RLS-scoped `SELECT` and dispatches
    `succeeded`/`reconciledReleased` accordingly; `'reserved'`, no row, or a read error are all
    no-ops, deliberately never resubmitting. A row read this way is still structurally validated
    (`isPaceAnalysisOutcome`) before being trusted, same as a real response.
  - **Partial, stated plainly: a process KILL, not just background, is NOT recovered.** `lib/
    analyze-form.ts`'s one-shot mailbox does not survive a process restart, so a cold relaunch never
    re-enters this screen with a live `waiting` state to reconcile against — surfacing "your
    analysis finished" after a real kill needs a persisted, cross-restart marker read at app
    startup, which is out of scope here. See `docs/status.md`'s new Known Issue.
- **Connectivity detection built (issue #93) — `lib/connectivity.ts`, `components/offline-banner.tsx`,
  mounted globally in `app/_layout.tsx`.** `@react-native-community/netinfo` backs two shapes:
  `useIsOffline()` (a live hook for the always-mounted banner) and `checkConnectivity()` (a one-shot
  pre-flight check for a network-dependent action, exported but not yet called by anything). Fails
  closed toward "online" on an indeterminate reading (`isInternetReachable: null`) — a false
  "connection is fine" is far cheaper here than a false "you're offline," since the former just lets
  a real network call try and possibly fail normally, while the latter would block a working
  connection outright. Uses the deck's existing `offline.banner`/`offline.blocked.*` copy (already
  specced in `docs/design/copy-deck.md`'s "Cross-cutting — Offline" section; nothing new to mirror
  there).
  - **Partial, stated plainly: the pre-flight gate is not wired in.** `checkConnectivity()` is
    exported and tested but neither `app/analyzing.tsx`'s submit nor `app/capture/index.tsx`'s
    upload handoff calls it — both are owned by other in-flight work. Today only the passive banner
    is live; a user who taps Analyze while offline still watches a spinner before failing, the exact
    gap this issue's pre-flight half exists to close. See `docs/status.md`'s new Known Issue.
- **Sign-in hierarchy, a11y polish, and iOS live-region parity (issues #16, #20, #28, #11).**
  `app/(auth)/sign-in.tsx`: Google is now the accent-styled primary CTA (previously visually tied
  with email); the mode toggle (sign-in ↔ sign-up) now actually opens the email form instead of
  being a dead tap target; busy state, header `accessibilityRole`, autofill hints, and focus
  chaining between fields are all real now. **New `lib/use-announce.ts`** fires
  `AccessibilityInfo.announceForAccessibility` on iOS whenever a message changes to a new truthy
  value — the complement to `accessibilityLiveRegion="polite"`, which React Native maps only to
  `android:accessibilityLiveRegion` and is a silent no-op on iOS, the platform this app ships to
  first. Every dynamic-status text that relied on `accessibilityLiveRegion` alone (an auth error, a
  quota caption) was therefore completely silent to VoiceOver on iOS until this landed. Applied to
  sign-in's error/status text and Home's three quota captions (`app/(tabs)/index.tsx`); every future
  screen with a dynamic status string should call both mechanisms, not `accessibilityLiveRegion`
  alone.
- **Password reset built (issue #81) — there was previously no way back into an email account for a
  user who forgot their password.** New `app/(auth)/reset-password.tsx` (request the email),
  `app/(auth)/update-password.tsx` (consume the recovery link, set a new password), and
  `lib/password-reset.ts` (both Supabase Auth calls, reusing `PASSWORD_MIN_LENGTH` and
  `checkPasswordBreached` rather than re-deriving either). `requestPasswordReset` is deliberately
  enumeration-safe: the success copy (`auth.reset.request.success.*`) is identical whether or not
  the submitted email has an account — the *only* success message that flow can produce.
  - **Critical detail worth recording: a recovery session IS a session.** The instant the emailed
    link's PKCE exchange resolves, `session` goes non-null — and `app/_layout.tsx`'s
    `Stack.Protected guard={!!session}` would flip on exactly that transition, excluding the whole
    `(auth)` group from the navigator (`Stack.Protected` omits a screen, it does not merely hide it)
    and ejecting the user into `(tabs)` before they had ever set a new password, making the reset
    screen unreachable at precisely the moment it's needed. Fixed: `lib/session-provider.tsx` now
    tracks a `PASSWORD_RECOVERY` auth event as `isPasswordRecovery` (cleared on `SIGNED_OUT` or once
    `update-password.tsx` commits the new password), and both `Stack.Protected` guards in
    `app/_layout.tsx` now read `!!session && !isPasswordRecovery` / `!session || isPasswordRecovery`
    instead of the bare `!!session`/`!session` they used before.
  - New, uncertified `Copy.auth.reset.*` — not in the copy deck, needs review. See the copy-deck
    section below.
- **`.maestro/` E2E flows added for the M7 no-dead-end gate (issue #86) — UNVERIFIED, never
  executed.** Four flows (`happy-path`, `dead-end-offline`, `dead-end-quota-exhausted`,
  `dead-end-analysis-failure`) plus shared subflows (`sign-up`, `grant-consent`). Blocked on issue
  #84 (no dev build exists yet — Maestro drives a real app binary, not Metro/Expo Go). Written
  against the documented screen contracts, not run against a live build; treat these as an unrun
  draft, not a passing gate, until #84 unblocks a real execution.

## 2026-07-13

- **`analyze-form` now SETTLES BEFORE IT UPLOADS, making a 'reserved' row provably frameless
  (issue #130) — new migration written, NOT APPLIED to the live project.** `settle_analysis` is
  called with four args (no `p_media_paths`; the RPC keeps the parameter, we simply have nothing to
  pass it) as soon as the model returns a deliverable outcome. Only then do the frames go up, and a
  new `service_role`-only RPC — `public.attach_media_paths`
  (`supabase/migrations/20260713140000_attach_media_paths.sql`) — records where they went. It carries
  the same namespace guard `settle_analysis` does (it is the second, and only other, writer of
  `media_paths`), plus `status = 'delivered' and deleted_at is null` and a write-once
  (`cardinality(media_paths) = 0`) guard, and it **returns** its four refusal reasons rather than
  raising.
  - **Establishes the invariant: a `'reserved'` row can never have frames.** That is what makes
    `sweep_stale_reservations()` (#47) correct with **no** Storage access — a swept row has nothing
    under its prefix by construction. No `pg_net`, no Vault secret, no scheduled edge function, which
    is exactly the wiring that migration's Design Decision 3 declined to introduce. Recorded as
    **Design Decision 5** in `20260713130000_stale_reservation_sweep.sql` (comment only — its SQL is
    unchanged) so the next reader holding #130 does not helpfully add a purge back.
  - **Closes two orphan paths, not one.** The crash case #130 describes (the isolate is killed
    between the upload and the settle, stranding a `'reserved'` row and its frames), **and** a second
    one it did not: a **refused** settle. A late replay or concurrent duplicate returns
    `not_reserved_or_not_found` for a row whose frames were *already* in the bucket; that row is
    released by `release_analysis`, never by the sweep, so a purge bolted onto the sweep could never
    have reached those objects. No crash was required to trigger it.
  - **The delete-during-upload window is NARROWED, NOT CLOSED — see Known Issue #26.** Settling first
    makes the row `'delivered'` and therefore deletable while frames are still uploading. When the
    attach lands *after* the delete marks the row, `attach_media_paths` refuses with
    `row_deleted`/`not_found` and `safeAttachFrames` purges the prefix it just wrote — that half is
    closed. But `deleteAnalysis` purges Storage **before** it marks the row, and an attach that
    commits in the gap between those two steps still **succeeds** (the row is not yet marked), so
    nothing purges, and the redaction trigger then wipes `media_paths` on `markDeleted`. Frames
    written into that gap are stranded. The known fix — a second `purgePrefix` after `markDeleted`
    commits — is not implemented.
  - **`safeAttachFrames` cannot throw.** Everything after the settle is non-fatal: by then the
    analysis is delivered and the quota is spent, so a bookkeeping miss must never become a 500 the
    user cannot retry — a failure the old settle-last ordering made structurally impossible and this
    one has to close by hand.
  - **Accepted cost, stated rather than hidden**: a `'delivered'` row can now carry an empty or short
    `media_paths`, which shortens the Past Analyses frame strip (#55) for that analysis. `media_paths`
    has always been the display list, never the deletion authority — purge walks the prefix.
  - **Not applied to production.** This is now a **fourth** unapplied migration (#131 tracks the
    other three).
- **Stale `'reserved'` analyses rows now have a backstop sweep (issue #47) — migration written,
  NOT APPLIED to the live project (confirmed via `supabase migration list`).**
  New `supabase/migrations/20260713130000_stale_reservation_sweep.sql` adds
  `public.sweep_stale_reservations()`, scheduled every 5 minutes via `pg_cron`, to reclaim a row
  left `'reserved'` when an `analyze-form` invocation is killed (timeout/OOM/deploy) before its
  own `finally` block can release it — the backstop `docs/status.md` Known Issue #14 asked for.
  Threshold: 15 minutes, derived from `analyze-form`'s own 105s self-imposed deadline and
  Supabase Edge Functions' 150s platform wall-clock kill (6x margin over the platform limit).
  - **Swept rows release with a new `release_reason = 'stale_sweep'`**, added to the existing
    CHECK constraint but deliberately kept OUT of `pace_is_farming_signal`'s vocabulary, so a
    swept row can never count toward the 3-strike anti-farming cap (#6) — the exact farming
    vector `docs/status.md` Known Issue #16 flagged this fix against.
  - **This migration reclaims the DB row only — it does NOT purge the swept row's Storage
    prefix.** Known Issue #16's original ask was that the sweep "must also purge the storage
    prefix, not just flip the row's status"; that half is still open — frames from a crashed
    invocation still need a separate purge path.
  - **Race-safe against a live `settle_analysis`/`release_analysis`** via `FOR UPDATE SKIP
    LOCKED` plus the same "conditional UPDATE, no advisory lock" idiom those RPCs already use.
    Batched (`p_batch_limit` default 500) so an incident leaving many rows stale at once can't
    make one sweep run try to lock an unbounded number of rows.
  - Runs as `pg_cron` calling the SQL function directly, not a scheduled edge function — pure DB
    bookkeeping needs no HTTP hop, and provisioning a Vault-stored credential for a
    `pg_net`-invoked edge function from a migration file isn't safe to do in-repo.
  - **24 new Deno tests**: a TypeScript model of the sweep's contract (fresh/stale/settled/
    released rows, the race with a concurrent settle in both directions) plus migration-text
    invariant tests that read the actual SQL.
- **`delete-account`'s storage sweep is bounded-concurrency and resumable, closing the
  "heaviest accounts become permanently undeletable" gap (issue #125).** The account-level purge
  used to hand the whole `{userId}/` prefix to `purgePrefix()` in one call, which recurses into
  every `{analysis_id}/` sub-prefix ONE AT A TIME. A long-lived Elite account (30 analyses/
  period) accumulates hundreds of sub-prefixes, and since the purge is deliberately blocking, a
  sweep that times out deletes nothing — a GDPR erasure failure that lands hardest on the users
  with the most data.
  - **New `purgeAccountPrefix()`** in `supabase/functions/_shared/delete-account.ts` enumerates
    the account root, then purges each analysis sub-prefix through the UNCHANGED `purgePrefix()`
    via a new `mapWithConcurrency()` helper, bounded to `ACCOUNT_PURGE_CONCURRENCY` (8) in-flight
    purges at once instead of sequentially.
  - **Soft wall-clock budgets** (`ACCOUNT_PURGE_DEADLINE_MS`, 60s for the main purge;
    `ACCOUNT_POST_DELETE_SWEEP_DEADLINE_MS`, 20s for the post-delete race sweep) stop dispatching
    new sub-prefix purges once spent and fail closed as the EXISTING `purge_failed` outcome — no
    new response contract, so `lib/delete-account.ts`'s hand-mirrored error codes don't drift.
  - **Checkpointing is free, not built**: each sub-prefix purge independently
    `list → remove → verify`s before the next starts, so a timed-out retry re-enumerates the
    account root and finds strictly fewer sub-prefixes (emptied ones vanish from the listing)
    rather than redoing the whole sweep.
  - **8 new Deno tests** (`mapWithConcurrency`'s bound/order/fail-fast properties, a
    40-analysis bounded-concurrency proof, a budget-exceeded test, a resume-after-timeout test);
    3 existing ops-array assertions updated since removes now happen per sub-prefix instead of
    once per account.
  - Closes the half of `docs/status.md` Known Issue #22 that filed this out of scope as "the
    sweep is wall-clock-bound but not checkpointed" — that concern is now closed. `delete-account`
    itself is still not deployed, and issue #124 (no re-authentication) is still open, unaffected
    by this fix.
- **The Supabase client is now typed against the live schema (issue #32)** — new
  `lib/database.types.ts`, generated via `supabase gen types typescript --project-id
  vputdomdlknvthnzritt` and cross-checked against the Supabase MCP's `generate_typescript_types`
  for the same project (identical for the public schema). `lib/supabase.ts` now passes it as
  `createClient<Database>(...)`, so every `.from(...)`/`.rpc(...)` call site is checked against
  real column/RPC shapes at compile time instead of resolving to `any`.
  - Verified the generic is actually active (not silently falling back to untyped) by
    temporarily probing a bad table name and a malformed RPC arg list — both produced real `tsc`
    errors, then were reverted.
  - Every existing query call site (`app/(tabs)/index.tsx`, `app/settings.tsx`,
    `app/result/[id].tsx`, `lib/consent.ts`) type-checked clean with zero shape changes needed.
    The one real edit: `app/result/[id].tsx` drops its `as AnalysisRow` cast now that the
    generated `analyses` Row type is structurally proven to match `AnalysisRow`'s hand-written
    shape — `tsc` now verifies that assertion on every build instead of trusting it blindly.
  - **Known drift, left untouched (read-only against the live DB, out of scope for this issue)**:
    `pace_quota_status` (20260712233000) and `pace_purchase_tier` (20260713120000) are not yet
    pushed to the linked project (confirmed via `list_migrations`), so neither appears in the
    generated types. Both edge functions that call them already carry their own deploy-gated
    header comments acknowledging this.
- **A shared `invokeFunction()` wrapper replaces ad hoc `supabase.functions.invoke()` unwrapping
  (issue #46)** — `supabase.functions.invoke()` wraps every non-2xx response in a generic
  `FunctionsHttpError` whose `{ error, code }` body is only reachable via `await
  error.context.json()`; every caller had to know that, or silently lose the server's error code
  (e.g. `quota_exceeded`, which #52's paywall depends on). New `lib/functions-client.ts`'s
  `invokeFunction<T>()` does that unwrap once and returns a discriminated result: `'http'` (a
  parsed `{ error, code }` body), `'network'` (`FunctionsRelayError`/`FunctionsFetchError` — no
  body was ever produced), or `'malformed'` (an HTTP error whose body didn't match the documented
  contract). It never rejects.
  - Deliberately does NOT validate `code` against any one endpoint's known set — each endpoint's
    codes are disjoint (`delete-account`'s three share nothing with `analyze-form`'s or
    `purchase-tier`'s); narrowing `code: string` into a specific union is each call site's own
    job.
  - `lib/delete-account.ts` — the only existing real `supabase.functions.invoke` call site — is
    migrated to it, dropping its own inline `FunctionsHttpError` unwrap; its endpoint-specific
    error-code narrowing (`isServerDeleteAccountErrorCode`) and 200-body parsing stay, since
    those are endpoint-specific.
  - 12 new Jest tests in new `lib/__tests__/functions-client.test.ts`.
- **New `control.border` interactive-boundary theme token closes a WCAG 1.4.11 gap (issue
  #96)** — every non-accent button/input/checkbox relied on `hairline` (~1.22–1.49:1 across
  surfaces) as its only visible edge, below the 3:1 floor WCAG 1.4.11 sets for a UI-component
  boundary. `Colors[scheme].control.border` (same hue/sat family as `hairline`, lightness moved
  until it clears 3:1 against every surface in both schemes: 3.06–3.64:1) is a genuinely new
  role, not a re-tune of the decorative `hairline` rule. Applied to
  `components/consent-gate.tsx`'s checkbox border and, in this integration, `app/(auth)/
  sign-in.tsx`'s secondary/email buttons and text input (the other control in the repo with the
  same bug).
  - `constants/__tests__/theme-contrast.test.ts` gained a real regression guard, not just new
    assertions: it asserts `hairline` itself STAYS below 3:1 (computed from the live export, not
    a hardcoded ratio) and that `control.border !== hairline` per scheme, so the token can never
    silently collapse back into the rule it replaces. 69 → 83 assertions.
- **`npm run typecheck` now generates `.expo/types/router.d.ts` itself (issue #118)** — `tsc
  --noEmit` relies on this gitignored, dev-server-generated file for expo-router's typed routes;
  nothing in the typecheck/lint/test gate produced it, so a fresh clone (or CI checkout) either
  silently disabled route type-checking (file absent → permissive fallback) or failed on stale
  route unions left over from a previous dev-server session — exactly what happened merging
  #113–#117. Fixed via `npx expo customize tsconfig.json`, Expo's own non-interactive codegen
  entry point for this file (confirmed byte-identical to what `expo start` produces, and a no-op
  against the committed `tsconfig.json`). New `"generate:routes": "expo customize
  tsconfig.json"` script; `"typecheck"` now runs it first. Verified with `rm -rf .expo && npm
  run typecheck`.
- **The repo's first commit gate lands: `.github/workflows/ci.yml` (issue #82)** — until now,
  `npm run typecheck && npm run lint && npm test` (CLAUDE.md's pre-commit rule) was enforced by
  convention only; a PR that broke the build could merge exactly as easily as one that didn't.
  Runs on push/PR to `main`: `npm ci`, Node 24 (matching `hibp-canary.yml`'s pin — no
  `.nvmrc`/`engines` field exists to defer to instead), Deno 2.9.2 (matching the local install
  CLAUDE.md documents), then typecheck → lint → test, cheapest checks first. `concurrency`
  cancels a superseded run for the same ref; `permissions: contents: read` only (never
  comments/labels/writes back). Distinct from the existing `hibp-canary.yml`, which is a daily
  scheduled canary, not a PR gate.
  - Deliberately provisions no dummy `.env` — verified locally that `expo lint`/`npm test` both
    exit clean with no `.env`/`supabase/functions/.env` present.
- **`npm run web`'s SSG crash fixed at the real root cause: `lib/secure-storage.ts`, not
  `SessionProvider` (issue #119)** — `expo export --platform web` prerenders every route in
  Node, where `window` doesn't exist. `createSecureSessionStorage`'s web branch returned bare
  `AsyncStorage` unconditionally, and AsyncStorage's web implementation touches
  `window.localStorage` with no guard; `supabase-js`'s `GoTrueClient` reads from it eagerly at
  client construction (before any React effect runs), so every route crashed with
  `ReferenceError: window is not defined` the instant `SessionProvider`'s module tree loaded —
  the crash surfaced there, but the bug was one layer down, in storage. Fixed: the web branch
  now falls back to a no-op storage (an honest "no session" answer, since a prerendered page
  genuinely cannot see the browser's localStorage) when there is no `window`, and still returns
  the real localStorage-backed `AsyncStorage` once hydrated in an actual browser. 4 new Jest
  tests in `lib/__tests__/secure-storage.test.ts` (25 total, up from 21).
- **Killed the false "actual sampled timestamps" claim at its source (issue #126, follow-up to
  #112)** — `planning/03-engineering-requirements.md` was the *original* document
  `docs/architecture.md` inherited the claim from, before #112 corrected that downstream copy; the
  source itself was left standing and would have re-infected the docs the next time someone did
  their homework from `planning/`. Corrected both instances (the `analyze-form` "Inputs" step and
  the "Frame pipeline" section) to say what `lib/frames.ts` actually records: the timestamp the
  client *requested* from `expo-video-thumbnails`, not the time it decoded — Android snaps to the
  nearest keyframe and exposes no PTS, iOS discards `AVAssetImageGenerator`'s `actualTime`, so the
  real intervals can differ from the requested ones and are not verified to be evenly spaced.
  - **A second surviving copy was found and fixed** in `docs/mvp-build-prompt.md`'s "How the
    analysis engine must work (ground truth — read twice)" digest, same false claim, same fix.
  - **Deliberately left alone**: `docs/change_log.md`'s own historical entries (they correctly
    narrate the past claim as something that *got* fixed, not something still true) and
    `docs/superpowers/plans/2026-07-12-frame-upload-ordering.md` (a dated record of what was
    drafted into `docs/architecture.md` at the time, not a live assertion).
    `knowledge/pace_framework.md`'s "evenly-spaced frames" clause is certified content — out of
    scope here, same as it was in #112 — and stays neutralised at the prompt layer.
- **Sign-in no longer claims a server attempt on a purely local validation failure (issue
  #17)** — `handleEmailSubmit` in `app/(auth)/sign-in.tsx` collapsed every client-side check
  (empty email, empty password, malformed email — none of which ever reach the network) into
  `Copy.auth.error.generic`, "Sign-in didn't go through. Try again." — a lie, since nothing was
  ever sent, and the same string said "Sign-in" even in signUp mode. New `validateSignInForm()`
  in `lib/auth-errors.ts` (mirroring `mapAuthError`, which only ever handles a caught server
  response) returns one of three new field-specific, honest, mode-neutral strings —
  `Copy.auth.error.emailRequired` / `.emailInvalid` / `.passwordRequired` (new in
  `constants/copy.ts`, delimited as NOT copy-certified) — or `null` if the form is well-formed
  enough to submit. Guaranteed, and tested, to never overlap with any string `mapAuthError` can
  produce from a real server rejection. 7 new Jest tests in `lib/__tests__/auth-errors.test.ts`
  (24 total), including an explicit "never produces a string mapAuthError can also produce" lock.
- **Frame timestamps are told the truth, end to end (issue #112)** — `expo-video-thumbnails`
  records the time the client *requested*, never the time it decoded (Android snaps to the nearest
  keyframe and exposes no PTS; iOS computes `AVAssetImageGenerator`'s `actualTime` and discards
  it). Cadence and Elasticity are the two PACE pillars derived from motion over time, so intervals
  presented as exact would have the model reason about a rhythm the runner does not have — and
  produce confident, fluent, wrong advice without crashing. `lib/frames.ts` was already honest; the
  gap was in what the prompt let the model *conclude*.
  - **`pace_framework.md`'s two timing clauses are now amended at the prompt layer**
    (`TIMESTAMP_RULES` in `supabase/functions/_shared/analyze-form-prompt.ts`), never by editing
    the certified file — the same mechanism #41 used for #40's runner's-note clauses. The certified
    *"**Only if frame timestamps are known** may you estimate a cadence *range*"* is quoted back and
    re-read as **"known approximately"** (a wide, labelled range is the most it can license; a point
    figure never was), and *"Across evenly-spaced frames…"* as **"not reliably evenly spaced"**
    (torso height *change* is visible evidence; its *rate* is not). The amendment can only tighten.
  - **The hedge now has to reach the runner.** Any Cadence/Elasticity judgement leaning on the
    timing must carry the uncertainty into the user-visible `feedback` — the runner sees only
    `score`, `band`, and `feedback`, so a hedge the model keeps to itself is not a hedge.
  - **Tests** (`analyze-form-prompt.deno.test.ts`, 30 → 33): the amendment is asserted present at
    every tier, and both quoted certified clauses are asserted to still exist in the shipped bundle
    **byte-for-byte** — so a re-certification that rewords them fails the build rather than leaving
    an amendment aimed at a sentence that no longer exists.
  - **Docs**: `docs/architecture.md`'s `analyze-form` flow no longer promises "actual sampled
    timestamps" (corrected under #41; this pass adds the clause-amendment and runner-visible-hedge
    bullets), and `lib/frames.ts`'s header now points at the prompt-layer mitigation instead of a
    doc requirement that no longer exists.
  - **Not done, on purpose**: no evenly-spaced timestamps computed and presented as actual (that
    looks precise, is wrong, and signals nothing), and no fork of `expo-video-thumbnails`. Real
    timestamps remain the long-term option in #112.
- **`POST /functions/v1/purchase-tier` built (issue #51, M5 gate)** — the dummy purchase, and the
  only legitimate writer to `public.subscriptions`. Contract deliberately identical to V2.2's
  (`{ tier, source: "dummy" }` → `{ tier, periodStart, periodEnd }`) so v2 can swap `source` to
  real receipt verification without changing its shape; a non-`dummy` source is refused today, so
  that swap must be a conscious code change. Written and Deno-tested (28 tests), **not deployed**;
  its `pace_purchase_tier` migration is written but **not applied**.
  - **No client-writable INSERT/UPDATE policy was added to `subscriptions`** — the tier write goes
    through a `service_role`-only SECURITY DEFINER RPC. Echo V1 shipped exactly such a policy (any
    user could self-grant elite for free with one REST call) and had to remove it; this endpoint is
    the replacement for it, and a test asserts on the migration's own text that it never grows one.
  - **Repurchase is idempotent, and that is a security property, not a nicety.** `purchased_at` is
    the period anchor `pace_current_period` derives every quota window from, and both
    `reserve_analysis` and `pace_quota_status` count usage as
    `created_at <@ pace_current_period(purchased_at, now())`. Re-anchoring on each call would slide
    the window and silently reset `used` to 0 — an *unlimited free-analysis exploit*, since the v1
    purchase is a free, unlimited dummy. So `purchased_at` is written only by the INSERT and is
    absent from the UPDATE's SET list: repurchase, upgrade, downgrade, and reactivation all
    preserve the anchor, which also makes `pro → elite → pro` tier flapping worthless.
  - Caller id comes from the verified JWT (`auth.getUser()`), never the request body. No tier
    limits, frame caps, or prices live in this function — `reserve_analysis` remains the sole
    enforcement point, and prices stay display-only in `docs/design/copy-deck.md`.

- **`purchase-tier` hardened same day after a security audit on PR #123** — a HIGH finding: once
  deployed to this project's open-signup state, the endpoint was a $0 self-grant of the highest
  paid tier reachable by anyone on the internet (throwaway signup → `tier=elite` → 30 analyses
  instead of free's 1 → burn quota to trip the shared `ai_ops_config` daily spend cap → every real
  user's `analyze-form` denied for the rest of the day → repeat). Fixed with a server-side
  deployment gate, not a comment: the function now returns an indistinguishable `404` for every
  request unless `PURCHASE_TIER_DUMMY_ENABLED` is exactly `"true"` in its environment — checked
  before the HTTP method, before auth, before anything about the request is read. **This variable
  must never be set in production secrets** (`docs/status.md` Known Issue #23, a release blocker),
  with an optional `PURCHASE_TIER_ALLOWED_USER_IDS` tester allowlist as further defense-in-depth
  once the gate is on. Also added: basic per-user rate limiting (`rate_limited` outcome, 429 — a
  repeat call from the same user within 3s of their own last write is a no-op; honestly scoped in
  the code comments as *not* mitigating the actual amplification vector, which uses one account per
  call — CAPTCHA/signup throttling, Known Issue #12, is the real lever there). Two MEDIUM/LOW
  findings closed in the same migration: revoked the default Supabase `grant all` to
  `authenticated`/`anon` on `subscriptions` and `profiles` (no live exploit — RLS already denied
  those verbs — but TRUNCATE isn't subject to RLS at all, mirroring the fix already applied to
  `consents`); and removed `pace_purchase_tier`'s optional `p_as_of` parameter entirely (a
  caller-suppliable period anchor, unreachable today but one careless edit from reopening the exact
  re-anchoring exploit the function exists to prevent). 9 new tests (37 total), including
  mutation-verified migration-text invariants for all three fixes.
- **`POST /functions/v1/delete-account` built (issue #58)** — in-app account deletion, the App
  Store submission blocker (Guideline 5.1.1(v)) and the hard gate on publishing the privacy policy
  at all (Known Issue #15). **Written and Deno-tested; NOT deployed** — deployment is Ian's.
  - **Added** `supabase/functions/delete-account/index.ts` (HTTP + JWT glue),
    `supabase/functions/_shared/delete-account.ts` (all decision logic, no Deno/`npm:` import), and
    `supabase/functions/_shared/delete-account-client.ts` (the service-role client factory) — the
    same three-way split `analysis/index.ts` (#57) uses, for the same reason.
  - **Delete order is the design: storage objects → rows → auth user.** Deleting the auth user
    first cascades every row away, and `storage.objects` has no FK to `auth.users` — so every
    frame would survive, un-enumerable and un-ownable, on the one code path whose whole purpose is
    to leave nothing behind. A test asserts the observed call order.
  - **Reuses #57's purge rather than re-implementing it.** `purgePrefix()` in
    `_shared/delete-analysis.ts` is now exported (a strictly additive change — that file's logic is
    otherwise untouched) and swept over `{user_id}/` instead of `{user_id}/{analysis_id}/`. It
    already recurses, paginates, and re-lists to verify the prefix is actually empty. The
    nested-prefix trap — a flat `list(user_id)` returns pseudo-directories and removes **nothing**
    while reporting success, which is V1's `delete-user` bug — now has exactly one place it can be
    wrong. Verified by mutation: deleting the recursion makes the zero-orphans test fail.
  - **Purge by prefix, never by `media_paths` or by walking rows** — so it also sweeps frames left
    by rows soft-deleted through #2's client UPDATE policy (**Known Issue #19**) and by
    `analyze-form` runs that crashed before `settle_analysis`. Neither is enumerable from the rows.
  - **The purge is blocking, not best-effort**: a Storage failure deletes nothing at all (no rows,
    no auth user) and returns a retryable `503`. Echo V1's pattern could delete the auth user while
    a failed `remove()` left frames un-ownable; that is now unreachable by construction. A **second
    sweep after the auth delete** closes the concurrent-upload race, and reports `orphans_remaining`
    (a `500`, logged at error level with the prefix) if it cannot.
  - **The consent trail is purged — explicitly, in code, not by inheriting the FK cascade.** The
    `consents` migration demanded a conscious purge-vs-retain-for-defence choice; the choice is
    purge, because a consent row keyed only on a `user_id` we can no longer map to a person is not
    "necessary for the defence of legal claims" (Art. 17(3)(e)) — it cannot defend anything — and
    making it usable would mean retaining a re-identifiable token of someone who asked to be
    forgotten. Full reasoning in `_shared/delete-account.ts`'s header and `docs/architecture.md`.
    `public.ai_call_log` still survives with its FKs nulled, as designed.
  - **20 Deno tests** (`_shared/__tests__/delete-account.deno.test.ts`) asserting from the
    **Storage side**, not the row side: zero orphaned objects after a full delete (issue #59's core
    assertion), nested-prefix recursion, pagination, the delete order, a mid-purge failure leaving
    the auth user alive, the consent-trail decision, cross-user isolation, retry convergence, and
    the boundary logs.

- **`delete-account`'s response contract fixed, on the same PR (#121), after security/code
  review.** CORRECTS the entry directly above: `orphans_remaining` no longer returns a `500` with
  a body carrying both `deleted: true` and `error`/`code`. Two problems with the original shape:
  it violated `docs/architecture.md`'s own contract that every non-2xx body is a clean
  `{ error, code }` (this body was neither shape, it was both), and it was unconsumable by any
  correct client — by the time `orphans_remaining` fires, storage, every row, AND the `auth.users`
  record are ALL already deleted, so a client reporting "still active, please retry" off a non-2xx
  would be false on every clause (the account is not active; retrying can only `401`; the user
  would sit on a dead access token indefinitely).
  - **New matrix** (also in `docs/architecture.md`'s "Current — `POST /functions/v1/delete-account`"
    section): `deleted` and `orphans_remaining` are both `200` — `orphans_remaining` adds
    `orphansRemaining: true` to the success body, with no retry affordance, because there is
    nothing left to retry. `purge_failed`/`rows_failed`/`auth_delete_failed` stay `503` with a
    clean `{ error, code }` and nothing else. The ops alarm — the exact `{user_id}/` prefix a human
    must go clean for `orphans_remaining` — now lives **only** in the existing error-level
    structured log, since the HTTP response carries no user-actionable remedy.
  - **`DeleteAccountErrorCode`** (`'purge_failed' | 'rows_failed' | 'auth_delete_failed'`) is now
    exported as its own discriminated union from `_shared/delete-account.ts`, replacing a bare
    `code: string`. The original bug survived because nothing forced a switch over `code` to be
    exhaustive; a stringly-typed code let a client (or this file's own tests) silently ignore a
    case.
  - **5 new/rewritten Deno tests**, bringing the suite to 25: `orphans_remaining` is asserted as a
    `200` with the success-plus-flag body, the full status/body matrix is asserted end to end, and
    a new invariant test asserts — for every outcome — that no response body ever carries both
    `deleted` and `error`/`code`.
  - Known Issue #21 rewritten (not just appended) to state plainly that `delete-account` does not
    work end to end until **both** this issue and #122 (the client's binding swap off its current
    mock) ship — read alone, neither issue said that. Issues #124 (no re-authentication) and #125
    (wall-clock bound, not checkpointed) filed separately and are explicitly out of scope here.
- **M5 Settings screen built (issue #53); sign-out failure is no longer silent (issue #27, closed)**
  — design-brief screen 11 + copy-deck § Screen 11.
  - **Added** `app/settings.tsx` as a **top-level pushed route**, not a tab, following
    `docs/architecture.md`'s planned route tree (which lists `paywall, settings` at root and nests
    only `(tabs)/history`). Declared as a `Stack.Screen` inside `app/_layout.tsx`'s signed-in
    `Stack.Protected` block — load-bearing, not cosmetic: an *undeclared* route file renders as an
    always-available **unguarded** top-level screen, and this one hosts sign-out and account
    deletion. Reached from a "Settings" link in Home's header.
  - **Sign-out moved off Home and fixed (#27)**: `app/(tabs)/index.tsx`'s temporary M1 stub
    (`void supabase.auth.signOut().catch(() => {})`) is **gone**. New `lib/sign-out.ts` awaits the
    call, inspects the returned `{ error }`, folds a thrown failure into the same result, and
    **never rejects**. auth-js clears the local session either way, so a failed *global* revoke
    cannot be undone — the screen therefore reports it through a native `Alert` (which outlives the
    screen the route guard is already unmounting) telling the user they are signed out **here** but
    possibly not **everywhere**, with the only recovery that actually works. Tested, including the
    two silent-failure regression locks.
  - **Delete account (entry point for #58)** — new `lib/delete-account.ts`: a typed, injectable
    `DeleteAccountClient` seam matching the documented `POST /functions/v1/delete-account` contract
    (`{ deleted: true }` / `{ error, code }`), bound to a **dev mock**, exactly as `lib/analyze-form.ts`
    (#80) did for the then-unbuilt `analyze-form`. ⚠️ **The purge is mocked — tapping delete does not
    yet delete anything.** #58 swaps one binding line. Confirmation copy is the deck's, verbatim.
  - **Privacy (issue #68 restatement + withdrawal)** — Settings repeats the pre-upload disclosure
    (`settings.privacy.body`) and wires the **consent-withdrawal** path to `lib/consent.ts`'s
    `withdrawConsent`, which had been built and waiting for a caller. `hasConsented` throws on a
    failed read and this screen honours that: it renders "couldn't load your consent status" rather
    than guessing, since rendering "withdrawn" would be indistinguishable from a user who never
    consented and would hide the outage.
  - **The privacy policy is NOT linked.** `docs/privacy-policy.md` still carries its `DO NOT PUBLISH`
    guard (unresolved data-controller identity), so there is no URL — and the draft is **not**
    rendered in-app either, since that would show users placeholder legal identity and rights
    promises they could not exercise. The screen shows an honest pending state and points at the
    disclosure that *is* certified and true today. No URL was invented.
  - **Tier is display-only** (read from `subscriptions`, never computed) with real loading and error
    states — a failed read never silently renders as "Free".
  - **New, UNCERTIFIED copy** added to `constants/copy.ts` in a delimited block (sign-out failure,
    delete failure, consent withdrawal, the policy pending state, two screen-reader Retry labels).
    It is **not** in the copy deck and needs Ian's review before it ships.
  - Not built: `settings.plan.cta` ("See plans") and `settings.restorePurchases.cta`. Both point at
    a Paywall (#52) and an IAP flow that do not exist; adding them would build a dead end.

- **Same-day security audit on PR #122 found three real defects in the Settings work above; fixed
  in place, same branch, before merge.**
  - **F1 (CRITICAL) — `lib/delete-account.ts`'s mock binding had no owner to ever swap it for a
    real client.** #58/#121's own file list is entirely under `supabase/functions/` and never
    touches `lib/`, so "delete account" would have shipped calling a mock that always reports
    success, purging nothing — a false claim of erasure (App Store Guideline 5.1.1(v), GDPR
    Art. 17), invisible to the test suite (its own "is STILL THE MOCK" assertion passed in exactly
    that state). Fixed: `lib/delete-account.ts` now implements a real
    `supabase.functions.invoke('delete-account')` client against the settled response contract
    (`purge_failed`/`rows_failed`/`auth_delete_failed` → `503`, retryable; `orphans_remaining` →
    `200`, a **success**). The mock is kept for tests only and now throws if constructed outside
    `__DEV__`, so a release build cannot silently fall back to it. The regression-lock test was
    rewritten to assert the OPPOSITE of what it originally asserted — that the shipped binding is
    the real client, not the mock.
  - **F2 (HIGH) — the failure copy asserted an invariant that is false.** The original copy claimed
    "the account is still active" on ANY delete failure, reasoning that the auth user is deleted
    last. That's wrong for `orphans_remaining` (the account IS gone — now handled as a success, not
    an error) and wrong for `auth_delete_failed` (storage and rows are already gone; only the
    sign-in record survives). Fixed: `orphansRemaining` now signs the user out with its own honest
    "account deleted, contact support if concerned" copy and no retry offered; the three retryable
    failure codes share one honest message that claims only what's true across all of them ("some
    data may already have been removed"), never a per-code claim the client can't back up.
  - **F3 (MEDIUM-HIGH) — the #27 sign-out fix ruled out a state that turns out to be real.**
    `lib/sign-out.ts` claimed auth-js clears the local session unconditionally on any failure.
    Verified false against the installed `@supabase/auth-js` source: an expired-access-token-plus-
    failed-refresh takes an early return that leaves the local session **fully intact**. The
    original fix would have told a user "signed out here" while they sat in a fully authenticated
    app — the exact shared/stolen-device failure #27 exists to prevent. Fixed: `signOut()` now
    re-checks `supabase.auth.getSession()` after any failure and reports a genuine third state,
    `stillSignedIn`, with its own copy and — unlike the `globalRevokeFailed` case — a real retry
    (there is still a local session to authenticate a retry with). Fails closed toward
    `stillSignedIn` on its own read error, same direction as `lib/consent.ts`'s `hasConsented`.
  - Both `app/settings.tsx` handlers now switch exhaustively on the relevant result type (sign-out
    reason; delete-account success outcome; delete-account error code), each with a `never`-typed
    default branch, so a future outcome the compiler doesn't know about fails to build rather than
    silently falling through to the wrong copy.
  - `docs/status.md` Known Issue numbering: renumbered this work's issues to **#22**/**#23** — #121
    (the `delete-account` edge function's own PR) independently claimed **#21** for a related but
    distinct caveat; both PRs adding a "#21" would have collided on merge.
- **M4 review fixes (two MEDIUM findings on PR #127, both fixed in place):**
  - **A suppressed retry no longer charges an anti-farming strike for our own degradation.**
    `classifyReleaseReason` returned `'validation_failed'` (the one farming signal, counted toward
    the 3-strike cap) whenever every response was a content failure — *including when only one
    attempt ran*. But the flow **skips** the retry when the deadline is nearly spent and its spend
    gate **denies** it when the daily cap is near or the breaker is open. So a model that degraded
    to prose exactly when the breaker tripped under load would strike three unlucky Free users out
    of their one lifetime analysis in 24h, for an outage that was entirely ours (the exact harm
    issue #6 exists to close). Fix: `decideOutcome`/`classifyReleaseReason` now take an explicit
    `retryRan` flag threaded from the flow; `'validation_failed'` requires the retry to have
    **actually run** and *still* only produced content failures. A lone content failure with a
    suppressed retry releases as `'model_error'` (server fault — refunds quota, does not tick the
    counter). Tests cover all three sub-cases: retry skipped (low budget), retry gate denied, and a
    genuine two-attempt farmer.
  - **Uncapped frame count was a $0-cost global-cap DoS.** `parseRequestBody` capped total bytes
    (5 MB) but not the number of frames. Because the gate runs before the reserve (#91), a caller
    whose quota is spent could send ~2000 tiny valid-base64 frames — `estimateTokensForCall(2000,
    'elite')` ≈ $9.9 — which `gate_ai_call` holds against the live $10 daily cap as a `'pending'`
    row for the request's lifetime; the reserve then denies and the hold cancels at $0 real spend,
    but sustained it saturates the **global** cap and every legitimate analysis gets a `daily_cap`
    503. Fix: `parseRequestBody` rejects `frames.length > PACE_FRAME_CAP.elite` (8) with
    `too_many_frames` / 400 **before** the gate/reserve/model, bounding the pre-reserve estimate to
    ~$0.23. `reserve_analysis` still owns the real per-tier cap; this is only a DoS bound.
- **M4: the `analyze-form` edge function is built (issues #44 + #45)** — the core of the product.
  A side-on clip now returns an honest, certified, well-parsed PACE result, or an honest failure
  that costs the user nothing. Not deployed: the code is written and fully tested; `supabase
  functions deploy` and `supabase secrets set ANTHROPIC_API_KEY` remain Ian's to run.
  - **Added** `supabase/functions/analyze-form/{index.ts,flow.ts,deps.ts}` — HTTP/auth glue, the
    pure orchestration, and the Deno/Supabase/Anthropic wiring, the same three-way split
    `analysis/` (#57) and `quota-status/` (#50) already use. Plus
    `supabase/functions/_shared/analyze-form-validation.ts` (#45) — structural validation, the
    honest-partial salvage, and the `release_reason` classifier.
  - **84 new Deno tests** (`analyze-form/__tests__/flow.deno.test.ts`,
    `_shared/__tests__/analyze-form-validation.deno.test.ts`). Zero Anthropic spend: the model is
    a fake queue. One suite per binding contract rule, each written against the production hazard
    it exists to prevent.
  - **#45, never fabricate a score**: validation is structural, never content. A pillar the model
    did not return, or returned unreadably, comes back `score: null` / `band: null` and no
    invented `notAssessedReason` — never Echo V1's 75 + "No feedback available". Fail → retry
    once → ≥2 pillars parsed (and ≥1 actually scored) → `settle_analysis(is_fallback = true)`;
    otherwise a clean failure and the quota slot is refunded. A photo's two honestly-null pillars
    still validate as a FULL success, not a fallback.
  - **`release_reason` is classified, not guessed** (the `20260712220000` taxonomy): only a pure
    content failure across every attempt is `'validation_failed'` (the one farming signal). A
    truncation, a refusal, or a dead call is `'model_error'`; a timeout is `'provider_timeout'`;
    our own bug is `'internal_error'` — none of which tick a user's anti-farming counter for
    something we did.
  - **`release_analysis` and `recordAiCall` have exactly one call site each, both in a `finally`.**
    The body of the flow never releases and never records; it only sets the intent. A branch
    cannot forget an obligation it does not perform, and an unexpected throw takes the same path.
  - **The retry is a second billed call and gets its own `gateAiCall()`**, so the daily cap and
    the circuit breaker both see it. Each gated call is settled with *its own* outcome: an attempt
    that failed and was rescued by a retry still settles as the failure it was, or the breaker
    would never see a model that has stopped calling tools correctly.
  - **Model config, verified against the live Anthropic docs (not recalled)**: `claude-sonnet-5`,
    `thinking: {type: 'adaptive'}`, `output_config: {effort: 'medium'}`, `max_tokens` 4–8k from
    `MAX_OUTPUT_TOKENS_BY_TIER`. `stop_reason: 'max_tokens'` is treated as truncation and is never
    usable.
  - **The output contract moved to STRUCTURED OUTPUTS (`output_config.format`), and the tool is
    gone from the request.** This corrects a false claim that had propagated from
    `_shared/analyze-form-prompt.ts` (#41) into `docs/architecture.md` and, briefly, into this
    function: that Anthropic's docs state "with no platform scoping" that a *forced* `tool_choice`
    is incompatible with extended thinking. **That restriction is Amazon Bedrock ONLY** — on
    Bedrock a forced `tool_choice` requires `thinking: {type: 'disabled'}`; the first-party Claude
    API (which is what `analyze-form/deps.ts` calls: `api.anthropic.com`, `x-api-key`) and Vertex
    do not require it. The fix is not "force the tool call" but to use the mechanism that makes the
    question moot: `output_config.format` grammar-constrains the RESPONSE ITSELF against
    `PACE_RESULT_SCHEMA`. With no `tools` and no `tool_choice` in the request, there is nothing left
    for a platform-specific tool-choice rule to conflict with, the guarantee is stronger (the answer
    is schema-conformant by construction, not "some tool got called"), and the tool schema stops
    being billed as input on every call. The tool is kept as an opt-in (`includeTool`) for #42's
    evals. **#45's fallback path is unchanged and is NOT dead code**: structured outputs explicitly
    does *not* guarantee the schema on `stop_reason: 'refusal'` or `'max_tokens'`, and
    `minimum`/`maximum` are not in the supported JSON Schema subset — so "score is 0–100" is
    enforceable only in code. The schema guarantees the shape; `isPaceResult` guarantees the range.
  - **Fixed while self-reviewing**: a gate denial was forwarding `gate_ai_call`'s `detail` to the
    client, which on `daily_cap` carries `spent_usd`/`cap_usd` — any authenticated user could read
    our AI spend and our ceiling by tripping the cap. The client now gets `{ error, code }` only;
    the detail is logged server-side.

## 2026-07-12

- **M2 capture screens built (issue #36)** — design-brief screens 3-5: source picker, in-app
  muted record, and frame extraction, gated on M2's own requirement ("both sources hand a valid,
  budget-compliant frame set to the analysis step on iOS").
  - **Added** `app/capture/_layout.tsx`, `index.tsx` (Source picker), `record.tsx` (Capture), and
    `extracting.tsx` (Extracting), plus `components/framing-guide.tsx` (the faint side-on
    running-stance figure + level line, built from plain `View`s — no new dependency).
    Registered as a third `Stack.Screen` inside `app/_layout.tsx`'s existing signed-in
    `Stack.Protected` block (`app/_layout.tsx`'s only change).
  - **Muted recording, unregressed**: `expo-camera`'s `CameraView` uses `mode="video"` + `mute`;
    `app.json`'s `microphonePermission: false` / `recordAudioAndroid: false` (both plugins,
    already correct from M1) are untouched.
  - **Permission states are real, not raw alerts**: camera and photo-library each get a soft-ask
    (rationale before the OS prompt), a denied panel (real copy, a "the other path" secondary
    action, and a CTA that requests again or opens Settings depending on `canAskAgain` — new
    `lib/permission-state.ts`, tested), covering the "camera denied / library denied /
    permanently denied" states the issue named explicitly.
  - **`lib/frames.ts`'s `FrameBudgetExceededError` surfaces honestly** on Extracting
    (`upload.error.budgetExceeded`, no Retry — the same input would fail again), distinct from a
    generic extraction failure (`upload.error.extractionFailed`, Retry + Back) and from a
    pre-flight cap violation caught before extraction even starts (new `lib/media-caps.ts`:
    `MAX_CLIP_DURATION_MS` 15s / `MAX_PRE_COMPRESS_BYTES` 50MB, per `docs/mvp-build-prompt.md`
    gate #5).
  - **The Art. 9 consent gate** (`components/consent-gate.tsx`, issue #68) is now hosted — on the
    Source picker, intercepting the tap on either card, per the copy deck's own placement
    ("gates the Source Picker -> Capture/Upload handoff").
  - **New tested `lib/` modules**: `media-caps.ts`, `media-file-size.ts` (SDK 54's `expo-file-
    system` `File.size`), `permission-state.ts`, `parse-capture-params.ts` (route-param ->
    `PaceMediaInput` parsing). 27 new Jest tests, all passing; `npm run typecheck && npm run lint
    && npm test` clean; `npx expo export` verified a clean Metro bundle on both iOS and Android.
  - **New copy** in `constants/copy.ts` (`sourcePicker.*`, `capture.*`, `upload.*`), lifted
    verbatim from `docs/design/copy-deck.md` where a key existed; a handful of genuinely new keys
    (a library clip over the caps, a local extraction failure, the honest no-next-screen-yet
    stopping point since `analyze-form`/M4 doesn't exist) are marked "NEW key" in both
    `constants/copy.ts` and the deck, mirroring issue #68's precedent.
  - **Known gaps flagged, not silently fixed**: Home's CTA (`app/(tabs)/index.tsx`) is not wired
    to `/capture` — a different screen with its own in-flight M5/M7 work, out of this issue's
    scope. Issue #35 (direct-to-bucket upload) is superseded by #88's live no-client-upload
    contract and should not be built as originally scoped. `lib/frames.ts`'s own test coverage
    (#37) and frame-timestamp accuracy (#112) are separate, still-open issues.
  - Full detail: `docs/architecture.md`'s "Current — capture screens (issue #36)" section.
- **Screen 6 — Analyzing built (issue #80), the wait screen between "frames uploaded" and
  "result rendered."** Built on `fix/80` in an isolated worktree, in parallel with three other
  in-flight screen issues. Neither `analyze-form` (#44) nor the result screen (#56) exist yet;
  this screen is built entirely against their documented contracts, with a clean, injectable seam
  #44 drops its real implementation into.
  - **Added** `lib/analyze-form.ts`: `AnalyzeFormRequest`/`AnalyzeFormClientResult` types matching
    `docs/architecture.md`'s `analyze-form` request/response contract exactly (two parallel
    `frames`/`timestamps` arrays, not `PaceFrame[]`), the `AnalyzeFormClient` interface, a dev-only
    mock (`success` / `fallback` / `failed` / `timeout` / `thrown` outcomes, nothing calls the
    Anthropic API or any edge function), `toAnalyzeFormRequest()` (the missing glue flattening
    `lib/frames.ts`'s `PaceFrameSet` into the wire shape — nothing needed it before this issue,
    since no caller of `extractFrames()` existed yet), and a one-shot module-level
    `setPendingAnalyzeFormRequest`/`takePendingAnalyzeFormRequest` mailbox (not a state-management
    library — a multi-megabyte base64 payload is far past what's sane to round-trip through
    expo-router's serialized route params).
  - **Added** `lib/analyzing-machine.ts`: the screen's pure, fully unit-tested state machine —
    `analyzingReducer` (`waiting` → `succeeded` / `failed` / `timedOut`, with an attempt-counter
    staleness guard so a late-arriving stale event from an old attempt, e.g. a timeout firing
    after a Retry already started a new attempt, can never clobber the current one) and
    `captionPhaseForElapsed` (the `docs/design/motion-consult.md` wait-state pacing: a fixed
    step-list floor, then the honesty-threshold "Still analyzing" line — pure function of elapsed
    time, no timers inside, so it's testable with plain numbers). 31 tests across both new `lib/`
    files.
  - **Added** `app/analyzing.tsx` and registered it as a new `<Stack.Screen name="analyzing">`
    inside `app/_layout.tsx`'s existing signed-in `Stack.Protected` group (minimal, additive —
    nothing else in that file changed). Renders the step list, the honesty-threshold fade (plain
    RN `Animated`, no new motion dependency), and the `analyzing.error.failed.*` /
    `.timeout.*` states with Retry/Cancel (Cancel routes to Home; Retry reuses the SAME
    `idempotencyKey`, never mints a new one, so a client-side timeout followed by Retry can never
    double-run the model or double-burn quota). A full result and an honest `isFallback: true`
    partial (issue #45) route through the identical success path to the result screen
    (`/result/[id]`, forward-referenced via an `as Href` cast since that route doesn't exist in
    this worktree) — never treated as a failure. Explicitly does NOT build #64's backgrounding-
    recovery flow or #61's full motion/reduced-motion spec — the wait-state signaling this screen
    implements is motion-consult.md's own documented exemption from reduced-motion suppression
    ("opacity/color-only functional state signaling," not a vestibular trigger), not an oversight.
  - **Added** `Copy.analyzing` to `constants/copy.ts` — every string lifted verbatim from
    `docs/design/copy-deck.md` Screen 6 (`analyzing.title`, `.step.reading`/`.scoring`,
    `.longWait`, `.error.failed.*`, `.error.timeout.*`); the Retry/Cancel CTA strings duplicate
    the literal "Retry"/"Cancel" values under this screen's own keys rather than introducing a
    `Copy.shared` namespace — no such namespace exists anywhere in this codebase yet (Home and
    ConsentGate made the same call before this issue), and adding one was explicitly out of scope.
  - Verified end-to-end, not just typechecked: a throwaway (not committed) React Testing Library
    smoke test mounted the real screen against the real default mock client with fake timers and
    confirmed the full happy path — step 1 → step 2 → the long-wait fade → navigation to
    `/result/[id]` with `justAnalyzed: '1'` — actually renders and transitions correctly, plus a
    clean `npx expo export -p ios` bundle (1456 modules, zero errors).
  - `npm run typecheck && npm run lint && npm test` clean (340 Jest + 29 Deno tests, up from 309 +
    29).
- **The grounded `analyze-form` prompt, the tier verbosity dial, and the structured-output
  contract (issue #41 — M4's blocker; #44 and #45 can now start).** New:
  `supabase/functions/_shared/analyze-form-prompt.ts` (pure, injectable, never calls Anthropic —
  same pure/client split as `ai-guard.ts`) plus 28 Deno tests. **No live model call was made** and
  no function was deployed. Full detail in `docs/architecture.md` → "Current — the `analyze-form`
  prompt".
  - **Grounding**: the three certified `knowledge/*.md` files are injected **verbatim** from
    `knowledge.generated.ts` (#90) and asserted present **byte-for-byte** in the assembled prompt.
  - **Tier dial**: one prompt, one parameter (`TIER_VERBOSITY`). It moves depth and only depth —
    the not-assessed, medical-boundary, timestamp, and input-channel rules are assembled *outside*
    the dial and are byte-identical at every tier, so a paid tier can buy more words but never more
    confidence. Tested as a property across all three tiers.
  - **Issue #112 honored**: frame timestamps are the **requested** times, not the decoded ones, so
    every rendered time and interval is explicitly approximate, the error bar (hundreds of ms) is
    stated, precise SPM/GCT/VO figures are forbidden **at every tier including Elite**, and Cadence
    and Elasticity are steered onto timestamp-*independent* evidence (the overstriding signature;
    the visible quality of the landing) — which `pace_framework.md` already calls the most important
    thing you can see, and which needs no clock.
  - **Contract**: a forced, `strict: true` `submit_pace_analysis` tool whose `input_schema` **is**
    `PaceResult` (#43) — no parallel shape, no adapter. A round-trip test proves schema-shaped
    responses (including the photo case, where Cadence and Elasticity are honestly `null`) satisfy
    `isPaceResult`, so #45 can never reject an obedient model.
  - **Call config**: `thinking: {type: 'adaptive'}` (ON — this is a multi-step vision-reasoning
    task and the one call the product exists to make; running it with thinking off would be a
    material quality regression), `output_config: {effort: 'medium'}` (exported as
    `ANALYZE_FORM_EFFORT` for #42 to sweep — `medium` because `max_tokens` is a tight 4–8k that
    thinking counts against, Anthropic names "drop to medium" as the direct remedy for a
    mostly-thinking truncated answer, and Sonnet 5 at medium ≈ Sonnet 4.6 at high), and
    `tool_choice: auto`. `thinking` and `tool_choice` are **independent** options — no coupling.
    The docs state (with no platform scoping) that a *forced* `tool_choice` is incompatible with
    thinking; a credible report scopes that to Amazon Bedrock only, which could not be confirmed.
    `auto` is correct under both readings, so it is the default, and `strict: true` + a prompt that
    demands the tool call + #45's fallback carry the shape guarantee. #44 should confirm on its
    first live call whether `forceToolCall: true` works alongside adaptive thinking.
  - **Corrected two stale architecture claims that would have shipped as bugs.** (1) Step 6 asserted
    the frames carry their *actual* sampled timestamps; they do not (#112) — corrected. (2) Step 8
    specified a forced tool call **and** an explicit thinking config, without saying which thinking
    config — rewritten to state the real contract, the forced-tool/thinking open question, and the
    fact that `max_tokens` bounds thinking + text together. Also verified: this model rejects any
    non-default `temperature`/`top_p`/`top_k`, so the request sets none — determinism comes from
    `strict: true`, not from a sampling parameter.
  - **Fixed an under-reserving spend gate (`ai-pricing.ts`, #91).** `SYSTEM_PROMPT_TOKENS_ESTIMATE`
    shipped at `6000` as an admitted placeholder for a prompt that did not exist yet. The real
    prompt is ~57k characters at Elite (system + user text + a ~13k-character tool schema, billed as
    input) **and Claude Sonnet 5's new tokenizer produces ~30% more tokens for the same text**, so
    the usual ~3.5–4 chars/token heuristic under-counts: at ~2.7 chars/token the worst case is
    **~21.5k** tokens. `gate_ai_call` was reserving ~3.5x too little on every call — on a hard
    credit ceiling with auto-reload off, that is how you run out mid-analysis. Raised to `24000`
    (still conservative: priced as uncached, though the knowledge + tool prefix is cached at 0.1x),
    with a test that re-measures the prompt at the Sonnet-5 ratio and fails if it outgrows the
    constant. The **output** reservation needed no change and is not exposed by thinking: thinking
    bills as output, but `max_tokens` caps thinking + text together and equals the reserved
    `outputTokens`, so billed output ≤ reserved output — asserted by a test.
- **`GET /functions/v1/quota-status` built (issue #50), the server-authoritative read that #54
  (Home's quota display) must replace its client-side count query with.** `app/(tabs)/index.tsx`
  currently derives quota itself via a `subscriptions` + `analyses` count query, which CLAUDE.md's
  "no business rules in the client" rule forbids and which cannot even be completed for Pro/Elite
  (`pace_current_period`'s `EXECUTE` is revoked from `authenticated`). Built and Deno-tested on
  `fix/50`; **not deployed**. See `docs/architecture.md`'s "Current — `GET
  /functions/v1/quota-status` (issue #50)" section for the full design.
  - **Added** `supabase/migrations/20260712233000_quota_status_function.sql`: a new, read-only,
    `SECURITY DEFINER` function, `pace_quota_status(p_user_id, p_as_of)`, granted to
    `service_role` only — **WRITTEN, NOT APPLIED** to any database (issue #50's hard constraint).
    Calls the exact same `pace_current_period`/`pace_is_farming_signal` functions the live
    `reserve_analysis` calls (verified via `pg_get_functiondef` against project
    `vputdomdlknvthnzritt` before writing this file), so period math and farming-signal
    classification cannot drift between the two. Does not `create or replace` `reserve_analysis`,
    `settle_analysis`, or `release_analysis`. The one unavoidable duplication — the literal tier
    -> limit/frame_cap table `reserve_analysis` inlines rather than exposing as a helper — is
    copied verbatim with a loud "keep in sync" comment, since closing it fully would require
    editing `reserve_analysis`'s own body, out of scope here.
  - **Added** `supabase/functions/quota-status/index.ts`, `_shared/quota-status.ts` (pure
    orchestration), `_shared/quota-status-client.ts` (service-role client factory, same
    `ai-guard-client.ts`/`delete-analysis-client.ts` split). The response represents the issue #6
    anti-farm block as a state independent of quota — `blocked`/`blockedReason`/`blockedUntil`
    can be true/set even while `remaining > 0`, so a rate-limited-but-not-out-of-quota user is
    never shown a plain "1 analysis left."
  - **Added** `supabase/functions/_shared/__tests__/quota-status.deno.test.ts` (18 tests): RPC
    response-shaping tests (free lifetime exhaustion, paid period windowing, the
    blocked-with-quota-remaining case) against an injected fake `RpcClient`, plus migration-text
    invariant tests proving the migration's counting queries never filter on `deleted_at` (a
    soft-deleted analysis keeps counting, matching `reserve_analysis`) and that its tier -> limit
    table matches the live `reserve_analysis`'s literal values. No live/local database was
    available or permitted to integration-test against — see the architecture doc section above
    for the honest scope of what this proves.

- **Client-side soft-delete bypass around #57's delete endpoint closed (found by #57's agent,
  fixed alongside #6, migration written, not yet applied to the live project).** #2's soft-delete
  `UPDATE(deleted_at)` grant + policy on `public.analyses` was the intended client delete path
  before a server-side delete endpoint existed; now that #57's `DELETE
  /functions/v1/analysis/:id` edge function exists (built in a sibling worktree), that path is a
  bypass — a client can PATCH `deleted_at` directly, firing #2's redaction trigger (which wipes
  `media_paths`) without ever purging the Storage objects it named. That is issue #3 (deleted
  media never actually purged) reintroduced through the door #2 opened. Not exploited today:
  verified live (project `vputdomdlknvthnzritt`) that `public.analyses` has 0 rows, and a
  repo-wide grep of `app/`, `lib/`, `components/` found zero client code writing `deleted_at` or
  calling `.update()` against `analyses` — the only client reference to the table is the
  read-only quota-count `SELECT` in `app/(tabs)/index.tsx`. Revoking this breaks nothing live
  today.
  - **Added** `supabase/migrations/20260712230000_analyses_client_delete_removed.sql`: revokes
    `authenticated`'s `update (deleted_at)` column grant and drops the "Users can soft-delete
    their own analyses" policy. Leaves the `deleted_at` column, the redaction trigger, and all
    three quota RPCs (`reserve_analysis`/`settle_analysis`/`release_analysis`) untouched —
    `service_role` (which the delete edge function runs as) holds its own separate, unrevoked
    grant set and bypasses RLS regardless, confirmed by reading
    `information_schema.column_privileges` live rather than assumed. Resulting matrix on
    `public.analyses`: `anon` — nothing; `authenticated` — `SELECT` only (one policy, no
    INSERT/UPDATE/DELETE/TRUNCATE); `service_role` — unchanged, full access. Delete is now
    exclusively server-side. Composes cleanly with this same branch's other pending migration
    (`20260712220000`, the anti-farm fix below) — timestamped later, touches no statement the
    other one wrote (policies/grants only here; a function body and a CHECK constraint only
    there).
  - **Added** `supabase/migrations/__tests__/analyses_client_delete_removed.test.ts` (13 tests)
    and **updated** `supabase/migrations/__tests__/analyses_quota_soft_delete.test.ts`'s two
    cross-migration policy-simulation assertions — that suite dynamically scans every migration
    file's `CREATE`/`DROP POLICY` statements to compute the net-effect policy set, so adding this
    migration correctly changes its computed end state from "one SELECT + one UPDATE policy
    survive" to "one SELECT policy survives, zero UPDATE"; a new test was added alongside it that
    checks the soft-delete policy's shape directly against #2's own migration file (independent of
    later supersession), so #2's fix is still provably correct as originally written even though a
    later migration removes what it added.
  - **Updated** `docs/architecture.md`'s `analyses`'s RLS section with a new "Planned" paragraph;
    not yet applied to the live project, same not-yet-live footing as #6's anti-farm migration.

- **Anti-farming cap now distinguishes our infrastructure failures from genuine abuse (fixes
  #6, HIGH — migration written, not yet applied to the live project).** `reserve_analysis`
  counted every `status = 'released'` row toward its 3-failed-attempt anti-farming cap
  regardless of cause; free's branch has no window (matching its lifetime quota), so 3
  transient Anthropic timeouts/outages — none of them the user's fault — permanently bricked a
  free account with no recovery path. Verified live before touching anything: the current
  `reserve_analysis` (`pg_get_functiondef` against project `vputdomdlknvthnzritt`) matched
  `20260712123606_frame_upload_ordering.sql` (#88's 4-arg signature) byte-for-byte, and
  `public.analyses` had 0 rows against 2 `profiles` — no account is bricked today, so this ships
  with no data backfill.
  - **Added** `supabase/migrations/20260712220000_anti_farm_release_reason_fix.sql`: pins
    `release_reason` (previously freeform, "observability only") to a closed vocabulary via a
    new CHECK constraint — `model_error` / `provider_timeout` / `internal_error` (server-fault,
    excluded from the cap) vs. `validation_failed` (fires on genuine abuse AND on honest
    hard/confusing input, since #45's retry+honest-partial fallback doesn't exist yet to
    distinguish them — still counted, but see the windowing point below for why that alone isn't
    enough) — and adds `public.pace_is_farming_signal(text)`, a standalone classifier kept
    deliberately OUT of `reserve_analysis`'s body so a future taxonomy change never needs to
    `create or replace` that function again (the exact two-migrations-collide hazard #88's and
    #2's own header comments warn about, after one such collision already cost this repo work).
    **Free's anti-farm count is windowed to a rolling 24h** (`released_at > now() - interval
    '24 hours'`) rather than left lifetime-scoped like its quota — a same-day review (Ian +
    the coordinating agent) caught that an unwindowed count on `validation_failed` could
    permanently lock out a first-time user after 3 merely-confusing (not malicious) videos,
    a narrower recurrence of the exact bug #6 exists to close. The governing invariant, stated
    explicitly in the migration: **a user who has never successfully received an analysis must
    never be permanently unable to obtain one** — anti-farming may throttle, never permanently
    deny. 24h was chosen over shorter (too weak a deterrent) or period-length (too long a wait
    for a first-time user) alternatives, and turns out to match what the original spec always
    said — "3 free retries **per period**" (`planning/02-product-requirements.md:64`,
    `planning/03-engineering-requirements.md:81`, `docs/mvp-build-prompt.md:223`) — distinct from
    the lifetime quota, which the first implementation had conflated. Pro/elite's existing
    purchase-anchored period window is left as-is (it already self-resets, so never had this
    failure mode) and only gains the same reason filter. Every other line of `reserve_analysis` —
    signature, quota check, insert, exception handler — is preserved verbatim from #88.
    `settle_analysis`/`release_analysis` are untouched. The cap itself is not weakened: 3
    confirmed, recent farming-signal releases still trips `too_many_failed_attempts`.
  - **Added** `supabase/migrations/__tests__/anti_farm_release_reason_fix.test.ts` (30 tests),
    following this repo's existing text-level migration-contract convention (no pgTAP/local
    Postgres available — see that suite's own header, and `analyses_quota_soft_delete.test.ts`
    for precedent) — asserts the CHECK constraint's exact vocabulary, the classifier's boolean
    semantics, that both `reserve_analysis` branches gained the filter, that free's branch is
    additionally windowed to 24h while pro/elite's is not further shrunk, and that no data-repair
    statement was added.
  - **Updated** `docs/architecture.md`'s new "Planned — anti-farming cap distinguishes our fault
    from theirs" section (this migration is written but **not yet applied** to the live
    project — same not-yet-live footing the AI spend guardrail migrations were on before their
    own 2026-07-12 push), including a flagged copy gap: `too_many_failed_attempts` has no
    `docs/design/copy-deck.md` string yet — `ux-copywriter`'s job, not added here.

- **Session storage moved off plaintext AsyncStorage to a SecureStore-backed adapter (closes
  #38, `docs/status.md` Known Issue #13).** `lib/supabase.ts` was passing `storage: AsyncStorage`
  straight to `createClient` — the session, including the refresh token, sat unencrypted on
  disk. Harmless while nothing sensitive sat behind a session (M1); no longer true once M2 gates
  a private bucket of body-image media on it. New `lib/secure-storage.ts` implements Supabase's
  documented "LargeSecureStore" pattern: `expo-secure-store` (Keychain on iOS, Keystore on
  Android) enforces roughly a 2048-byte ceiling per value, far too small for a full session
  (JWT + refresh token + user object), so SecureStore instead holds a fresh random AES-256 key
  per write (`aes-js`, CTR mode; 64 hex chars, constant size regardless of session size) and
  AsyncStorage holds the AES-encrypted, size-unbounded session blob. Proven under the 2048-byte
  limit for an oversized (>2KB) session fixture, not just a small demo one — that's the failure
  mode a naive `storage: SecureStore` swap hits silently.
  - **Migration for the app's 2 existing real accounts:** `getItem` detects a legacy plaintext
    session left over from the old adapter (its leading `{`, since every ciphertext this class
    writes is pure hex and can never start with `{`) and transparently re-encrypts it in place
    instead of returning null — which would read to supabase-js as "no session" and silently
    sign the user out with no explanation on their first launch after this update (the same bug
    class as issue #5). If the re-encrypt write itself fails, the legacy plaintext value is still
    returned so the session isn't lost over a storage hiccup.
  - **Web fallback:** `expo-secure-store` has no web implementation (confirmed against the
    installed package — `ExpoSecureStore.web.ts` is an empty module) and `npm run web` is a
    supported dev command in this project, so `createSecureSessionStorage` falls back to plain
    AsyncStorage on `Platform.OS === 'web'`. Not a new weakness introduced for web specifically —
    browsers have no Keychain/Keystore equivalent to move to, and this project's real target is
    the mobile app.
  - Added dependencies: `expo-secure-store` (`npx expo install`, SDK 54-compatible) and `aes-js`
    + `@types/aes-js` (pure JS, no native module, safe to run for real under Jest).
  - `lib/__tests__/secure-storage.test.ts`: 16 cases covering the round trip, the oversized-
    session/2048-byte requirement, the full migration path (including the failed-migration-write
    fallback and a "malformed JSON that happens to start with `{`" guard), corrupted-ciphertext
    fail-closed behavior, and the web/native platform split. Verified load-bearing by temporarily
    deleting the migration branch and confirming 4 of the 16 tests fail exactly as expected.
- **Torn-write hardening for the SecureStore session adapter, same-branch review follow-up
  (still #38).** The AES key (SecureStore) and the ciphertext (AsyncStorage) live in two stores
  that cannot be written atomically as a pair. The initial #38 implementation above followed
  Supabase's documented recipe literally — a fresh random key on every `setItem` — which means
  every write was a two-store transaction: a `setItem` interrupted mid-way (app killed, device
  out of storage) could leave a new key paired with an old blob, or an old key paired with a new
  blob. AES-CTR does not error on that mismatch; it produces well-formed-looking garbage. The
  next `getItem` would have decrypted "successfully" into nonsense, and — with no check beyond
  "did decrypt throw" — handed it to supabase-js as if it were a real session, or (if the key
  itself was missing) simply returned null, which supabase-js reads as "no session" — a real,
  previously-good session silently laundered into an unexplained sign-out. That is the same bug
  class issue #5 fixed for the OAuth redirect path, and this review round exists specifically so
  it isn't fixed in one place and shipped broken in another.
  - **Stable key, per-write IV.** `lib/secure-storage.ts`'s `_getOrCreateKey` now creates the
    AES-256 key once per storage key and reads it back on every later call instead of
    regenerating it. After the first successful write there is no longer a key/blob *pair* to
    tear — SecureStore is never written again for that key, and every later `setItem` touches
    only AsyncStorage. CTR-mode safety, which the "fresh key every write" trick existed to
    provide, now comes from a fresh random 16-byte IV generated on every write and prepended to
    the ciphertext it belongs to (a fixed 32-hex-char prefix `_decrypt` splits back out).
  - **Residual window, narrowed not eliminated:** the very first write for a storage key still
    touches two stores (key, then blob), so a process kill strictly between those two writes
    still leaves a torn state — but since no blob was ever fully written in that case, the next
    `getItem` sees "nothing to restore," which is honest (no session had actually been
    established yet), not a previously-good session vanishing.
  - **Closed the first-write race.** Two `setItem` calls racing on the very first write for the
    same key (e.g. two auth events firing close together) could previously each find no key,
    each mint a different one, and clobber each other. `_getOrCreateKey` now serializes that
    step per storage key via an in-process async lock (a promise chain, not an OS-level lock —
    sufficient because the only real hazard is concurrent `await`s within this one running JS
    process, not two independent OS processes, which cannot race a single-instance mobile app).
  - **A decrypt that doesn't throw is not proof it's real.** `getItem` no longer trusts `_decrypt`
    just because it didn't throw — a wrong key/IV pairing (the residual torn-write window, or any
    bit-level corruption) decrypts "successfully" into garbage bytes. A Supabase session is
    always a JSON object, so `getItem` now runs `JSON.parse` on the result as the actual validity
    check before trusting it.
  - **Undecryptable state is cleared and reported, not silently absorbed.** On any unrecoverable
    blob (missing key, truncated/torn ciphertext, wrong-key-length exception, or a decrypt that
    fails the JSON check), `getItem` now clears both the AsyncStorage entry and the SecureStore
    key (so it can't keep failing the same way forever) and calls a new
    `onSessionRestoreFailure(key)` subscription hook — `getItem`'s `string | null` return type
    has no room to carry a reason, so this is the side channel. `lib/session-provider.tsx`
    subscribes to it (registered in the same effect as, and before, the `getSession()` call it
    needs to catch) and exposes `corruptedSessionError` / `clearCorruptedSessionError`, named
    distinctly from issue #5's `deepLinkAuthError` / `clearDeepLinkAuthError` on the same
    context so the two additions merge cleanly. `app/(auth)/sign-in.tsx` now reads it via
    `useSession()` with `displayedError = errorMessage ?? corruptedSessionError`, the same
    precedence pattern issue #5 established for its own deep-link error. **Copy: no
    purpose-written string exists for "we couldn't restore your saved sign-in."** Checked
    `docs/design/copy-deck.md` and issue #5's additions to `lib/auth-errors.ts` /
    `constants/copy.ts` (`signInCancelled`, `signInExpired`) first, per instruction not to invent
    copy — neither fits (both are scoped to the OAuth PKCE flow, not a decayed at-rest session).
    Reused `Copy.auth.error.generic` ("Sign-in didn't go through. Try again.") instead, per the
    copy deck's own stated policy for `generic`: fall back to it for "any other auth failure"
    without a specific string rather than inventing one. A precise string is left as future
    `ux-copywriter` work.
  - `lib/__tests__/secure-storage.test.ts` grew from 16 to 21 cases: the stable-key/reused-key
    behavior with a per-write IV-uniqueness assertion, the concurrent-first-write lock (asserts
    exactly one SecureStore key is ever created across two racing writes), and four new
    corrupted/torn-state cases — a blob with no matching key, a truncated/too-short blob, a
    SecureStore key of the wrong byte length (exercises the exception path), and — the core case
    review asked for — a decrypt that succeeds under a wrong-but-validly-shaped key and must
    still be caught by the JSON-validity check, not returned as if real. Verified load-bearing by
    two separate mutations: removing the `JSON.parse` validity check (failed exactly the
    "decrypt succeeds under the wrong key" test) and removing the per-key lock (failed exactly
    the concurrency test, with `SecureStore.setItemAsync` called twice instead of once).
- **Edge-function build/test contract closed (closes #90).** Three previously-unowned mechanics
  that #41/#43/#44/#49/#59 all silently assumed, found by the full-repo audit the same day:
  - **No runner could execute edge-function code.** Added `supabase/functions/deno.json`
    (scoped to that directory) and two npm scripts, `typecheck:edge` (`deno check`) and
    `test:edge` (`deno test`), folded into `npm run typecheck` / `npm run test` respectively so
    the CLAUDE.md-mandated `typecheck && lint && test` gate covers edge code for the first time.
    Running `deno check` immediately surfaced a real, previously invisible type bug in
    `ai-guard-client.ts` (issue #91) — `@supabase/supabase-js`'s `rpc()` returns a
    `PostgrestFilterBuilder`, not a true `Promise`, which didn't structurally satisfy
    `RpcClient.rpc()`'s declared return type; fixed by wrapping the call in an `async` function.
    The pre-existing `_shared/__tests__/ai-guard.test.ts` / `ai-pricing.test.ts` stay Jest-only
    (they use `jest.fn()` and their subjects are deliberately Deno-agnostic pure logic) and are
    excluded from `deno check`/`deno test` via `deno.json`'s `exclude`; new Deno-only test files
    use a `.deno.test.ts` suffix, excluded from Jest via a new `testPathIgnorePatterns` entry in
    `jest.config.js` (mirroring the existing `*.canary.test.ts` exclusion) — the two runners
    share the same `_shared/__tests__/` directory without either choking on the other's globals.
  - **`lib/pace.ts` could not satisfy both the app and the edge function as specced.** Moved to
    `supabase/functions/_shared/pace.ts` — the single source of truth, no copy/codegen/symlink,
    structurally impossible to drift since there is only one file. The app imports it via a new
    `@shared/*` tsconfig path alias (`@shared/*` → `./supabase/functions/_shared/*`); `jest-expo`
    derives its Jest `moduleNameMapper` from the same `tsconfig.json` `paths`, so the alias
    resolves identically under Metro and Jest with no extra config. The `import type { ScoreBand
    } from '../constants/theme'` line is gone — Deno cannot resolve that extensionless,
    non-aliased specifier, and `theme.ts` pulls in `react-native` regardless — replaced with an
    inline `ScoreBand` union plus a runtime `SCORE_BAND_VALUES` companion. A new test in the
    moved `supabase/functions/_shared/__tests__/pace.test.ts` (Jest-only, since only Jest can
    resolve `constants/theme.ts`) asserts `SCORE_BAND_VALUES` matches `constants/theme.ts`'s
    `ScoreBandOrder` exactly — verified to actually fail by temporarily desyncing the two and
    confirming the test catches it. `npm run typecheck` (`tsc --noEmit`) still passes: `pace.ts`
    is pulled back into the TS program via the import graph despite `tsconfig.json`'s
    `supabase/functions/**` exclude, and has zero Deno-only syntax to break it.
  - **The `knowledge/*.md` files had no bundling mechanism, and the failure mode was silent.**
    `supabase functions deploy` only bundles `supabase/functions/` — the three certified files
    live at the repo root and could never reach a deployed function. Added
    `scripts/generate-knowledge-bundle.js` (`npm run generate:knowledge`), which codegens
    `supabase/functions/_shared/knowledge.generated.ts` (checked in) exporting each file's exact
    contents as a string constant, each wrapped in `assertNonEmptyKnowledge()`
    (`supabase/functions/_shared/knowledge-guard.ts`, hand-written, not generated) — it throws at
    module load if any bundle is empty or whitespace-only, so a deploy can never silently serve
    confident, fluent, ungrounded biomechanics advice; verified live by deliberately emptying a
    generated constant and confirming `deno test` fails loud the moment the module is imported,
    before any handler code runs. `npm run verify:knowledge` (part of `test:edge`, hence part of
    `npm test`) regenerates and runs `git diff --exit-code` against the checked-in file, so
    editing a `knowledge/*.md` without regenerating fails the build — verified live the same way
    (edited `knowledge/drills.md`, confirmed the check failed; reverted, confirmed it passed).
    New Deno-only tests (`knowledge-guard.deno.test.ts`, `knowledge.deno.test.ts`) assert each
    constant is non-empty, contains an anchor heading from its source `.md`, and matches the file
    on disk byte-for-byte.

  Full detail: `docs/architecture.md`'s "Current — Deno build/test contract, pace.ts location &
  knowledge bundling" section; `docs/status.md`'s "Done so far" entry for the same date.

- **AI spend guardrails substrate landed, ahead of `analyze-form` itself (closes #91).** #48
  established account creation on this project is currently unbounded (no signup rate limit,
  autoconfirm on, CAPTCHA blocked on Ian) and its own conclusion is that this blocks M4 *going
  live*, not the M4 *build* — so M4 (#44, still Not Started) was on track to land with no brake
  behind it at all. This ships that brake first, built against the design spec in
  `docs/superpowers/specs/2026-07-12-ai-spend-guardrails-design.md`.
  - **Added** `supabase/migrations/20260712210000_ai_spend_guardrails.sql` — `ai_ops_config`
    (the kill switch + daily $ cap + breaker dials, singleton row, RLS-on-zero-policies plus
    explicit `anon`/`authenticated` grant revocation), `ai_model_pricing` (rates, reprice with
    an `UPDATE`, never a migration; seeded at `claude-sonnet-5` LIST price so every estimate
    errs conservative), `ai_call_log` (the per-call spend ledger — all four token fields stored
    separately since they bill at different rates; `user_id`/`analysis_id` `ON DELETE SET NULL`
    so account/analysis deletion erases personal data but keeps spend history queryable).
  - **Added** `supabase/migrations/20260712210100_ai_spend_guardrail_functions.sql` —
    `gate_ai_call` (kill switch → circuit breaker → daily cap, in order, on a global advisory
    lock; reserves a `'pending'` ledger row on allow), `record_ai_call` (idempotent settle;
    `'cancelled'` releases at $0 immediately, a no-usage-data settle falls back to the estimate
    rather than $0), `ai_breaker_state` (derived on read, not stored — filled a gap the design
    spec left open: a still-`'pending'` row created after the last failure now counts as an
    in-flight breaker probe, so a concurrent burst can't all pass through as "the" probe once
    the cooldown lapses), `ai_spend_today` (one JSONB snapshot for `db-audit`/`cost-monitor`).
    All four `service_role`-only, same privilege shape as `reserve_analysis`'s RPC family.
    **Neither migration is applied to the live project** — no non-production Supabase
    environment exists yet (#92), so both wait on that or Ian applying them directly.
  - **Added** `supabase/functions/_shared/ai-pricing.ts` (pure token/cost estimate math, zero
    imports), `ai-guard.ts` (`gateAiCall`/`recordAiCall`/the deny→`503` HTTP mapping against an
    injected `RpcClient`, also free of Deno-only imports), `ai-guard-client.ts` (the real
    Deno/`Deno.env`/`npm:` service-role client factory, imported only by the eventual edge
    function). 33 new Jest tests across
    `supabase/functions/_shared/__tests__/{ai-pricing,ai-guard}.test.ts` covering the cost math
    and the three refusal cases the issue names (cap exceeded, kill switch on, breaker open)
    against a mocked RPC transport.
  - **Updated** `tsconfig.json` to exclude `supabase/functions/**` from `npm run typecheck` —
    that tree runs on Deno, a different module/type system than this Expo app's `tsc` project;
    `#44` should add its own Deno-side check rather than rely on this one to cover it.
  - **Call ordering, binding on #44**: the gate runs *before* idempotency/`reserve_analysis`,
    not after — if it ran after, every guardrail denial would have to release that reservation,
    and `reserve_analysis` counts released rows against its 3-failed-attempt anti-farming cap,
    which would eventually lock out a legitimate user for something the guardrail did. Full
    contract recorded in `docs/architecture.md`'s "Current — AI spend guardrails substrate"
    section and `docs/status.md` Known Issue #16.
  - **Honestly scoped, not overclaimed**: DB grants make the client unable to bypass the gate,
    and there's no way to get a `call_id` other than through it — but nothing here can stop
    `analyze-form`'s own code from skipping the gate and calling Anthropic directly; that's
    closed by `AGENTS.md`'s mandatory `security-auditor` review of the hot list, not by this
    migration. Also still open, and not something buildable from this repo: the hard spend
    ceiling in the Anthropic Console (Known Issue #16).
- **Issue #70 is genuinely fixed, not just mitigated: server-side HaveIBeenPwned leaked-password
  rejection is now enabled and is the authority.** The blocker was the org (`Echo_Running_Final`)
  sitting on the Free plan — enabling `password_hibp_enabled` returned HTTP 402 during the M1
  security audit (2026-07-11). The org is now on the **Pro plan**, which removed the gate.
  - Set `password_hibp_enabled = true` on the hosted project (`vputdomdlknvthnzritt`) via a
    Management API PATCH to `/v1/projects/{ref}/config/auth`. Returned HTTP 200.
  - **Verified live**: a breached password now hard-fails at `signUp` with HTTP 422,
    `error_code: 'weak_password'`, `reasons: ['pwned']`; a strong password still succeeds. The
    `auth_leaked_password_protection` security-advisor lint is gone — **the project's security
    advisor list is now completely empty (zero findings)**.
  - **`lib/hibp.ts` is deliberately KEPT (Ian's call)**, but its role changes: it is no longer
    the enforcement point, the server is. It stays as (1) a fast inline pre-check for UX —
    instant feedback before the `signUp` round-trip — and (2) defense-in-depth if
    `password_hibp_enabled` is ever flipped off again. It remains client-side, bypassable, and
    fails open on a HIBP timeout/outage, same as before; that is no longer a coverage gap, since
    the server backstops it.
  - New `lib/auth-errors.ts` — `mapAuthError` extracted out of `app/(auth)/sign-in.tsx`'s catch
    block so this security-relevant mapping gets real unit-test coverage (screens aren't
    unit-tested by convention). It takes the raw caught `unknown`, not just a message string,
    because the new branch needs supabase-js's typed `AuthWeakPasswordError.reasons` array to
    tell a server-side breach rejection apart from a plain too-short password — both throw the
    same error class. Covered by new `lib/__tests__/auth-errors.test.ts` (8 tests,
    mutation-verified).
  - **A GoTrue subtlety worth recording**: `reasons` is a set, not a tag — it accumulates, so a
    password that is both too short and breached returns `['length', 'pwned']` (verified live
    with `"abc123"`). `mapAuthError` therefore checks `length` before `pwned`: the more
    actionable message wins, so a user isn't told only "breached" and left never learning the
    8-character rule.
  - `.github/workflows/hibp-canary.yml` gained a second, read-only assertion that
    `password_hibp_enabled` is still `true` on every daily run, filing a distinct
    `security`-labelled issue if it ever reverts (self-healing on recovery, same as the
    existing canary). Rationale: the control is Pro-plan-gated, so a billing lapse or a
    Dashboard toggle could silently disable it, and `lib/hibp.ts` fails open, so it would NOT
    catch that on its own. **This assertion needs a `SUPABASE_ACCESS_TOKEN` repo secret, which
    does not exist yet** — until Ian adds it, the step fails loudly (rather than passing green)
    so an unarmed monitor can't be mistaken for coverage.
  - `docs/status.md`, `docs/architecture.md`, and `docs/blocked-on-apple.md` updated: #70 moves
    from "mitigated, blocked on Supabase Pro" to resolved; the Known Issue about the client-side
    check being the only line of defense is rewritten to reflect that the server now backstops
    it.
  - Verification: `npm run typecheck && npm run lint && npm test` all clean (116 tests).
- **Frame uploads move server-side, after the model call — contract settled, migration written
  but NOT applied to the live project (issue #88).** The old contract was both unbuildable and
  leaking: `reserve_analysis` minted the analysis id server-side yet took `p_media_paths` as an
  input, so the client had to name `{user_id}/{analysis_id}/` before that id existed — and every
  rejection branch (402 over-quota, frame cap, anti-farming) returned *before* the insert, so a
  Free user who had spent their one lifetime analysis uploaded frames, got a 402, and left
  images of their body in the bucket with no row pointing at them, undeletable forever.
  - **Changed** `reserve_analysis` to drop `p_media_paths` (now 4 args) and `settle_analysis` to
    take it (now 5 args), guarded so every path must sit under `{p_user_id}/{p_analysis_id}/` —
    which is what permanently closes #8. Old signatures are `drop function`'d, not merely
    replaced, so no overload keeps the old contract callable.
  - **Removes** the client's `INSERT` and `DELETE` policies on `storage.objects` — the server
    uploads with the service-role key, so a bucket-fill by an authenticated client (#7) stops
    being *possible* rather than being budgeted against.
  - **Removes** the client's `DELETE` policy on `analyses`. With the storage `DELETE` gone, a
    client-side row delete would have stranded that row's frames — #88's own bug from the other
    end. Deletion becomes exclusively #57's edge function, which makes **#57 a hard prerequisite
    for any user-facing delete**. Nothing regressed today: no client code deletes an analysis and
    the M6 delete UI does not exist. This is also the exact policy issue #2 needs gone (deleting
    a row currently resets the free-tier lifetime quota count) — see the overlap note below.
  - **Establishes** that purge deletes by the `{user_id}/{analysis_id}/` **prefix**, never by
    iterating `media_paths` — reachability comes from the row existing, not from `media_paths`
    being populated. #47/#57/#58 inherit this.
  - **Net effect for the client, once applied:** frames cross the wire **once** (base64 in the
    body) instead of twice (bucket + body), and `lib/frames.ts` (#34) never touches Storage.
  - **NOT applied to the live `v2.3Analysis` project.** There is no non-production Supabase
    environment (#92), so applying goes straight to prod, and this work was explicitly scoped to
    write the migration file only (`supabase/migrations/20260712123606_frame_upload_ordering.sql`)
    — read-only MCP queries confirmed the live schema matches the repo's other 9 migrations
    exactly, with no drift, before this file was authored. Applying it and running the live
    verification queries (`docs/superpowers/plans/2026-07-12-frame-upload-ordering.md` Task 2) is
    the required next step before #34/#44 are built.
  - **Overlaps issue #2**, worked concurrently in a sibling worktree: both fixes drop the same
    `analyses` DELETE policy (compatible), but #2 may also rewrite `reserve_analysis`'s
    quota-counting query inside the function body, and this migration's `create or replace
    function public.reserve_analysis(...)` is a full body replacement — whichever migration
    applies last silently wins in full. The two `reserve_analysis` bodies need manual merging
    before either is applied to the live project, not a sequential apply of both files.
  - Added `supabase/__tests__/frame-upload-ordering.test.ts` — a structural regression lock
    against the migration file's text (no pgTAP harness exists in this repo, and the migration
    can't be verified live yet — see above).
  - Docs updated to describe the settled (not-yet-live) contract: `docs/architecture.md` (new
    "Pending" section, the analyze-form flow, the media-pipeline section, the API table row, the
    RPC/RLS/media-privacy paragraphs annotated as pending), `CLAUDE.md` (the media bullet),
    `docs/status.md` (new Known Issue #16, a note on #14's contract list, the M2 next-action
    item).
- **HIBP fail-open is now observable (refs #74).** `lib/hibp.ts` fails open and deliberately
  never logs, which made the leaked-password check silently unobservable: if HIBP's endpoint
  rotted, every sign-up would pass the check forever with nothing to show for it.
  - **Added** `lib/__tests__/hibp.canary.test.ts` — a live-network canary that runs the real
    shipped `checkPasswordBreached` against the live Pwned Passwords range API, asserting a
    known-breached password still returns `breached` and a random one still returns `safe`.
    Both reject `unavailable`. It mocks only `expo-crypto`'s native digest (a real `node:crypto`
    SHA-1 returning lowercase hex, as the native module does), so the uppercase normalization is
    proven end-to-end against a live response.
  - **Added** `jest.canary.config.js` + `npm run test:canary`, and excluded `*.canary.test.ts`
    from `jest.config.js`, so `npm test` stays hermetic and offline.
  - **Added** `.github/workflows/hibp-canary.yml` — the repo's first CI workflow. Daily cron,
    3 attempts with backoff (a canary that cries wolf gets muted), opens/updates a labelled
    `security` issue on sustained failure and auto-closes it on recovery.
  - **Narrowed** issue #74 to the device-side residue only, recording that **Sentry is actively
    contraindicated** here: its breadcrumbs would fingerprint the very passwords the check
    protects.
  - **No user data is collected** and no SDK was added — the App Store privacy-label answers
    are unchanged.
- **Repo audit, second pass: the six actionable Low-severity issues (closes #9, #21, #24, #25,
  #29, #30).** All six needed a design decision, which is why they were not taken in the first
  pass; each decision below is derived from `docs/design/frontend-design-brief.md` §2/§4.1 rather
  than invented. The two remaining Low issues (#60 Elite comparison, #61 motion) are blocked on
  M6/M4 screens that do not exist yet and were left open.
  - **A real semantic error token (#24).** `constants/theme.ts` gains `Semantic.error` (light
    `#C23B52` / dark `#D47383`) — a cool crimson (hue ~350°) deliberately ~335° away from
    `Score.low`'s clay red-orange (hue ~15°), so a **system error and a low pillar score can
    never read as the same thing** on M6's Result screen. Both values clear WCAG AA as text
    (4.5:1) against `background`, `surface.base` **and** `surface.raised` in both themes — worst
    pair 4.61:1 (light/bg) and 4.70:1 (dark/surface.raised, the binding constraint in dark mode).
    Proven, not asserted: 8 new assertions in `constants/__tests__/theme-contrast.test.ts`,
    including an inequality lock against `Score.low`. `sign-in.tsx`'s error text now uses it.
    `success`/`warning` were deliberately **not** added — no consumer exists, and an unproven
    token is exactly what this file's discipline forbids.
  - **The accent is single-use again (#21).** `constants/theme.ts` reserves `Accent.value` for
    "the primary CTA and *only* the primary CTA"; it was appearing 2–3 times at once. Home's
    Retry link → `text.primary` + underline (it keeps the underline, which is what marks it as an
    action). The tab bar's active tint → `text.primary`, and `tabBarInactiveTintColor` is now set
    to `text.secondary` instead of falling back to React Navigation's stock gray. `Accent` now
    appears exactly once per screen: the primary CTA fill. (The full nav-theme rework is #12 and
    was left alone.)
  - **One raised element per screen (#25).** `surface.raised` is defined as "the one raised
    element per screen" and sign-in was giving it to **both** secondary buttons. Google keeps it
    (brief §4.1 lists it first, and it is the lower-friction path); "Continue with email" drops to
    `surface.base`, keeping its `hairline` border. **No accent primary button was introduced** —
    which button should be primary is #20, it is entangled with the not-yet-installed Sign in with
    Apple button, and it stays open.
  - **Four hardcoded strings routed through the copy deck (#30).** `Copy.auth.wordmark`,
    `Copy.home.title` (shared by the heading and the tab label — two independent `'Home'` literals
    before), and `Copy.home.quota.tier.pro`/`.elite`. Two of these have **no deck entry** and are
    backfilled with the gap recorded in-place: whether Home should carry a "Home" heading above a
    "Home" tab at all, and whether the wordmark should become the real mark asset (which now
    exists at `assets/source/mark-*.svg`), are open design questions this change deliberately does
    not answer.
  - **One password-length constant, and the rule shown before you break it (#9).** New
    `constants/auth.ts` exports `PASSWORD_MIN_LENGTH = 8`; the sign-up pre-check and **both** copy
    strings now template off it, killing the triplicated literal. It still **cannot** bind
    `supabase/config.toml`'s `minimum_password_length`, which remains the sole authority — that
    constraint is now stated at the constant itself, not scattered across three files. Sign-up mode
    also shows the rule as helper text under the password field (`Copy.auth.password.hint`), wired
    to the field via `accessibilityHint` so a screen reader gets it too.
  - **Reduced motion is wired (#29).** New `hooks/use-reduced-motion.ts` reads
    `AccessibilityInfo.isReduceMotionEnabled()` and subscribes to `reduceMotionChanged`. It gates
    the one animation that exists today — expo-router's default Stack transition in
    `app/_layout.tsx`. **No new motion was added**: `docs/design/motion-consult.md` is binding, and
    this is the mechanism #61 must plug every future animation into, built before there is anything
    to retrofit.
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
- **Built the consent record + the two Art. 9 UI drop-ins (issue #68), plus the binding
  `analyze-form` consent check they depend on.** The client checkbox only *collects* consent;
  GDPR Art. 7(1) requires being able to *demonstrate* it, so this adds the record that does that.
  - New `public.consents` (8th migration, `20260712020729_consents.sql`) — an append-only log of
    consent events: `id`, `user_id` (defaults to `auth.uid()`, FK to `profiles` on delete
    cascade), `consent_key`, `granted`, `created_at`. Owner-scoped SELECT and INSERT RLS
    policies; deliberately **no UPDATE and no DELETE policy at all** — RLS default-denies
    whatever it has no policy for, so that absence, not a convention, is what makes the log
    append-only. A withdrawal is a new row with `granted = false`, never a mutation of the
    grant. Verified live against the real database with an `authenticated` JWT.
  - New `lib/consent.ts` — `UPLOAD_HEALTH_CONSENT` (`'upload.health.v1'`), `hasConsented`,
    `grantConsent`, `withdrawConsent`. Versioning lives in the key, not a column: rewording the
    consent copy mints a `v2` key and `hasConsented` is automatically false for every existing
    user until they re-tick, no migration needed. **Fails closed**: `hasConsented` throws on any
    query error instead of defaulting to `true` (would process Art. 9 health data with no legal
    basis) or `false` (indistinguishable from a real non-consent, which hides an outage — the
    same class of bug already open at #74, where `lib/hibp.ts` fails *open* with nothing saying
    so). 10 tests.
  - New `components/consent-gate.tsx` — the Art. 9 modal content: checkbox unticked by default,
    primary CTA disabled until it's ticked (the affirmative, unbundled act that makes this
    consent rather than a "by continuing" notice), and a fail-closed error state if the write to
    `public.consents` fails (the gate stays up, nothing is uploaded). 6 tests.
  - New `components/result-disclaimer.tsx` — the "not medical advice" footer,
    `result.disclaimer.footer` from the copy deck. 2 tests.
  - `constants/copy.ts` gained the `consent.upload.*` keys and one genuinely new one,
    `consent.upload.error.record` (the consent-write-failed message); `docs/design/copy-deck.md`
    documents both.
  - New devDependency `@testing-library/react-native` — a deliberate, narrow exception to
    `CLAUDE.md`'s "screens are not unit-tested for now": these are components, not screens, and
    the disabled-until-ticked gate is a compliance control that must not be able to regress
    silently.
  - **The binding half of this work: `analyze-form` (M4, issue #44) must refuse to run for a
    user with no recorded consent, or none of the above is enforcement, just UX that anyone
    calling the API directly can skip.** That function doesn't exist yet, so the exact check is
    recorded where its builder will find it — `docs/status.md` Known Issue #14 (a fourth,
    binding contract bullet alongside the existing M4 notes) and `docs/architecture.md`'s
    `analyze-form` flow spec.
  - `docs/status.md`'s M7 milestone row and `docs/privacy-checklist-m7.md` updated: the three
    #68 checkboxes (consent modal, disclaimer, and the public-launch consent-modal item) stay
    **unticked** — this is UI still blocked on M2/M4/M5 hosting it — but each now notes that the
    record, copy bindings, and both components already exist, so what's left is purely hosting
    plus the M4 server-side check.
  - **Corrected a factual error in issue #68 and this checklist**: both claimed the disclaimer
    was "sourced from `knowledge/injury_flags.md`." Checked against both knowledge files —
    `injury_flags.md`'s disclaimer is differently-worded prompt content for the model (it adds a
    "never run through sharp or worsening pain" sentence, among other changes). The shipped
    string, `result.disclaimer.footer`, is sourced verbatim from `knowledge/pace_framework.md`
    instead.
- **The four pending migrations above were applied to the live project and verified — the
  "written but not yet applied" state recorded earlier in today's entries is over.** Ian ran
  `supabase db push` against `v2.3Analysis` (ref `vputdomdlknvthnzritt`), landing
  `20260712040000_analyses_quota_soft_delete.sql` (#2), `20260712123606_frame_upload_ordering.sql`
  (#88), `20260712210000_ai_spend_guardrails.sql` and `20260712210100_ai_spend_guardrail_
  functions.sql` (#91) in one push — 13 migrations total now live, up from 9. Low-risk timing:
  the database is essentially empty (2 auth users, 2 profiles, 0 analyses, 0 consents, 0
  subscriptions, 0 storage objects), which is exactly the situation issue #92 (no non-production
  Supabase environment) predicted this project would stay in until a real feature starts writing
  rows.
  - **`analyses`, verified**: the client-facing DELETE policy is gone; the two remaining
    policies are "Users can view their own analyses" (SELECT) and "Users can soft-delete their
    own analyses" (UPDATE, #2). `has_table_privilege` confirms DELETE, INSERT, and TRUNCATE are
    all revoked for `anon` and `authenticated`; SELECT is retained; UPDATE is column-scoped to
    `deleted_at` only. The `deleted_at` column exists.
  - **RPC signatures, verified**: `reserve_analysis` is the new 4-arg form (`p_media_paths`
    dropped); `settle_analysis` is the new 5-arg form (namespace-guarded `p_media_paths`) — #88's
    signature change landed, and #2 did not overwrite it (#2 never touches either function body).
  - **The predicted overlap between #2 and #88 resolved exactly as designed, confirmed by the
    push log itself**: applying `20260712123606` emitted `NOTICE: policy "Users can delete their
    own analyses" ... does not exist, skipping` — the safe no-op the migration's own header
    comment predicted, because #2 (earlier timestamp) had already dropped that policy. No manual
    reconciliation was needed.
  - **`storage.objects`, verified**: RLS enabled, zero INSERT policies, zero DELETE policies;
    only "Users can view their own media objects" (SELECT) remains — the client cannot write to
    the bucket. **Not closed by this push**: the bucket's table-level `GRANT INSERT`/`GRANT
    DELETE` to `authenticated`, left over from the bucket-creation migration, were never revoked
    — the client is blocked only by the missing RLS policy, not by privilege, so there's no
    defense in depth here the way `analyses` now has. Filed as issue #100 (narrower than
    originally suggested: `storage.objects` specifically, shared across every bucket) — see
    `docs/status.md` Known Issue #18.
  - **Guardrail tables, verified**: `ai_ops_config`, `ai_model_pricing`, and `ai_call_log` all
    exist; `authenticated` can SELECT none of them and cannot EXECUTE `gate_ai_call` —
    service-role only, as designed.
  - **Security advisors: zero warnings, zero errors.** Three INFO-level `rls_enabled_no_policy`
    notices remain, one per `ai_*` table — this is **intentional** (RLS on + zero policies +
    `revoke all` = deny-by-default for operator-only tables) and should not be "fixed" by adding
    a policy later.
  - **Still open, unaffected by this push**: the hard spend ceiling in the Anthropic Console
    (issue #91's one remaining manual step, needs Ian's Console access) and issue #92 itself
    (no non-production environment) — this push went straight to prod precisely because #92
    hasn't been resolved.
  - **Not changed by this push**: the app's upload/analysis flow does not exist yet (#34, #44).
    The schema these four migrations harden is now ready for that flow to be built against; the
    flow itself is still Not Started.
  - `CLAUDE.md`, `docs/status.md` (M4 milestone row, Known Issues #16/#17, new Known Issue #18),
    and `docs/architecture.md` (DB schema, RLS, and AI-guardrail sections) updated to describe
    this as live rather than pending.
- **Built `DELETE /functions/v1/analysis/:id` (issue #57), closing issue #3** (deleting an
  analysis orphaned its Storage frames forever — a privacy defect, not a storage-cost one).
  Written and tested only, on `fix/57` — **not deployed and no migration applied**; see
  `docs/status.md` for exactly what remains before this is live.
  - **Files**: `supabase/functions/_shared/delete-analysis.ts` (pure, injectable orchestration:
    ownership check, prefix purge with pagination + recursion + a post-remove verification
    re-list, HTTP-status/body mapping — fully Deno-tested), `supabase/functions/_shared/
    delete-analysis-client.ts` (the real service-role Supabase/Storage client, untested, same
    split as `ai-guard.ts`/`ai-guard-client.ts`), `supabase/functions/analysis/index.ts` (the
    thin `Deno.serve` entrypoint: method/id validation, JWT verification via
    `auth.getUser()`, wiring), and 19 new Deno tests in
    `supabase/functions/_shared/__tests__/delete-analysis.deno.test.ts`.
  - **No schema change was needed.** Verified live via the Supabase MCP before writing any code:
    `service_role` holds unrestricted table-level grants on both `public.analyses` and
    `storage.objects` (bypasses RLS entirely), so the function reads/writes the row and lists/
    removes Storage objects directly — no new RPC, no migration, and (per this issue's hard
    constraint) `reserve_analysis`/`settle_analysis`/`release_analysis` were never touched.
  - **Ordering: purge Storage first, mark the row deleted second — never the reverse.** If the
    row were marked deleted first and the purge then failed, the analysis would vanish from the
    user's view while its frames (images of a person's body) kept existing in the bucket — the
    exact failure issue #3 exists to close, reached through this function instead of a raw
    client DELETE. Purging first means any failure leaves the row exactly as it was and returns
    `purge_failed` (503, safe to retry) instead of a false "deleted".
  - **The purge is idempotent by construction and always attempted, regardless of the row's
    current `deleted_at`.** This closes two problems with one property: a retried DELETE call
    converges instead of erroring (re-listing an empty prefix is a cheap no-op), and — more
    importantly — `public.analyses` still carries a client-facing soft-delete UPDATE policy
    (issue #2) that a caller can hit directly, bypassing this endpoint and leaving frames
    orphaned. Because this function never gates the purge on `deleted_at`, if the client's UI
    ever does route that same analysis's delete through this endpoint, the orphaned frames get
    purged anyway. **This narrows but does not fully close that gap** — nothing can force a
    client to call this endpoint at all; a scheduled reconciliation job or an async
    trigger-driven purge would close it completely and is a good candidate for a follow-up
    issue, not attempted here (out of scope, and #2's migration is settled).
  - **Purge-then-verify, not purge-and-trust.** After `remove()` reports no error, the code
    re-lists the same prefix and refuses to mark the row deleted if anything is still there —
    proven by a test that makes `remove()` silently drop one path with no reported error.
  - **Authorization is explicit code, not RLS**: `findById` has no ownership filter (the real
    client bypasses RLS by design, same as every other service-role path in this codebase);
    `row.user_id !== callerUserId` is checked in `deleteAnalysis()` itself and proven by a test
    asserting Storage is never even listed for someone else's analysis id. The Storage prefix is
    also always rooted at the *caller's own* id, never the row's, so a wrong/foreign id can only
    ever probe an empty prefix under the caller's own namespace.
  - **Recursion and pagination**: proven against the exact "nested-prefix trap"
    `docs/privacy-checklist-m7.md` names (a flat, non-recursive list "removes nothing, and
    orphans every frame — while reporting success") with a test asserting a nested folder under
    the prefix is still purged, plus a pagination test across multiple `list()` pages.
  - **Verification run**: `npm run typecheck && npm run lint && npm test` clean — `tsc --noEmit`,
    `deno check` (12 files, including the 2 new source files + new test file), `expo lint`, 207
    Jest tests (unchanged), and 29 Deno tests (19 new + the pre-existing 10) all pass.

- **A failed Google OAuth exchange is no longer a silent no-op (closes #5).** Root cause was
  two-fold. First, `lib/session-provider.tsx`'s Linking listener — the deep-link fallback path
  for a redirect that arrives outside `signInWithGoogle`'s own awaited call — discarded every
  exchange failure with a bare `.catch(() => {})`; nothing else was watching that path, so the
  failure had nowhere to go. Second, `lib/auth.ts`'s dedupe guard against the Android
  double-delivery race (the same redirect reaching `createSessionFromUrl` more than once
  concurrently) marked a code "processed" in a `Set` *before* the exchange resolved and never
  unmarked it on failure — so the race's loser silently got `null` back (read by
  `app/(auth)/sign-in.tsx` as "user cancelled") even when the winner's exchange had actually
  thrown.
  - `lib/auth.ts`: the `Set` is replaced with a `Map<code, Promise<Session | null>>` of in-flight
    exchanges. Every concurrent caller racing the same code now awaits the identical promise and
    gets the identical outcome — success or the real rejection, never a silent `null` — and the
    entry is evicted once the exchange settles, so it can't grow unbounded either. Provider-
    reported redirect errors (`?error=access_denied` etc.) now throw a typed `OAuthRedirectError`
    (`lib/auth-errors.ts`) instead of a plain `Error`, so the message doesn't have to be
    pattern-matched later.
  - `lib/session-provider.tsx`: the Linking listener's catch now maps the error (`mapAuthError`)
    into a new `deepLinkAuthError` on `SessionContextValue`, plus a `clearDeepLinkAuthError()`.
    Safe to always surface — `createSessionFromUrl` only ever throws for a URL that really was
    part of an auth redirect; it returns `null`, not a rejection, for any unrelated deep link.
  - `lib/auth-errors.ts` (`mapAuthError`): two new typed branches. `OAuthRedirectError` with
    `code === 'access_denied'` → `Copy.auth.error.signInCancelled` (the user declined on the
    provider's own consent screen — a decision, not a break, but delivered through a different
    channel than `WebBrowser`'s cancel/dismiss result, so it can't stay silent the way a plain
    browser-cancel does). Any other provider code, plus `AuthPKCECodeVerifierMissingError` /
    GoTrue's `flow_state_not_found` / `flow_state_expired` / `bad_code_verifier` /
    `bad_oauth_state` / `bad_oauth_callback` (a lost or no-longer-matching PKCE verifier — the
    verifier lives in client storage, so this is a real failure mode, not a hypothetical one) →
    `Copy.auth.error.signInExpired`. Everything else (bad/expired code, network) still falls
    through to the existing `Copy.auth.error.generic`, unchanged.
  - `app/(auth)/sign-in.tsx` reads `deepLinkAuthError` from `useSession()` alongside its own local
    `errorMessage` (`errorMessage ?? deepLinkAuthError`) and clears both together on every new
    attempt, so a stale message from a previous failure can't linger into the next one.
  - New copy: `Copy.auth.error.signInCancelled` ("Sign-in was cancelled.") and
    `Copy.auth.error.signInExpired` ("Sign-in expired before it could finish. Try again.") —
    both provider-neutral, since Apple sign-in (`auth.cta.apple`) will reuse the same
    `createSessionFromUrl` path once it ships. Added to `constants/copy.ts` and
    `docs/design/copy-deck.md` (Screen 1).
  - Tests: `lib/__tests__/auth.test.ts` (new) locks `createSessionFromUrl`'s contract directly —
    a URL with no `code`/`error` still resolves `null`, a provider error throws
    `OAuthRedirectError`, and the race-condition fix specifically: concurrent callers on the same
    code share one exchange call and get the identical resolution *or* the identical rejection.
    Verified this last case is load-bearing by reimplementing the old `Set`-based dedupe
    standalone and confirming it fails that exact assertion (the race's loser resolves `null`
    instead of rejecting). `lib/__tests__/auth-errors.test.ts` extended with the two new
    `mapAuthError` branches, including every `FLOW_STATE_ERROR_CODES` entry individually and a
    negative case for an unrelated `AuthApiError` code.

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
