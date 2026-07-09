# V2.3 — Engineering Requirements (Part B: How)

> Status: draft (2026-07-07). Stack mirrors Echo V1 / V2.2 — known tools, cherry-pickable code.

## Tech stack (explicit)

| Layer | Choice | Notes |
|-------|--------|-------|
| App | Expo / React Native + TypeScript, expo-router | Same as Echo V1 / V2.2 |
| Media capture | `expo-image-picker` (upload) + `expo-camera` (in-app record) + `expo-video-thumbnails` / frame extraction | Echo already uses image-picker + video-thumbnails; camera-record is new |
| Auth | Supabase Auth — **Google OAuth + Sign in with Apple + email/password** | Required sign-up; Apple required by App Store when Google offered. Guest deferred to v2. |
| Database | Supabase Postgres | **New Supabase project** — do not share Echo V1's or V2.2's |
| Server logic | Supabase Edge Functions (Deno) | Vision calls + quota enforcement live here, never in the client |
| AI | **Claude vision (claude-sonnet-5)** via edge function | Multimodal: image block(s) + certified-knowledge text. Key stays server-side |
| Storage | **Supabase Storage — private bucket for uploaded media** | Media is **kept by default** so it shows in Past Analyses. Bucket is private, owner-scoped RLS. The **user can delete** any analysis → purges its media too. Account deletion purges all of a user's media. |
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
  frames.ts            ← extract N frames from a video (client-side) for motion analysis
  pace.ts              ← PACE pillar types + result parser
  subscription.ts      ← tier read + dummy purchase (adapted from Echo/V2.2)

knowledge/             ← certified files, adapted ECHO → PACE (build step 1)
  pace_framework.md    ← from ECHO_Framework_CORRECTED.md
  injury_flags.md
  drills.md            ← distilled from training_zones.md + workout_library.md

supabase/functions/
  analyze-form/        ← THE core function (below)
```

### `analyze-form` edge function (the heart of the app)

1. Authenticate the user (JWT) — reject anon.
2. Read tier + count analyses this period **server-side**; reject over quota.
3. Receive image(s): one frame (photo / free-tier video) or several frames (paid video).
4. **Build the grounded prompt**: system message = the certified PACE knowledge (framework +
   injury flags + drills), so Claude analyzes against validated biomechanics, not general
   knowledge. Then the image block(s) + the PACE scoring instruction.
   - The knowledge text is bundled with the function (imported), not fetched per-call.
5. Call Claude vision; expect 4 PACE pillars, each with a score + feedback, plus injury flags
   and (paid) drills. **Detail scales with tier via a verbosity dial in the prompt** — Free =
   scores + one line per pillar, no drills; Pro = fuller feedback + flags + drills; Elite = Pro
   plus a small verbosity/depth bump (an extra cue or two, slightly longer drill programming).
   The Pro→Elite gap is intentionally tiny — same analysis, richer wording — not a different call.
6. Validate structure → retry once → fall back to a safe partial result flagged as such.
7. Persist the result to `analyses`, upload the media to the private bucket and store its path
   on the row (kept by default; user can delete later), return the result.

**Lessons carried from Echo** (`app/form-analysis.tsx`):
- Reuse the base64 image-block pattern and the tolerant per-pillar parser (regex that survives
  heading/format drift), but rename pillars ECHO → PACE.
- Keep validation **structural, not strict-content** (the `planGenerator.ts` lesson) — analysis
  quality is the product, and grounding it in the certified files is the quality lever, not a
  strict validator.

### Multi-frame video (the new part vs Echo)

- Client extracts N evenly-spaced frames from the clip (start with N≈4–6; Elite may use more).
- Frames sent together in one vision request so the model can reason about change over time
  (cadence, arm-swing symmetry, elasticity/bounce).
- Cost/latency scale with frame count → cap N per tier; enforce server-side.

## API design

| Method / Route | Auth | Body | Returns | Notes |
|----------------|------|------|---------|-------|
| `POST /functions/v1/analyze-form` | JWT | `{ mediaType: "photo"\|"video", frames: [base64...], sourceMeta? }` | `{ result, analysisId, isFallback }` or `402` over-quota / `403` anon | Core call. Enforces tier + frame cap + quota, injects certified knowledge, validates, persists. |
| `POST /functions/v1/purchase-tier` | JWT | `{ tier, source: "dummy" }` | `{ tier, periodStart, periodEnd }` | Same contract as V2.2; v2 swaps `source` to receipt verification. |
| `GET  /functions/v1/quota-status` | JWT | — | `{ tier, used, limit, periodEnd }` | Drives Home "7 of 10 left". Computed from `count(analyses)`. |
| `DELETE /functions/v1/analysis/:id` | JWT | — | `{ deleted: true }` | User-initiated delete: removes the `analyses` row **and** its media object atomically. (Alternatively done client-side via owner-scoped RLS on both the table and the Storage bucket — an edge function is preferred so the row + object can't get out of sync.) |

Direct Supabase-client reads (RLS, `user_id = auth.uid()`): list own `analyses`, read own
`subscriptions`, read own media from the private bucket. Inserts into `analyses` happen only
inside `analyze-form`.

## DB schema (draft)

```sql
profiles       (id → auth.users, created_at, display_name)
subscriptions  (user_id, tier free|pro|elite, period_start, period_end, source dummy|revenuecat)
analyses       (id, user_id, tier_at_run, media_type photo|video, frame_count,
                media_path text,               -- private-bucket path; kept by default
                result jsonb,                  -- 4 PACE pillars + flags + drills
                is_fallback bool, created_at)
