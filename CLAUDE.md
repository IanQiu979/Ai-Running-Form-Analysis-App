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

Client: Expo SDK 54, expo-router, TypeScript strict. Backend: Supabase (Postgres + Auth +
Storage + Edge Functions). AI: Claude (`claude-sonnet-5`), called only from the `analyze-form`
edge function, never from the client. The app, its migrations, and all six edge functions exist and
are live on the Supabase project — the sign-up → analysis → result path ran end to end against it
on 2026-07-26 (issue #128). Route tree, `lib/` layout, the `analyze-form` flow, the API table
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

`expo-dev-client` is a dependency, so plain `expo start` defaults to a development build and its
QR code is an `exp+…://expo-development-client/` deep link that **Expo Go cannot open**. Use
`npm run start:go` (or press `s` in the running dev server) to get an Expo Go `exp://` URL.
Expo Go on the **iOS App Store is pinned to SDK 54**, which matches this project; Expo Go on the
**Play Store tracks the newest SDK and will reject this project** — Android needs a dev build.

## Secrets & env — read this before touching any env file

- `.env` (gitignored) holds ONLY `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — nothing Google-related belongs there, ever; the
  browser OAuth flow never reads a client-ID var. `.env.example` is the committed template —
  copy it, never edit it in place.
- Anything prefixed `EXPO_PUBLIC_` is inlined in **plain text** into the compiled app bundle.
  Treat it as public. Always read it with static dot notation (`process.env.EXPO_PUBLIC_X`) —
  the `expo/no-dynamic-env-var` lint rule enforces this; destructuring or bracket access
  silently yields `undefined`.
- `ANTHROPIC_API_KEY` must NEVER get an `EXPO_PUBLIC_` prefix and must NEVER go in `.env`. It
  belongs in `supabase/functions/.env` (gitignored, local dev) and is pushed to production with
  `supabase secrets set` — done 2026-07-26, alongside the first `analyze-form` deploy.
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
