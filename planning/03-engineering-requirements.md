# V2.3 — Engineering Requirements (Part B: How)

> Status: draft (2026-07-07), reconciled 2026-07-11 against `docs/mvp-build-prompt.md`'s 14
> rulings + fully-answered decision gate. Stack mirrors Echo V1 / V2.2 — known tools,
> cherry-pickable code. App name: **Pace AnalysisAI**.

## Tech stack (explicit)

| Layer | Choice | Notes |
|-------|--------|-------|
| App | Expo / React Native + TypeScript, expo-router | Same as Echo V1 / V2.2 |
| Media capture | `expo-image-picker` (upload) + `expo-camera` (in-app record, **muted** — no mic permission) + `expo-video-thumbnails` (frame extraction, one call per frame) + `expo-image-manipulator` (downscale/compress each frame — `expo-video-thumbnails` has no resize option) | Echo already uses image-picker + video-thumbnails; camera-record and image-manipulator are new. `expo-video` is **not** needed — Past Analyses shows a frame strip, never a video player |
| Auth | Supabase Auth — **Google OAuth + email/password in M1; Sign in with Apple added the moment an Apple Developer account exists**, before TestFlight review | Apple required by App Store rules once Google is offered, but that gate is at submission, not M1. Guest deferred to v2. |
| Database | Supabase Postgres | **New Supabase project** — do not share Echo V1's or V2.2's |
| Server logic | Supabase Edge Functions (Deno) | Vision calls + quota enforcement live here, never in the client |
| AI | **Claude vision (claude-sonnet-5)** via edge function | Multimodal: image block(s) + certified-knowledge text. Explicit thinking config, `max_tokens` 4–8k, forced tool call for structured output — not V1's 1024/1500 ceilings, which truncate Sonnet 5's default adaptive thinking. Key stays server-side |
| Storage | **Supabase Storage — private bucket, frames only** | The client extracts, downscales, and uploads **only the analyzed frames** direct-to-bucket under `{user_id}/{analysis_id}/…`; the original full-resolution video is never uploaded or stored. Bucket is private, owner-scoped `storage.objects` RLS (first path segment = `auth.uid()`). Media is **kept by default** so the frames show in Past Analyses via short-TTL (~1h) signed URLs. The **user can delete** any analysis → purges its frames too. Account deletion purges all of a user's stored objects. |
| Payments | Dummy (v1) → RevenueCat/StoreKit (v2) | Same `subscriptions` design as V2.2 for a painless swap |
| Email | Supabase built-in auth emails (v1) → dedicated SMTP before public launch | Verification / reset only in v1 |
| Hosting/builds | EAS Build, TestFlight | New Apple bundle ID |

## Architecture

```
app/ (expo-router)
  (auth)/sign-in, sign-up
  (tabs)/index        ← Home / Analyze (pick source)
  (tabs)/history      ← past analyses
  capture/            ← record or pick, framing guide (stack)
  result/[id]         ← analysis result view
  paywall, settings

lib/
  supabase.ts
  frames.ts            ← extract, downscale, and upload N frames from a video (client-side)
                          direct-to-bucket for motion analysis
  pace.ts              ← PACE pillar types + result parser, imported by app + edge functions
  subscription.ts      ← tier read + dummy purchase (adapted from Echo/V2.2; cosmetic only —
                          never authoritative, see "Security & privacy requirements" below)

knowledge/             ← certified files, adapted ECHO → PACE (done 2026-07-10) — 4 Echo source
                          files map to 3 targets, not a 1:1 copy
  pace_framework.md    ← from ECHO_Framework_CORRECTED.md, rewritten around PACE pillars;
                          Elasticity authored fresh from peer-reviewed sources (pending Ian's
                          certification)
  injury_flags.md      ← carried over for injury-risk flagging
  drills.md            ← the certified drills/cues extracted from
                          ECHO_Framework_CORRECTED.md itself (five cadence drills ~lines
                          153–229; posture/arm-swing cues ~453–478) — training_zones.md and
                          workout_library.md contain zero drills and are NOT a source

supabase/functions/
  analyze-form/        ← THE core function (below)
  delete-account/      ← ported from Echo V1's delete-user/: storage objects → rows → auth user
```

### `analyze-form` edge function (the heart of the app)

1. **Auth** — verify the JWT, reject anon.
2. **Idempotency** — an existing `(user_id, idempotency_key)` row is returned as-is; no
   re-analysis, no double charge.
