# V2.3 — Product Requirements (Part A: What & Why)

> **Spec-time record, not current state.** Unlike the design brief, this document has not been
> substantively amended since it was written in 2026-07 (only a cosmetic 2026-08-06 wordmark
> rename) — it carries no dated amendment notes, so read the whole of it as what was intended at
> spec time rather than as a description of the shipped app.
>
> The shipped behaviour differs in places. Two known divergences, not an exhaustive list:
> the Past Analyses deletion interaction (the "User flow (v1)" chart's "swipe/tap to delete") —
> the shipped screen uses a persistent per-row Delete button, per `docs/design/copy-deck.md`
> (Screen 8 — Past Analyses); and the "Submit media" consent notice below, which says "your
> photo/video is stored privately until you delete it" — false under Ruling 1's frames-only
> contract (the full-resolution video never leaves the device), corrected in the shipped copy on
> 2026-07-12 and logged at `docs/design/copy-deck.md`'s consent/privacy entry. This document's
> own "no video is stored, only the frames Claude actually analyzed" line is the accurate one.
>
> Kept unrewritten so the record of what was specified, and why it changed, survives;
> `docs/status.md` and `docs/architecture.md` carry current state.

> Status: draft from brainstorm (2026-07-07), reconciled 2026-07-11 against
> `docs/mvp-build-prompt.md`'s rulings + decision gate. App name decided: **Pace Analysis AI**
> (PACE family; repo/codename stays "V2.3"). Real-launch goal.

## Who it's for

Runners who want to know if their **form** is good — and how to fix it — without a gait-analysis
lab or an in-person coach. Same "one thing, done well" positioning as the rest of the PACE
family, and a direct answer to Echo V1's "too many features" feedback.

## What problem it solves

- Runners can't see their own form while running; bad form causes injury and wastes energy.
- Pro gait analysis is expensive, in-person, and rare.
- Echo V1 has form analysis, but it's buried among many features **and** it only looks at a
  single still frame using the model's general knowledge — not certified biomechanics.

**This app does one thing:** submit a photo/video → get certified, actionable form feedback.

## What it does (v1)

1. **Sign up** (required): Google or email/password ship in M1. **Sign in with Apple is added
   the moment an Apple Developer account exists, before TestFlight review** — App Store rules
   require it once a third-party social login (Google) is offered, but that gate is at
   submission, not at M1. Guest mode deferred to v2.
2. **Submit media**: upload a photo/video from library **or** record in-app (with simple framing
   guidance — film from the side for best results), muted (no microphone permission is ever
   requested). Max clip length **15s**; max upload size **50MB** pre-compress, enforced before
   the client extracts frames. Before the first-ever upload, a one-line consent notice appears
   ("your photo/video is stored privately until you delete it; frames are sent to our AI
   provider for analysis"), with the same disclosure repeated in Settings.
3. **Analyze**, tiered by subscription:

| Tier | Analyses | Frames analyzed | Depth |
|------|----------|------|-------|
| **Free** | 1 total (lifetime, to try) | 1 frame from a photo, or the same 5-frame stride burst as Pro from a video (decided 2026-09-19, issue #89 — was "one frame from video") | Certified PACE scores + feedback, no drills |
| **Pro** | 10 / month | 5 frames from video | Full PACE analysis, injury-risk flags, suggested fix drills — **more detailed** feedback than Free |
| **Elite** | 30 / month | 8 frames from video | Everything in Pro **plus** more frames analyzed per video, side-by-side progress comparison vs a past analysis, deeper drill programming — **slightly more detailed still** than Pro |

### Detail gradient (Free → Pro → Elite)
The analysis gets richer as the tier goes up — but the step from Pro to Elite is intentionally
**small** (a tiny fraction more detail), so Elite's real draw is quantity + comparison, not a
night-and-day quality jump:
- **Free** — the four PACE scores and a short line of feedback per pillar. No drills.
- **Pro** — fuller per-pillar feedback, injury-risk flags, and 1–2 corrective drills per issue.
- **Elite** — same as Pro plus a bit more depth per pillar (an extra cue or two, slightly longer
  drill programming) and the progress-comparison view. *Implementation: a small prompt/verbosity
  bump between Pro and Elite, not a different analysis.*

4. **Analysis engine — the core**: Claude vision reads the **certified PACE knowledge files**
   (copied into the app) *before* analyzing, then scores the runner across the four PACE pillars:
   - **P**osture — trunk lean, head position, pelvis
   - **A**rm swing — carriage, cross-body motion, symmetry
   - **C**adence — step rate, overstriding
   - **E**lasticity — ground contact, bounce, reactive strength
   For each pillar: a score, specific feedback, and (paid) drills to fix issues. Injury-risk
   flags surface overstriding, hip drop, etc.
5. **Results view**: per-pillar scores + feedback + drills; overall summary. If the model's
   response didn't fully validate, an honest **partial** result (≥2 pillars parsed) is shown
   clearly labelled as partial, rather than a fabricated full result; if fewer than 2 pillars
   parsed, the user sees a clean failure instead. Neither burns quota — up to 3 free retries are
   allowed per period against prompt-injection farming.
6. **Past Analyses tab**: analyses are **kept by default** (result + the analyzed frames, shown
   as a frame strip — no video is stored, only the frames Claude actually analyzed) and are
   re-openable here; free user sees their single result. **The user can delete any analysis** —
   deleting removes both the stored result and its frames. Retention is the user's choice: keep
   it in Past Analyses, or delete it.
7. **Dummy paywall** (v1): same pattern as V2.2 / Echo — fake payment gates Pro/Elite.

## User flow (v1)

```
Launch → Sign up / Log in
      → Home: "Analyze my form" + tier status (e.g. Pro: 7 of 10 left this month)
      → Pick source: Upload  or  Record (side-on framing guide)
      → [paywall if over quota/tier]
      → Uploading / extracting frames… → Analyzing… → Results (PACE scores, flags, drills)
      → Tab 2: Past Analyses (list → past result; swipe/tap to delete)
      → Settings: account, subscription (dummy)
```

Two tabs + a stack: **Home/Analyze** and **Past Analyses**, plus Settings. Deliberately small.

## Milestones & definition of done

- **M1 — Foundation**: Expo app, Supabase project, required sign-up (Google + email now; Apple
  added the moment an Apple Developer account exists, before TestFlight review).
  *Done when: a new user can create an account and land on an empty Home.*
- **M2 — Capture**: upload-from-library and in-app record both produce a usable photo/video
  within the 15s clip / 50MB caps.
  *Done when: both sources hand off a valid file to the analysis step on iOS.*
- **M3 — Knowledge grounding**: the 3 certified `knowledge/` files (adapted from 4 Echo source
  files) are in place and injected into the analysis prompt.
  *Done when: the analysis prompt provably includes the PACE framework text and the model's
  output references PACE pillars, not generic advice.*
- **M4 — Analysis engine**: photo → still analysis; video → multi-frame motion analysis (1/5/8
  frames for Free/Pro/Elite); results parse into 4 PACE pillars + flags + drills; a validation
  failure never reaches the user as a fabricated result — it becomes a clearly-labelled partial
  (≥2 pillars parsed) or a clean failure, and neither burns quota.
  *Done when: a side-on photo and a side-on running clip each return a complete, valid PACE
  result, and a validation failure degrades honestly instead of fabricating one.*
- **M5 — Tiers & quotas**: dummy paywall; tier + analysis quota enforced server-side via an
  atomic reserve-then-deliver RPC (never charged before the model call succeeds).
  *Done when: quota can't be bypassed by the client and the paywall shows at the right moments.*
- **M6 — Past Analyses**: results + the analyzed frames persist and re-open after app restart
  (frame strip via short-TTL signed URLs, no video); user can delete an analysis and its frames.
  *Done when: every analysis is retrievable later, and deleting one purges both its result row
  and its stored frames.*
- **M7 — Polish & TestFlight**: framing guidance, empty/error/loading states, icon/splash, build.
  *Done when: a stranger can go sign-up → analysis → result without a dead end.*

## v2 (after launch learnings)

- **Real payments** (IAP) — required for public App Store release; dummy is TestFlight-only.
- **Guest account** — try one analysis without signing up, then prompt to save.
- **Deeper motion** — pose estimation / joint-angle extraction if Claude-vision-on-frames is
  too coarse for Cadence/Elasticity.
- Progress tracking / trends across analyses for everyone (Elite-only comparison in v1).
- Share/export a result.
