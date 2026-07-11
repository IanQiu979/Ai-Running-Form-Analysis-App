# Architecture

System design for V2.3 — Photo/Video Running Analysis. Current state and planned state are
kept in clearly separate sections below; nothing in a "planned" section is built yet. See also
[`CLAUDE.md`](../CLAUDE.md), [`docs/status.md`](status.md), and the source spec,
[`planning/03-engineering-requirements.md`](../planning/03-engineering-requirements.md).

**No `src/` in this project** — unlike V2.2, code lives directly at the repo root. The
`@/*` path alias maps to `./*` (see `tsconfig.json`), not `./src/*`.

## Current — what exists in the repo

```
app/
  _layout.tsx           # root layout — still the create-expo-app template
  (tabs)/_layout.tsx     # still the create-expo-app template
  (tabs)/index.tsx       # still the create-expo-app template
  (tabs)/explore.tsx     # still the create-expo-app template
  modal.tsx              # still the create-expo-app template
components/              # template UI (external-link, haptic-tab, hello-wave,
                          # parallax-scroll-view, themed-text, themed-view,
                          # ui/collapsible, ui/icon-symbol)
constants/theme.ts        # stock Expo template palette (Colors light/dark, Fonts) — no PACE
                          # palette yet
hooks/                    # use-color-scheme, use-theme-color
```

There is no `lib/`, no `supabase/functions/`, no `supabase/migrations/`; no auth screens, no
intake/capture screens, no result view. The `knowledge/` files and the `docs/design/` brief now
exist (see below) — those are the only exceptions to "nothing beyond the create-expo-app
scaffold exists yet."

## Planned — route tree

```
app/
  (auth)/sign-in, sign-up
  (tabs)/index          # Home / Analyze (pick source)
  (tabs)/history        # past analyses
  capture/               # record or pick, framing guide (stack)
  result/[id]            # analysis result view
  paywall, settings
```

## Planned — `lib/` layout

```
lib/
  supabase.ts
  frames.ts              # extract, downscale, and upload N frames from a video (client-side)
                          # direct-to-bucket, for motion analysis
  pace.ts                 # PACE pillar types + result parser, imported by app + edge functions
  subscription.ts         # tier read + dummy purchase (adapted from Echo V1 / V2.2) — cosmetic
                          # only; tier/quota are never authoritative on the client
```

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

## Planned — design brief

The single basic-MVP design brief lives at
[`docs/design/frontend-design-brief.md`](design/frontend-design-brief.md) — the "Gait Plate"
visual direction (distinct-but-related to V2.2), the 0–100 + band score display, all 11 screens
with their states, motion, and the a11y floor. UI work builds from it rather than re-deriving
the direction.

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

## Planned — DB schema (draft, not deployed)

The live Supabase project (`v2.3Analysis`) currently has 0 tables, 0 migrations, and 0 edge
functions. This schema is the draft in
[`planning/03-engineering-requirements.md`](../planning/03-engineering-requirements.md), not
deployed anywhere yet.

```sql
profiles       (id -> auth.users, created_at, display_name)
subscriptions  (user_id, tier free|pro|elite, period_start, period_end, source dummy|revenuecat)
analyses       (id, user_id, tier_at_run, media_type photo|video, frame_count,
                media_paths text[],           -- private-bucket paths of the analyzed frames;
                                               -- kept by default; NOT a single video path
                idempotency_key text,         -- UNIQUE (user_id, idempotency_key)
                result jsonb,                 -- 4 PACE pillars + flags + drills
                is_fallback bool, created_at)
```

Quota check: `free → count(analyses) total` (against the Free limit of 1, lifetime — not
per-period); `pro|elite → count(analyses) in currentPeriod(anchorDate, now)` (against 10 / 30).
A user with no `subscriptions` row is `free`. Periods are purchase-day-anchored and month-end
clamped (Jan 31 → Feb 28 → Mar 31), computed at read time by one pure, unit-tested
`currentPeriod(anchorDate, now)` — no cron, no rollover writes. The count check runs inside the
atomic reserve/settle RPC, never as a separate count-then-insert (that has a 20–60s TOCTOU
race across the vision call) — no separate counter table to drift out of sync either way.

**RLS rule for every table**: `user_id = auth.uid()` for select/insert of the caller's own
rows. Tier and quota columns are only ever written by edge functions running as the service
role — the client can never write its own tier or quota.

**Media privacy**: photos/videos of people are sensitive. Only the analyzed frames (never the
original video) live in a private, owner-only-RLS Storage bucket, kept by default so they
appear in Past Analyses via short-TTL signed URLs. Deleting an analysis (or the account) purges
the row and its frame objects. No public URLs — access is via signed URLs or authenticated
reads only.
