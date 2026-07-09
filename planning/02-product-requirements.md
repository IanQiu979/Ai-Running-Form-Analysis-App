# V2.3 — Product Requirements (Part A: What & Why)

> Status: draft from brainstorm (2026-07-07). Working name TBD (PACE family). Real-launch goal.

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

1. **Sign up** (required): Google, Sign in with Apple, or email/password. (Inherited from V2.2;
   Apple required by App Store rules when Google is offered.) Guest mode deferred to v2.
2. **Submit media**: upload a photo/video from library **or** record in-app (with simple framing
   guidance — film from the side for best results).
3. **Analyze**, tiered by subscription:

| Tier | Analyses | Media | Depth |
|------|----------|-------|-------|
| **Free** | 1 total (to try) | Photo, or video as a single frame | Certified PACE scores + feedback, no drills |
| **Pro** | 10 / month | Photo + real multi-frame video | Full PACE analysis, injury-risk flags, suggested fix drills — **more detailed** feedback than Free |
| **Elite** | 30 / month | Photo + real multi-frame video | Everything in Pro **plus** more frames analyzed per video, side-by-side progress comparison vs a past analysis, deeper drill programming — **slightly more detailed still** than Pro |

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
5. **Results view**: per-pillar scores + feedback + drills; overall summary.
6. **Past Analyses tab**: analyses are **kept by default** (result + the media) and are
   re-openable here; free user sees their single result. **The user can delete any analysis** —
   deleting removes both the stored result and its media. Retention is the user's choice: keep
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

- **M1 — Foundation**: Expo app, Supabase project, required sign-up (Google/Apple/email).
  *Done when: a new user can create an account and land on an empty Home.*
- **M2 — Capture**: upload-from-library and in-app record both produce a usable photo/video.
  *Done when: both sources hand off a valid file to the analysis step on iOS.*
- **M3 — Knowledge grounding**: the 4 certified files are copied in, adapted to PACE, and
  injected into the analysis prompt.
  *Done when: the analysis prompt provably includes the PACE framework text and the model's
  output references PACE pillars, not generic advice.*
- **M4 — Analysis engine**: photo → still analysis; video → multi-frame motion analysis; results
  parse into 4 PACE pillars + flags + drills; malformed responses never reach the user.
  *Done when: a side-on photo and a side-on running clip each return a complete, valid PACE
  result, and a broken model response falls back gracefully.*
- **M5 — Tiers & quotas**: dummy paywall; tier + analysis quota enforced server-side.
  *Done when: quota can't be bypassed by the client and the paywall shows at the right moments.*
- **M6 — Past Analyses**: results + media persist and re-open after app restart; user can
  delete an analysis and its media.
  *Done when: every analysis is retrievable later, and deleting one purges both its result row
  and its stored media.*
- **M7 — Polish & TestFlight**: framing guidance, empty/error/loading states, icon/splash, build.
  *Done when: a stranger can go sign-up → analysis → result without a dead end.*

## v2 (after launch learnings)

- **Real payments** (IAP) — required for public App Store release; dummy is TestFlight-only.
- **Guest account** — try one analysis without signing up, then prompt to save.
- **Deeper motion** — pose estimation / joint-angle extraction if Claude-vision-on-frames is
  too coarse for Cadence/Elasticity.
- Progress tracking / trends across analyses for everyone (Elite-only comparison in v1).
- Share/export a result.
