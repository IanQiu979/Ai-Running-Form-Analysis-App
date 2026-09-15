@AGENTS.md

The imported [`AGENTS.md`](AGENTS.md) pins the Expo SDK docs and maps every task to the subagent
that should do it. The rules below bind those agents — they never override them.

## What this is

V2.3 — Photo/Video Running Analysis (working title; final name is OPEN, see
`docs/status.md` #1). An Expo/React Native app, part of the PACE family: submit a photo or
video of your running form and get certified, actionable feedback — it does one thing, no
training plans, no logging, no chat. Full spec: [`planning/README.md`](planning/README.md)
and the linked brainstorm / product / engineering docs it indexes.

## Architecture at a glance

Client: Expo SDK 57, expo-router, TypeScript strict. Backend: Supabase (Postgres + Auth +
Storage + Edge Functions). AI: Claude (`claude-sonnet-5`), called only from the `analyze-form`
edge function, never from the client. The app, its migrations, and all seven edge functions exist
and are live on the Supabase project — the sign-up → analysis → result path ran end to end against
it on 2026-07-26 (issue #128), and `signup-with-captcha` (Known Issue #12) followed on 2026-08-03.
Route tree, `lib/` layout, the `analyze-form` flow, the API table
(which owns per-endpoint deployment status), and the DB schema all live in
[`docs/architecture.md`](docs/architecture.md); current milestone and live-state detail is in
[`docs/status.md`](docs/status.md).

## Commands

| Command | Does |
|---|---|
| `npm start` | `expo start` — serves a **development build** URL, not Expo Go (see below) |
| `npm run start:go` | `expo start --go` — serves `exp://…` for Expo Go on a phone |
| `npm run ios` / `npm run android` / `npm run web` | `expo start --ios` / `--android` / `--web` |
| `npm run typecheck` | `npm run generate:routes && tsc --noEmit && npm run typecheck:edge` — the app + `supabase/functions/` |
| `npm run generate:routes` | Codegens the gitignored `.expo/types/router.d.ts` (typed routes) without booting Metro. Chained into `typecheck`, so you never call it directly — without it `tsc` silently stops checking route strings altogether (issue #118) |
| `npm run typecheck:edge` | `deno check` over `supabase/functions/` only (issue #90) |
| `npm run lint` | `expo lint` |
| `npm test` | `jest && npm run test:edge` — the app + `supabase/functions/` |
| `npm run test:edge` | `npm run verify:knowledge && deno test` over `supabase/functions/` only (issue #90) |
| `npm run generate:knowledge` | Codegens `supabase/functions/_shared/knowledge.generated.ts` from `knowledge/*.md` — run after editing any of those files, then commit the regenerated output |
| `npm run verify:knowledge` | Regenerates the knowledge bundle and fails (`git diff --exit-code`) if it drifted from a committed `knowledge/*.md` edit |

Run `npm run typecheck && npm run lint && npm test` clean before every commit — both composite
commands now cover `supabase/functions/` too (issue #90), so this one invocation is still the
whole gate; nothing extra to remember. `typecheck:edge`/`test:edge` need Deno on `PATH` (installed
locally at `~/.local/bin/deno`) — see `docs/architecture.md`'s "Current — Deno build/test
contract..." section for why the Deno/Jest split is where it is.

To actually SEE a change in the running app you need a native build (`expo run:ios --device
<udid>`), and two things bite before it works: an agent worktree usually has no `node_modules`, so
`npx expo` silently fetches the newest Expo CLI instead of this project's SDK 57 — run
`npm install` and call `./node_modules/.bin/expo` — and **`expo run:ios` rewrites `package.json`**,
flipping the `ios`/`android` scripts from `expo start --*` to `expo run:*`. That is a tracked file
and contradicts the table above: `git checkout -- package.json` after any native build.

`expo-dev-client` is a dependency, so plain `expo start` defaults to a development build and its
QR code is an `exp+…://expo-development-client/` deep link that **Expo Go cannot open**. Use
`npm run start:go` (or press `s` in the running dev server) to get an Expo Go `exp://` URL.
Expo Go on the **iOS App Store is pinned to the newest SDK (57 as of 2026-09-05)**, which matches
this project; Expo Go on the **Play Store tracks the newest SDK too, and will reject this project
the moment Expo ships SDK 58** — Android needs a dev build.

## Secrets & env — read this before touching any env file

- `.env` (gitignored) holds ONLY `EXPO_PUBLIC_SUPABASE_URL`,
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_TURNSTILE_SITE_KEY` and the optional
  `EXPO_PUBLIC_TURNSTILE_HOSTNAME` — nothing Google-related belongs there, ever; the browser
  OAuth flow never reads a client-ID var. `.env.example` is the committed template — copy it,
  never edit it in place.
- **Turnstile is a PAIR of keys and a hostname; all three are provisioned as of 2026-08-12 and
  none of them live in a tracked file.** Setting `TURNSTILE_SECRET_KEY` server-side does not enable
  sign-up on its own — without `EXPO_PUBLIC_TURNSTILE_SITE_KEY` the widget never renders and
  "Create account" is permanently disabled behind an honest notice. And a real site key only works
  if the hostname the challenge is rendered under is on that widget's allow list in Cloudflare
  (there is no way to disable that check); `lib/turnstile-config.ts` resolves both together and
  explains the whole failure mode. The site key is now set in the gitignored `.env` and in all
  three EAS environments, and `vputdomdlknvthnzritt.supabase.co` is allow-listed on the widget, so
  no `EXPO_PUBLIC_TURNSTILE_HOSTNAME` override is needed and the challenge renders and can be
  solved. **Email SIGN-IN was verified live end to end on 2026-08-12** — a real sign-in reached the
  Home screen. **Email SIGN-UP on that date created the account but never completed into the app**:
  it left the user on the form, so a retry came back `email_in_use` and the record wrongly read as
  "sign-up is failing" when it was in fact succeeding and having its session discarded. That was not
  fixed until 2026-08-15 (`docs/status.md` Known Issue #39). **The 2026-08-15 fix is verified at the
  NETWORK LAYER against the live project, and is NOT yet verified in-app on a simulator.**
  **Do not "fix" the key's absence from the repo by committing
  it** — `eas.json` keeps Cloudflare's dummy key in its two `*-local` profiles on purpose. **Those
  dummy test keys ignore hostnames**, so local/dev environments cannot reproduce a production
  hostname failure — never conclude sign-up works from a dummy-key run. `docs/status.md` Known
  Issue #38 has the live evidence and the exact remaining scope.
- Anything prefixed `EXPO_PUBLIC_` is inlined in **plain text** into the compiled app bundle.
  Treat it as public. Always read it with static dot notation (`process.env.EXPO_PUBLIC_X`) —
  the `expo/no-dynamic-env-var` lint rule enforces this; destructuring or bracket access
  silently yields `undefined`.
- `ANTHROPIC_API_KEY` must NEVER get an `EXPO_PUBLIC_` prefix and must NEVER go in `.env`. It
  belongs in `supabase/functions/.env` (gitignored, local dev) and is pushed to production with
  `supabase secrets set` — done 2026-07-26, alongside the first `analyze-form` deploy.
- **Temporary comprehensive-test override:** the server-only secret
  `ALL_USERS_UNLIMITED_ACCESS=true` makes every authenticated account behave as Elite with an
  unlimited analysis-count quota. The additive wrapper RPCs live in
  `20260807090000_all_users_unlimited_access_override.sql`; the normal hardened quota/RLS path is
  untouched and remains the default. **Unset this secret (or set it to `false`) before onboarding
  real users.** Never add an `EXPO_PUBLIC_` version and never replace the underlying quota system.
- Supabase auto-injects `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`
  into edge functions at runtime. Never set these by hand. **Both `*_KEYS` vars hold a JSON object
  keyed by key name (`{"default":"sb_..."}`), not an array or a bare string** — always read them
  through `supabase/functions/_shared/supabase-keys.ts`, never a local parser. A duplicated parser
  that assumed an array 401'd every authenticated function for days; see that file's header and
  `docs/status.md` Known Issue #35.
- Google's OAuth client secret and Apple's sign-in credentials live only in the Supabase
  Dashboard, never in a repo file.
- **Uploaded media is sensitive** (images of people's bodies). What's stored is **extracted
  frames only** — the full-resolution video never leaves the device (Ruling 1,
  `docs/mvp-build-prompt.md`). Frames live in a **private Storage bucket with owner-scoped
  RLS**, are **kept by default** so they can appear in Past Analyses, and are **purged** when
  the user deletes an analysis or deletes their account. No public URLs; access via signed
  URLs or authenticated reads. **The client never writes to the bucket** — it sends frames as
  base64 in the `analyze-form` request body and the edge function uploads them with the
  service-role key, only after the model call succeeds, so a rejected or failed analysis leaves
  nothing behind (#88). Client RLS on the bucket is **select-only** (for signed URLs); purge is
  server-side and deletes by the `{user_id}/{analysis_id}/` prefix, never by the row's
  `media_paths` list. This is the settled contract `lib/frames.ts` (#34) and `analyze-form`
  (#44) are built against, and as of 2026-07-12 it is **live**: the migration
  (`supabase/migrations/20260712123606_frame_upload_ordering.sql`) was applied to the production
  project via `supabase db push` and verified — `storage.objects` carries zero INSERT and zero
  DELETE policies, only the owner-scoped SELECT.
- **The `storage.objects` grant-all is PERMANENT and cannot be fixed by a migration. Stop trying.**
  Re-verified live 2026-07-13 (issue #100). `20260713153000_grant_hardening.sql` and
  `20260713160000_media_guard_execute_revoke.sql` are both **applied to production** — an earlier
  version of this file said they were unpushed, which was wrong and sent several agents chasing a
  phantom. What is true: the revoke on `storage.objects` **applied cleanly and did nothing**.
  Postgres only lets the *grantor* revoke, `storage.objects` is owned and granted by
  `supabase_storage_admin`, and every migration runs as `postgres` — which holds neither
  membership nor usage of that role. So `REVOKE` silently no-ops instead of erroring. `anon` and
  `authenticated` still hold full `GRANT ALL` there, **including TRUNCATE**, which no RLS policy
  can filter. It is not reachable (the `storage` schema is not PostgREST-exposed and neither role
  gets a direct Postgres connection), and the **control of record is the `pace_media_object_guard`
  BEFORE INSERT trigger**, which even `service_role` cannot bypass. `public.analyses` is a
  different case — owned by `postgres`, genuinely hardened (`authenticated` = SELECT only, `anon` =
  nothing). **Verify any privilege claim live (`has_table_privilege`), never with a text-level test
  over migration contents** — a text test passes while the privilege is fully intact. See
  `docs/status.md` Known Issue #18 (issue #100).

## Git etiquette

Solo repo — commit directly to `main` by default. Branch (`feat/<slug>` or `fix/<slug>`) and
open a PR via the `github-ops` subagent when a change is multi-file, touches
auth/payments/RLS/edge functions, or is something worth a review pass. Never commit without a
clean `typecheck && lint && test`. Never force-push without explicit user approval.

## Code conventions

- TypeScript strict everywhere (already on in `tsconfig.json`).
- Theme tokens only — no hardcoded colors or spacing in components; use `constants/theme.ts`.
- **Two token contracts constrain where text may go, and both are proven (not asserted) in
  `constants/__tests__/theme-contrast.test.ts`. Read them at their tokens before styling a screen:**
  - `Gradient.page` — the full-bleed page backdrop every screen sits on, via
    `<ScreenGradient>`. It carries **`text.primary` only**. Secondary text, score text, score fills,
    coaching prose and `Semantic.error` belong on an opaque `surface.*` (usually a `<SurfaceCard>`).
  - `Glass` — translucent panels, drawn by `<GlassFrost>` (a real `expo-blur` layer under the
    token). **Two tones, two contracts**, and reading the wrong one is how text goes invisible:
    the **white-tinted** tones (`fill`/`raised`/`control`) carry **`text.primary` only**; the
    **canvas-tinted** `chrome` tone is the single one proven for **both** text roles, which is why
    the floating tab bar uses it. Glass **may** be an interactive control's fill — but only with a
    `control.border` ring, because no alpha that still reads as glass can meet WCAG 1.4.11's 3:1
    itself (the ring pays it, on both of its sides). `<PillButton>`, `<CircleIconButton>` and
    `<SurfaceCard>`/`<GlassCard>` already encode all of this — prefer them over hand-rolling a
    `Pressable`. The captain widened this contract on 2026-08-02; `constants/theme.ts`'s `Glass`
    block names what it cost.
- **Two token files ship side by side; every screen with a V23 page is on `constants/v23-theme.ts`
  (2026-09-14).** That file is the V23-01 theme sheet — dark only, flat `Ink`/`Font`/`Type`/
  `Space`/`Layout`/`Motion`/`Chrome` exports, square corners, no wash, no glass, no score bands —
  and it is what the entry flow (`app/(auth)/welcome`, `details`, `sign-in`), `app/analyzing.tsx`
  and, since lane 2, Home, Result, History, Capture, Paywall and Settings are built on. Its
  primitives are `<SquareButton>`, `<TextField>`, `<SquareCard>`, `<SquareIconButton>`, `<TopBar>`,
  `<ConfirmDialog>` (every confirm/notice on those screens — never a native `Alert`), the traced
  glyphs in `components/ui/v23-icons.tsx` and `<V23TabBar>` (floating over Home, inline at the end
  of History). `constants/theme.ts` remains only for the screens no page covers yet
  (`app/capture/extracting.tsx`, `app/compare.tsx`, the password-reset screens, the offline
  banner, the Turnstile widget) and for `ScoreBandLabel`, which is copy. The sheet's contrast
  contract is proven in `constants/__tests__/v23-theme-contrast.test.ts` — read it before putting
  text on `ink3`, which is deliberately under AA and is for placeholders, disabled controls and
  the one secondary line a page draws in it. See `docs/architecture.md`'s "Current — V23 entry
  flow" and "Current — V23 lane 2" sections. A page needing a token the sheet lacks gets it added
  there, never a hardcoded value.
- **In-app copy is professional and restrained** (captain's user-audit, 2026-09-12): short
  sentences, no contractions, no exclamation marks, no emoji, no jokes; technical terms used
  precisely. Every string lives in `constants/copy.ts` (never inline in JSX) and
  `constants/__tests__/copy-tone.test.ts` walks the whole tree and fails on any drift — the only
  exemptions are the consent/legal strings it names, whose wording is frozen by meaning.
- No business rules in the client. Tier, quota, frame cap, and analysis are server-only (edge
  functions); the client may display tier/quota state but is never the authority for it.
- AI output validation is structural, not strict-content: validate shape, retry once, then
  fall back to a safe partial result flagged as such. Over-tight content validation is a known
  Echo V1 mistake.
- Shared PACE types (the four pillars — Posture, Arm swing, Cadence, Elasticity — and the
  result shape) belong in one place — `supabase/functions/_shared/pace.ts` (moved here from
  `lib/pace.ts` by issue #90, since only that location ships in the `supabase functions deploy`
  bundle) — and are imported by both the app (via the `@shared/*` tsconfig alias) and the edge
  functions.
- **A `lib/` edge-function client NEVER restates the response shape by hand — it imports the type
  from `@shared/*`, and its tests build the success fixture from the server module.** Edge
  functions return **camelCase**. Restating a body as snake_case is how sign-up broke in
  production for three days while the suite stayed green: `lib/signup-with-captcha.ts` declared
  `{ access_token, refresh_token }`, the server had only ever sent `{ accessToken, refreshToken }`,
  and the test hand-wrote the same wrong fixture the client read — so fixture and client agreed
  with each other and neither agreed with the server (`docs/status.md` Known Issue #39).
  `lib/quota.ts` and `lib/signup-with-captcha.ts` are the two patterns to copy. A type-only import
  is erased at runtime and cannot prove what the DEPLOYED function sent, so parse defensively too
  and fail with a named code rather than passing `undefined` down into supabase-js.

## Testing

`jest-expo` is installed via `jest.config.js` (`passWithNoTests: true` is a leftover from when the
repo had no tests; it now has a large suite — run `npm test` for the current count, app + edge).
New logic added to `lib/` gets a test alongside it — that rule is load-bearing, not aspirational.

Two RNTL conventions this repo's setup requires, neither of which is the library's documented
default — copy an existing test rather than writing one from memory:

- **`await render(...)`, always.** A bare `render()` leaves `screen` unpopulated and every query
  fails with "`render` function has not been called", which reads like a missing component, not a
  missing `await`. Every test file here already does this.
- **A node carrying `accessibilityElementsHidden` needs `{ includeHiddenElements: true }`** to be
  found by `getByTestId`. Decorative nodes are correctly hidden from the a11y tree, and RNTL
  excludes hidden elements from queries by default — so the testID that "doesn't exist" usually
  does.
- **Two bare `fireEvent.press` calls in one test poison the NEXT test.** The second press leaves
  an act scope open, and the following test's `await render(...)` produces an empty tree ("Unable
  to find an element with testID"), which reads like a missing component and is not one. Wrap
  every press as `await act(async () => { fireEvent.press(node); })`.
- **Reanimated animations do not advance under Jest here.** A `withTiming`/`withSpring` shared
  value stays at its start value no matter how far you wind fake timers, and installing fake
  timers *before* `await render(...)` makes the render produce an empty tree instead. So a motion
  test asserts the FIRST FRAME and the structural invariants — which node tree a mode mounts, that
  a fill's `width` never moves so only its transform can — never that an animation finished.
  `components/__tests__/pace-readout-reveal.test.tsx` is the pattern to copy.

**Migration SQL can be tested for real, in the commit gate.** This used to be untrue, and the
old workaround — a regex over the `.sql` file — is why CLAUDE.md warns that "a text test passes
while the privilege is fully intact". `supabase/functions/_shared/__tests__/ai-guard-sql.deno.test.ts`
applies committed migration files verbatim to PGlite (Postgres 17 as WASM, in-process, no Docker)
and asserts what Postgres actually does; it runs inside `npm run test:edge` under the existing
permission flags. Copy that file's harness for any new claim about what a function or a grant
DOES. Text-level migration tests are still right for the complementary claim — what a diff does
NOT do (see `supabase/migrations/__tests__/per_user_ai_daily_cap.test.ts`). Genuine concurrency
still needs `_shared/integration/*.local.ts` and a running local stack; PGlite is single-connection.

**Screens ARE unit-tested when the bug class needs it** (this line used to say they were not, which
went stale). Two precedents, both regression locks for bugs that shipped:
`app/capture/__tests__/extracting.test.tsx` (issue #147's render loop, and the frame-cap bug — a
screen-level test is the only thing that can prove which arguments a screen actually passes
downstream) and `components/__tests__/`. Prefer a pure function in `lib/` with its own test where
the logic can be hoisted out; reach for a React Native Testing Library render when the defect lives
in the wiring itself rather than in a mapping.

## Keep these docs updated

- [`docs/change_log.md`](docs/change_log.md) — append a dated entry on every behavior-changing
  commit.
- [`docs/status.md`](docs/status.md) — update when a milestone's status moves.
- [`docs/architecture.md`](docs/architecture.md) — update after a feature lands (move it from
  "planned" to "current").
- [`docs/blocked-on-apple.md`](docs/blocked-on-apple.md) — everything gated on the Apple Developer
  Program. **No open GitHub issue may depend on that account**; if a task turns out to need it,
  move it here instead of filing it. Re-file from this file once the account exists.
