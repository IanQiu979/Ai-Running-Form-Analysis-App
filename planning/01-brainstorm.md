# V2.3 — Photo/Video Running Analysis: Brainstorm

> Planning phase only. No code exists yet. Single-purpose spin-off of Echo V1 (PACE family):
> the app does one thing — analyze a photo/video of your running form and give certified feedback.

---

## Step 1 — Brainstorm ✅

### What's the actual goal of this project?
**Real launch** — ship to the App Store. Reuses V2.2's shared decisions where they overlap.

### Functionality milestones

**v1 (MVP):**
- Single feature: submit a **photo or video** of your running → get **form analysis** back.
- Media in via **upload from library OR record in-app** (both).
- Video is analyzed as **real motion**: extract multiple frames across the clip and send them
  together to Claude vision (a genuine upgrade over Echo, which only analyzes one still frame).
- Analysis uses **Claude vision grounded in certified knowledge files** — Claude reads the
  copied-in rule docs *before* analyzing, so the feedback is based on validated info, not the
  model's general knowledge.
- Framework rebranded to **PACE**: Posture, Arm swing, Cadence, Elasticity (four pillars).
- Analysis output: per-pillar score + specific feedback, injury-risk flags, and suggested
  drills to fix issues.
- Results are stored and viewable in a history tab.
- **Dummy payment** + Free/Pro/Elite tiers (inherited from V2.2), analysis quota per tier.

**v2+ (later):**
- Real payments (IAP — required for App Store; see V2.2 note).
- Guest account.
- Possibly deeper motion analysis (pose estimation / joint angles) if Claude-vision-on-frames
  proves too coarse.

---

## Step 2 — AI clarifying questions

### Answered
- **Goal:** real launch; reuse V2.2 defaults (auth: Google + Apple + email; Free/Pro/Elite
  dummy-payment tiers).
- **Input:** both photo and video.
- **Capture:** both upload-from-library and record-in-app.
- **Engine:** Claude vision, grounded in the certified Echo knowledge files (copied into this
  project and read by Claude before each analysis).
- **Video depth:** multiple frames (real motion), not a single frame.
- **Framework:** rebrand ECHO → **PACE** (Posture, Arm swing, Cadence, Elasticity).
- **Knowledge files to copy in:** `ECHO_Framework_CORRECTED.md` (form biomechanics),
  `injury_flags.md`, and `training_zones.md` / `workout_library.md` (for drill suggestions).

### Findings from the Echo codebase (inform the build)
- Echo's form analysis lives in `app/form-analysis.tsx`; it sends a base64 image to the
  `anthropic-coach` edge function with a short **inline** prompt built on ECHO's 4 pillars
  (Economy, Cadence, Harmony, Optimization). It does **not** read the knowledge md files.
- Echo "video" analysis extracts a **single thumbnail frame** (`expo-video-thumbnails`) — no
  real motion analysis. V2.3's multi-frame approach is new work.
- Tier gating exists via `FORM_ANALYSIS_LIMITS` / `canDoFormAnalysis` in `lib/subscription.ts`.
- These are cherry-pick sources; Echo V1 stays frozen.

---

## Step 3 — Spec doc ✅ (drafted)

- `planning/02-product-requirements.md` — Part A: what & why
- `planning/03-engineering-requirements.md` — Part B: how

### Locked
- Quotas: Free 1 total · Pro 10/mo · Elite 30/mo.
- Detail gradient: Free < Pro < Elite; Pro→Elite is a *tiny* verbosity/depth bump, not a
  different analysis (Elite's draw is quantity + progress comparison).
- Media retention: kept by default in Past Analyses (private bucket); user can delete any
  analysis, which purges its media. User's choice.

### Remaining before coding
- [ ] Copy the 4 knowledge files into the V2.3 repo and adapt ECHO → PACE pillars (build step 1)
- [ ] Pick the app name
- [ ] Provision infra (checklist in 03)