3. **Atomic reserve** — a `SECURITY DEFINER` RPC checks the tier's limit (Free 1 lifetime / Pro
   10 / Elite 30 per purchase-anchored period) and the tier's frame-count cap, then reserves the
   analysis atomically. Over quota → structured `402`.
4. **Inputs** — photo: one frame. Video: client-extracted, downscaled frames (see "Frame
   pipeline" below) with their actual sampled timestamps; those same frames were already
   uploaded direct-to-bucket (frames-only — the original video is never uploaded), and their
   storage paths ride in the request alongside the base64 frame data.
5. **Build the grounded prompt** — system message = the certified `knowledge/` files
   (`pace_framework.md` + `injury_flags.md` + `drills.md`, bundled with the function, not
   fetched per call), then the image block(s) plus their timestamps, then the scoring
   instruction. **Detail scales with tier via a verbosity dial on one prompt, not a different
   call** — Free: scores + a line per pillar, no drills; Pro: full feedback + injury flags +
   1–2 drills per issue; Elite: Pro + a small depth bump. The Pro→Elite gap is deliberately tiny.
6. **One vision call** — `claude-sonnet-5`, explicit thinking config, `max_tokens` 4–8k, a
   forced tool call returning structured JSON (pillar → score, feedback, flags, drills). No
   client-side prompts, no regex-parsing of prose as the primary path.
7. **Validate structurally, loosely** — check the expected shape exists; never judge content.
   Fail → retry once. Fail again → a clearly-labelled partial result if ≥2 pillars parsed
   (never a fabricated score for the rest), else a clean failure. The reserve is released either
   way — **failures and fallbacks never burn quota** — capped at 3 free retries per period
   against prompt-injection farming.
8. **Settle** — mark the reservation delivered, insert the `analyses` row (`result` JSONB,
   `media_paths`, `tier_at_run`, `frame_count`, `is_fallback`), return
   `{ result, analysisId, isFallback }`.

**Lessons carried from Echo, and lessons NOT carried** (`app/form-analysis.tsx`):
- Reuse the base64 image-block construction pattern and the thumbnail-extraction call shape.
- Do **not** reuse V1's client-side prompt (any authenticated caller could run arbitrary prompts
  on the API key) or its "tolerant" per-pillar regex parser, which fabricates score 75 +
  "No feedback available" for pillars the model didn't return — banned here. A pillar the model
  didn't return is shown as not assessed, never as an invented number.
- Keep validation **structural, not strict-content** (the `planGenerator.ts` lesson) — analysis
  quality is the product, and grounding it in the certified files is the quality lever, not a
  strict validator.
- V1 charged quota *before* the model call, so failures still cost the user an analysis. V2.3's
  reserve → settle / compensating-release pattern (step 3 and step 7 above) fixes that.

### Frame pipeline (the new part vs Echo)

- **Per-tier frame counts:** Free 1 / Pro 5 / Elite 8, enforced server-side against the tier.
- **Sampling:** timestamps sampled evenly across the **5%–95%** window of the clip (never
  t=0/end — extractor edge failures); Android snaps to keyframes, so the actual sampled
  timestamps are recorded and passed to the prompt rather than claiming perfect even spacing.
- **Extraction:** `expo-video-thumbnails` returns one frame per call — N frames is N sequential
  calls; the UI shows progress while this runs.
