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
| M4 — Analysis engine (photo/video → valid PACE result; malformed responses never reach the user) | Not started |
| M5 — Tiers & quotas (quota unbypassable server-side; paywall shows at the right moments) | Not started |
| M6 — Past Analyses (results + stored frames persist and re-open; delete purges both row and storage objects) | Not started |
| M7 — Polish & TestFlight (stranger can go sign-up → analysis → result without a dead end) | Not started — except the privacy slice of issue #68, landed 2026-07-12: privacy policy drafted (publication **on hold**, see Known Issue #15), App Store label answers recorded, no-analytics-SDK re-confirmed. The consent **record** (`public.consents`, `lib/consent.ts`) and the `<ConsentGate />` / `<ResultDisclaimer />` components landed 2026-07-12; the three #68 checkboxes remain blocked on their host screens (M2/M4/M5), which now inherit drop-ins rather than re-deriving Art. 9 consent under deadline. Server-side enforcement is a binding M4 requirement — see Known Issue #14. |

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
13. **NEW — session storage is plaintext AsyncStorage today (MEDIUM, audit finding).**
    `lib/supabase.ts` stores the session (including the refresh token) via AsyncStorage, which
    is unencrypted on-device. Low urgency for M1 (no sensitive app data sits behind the session
    yet), but M2 starts writing user media behind a signed-in session. **Move to a
    SecureStore-backed adapter at M2** (the "LargeSecureStore" pattern: SecureStore holds the
    encryption key, AsyncStorage holds the encrypted blob — SecureStore alone has no room for a
    full session payload).
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
   downscale + direct-to-bucket upload) and the capture/pick screens, per
   `docs/mvp-build-prompt.md`'s Phase 2. Also due at/around M2: the SecureStore session-storage
   move (#13). Neither #10 (runner's note, resolved) nor #12 (CAPTCHA) nor #14 (Phase 4 contract
   notes) block M2 — #12 blocks M4 going live, #14 is scoped to the M4 build itself.
