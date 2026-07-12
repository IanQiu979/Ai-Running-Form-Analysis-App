# Architecture

System design for V2.3 — Photo/Video Running Analysis. Current state and planned state are
kept in clearly separate sections below; nothing in a "planned" section is built yet. See also
[`CLAUDE.md`](../CLAUDE.md), [`docs/status.md`](status.md), and the source spec,
[`planning/03-engineering-requirements.md`](../planning/03-engineering-requirements.md).

**No `src/` in this project** — unlike V2.2, code lives directly at the repo root. The
`@/*` path alias maps to `./*` (see `tsconfig.json`), not `./src/*`.

## Current — what exists in the repo

M1 (the spine) is **done** — built and reviewed on `feat/m1-spine`, gate passed 2026-07-11 with
Ian's on-phone test (sign-up → account → empty Home), merged to `main` via PR — real, applied
code and a live DB, not a plan.

```
app/
  _layout.tsx            # root layout: SessionProvider + font loading + splash gate, then
                          # Stack.Protected routes to (tabs) or (auth) on `session`
  (auth)/_layout.tsx      # unprotected stack, one screen
  (auth)/sign-in.tsx      # combined sign-in/sign-up per design-brief screen 1 (email + Google;
                          # no Apple yet, gate #7)
  (tabs)/_layout.tsx      # protected stack; single Home tab for M1 (template Explore removed)
  (tabs)/index.tsx        # M1 empty Home per screen 2 — RLS-scoped, display-only quota caption,
                          # disabled Analyze stub, temporary sign-out
components/              # only the two live components remain (haptic-tab, ui/icon-symbol), both
                          # used by (tabs)/_layout.tsx. The unreferenced create-expo-app template
                          # UI (external-link, hello-wave, parallax-scroll-view, themed-text,
                          # themed-view, ui/collapsible) and hooks/use-theme-color.ts were deleted
                          # 2026-07-12 (#33) — themed-text carried the last hardcoded color in the
                          # repo. New components are built against constants/theme.ts tokens.
constants/theme.ts        # design brief §2 tokens (done 2026-07-11): light+dark, score-band
                          # palette, spacing/radii/type scales; M1 added
                          # ControlHeight/ControlWidth/HitTarget/Opacity; issue #24 (2026-07-12)
                          # added Feedback (error/onError) — auth/system error color, a hue
                          # deliberately distinct from Score.low's clay
constants/copy.ts         # strings lifted verbatim from docs/design/copy-deck.md — sign-in and
                          # Home's copy live here first (M1); more screens' copy lands with them
constants/validation.ts   # client-side mirrors of server-enforced rules, not the authority —
                          # currently just PASSWORD_MIN_LENGTH, mirroring supabase/config.toml's
                          # minimum_password_length so sign-in.tsx's pre-check and copy.ts's
                          # password-rule strings derive from one number (issue #9)
constants/contrast.ts     # contrast-ratio helper backing the AA proof below
constants/__tests__/theme-contrast.test.ts  # 69-assertion Jest proof every text/surface and
                          # band pair clears WCAG AA (9 brief-§2 intent values were darkened/
                          # lightened minimally to pass — each old → new value is a comment in
                          # theme.ts next to the token it changed)
hooks/                    # use-color-scheme, use-theme-color
lib/
  supabase.ts             # the Supabase client — see "Current — auth flow" below
  auth.ts
  session-provider.tsx
  crypto-polyfill.ts
  hibp.ts                 # client-side leaked-password check (issue #70) — see "Current —
                          # Supabase config" below
supabase/
  config.toml              # local mirror of live auth config — see "Current — Supabase config"
  functions/.env.example   # committed placeholder; the real ANTHROPIC_API_KEY is in the
                          # gitignored functions/.env locally and in production secrets
  migrations/               # 7 migrations, applied live — see "Current — DB schema" below
```

The template's `(tabs)/explore.tsx` and `modal.tsx` are deleted, not left as dead scaffolding.
Still absent: `supabase/functions/analyze-form` (or any edge function), `lib/frames.ts`,
`lib/pace.ts`, `lib/subscription.ts`, and every route beyond sign-in + empty Home (capture,
result, paywall, settings, history).

## Route tree — current (M1) vs planned

