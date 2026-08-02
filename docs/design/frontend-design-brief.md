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
(warm "needs work" → cool "strong"), not V2.2's intensity ramp. The base is a **blue/violet night**
carried by a continuous page gradient (the Calm scheme, adopted 2026-08-02 — §2), which frames real
photographic content without competing with it. The signature mark is the annotated frame, not
abstract bars.

> Superseded: this paragraph previously described the base as a *warm graphite/bone*. That palette
> was replaced wholesale on 2026-08-02; only the sentence above changed here, and §2 carries the
> full detail. The rest of §1's concept — the annotated gait plate — is unaffected.

---

## 2. Tokens

> All values below are the design intent. **The design-system agent must verify every foreground/
> background pair against WCAG AA (4.5:1 text, 3:1 non-text) before shipping and darken/lighten to
> pass** — exactly as V2.2 did (it caught four effort hues failing 3:1). Do not assume these pass;
> prove it. Put them in `constants/theme.ts` as light+dark; **no hardcoded colors in components.**

> **Palette swapped 2026-08-02 — the Calm colour scheme.** The warm graphite/bone base described
> below in earlier revisions is retired. Every colour in this section is now either sampled from
> the Calm reference capture (`V2.3-Calm-Design-References-calm-screens.png` — splash, home, audio
> player, content detail, flow index) or computed from a sampled value by holding its hue and
> saturation and moving only lightness until the WCAG floor cleared. **Colours only:** the type,
> spacing, radius and motion sub-sections below are unchanged, and `Radius.card: 0` still stands.
> The shipped values are exactly what `constants/theme.ts` exports; the achieved ratios are quoted
> at each token there and recomputed on every run by `constants/__tests__/theme-contrast.test.ts`.

### Base (Calm blue/violet — dark is the native mode)

Calm ships **two registers**, and both are represented. The blue→periwinkle→violet wash is a page
**backdrop** (`Gradient.page`, below); the flat, contrast-bearing `bg`/`surface` roles take Calm's
**night canvas** — the register its audio-player and index screens sit on — carrying the periwinkle
cast the gradient establishes. Putting the bright mid-gradient blue in `bg` was tried and rejected:
it lifts `surface.raised` far enough that the ≥4.5:1 floor for score-band text lands above pure
green's luminance, which makes four distinguishable score hues arithmetically impossible.

Light is **derived, not invented** (Calm has no light mode): same hue family, inverted lightness —
surfaces tinted toward Calm's sky blue, text in the same deep blue-violet as dark mode's canvas.

| Token | Dark | Light | Use |
|---|---|---|---|
| `bg` | `#0F1324` | `#E9EFFA` | App background |
| `surface` | `#161A30` | `#F4F7FC` | Cards, sheets |
| `surface.raised` | `#1C213A` | `#FFFFFF` | The one raised element per screen |
| `text.primary` | `#FFFFFF` | `#131832` | Headlines, scores |
| `text.secondary` | `#97A3C4` | `#4E5A7A` | Labels, captions (≥4.5:1: 6.29–7.33 / 5.93–6.85) |
| `hairline` | `#2C3350` | `#CBD5EA` | Rules, ticks, annotations (decorative; held under 3:1) |
| `control.border` | `#6B77A0` | `#7986A6` | Non-accent button/input/checkbox edge (≥3:1, issue #96) |

**Pure white is rationed**, exactly as the reference rations it: `text.primary` in dark mode, and
the one primary action pill (`accent.onAccent`). Secondary text is the same white family at reduced
weight — a periwinkle-tinted light blue, not a separate grey hue. `surface`/`surface.raised` are
the reference's translucent white-on-blue glass resolved to solids (~5% and ~10% white over `bg`);
they stop short of Calm's full 12–18% because anything lighter breaks the accent's 3:1 floor
against `surface.raised`.

### The page gradient (new — Calm's identity is the gradient)

| Token | Dark (top → bottom) | Light (top → bottom) |
|---|---|---|
| `gradient.page` | `#2F6394` → `#3B4A96` → `#472E86` | `#DCE8FA` → `#E0E2FA` → `#E9E0FA` |

One role, because one role is all any screen here consumes — no speculative `card`/`hero`/`overlay`
variants. Dark stops are sampled off the reference's **content** screens, not the splash: the
splash's sky-blue top carries white text at only 2.28:1, and Calm only gets away with it because
the sole thing on it is one line of decorative low-opacity copy.

**Contract: `gradient.page` carries `text.primary` only** (6.30 / 8.06 / 10.48 dark; 14.09 / 13.64 /
13.71 light). Secondary text, score fills and score text go on a surface, never on the wash — which
is also how the reference behaves: one white headline on the gradient, everything else on a glass
card.

### The score scale (the palette-is-information — pair with band word + bar length, never color alone)

Retuned for the cool base. Each band keeps its semantic identity but moves into the cool register:
saturation pulled into the 50–60% range the rest of the palette lives in, lightness re-solved per
scheme. The four bands are **not** collapsed into shades of one hue — the product *is* colour-coded
scoring. Shipped hue separations are all ≥30° and every one is wider than the warm ramp's (whose
`good`/`strong` sat 5° apart).

