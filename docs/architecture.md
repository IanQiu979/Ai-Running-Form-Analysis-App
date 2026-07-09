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

There is no `lib/`, no `knowledge/`, no `supabase/functions/`, no `supabase/migrations/`; no
auth screens, no intake/capture screens, no result view. Nothing beyond the create-expo-app
scaffold and the planning docs exists yet.

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
  frames.ts              # extract N frames from a video (client-side) for motion analysis
  pace.ts                 # PACE pillar types + result parser, imported by app + edge function
  subscription.ts         # tier read + dummy purchase (adapted from Echo V1 / V2.2)
```

## Planned — `knowledge/` layout

Certified files, adapted ECHO → PACE (planning's "build step 1", not yet done):

```
knowledge/
  pace_framework.md      # from Echo V1's ECHO_Framework_CORRECTED.md, rewritten around PACE
  injury_flags.md         # carried over for injury-risk flagging
  drills.md               # distilled from Echo V1's training_zones.md + workout_library.md,
                          # form-correction drills only, not full training plans
```

These files are meant to be bundled into the `analyze-form` edge function and injected as
system context, so every analysis is grounded in certified biomechanics rather than the model's
general knowledge. Echo V1 stays frozen — copy from it, never into it.

## Planned — `analyze-form` edge function flow

The core of the app.

1. Authenticate the JWT — reject anonymous requests.
2. Read tier + count of analyses in the current period, server-side; reject requests over
   quota.
3. Receive image(s): one frame (photo, or free-tier video) or several frames (paid video —
   the client extracts N evenly-spaced frames, starting around N≈4–6, so the model can reason
   about change over time for cadence, arm-swing symmetry, and elasticity/bounce). Frame count
   is capped per tier and enforced server-side.
4. Build the grounded prompt: system message = the certified PACE knowledge (framework +
   injury flags + drills, bundled with the function, not fetched per call), then the image
   block(s) plus the PACE scoring instruction. Detail scales with tier via a verbosity dial —
   Free gets scores + one line per pillar and no drills; Pro gets fuller feedback, injury-risk
   flags, and drills; Elite gets the same analysis as Pro plus a small verbosity/depth bump
   (the Pro→Elite gap is intentionally tiny, not a different call).
5. Call Claude vision (`claude-sonnet-5`); expect the 4 PACE pillars (Posture, Arm swing,
   Cadence, Elasticity), each scored with feedback, plus injury flags and (paid) drills.
6. Validate the response structurally; on failure retry once; on a second failure fall back to
   a safe partial result flagged as such (`is_fallback: true`) — validation is structural, not
   strict-content, per the known Echo V1 over-tight-validation mistake.
7. Persist the result to `analyses`, upload the media to the private Storage bucket, and store
   its path on the row (kept by default; user can delete later); return the result.

## Planned — API

The client never talks to Postgres for privileged operations — those go through edge
functions. Plain reads of the caller's own rows go through the Supabase client, protected by
RLS.

| Method / Route | Auth | Body | Returns | Notes |
|---|---|---|---|---|
| `POST /functions/v1/analyze-form` | JWT | `{ mediaType: "photo"\|"video", frames: [base64...], sourceMeta? }` | `{ result, analysisId, isFallback }` or `402` over-quota / `403` anon | Core call. Enforces tier + frame cap + quota, injects certified knowledge, validates, persists. |
| `POST /functions/v1/purchase-tier` | JWT | `{ tier, source: "dummy" }` | `{ tier, periodStart, periodEnd }` | Same contract as V2.2; v2 swaps `source` to receipt verification. |
| `GET /functions/v1/quota-status` | JWT | — | `{ tier, used, limit, periodEnd }` | Drives Home "7 of 10 left". Computed from `count(analyses)`, never a client counter. |
| `DELETE /functions/v1/analysis/:id` | JWT | — | `{ deleted: true }` | User-initiated delete: removes the `analyses` row **and** its media object atomically, so they can't get out of sync. |

Direct Supabase-client reads (RLS-guarded, `user_id = auth.uid()`): list own `analyses`; read
own `subscriptions`; read own media from the private bucket. Inserts into `analyses` happen
only inside `analyze-form`.

## Planned — DB schema (draft, not deployed)

The live Supabase project (`v2.3Analysis`) currently has 0 tables, 0 migrations, and 0 edge
functions. This schema is the draft in
[`planning/03-engineering-requirements.md`](../planning/03-engineering-requirements.md), not
deployed anywhere yet.

```sql
profiles       (id -> auth.users, created_at, display_name)
subscriptions  (user_id, tier free|pro|elite, period_start, period_end, source dummy|revenuecat)
analyses       (id, user_id, tier_at_run, media_type photo|video, frame_count,
                media_path text,              -- private-bucket path; kept by default
                result jsonb,                 -- 4 PACE pillars + flags + drills
                is_fallback bool, created_at)
```

Quota check = `count(analyses) where user_id = X and created_at in current period` compared
against the tier limit — no separate counter table to drift out of sync.

**RLS rule for every table**: `user_id = auth.uid()` for select/insert of the caller's own
rows. Tier and quota columns are only ever written by edge functions running as the service
role — the client can never write its own tier or quota.

**Media privacy**: photos/videos of people are sensitive. Media lives in a private,
owner-only-RLS Storage bucket, kept by default so it appears in Past Analyses. Deleting an
analysis (or the account) purges the row and the media object. No public URLs — access is via
signed URLs or authenticated reads only.