```

- Quota = `count(analyses) where user_id = X and created_at in current period` vs tier limit.
- **RLS on every table**; tier/quota writes only via edge functions (service role).
- Media lives in a **private Storage bucket**, path on the row, RLS/access scoped to the owner.
  Deleting an analysis (or the account) purges the row **and** the media object.

## Security & privacy requirements

- Anthropic key only in the edge function env — never in the app bundle.
- Quota / tier / frame-cap enforced server-side only; client state is cosmetic.
- **Media privacy**: photos/videos of people are sensitive. Retention model (decided): media is
  **kept by default** in a private, owner-only-RLS bucket so it appears in Past Analyses, and the
  **user controls deletion** — deleting an analysis purges its media, and deleting the account
  purges all of the user's media. No public URLs; access via signed URLs or authenticated reads.
- Dummy payment goes through the edge function (sets `subscriptions`), same as V2.2.

## Conventions & best practices (for Claude to follow)

- TypeScript strict; shared PACE types in `lib/pace.ts`, imported by app + edge function.
- No business rules in the client (tier, quota, frame cap, analysis are server-only).
- Structural-not-strict validation; grounding via certified files is the quality mechanism.
- Theme tokens only (`constants/theme.ts`, PACE palette).
- Secrets in edge-function env / EAS secrets; certified knowledge bundled with the function.
- Migrations checked into `supabase/migrations/`.

## Infrastructure to provision (before coding)

- [ ] New Supabase project (`v23-form-analysis` or final name) — enable **Google OAuth +
      Sign in with Apple + email/password** (Google client ID/secret + Apple Services ID/key)
- [ ] Create a **private Storage bucket** for media (owner-scoped RLS; media kept by default, user-deletable)
- [ ] Anthropic API key (separate key from Echo / V2.2, for per-app usage tracking)
- [ ] Apple Developer: new bundle ID
- [ ] EAS project (`eas init`)
- [ ] New GitHub repo (this folder)

## Build step 1 — knowledge grounding (do first)

Copy these from Echo's `echo-knowledge/` and adapt into `knowledge/`:
- `ECHO_Framework_CORRECTED.md` → `pace_framework.md`, **rewritten around PACE pillars**
  (Posture, Arm swing, Cadence, Elasticity) instead of ECHO (Economy, Cadence, Harmony,
  Optimization). This is the certified core.
- `injury_flags.md` → carried over for injury-risk flagging.
- `training_zones.md` + `workout_library.md` → distilled into `drills.md` (only the
  form-correction drills, not full training plans).

These files are bundled into the `analyze-form` function and injected as the system context
so every analysis is grounded in certified info. **Echo V1 stays frozen — copy from it, never
into it.**

## Explicitly reused from Echo V1 (cherry-pick, don't fork)

- `app/form-analysis.tsx` — base64 image-block vision call + tolerant per-pillar parser
- `lib/subscription.ts` — `FORM_ANALYSIS_LIMITS` / tier gating pattern
- `echo-knowledge/*.md` — the certified content (adapted to PACE)
- `constants/theme.ts` — design-token approach (new PACE palette)
