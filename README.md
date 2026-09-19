# Pace Analysis AI

Pace Analysis AI is an Expo / React Native app for photo- and video-based running-form analysis.
A runner submits a side-on photo or muted video, the app extracts frames on-device, and a Supabase
Edge Function returns structured feedback across the PACE pillars: Posture, Arm swing, Cadence,
and Elasticity. It is an analysis tool only — not a training-plan builder, run log, or chat app.

## Current status

The repository contains the M1–M7 app flow: email/Google authentication, photo-library and camera
capture, analysis, result display, Past Analyses, per-analysis deletion, account settings and
account deletion, tier/quota UI, and the Elite comparison screen. The backend is Supabase
(Postgres, Auth, private Storage, and seven Edge Functions); deployment history and remaining
release work are tracked in [`docs/status.md`](docs/status.md).

Important current limitations:

- Free accounts get one real, model-backed analysis (capped at a single lifetime delivered
  result); Pro/Elite get additional analyses per period. All three tiers run the same
  `analyze-form` flow — Tier, quota, and frame-cap decisions are server-owned.
- The paywall does not process a real in-app purchase yet.
- TestFlight and Apple-dependent work are tracked in
  [`docs/blocked-on-apple.md`](docs/blocked-on-apple.md).
- The privacy policy is published at
  <https://ianqiu979.github.io/Ai-Running-Form-Analysis-App/privacy-policy/> (source:
  `docs/privacy-policy.md`) and opens from the Settings screen's "Full privacy policy" row.

## Stack

- Expo SDK 57, React Native, expo-router, TypeScript strict
- Supabase Auth, Postgres, private Storage, and Deno Edge Functions
- Claude (`claude-sonnet-5`) called server-side by `analyze-form`
- Jest / React Native Testing Library for the app and Deno tests for Edge Functions

## Setup

Requirements: Node.js, npm, Deno on `PATH`, and access to the configured EAS project if you are
pulling its development environment.

```bash
npm install
npx eas-cli@latest env:pull --environment development --path .env
```

The EAS command populates the gitignored `.env` with the public client configuration:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_TURNSTILE_SITE_KEY`
- optional `EXPO_PUBLIC_TURNSTILE_HOSTNAME`

Keep `--path .env`: EAS otherwise writes `.env.local`, which takes precedence over `.env` in
Expo's loader. If you do not have EAS access, copy [`.env.example`](.env.example) to `.env` and
supply valid public values yourself. Never put `ANTHROPIC_API_KEY`, the Turnstile secret, or a
Supabase secret/service-role key in the app environment; server secrets belong in Supabase Edge
Function secrets or the gitignored local Edge Function environment described in
[`CLAUDE.md`](CLAUDE.md).

## Run the app

This project includes `expo-dev-client`, so the default command serves a development-build URL:

```bash
npm start
```

Use the explicit Expo Go command when testing with Expo Go:

```bash
npm run start:go
```

Expo Go on the iOS App Store supports this project's SDK 57 build. The Android Play Store version
of Expo Go tracks the newest SDK and may reject SDK 57 once a newer one ships, so use a
development build on Android.
Other targets are available through `npm run ios`, `npm run android`, and `npm run web`.

## Validation

Run the full repository gate before committing:

```bash
npm run typecheck
npm run lint
npm test
```

`typecheck` generates typed Expo routes, checks the app with TypeScript, and checks
`supabase/functions/` with Deno. `test` runs both the Jest app suite and the Deno Edge Function
suite. After editing `knowledge/*.md`, run `npm run generate:knowledge` and commit the regenerated
`supabase/functions/_shared/knowledge.generated.ts`; the normal test gate verifies that bundle has
not drifted.

## Project layout

```text
app/                    expo-router screens and route layouts
components/             shared UI and capture/result components
constants/              copy and design tokens
lib/                    client services and pure app logic
knowledge/              certified PACE source material used by the prompt
supabase/migrations/    Postgres schema, RLS, quota, deletion, and guardrail migrations
supabase/functions/     Deno Edge Functions and their shared contracts/tests
docs/                   architecture, status, privacy, design, and release records
planning/               product and engineering specifications
assets/source/          versioned SVG sources for generated app assets
```

The app sends extracted frames rather than the original full-resolution video. Stored frames live
in a private, owner-scoped bucket and are purged through the server-side per-analysis or account
deletion flows. See [`docs/architecture.md`](docs/architecture.md) for the detailed data flow and
security boundaries.

## App assets

Icons and splash artwork are generated from the SVG sources in `assets/source/`:

```bash
npm run assets
```

Edit the SVG sources, not the generated PNG files in `assets/images/`.

## Documentation

- [`docs/status.md`](docs/status.md) — current milestone and known-issue record
- [`docs/architecture.md`](docs/architecture.md) — system design and deployed flow
- [`docs/change_log.md`](docs/change_log.md) — dated implementation history
- [`planning/README.md`](planning/README.md) — product and engineering specifications
- [`CLAUDE.md`](CLAUDE.md) — project commands, security rules, and contributor guardrails
