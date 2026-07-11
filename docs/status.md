# Status

Where the project actually is, updated whenever a milestone's status moves. See
[`CLAUDE.md`](../CLAUDE.md), [`docs/change_log.md`](change_log.md), and
[`planning/02-product-requirements.md`](../planning/02-product-requirements.md) for the
milestone "done" criteria.

## Milestones

| Milestone | Status |
|---|---|
| M1 — Foundation (sign-up creates an account → empty Home) | Not started — scaffold + Supabase project/auth partially provisioned |
| M2 — Capture (upload-from-library and in-app record both hand a valid, budget-compliant frame set to analysis on iOS) | Not started |
| M3 — Knowledge grounding (prompt provably includes PACE framework text; output references PACE pillars) | Not started — knowledge files exist; Elasticity pending Ian's certification |
| M4 — Analysis engine (photo/video → valid PACE result; malformed responses never reach the user) | Not started |
| M5 — Tiers & quotas (quota unbypassable server-side; paywall shows at the right moments) | Not started |
| M6 — Past Analyses (results + stored frames persist and re-open; delete purges both row and storage objects) | Not started |
| M7 — Polish & TestFlight (stranger can go sign-up → analysis → result without a dead end) | Not started |

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
   account).
4. **`ANTHROPIC_API_KEY` is not set anywhere yet** — not in `supabase/functions/.env`, not
   pushed via `supabase secrets set`. Blocks M4. Owner: user/Claude.
5. ~~**Knowledge files not yet copied in.**~~ **DONE 2026-07-10.** `knowledge/pace_framework.md`,
   `injury_flags.md`, and `drills.md` now exist — Posture/Arm-swing/Cadence adapted from the ECHO
   library and refined against cited literature; **Elasticity authored from peer-reviewed sources**
   (citations in `pace_framework.md`). **Pending: Ian's certification review** of the Elasticity
   content + refinements before M3 ships (it carries his name).
6. **Private Storage bucket for media not yet created** on the `v2.3Analysis` Supabase
   project. Blocks M2/M6. Owner: Claude.
7. **EAS project not initialized** (`eas init` not run). No TestFlight pipeline exists yet.
   Owner: user/Claude, at M7.
8. **Echo V1's Supabase project** (`IanQiu979's Project`, ref `trgpnnyqonaxhnyhtmlz`) is
   **paused**, which is what freed the Free-plan slot for `v2.3Analysis`. 90-day restore
   window from 2026-07-10.
9. **Free-tier storage is 1 GB with 5 GB/month egress.** Media retention is now **frames only**
   (a few hundred KB per analysis, not the 60–130MB a full video would cost — see Ruling 1 in
   `docs/mvp-build-prompt.md`), which keeps this viable through the MVP; still worth watching
   before real-user scale.

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
3. Push `ANTHROPIC_API_KEY` to the project's edge-function secrets once it exists.
4. **Start Phase 1 — the spine (M1)**: `env-config-manager` (secrets, private media bucket,
   deep-link allowlist, app.json permission plugins) → `database-engineer` (migrations,
   reserve/settle RPC, storage RLS) → `supabase-auth` (Google + email sign-in/up) →
   `security-auditor`, per `docs/mvp-build-prompt.md`'s Phase 1.