| Band | Token | Hue | Dark fill / text | Light fill / text | Score |
|---|---|---|---|---|---|
| Needs work | `score.low` | coral 14° | `#DC8B72` / `#D6775A` | `#D06545` / `#AE4A2C` | 0–49 |
| Developing | `score.mid` | gold 44° | `#C09B33` / `#AF8D2E` | `#A0812B` / `#7F6622` | 50–69 |
| Solid | `score.good` | teal 178° | `#2FB1AC` / `#2BA19D` | `#279390` / `#1F7472` | 70–84 |
| Strong | `score.strong` | jade 145° | `#3CB56E` / `#37A464` | `#32965C` / `#287749` | 85–100 |

Rather than nudging each band to the bare minimum it can clear — which yields four bands of wildly
different visual weight, since red is naturally dark and gold naturally light — every band is solved
to a **common target ratio per role**: dark `fill` 6.50:1 on `surface`, dark `text` 5.00:1 on
`surface.raised`, light `fill` 3.20:1 on `bg`, light `text` 4.75:1 on `bg`. Each target sits above
its WCAG floor with real margin, so the four read as one scale and nothing is shaved to the wire.

Warm→cool still maps to bad→good intuitively. It is **caution, not alarm** — "needs work" is coral,
not a fire-engine red; this app improves runners, it doesn't scold them.

### Semantic roles (issue #24)

| Token | Dark | Light | Use |
|---|---|---|---|
| `error` | `#DE6B99` | `#C22A67` | System/auth errors — a foreground role only, ≥4.5:1 |

Rose-crimson at hue ~336°, a distinct hue **family** from `score.low`'s coral (~14°) rather than a
different lightness of it — 38° apart, wider than the 25° the warm palette shipped, so a system
error can never be mistaken for the "Needs work" band it used to borrow. Solved to the same shared
targets the bands use, so it never out- or under-shouts a band beside it.

### One accent (reserved, single-use)
| Token | Value | Use |
|---|---|---|
| `accent` | periwinkle-violet `#7558E8` | The primary CTA and *only* the primary CTA. Deliberately outside the score scale so a button is never mistaken for a score. Signal blue `#2F6BEB` is retired — on a blue canvas, a blue CTA is not an accent. |

Sampled from the reference's violet glow (the streak ring, the active tab pill: `#9988F7`/`#A9A5F8`/
`#B1A3F9`). It ships **darker than the reference**, and that is forced rather than preferred: white
on the fill must clear 4.5:1 (caps it at L_rel ≤ 0.1833) while the fill must clear 3:1 against
`surface.raised` (floors it at ≥ 0.1492). Calm's literal `#9988F7` carries white at only 2.92:1 —
it puts a small white glyph on that pill and does not meet AA there. Holding hue and saturation and
moving only lightness lands `#7558E8` inside the band with margin on both sides (white 4.86:1;
3.25–4.86:1 across all six surfaces).

### Type (roles; install via `@expo-google-fonts/*`)
- **Display / numerals:** a grotesque — recommend **Archivo** (or Space Grotesk). Distinct from
  V2.2's Barlow Condensed. Used for screen titles and the big score numerals.
- **Body / UI:** **Inter** (shared with the family — neutral, proven).
- **Mono:** **IBM Plex Mono** — for the measured score readouts and any pace/metric text, the
  "instrument" signal carried over from V2.2.
- **Prose:** **Newsreader** — coaching feedback and drill instructions ONLY, never UI chrome
  (amended 2026-07-26, spec `docs/superpowers/specs/2026-07-26-redesign-design.md` §3.2).
- Scale: 32 / 24 / 20 / 17 / 15 / 13. Support Dynamic Type — never hard-clip at a fixed size.
- Scale amended 2026-07-26: the six steps above are joined by `display 64` and `hero 96`, for at
  most ONE element per screen. The original 13→32 range (2.5×) is why no screen had hierarchy.

### Spacing / radius / motion
- Spacing ramp `4 · 8 · 12 · 16 · 24 · 32 · 48`, plus `editorial 96` for the single large gap on a
  result (amended 2026-07-26). Radius: **`0` cards** (amended 2026-07-26 — sharp reads as document,
  rounded reads as app), `12` sheets, `999` pills.
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
   Cancel** — Retry/Cancel must never trap the user; every error state needs an exit.
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

### 6.1 The motion budget (amended 2026-07-26)

Exactly three moments in this app animate: the app-launch intro, the first-run intro, and the
result reveal. **Nothing else animates.** No ambient motion, no decorative transitions, no
per-word reveals, no marquees or tickers.

This is a budget, not a guideline. Unwritten, "three moments" becomes the first three of eleven.
Phase 1 (the static layer) added none of them. All three are now built (amended 2026-07-29, plan
`docs/superpowers/plans/2026-07-29-redesign-phase-2-animated-moments.md`, spec §4): the app-launch
ground rule (`components/launch-intro.tsx`), the first-run intro (`components/first-run-intro.tsx`),
and the result reveal's hero annotations (`components/duotone-frame.tsx` + `components/pace-
readout.tsx`'s `revealReady` sequencing) — all three built on the single
`components/annotation-lines.tsx` primitive, with zero net-new runtime dependencies. The budget
stays closed at three — nothing else in this app animates.

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
