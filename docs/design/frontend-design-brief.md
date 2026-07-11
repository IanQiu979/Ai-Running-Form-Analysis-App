# V2.3 — Design Brief (MVP)

> **Scope: basic MVP, one document.** Unlike V2.2's two-doc design layer, V2.3 keeps the whole
> design system in this single brief — enough for a builder to execute, no more. It covers tokens,
> the score-readout system, screen-by-screen, states, motion, and the accessibility floor.
>
> **Direction (decided with Ian):** *distinct but related* to V2.2's "Instrument & Matter." Same
> discipline and honesty rules; a different palette and motif tuned to **real photo/video of a
> body**. Score display is **0–100 + band per pillar**. Past Analyses stores **frames only**. Elite
> comparison is a **minimal client-side** two-result view.

---

## 1. The concept — "The Gait Plate"

V2.2 looked like a *lab bench measuring an abstraction* (its hero was the week ribbon, a barcode of
training). V2.3 looks like a **gait-lab plate measuring the runner themselves**: the hero is the
runner's **own frame, marked up** with a few hairline annotations — a ground rule, a posture line, a
landing marker — the way a biomechanics report annotates a capture. The instrument is pointed at a
person now, so the design frames real photographic content with restraint instead of competing with
it.

**Shared with V2.2 (the "related"):** honest motion only (nothing moves unless a real event caused
it); no AI-glow, glassmorphism, frosted panels, or particle fields; mono numerals for anything
measured; hairline structure; works in light and dark.

**New for V2.3 (the "distinct"):** the information is a **score**, so the palette *is* a score scale
(warm "needs work" → cool "strong"), not V2.2's intensity ramp. The base is a **warm graphite/bone**
that flatters skin tones and video rather than V2.2's cool asphalt/chalk. The signature mark is the
annotated frame, not abstract bars.

---

## 2. Tokens

> All values below are the design intent. **The design-system agent must verify every foreground/
> background pair against WCAG AA (4.5:1 text, 3:1 non-text) before shipping and darken/lighten to
> pass** — exactly as V2.2 did (it caught four effort hues failing 3:1). Do not assume these pass;
> prove it. Put them in `constants/theme.ts` as light+dark; **no hardcoded colors in components.**

### Base (warm neutral, distinct from V2.2's cool set)
| Token | Dark | Light | Use |
|---|---|---|---|
| `bg` | `#17150F`… slate-warm ~`#1A1712` | `#F4F1EA` bone | App background |
| `surface` | `#221E17` | `#FBF9F3` | Cards, sheets |
| `surface.raised` | `#2B2620` | `#FFFFFF` | The one raised element per screen |
| `text.primary` | `#F3EEE3` | `#1E1B15` | Headlines, scores |
| `text.secondary` | `#B3AC9C` | `#5A5347` | Labels, captions (verify ≥4.5:1) |
| `hairline` | `#3A342A` | `#DAD3C4` | Rules, ticks, annotations |

### The score scale (the palette-is-information — pair with band word + bar length, never color alone)
| Band | Token | Hue (verify contrast) | Score |
|---|---|---|---|
| Needs work | `score.low` | clay red-orange `#C2603F` | 0–49 |
| Developing | `score.mid` | ochre/amber `#C08A2E` | 50–69 |
| Solid | `score.good` | teal-green `#4E9A7C` | 70–84 |
| Strong | `score.strong` | deep green `#2E7D5B` | 85–100 |

Warm→cool maps to bad→good intuitively. It is **caution, not alarm** — "needs work" is clay, not a
fire-engine red; this app improves runners, it doesn't scold them.

### One accent (reserved, single-use)
| Token | Value | Use |
|---|---|---|
| `accent` | signal blue `#2F6BEB` (verify) | The primary CTA and *only* the primary CTA. Deliberately outside the score scale so a button is never mistaken for a score, and distinct from V2.2's lime so the family reads as siblings, not clones. |

### Type (roles; install via `@expo-google-fonts/*`)
- **Display / numerals:** a grotesque — recommend **Archivo** (or Space Grotesk). Distinct from
  V2.2's Barlow Condensed. Used for screen titles and the big score numerals.