```
app/
  (auth)/sign-in         # current — sign-up folds into the same screen, no separate route
  (tabs)/index           # current — Home / Analyze (pick source is still a disabled stub)
  (tabs)/history         # planned — past analyses (M6)
  capture/                # planned — record or pick, framing guide (stack) (M2)
  result/[id]             # planned — analysis result view (M4/M6)
  paywall, settings       # planned (M5)
```

## `lib/` layout — current (M1) vs planned

```
lib/
  supabase.ts             # current — the Supabase client; see "Current — auth flow" below
  auth.ts                 # current — browser OAuth (Google), PKCE code exchange
  session-provider.tsx    # current — session state + Stack.Protected guard source of truth
  crypto-polyfill.ts      # current — WebCrypto shim; see "Current — auth flow" below
  hibp.ts                 # current (issue #70) — client-side HaveIBeenPwned leaked-password
                          # check via HIBP's keyless range API (only a 5-char hash prefix ever
                          # leaves the device); runs in sign-in.tsx's sign-up branch only, before
                          # signUp. Mitigates, not a replacement for, the still-Pro-gated
                          # server-side setting — see "Current — Supabase config" below.
  frames.ts               # planned (M2) — extract, downscale, and upload N frames from a video
                          # (client-side) direct-to-bucket, for motion analysis
  pace.ts                 # planned (M4) — PACE pillar types + result parser, imported by app +
                          # edge functions
  subscription.ts         # planned (M5) — tier read + dummy purchase (adapted from Echo V1 /
                          # V2.2) — cosmetic only; tier/quota are never authoritative on the
                          # client (the live reserve_analysis RPC is already the sole
                          # enforcement point — see "Current — DB schema" below)
```

## Current — auth flow (M1)

