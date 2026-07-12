# Status

Where the project actually is, updated whenever a milestone's status moves. See
[`CLAUDE.md`](../CLAUDE.md), [`docs/change_log.md`](change_log.md), and
[`planning/02-product-requirements.md`](../planning/02-product-requirements.md) for the
milestone "done" criteria.

## Milestones

| Milestone | Status |
|---|---|
| M1 — Foundation (sign-up creates an account → empty Home) | **Done 2026-07-11** — security audit (no Critical/High) + code review (5 findings fixed), gate passed with Ian's on-phone sign-up test; merged via PR from `feat/m1-spine` |
| M2 — Capture (upload-from-library and in-app record both hand a valid, budget-compliant frame set to analysis on iOS) | Not started |
| M3 — Knowledge grounding (prompt provably includes PACE framework text; output references PACE pillars) | Not started — knowledge files exist; Elasticity pending Ian's certification |
| M4 — Analysis engine (photo/video → valid PACE result; malformed responses never reach the user) | Not started — the AI spend guardrail substrate it must build behind (kill switch, daily cap, circuit breaker, per-call ledger; issue #91) landed 2026-07-12 and was **applied to the live project the same day** (`supabase db push`, verified — see Known Issue #17). Only the manual Anthropic Console spend ceiling remains open. |
| M5 — Tiers & quotas (quota unbypassable server-side; paywall shows at the right moments) | Not started |
| M6 — Past Analyses (results + stored frames persist and re-open; delete purges both row and storage objects) | Not started |
| M7 — Polish & TestFlight (stranger can go sign-up → analysis → result without a dead end) | Not started — except the privacy slice of issue #68, landed 2026-07-12: privacy policy drafted (publication **on hold**, see Known Issue #15), App Store label answers recorded, no-analytics-SDK re-confirmed. The consent **record** (`public.consents`, `lib/consent.ts`) and the `<ConsentGate />` / `<ResultDisclaimer />` components landed 2026-07-12; the three #68 checkboxes remain blocked on their host screens (M2/M4/M5), which now inherit drop-ins rather than re-deriving Art. 9 consent under deadline. Server-side enforcement is a binding M4 requirement — see Known Issue #14. The repo also gained its **first CI workflow** 2026-07-12 — a daily scheduled canary for the HIBP check, not a PR gate — narrowing issue #74; see `docs/architecture.md`'s "Current — CI" section. |

## Done so far

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
- Full dated history: [`docs/change_log.md`](change_log.md).

## Known issues

1. ~~**Final app name not picked.**~~ **RESOLVED 2026-07-11.** Name is **"Pace AnalysisAI"**
   (repo/directory keeps the "V2.3" codename internally). `app.json` updated: `name`
   "Pace AnalysisAI", `scheme` "paceanalysisai".
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
12. **NEW — CAPTCHA required before `analyze-form` (M4) goes live.** The M1 security audit found
    the hosted Supabase project has **no signup rate-limit field at all** (`sign_in_sign_ups` in
    `config.toml` is CLI/self-hosted-only; the Management API silently drops it on a hosted
    project) and `mailer_autoconfirm` is deliberately on for M1 (no transactional email provider
    or confirmation-pending screen exists yet). Combined, each disposable signup is unthrottled
    and worth ~4 potential Anthropic calls once M4 ships (Free tier's 1 lifetime analysis ×
    farmable accounts). CAPTCHA (`auth.captcha`, hCaptcha or Turnstile) is the only real lever on
    this plan — needs Ian to create provider keys; an account-creation step, not something
    buildable from the repo. **Blocks M4 going live, not the M4 build itself.**
13. ~~**Session storage is plaintext AsyncStorage today**~~ **RESOLVED 2026-07-12 (issue #38).**
    `lib/supabase.ts` now passes `storage: secureSessionStorage` (`lib/secure-storage.ts`), the
    "LargeSecureStore" pattern: a fresh random AES-256 key per write lives in SecureStore
    (Keychain/Keystore-backed, 64 hex chars — provably under the 2048-byte SecureStore value
    limit regardless of session size), and the AES-CTR-encrypted session blob lives in
    AsyncStorage. The app's 2 existing real accounts are migrated transparently on next launch
    (legacy plaintext JSON, detected by its leading `{`, is read once then re-encrypted) rather
    than silently signed out. Web (`npm run web`) falls back to plain AsyncStorage —
    `expo-secure-store` has no web implementation. Covered by `lib/__tests__/secure-storage.test.ts`
    (16 cases: round trip, the oversized-session/2048-byte case, the migration path incl. a
    failed-migration-write fallback, and the web/native platform split).
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
      issue's remaining scope is now just its two follow-ups, neither built yet: **#47** (the
      stale-`reserved` sweep must also purge the storage prefix, not just flip the row's status)
      and **#57** (`DELETE /functions/v1/analysis/:id` is now a hard prerequisite for any
      user-facing delete, since the client's row `DELETE` is also gone).
17. **AI spend guardrail contract for #44 — migrations applied and verified; one manual step
    still open (issue #91, 2026-07-12).** The substrate ("Done so far" above) is live:
    - **Applied to the live project 2026-07-12** (`supabase db push`, alongside #2's and #88's
      migrations). `ai_ops_config`, `ai_model_pricing`, and `ai_call_log` all exist;
      `authenticated` can SELECT none of them and cannot EXECUTE `gate_ai_call` — service-role
      only, exactly as designed. `analyze-form` (#44, still Not Started) can call
      `gate_ai_call`/`record_ai_call` the moment it's built — nothing further is needed at the
      DB layer first.
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
      signup rate limiting (Known Issue #12, still blocked on Ian).
18. **NEW — `storage.objects` table-level `GRANT INSERT`/`GRANT DELETE` to `authenticated` were
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
    on this table by mistake. Fix (not yet done): `revoke insert, delete on storage.objects from
    authenticated;`, mirroring #2's pattern.

## Next action

The build is now driven by [`docs/mvp-build-prompt.md`](mvp-build-prompt.md) (three-lens audit +
rulings + decision gate). **The decision gate is fully closed** — Ian answered every remaining
item on 2026-07-11 (fallback/quota behavior, the clip-length/frame-count/upload-size numbers,
the app name, Apple Developer timing, and the consent/privacy package), joining the four
design/product decisions already locked on 2026-07-10 (distinct-but-related design, 0–100+band,
frames-only storage, minimal Elite compare). All 14 rulings + the full decision gate are synced
into `planning/*` and `docs/architecture.md`. Immediate:

1. ~~Build step 1: knowledge files~~ **done** — pending Ian's certification review of Elasticity.
2. ~~Decision gate~~ **done 2026-07-11** — every item answered; see `docs/change_log.md`.
3. ~~Phase 0.5: design layer~~ **done 2026-07-11** — copy deck, tokens + AA proof, motion
   consult, privacy checklist all landed; pending Elasticity certification only (see #5 above).
4. ~~Push `ANTHROPIC_API_KEY`~~ **done 2026-07-11** — rotated by Ian, in production secrets.
5. ~~Phase 1 — the spine (M1)~~ **built & reviewed 2026-07-11 on `feat/m1-spine`** — DB spine (7
   migrations live), auth spine (email + Google), empty Home, code-review fixes, security audit
   (no Critical/High). Pending Ian's on-phone gate test and the PR merge.
6. **Start Phase 2 — Capture (M2)** once the M1 PR merges: `lib/frames.ts` (extraction +
   downscale; **no Storage upload** — that moved server-side under #88, see Known Issue #16) and
   the capture/pick screens, per `docs/mvp-build-prompt.md`'s Phase 2. **The SecureStore
   session-storage move (#13) is done** (2026-07-12, issue #38 — see Known Issue #13 above).
   Neither #10 (runner's note, resolved) nor #12 (CAPTCHA) nor #14 (Phase 4 contract notes) block
   M2 — #12 blocks M4 going live, #14 is scoped
   to the M4 build itself. **#16's migration is applied and verified live as of 2026-07-12** —
   M2/M4 code should be written straight against the new (`no mediaPaths`, server-side upload)
   contract; there is no old contract left to accidentally target.
