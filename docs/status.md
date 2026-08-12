# Status

Where the project actually is, updated whenever a milestone's status moves. See
[`CLAUDE.md`](../CLAUDE.md), [`docs/change_log.md`](change_log.md), and
[`planning/02-product-requirements.md`](../planning/02-product-requirements.md) for the
milestone "done" criteria.

## Milestones

| Milestone | Status |
|---|---|
| M1 — Foundation (sign-up creates an account → empty Home) | **Done 2026-07-11** — security audit (no Critical/High) + code review (5 findings fixed), gate passed with Ian's on-phone sign-up test; merged via PR from `feat/m1-spine` |
| M2 — Capture (upload-from-library and in-app record both hand a valid, budget-compliant frame set to analysis on iOS) | Screens built (issue #36, `fix/36`, 2026-07-12) — source picker, in-app muted record + framing guide, permission-denied states, and honest extraction progress; see `docs/architecture.md`'s "Current — capture screens (issue #36)". Not fully closed: issue #37 (frames.ts test coverage) and issue #112 (frame timestamp accuracy) are still open, and Home's CTA isn't wired to `/capture` yet (a deliberately flagged gap, not this issue's scope — see the same architecture.md section). Issue #35 (direct-to-bucket upload) is superseded by #88's live contract and should not be built as originally scoped. **FIXED 2026-07-26 — extraction was capping paying users at the free tier.** `app/capture/extracting.tsx` hardcoded `EXTRACTION_TIER = 'free'`, so every Pro/Elite **video** was extracted to Free's 1 frame; Cadence and Elasticity cannot be scored from a single still, so a paying user's analysis was silently degraded to the free product. The cap now comes from `quota-status`'s authoritative `frameCap` via new `lib/extraction-frame-cap.ts` (never a client-side `PACE_FRAME_CAP[tier]` lookup — CLAUDE.md: the client is never the authority for a frame cap), `extractFrames` takes a resolved `videoFrameCap: number` instead of a tier, and a failed/unauthorized/slow lookup degrades to the free cap deliberately, never upward. Photos are unaffected (always 1 frame, no quota call). Covered by `lib/__tests__/extraction-frame-cap.test.ts` plus end-to-end screen locks in `app/capture/__tests__/extracting.test.tsx`. |
| M3 — Knowledge grounding (prompt provably includes PACE framework text; output references PACE pillars) | **In progress** — the grounded prompt, tier verbosity dial, and structured-output contract landed 2026-07-12 (issue #41, `supabase/functions/_shared/analyze-form-prompt.ts`, 28 Deno tests, **no live model call made**), unblocking M4's #44/#45. The milestone's own gate — "prompt *provably* includes the framework text" — is proven statically today (the three certified files are asserted present **byte-for-byte** in the assembled prompt); proving the *output* references the PACE pillars still needs #42's live-call eval harness. Still open: **#39** (Ian certifies Elasticity + the pillar refinements — the prompt ships his name) and **#40** (the runner's-note guidance in `injury_flags.md`) — **re-verified 2026-07-25: #40's functional requirement is fully met and tested.** `INPUT_CHANNEL_RULES` in `analyze-form-prompt.ts` is wired into the assembled prompt and explicitly tells the model there is no runner's note and to treat every note-conditional clause in the certified files as inactive; `analyze-form-prompt.deno.test.ts` asserts the "There is NO runner's note" text is present. No prompt content instructs the model to weight a runner's note for the MVP path. What remains open is cosmetic only: the certified `injury_flags.md` file itself still reads "if the note reports…" in its own prose — editing that wording is a certified-content change per #39's constraint and needs Ian's sign-off, not an agent's; the file is otherwise inert on this point because the prompt layer already overrides it. |
| M4 — Analysis engine (photo/video → valid PACE result; malformed responses never reach the user) | **In progress — the full path ran end to end against the live project 2026-07-26 (issue #128).** The AI spend guardrail substrate it must build behind (kill switch, daily cap, circuit breaker, per-call ledger; issue #91) landed 2026-07-12 and was **applied to the live project the same day** (`supabase db push`, verified — see Known Issue #17). Only the manual Anthropic Console spend ceiling remains open. **The Analyzing screen (issue #80) shipped 2026-07-12**, built entirely against the documented `analyze-form` contract via an injectable `AnalyzeFormClient` seam (`lib/analyze-form.ts`). **UPDATED 2026-07-26 (issue #128):** the `analyze-form` edge function (#44) is built AND **deployed** to the live project, and that seam is now bound to the **real** client — the dev mock is kept but `__DEV__`-guarded so it throws in a release bundle, mirroring `lib/delete-account.ts`. Verified live end to end: `public.analyses` went from zero rows ever to a `delivered` row with a valid PACE result and one frame in the private bucket. See `docs/architecture.md`'s corresponding section and Known Issue #35. |
| M5 — Tiers & quotas (quota unbypassable server-side; paywall shows at the right moments) | Not started — except `GET /functions/v1/quota-status` (issue #50), written and Deno-tested on `fix/50` 2026-07-12, **not deployed**; its `pace_quota_status` DB function is written but **not applied** to any database. See `docs/architecture.md`'s "Current — `GET /functions/v1/quota-status` (issue #50)" section. **`POST /functions/v1/purchase-tier` (issue #51) joined it 2026-07-13** — written and Deno-tested on `feat/51-purchase-tier`, **not deployed**; its `pace_purchase_tier` DB function is written but **not applied** to any database. It is the only legitimate writer to `subscriptions` (no client-writable INSERT/UPDATE policy was added — the Echo V1 mistake stays closed — and the default grant-all to `authenticated`/`anon` was revoked on both `subscriptions` and `profiles`), and a repurchase is idempotent: `purchased_at` is written once, on first purchase, and never moved, so replaying a purchase cannot reset a user's quota period. **Hardened 2026-07-13 after a security audit (PR #123): the function is gated behind `PURCHASE_TIER_DUMMY_ENABLED` (default OFF) — see Known Issue #21, a release blocker.** See `docs/architecture.md`'s "Current — `POST /functions/v1/purchase-tier` (issue #51)" section. **Every M5 screen now exists (2026-07-13)**: `app/paywall.tsx` + `lib/subscription.ts` (issue #52) is the dummy paywall, display-only by construction — no tier limit or frame cap is hardcoded, every count is read fresh off `quota-status`, locked by a regression test — and Home's quota-aware CTAs are real (issues #54/#15: the client-side quota mirror is deleted, replaced by one `lib/quota.ts` call to `quota-status`; exhausted CTAs now open the real Paywall route). See `docs/architecture.md`'s "Current — `app/paywall.tsx`" and "Current — Home quota" sections. **UPDATED 2026-07-26:** `purchase-tier` and `quota-status` are now **deployed** to the live project, and both `pace_quota_status` and `pace_purchase_tier` were found **already applied** to the live database (this row's earlier "not applied to any database" claim was stale — all 24 repo migrations are present). `PURCHASE_TIER_DUMMY_ENABLED=true` was set by captain decision — see Known Issue #21, now **RESOLVED 2026-08-06**: both `PURCHASE_TIER_DUMMY_ENABLED` and `PURCHASE_TIER_ALLOWED_USER_IDS` are unset on the live project. A second root cause found the same day — every authenticated edge function returning `401` to valid JWTs — was **the shared key parser misreading the platform's JSON-object key format** (`{"default":"sb_..."}`) as an array and falling through to the raw JSON string; **fixed in `_shared/supabase-keys.ts` and verified live**: a dummy purchase now grants pro (10/5) then elite (30/8), confirmed through `quota-status` and the `subscriptions` row, with `purchased_at` unmoved on repurchase. See Known Issue #35. |
| M6 — Past Analyses (results + stored frames persist and re-open; delete purges both row and storage objects) | **In progress — gained a real screen 2026-07-13.** `DELETE /functions/v1/analysis/:id` (issue #57, closing #3) is written, Deno-tested, and **confirmed DEPLOYED** (corrected 2026-07-13 — every earlier note here and in `docs/architecture.md` calling it "not deployed" was stale; see Known Issue #27 for the drift and why it matters). **It now also purges Storage a second time after the row is marked deleted (issue #132, 2026-07-13)**, closing the delete-during-upload orphan window issue #130 narrowed — see the (resolved) Known Issue #26 below; **redeployed 2026-07-26, so that code is live** (Known Issue #27). See Known Issue #19 for the residual gap #57 narrows but does not close. **`app/(tabs)/history.tsx` (issues #55/#12, 2026-07-13)** is the Past Analyses screen itself — list, per-row not-assessed/no-thumbnail states, delete, and a tab-bar chrome fix (partial — see Known Issue #28). Also `POST /functions/v1/delete-account` (issue #58), written and Deno-tested on `feat/58-delete-account` 2026-07-13, **deployed and verified live 2026-07-26** — see Known Issues #22 and #35. Its account-level storage sweep is bounded-concurrency and resumable (issue #125, 2026-07-13), and it now also requires recent reauthentication (issue #124, 2026-07-13) — see Known Issue #22's updated sub-bullets. The client (`lib/delete-account.ts`) has been bound to the real function since PR #122 (2026-07-13) — see Known Issue #23. The Elite Compare screen (issue #60) was built but unreachable from navigation until the 2026-08-07 comprehensive audit wired a "Compare two analyses" entry point into History — see `docs/architecture.md`'s "Current — Past Analyses" section. |
| M7 — Polish & TestFlight (stranger can go sign-up → analysis → result without a dead end) | **In progress — gained real offline/a11y/consent/recovery work 2026-07-13. UPDATED 2026-07-26: M4's `analyze-form` IS deployed and the full sign-up → analysis → result path ran end to end against the live project (issue #128), so this milestone's own gate is now testable rather than blocked; what remains is the polish/TestFlight work itemised below plus the release blockers in Known Issues #21 and #31.** The privacy slice of issue #68 landed 2026-07-12: privacy policy drafted (publication **on hold**, see Known Issue #15), App Store label answers recorded, no-analytics-SDK re-confirmed. **The Art. 9 consent gate is now two-phase (issues #68 restatement + #94, 2026-07-13)**: health consent + a new 16+ age checkbox are once-ever; a "who is in this photo?" subject attestation is now asked on every upload, never skippable — see `docs/architecture.md`'s "Current — the two-phase consent gate" section. Server-side enforcement is still a binding M4 requirement — see Known Issue #14. **Connectivity detection landed 2026-07-13 (issue #93)**: a global offline banner is live, and the pre-flight gate before an `analyze-form` submit IS wired (`app/analyzing.tsx`) — corrected 2026-08-07, this row previously called the gate unwired; see Known Issue #30 (RESOLVED). **One `AppState` listener with foreground reconciliation landed 2026-07-13 (issues #10/#64)**: a backgrounded-then-foregrounded analysis recovers; a process kill does not — see Known Issue #29. **Password reset landed 2026-07-13 (issue #81)** — no privacy-label or consent implication, a pure account-recovery gap closed. **Sign-in a11y and hierarchy polish landed 2026-07-13 (issues #16/#20/#28/#11)**, including the first iOS `AccessibilityInfo.announceForAccessibility` usage in the repo. **`.maestro/` E2E flows for the M7 no-dead-end gate were written 2026-07-13 (issue #86) but never run** — see Known Issue #31. The repo gained its **first CI workflow** 2026-07-12 — a daily scheduled canary for the HIBP check, not a PR gate — narrowing issue #74. **A second workflow, `.github/workflows/ci.yml` (issue #82, 2026-07-13), is the repo's first actual commit gate** — typecheck/lint/test on every push and PR to `main`, previously enforced by convention only; see `docs/architecture.md`'s "Current — CI" section for both. **The M7 full-app accessibility re-audit landed 2026-07-25 (issue #62)**: now that M2–M6 screens all exist, `accessibility-reviewer`° → `accessibility-implementer` swept the whole app against the design-brief §7 floor and fixed 5 defects, most notably `components/pace-readout.tsx`'s `PillarRow` collapsing its entire feedback/flags/drills body into one opaque VoiceOver node on every result screen — see `docs/a11y-audit-62.md` for the full defect list and `docs/change_log.md`'s 2026-07-25 entry. |

## Done so far

- **Settings screen (issue #53, 2026-07-13), which also closes #27.** `app/settings.tsx` — a
  top-level pushed route (not a tab), declared inside the signed-in `Stack.Protected` block, reached
  from Home's header. Carries Account (email), Plan (tier — display-only), Sign out, Delete account,
  and the #68 privacy restatement + consent-withdrawal path (the first caller `withdrawConsent` has
  ever had). **#27 is fixed here, in its final home** — and, per a same-day security audit on PR
  #122, fixed correctly against all THREE real outcomes `supabase.auth.signOut()` can leave a
  device in, not the two the first version of the fix assumed (`lib/sign-out.ts`, tested; see that
  file's header for the auth-js source citation behind the third state). **Delete account calls the
  real `delete-account` edge function** (`lib/delete-account.ts`) — also corrected the same audit
  pass, after the original mock binding turned out to have no owner ever assigned to swap it for a
  real one. Two caveats, both tracked as Known Issues below: the edge function it calls (#58/#121)
  is **built but not yet merged or deployed** (#22), and the screen ships **uncertified copy**
  needing review (#24). The privacy policy is deliberately **not linked** — it is still
  `DO NOT PUBLISH`.
- Expo SDK 54 app scaffolded (expo-router template, TypeScript strict, `@/*` path alias ->
  `./*`; no `src/` in this project — code lives at the repo root in `app/`, `components/`,
  `constants/`, `hooks/`).
- Supabase project `v2.3Analysis` (ref `vputdomdlknvthnzritt`, region `ap-southeast-2`, org
  `Echo_Running_Final`, Free plan) provisioned; `google` and `email` auth enabled (`apple` and
  `anonymous_users` remain off).
- `typecheck` and `test` npm scripts added; `jest.config.js` (jest-expo preset,
  `passWithNoTests: true`) and `jest.setup.js` (AsyncStorage mock) in place — no test files
  exist yet.
- `.env` populated and verified: Expo's loader exports `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and no Google client-ID vars (the browser OAuth flow
  keeps those in the Supabase dashboard). `.env` is gitignored, so `docs/change_log.md` is the
  only record of changes to it.
- Planning docs complete: `planning/01-brainstorm.md`, `02-product-requirements.md`,
  `03-engineering-requirements.md`, `planning/README.md`.
- **Phase 0.5 (the design layer) complete 2026-07-11.** All four remainder items landed:
  `docs/design/copy-deck.md` (full copy deck, every screen state), `constants/theme.ts` +
  `constants/contrast.ts` rebuilt from the brief's §2 tokens with a 61-assertion Jest proof
  every text/surface and band pair clears WCAG AA, `docs/design/motion-consult.md` (motion
  feasibility addendum, binding alongside brief §6), and `docs/privacy-checklist-m7.md` (ranked
  privacy/compliance checklist for M7). Font families installed via `npx expo install`
  (`@expo-google-fonts/archivo`, `inter`, `ibm-plex-mono`); `expo-font` plugin auto-added to
  `app.json`. The only Phase 0.5 item still open is **Ian's certification review of the
  Elasticity content** (see Known Issue #5).
- **Real app icon + splash art landed 2026-07-12**, replacing the Expo template defaults —
  closes GitHub issue #26. The "Gait Plate" mark (design brief §1) is versioned SVG source in
  `assets/source/`, rasterized to the PNGs `app.json` points at via `npm run assets`
  (`scripts/generate-app-assets.js`, new `sharp` devDependency). See
  `docs/architecture.md`'s "app icon & splash assets" section for the full pipeline, including
  the no-alpha `icon.png` rule and why a dedicated dark-mode splash mark exists.
- **EAS project initialized 2026-07-12** — config groundwork only, not a working release
  pipeline; see Known Issue #7 below and `docs/architecture.md`'s "EAS build & release config"
  section. The TestFlight half is tracked in
  [`docs/blocked-on-apple.md`](blocked-on-apple.md).
- **Everything gated on the Apple Developer Program lives in
  [`docs/blocked-on-apple.md`](blocked-on-apple.md)**, not in the GitHub tracker (as of
  2026-07-12). The open-issue list is deliberately kept to work that is actionable today.
- **First CI workflow landed 2026-07-12** — `.github/workflows/hibp-canary.yml`: a daily
  scheduled cron (not a PR gate) that runs `lib/__tests__/hibp.canary.test.ts` against the live
  HIBP endpoint, opening/updating a labelled `security` issue on 3 consecutive failures and
  auto-closing it on recovery. Narrows issue #74 to its remaining device-side residue (captive
  portals, Cloudflare challenging React Native's user-agent) — still deferred to whenever
  `observability-setup` work happens, and **Sentry is actively contraindicated** there (its
  breadcrumbs would fingerprint the passwords `lib/hibp.ts` protects). See
  `docs/architecture.md`'s "Current — CI" section.
- **Issue #70 closed 2026-07-12 — server-side leaked-password protection is genuinely fixed, not
  just mitigated.** The blocker (org on the Supabase Free plan; enabling
  `password_hibp_enabled` returned HTTP 402 during the M1 audit) is gone — `Echo_Running_Final`
  is now on the **Pro plan**, and `password_hibp_enabled = true` was applied live and verified: a
  breached password hard-fails `signUp` with HTTP 422 / `reasons: ['pwned']`, a strong one still
  succeeds, and **the project's security advisor list is now completely empty (zero findings)** —
  the `auth_leaked_password_protection` lint that was the project's one remaining finding is
  gone. `lib/hibp.ts` (the client-side k-anonymity pre-check) is **deliberately kept**, but its
  role changed: it's a fast UX pre-check and defense-in-depth now, not the enforcement point —
  the server is. New `lib/auth-errors.ts` (`mapAuthError`, extracted from `sign-in.tsx` for real
  unit-test coverage, 8 tests) maps the server's typed rejection to
  `Copy.auth.error.passwordBreached`. The `hibp-canary` workflow gained a second assertion that
  `password_hibp_enabled` stays `true` — currently **unarmed pending a `SUPABASE_ACCESS_TOKEN`
  repo secret**, so it fails loudly rather than silently passing. See `docs/architecture.md`'s
  "Current — Supabase config" section and `docs/blocked-on-apple.md`'s resolved-issues table.
- **AI spend guardrails substrate landed 2026-07-12 (issue #91)** — the kill switch, global
  daily $ cap, circuit breaker, and per-call token/cost ledger `analyze-form` (#44) will be
  forced through, built *before* #44 exists on purpose (see the design spec,
  `docs/superpowers/specs/2026-07-12-ai-spend-guardrails-design.md`). Two migrations
  (`ai_ops_config` / `ai_model_pricing` / `ai_call_log` tables + `gate_ai_call` /
  `record_ai_call` / `ai_breaker_state` / `ai_spend_today` RPCs, all `service_role`-only) and a
  Jest-tested TypeScript interface (`supabase/functions/_shared/ai-pricing.ts`, `ai-guard.ts`,
  `ai-guard-client.ts`). **Applied to the live project 2026-07-12** (`supabase db push`,
  alongside #88's and #2's migrations) and verified: all three `ai_*` tables exist,
  `authenticated` can SELECT none of them and cannot EXECUTE `gate_ai_call` (service-role only,
  as designed), and the security advisors show only three INFO-level `rls_enabled_no_policy`
  notices, one per `ai_*` table — intentional (RLS on, zero policies, `revoke all` = deny-by-
  default for operator-only tables), not a gap to fix. Full detail: `docs/architecture.md`'s
  "Current — AI spend guardrails substrate" section. **Still open, and not something this work
  could do from the repo: the hard spend ceiling in the Anthropic Console** — see Known Issue
  #17.
- **Edge-function build/test contract closed 2026-07-12 (issue #90).** Three previously-unowned
  gaps that #41/#43/#44/#49/#59 all silently assumed: (1) **a Deno runner** —
  `supabase/functions/deno.json` + `npm run typecheck:edge` (`deno check`) / `npm run test:edge`
  (`deno test`), folded into `npm run typecheck` / `npm test` so the CLAUDE.md gate now covers
  edge code for the first time; `deno check` immediately caught and fixed a real, previously
  invisible type bug in `ai-guard-client.ts` (issue #91)'s `rpc()` return type. (2) **`lib/pace.ts`
  moved to `supabase/functions/_shared/pace.ts`**, the single source of truth for the app and the
  edge function with no copy/codegen/symlink — the app imports it via a new `@shared/*` tsconfig
  alias; `ScoreBand` is now an inline copy (Deno can't resolve `constants/theme.ts`), drift-locked
  by a Jest test that fails if the two ever disagree. (3) **The three `knowledge/*.md` files are
  now codegenned into `supabase/functions/_shared/knowledge.generated.ts`**
  (`npm run generate:knowledge`), the single mechanism that gets them into the deploy bundle at
  all (`supabase functions deploy` only bundles `supabase/functions/`). Every constant is wrapped
  in `assertNonEmptyKnowledge()`, which throws at module load if a bundle is ever empty or
  whitespace — verified live by deliberately emptying a constant and confirming `deno test` fails
  loud. A `git diff --exit-code` drift check (`npm run verify:knowledge`, part of `test:edge`)
  fails the build if `knowledge/*.md` is edited without regenerating — verified live the same way.
  Full detail: `docs/architecture.md`'s "Current — Deno build/test contract, pace.ts location &
  knowledge bundling" section.
- **M2 capture screens landed 2026-07-12 (issue #36)** — source picker, in-app muted record with
  the side-on framing guide, permission-denied states for both camera and photo library, and
  honest frame-extraction progress (`app/capture/{index,record,extracting}.tsx`), built against
  `lib/frames.ts` (#34) and the live #88 no-client-upload contract. New tested `lib/` logic:
  `media-caps.ts`, `media-file-size.ts`, `permission-state.ts`, `parse-capture-params.ts`. Full
  detail, including the known gaps this issue does not close (Home's CTA not yet wired to
  `/capture`; #37/#112 still open): `docs/architecture.md`'s "Current — capture screens (issue
  #36)" section.
- Full dated history: [`docs/change_log.md`](change_log.md).

## Known issues

1. ~~**Final app name not picked.**~~ **RESOLVED 2026-07-11**, spacing corrected 2026-08-06
   (`wordmark-rename-scope`, option b). Name is **"Pace Analysis AI"**
   (repo/directory keeps the "V2.3" codename internally). `app.json` updated: `name`
   "Pace Analysis AI", `scheme` "paceanalysisai".
2. ~~**`app.json` slug `v2.3-photo-video-analysis` fails `expo-doctor`**~~ **RESOLVED
   2026-07-11.** `slug` fixed to `pace-analysis-ai` (dots removed); `ios.bundleIdentifier` and
   `android.package` both set to `com.ian.paceanalysisai` (follows V2.2's `com.ian.*`
   precedent).
3. **Sign in with Apple is not yet possible**: `expo-apple-authentication` is not installed,
   and `apple` is off on the live Supabase project's auth settings. **Decision recorded
   2026-07-11**: build email + Google sign-in in M1 now; add Apple Sign-In the moment an Apple
   Developer account exists, before TestFlight review — the App Store gate is never actually
   hit because Apple is added ahead of submission. Owner: user (needs an Apple Developer
   account). Tracked in [`docs/blocked-on-apple.md`](blocked-on-apple.md), not as a GitHub
   issue.
4. ~~**`ANTHROPIC_API_KEY` is not set anywhere yet**~~ **RESOLVED 2026-07-11.** Ian rotated the
   key; it's in the gitignored `supabase/functions/.env` for local dev and pushed to production
   via `supabase secrets set` (verified present in the secrets list). The M4 blocker is gone.
5. ~~**Knowledge files not yet copied in.**~~ **DONE 2026-07-10.** `knowledge/pace_framework.md`,
   `injury_flags.md`, and `drills.md` now exist — Posture/Arm-swing/Cadence adapted from the ECHO
   library and refined against cited literature; **Elasticity authored from peer-reviewed sources**
   (citations in `pace_framework.md`). **Pending: Ian's certification review** of the Elasticity
   content + refinements before M3 ships (it carries his name).
6. ~~**Private Storage bucket for media not yet created**~~ **RESOLVED 2026-07-11.** The private
   `media` bucket (5MB/object cap, `image/jpeg` only) is live with owner-scoped `storage.objects`
   RLS (first path segment = `auth.uid()`), applied via migration and confirmed by the security
   advisors clean.
7. ~~**EAS project not initialized** (`eas init` not run). No TestFlight pipeline exists yet.~~
   **SPLIT 2026-07-12, half resolved.** The config half is done: `eas init` created the EAS project
   (`@ianbeatingpros/pace-analysis-ai`, `extra.eas.projectId` in `app.json`), `eas.json` has four
   build profiles (`development`, `development-device`, `preview`, `production` +
   `submit.production`), and the Supabase env vars are pulled into all three EAS environments —
   see `docs/change_log.md` 2026-07-12 and `docs/architecture.md`'s "EAS build & release config"
   section. **The pipeline half is still blocked**: there is no Apple Developer account, so there
   are no iOS credentials, no `eas build` for a device or the App Store, no `eas submit`, and no
   TestFlight pipeline. `development`'s `ios.simulator: true` is what makes an iOS build possible
   at all today; `development-device` (`ios.simulator: false`, needs an ad-hoc provisioning
   profile) is written but unusable until the account exists — same dependency as Known Issue #3.
   This is groundwork only: **M7 stays Not started**. The TestFlight/pipeline half is tracked in
   `docs/blocked-on-apple.md`, not as a GitHub issue; only the icon/splash half (GitHub issue #26)
   closes with this work. Owner: user (needs an Apple Developer account).

   **Carries a required follow-on:** the first dev build is what unblocks
   [issue #69](https://github.com/IanQiu979/v2.3_RunningFormAna/issues/69) — remove `exp://**`
   from the Supabase redirect allowlist. It cannot be done before then: under Expo Go,
   `lib/auth.ts`'s `makeRedirectUri` resolves to `exp://<LAN-IP>:8081/--/…`, so dropping that
   entry breaks Google sign-in on-device. Do it in the same pass as the dev build, while the
   custom `paceanalysisai://` scheme is confirmed working. This does **not** need an Apple
   Developer account — `development`'s `ios.simulator: true` build is enough to retire Expo Go.

   **PARTIAL PROGRESS 2026-08-06 (decision `google-auth-fix-path`, option A) — the dev build now
   exists; the on-device confirmation this note requires does not yet.** `eas build --profile
   development --platform ios` (build `c424ce3d-0014-4b8a-a62b-f80b8a6240c4`, iOS Simulator,
   `eas.json`'s `development` profile — no changes needed, it was already correctly shaped:
   `developmentClient: true`, `ios.simulator: true`, `environment: development`) built clean and
   was installed and launched on an iOS 17 Pro simulator via `eas build:run`. It came up on the
   Expo dev-client launcher (pointed at a local `expo start --dev-client` Metro server) with no
   crash and no white screen — confirms the dev-client binary itself is sound. **Verified live,
   server side, before touching anything:** the hosted project's `uri_allow_list` already contains
   `paceanalysisai://oauth-callback` and `paceanalysisai://**` (queried via the Management API
   `GET /v1/projects/vputdomdlknvthnzritt/config/auth`, not assumed from `config.toml`), Google is
   `external_google_enabled: true` with a real `client_id`/`secret` on file (not placeholders), and
   `exp://**` is still present, unchanged — correctly, since the next paragraph is exactly the
   precondition for removing it. **What did NOT get confirmed this pass:** actually tapping through
   the dev-client launcher to the sign-in screen and pressing "Continue with Google" to observe the
   browser session open and the redirect land back in-app. The agent doing this build had no
   working way to simulate a tap/click on this machine's simulator — `osascript`/System Events GUI
   scripting returned error `-25204` (Accessibility permission not granted to the calling process),
   and `cliclick`'s synthetic mouse events had no visible effect either, most likely blocked by the
   same missing permission. A full-desktop screenshot taken while debugging the coordinates showed
   this machine's screen is shared with unrelated windows and personal content, so that debugging
   path was abandoned rather than pursued further — coordinate-guessing against a screenshot that
   captures things outside this task's scope is not an acceptable verification method here. Auth
   logs (`get_logs`, service `auth`) were checked before and after and show no new events at all in
   this window — consistent with no OAuth attempt having reached the server, not with one
   succeeding or failing. **Net effect: the white-screen root cause (issue #69) has a real,
   verified-correct fix in place (dev build + already-allowlisted custom-scheme redirect + real
   Google credentials), but "confirmed working" — the condition this note itself sets for dropping
   `exp://**` — is still open.** Do not remove `exp://**` until a human (or an agent with working
   simulator input) actually taps through one real Google sign-in on this build and confirms the
   redirect resolves back into the app. To do that by hand: the dev-client build is installed on
   the booted "iPhone 17 Pro" simulator, `npx expo start --dev-client` is running in this repo
   (Metro on `localhost:8081`) — open the Simulator, tap the `localhost:8081` row on the launcher
   screen, then use the app's normal sign-in screen.
8. **Echo V1's Supabase project** (`IanQiu979's Project`, ref `trgpnnyqonaxhnyhtmlz`) is
   **paused**, which is what freed the Free-plan slot for `v2.3Analysis`. 90-day restore
   window from 2026-07-10.
9. **Free-tier storage is 1 GB with 5 GB/month egress.** Media retention is now **frames only**
   (a few hundred KB per analysis, not the 60–130MB a full video would cost — see Ruling 1 in
   `docs/mvp-build-prompt.md`), which keeps this viable through the MVP; still worth watching
   before real-user scale.
10. ~~**The "runner's note" conflict**~~ **RESOLVED 2026-07-11: dropped for MVP.** Ian decided
    the analysis runs on frames alone — no free-text note field ships. The note-handling
    guidance in `knowledge/injury_flags.md` is **dormant** for MVP: M3's prompt adaptation must
    exclude/neutralize the note-dependent instructions (with Ian's certification review, since
    it's certified content), and no note field enters the `analyze-form` contract. Revisit
    post-TestFlight; if it ships later it's a health-data channel needing its own consent line
    and privacy-label entry (see `docs/privacy-checklist-m7.md`).
11. ~~**Paywall pricing**~~ **RESOLVED 2026-07-11: Pro $6.99 / Elite $14.99 per month** —
    display prices for the M5 dummy paywall (no real payment processes in v1; real IAP can
    re-decide). Recorded in `docs/design/copy-deck.md` §Paywall.
12. ~~**CAPTCHA required before `analyze-form` (M4) goes live.**~~ **RESOLVED 2026-08-02/03.**
    The M1 security audit found the hosted Supabase project has **no signup rate-limit field at
    all** (`sign_in_sign_ups` in `config.toml` is CLI/self-hosted-only; the Management API
    silently drops it on a hosted project) and `mailer_autoconfirm` is deliberately on for M1 (no
    transactional email provider or confirmation-pending screen exists yet). Combined, each
    disposable signup was unthrottled and worth ~4 potential Anthropic calls once M4 shipped
    (Free tier's 1 lifetime analysis × farmable accounts), which it now has.
    **Not fixed via `auth.captcha`, on purpose.** Ian created a Cloudflare Turnstile widget and
    provided real site/secret keys; native `auth.captcha` was enabled live and reverted within
    minutes: it's project-wide, not per-endpoint — enabling it also 400s
    `signInWithPassword` (sign-in), not just `signup`, confirmed by direct testing against the
    live project. There is no server-side knob to scope it to signup only, so it stays disabled,
    permanently, in `supabase/config.toml`.
    **The actual fix: `supabase/functions/signup-with-captcha`.** It verifies the Turnstile
    token server-side (`_shared/captcha.ts`, Cloudflare's siteverify API) and, only if that
    passes, proxies a plain, unprivileged `supabase.auth.signUp()` call — so
    `minimum_password_length`/`password_hibp_enabled` keep being enforced exactly as before, and
    sign-in (`signInWithPassword`, called directly, unchanged) never sees a captcha requirement.
    `app/(auth)/sign-in.tsx` renders a WebView-hosted Turnstile widget
    (`components/turnstile-widget.tsx`) only in sign-up mode. `TURNSTILE_SECRET_KEY` is set via
    `supabase secrets set` on the hosted project; the local dev stack and `eas.json`'s
    `*-local` build profiles use Cloudflare's public "always passes" test key pair instead of the
    real one. Deployed to the live project and verified: signup is rejected with `captcha_invalid`
    given a garbage token, and with `invalid_body` given no token at all. The "succeeds with a
    valid token" path is proven by the full test suite (fake `CaptchaVerifier` returning `true` →
    real `signUp` proxy → session returned) — no browser-automation tool was available in this
    session to solve a live Turnstile challenge end-to-end, which would be the only way to prove
    stronger than that; same "honest ceiling" caveat `purchase-tier.deno.test.ts`'s header
    documents for its own untestable-live-Postgres case.
13. ~~**Session storage is plaintext AsyncStorage today**~~ **RESOLVED 2026-07-12 (issue #38).**
    `lib/supabase.ts` now passes `storage: secureSessionStorage` (`lib/secure-storage.ts`), the
    "LargeSecureStore" pattern: an AES-256 key lives in SecureStore (Keychain/Keystore-backed,
    64 hex chars — provably under the 2048-byte SecureStore value limit regardless of session
    size), and the AES-CTR-encrypted session blob lives in AsyncStorage. **Hardened on the same
    branch after review**: the key is created once and reused (not regenerated per write) —
    SecureStore and AsyncStorage can't be written atomically as a pair, so a fresh-key-per-write
    design left every `setItem` a two-store transaction a torn write (app killed mid-write, disk
    full) could interrupt, pairing a new key with an old blob or vice versa; AES-CTR does not
    error on that mismatch, it produces well-formed-looking garbage. With the key stable, a torn
    write is only possible on the very first write for a storage key (after that, every write
    touches only AsyncStorage); CTR safety instead comes from a fresh random IV per write
    (prepended to its ciphertext) plus a per-key async lock so two concurrent first-writes can't
    mint two different keys. `getItem` also stopped trusting a decrypt just because it didn't
    throw — a `JSON.parse` validity check catches the wrong-key/IV "successful" garbage decrypt
    — and on any unrecoverable blob, clears the broken key+blob pair and calls
    `onSessionRestoreFailure` so `lib/session-provider.tsx` surfaces `corruptedSessionError` (the
    sign-in screen shows it via `Copy.auth.error.generic`, reused rather than inventing new copy
    — see `lib/secure-storage.ts`'s module doc) instead of the failure reading as an unexplained
    silent sign-out, the same bug class issue #5 fixed for the OAuth redirect path. The app's 2
    existing real accounts are still migrated transparently on next launch (legacy plaintext
    JSON, detected by its leading `{`, is read once then re-encrypted) rather than silently
    signed out. Web (`npm run web`) falls back to plain AsyncStorage — `expo-secure-store` has no
    web implementation. Covered by `lib/__tests__/secure-storage.test.ts` (21 cases: round trip,
    the stable-key/per-write-IV behavior and its concurrency lock, the oversized-session/
    2048-byte case, the migration path incl. a failed-migration-write fallback, four
    corrupted/torn-state cases incl. a decrypt that "succeeds" under the wrong key, and the
    web/native platform split) plus `app/(auth)/sign-in.tsx` now rendering
    `corruptedSessionError` alongside its existing `errorMessage`.
14. **NEW — Phase 4 (`analyze-form`) contract notes, carried forward from the M1 review.** Not
    code changes today; binding requirements for whoever builds M4:
    - `analyze-form` MUST derive `p_user_id` for the reserve/settle/release RPCs from the
      verified JWT, never from the request body — the RPCs themselves trust `p_user_id` as a
      plain argument (by design, since they're `service_role`-only) and do no independent check.
    - MUST branch on `reserve_analysis`'s returned `status`, not just `allowed` — a replayed
      request against an idempotency key whose reservation already failed returns
      `allowed: true, existing: true, status: "released"` (the row is real, but nothing should
      be delivered against it as if it were a fresh reservation).
    - MUST call `release_analysis` on every failure path (a `finally`/equivalent, not just the
      happy-path retry-exhausted branch) — an unreleased `'reserved'` row silently eats one of
      the user's quota slots forever. Also consider a periodic sweep for stale `'reserved'` rows
      (e.g. the edge function crashed before either settling or releasing).
      **The sweep half is now written (issue #47, 2026-07-13):**
      `supabase/migrations/20260713130000_stale_reservation_sweep.sql` adds
      `public.sweep_stale_reservations()` on a 5-minute `pg_cron` schedule, 15-minute staleness
      threshold — **applied** to the live project (unapplied as of 2026-07-13; applied and verified
      2026-07-26, see Known Issue #33). It only flips the row's `status`/`release_reason` and — since #130 (2026-07-13) —
      that is provably all it needs to do: `analyze-form` settles the row **before** it uploads any
      frames, so a `'reserved'` row can never have frames and a swept row has nothing to purge.
      Known Issue #16's storage-purge half is therefore **resolved by construction** rather than by
      a second cron job reaching into Storage — no `pg_net`, no Vault secret, no scheduled edge
      function. This does **not** close every orphan path: the delete-during-upload race is
      narrowed but still open — see Known Issue #26 below. See
      `docs/superpowers/specs/2026-07-13-stale-frame-orphan-design.md`.
    - MUST refuse to run for a user with no recorded consent. `public.consents` (added 2026-07-12,
      issue #68) is the record; the check is `select granted from public.consents where user_id =
      <jwt uid> and consent_key = 'upload.health.v1' order by created_at desc limit 1`, and a
      missing row, a `granted = false` row, or a query error all mean **refuse**. The
      `<ConsentGate />` in the client is UX only — it can be bypassed by anyone calling the
      function directly, so it is not the control. If this check is skipped, the app processes
      Art. 9 health data with no legal basis and the entire consent record becomes decorative.
      **Open question, unresolved**: consent-before-idempotency ordering means a replay of an
      idempotent request after a withdrawal could either be refused or return the existing
      settled row as-is — see `docs/architecture.md`'s consent step for both readings; the
      answer likely tracks whatever the delete/purge path (#57, #58) already does to that row.
    - **Settled by #88, applied and verified live 2026-07-12 (see Known Issue #16):**
      the request body carries **no `mediaPaths`**. `reserve_analysis` is 4 args (no
      `p_media_paths`); `settle_analysis` is 5 (it takes them, guarded to `{p_user_id}/
      {p_analysis_id}/`). Order is reserve → model call → **on success/honest-partial only**,
      upload frames service-role to `{user_id}/{analysis_id}/frame-{NN}.jpg` → settle with
      whichever paths landed. Never upload before the reserve — a rejection must leave nothing
      in the bucket. A frame that fails to upload does not fail the request.
15. **NEW — privacy policy is drafted but publication is ON HOLD (issue #68, 2026-07-12).**
    `docs/privacy-policy.md` is written and reviewed, but it cannot go live until Ian resolves
    two things, and the file carries a `DO NOT PUBLISH` guard until he does:
    - **Data controller identity** — the policy needs a legal name, a country of establishment,
      and a working contact email. This is really a question about the **Apple Developer account
      type**. **No Apple Developer account exists yet (confirmed 2026-07-12)**, so this is not
      blocking anything today — but the choice should be made *before* enrolling, since
      Individual → Organization is a support-driven migration, not a toggle.
      **Verified against developer.apple.com/programs/enroll (2026-07-12) — the choice is
      narrower than it looks:** *"Sole proprietors and single-person businesses must enroll as
      individuals."* **Organization** enrollment requires an actual **legal entity** (explicitly
      no DBAs, trade names, or business names), a **D-U-N-S number**, a work email on the
      organization's **domain**, and a public, functional **website**. **Individual** enrollment
      publishes Ian's **legal name** as the seller name on the App Store. $99/yr either way.
      ⇒ **Unless the running-coach business is a registered company (AU: a Pty Ltd — an ABN as a
      sole trader is not enough), the Organization path is closed and his legal name will be
      published regardless.** In that case, naming himself as controller in the privacy policy
      costs no incremental exposure, and he should just do it. Taking the Organization path
      instead means incorporating first — a real cost, with D-U-N-S lead time on top.
      **OPEN QUESTION FOR IAN: is the running-coach business a registered company, or sole
      trader/ABN only?** Also still needed: a contact email for the policy — ideally a role
      address (`privacy@…`) on a domain he controls, or failing that a purpose-made address, not
      his personal Gmail.
    - **In-app account deletion must actually ship** (App Store Guideline 5.1.1(v)) — the policy
      promises it, and publication is gated on it being real. Until then the policy leans on an
      email fallback for access/deletion requests.
    Also decided 2026-07-12: the TestFlight beta **excludes EU/UK testers**, which keeps GDPR out
    of scope for the beta and avoids appointing an Art. 27 representative — admitting a single
    EU/UK tester reverses that. Hosting, when it happens: a **new public GitHub repo serving only
    the policy via Pages** (this repo is private on GitHub Free, where Pages is unavailable, and
    pointing Pages at `/docs` would leak internal planning docs). **For counsel:** the Australian
    Privacy Act's small-business exemption does *not* apply to a business holding health
    information (s6D(4)(b)) — an app producing injury-risk assessments plausibly qualifies, which
    would make this a full APP entity regardless of size (APP 8 overseas disclosure + a
    complaints process). See `docs/privacy-checklist-m7.md`.
16. ~~**Frame-upload ordering fixed at the contract level; migration written but NOT applied to
    the live project (issue #88).**~~ **APPLIED and verified live 2026-07-12.** The old contract
    was unbuildable (`{user_id}/{analysis_id}/` needed an id that didn't exist yet when the
    client had to name it) and leaking (every rejected `reserve_analysis` call — over-quota,
    frame-cap, anti-farming — left already-uploaded body-image frames in the private bucket with
    no row ever created to point at them, undeletable forever). Fixed at the contract level: the
    upload moves server-side, into `analyze-form`, after `reserve_analysis` has already minted
    the row, so no object can exist before the row that owns it — see `docs/superpowers/specs/
    2026-07-12-frame-upload-ordering-design.md` for the full design and
    `supabase/migrations/20260712123606_frame_upload_ordering.sql` for the migration.
    - **Applied to `v2.3Analysis` (live) via `supabase db push` on 2026-07-12**, alongside #2's
      and #91's migrations, and verified: `reserve_analysis` is now 4 args (`p_media_paths`
      dropped), `settle_analysis` is now 5 (gained it, namespace-guarded); `storage.objects` has
      zero INSERT and zero DELETE policies, only the owner-scoped SELECT; `public.analyses`'s
      client-facing DELETE policy is gone. Security advisors: zero warnings, zero errors.
    - **Overlapped issue #2 — RESOLVED, composed cleanly, no manual merge needed.** #2 shipped as
      `20260712040000_analyses_quota_soft_delete.sql` (soft-delete + redact, plus `revoke all` +
      a narrow `grant select`/`grant update (deleted_at)` on `public.analyses`), which
      deliberately does **not** touch `reserve_analysis` — quota still counts live rows by
      `status`, and a soft-deleted row keeps counting. So there was no competing
      `create or replace` of that function and no risk of one migration silently overwriting the
      other's body. (An append-only-ledger alternative for #2 *would* have rewritten
      `reserve_analysis` and collided head-on here; it was rejected for exactly that reason.)
      Both fixes independently dropped the client `DELETE` policy on `public.analyses`, both
      using `drop policy if exists` — confirmed live: the push log shows #88's statement emitting
      `NOTICE: policy "Users can delete their own analyses" ... does not exist, skipping`,
      exactly the predicted safe no-op, since #2 (earlier timestamp) had already dropped it. The
      two migrations composed cleanly, exactly as designed.
    - **Closes #8** (namespace guard in `settle_analysis` — live) **and #7** (client loses
      storage `INSERT` at the RLS-policy level — live, though see the grant-level caveat in
      Known Issue #18 below). **Re-scopes #35** (no direct-to-bucket upload left to build). This
      issue's remaining scope is now its two follow-ups: **#47** (the stale-`reserved` sweep must
      also purge the storage prefix, not just flip the row's status) is **built, and its
      storage-purge ask is resolved by construction as of 2026-07-13 (issue #130)** —
      `supabase/migrations/20260713130000_stale_reservation_sweep.sql` (**applied** to the live
      project, verified 2026-07-26 — see Known Issue #33) flips the row's `status`/`release_reason` on a 5-minute `pg_cron` schedule
      and never touches Storage, because `analyze-form` now settles **before** it uploads: a
      `'reserved'` row can never have frames, so a swept row has nothing to purge. See that
      migration's Design Decision 5, and Known Issue #26 for the one orphan path that ordering
      change narrows but does **not** close — and **#57** (`DELETE /functions/v1/analysis/:id` is now a hard prerequisite for any
      user-facing delete, since the client's row `DELETE` is also gone).
17. **AI spend guardrail contract for #44 — migrations applied and verified; one manual step
    still open (issue #91, 2026-07-12).** The substrate ("Done so far" above) is live:
    - **Applied to the live project 2026-07-12** (`supabase db push`, alongside #2's and #88's
      migrations). `ai_ops_config`, `ai_model_pricing`, and `ai_call_log` all exist;
      `authenticated` can SELECT none of them and cannot EXECUTE `gate_ai_call` — service-role
      only, exactly as designed. `analyze-form` (#44, built and **deployed 2026-07-26**) calls
      `gate_ai_call`/`record_ai_call` — nothing further is needed at the DB layer.
    - **`analyze-form` (#44) MUST call `gateAiCall()` before every Anthropic request and
      `recordAiCall()` on every exit path after**, per the call-ordering contract in
      `docs/architecture.md`'s "Current — AI spend guardrails substrate" section (gate runs
      *before* idempotency/`reserve_analysis`, not after — mirrors why Known Issue #14's
      `release_analysis` requirement is a `finally`, not a happy-path-only call). This is
      DB-enforced against the client (the RPCs are `service_role`-only) but NOT DB-enforced
      against `analyze-form`'s own code skipping it — that gap is closed by `AGENTS.md`'s
      mandatory `security-auditor` review for anything on the hot list, which `analyze-form`
      explicitly is. Verify this specific contract at that review, not just generic security
      hygiene.
    - **Still open, and it is the one thing here that genuinely can't be done from this repo:
      set a hard spend ceiling in the Anthropic Console.** It's free configuration and the only
      backstop that survives a bug in the gate itself, a Supabase outage, or a leaked
      `ANTHROPIC_API_KEY` — everything else in issue #91 is defense-in-depth *behind* it, not a
      replacement for it. Needs Ian's Anthropic Console access.
    - Out of scope for #91, unaffected by it: a monthly cap (the Anthropic Console limit above
      already is one — a second one here would be duplicated state that can drift) and CAPTCHA/
      signup rate limiting (Known Issue #12 — RESOLVED, see that entry above).
18. **`storage.objects` table-level `GRANT INSERT`/`GRANT DELETE` to `authenticated` were
    never revoked (issue #100, found during 2026-07-12 verification of #88's push).** Narrower
    than the issue as originally filed: it's `storage.objects` specifically — a table shared
    across every bucket this project might ever add, not just `media` — not a general grants
    sweep. #88 dropped the client's INSERT and DELETE **policies** on `storage.objects`, which is
    what actually blocks the client today (RLS default-denies with no policy permitting either
    statement) — but unlike `public.analyses` (which #2's migration hardened with `revoke all` +
    a narrow re-grant), #88 never touched `storage.objects`'s table-level grants, because
    dropping the policies was its whole fix and it never claimed to touch privileges. So the
    client is blocked by the *absence of a policy*, not by *lacking the privilege* — no defense
    in depth if a future migration ever adds a policy back carelessly, or if RLS is ever disabled
    on this table by mistake.
    **Fix written 2026-07-13, closed together with issue #4; `supabase/migrations/
    20260713153000_grant_hardening.sql` IS applied to the live project (Known Issue #33) but its
    `revoke` no-ops — `storage.objects` is owned/granted by `supabase_storage_admin`, which no
    migration running as `postgres` can revoke from.** `anon`/`authenticated` still hold full
    `GRANT ALL` (including TRUNCATE) on `storage.objects`, unreachable in practice, with the
    `pace_media_object_guard` BEFORE INSERT trigger as the actual control of record. **CLAUDE.md's
    "Secrets & env" section (the `storage.objects` grant-all paragraph) is the authoritative,
    up-to-date account of this — re-verified live 2026-07-13, issue #100. Do not treat this
    paragraph as current; read that section instead.**
19. **NEW — the client's direct soft-delete UPDATE policy (issue #2) can still leave frames
    orphaned without ever touching `DELETE /functions/v1/analysis/:id` (issue #57, found while
    building #57, 2026-07-12).** #2's `public.analyses` UPDATE policy (`deleted_at: null -> now()`
    on the caller's own row) is a real, live, client-reachable path that does not purge Storage —
    it exists for the free-quota-exploit fix (#2), not as a delete UX. `deleteAnalysis()` (#57)
    narrows this: it always attempts the Storage purge regardless of the row's current
    `deleted_at`, so calling the endpoint for an analysis already soft-deleted through the direct
    path still cleans up its frames (proven by a test). **What this does NOT close**: nothing
    forces a client to ever call the endpoint for that analysis at all — a soft-delete via the
    direct policy, with no follow-up DELETE call, leaves the frames orphaned indefinitely, silently
    reproducing issue #3 through a different door. Two real fixes, neither built: (a) a scheduled
    reconciliation job that finds soft-deleted rows and purges any remaining objects under their
    prefix, or (b) an async (`pg_net`-based) AFTER UPDATE trigger that calls the Storage API
    directly on the same transition the redact trigger already fires on. Out of scope for #57
    itself (the client soft-delete policy is #2's settled, applied contract) — filing as a
    follow-up is recommended before M6 is called done. The product-level mitigation in the
    meantime: the app's UI must always route a user's "delete" action through this endpoint, never
    call `supabase.from('analyses').update({ deleted_at })` directly.
20. **RESOLVED — the result route's path was named two different ways across the design docs
    (found while building the Analyzing screen, issue #80, 2026-07-12; fixed 2026-07-25).**
    `docs/architecture.md`'s route tree said `result/[id]` (singular); `docs/design/motion-consult.md`'s
    item 3 example (`router.replace('/results/[id]', ...)`) said `results/[id]` (plural). The
    actual built route is `app/result/[id].tsx` (singular), matching what `app/analyzing.tsx`
    navigates to — `motion-consult.md`'s example has been corrected to match; no code changed.
21. **RESOLVED 2026-08-06 — `purchase-tier` (issue #51)'s deployment gate is now OFF, not
    allowlisted (captain decision `purchase-tier-dummy-flag-now`).**

    > ### ✅ CURRENT LIVE STATE — flag UNSET as of 2026-08-06
    >
    > **As of 2026-07-26, by explicit captain decision, this flag was SET TO `true` on the live
    > `v2.3Analysis` project (`vputdomdlknvthnzritt`), and `purchase-tier` was deployed**, done
    > knowingly so the captain could grant himself Pro/Elite without paying, during development. On
    > 2026-08-05 it was narrowed to an allowlist (`PURCHASE_TIER_ALLOWED_USER_IDS`) rather than shut
    > off, per v23-launch-audit-r1 §5.3.
    >
    > **UPDATED 2026-08-06 (captain decision `purchase-tier-dummy-flag-now`): the allowlist
    > approach is declined, not adopted.** The captain is the only tester right now, so the
    > self-grant-tier dummy-purchase mechanism isn't needed at all. Both
    > `PURCHASE_TIER_DUMMY_ENABLED` and `PURCHASE_TIER_ALLOWED_USER_IDS` were **unset** (not set to
    > `false` — the code's control is `Deno.env.get('PURCHASE_TIER_DUMMY_ENABLED') === 'true'`, so
    > any other value including missing already disables it; unsetting also drops the now-pointless
    > allowlist secret entirely):
    >
    > ```
    > supabase secrets unset PURCHASE_TIER_DUMMY_ENABLED --project-ref vputdomdlknvthnzritt
    > supabase secrets unset PURCHASE_TIER_ALLOWED_USER_IDS --project-ref vputdomdlknvthnzritt
    > ```
    >
    > **Verified live 2026-08-06, not assumed** — the same way the original audit verified the
    > vulnerability: a freshly signed-up throwaway account got
    > `404 {"error":"Not found.","code":"not_found"}` from
    > `POST /functions/v1/purchase-tier {"tier":"elite","source":"dummy"}`, and its `quota-status`
    > afterward stayed `tier: free, limit: 1, frameCap: 1` — no tier granted. `supabase secrets
    > list` confirms both `PURCHASE_TIER_DUMMY_ENABLED` and `PURCHASE_TIER_ALLOWED_USER_IDS` are
    > absent from the live project's secret set. The gate took effect with no redeploy.
    >
    > **This closes the release gate.** `POST /auth/v1/signup` is still unauthenticated and
    > unthrottled (see Known Issue #12, resolved for the app path only), so unlimited throwaway
    > accounts can still be created — they simply cannot grant themselves a paid tier anymore. If a
    > closed tester group ever needs self-grant again, re-set `PURCHASE_TIER_DUMMY_ENABLED=true`
    > deliberately (optionally narrowed with `PURCHASE_TIER_ALLOWED_USER_IDS`) and re-open this as a
    > release blocker before the next TestFlight build or public release — never leave it set past
    > that point.

    Built and Deno-tested; **deployed to the live project 2026-07-26** (it was "not deployed" when
    this issue was written) — but the audit found that once deployed
    to this project (open signup: `enable_signup = true`, `enable_confirmations = false`), it is a
    **$0 self-grant of the highest paid tier, reachable by anyone on the internet**: throwaway
    signup → `POST /functions/v1/purchase-tier {"tier":"elite","source":"dummy"}` → 30
    analyses/8-frame cap instead of free's 1/1 → burn them to trip the shared `ai_ops_config` daily
    spend cap ($10) → every real user's `analyze-form` denied for the rest of the day → repeat with
    a fresh signup. A 30× amplification of the existing daily-cap DoS, at $0 cost to the attacker.
    **Fixed in the same PR, not filed separately**: the function now refuses every request with an
    indistinguishable `404` unless `PURCHASE_TIER_DUMMY_ENABLED` is the exact string `"true"` in
    its environment — checked before the HTTP method, before auth, before anything about the
    request. **`PURCHASE_TIER_DUMMY_ENABLED` must NEVER be set in production secrets** — it exists
    only for a closed TestFlight tester group, narrowed further (optional) by
    `PURCHASE_TIER_ALLOWED_USER_IDS`, an allowlist of user ids. Whoever runs
    `supabase functions deploy purchase-tier` / `supabase secrets set` must confirm this flag is
    absent (or explicitly, deliberately `false`) before any production deploy — **this is a release
    gate, not a suggestion**. (Read that sentence against the CURRENT LIVE STATE box above: the
    flag is on today by deliberate decision, which is exactly why the gate has to be re-checked at
    release time rather than assumed.) See `docs/architecture.md`'s "Current —
    `POST /functions/v1/purchase-tier`" section, "Deployment gate" subsection, for the full design.
    Two smaller companion fixes landed in the same migration: the default Supabase `grant all` to
    `authenticated`/`anon` on `subscriptions` and `profiles` was revoked (MEDIUM finding — no live
    exploit since RLS already denied those verbs, but TRUNCATE isn't subject to RLS at all, and
    this closes the same class of gap `consents` and, still open, `storage.objects`/issue #100 /
    Known Issue #18 have); and the `pace_purchase_tier` SQL function's optional `p_as_of` parameter
    (a caller-suppliable period anchor, unreachable today but one careless edit away from being
    threaded through) was removed entirely rather than merely guarded (LOW finding).
22. **RESOLVED — `delete-account` now works end to end: the edge function is deployed and verified
    live (2026-07-26, see Known Issue #35), and the client has been bound to the real function since
    PR #122 (2026-07-13, issue #58; response-contract fixed post-review same date) — see Known Issue
    #23.** Both halves this entry originally tracked as blockers before Guideline 5.1.1(v) could be
    satisfied are done. Kept for the record, corrected below where marked:
    - **`POST /functions/v1/delete-account`**: written and Deno-tested on `feat/58-delete-account`
      (25 tests: zero orphaned Storage objects, nested-prefix recursion, delete order, a mid-purge
      failure leaving the auth user alive, the consent-trail decision, the full response
      status/body matrix). Reuses #57's `purgePrefix()` — one implementation, two callers — and
      sweeps the whole `{user_id}/` prefix, so it also cleans up the frames Known Issue #19
      describes (rows soft-deleted through #2's client UPDATE policy never purge their own frames;
      an account delete now does, because the sweep is by prefix and never consults a row).
    - ~~**Not deployed.**~~ **Deployed 2026-07-26** (see Known Issue #35) and verified live: it
      returned `200 {"deleted": true}` on a purpose-made throwaway account, which was confirmed
      gone afterwards. No migration was needed — `service_role` already holds every grant this
      function uses, so it was a deploy, not a schema change. ~~The client-binding half of this
      issue (the Settings screen still calling a mock pending #122) is unchanged.~~ **Corrected —
      this was wrong even at the time of writing: PR #122 (2026-07-13) already bound
      `lib/delete-account.ts` to the real client before this note was added; see Known Issue #23.**
    - **Response contract, fixed on PR #121 after security/code review** (both reviewers confirmed
      the purge logic itself — ordering, prefix purge, `purgePrefix`'s export, no partial-failure
      path that deletes the auth user — was sound; this was the one real finding). The original
      `orphans_remaining` outcome (storage, rows, AND the auth user all already deleted, but a
      concurrent-upload race left something the post-delete sweep couldn't clear) returned `500`
      with a body carrying both `deleted: true` and `error`/`code` — off-contract (`architecture.md`
      promises every non-2xx is a clean `{ error, code }`) and unconsumable (a client seeing a
      non-2xx would tell an already-fully-deleted user "still active, please retry", which is false
      on every clause, since retrying can only `401`). Fixed to the matrix now in
      `docs/architecture.md`'s "Current — `POST /functions/v1/delete-account`" section:
      `orphans_remaining` is now a `200` with `orphansRemaining: true` added to the success body,
      and the three genuine failures (`purge_failed`/`rows_failed`/`auth_delete_failed`) are `503`
      with a clean `{ error, code }` and nothing else. `DeleteAccountErrorCode` is now an exported
      discriminated union, not a bare `string`, so #122's client can exhaustively switch on it. A
      test asserts no response body, for any outcome, ever carries both `deleted` and `error`/`code`.
    - **Issue #59's other half — DONE, 2026-07-25.** The 25 tests here mock the Supabase client, so
      they prove the *contract* (ordering, recursion, atomicity, idempotency, the response matrix).
      #59 also asked for the same properties against a real local Postgres **and** real Storage,
      because the property under test is precisely that two different systems agree — a fake
      cannot fail the way production fails. Issue #92's local `supabase start` stack now exists,
      and `supabase/functions/_shared/integration/delete-purge.local.ts` runs the actual
      `deleteAnalysis`/`deleteAccount` code (via the same production client factories) against it,
      asserting from the Storage side (`storage.list()` after the delete) that zero objects
      remain. See `supabase/functions/_shared/integration/README.md` for how to run it
      (`npm run test:edge:local`) — not part of the normal `npm test` gate, since it needs the
      local stack running.
    - **The consent trail is purged, deliberately** (GDPR Art. 17(3)(e) reasoning in
      `_shared/delete-account.ts`'s header and `docs/architecture.md`), which keeps
      `docs/privacy-policy.md`'s "Deleting your account removes everything" literally true and
      needs no policy amendment. **Revisit if EU/UK users are admitted** — see Known Issue #15's
      note that the TestFlight beta currently excludes them.
    - ~~**Filed separately, deliberately out of scope for #58: issue #124** (no re-authentication —
      a stolen access token can delete an account outright; the fix is a recent-login/AAL check,
      not a body confirmation field an attacker would just send too) — still open.~~ **FIXED
      2026-07-13.** `_shared/delete-account.ts`'s `isReauthFresh()` now requires the caller's JWT
      to carry an `amr` (Authentication Methods Reference) claim entry — a real password or OAuth
      credential presentation, deliberately never the JWT's own `iat`, which advances on every
      silent token refresh and would have been exactly the "looks like a control, isn't one" bug
      this issue exists to close — timestamped within 5 minutes of the request. `index.ts` runs
      this check before `deleteAccount()` is ever called and returns `401 reauth_required` on
      failure; `app/settings.tsx` handles that with a password re-entry modal or a Google re-run,
      exactly one retry. See `docs/change_log.md` and `docs/architecture.md`'s "Current —
      `POST /functions/v1/delete-account`" section. **Does not change `delete-account`'s own
      not-deployed status** — this is new code in an undeployed function.
    - ~~**Issue #125** (the sweep is wall-clock-bound but not checkpointed — bounded per-batch by
      `REMOVE_BATCH_SIZE = 500`, but an account with many hundreds of analyses still makes many
      hundreds of sequential `list()` round trips in one invocation; fine at any plausible
      near-term volume, not fine indefinitely).~~ **FIXED 2026-07-13.** The account-level sweep
      now runs bounded-concurrently (`ACCOUNT_PURGE_CONCURRENCY = 8` in-flight sub-prefix purges
      instead of one sequential `list()` at a time) with soft wall-clock budgets
      (`ACCOUNT_PURGE_DEADLINE_MS` / `ACCOUNT_POST_DELETE_SWEEP_DEADLINE_MS`) and free
      checkpointing (each sub-prefix purge independently `list → remove → verify`s, so a
      timed-out retry re-enumerates the account root and finds strictly fewer sub-prefixes rather
      than redoing the whole sweep) — see `docs/change_log.md` 2026-07-13. A heavy account can no
      longer become permanently undeletable this way. This does **not** change #58's own
      not-deployed status above, and does not touch #124.
23. **NEW — `lib/delete-account.ts`'s client is real, but built against an unmerged, moving-target
    contract (issue #53, 2026-07-13; corrected the same day per a security audit on PR #122,
    finding F1).** The Settings screen's "Delete account and data" flow originally shipped bound to
    a dev mock with no owner assigned to ever swap it for a real client — #58/#121's own file list
    never touches `lib/`, so that swap would not have happened and the button would have silently
    deleted nothing while telling the user it had. Fixed the same day: `lib/delete-account.ts` now
    calls the real `supabase.functions.invoke('delete-account')`, built against the response
    contract `purge_failed` / `rows_failed` / `auth_delete_failed` (503, retryable) and
    `orphans_remaining` (200, a SUCCESS — the account is gone). Two things narrowed this at the time
    and are now resolved:
    - ~~**The edge function itself (#58/#121) is built but not yet merged to `main` or deployed.**~~
      **RESOLVED 2026-07-26.** #121/#58 merged and `delete-account` was deployed to the live project
      the same day, verified live end to end (see Known Issue #35) — the button works end-to-end.
    - ~~**The exact contract may still drift.**~~ **Confirmed matching, not yet replaced with a real
      import.** `DeleteAccountErrorCode` in `lib/delete-account.ts` remains a hand-maintained mirror
      of `supabase/functions/_shared/delete-account.ts`'s outcome union rather than a `@shared/*`
      import — the two were checked against each other and agree (`purge_failed` / `rows_failed` /
      `auth_delete_failed`, with `reauth_required` handled as its own 401 on both sides). Swapping the
      mirror for a real import is still a worthwhile cleanup, not a correctness gap.
24. **NEW — the Settings screen ships UNCERTIFIED copy (issue #53, 2026-07-13).** `constants/copy.ts`
    gained a clearly-delimited block of strings that are **not in `docs/design/copy-deck.md`** and
    have not been through `ux-copywriter` or Ian: two distinct sign-out failure alerts (the string
    issue #27 explicitly said had to be written — a security audit, finding F3, found there are
    genuinely two of them, not one — see Known Issue #23's sibling note in `lib/sign-out.ts`), the
    delete-account failure alert and its separate orphans-remaining success alert (finding F2), the
    consent-withdrawal confirmation, the "policy not published yet" line, and two screen-reader-only
    Retry labels. They were written to the deck's own rules (name the outcome, never claim a state
    that isn't true, no jargon) but they are drafts. Review them, then mirror the approved wording
    into copy-deck.md § Screen 11 the way #36's and #56's NEW keys were.
25. **RESOLVED 2026-07-26 — `analyze-form` IS deployed, and the client binding is real.** Both of
    the deploy steps this entry was waiting on ran on 2026-07-26 (issue #128):
    `supabase functions deploy analyze-form` and `supabase secrets set ANTHROPIC_API_KEY=…`. Verified
    by live observation, not by inspection: `public.analyses` went from zero rows ever to row
    `b144d29b` with status `delivered`, `is_fallback` false, a valid PACE result, and one frame in
    the private bucket — read back through RLS as the owner. `lib/analyze-form.ts` is bound to the
    **real** client (the `__DEV__`-guarded mock is kept for tests/dev only). The rest of this entry's
    content below — the contract notes, the corrected Bedrock claim, the structured-output format —
    remains accurate and is kept for the record. Original text, for the record:

    > **NEW — `analyze-form` is BUILT but NOT DEPLOYED (issues #44 + #45, 2026-07-13).** The edge
    function exists, all four binding contract
    rules from Known Issue #14 are discharged in code and locked by tests, and #91's gate/record
    contract (Known Issue #17) is honoured including a **separate gate for the retry**. See
    `docs/architecture.md`'s "Current — `analyze-form` edge function" section. What remains:
    - ~~**Two deploy steps only Ian can run**, both deliberately not done from the worktree:
      `supabase functions deploy analyze-form` and `supabase secrets set ANTHROPIC_API_KEY=…`.
      Until both land, the function does not exist in production and `lib/analyze-form.ts` is still
      bound to its dev mock (#80's seam — swapping that one binding is the client half, and is not
      part of #44).~~ **Both ran 2026-07-26, and the seam was swapped in the same batch (#128) —
      see this entry's RESOLVED header.**
    - **The `analyze-form` API contract is satisfied exactly as `lib/analyze-form.ts` documents it**
      — request `{ mediaType, frames: string[], timestamps: number[], idempotencyKey }`, 200
      `{ result, analysisId, isFallback }`, every non-2xx `{ error, code }`. No divergence.
    - **A FALSE CLAIM WAS CORRECTED, and the output contract changed as a result.**
      `_shared/analyze-form-prompt.ts` (#41) and `docs/architecture.md` both asserted that
      Anthropic's docs say, "with no platform scoping", that a *forced* `tool_choice` is
      incompatible with extended thinking, and that the report of it being Bedrock-only "could not
      be confirmed". **That is wrong: the restriction is Amazon Bedrock ONLY.** On Bedrock a forced
      `tool_choice` requires `thinking: {type: 'disabled'}`; the **first-party Claude API** (which
      is what this project calls — `api.anthropic.com` + `x-api-key`, see `analyze-form/deps.ts`)
      and Vertex do not require it. The claim has been deleted from that file's header and from
      `architecture.md` and replaced with the scoped fact, so nobody re-derives it.
    - **The output contract now travels in `output_config.format` (structured outputs), not in a
      tool.** This is the mechanism neither side of the forced-tool-call argument had reached for,
      and it is strictly better: grammar-constrained sampling applies to the RESPONSE ITSELF against
      `PACE_RESULT_SCHEMA`, so the answer is schema-conformant by construction rather than "a tool
      got invoked and we then constrain its input". With **no `tools` and no `tool_choice` in the
      request at all**, the platform-specific tool-choice question becomes *moot* — the request is
      correct on the Claude API, Bedrock, and Vertex under every reading. It is also cheaper (the
      ~13k-character tool schema stops being billed as `tools` input, and the forced-tool system
      preamble is gone). The tool is retained as an opt-in (`BuildRequestOptions.includeTool`) so
      #42 can eval both mechanisms head to head.
    - **#45's fallback path is NOT made redundant by the schema, and was not weakened.** Structured
      outputs explicitly does *not* guarantee schema conformance on `stop_reason: 'refusal'` ("the
      output may not match your schema") or `'max_tokens'` ("the output may be incomplete and not
      match your schema" — and thinking tokens count against `max_tokens`, so this is live on every
      call). And `minimum`/`maximum` are **not in the supported JSON Schema subset**, so "score is
      an integer 0–100" is unenforceable by the schema and is caught only by `isPaceResult` at
      runtime. The schema guarantees the SHAPE; code guarantees the RANGE. Retry-once, the ≥2-pillar
      honest partial, and clean-failure-refunds-quota all still stand — they are product contracts,
      not parser conveniences.
    - **The response parser accepts BOTH envelopes** (a JSON text block *and* a `tool_use` block).
      Deliberate insurance, not indecision: the zero-spend constraint means no live call could
      confirm the structured-output response envelope before shipping, so the parser is correct
      under either. **Ian's first live call should confirm the envelope**; if it is anything other
      than a JSON text block, `extractPayload` already handles it.
    - **Two MEDIUM review findings fixed in-place (2026-07-13, see `docs/change_log.md`):** (1) a
      suppressed retry (deadline nearly spent, or the retry's spend gate denied by the daily cap /
      open breaker) no longer releases a lone content failure as `'validation_failed'` — that would
      have ticked the anti-farming cap for our own outage; it now requires the retry to have
      actually run (`retryRan`) and releases `'model_error'` otherwise. (2) `parseRequestBody` now
      caps `frames.length` at `PACE_FRAME_CAP.elite` (8) with `too_many_frames`/400 before the gate,
      closing a $0-real-cost DoS that could saturate the global daily $ cap with ~$9.9 `'pending'`
      holds. The broader "$10 global cap + open signup" availability exposure is a config/design
      decision above this PR and is being raised with Ian separately.
    - **Consent-withdrawal vs. idempotent replay — DECIDED: refuse.** Known Issue #14 left this
      open ("do not silently pick one"). The consent check runs before idempotency, so a replay of
      an already-settled key by a user who has since withdrawn consent is **refused (403)**, not
      served from cache. Rationale: continuing to serve health inferences after a withdrawal is the
      riskier read, and it agrees with what the delete/purge path (#57) does to such a row anyway.
      GDPR Art. 7(3) makes the already-completed processing lawful either way, so nothing is lost by
      refusing. The user's own past analyses remain readable via their normal RLS `select` — this
      only refuses to re-run or re-serve through the analysis endpoint.
    - **Left open, on purpose**: a model response that *validly* reports all four pillars as
      not-assessed is delivered as a real result (`isFallback: false`) and therefore burns a quota
      slot — the model honestly said "I can't read this, here's the shot that would fix it", which
      is genuinely useful, but on Free that is their one lifetime analysis. Not changed here because
      it would alter what "a valid result" means, which is a product call. (The *fallback* path does
      guard against this: a salvage with no pillar actually scored is a clean failure, refunded.)
26. ~~**NEW — the delete-during-upload orphan race is NARROWED, NOT CLOSED (issue #130,
    2026-07-13; found in review of #130's own fix).**~~ **RESOLVED 2026-07-13 (issue #132).**
    `deleteAnalysis()` now runs the exact fix described in this entry's own "known fix, not
    implemented" bullet: a second `purgePrefix()` call immediately after `markDeleted` actually
    performs the `deleted_at` transition, closing the purge→`markDeleted` gap below. A failed
    second purge is reported as a new `orphans_remaining` outcome (`200`,
    `{ deleted: true, orphansRemaining: true }` — not `purge_failed`, since the row is already,
    unambiguously gone by that point and there is nothing left to retry) and logged at `error`
    level as the sole alarm; a caught orphan logs at `warn`. See `docs/change_log.md` 2026-07-13
    and `docs/architecture.md`'s "Current — `DELETE /functions/v1/analysis/:id`" section for the
    full mechanism. **Left as originally written below for the historical record of the hole
    itself** — the fix closes exactly this window and no other; Known Issue #19 (the client's
    direct soft-delete UPDATE policy bypassing this endpoint entirely) is a *different* orphan
    door and remains open.
    #130 flipped `analyze-form` to settle **before** it
    uploads, which does close the two orphan paths that motivated it (a killed invocation, and a
    refused settle — both now leave a frameless row). But settling first makes the row `'delivered'`,
    and therefore **deletable**, while the function is still uploading frames into its prefix. That
    opens a new, smaller window, and `safeAttachFrames`'s self-purge does not fully cover it:
    - **The window.** `deleteAnalysis()` (`supabase/functions/_shared/delete-analysis.ts`) purges
      Storage **first** and calls `markDeleted` **second** (a binding ordering — reversing it is the
      privacy defect #3 exists to close). If an in-flight `analyze-form`'s `attach_media_paths`
      commits in the gap **between** those two steps, the row still has `deleted_at is null`,
      `status = 'delivered'`, and `media_paths = '{}'` — so every guard passes, the attach
      **succeeds**, and `safeAttachFrames` sees `ok: true` and therefore does **not** purge. Then
      `markDeleted` fires the redaction trigger
      (`20260712040000_analyses_quota_soft_delete.sql`), which wipes `media_paths` back to `'{}'`.
      Result: frames uploaded after the purge's verification pass are stranded in the bucket under a
      deleted analysis's prefix whose per-analysis purge has already run and reported it empty.
      Nothing in the database names them.
    - **What #130 *did* cover**: the same race when the attach lands **after** `markDeleted` commits
      — the attach then refuses with `row_deleted` (or `not_found` on a hard delete) and
      `safeAttachFrames` purges the prefix it just wrote. That is the wider half of the window and it
      is closed. Only the purge→`markDeleted` gap is left.
    - **Blast radius.** Small but real, and it is the same class as #3: images of a person's body
      retained after they asked for them to be gone. Requires a user to delete an analysis in the
      seconds between its settle and its last frame upload, so it is rare — but it is silent, and
      per-analysis deletion will never revisit that prefix. Only `delete-account` (#58), which sweeps
      the whole `{user_id}/` prefix, would ever reach these objects.
    - **The known fix, not implemented**: a **second** `purgePrefix` call in `deleteAnalysis()`,
      after `markDeleted` commits — the row is unambiguously deleted by then, so anything found under
      the prefix on that pass is an orphan by definition and can be removed unconditionally. It costs
      one extra list against a normally-empty prefix per delete. Not done in #130 (its scope was the
      settle/upload ordering and the sweep), and it belongs in `delete-analysis.ts`, not in the sweep:
      these rows are `'delivered'`, never `'reserved'`, so `sweep_stale_reservations()` would not see
      them even if it purged Storage.
27. **NEW — this document previously claimed the `analysis` edge function (`DELETE
    /functions/v1/analysis/:id`, issue #57) was not deployed. That was stale/wrong, confirmed
    during this batch's 2026-07-13 verification pass — it IS deployed.** Every "not deployed"
    note about this specific function, both here and in `docs/architecture.md`, has been
    corrected in place rather than left standing. Recorded as its own issue because it matters:
    a doc that wrongly says a function isn't live could lead someone to skip a redeploy this
    function's own new code (issue #132's second purge, see the resolved Known Issue #26) may
    still need. ~~**Unresolved by this correction**: whether the specific #132 code is itself the
    version currently live, or whether the pre-#132 code is.~~ **RESOLVED 2026-07-26 (issue #128):**
    `analysis` was redeployed from current repo code at 2026-07-26T03:41:28Z, so the #132 second
    purge is live. `docs/status.md` and `docs/architecture.md` are otherwise believed accurate on
    deployment status for every other function (as of 2026-07-13, `quota-status`, `purchase-tier`,
    `delete-account`, and `analyze-form` all remained **not deployed**, unaffected by this
    correction). **UPDATED 2026-07-26 (issue #128):** all six edge functions are now deployed —
    `analyze-form`, `quota-status`, and `purchase-tier` first, then `delete-account`, `analysis`,
    and `sweep-orphaned-media`. See Known Issues #25 and #35.
28. **NEW — the Past Analyses tab bar chrome fix is PARTIAL (issue #12, 2026-07-13).**
    `app/(tabs)/_layout.tsx`'s `tabBarStyle`/`tabBarLabelStyle` now use this app's own tokens
    instead of React Navigation's stock cool-gray palette, closing the mismatch a second
    always-visible tab made glaring. **Not done**: the root `ThemeProvider`'s
    `DefaultTheme`/`DarkTheme` in `app/_layout.tsx` (screen-transition backgrounds, any future
    header chrome outside `(tabs)`) is still React Navigation's stock palette — out of this
    change's file lane. A full custom `NavigationTheme` object both layouts consume is the
    eventual fix; not built here.
29. **NEW — foreground reconciliation (issue #64) does not survive a process KILL, only a
    background/foreground cycle (2026-07-13).** `app/analyzing.tsx` now re-reads the in-flight
    analysis by `idempotency_key` on every return-to-foreground (via `lib/app-state.ts`'s
    `onAppForeground`), recovering a result the app was backgrounded for. `lib/analyze-form.ts`'s
    one-shot pending-request mailbox does not survive a process restart, though, so a genuine
    app kill followed by a cold relaunch never re-enters this screen with a live `waiting` state
    to reconcile against — the user gets no "your analysis finished" surfacing at all in that
    case, even though the server-side `analyze-form` invocation ran to completion regardless.
    **The known fix, not built**: a persisted (AsyncStorage, not the in-memory mailbox), marker
    read at app startup — outside `app/analyzing.tsx`'s own file lane, closer to
    `lib/session-provider.tsx`'s territory. `docs/design/copy-deck.md`'s
    `toast.analysisFinishedInBackground.*` keys already anticipate this surfacing; nothing
    currently fires them for the cold-relaunch case.
30. **RESOLVED (verified 2026-08-07) — the offline pre-flight gate IS wired in. This entry was
    stale from the day it was written, and the staleness caused real waste.** It read: "built but
    not wired in … called from nowhere." That was true of commit `997070c` (issue #93,
    2026-07-13), which deliberately shipped `checkConnectivity()` as an export with a HANDOFF note,
    but the cross-lane integration commit `20022a8` wired it **the same day** — and neither this
    entry nor `docs/architecture.md`'s connectivity section was updated. Ground truth today:
    `app/analyzing.tsx:183` calls `checkConnectivity()` inside its `waiting`-phase effect and
    dispatches `{ type: 'offline' }` before `analyzeFormClient.submit()` is reached, so a user in a
    dead zone is told immediately instead of watching the wait screen fail. `app/capture/index.tsx`
    — the other call site this entry named — correctly has no gate because it makes no network
    request at all: extraction is on-device and the frames travel inside the `analyze-form` body.
    **Why this mattered**: an `expo-network` dependency was installed uncommitted on the captain's
    machine and never used anywhere; the 2026-08-07 investigation (see `docs/change_log.md`) found
    no reachability problem for it to solve and concluded this stale "half-done" claim is the most
    plausible thing that prompted it. `lib/__tests__/connectivity.test.ts` now carries a
    dependency-manifest lock so a second connectivity library cannot be added silently.
31. **PARTIAL — `.maestro/` E2E flows (issue #86, 2026-07-13) executed for real for the first time
    on 2026-07-25, but not yet a clean repeatable pass.** Four flows (`happy-path`,
    `dead-end-offline`, `dead-end-quota-exhausted`, `dead-end-analysis-failure`) plus shared
    subflows, written against the documented screen contracts for the M7 no-dead-end gate. Was
    **blocked on issue #84** (no dev build); the `preview-local` EAS simulator build unblocked it
    and `happy-path.yaml` was run against it, finding and fixing four real bugs in the flow files.
    Sign-up through the sign-in screen is now confirmed correct; a full clean pass was not achieved
    in this sandbox (a Maestro iOS accessibility-tree driver flakiness, not an app/script bug). Do
    not yet treat these as a passing gate. See `docs/architecture.md`'s `.maestro/` E2E section and
    `.maestro/README.md`'s 2026-07-25 update for the full diagnosis and how to get a clean run.
32. **RESOLVED 2026-08-06 — the per-user orphan-purge ACTION is now scheduled (issue #7's action
    half, 2026-07-13; decision `orphan-sweep-scheduling-mechanism`).**
    `supabase/functions/_shared/storage-sweep.ts`'s `sweepOrphanedMediaPrefixes()` is pure,
    Deno-tested orchestration that calls `public.list_orphaned_media_prefixes` (see Known Issue
    #33) and purges what it finds through the real Storage API. Its entrypoint,
    `supabase/functions/sweep-orphaned-media/`, deployed 2026-07-26, is now called daily by a
    `pg_cron` job (`sweep-orphaned-media-daily`, `0 9 * * *` UTC — `supabase/migrations/
    20260806090000_sweep_orphaned_media_cron.sql`), via `pg_net.http_post` authenticated with the
    `X-Cron-Secret` shared secret pulled from **Supabase Vault** at call time (secret name
    `sweep_orphaned_media_cron_secret`) — never committed, never inline in the cron job SQL.
    Route: `pg_cron`+`pg_net`+Vault, chosen over a Dashboard Cron Job because this environment has
    no interactive Studio UI login (see the migration's own header for the full reasoning against
    #47's sweep's prior Design Decision 3 against this same route).

    **Also fixed in this pass:** the function was live with `verify_jwt: true`, which would have
    401'd every cron call at the platform gateway before its own `X-Cron-Secret` check ever ran —
    contradicting the function's own header instruction. Redeployed with `--no-verify-jwt`, now
    pinned in `supabase/config.toml`'s `[functions.sweep-orphaned-media]`.

    **Verified live, immediately:** `cron.job` shows the schedule (`jobid` 2, `active: true`); a
    manual `net.http_post` call using the same statement the schedule runs returned `200
    {"mode":"dry_run","candidateCount":0,"candidates":[],"durationMs":421}` — the credential,
    endpoint, and Vault wiring all work end to end. Still gated on `dryRun: true` (the scheduled
    body is `{}`, which defaults to dry-run) — no media has been deleted by this schedule.
    Flipping to live deletion (`{"dryRun": false}`) is left as a deliberate follow-up decision once
    dry-run output has been reviewed in the edge function logs; it was intentionally not made here
    since it permanently deletes user media. See `docs/architecture.md`'s updated "Current —
    orphan-purge action, scheduled daily" section.
33. **RESOLVED 2026-07-26 — these migrations ARE applied; this entry was stale.** Verified live
    against `vputdomdlknvthnzritt` on 2026-07-26 via `list_migrations` + a `pg_proc` query: **all 24
    migrations in `supabase/migrations/` are present**, and `pace_quota_status`, `pace_purchase_tier`,
    `reserve_analysis`, `settle_analysis`, `release_analysis`, `gate_ai_call`, `record_ai_call`, and
    `attach_media_paths` all exist as `SECURITY DEFINER` with a pinned `search_path`. Someone ran
    `supabase db push` after this was written and did not update the note. **Do not re-apply these**;
    trust a live `has_table_privilege`/`pg_proc` check over this document, per Known Issue #18's own
    lesson. Original text, for the record:

    > SIX migrations are now written but NOT APPLIED to the live project (issue #131's
    > count is stale — it tracked four). In `supabase/migrations/`, unapplied as of 2026-07-13:
    `20260712233000_quota_status_function.sql` (#50), `20260713120000_purchase_tier_function.sql`
    (#51), `20260713130000_stale_reservation_sweep.sql` (#47), `20260713140000_attach_media_paths.sql`
    (#130 — **newly confirmed unapplied this batch**; it had been on `main` since before this
    batch and was not previously flagged as a live gap in this list), and this batch's own
    `20260713150000_settle_analysis_deleted_at_guard.sql` (#133),
    `20260713151000_reserve_analysis_media_path_guard.sql` (#8),
    `20260713152000_storage_user_budget.sql` (#7), and `20260713153000_grant_hardening.sql`
    (#100+#4) — eight files, six distinct fixes once grouped by the workstream each belongs to.
    Until `supabase db push` runs, the live project's actual behavior is whatever the **last
    applied** migration left it at (`20260712230000`, per `docs/architecture.md`'s "Current — DB
    schema" section) — every guard and fix these eight files describe is a written intent, not a
    live property. Whoever applies these should re-verify each one's own header for
    apply-ordering dependencies between them (`20260713153000` explicitly assumes
    `20260713152000` applies first, for instance) before running `supabase db push`.
34. **NEW — this batch adds five more blocks of UNCERTIFIED copy across four screens
    (2026-07-13), none reviewed by `ux-copywriter` or Ian.** Joins Known Issue #24's precedent
    (the Settings screen's own uncertified block from issue #53) rather than replacing it — read
    both together for the full uncertified-copy surface:
    - `consent.upload.age.checkbox` and the whole `consent.upload.subject.*` namespace (issue
      #94) — **the highest-stakes block in this list**: it carries the Art. 9 health-data
      obligation and an explicit under-16 parent/guardian clause for third-party subjects.
    - `Copy.settings.reauth.*` (issue #124) — the delete-account step-up reauthentication copy.
    - `paywall.alertDismiss`, `paywall.plan.*`, `paywall.purchase.*` (issue #52) — the dummy
      purchase's pending/success/failure states; the deck's Screen 10 never specced them.
    - `history.item.a11yLabelNotAssessed`, `history.item.deleteCta`, `history.delete.error.*`,
      `history.error.*` (issue #55) — states the deck's Screen 8 table never specced.
    - `Copy.auth.reset.*` (issue #81) — the whole password-reset request/update flow; no
      "forgot password" flow exists anywhere in the deck to lift from.
    - **ADDED 2026-07-26 (issue #128 review round):** `analyzing.error.previousAttemptFailed.title`
      / `.body` and `analyzing.error.cta.startNew` — the released-reservation dead end shown for the
      server's 409 `previous_attempt_failed` and for issue #64's reconciled `released` phase, plus
      its "Start a new analysis" action. Deliberately drops the "try again" line the `failed`/
      `timeout` copy carries, because a Retry there re-submits the same idempotency key and can only
      return the same released row. Wording mirrors the server's own message; not in the deck.
    All six are written to the deck's own stated voice rules (plain, calm, name the outcome, no
    jargon, never claim a state that isn't true) but are drafts. `docs/design/copy-deck.md` now
    marks all six with a delimited "NEW — awaiting certification" note, following issue #95's
    established precedent for backfilling settled copy — except these are explicitly NOT settled
    yet. Review and certify before any of these five screens ships to real users.
35. **RESOLVED 2026-07-26 — every authenticated edge function returned `401` because
    `getPublishableKey()` misparsed the platform's key env var. Found while verifying issue #128;
    fixed in the same batch.** `quota-status`, `analyze-form`, `purchase-tier`, and `delete-account`
    all rejected valid, freshly-minted JWTs. Edge logs showed `quota-status` returning `401` on
    **every** invocation in the retained window — the captain's own app included. Nothing requiring
    a signed-in user had ever worked against the live backend.

    **Root cause — a ten-times-duplicated parser, not a secret problem.** `SUPABASE_PUBLISHABLE_KEYS`
    and `SUPABASE_SECRET_KEYS` hold a **JSON object keyed by key name** —
    `{"default":"sb_publishable_..."}` — per Supabase's own "Environment Variables" and new-API-keys
    guides. Every caller carried its own copy of a parser that only accepted a JSON **array**:

    ```ts
    if (Array.isArray(parsed) && typeof parsed[0] === 'string') return parsed[0];
    ...
    return raw;   // <- an object is not an array, so every call landed here
    ```

    The value parses, but it is an object, so the guard never matched and each function fell through
    to `return raw`, handing the **entire JSON string** to `createClient()` as the API key. GoTrue
    rejects that as an invalid `apikey`, so `auth.getUser()` errored and every request became a 401
    regardless of the caller's JWT. `SUPABASE_SECRET_KEYS` was misparsed identically, so the
    service-role clients (`reserve_analysis`, `settle_analysis`, Storage) were broken too.

    **Proven twice before fixing**, because an earlier guess at this had already been wrong: against
    the documentation above, and empirically — `sha256(JSON.stringify({default: <this project's
    publishable key>}))` matches the digest the secrets API reports for `SUPABASE_PUBLISHABLE_KEYS`
    exactly. A retracted earlier theory (that these were stale hand-set secrets shadowing the
    platform's) was disproved when `supabase secrets unset` refused: **they are platform-reserved
    and cannot be unset.** Do not try — the CLI returns "You can't delete a reserved secret."

    **The fix:** one shared `supabase/functions/_shared/supabase-keys.ts`
    (`getPublishableKey`/`getSecretKey`/`getSupabaseUrl`) that reads the documented object shape,
    still accepts the legacy bare-string and array forms, and **throws** rather than handing a
    non-key to `createClient()`. All ten duplicated copies now delegate to it. This deliberately
    reverses each copy's "a local copy limits the blast radius of concurrent multi-agent work" note:
    the duplication did not limit a blast radius, it multiplied one — a single misreading of an env
    var format was written ten times and had to be found ten times. Add new callers there, not
    another copy.

    **Deploy state — all six functions now carry the fix live.** `analyze-form`, `quota-status`,
    and `purchase-tier` went out in the first batch; the deploy authority was then extended and
    `delete-account`, `analysis`, and `sweep-orphaned-media` followed at 2026-07-26T03:41:28Z. An
    earlier version of this entry said those three were deliberately not redeployed and "still 401
    in production" — that was true when written and is now false.

    Verified by observation, not assumption: `analysis` answered `404 not_found` to a `DELETE` of a
    non-existent uuid (auth passed, nothing destroyed), and `delete-account` answered
    `200 {"deleted": true}` on a purpose-made throwaway account — which exercises **both** the
    publishable-key parse used for auth and the secret-key parse used by the service-role purge
    client. The throwaway user was confirmed gone afterwards; no other data was touched.

    ⚠️ **`sweep-orphaned-media` is deployed and typechecked but was NOT exercised.** It is gated on
    an `X-Cron-Secret` shared secret rather than a user JWT, and that secret was deliberately
    neither guessed nor printed, so its runtime behavior on the live project is unverified. Five of
    the six are verified live; this one is deploy-only.

36. **NEW — Free tier's zero-model-call sample preview (captain-approved 2026-07-26) has no
    per-user rate limit, flagged by both the threat-modeling and security-review passes on that
    change.** ⚠️ **LIVE AS OF 2026-08-05.** This issue described the behavior of code that, until
    that date, was merged to `main` but not deployed — the v23-launch-audit-r1 audit checked it
    against production and correctly found the described gap absent, because the short-circuit
    itself wasn't running yet (see #37). The deploy in #37 made this issue real: it is now
    production behavior, and the follow-up it asks for is tracked as **issue #170**. Before this change, every `analyze-form` caller — Free included — went through
    `reserve_analysis`, which enforced a hard lifetime cap of 1 for Free plus the 3-strike
    anti-farming counter. The new `pace_current_tier` short-circuit (see `docs/architecture.md`'s
    "Current — `analyze-form` edge function") returns the canned sample and exits BEFORE
    `reserve_analysis` (or any other counter) is ever called — by design, since the whole point is
    zero cost and zero quota consumption for a fabricated preview. The only remaining bound on a
    Free-tier caller is `parseRequestBody`'s existing global DoS ceiling (≤8 frames, ≤5MB per
    request — `PACE_FRAME_CAP.elite`/`PACE_MAX_REQUEST_BODY_BYTES`), which was never a per-user
    throttle. Net effect: a Free-tier account can call `analyze-form` an unlimited number of times,
    each up to a 5MB authenticated POST, with no AI spend (the goal is fully met) but also no
    counter on edge-function invocation volume or bandwidth — a regression from the prior
    lifetime-cap behavior along that one axis. Both review passes rated this MEDIUM, not a blocker:
    worth a deliberate follow-up (a lightweight per-user throttle, or Supabase's project-level rate
    limiting), not a silent gap — recorded here rather than fixed in the same change, since it
    would mean new schema/RPC surface beyond this task's captain-approved scope (the free-tier
    behavior change, not new abuse-prevention infrastructure).

37. **RESOLVED 2026-08-05 — `main` had been three commits ahead of production for ten days, and
    the drift was costing real money while the shipped copy said otherwise.** PR #171 ("make Free
    tier a zero-model-call sample preview") merged 2026-07-26, but **neither half of it was ever
    shipped**: `20260804120000_pace_current_tier_function.sql` was never applied (repo had 25
    migrations, the live ledger had 24, and `pg_proc` had no `pace_current_tier`), and
    `analyze-form` was still serving the version deployed 2026-07-26T03:32:37Z — from *before* the
    fix. The v23-launch-audit-r1 audit proved the consequence by calling the live endpoint as a new
    Free user: it got back a real, paid, model-generated analysis of its own photo
    (`isFallback: false`, with an `analysisId` — the pre-#171 wire shape), which cost **$0.1023**
    and spent that account's one lifetime slot. Meanwhile `constants/copy.ts`'s 2026-08-05 honesty
    fix had already shipped, telling those users they had "viewed the sample." **The docs in this
    repo were not wrong about the design — they were wrong about what was running**, which is the
    reusable lesson: `docs/architecture.md`'s "deployed 2026-07-26" annotations described a merge,
    not a deploy, and nothing in the repo distinguishes the two. Fixed by applying the migration
    and redeploying, **strictly in that order** — `analyze-form` deployed against a database
    without `pace_current_tier` would 500 every request, because `currentTier` deliberately throws
    rather than defaulting to free. Verified live afterwards rather than assumed: a fresh Free
    account got exactly `{result, isSample: true}` with no `analysisId`, its quota unspent
    (`used: 0`), and **zero** new `ai_call_log` / `analyses` / storage rows. Ledger is now 25
    (latest `20260804120000`); `analyze-form` is version 8. **Check deployed state against `main`
    before trusting any "deployed" annotation in these docs** — `supabase migration list` and the
    functions' `updated_at` are the authorities, not a merge commit.

## Next action

**RESOLVED/REWRITTEN 2026-07-26 — this section described "Start Phase 2 — Capture (M2)" as the
immediate next step long after M2–M7 were built and the full sign-up → analysis → result path
went live end to end (issue #128). It went unedited for several milestones — see GitHub issue
#154.** The Milestones table and Known Issues above are the authoritative, current source for
what's built and what's open; this section points at them rather than re-describing their content,
so it cannot drift out of sync with them the same way again. As of 2026-07-26, the concrete items
still standing between here and a public/TestFlight release:

- ~~**Known Issue #21** — `PURCHASE_TIER_DUMMY_ENABLED` must be unset before any TestFlight or
  public release~~ **RESOLVED 2026-08-06** — both `PURCHASE_TIER_DUMMY_ENABLED` and
  `PURCHASE_TIER_ALLOWED_USER_IDS` are unset on the live project (captain decision
  `purchase-tier-dummy-flag-now`); see that entry above for verification.
- ~~**Known Issue #12** — CAPTCHA is needed before `analyze-form` can go live publicly~~
  **RESOLVED 2026-08-02/03** — see that entry above for the full story
  (`supabase/functions/signup-with-captcha`, not native `auth.captcha`).
- **Known Issue #36 — email sign-up: still OPEN, with a narrowed remaining scope.** Both known
  causes are addressed — the latent `baseUrl` bug is fixed in code on this branch, and the captain
  has provisioned the site key and allow-listed the hostname (see "What is proven, and what is
  not" at the end of this entry). What is **not** proven is the final hop: no email/password
  account has ever been created. A live check of `auth.users` on `vputdomdlknvthnzritt` on
  2026-08-12 returned exactly **one** row — `200154@ucis.ac.th`, created 2026-08-10, Google
  provider, no password. Do not record email sign-up as live-verified end to end until a human
  completes one real sign-up. The diagnosis below is kept as the historical record of what was
  actually wrong, because the two causes stacked in a way that made each other invisible.

  Diagnosed 2026-08-12 (branch `fm/v23-signup-signin-cloudflare-fix-r1`) after the
  captain reported "email sign-up and sign-in are both broken". Verified live against
  `vputdomdlknvthnzritt`, in this order:
  - `TURNSTILE_SECRET_KEY` **is** set on the edge function and works — a bogus token returns
    `captcha_invalid` (not `signup_unavailable`), and its SHA-256 matches none of Cloudflare's
    three dummy secrets, so it is a real key. It was last set 2026-08-11 13:34.
  - `EXPO_PUBLIC_TURNSTILE_SITE_KEY` was set **nowhere**: empty in every `.env`, absent from all
    three EAS environments. Only `eas.json`'s `development-local`/`preview-local` profiles carried
    one, and it is Cloudflare's dummy always-passes key. The captain had set the server half of the
    pair and never the client half. With no key the widget never mounts, no token is issued, and
    "Create account" is permanently disabled behind the honest unavailable notice.
  - `auth.users` held exactly **one** account, a **Google** identity with **no password**. So no
    email/password account has ever existed, which is the whole of "sign-in is broken too": it is
    a consequence, not a regression. Sign-in itself is healthy — `/auth/v1/token?grant_type=password`
    was exercised live and issued a session for a password account created for the probe (since
    deleted). Typing the Google-linked email into the email form returns GoTrue's deliberate
    `invalid_credentials`, indistinguishable from a wrong password by design.
  - A second, latent cause sat underneath: `components/turnstile-widget.tsx` loaded its challenge
    with `source={{ html }}` and no `baseUrl`, i.e. under `about:blank`/a `null` origin. Turnstile
    widgets are hostname-bound and Cloudflare offers no way to disable that check, so a **real**
    site key would have failed with error 110200 even once provisioned. Cloudflare's dummy keys
    ignore hostnames, which is exactly why #166's verification passed on a path production never
    takes. **Fixed on this branch** (`lib/turnstile-config.ts` + a `baseUrl` prop), with
    regression locks in `lib/__tests__/turnstile-config.test.ts`,
    `components/__tests__/turnstile-widget.test.tsx` and `app/(auth)/__tests__/sign-in.test.tsx`.

  **What is proven, and what is not, 2026-08-12.** The captain did the two things only the
  Cloudflare and EAS dashboards can do:
  - `EXPO_PUBLIC_TURNSTILE_SITE_KEY` is now set in the real gitignored `.env` **and** created in
    **all three** EAS environments (`development`, `preview`, `production`), each confirmed
    present. The client half of the pair finally matches the server half.
  - `vputdomdlknvthnzritt.supabase.co` — the default base URL `lib/turnstile-config.ts` resolves —
    was added to that widget's allowed-domain list in Cloudflare, so no
    `EXPO_PUBLIC_TURNSTILE_HOSTNAME` override is needed. That is what makes the fixed `baseUrl`
    actually pass Cloudflare's hostname check instead of returning 110200.

  **Proven with that configuration in place:** the challenge is served and solved successfully
  under the `baseUrl` `lib/turnstile-config.ts` resolves — observed in the app on an iOS simulator,
  where Turnstile returned Success and enabled the "Create account" button, and independently by
  loading the widget's exact WebView source in a real browser under the allow-listed Supabase
  hostname. The **old** no-`baseUrl` path still fails with the app-visible error under the same
  real key, which pins the regression from both sides. The reworded invalid-credentials copy was
  observed rendering from a genuine production HTTP 400.

  **Not proven — the remaining scope of this issue:** the final hop from a solved-challenge token
  through `signup-with-captcha` to a new row in `auth.users`. Cloudflare refuses to issue tokens to
  automated browsers by design, so this cannot be scripted; it needs a human completing one real
  sign-up on a device or dev build. `auth.users` still holds only the single Google account, so no
  email sign-up has ever completed.

  **Two things about this that stay true and must not be "tidied up" later.** The real site key
  lives ONLY in the gitignored `.env` and in EAS — never in `eas.json` or any other tracked file,
  per CLAUDE.md § Secrets & env; a reviewer reading the repo alone therefore cannot see it, and its
  absence from the diff is correct, not a gap. And `eas.json`'s `development-local`/`preview-local`
  profiles deliberately keep Cloudflare's dummy `1x00000000000000000000AA` for local-stack testing.
  The dummy keys ignore hostnames, so a green local run still proves nothing about production —
  that is the exact blind spot that hid this bug for the whole of #166's life.
- **Known Issue #17** — a hard spend ceiling in the Anthropic Console is still unset (needs Ian's
  Anthropic Console access).
- **Known Issue #15** — `docs/privacy-policy.md` publication is on hold pending Ian's answer on
  data controller identity (Individual vs. Organization Apple Developer enrollment) and a contact
  email; the policy carries a `DO NOT PUBLISH` guard until then.
- **Issue #39** (M3 milestone row above) — Ian's certification review of the Elasticity content is
  still open; the prompt ships his name.
- **Known Issue #31** — `.maestro/` E2E flows ran for the first time 2026-07-25 but are not yet a
  clean, repeatable pass.
- **Known Issue #24/#34** — several blocks of uncertified copy across Settings, consent, paywall,
  history, and password-reset screens still need `ux-copywriter`/Ian review.
- [`docs/blocked-on-apple.md`](blocked-on-apple.md) — everything gated on the Apple Developer
  Program (the TestFlight pipeline, Sign in with Apple).

Original text, kept for the record (accurate as of 2026-07-11, stale from 2026-07-12 onward once
M2 shipped):

> The build is now driven by [`docs/mvp-build-prompt.md`](mvp-build-prompt.md) (three-lens audit +
> rulings + decision gate). **The decision gate is fully closed** — Ian answered every remaining
> item on 2026-07-11 (fallback/quota behavior, the clip-length/frame-count/upload-size numbers,
> the app name, Apple Developer timing, and the consent/privacy package), joining the four
> design/product decisions already locked on 2026-07-10 (distinct-but-related design, 0–100+band,
> frames-only storage, minimal Elite compare). All 14 rulings + the full decision gate are synced
> into `planning/*` and `docs/architecture.md`. Immediate:
>
> 1. ~~Build step 1: knowledge files~~ **done** — pending Ian's certification review of Elasticity.
> 2. ~~Decision gate~~ **done 2026-07-11** — every item answered; see `docs/change_log.md`.
> 3. ~~Phase 0.5: design layer~~ **done 2026-07-11** — copy deck, tokens + AA proof, motion
>    consult, privacy checklist all landed; pending Elasticity certification only (see #5 above).
> 4. ~~Push `ANTHROPIC_API_KEY`~~ **done 2026-07-11** — rotated by Ian, in production secrets.
> 5. ~~Phase 1 — the spine (M1)~~ **built & reviewed 2026-07-11 on `feat/m1-spine`** — DB spine (7
>    migrations live), auth spine (email + Google), empty Home, code-review fixes, security audit
>    (no Critical/High). Pending Ian's on-phone gate test and the PR merge.
> 6. **Start Phase 2 — Capture (M2)** once the M1 PR merges: `lib/frames.ts` (extraction +
>    downscale; **no Storage upload** — that moved server-side under #88, see Known Issue #16) and
>    the capture/pick screens, per `docs/mvp-build-prompt.md`'s Phase 2. **The SecureStore
>    session-storage move (#13) is done** (2026-07-12, issue #38 — see Known Issue #13 above).
>    Neither #10 (runner's note, resolved) nor #12 (CAPTCHA) nor #14 (Phase 4 contract notes) block
>    M2 — #12 blocks M4 going live, #14 is scoped
>    to the M4 build itself. **#16's migration is applied and verified live as of 2026-07-12** —
>    M2/M4 code should be written straight against the new (`no mediaPaths`, server-side upload)
>    contract; there is no old contract left to accidentally target.