- **PKCE browser OAuth (Google).** `signInWithOAuth({ skipBrowserRedirect: true })` gets the
  provider URL, then `WebBrowser.openAuthSessionAsync` (with `preferEphemeralSession: true`, so
  a stale silent Google session can't complete against an already-consumed PKCE verifier)
  intercepts the redirect at the browser layer and resolves with the final URL directly — no app
  route has to exist at the redirect path. `lib/auth.ts`'s `createSessionFromUrl` then exchanges
  the `code` param for a session via `supabase.auth.exchangeCodeForSession`. Redirect URI:
  `paceanalysisai://oauth-callback` (matches `app.json`'s `scheme`).
- **`lib/session-provider.tsx`'s `Linking` listener is a defensive second path**, not the
  primary one — if the browser sheet gets dismissed before `openAuthSessionAsync`'s promise
  resolves (e.g. the app was backgrounded mid-flow), the OS may still deliver the redirect as a
  plain deep link; a module-level `Set` of already-exchanged codes stops the two listeners from
  racing to redeem the same code twice (a real Android double-delivery case, fixed in the M1
  code-review pass).
- **`lib/crypto-polyfill.ts` exists because Hermes has no WebCrypto.** Without it,
  `@supabase/auth-js`'s PKCE helper silently falls back from `S256` to the weaker `plain`
  challenge method (a `console.warn`, never a thrown error) — this was Echo V1's real root cause
  for "invalid flow state, no valid flow state found" failures. The shim backs
  `crypto.getRandomValues` and `crypto.subtle.digest('SHA-256', ...)` with `expo-crypto` and
  must be imported before `@supabase/supabase-js` ever touches `crypto` (`lib/supabase.ts`
  imports it first, before creating the client).
- **`Stack.Protected` guards, not manual redirects.** `app/_layout.tsx` wraps two
  `Stack.Protected` groups — `guard={!!session}` for `(tabs)`, `guard={!session}` for `(auth)` —
  so a signed-out user's navigator has no `(tabs)` route to go to at all (and vice versa).
  `onAuthStateChange` flipping `session` in `SessionProvider` is what moves the user between
  them; no screen calls `router.replace()` after sign-in or sign-out.
- Session storage is **AsyncStorage today, plaintext** — tracked as a known issue to move to a
  SecureStore-backed adapter at M2 (`docs/status.md` Known Issue #13).

## Current — `knowledge/` (done 2026-07-10)

The certified files exist already — 4 Echo source files map to **3** targets, not a 1:1 copy:

```
knowledge/
  pace_framework.md      # from Echo V1's ECHO_Framework_CORRECTED.md, rewritten around PACE;
                          # Elasticity authored fresh from peer-reviewed sources (citations in
                          # the file), pending Ian's certification
  injury_flags.md         # carried over for injury-risk flagging
  drills.md               # the certified drills/cues, extracted from
                          # ECHO_Framework_CORRECTED.md itself (five cadence drills ~lines
                          # 153–229; posture/arm-swing cues ~453–478) — training_zones.md and
                          # workout_library.md contain zero drills and were never a valid source
```

These files are meant to be bundled into the `analyze-form` edge function and injected as
system context, so every analysis is grounded in certified biomechanics rather than the model's
general knowledge. Echo V1 stays frozen — copy from it, never into it.

## Current — design layer (Phase 0.5, done 2026-07-11)

- [`docs/design/frontend-design-brief.md`](design/frontend-design-brief.md) — the single
  basic-MVP design brief: the "Gait Plate" visual direction (distinct-but-related to V2.2), the
  0–100 + band score display, all 11 screens with their states, motion, and the a11y floor.
- [`docs/design/copy-deck.md`](design/copy-deck.md) — every string the brief's screens/states
  need: permission rationales, the consent line, error/empty/offline states, framing guidance,
  quota captions (Free is always "1 lifetime," never "this month"), paywall copy, the disclaimer
  + stop-running language, and tier labels.
- [`docs/design/motion-consult.md`](design/motion-consult.md) — the motion-feasibility
  addendum to brief §6; binding for `frontend-builder` alongside it (confirms every motion is
  implementable on the already-installed Reanimated/gesture-handler stack, no new deps).
- [`docs/privacy-checklist-m7.md`](privacy-checklist-m7.md) — the ranked privacy/
  compliance checklist gating M7 (App Store privacy labels, consent upgrade, data inventory,
  retention limits), plus two conflicts surfaced for Ian (see `docs/status.md`).
- `constants/theme.ts` + `constants/contrast.ts` — the brief's §2 tokens as light+dark theme
  values, spacing/radii/type scales, and the score-band palette, with a 69-assertion Jest test
  (`constants/__tests__/theme-contrast.test.ts`) proving every text/surface and band pair clears
  WCAG AA. Font families (`@expo-google-fonts/archivo`, `inter`, `ibm-plex-mono`) installed via
  `npx expo install`; `expo-font` added to `app.json`'s plugins.

UI work builds from these rather than re-deriving the direction. Still open from Phase 0.5:
Ian's certification review of the drafted Elasticity content (`knowledge/pace_framework.md`).

## Current — app icon & splash assets (done 2026-07-12, closes GitHub issue #26)

Real app icon + splash art, replacing the Expo template defaults. Design is "The Gait Plate"
per `docs/design/frontend-design-brief.md` §1: a ground rule, a posture line leaning off it, a
short detached arc marking the lean angle (drawn like a goniometer/biomechanics annotation), and
a filled landing marker at the vertex — the one point of color, `score.strong` (`#2E7D5B`),
deliberately **not** `accent` (`#2F6BEB`), which the brief reserves for the primary CTA alone.

```
assets/
  source/
    mark-light.svg      # the icon / light-mode splash mark, field + mark layers
    mark-dark.svg        # dark-mode splash mark (mark only, drawn for the graphite field)
    mark-mono.svg         # Android adaptive-icon monochrome layer (alpha only, no color)
    mark-favicon.svg       # web favicon, keeps its own bone field
  images/                   # BUILD OUTPUT — generated by `npm run assets`, never hand-edited
    icon.png, android-icon-foreground.png, android-icon-monochrome.png, splash-icon.png,
    splash-icon-dark.png, favicon.png
scripts/
  generate-app-assets.js   # rasterizes assets/source/*.svg -> assets/images/*.png via `sharp`
```

- The SVGs in `assets/source/` are the source of truth. `npm run assets`
  (`scripts/generate-app-assets.js`, `sharp` devDependency) rasterizes them into the six PNGs
  `app.json` points at. Edit a source SVG and re-run `npm run assets`; the PNGs in
  `assets/images/` are regenerated, not hand-edited.
- `icon.png` is deliberately flattened onto the bone field (`#F4F1EA`) with **no alpha
  channel**: iOS applies its own corner mask, and App Store Connect rejects an icon that carries
  transparency. The generator script hard-fails if alpha ever reappears on that file.
- A dedicated dark-mode splash mark (`splash-icon-dark.png`, wired via `app.json`'s
  `expo-splash-screen` plugin `dark.image` key) exists because the mark is dark ink drawn for a
  light field — on the dark graphite background it would be near-invisible. This matters because
  `app/_layout.tsx` deliberately **holds** the splash screen (`SplashScreen.preventAutoHideAsync`
  in `_layout.tsx`, hidden only once fonts and the initial session check both resolve), so it is
  on screen for a real, visible duration rather than a flash.
- `assets/images/android-icon-background.png` is deleted — the Android adaptive icon's
  background is now a flat theme-token color (`app.json`'s `android.adaptiveIcon.backgroundColor`),
  so the PNG that used to hold a solid field was dead weight.
- Closes GitHub issue #26: splash `backgroundColor` `#ffffff` → `#F4F1EA`, dark `#000000` →
  `#1A1712`; Android `adaptiveIcon.backgroundColor` `#E6F4FE` (Expo template pale blue) →
  `#F4F1EA`. All three are `constants/theme.ts` tokens now, not template defaults.

## Current — EAS build & release config (groundwork only; the pipeline half is Apple-blocked)

`eas init` created the EAS project `@ianbeatingpros/pace-analysis-ai`
(`d19968ff-22b8-4851-8e74-087aeb9846b0`, in `app.json`'s `extra.eas.projectId`). `app.json` also
carries a top-level `owner: "ianbeatingpros"` — deliberate, not a default: without it EAS
resolves the project by slug against whoever is currently logged in, which silently breaks the
same `eas build` command on another machine or in CI.

`eas.json` (new, committed) has four build profiles. The file is parsed with a strict Joi schema
via plain `JSON.parse` and cannot hold comments, so the reasoning behind each profile lives here
and in `docs/change_log.md` (2026-07-12), not in the file itself:

| Profile | Distribution | iOS | Android | Notes |
|---|---|---|---|---|
| `development` | internal, dev client | `simulator: true` | APK | The only iOS build possible today — there's no Apple Developer account, so a real-device build has nowhere to get a provisioning profile from. |
| `development-device` | extends `development` | `simulator: false` | — | Written but unusable: blocked on the Apple Developer account (needs an ad-hoc provisioning profile). |
| `preview` | internal | — | APK | |
| `production` | — | — | app-bundle, `autoIncrement` | |
| `submit.production` | — | — | — | Empty placeholder; the App Store Connect app ID and Apple team ID land once Apple exists. |

EAS project-scoped server env vars exist for `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in all three environments (development/preview/
production), at visibility **`sensitive`, deliberately not `secret`**: `EXPO_PUBLIC_*` is
inlined in plain text into the compiled bundle regardless of how EAS stores it, so the key's
real protection is Supabase RLS, not secrecy — `secret` visibility is write-only (unreadable via
the dashboard, `env:list`, *and* `env:pull`), which would buy no security while blocking
`eas env:pull` onto a new machine. `ANTHROPIC_API_KEY` is confirmed absent from all three EAS
environments and must stay that way (it belongs only in `supabase secrets`, per `CLAUDE.md` §
Secrets & env). A build missing these vars does not degrade — `lib/supabase.ts` throws at module
import, so the app hard-crashes on the splash screen.

**Still blocked**: there is no Apple Developer account, so there are no iOS credentials, no
`eas build` for a device or the store, no `eas submit`, and no TestFlight pipeline. Sign in with
Apple (`docs/status.md` Known Issue #3) is the same dependency. Both are tracked in
[`docs/blocked-on-apple.md`](blocked-on-apple.md), not as GitHub issues — the tracker deliberately
holds only work that is actionable without the Apple account.

Removing `exp://**` from the Supabase redirect allowlist (issue #69, see "Current — Supabase
config" below) is a required pre-first-dev-build cleanup, not yet done. It is **not** Apple-blocked:
the `development` profile's `ios.simulator: true` build needs no Apple account and is enough to
retire Expo Go. See `docs/status.md` Known Issue #7.

## Planned — `analyze-form` edge function flow

The core of the app. Frames only — the client never sends, and the function never receives,
the original video (see "Media pipeline" below).

1. **Auth** — verify the JWT, reject anon.
2. **Idempotency** — an existing `(user_id, idempotency_key)` row is returned as-is instead of
   re-running the analysis.
3. **Atomic reserve** — a `SECURITY DEFINER` RPC checks the tier's limit (Free 1 lifetime / Pro
   10 / Elite 30 per purchase-anchored period) and frame-count cap, then reserves the analysis
   atomically, before the model is ever called. Over quota → structured `402`.
4. **Inputs** — photo: one frame. Video: client-extracted, downscaled frames with their actual
   sampled timestamps (Android snaps to keyframes, so the actual timestamps are recorded rather
   than assumed to be evenly spaced); those same frames were already uploaded direct-to-bucket,
   and their storage paths ride in the request alongside the base64 frame data. Frame count per
   tier: Free 1 / Pro 5 / Elite 8.
5. **Build the grounded prompt**: system message = the certified PACE knowledge (framework +
   injury flags + drills, bundled with the function, not fetched per call), then the image
   block(s) plus their timestamps, then the PACE scoring instruction. Detail scales with tier
   via a verbosity dial on one prompt, not a different call — Free gets scores + one line per
   pillar and no drills; Pro gets fuller feedback, injury-risk flags, and drills; Elite gets the
   same analysis as Pro plus a small verbosity/depth bump (the Pro→Elite gap is intentionally
   tiny).
6. **One vision call** — `claude-sonnet-5`, explicit thinking config, `max_tokens` 4–8k, a
   forced tool call returning structured JSON for the 4 PACE pillars (Posture, Arm swing,
   Cadence, Elasticity), each scored with feedback, plus injury flags and (paid) drills.
7. **Validate structurally, loosely** — check the expected shape exists, never judge content.
   On failure retry once; on a second failure, a clearly-labelled partial result if ≥2 pillars
   parsed (`is_fallback: true`, never a fabricated score for the rest), else a clean failure.
   The reserve is released either way — failures and fallbacks never burn quota — capped at 3
   free retries per period against prompt-injection farming.
8. **Settle** — mark the reservation delivered, persist the result to `analyses`
   (`result` JSONB, `media_paths`, `tier_at_run`, `frame_count`, `is_fallback`), return
   `{ result, analysisId, isFallback }`.

## Planned — media pipeline

Frames only, decided over "upload the media" (self-contradictory as originally specced — the
function was told to upload media it never receives).

- The client extracts and downscales the analyzed frames, then uploads **only those frames**
  direct-to-bucket via supabase-js Storage, under `{user_id}/{analysis_id}/…`, with
  owner-scoped `storage.objects` RLS (insert/select/delete where the path's first segment =
  `auth.uid()`).
- **The original full-resolution video is never uploaded or stored** — it stays on the device.
  This keeps the free-plan 1GB bucket viable (a few hundred KB per analysis instead of
  60–130MB) and needs no video player (`expo-video` is not installed).
- Past Analyses shows the stored frames as a frame strip via short-TTL (~1h, regenerated on
  open) signed URLs.
- Caps: max clip length 15s; max upload 50MB pre-compress; frames downscaled to ≤1568px long
  edge at JPEG q≈0.7 via `expo-image-manipulator`, targeting ~150–350KB/frame; total request
  body ≤5MB, enforced client-side and re-checked server-side.
- **Backgrounding recovery**: the server persists the result and settles quota even if the
  client is suspended before it receives the response — the next launch surfaces "Your analysis
  finished — see Past Analyses," so no one reports a stolen credit. Frame upload uses the
  resumable/TUS path for anything large enough to want progress.

**Elite comparison** (decided, kept minimal): a client-side view of two already-stored
`analyses` rows side by side with per-pillar score deltas. It reads two rows the user already
has via the normal `analyses` RLS read and diffs them in the client — no new AI call, no quota
burn, no extra storage, no new edge function or API route.

## Planned — API

None of these edge functions exist yet (no `supabase/functions/` beyond the `.env.example`
placeholder) — but `analyze-form`'s core dependency, the reserve/settle/release quota RPC
family, is already live; see "Current — DB schema" below and the M1-review contract notes in
`docs/status.md` Known Issue #14 before building it.

The client never talks to Postgres for privileged operations — those go through edge
functions. Plain reads of the caller's own rows go through the Supabase client, protected by
RLS.

| Method / Route | Auth | Body | Returns | Notes |
|---|---|---|---|---|
| `POST /functions/v1/analyze-form` | JWT | `{ mediaType: "photo"\|"video", frames: [base64...], mediaPaths: string[], idempotencyKey }` | `{ result, analysisId, isFallback }` or `402` over-quota / `403` anon | Core call. `mediaPaths` are the direct-to-bucket paths of the same frames being analyzed — nothing large rides the JSON body. Enforces tier + frame cap + atomic quota reserve, injects certified knowledge, validates, persists. Idempotent on `idempotencyKey`. |
| `POST /functions/v1/purchase-tier` | JWT | `{ tier, source: "dummy" }` | `{ tier, periodStart, periodEnd }` | Same contract as V2.2; v2 swaps `source` to receipt verification. |
| `GET /functions/v1/quota-status` | JWT | — | `{ tier, used, limit, periodEnd }` | Drives Home "7 of 10 left" (Pro/Elite, period-based) or "1 of 1 used, lifetime" (Free). Computed from `count(analyses)`, never a client counter. |
| `DELETE /functions/v1/analysis/:id` | JWT | — | `{ deleted: true }` | User-initiated delete: removes the `analyses` row **and** its frame objects atomically, so they can't get out of sync. |
| `POST /functions/v1/delete-account` | JWT | — | `{ deleted: true }` | Ported from Echo V1's `delete-user/`, because `storage.objects` has no FK to `auth.users` and would otherwise orphan every object. Delete order: storage objects → rows → auth user. |

**Error contract**: every non-2xx response body is structured `{ error, code }`.
`supabase.functions.invoke` wraps non-2xx responses in a generic `FunctionsHttpError`, so the
client uses one shared wrapper that parses `{ error, code }` back out of that exception, rather
than re-parsing it at each call site.

Direct Supabase-client reads (RLS-guarded, `user_id = auth.uid()`): list own `analyses`; read
own `subscriptions`; read own frames from the private bucket via short-TTL signed URLs. Inserts
into `analyses` happen only inside `analyze-form`.

## Current — DB schema (LIVE, applied 2026-07-11)

The live Supabase project (`v2.3Analysis`) has **7 migrations applied** (`supabase db push`,
security advisors clean) — this is the as-built schema, not the draft in `planning/03` (which
drifted on a few points, noted inline below; `planning/03` and `planning/02` should be treated
as the design intent, this section as ground truth for what's actually deployed).

```sql
-- public.profiles: one row per auth.users row, auto-created by an AFTER INSERT trigger
-- (handle_new_user, SECURITY DEFINER) on signup for every provider.
profiles       (id uuid pk -> auth.users(id) on delete cascade,
                display_name text, created_at timestamptz)

-- public.subscriptions: at most one row per user; NO row = free. subscription_tier is
-- 'pro' | 'elite' ONLY — 'free' is never a value here (contrast analysis_tier below).
subscriptions  (user_id uuid pk -> profiles(id) on delete cascade,
                tier subscription_tier not null,      -- enum: 'pro' | 'elite'
                purchased_at timestamptz not null,    -- the period anchor; no stored
                                                       -- period_start/period_end, no cron —
                                                       -- periods are derived at read time
                status subscription_status not null,  -- enum: 'active' | 'canceled'
                created_at, updated_at)

-- public.analyses: one row per reserve_analysis() call. media_paths is plural (drift fix vs
-- planning/03's earlier media_path text draft — plural was already correct there too, kept
-- consistent here). No separate frame-count/tier duplication anywhere else to drift.
analyses       (id uuid pk default gen_random_uuid(),
                user_id uuid not null -> profiles(id) on delete cascade,
                media_type media_type not null,          -- enum: 'photo' | 'video'
                media_paths text[] not null default '{}',-- private-bucket paths; NOT a video
                frame_count integer not null check (> 0),
                tier_at_run analysis_tier not null,       -- enum: 'free' | 'pro' | 'elite'
                status analysis_status not null default 'reserved', -- enum: 'reserved' |
                                                                      -- 'delivered' | 'released'
                result jsonb,                              -- 4 PACE pillars + flags + drills
                is_fallback boolean not null default false,
                idempotency_key text not null,             -- UNIQUE (user_id, idempotency_key)
                release_reason text,                        -- e.g. 'validation_failed' — observability only
                created_at, delivered_at, released_at, updated_at)
-- indexes: (user_id, created_at desc) for "list my analyses"; (user_id, status, created_at)
-- for the quota-window counts the RPCs below run.
```

**Quota RPC family — `reserve_analysis` / `settle_analysis` / `release_analysis`, live and the
sole enforcement point.** All three are `SECURITY DEFINER`, `EXECUTE` revoked from
`public`/`anon`/`authenticated` and granted only to `service_role` — so only a future edge
function calling with the service-role key can invoke them, never the client directly.

- **`reserve_analysis(p_user_id, p_idempotency_key, p_media_type, p_frame_count, p_media_paths)`**
  — the sole write path for new `analyses` rows. Serializes concurrent calls for one user via
  `pg_advisory_xact_lock(hashtext(p_user_id || ':analysis_reserve'))` (a bare
  count-then-insert does not close the race on its own — see the migration's own comment for
  why); `UNIQUE (user_id, idempotency_key)` is a second, unconditional backstop against a lock-
  hash collision. An existing row for `(user_id, idempotency_key)` is returned as-is, **whatever
  its status** — a caller MUST branch on the returned `status`, not just `allowed` (a replayed
  request against a since-released reservation returns `allowed: true, existing: true, status:
  "released"`). Tier is derived server-side from `subscriptions` (no row = `free`), never
  trusted from the caller. Enforces, in order: frame-count cap per tier (Free 1 / Pro 5 /
  Elite 8 — photo must be exactly 1 frame), the 3-failed-attempt anti-farming cap (counts
  `'released'` rows in the window — a released reservation never counts toward the quota limit,
  but does count here, since failures/fallbacks don't cost quota and would otherwise be a free
  retry farm), then the quota limit itself (Free 1 **lifetime**, count of all
  `'reserved'`/`'delivered'` rows ever; Pro 10 / Elite 30 **per current period**, via
  `pace_current_period` below — Free does not reuse the period logic, a separate branch).
- **`settle_analysis(p_user_id, p_analysis_id, p_result, p_is_fallback)`** — marks a `'reserved'`
  row `'delivered'` with its result; guarded to only affect a still-`'reserved'` row, so a
  duplicate/late call is a safe no-op rather than overwriting an already-delivered result.
- **`release_analysis(p_user_id, p_analysis_id, p_reason)`** — the compensating release: a
  `'reserved'` row that never gets settled (the vision call errored after its one retry, or the
  response was a clean failure) moves to `'released'` so it stops counting toward quota, while
  the row itself is kept (not hard-deleted) so it still counts toward the 3-failed-attempt cap.
  **Must be called on every M4 failure path** — an unreleased `'reserved'` row silently eats a
  quota slot forever (`docs/status.md` Known Issue #14).
- **`pace_current_period(anchor, as_of)` / `pace_add_months_clamped(base, n)`** — SQL port of
  V2.2's `currentPeriod(anchorDate, now)`: purchase-day-anchored, month-end clamped (Jan 31 →
  Feb 28 → Mar 31, verified), computed inside the same transaction as the reserve, no cron, no
  stored `period_start`/`period_end` columns (a drift fix vs `planning/03`'s draft schema, which
  sketched those columns on `subscriptions` — the live schema derives the period from
  `purchased_at` alone at read/reserve time instead).

**RLS, as deployed** (all policies wrap `auth.uid()` as `(select auth.uid())` — a performance
fix, InitPlan-evaluated once per statement instead of once per row, applied in the 7th
migration; behavior is identical to bare `auth.uid()`): `profiles` and `subscriptions` are
select-own only (no client insert/update/delete — writes are trigger- or future-service-role-
only). `analyses` is select-own **and delete-own** (direct client `DELETE` is allowed by RLS as
a fallback path; the planned `DELETE /functions/v1/analysis/:id` edge function is still
preferred so the row and its Storage objects can't get out of sync) — no client insert/update,
since rows are written only by the RPCs above.

**Media privacy, as deployed**: the private `media` bucket (5MB/object cap, `image/jpeg` only)
has owner-scoped `storage.objects` RLS for insert/select/delete — first path segment must equal
`(select auth.uid())::text` — and deliberately **no UPDATE policy** (frames are write-once or
deleted, never edited in place). Photos/videos of people are sensitive; only the analyzed
frames (never the original video) are ever uploaded. No public URLs — access is via signed URLs
or authenticated reads only.

## Current — Supabase config: `config.toml` vs dashboard-only

`supabase/config.toml` (added by `supabase init` in M1) is a **local mirror + audit trail**, not
the live source of truth — most of it documents settings the hosted project's Management API
either can't take from this file at all, or was only ever pushed via a narrowly scoped PATCH,
never `supabase config push` (a warning to that effect lives in the file itself; running that
command against this project would attempt to push unrelated settings this file was never meant
to own).

- **Pushed live via a scoped Management API PATCH (`site_url`, `uri_allow_list`,
  `mailer_autoconfirm` only), and mirrored in `config.toml` for the record**: `site_url =
  "paceanalysisai://"` (no web frontend, so this is the app's own deep-link scheme, not a
  marketing site); `additional_redirect_urls` = `paceanalysisai://oauth-callback` (the exact URI
  `lib/auth.ts`'s `makeRedirectUri` produces), `paceanalysisai://**` (future deep links —
  password reset, magic links — under the same scheme), and `exp://**` (Expo Go dev testing via
  `npm run start:go`; scoped to a local-dev-only scheme, tracked as a pre-EAS-build cleanup item
  in `config.toml` and as [issue #69](https://github.com/IanQiu979/v2.3_RunningFormAna/issues/69)
  — it is blocked until the first dev build exists, since Expo Go's `makeRedirectUri` produces
  exactly the `exp://` URI that entry allowlists); `mailer_autoconfirm = true`
  (`enable_confirmations = false` in the file —
  the two are inverses) since no transactional email provider or confirmation-pending screen
  exists yet; `minimum_password_length = 8` (raised from 6, a security-audit LOW finding).
- **Dashboard-only, never pushed from this file**: which providers are enabled (`google` +
  `email` on; `apple` and `anonymous_users` off — set directly in the dashboard, `docs/status.md`
  Known Issue #3), the Google OAuth client ID/secret, and any future Apple Services ID/key.
- **Server-side HaveIBeenPwned leaked-password rejection: documented in `config.toml` but still
  NOT applied** — attempted live via the same PATCH mechanism during the M1 security audit and
  rejected with HTTP 402 ("available on Pro Plans and up"); this project is below that tier, so
  it's recorded as deferred rather than silently dropped. **Mitigated, not replaced, by a
  client-side check added for issue #70**: `lib/hibp.ts`'s `checkPasswordBreached` reimplements
  the same HIBP data via the free, keyless Pwned Passwords range API, called from
  `(auth)/sign-in.tsx`'s sign-up branch before `supabase.auth.signUp`. It is not equivalent — the
  client-side check is bypassable (a caller can talk to the Supabase Auth API directly and skip
  it), so it protects real users without closing the underlying gap and issue #70 stays open. If
  this project ever moves to Pro, turn the server-side setting on and delete `lib/hibp.ts`.
- **A discovery, not a config change**: the hosted Management API has **no field for a
  sign-in/sign-up rate limit** — `[auth.rate_limit].sign_in_sign_ups` in `config.toml` is a
  CLI/self-hosted-`supabase start`-only setting with no hosted equivalent; a PATCH attempt was
  silently accepted (HTTP 200) but never took effect, confirmed by a re-GET. CAPTCHA
  (`auth.captcha`, still disabled) is therefore the only real anti-farming lever available on
  this plan — tracked as blocking M4 going live in `docs/status.md` Known Issue #12, not
  something more config-file tuning can fix.
- **Local-stack-only settings that mean nothing for this hosted project**: everything else in
  `config.toml` outside the `[auth]` block (`[db]`, `[storage]`, `[api]`, etc.) governs a local
  `supabase start` stack only, present because `supabase init` generates the full default file —
  not evidence of any corresponding hosted configuration.