- **Body / UI:** **Inter** (shared with the family — neutral, proven).
- **Mono:** **IBM Plex Mono** — for the measured score readouts and any pace/metric text, the
  "instrument" signal carried over from V2.2.
- Scale: 32 / 24 / 20 / 17 / 15 / 13. Support Dynamic Type — never hard-clip at a fixed size.

### Spacing / radius / motion
- Spacing ramp `4 · 8 · 12 · 16 · 24 · 32 · 48`. Radius: `8` cards, `12` sheets, `999` pills.
- Durations `quick 160ms · standard 240ms · slow 320ms`; curves ease-out (arriving), ease-in
  (leaving), one spring for the score reveal. Honest-motion rule from §6.

---

## 3. The score-readout system (the core component)

Every result is built from one repeated primitive — the **pillar row**:

```
P  Posture                    72 · Solid
   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░        ← bar: fill LENGTH and COLOR both encode the score
```

- **Letter** (P/A/C/E) in the grotesque, `text.primary`.
- **Name** in Inter.
- **Score** as a mono numeral + **band word** — the band word is mandatory, so the score is never
  color-alone (accessibility + honesty).
- **Bar** whose **fill length is proportional to the score** and whose color is the band token.
  Length is the redundant, colorblind-safe channel (the same trick as V2.2's ribbon height).
- **"Not assessed"** state: a hollow bar, the words "Not assessed — film side-on for this," no
  number. Used when the medium couldn't support the pillar (e.g. cadence/elasticity from a photo).

**Overall score:** the four pillars average into one headline number + band at the top of the
result, rendered larger. Below it, the four pillar rows. This four-row block is the **"PACE
readout"** and it is the app's signature screen element.

**Tier density (from `pace_framework.md`):**
- **Free** — overall + four pillar rows + one line of feedback each. No drills. No flags.
- **Pro** — fuller per-pillar feedback, injury-risk flags, 1–2 drills per issue.
- **Elite** — Pro + a touch more cueing depth + the compare view (§4, Past Analyses).

---

## 4. Screens (MVP set)

Route tree already in `docs/architecture.md`. Basic, but every screen names its states.

1. **Sign in / Sign up** — logo, one-line value prop, Google + Apple + email. `accent` on the
   primary button only; sign-up is a text link, not a second button. (Family pattern from V2.2.)
2. **Home / Analyze** — the quota readout ("7 of 10 analyses left this month"; **Free reads "1
   free analysis"** — never "this month"), the single `accent` CTA **"Analyze my form,"** and, once
   there's history, the most recent gait-plate thumbnail. Empty state: a faint annotated-figure
   outline (the motif before it means anything) above the CTA.
3. **Source picker** — two large cards: **Upload** (library) / **Record** (in-app). Below: a one-line
   framing tip.
4. **Capture** — camera preview with a **side-on framing guide** overlay (a faint full-body figure
   outline + "Stand side-on, full body in frame, ~10 m away, level camera, good light"). **Record
   muted** (no mic permission needed). Clip auto-caps at the decided max length (see build prompt).
   States: permission-denied (with a "why we need the camera" line + Settings deep link).
5. **Uploading / Extracting** — honest progress: real upload % for the file, then "Extracting frames
   3 / 6" as `frames.ts` runs. Not theatre — these are real steps with real counts.
6. **Analyzing** — the one genuinely indeterminate wait (the vision call, ~20–60s). Follow V2.2's
   honesty mechanic: a short client-side step list ("Reading your form… Scoring the four pillars…"),
   and after a threshold a calm static line — *"Still analyzing — a full read takes a moment."* No
   fake progress bar, no spinner-forever. If it fails or times out: an error state with **Retry /
   Cancel** (the modal must never trap the user — see build prompt Ruling 15).
7. **Results** — the PACE readout (§3) over a **hero: the runner's annotated frame** (ground rule +
   posture line + landing marker, hairline). Then per-pillar detail (feedback + flags + drills by
   tier), then the **"not medical advice" disclaimer footer** (always). Fallback/partial result:
   a calm banner — "Partial read — we could confidently score N of 4 pillars from this clip" — never
   fabricated scores for the rest.
8. **Past Analyses** — a list of **gait-plate thumbnails** (a representative annotated frame) + date
   + overall score + band. Frames-only storage, so the thumbnail is a stored frame, not a video.
   Tap → the stored result. Swipe/long-press → delete (with confirm; delete purges the row **and**
   its frames — see build prompt Ruling 6). Empty state: the annotated-figure outline + "Your
   analyses will live here."
9. **Compare (Elite, minimal)** — pick two past results; show the two PACE readouts **side by side**
   with the per-pillar deltas (+6 Posture, −3 Cadence…). Pure client-side view of two stored
   results — no new AI call, no extra storage.
10. **Paywall (dummy)** — three tier cards (Free/Pro/Elite), the honest detail-gradient copy (Pro→
    Elite is "more of it + comparison," not a different analysis), dummy "Upgrade" → `purchase-tier`.
11. **Settings** — account, tier + restore, **Sign out**, **Delete account** (purges all media +
    data — the entry point the API's `delete-account` function backs).

---

## 5. States & copy (the checklist a build must hit)

- **Empty:** Home (no history), Past Analyses (no analyses).
- **Loading:** Home quota fetch, Past Analyses list, a result opened cold from history.
- **Error:** upload failed, analysis failed/timed out (Retry/Cancel), over-quota `402` → route to
  paywall, quota-status fetch failed (show last-known or a quiet retry).
- **Offline:** capture works, upload/analyze queue or fail gracefully with a "you're offline" line;
  never claim "saved" when it isn't.
- **Permission-denied:** camera, photo library — each with a rationale + Settings deep link.
- **Consent (first analysis):** one line before the first upload — *"Your photo/video is stored
  privately until you delete it, and frames are sent to our AI provider to analyze."* (Privacy
  detail in Settings.)
- **Disclaimer:** the `pace_framework.md` "not medical advice" line on **every** result, plus the
  stop-running safety language when a flag/ note triggers it.

Copy voice: plain, calm, specific, coaching-not-scolding. "Your foot's landing a bit ahead of you —
here's the fix," never "Bad form detected."

---

## 6. Motion (light, honest)

- **Honest-motion rule (from the family):** nothing animates unless a real event caused it — an
  arrival, a user action, or genuine server work. No idle/ambient motion.
- **Result reveal (the one earned moment):** when a result first opens, the four pillar bars fill
  from 0 to their score once, `standard` duration, a **~50ms stagger** P→A→C→E, one spring settle.
  The overall numeral counts up **only** on this first reveal (it's a real arrival, not a live
  value). Re-opening from history renders finished, instantly — no re-animation (V2.2's repeated-
  motion lesson).
- **Wait states:** real progress for upload/extract; the calm honest step list for the vision call.
- **Reduced motion:** bars appear filled with a single crossfade (no stagger, no count-up); honor
  `isReduceMotionEnabled`; on Android force stack pushes to crossfade when it's set.

---

## 7. Accessibility floor (non-negotiable)

- **Score never by color alone:** always numeral + band word + bar length. A colorblind or
  grayscale user reads the same result.
- **VoiceOver:** each pillar row announces "Posture, 72 out of 100, Solid." The annotated hero has a
  text alt ("your running frame, marked with posture and ground lines"). Decorative annotations are
  hidden from the a11y tree.
- **Dynamic Type:** all text scales; layouts reflow, never clip the score readout.
- **Targets:** 44×44 minimum for every control (delete, edit, tab, CTA).
- **Contrast:** verify all tokens to AA before shipping (see §2). The score hues especially — they
  carry meaning, so they must clear 3:1 as non-text and their band text 4.5:1.

---

## 8. What this brief deliberately leaves out (MVP discipline)

No custom illustration system, no onboarding carousel, no theming beyond light/dark, no animated
mascot, no social/share design (v2), no trends/graphs beyond the Elite two-result compare. The core
loop — **capture → honest wait → PACE readout → keep or delete** — is the whole product. Everything
here serves that loop and nothing else.
