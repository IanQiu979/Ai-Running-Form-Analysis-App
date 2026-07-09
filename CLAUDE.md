@AGENTS.md

## What this is

V2.3 — Photo/Video Running Analysis (working title; final name is OPEN, see
`docs/status.md` #1). An Expo/React Native app, part of the PACE family: submit a photo or
video of your running form and get certified, actionable feedback — it does one thing, no
training plans, no logging, no chat. Full spec: [`planning/README.md`](planning/README.md)
and the linked brainstorm / product / engineering docs it indexes.

## Architecture at a glance

Client: Expo SDK 54, expo-router, TypeScript strict. Backend: Supabase (Postgres + Auth +
Storage + Edge Functions). AI: Claude (`claude-sonnet-5`), called only from the `analyze-form`
edge function, never from the client. Today only the Expo scaffold exists — no `lib/`, no
`knowledge/` files, no auth screens, no DB tables, no edge functions, no migrations. Route
tree, `lib/` layout, the `analyze-form` flow, the API table, and the draft DB schema all live
in [`docs/architecture.md`](docs/architecture.md).

## Commands

| Command | Does |
|---|---|
| `npm start` | `expo start` |
| `npm run ios` / `npm run android` / `npm run web` | `expo start --ios` / `--android` / `--web` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `expo lint` |
| `npm test` | `jest` |

Run `npm run typecheck && npm run lint && npm test` clean before every commit.

## Secrets & env — read this before touching any env file

- `.env` (gitignored) should hold ONLY `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — nothing Google-related belongs there, ever; the
  browser OAuth flow never reads a client-ID var. The live file currently drifts from this
  rule (a malformed key line, dead Google placeholders) — see `docs/status.md` #3 for the
  fix. `.env.example` is the committed template — copy it, never edit it in place.
- Anything prefixed `EXPO_PUBLIC_` is inlined in **plain text** into the compiled app bundle.
  Treat it as public. Always read it with static dot notation (`process.env.EXPO_PUBLIC_X`) —
  the `expo/no-dynamic-env-var` lint rule enforces this; destructuring or bracket access
  silently yields `undefined`.
- `ANTHROPIC_API_KEY` must NEVER get an `EXPO_PUBLIC_` prefix and must NEVER go in `.env`. It
  belongs in `supabase/functions/.env` (gitignored, local dev) and is pushed to production with
  `supabase secrets set` — not done yet, see `docs/status.md`.
- Supabase auto-injects `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`
  into edge functions at runtime. Never set these by hand.
- Google's OAuth client secret and Apple's sign-in credentials live only in the Supabase
  Dashboard, never in a repo file.
- **Uploaded media is sensitive** (photos and video of people's bodies). It lives in a
  **private Storage bucket with owner-scoped RLS**, is **kept by default** so it can appear in
  Past Analyses, and is **purged** when the user deletes an analysis or deletes their account.
  No public URLs; access via signed URLs or authenticated reads.

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
  result shape) belong in one place (planned: `lib/pace.ts`) and are imported by both the app
  and the edge functions.

## Testing

`jest-expo` is installed via `jest.config.js`, with `passWithNoTests: true` since the repo has
no test files yet. New logic added to `lib/` (once it exists) should get a test alongside it.
Screens are not unit-tested for now.

## Keep these docs updated

- [`docs/change_log.md`](docs/change_log.md) — append a dated entry on every behavior-changing
  commit.
- [`docs/status.md`](docs/status.md) — update when a milestone's status moves.
- [`docs/architecture.md`](docs/architecture.md) — update after a feature lands (move it from
  "planned" to "current").