- **Downscale/compress:** each frame is downscaled to ≤1568px long edge (Anthropic's optimum)
  at JPEG q≈0.7 via `expo-image-manipulator`, targeting ~150–350KB/frame.
- **Caps:** max clip length 15s; max upload 50MB pre-compress; total request body ≤5MB,
  enforced client-side and re-checked server-side.
- Frames are sent together in one vision request so the model can reason about change over time
  (cadence, arm-swing symmetry, elasticity/bounce).

### Elite comparison — client-side only (decided, kept minimal)

A **client-side view of two already-stored `analyses` rows** side by side with per-pillar score
deltas — the Elite-only progress-comparison screen from the design brief (§4, screen 9). No new
AI call, no quota burn, no extra storage: it reads two rows the user already has via the normal
`analyses` RLS read and diffs them in the client.

## API design

| Method / Route | Auth | Body | Returns | Notes |
|----------------|------|------|---------|-------|
| `POST /functions/v1/analyze-form` | JWT | `{ mediaType: "photo"\|"video", frames: [base64...], mediaPaths: string[], idempotencyKey }` | `{ result, analysisId, isFallback }` or `402` over-quota / `403` anon | Core call. Frames are analyzed; `mediaPaths` are the direct-to-bucket paths of those same frames (nothing large rides the JSON body). Enforces tier + frame cap + atomic quota reserve, injects certified knowledge, validates, persists. Idempotent on `idempotencyKey`. |
| `POST /functions/v1/purchase-tier` | JWT | `{ tier, source: "dummy" }` | `{ tier, periodStart, periodEnd }` | Same contract as V2.2; v2 swaps `source` to receipt verification. |
| `GET  /functions/v1/quota-status` | JWT | — | `{ tier, used, limit, periodEnd }` | Drives Home "7 of 10 left" (Pro/Elite) or "1 of 1 used, lifetime" (Free). See quota-period arithmetic below. |
| `DELETE /functions/v1/analysis/:id` | JWT | — | `{ deleted: true }` | User-initiated delete: removes the `analyses` row **and** its frame objects atomically. (Alternatively done client-side via owner-scoped RLS on both the table and the Storage bucket — an edge function is preferred so the row + objects can't get out of sync.) |
| `POST /functions/v1/delete-account` | JWT | — | `{ deleted: true }` | Ported from Echo V1's `delete-user/` — `storage.objects` has no FK to `auth.users`, so this exists precisely to avoid orphaning every object. Delete order: storage objects → rows → auth user. |

Direct Supabase-client reads (RLS, `user_id = auth.uid()`): list own `analyses`, read own
`subscriptions`, read own frames from the private bucket via short-TTL signed URLs. Inserts
into `analyses` happen only inside `analyze-form`.

**Error contract:** every non-2xx response body is structured `{ error, code }`, same shape as
V2.2. `supabase.functions.invoke` wraps any non-2xx in a generic `FunctionsHttpError`, so the
client needs **one shared wrapper** that parses `{ error, code }` back out of that exception —
implement it once and reuse it for every function call, not per call site.

## Quota-period arithmetic (ported verbatim from V2.2)

- Periods are **purchase-day-anchored**, month-end clamped (Jan 31 → Feb 28 → Mar 31), computed
  at read time by one pure, unit-tested `currentPeriod(anchorDate, now)` — no cron, no rollover
  writes.
- **Free is lifetime, not per-period:** `free → count(analyses) total` (against the Free limit
  of 1). `pro|elite → count(analyses) in currentPeriod(anchorDate, now)` (against 10 / 30). A
  user with no `subscriptions` row is `free`. Both branches must be implemented — Free does not
  reuse the period logic.
- The reserve/settle RPC (below) does this count check atomically, not the request handler.

## DB schema (draft)

```sql
profiles       (id → auth.users, created_at, display_name)
subscriptions  (user_id, tier free|pro|elite, period_start, period_end, source dummy|revenuecat)
analyses       (id, user_id, tier_at_run, media_type photo|video, frame_count,
                media_paths text[],           -- private-bucket paths of the analyzed frames;
                                               -- kept by default; NOT a single video path
                idempotency_key text,         -- UNIQUE (user_id, idempotency_key)
                result jsonb,                 -- 4 PACE pillars + flags + drills
                is_fallback bool, created_at)
```

- Quota: `free → count(analyses) total`; `pro|elite → count(analyses) in currentPeriod(...)` —
  see "Quota-period arithmetic" above. Never count-then-insert (a 20–60s vision-call window is a
  real TOCTOU race) — reserve atomically first, via a `SECURITY DEFINER` RPC (ported from Echo
  V1's `try_record_form_analysis`), then run the analysis, then mark delivered on success or
  release the reservation on failure. Quota is never charged before the model call succeeds.
- **RLS on every table**; tier/quota writes only via edge functions (service role).
- `UNIQUE (user_id, idempotency_key)` on `analyses` — a retried request (client-minted key,
  minted when the capture flow commits) returns the existing row instead of double-charging
  quota and Anthropic.
- Frames live in a **private Storage bucket**, paths on the row (`media_paths`, plural), RLS/
  access scoped to the owner. Deleting an analysis (or the account) purges the row **and** its
  frame objects.

## Security & privacy requirements

- Anthropic key only in the edge function env — never in the app bundle.
- Quota / tier / frame-cap enforced server-side only, via the atomic reserve/settle RPC; client
  state (including `lib/subscription.ts`'s tier read) is cosmetic and never authoritative.
- **Media privacy**: photos/videos of people are sensitive. Retention model (decided): only the
  analyzed **frames** are kept by default (never the original video) in a private, owner-only-RLS
  bucket so they appear in Past Analyses via short-TTL signed URLs, and the **user controls
  deletion** — deleting an analysis purges its frames, and deleting the account purges all of the
  user's stored objects. No public URLs; access via signed URLs or authenticated reads.
- **Consent**: a one-line notice before the first-ever upload ("your photo/video is stored
  privately until you delete it; frames are sent to our AI provider for analysis"), repeated in
  Settings. Full privacy policy + App Store privacy labels are tracked for M7, not dropped.
- **Backgrounding recovery**: the server persists the result and settles quota even if a
  suspended client never receives the response; the next launch surfaces "Your analysis
  finished — see Past Analyses." Upload uses the resumable/TUS path for anything large enough
  to want progress.
- Dummy payment goes through the edge function (sets `subscriptions`), same as V2.2.

## Conventions & best practices (for Claude to follow)

- TypeScript strict; shared PACE types in `lib/pace.ts`, imported by app + edge function.
- No business rules in the client (tier, quota, frame cap, analysis are server-only).
- Structural-not-strict validation; grounding via certified files is the quality mechanism. A
  pillar the model didn't return is "not assessed," never a fabricated score.
- Theme tokens only (`constants/theme.ts`, PACE palette).
- Secrets in edge-function env / EAS secrets; certified knowledge bundled with the function.
- Migrations checked into `supabase/migrations/`.

## Infrastructure to provision (before coding)

- [ ] New Supabase project (`v2.3Analysis`, ref `vputdomdlknvthnzritt`) — **Google OAuth +
      email/password enabled now**; add **Sign in with Apple** the moment an Apple Developer
      account exists, before TestFlight review (Google client ID/secret + Apple Services ID/key)
- [ ] Create a **private Storage bucket** for frames (owner-scoped RLS; kept by default,
      user-deletable; original video never uploaded)
- [ ] Anthropic API key (separate key from Echo / V2.2, for per-app usage tracking)
- [ ] Apple Developer: new bundle ID (`com.ian.paceanalysisai`, already set in `app.json`)
- [ ] EAS project (`eas init`)
- [ ] New GitHub repo (this folder)

## Build step 1 — knowledge grounding (done 2026-07-10)

4 Echo source files map to **3** `knowledge/` targets — not a 1:1 copy:
- `ECHO_Framework_CORRECTED.md` → `pace_framework.md`, **rewritten around PACE pillars**
  (Posture, Arm swing, Cadence, Elasticity) instead of ECHO (Economy, Cadence, Harmony,
  Optimization). This is the certified core; Elasticity had zero source coverage and was
  authored fresh from peer-reviewed literature (citations in the file), pending Ian's
  certification.
- `injury_flags.md` → carried over for injury-risk flagging.
- `drills.md` → the certified drills/cues, extracted from **`ECHO_Framework_CORRECTED.md`
  itself** (five cadence drills, lines ~153–229; posture/arm-swing cues, lines ~453–478).
  **`training_zones.md` and `workout_library.md` contain zero drills** and were never a valid
  source for this file, despite the original plan.

These files are bundled into the `analyze-form` function and injected as the system context
so every analysis is grounded in certified info. **Echo V1 stays frozen — copy from it, never
into it.**

## Explicitly reused from Echo V1 (cherry-pick, don't fork)

- `app/form-analysis.tsx` — base64 image-block construction and thumbnail-extraction call
  shape only. **Not** its client-side prompt (a public prompt-injection surface) and **not**
  its tolerant per-pillar parser (fabricates scores) — banned here.
- `anthropic-coach/index.ts` — the atomic `try_record_form_analysis` RPC pattern and the
  purpose/tier verification shape (this is V1's real server enforcement, not
  `lib/subscription.ts`).
- `plan-regen-gate/` (V2.2) — the reserve → consume-token → compensating-refund pattern that
  fixes V1's charge-before-the-model-call flaw.
- `delete-user/index.ts` — full account-deletion including storage-orphan cleanup.
- `echo-knowledge/*.md` — the certified content (adapted to PACE per the mapping above).
- `constants/theme.ts` — design-token approach (new PACE palette).
