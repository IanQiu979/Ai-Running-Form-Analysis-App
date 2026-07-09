# Status

Where the project actually is, updated whenever a milestone's status moves. See
[`CLAUDE.md`](../CLAUDE.md), [`docs/change_log.md`](change_log.md), and
[`planning/02-product-requirements.md`](../planning/02-product-requirements.md) for the
milestone "done" criteria.

## Milestones

| Milestone | Status |
|---|---|
| M1 — Foundation (sign-up creates an account → empty Home) | Not started — scaffold + Supabase project/auth partially provisioned |
| M2 — Capture (upload-from-library and in-app record both hand off a valid file on iOS) | Not started |
| M3 — Knowledge grounding (prompt provably includes PACE framework text; output references PACE pillars) | Not started — knowledge files not yet copied in |
| M4 — Analysis engine (photo/video → valid PACE result; malformed responses never reach the user) | Not started |
| M5 — Tiers & quotas (quota unbypassable server-side; paywall shows at the right moments) | Not started |
| M6 — Past Analyses (results + media persist and re-open; delete purges both row and media) | Not started |
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

1. **Final app name not picked.** Working title "V2.3 — Photo/Video Running Analysis" is used
   everywhere until resolved; also blocks #2 below. Owner: user.
2. **`app.json` slug `v2.3-photo-video-analysis` fails `expo-doctor`**: Expo requires
   `^[a-zA-Z0-9_-]+$` and the `.` is illegal. Unresolved, tied to the still-open app-name
   decision above. Owner: user.
3. **Sign in with Apple is not yet possible**: `expo-apple-authentication` is not installed,
   and `apple` is off on the live Supabase project's auth settings. It is an App Store gate
   once Google ships — Apple requires it when a third-party social login is offered. Owner:
   user (needs an Apple Developer account).
4. **`ANTHROPIC_API_KEY` is not set anywhere yet** — not in `supabase/functions/.env`, not
   pushed via `supabase secrets set`. Blocks M4. Owner: user/Claude.
5. **Knowledge files not yet copied in.** `knowledge/pace_framework.md`, `injury_flags.md`, and
   `drills.md` don't exist yet — this is planning's "build step 1" (copy Echo V1's knowledge
   files and adapt ECHO → PACE). Blocks M3. Owner: Claude.
6. **Private Storage bucket for media not yet created** on the `v2.3Analysis` Supabase
   project. Blocks M2/M6. Owner: Claude.
7. **EAS project not initialized** (`eas init` not run). No TestFlight pipeline exists yet.
   Owner: user/Claude, at M7.
8. **Echo V1's Supabase project** (`IanQiu979's Project`, ref `trgpnnyqonaxhnyhtmlz`) is
   **paused**, which is what freed the Free-plan slot for `v2.3Analysis`. 90-day restore
   window from 2026-07-10.
9. **Free-tier storage is 1 GB with 5 GB/month egress.** Since media is kept by default, this
   is a known scaling limit before real users.

## Next action

1. Build step 1: copy the 4 knowledge files in from Echo V1 and adapt ECHO → PACE
   (`knowledge/pace_framework.md`, `injury_flags.md`, `drills.md`).
2. Push `ANTHROPIC_API_KEY` to the project's edge-function secrets once it exists.
3. Start M1: auth screens (Google + email sign-up/sign-in) and an empty Home.
