# V2.3 Redesign — design spec

**Status:** approved in principle (Ian, 2026-07-26). Supersedes nothing; *amends*
`docs/design/frontend-design-brief.md` §2 (tokens) and §6 (motion). The brief's §1 concept
("The Gait Plate"), §3 score-readout system, §5 states and §7 accessibility floor all **stand
unchanged**.

---

## 1. The problem, stated precisely

The app reads as generic — "AI-like" in Ian's words. The brief is not the cause. §1 already bans
AI-glow, glassmorphism, frosted panels and particle fields, and the build honours that.

The cause is that **the tokens have no range**:

| Token | Today | Consequence |
|---|---|---|
| `FontSize` max | `xxl: 32` | Type scale spans 13→32 — a ratio of **2.5×** |
| `Spacing` max | `xxxl: 48` | No editorial whitespace is expressible |
| `Radius.card` | `8` | The universal "app card" radius |
| Accent | one blue `#2F6BEB` | — |
| Body family | Inter | The most default UI typeface in circulation |

Warm graphite + 8pt cards + Inter + a single blue accent + a 32pt ceiling is precisely the median
output of every design-generating model. The brief avoided the *loud* AI tells and landed on the
*quiet* ones. Only two files use `FontSize.xxl` at all, so nothing on screen has typographic
hierarchy worth the name.

**This is a range problem, not a taste problem.** No amount of re-picking colours inside the current
scale can fix it, because the scale itself forbids drama.

---

## 2. Direction

Two moves, deliberately unequal in size:

1. **A mostly-static restyle.** Colour, type, shape, scale. This carries ~80% of the visual change
   and involves no animation, no new runtime dependency, and no new data.
2. **Exactly three animated moments**, all of them the same motif, revealed progressively.

Ian's constraint, verbatim: *"instead of making the app too complicated with like too much
animations I want it to get also straight to the point, but we can still have a cool intro of some
sort."* This lands back on the brief's own §6 ("the one earned moment") and §8 (MVP discipline).

### 2.1 Reference set and what was taken

| Reference | Device taken |
|---|---|
| `landonorris.com` | Cut-out body at large scale on a plain ground; die-cut card shape; one accent used once |
| `breakthroughenergy.org` | Duotone-graded real footage, full-bleed |
| `jeskojets.com` | Content framed by an aperture (informs the capture screen only) |
| `midlife.engineering` | Cited-evidence-with-personality voice |
| `species-in-pieces.com` | Progressive assembly of a figure from primitives |

**Explicitly NOT taken** (evaluated and rejected as fighting "straight to the point"): scrollytelling
the result, per-word prose reveal (it slows reading), marquee tickers (ambient motion, banned by §6),
morph-on-every-swipe in history.

---

## 3. The static layer

### 3.1 Type scale — extend the ceiling

Add display steps above the current ramp. The existing six steps keep their names and values, so
**no existing screen changes by default**:

```
xs 13 · sm 15 · md 17 · lg 20 · xl 24 · xxl 32   (unchanged)
display 64 · hero 96                              (new)
```

Rule: **at most one `display`-or-larger element per screen.** Contrast comes from the gap between
96 and 15, not from many large things.

Applies to: the overall score numeral on a result, and the screen title on Home.

### 3.2 A third type role — prose

Coaching feedback is *writing by a coach*, not UI chrome, and is currently rendered in the same
family as button labels. Add a fourth family role:

```ts
FontFamily.prose = 'a transitional serif'   // candidate: Newsreader / Source Serif / Spectral
```

Used **only** for per-pillar coaching feedback and the drill instructions. All UI chrome stays Inter.
Mono stays IBM Plex Mono for every measured value (§2 of the brief is unchanged on this).

### 3.3 Radius

`Radius.card: 8 → 0`. Sharp corners read as document; rounded read as app. `sheet` and `pill` are
unchanged — a pill is still a pill.

### 3.4 Spacing

Add `Spacing.editorial = 96` for the single large vertical gap that separates a result's hero from
its readout. Existing steps unchanged.

### 3.5 Duotone frames

Every user frame renders duotone-graded into the palette, full-bleed, rather than as a rounded
thumbnail inside a card. This makes photograph and interface **one material** — which is what §1 was
reaching for with "frames real photographic content with restraint."

**Constraint, non-negotiable:** grade toward the warm base. §2 chose warm graphite/bone specifically
because it flatters skin tones. A cold blue grade of the kind Breakthrough Energy uses on machinery
is unflattering and clinical on a human body. If a grade cannot be made flattering across skin tones,
grade the *background only* and leave skin true.

### 3.6 Result card shape

The shareable result is a notched / die-cut rectangle rather than a rounded card. Shape as identity.

---

## 4. The three moments

One motif, three appearances, progressively more meaningful. The motif already exists in brief §4.7:
the three hairline annotations — **ground rule, posture line, landing marker**.

| # | Moment | Frequency | Budget | Content |
|---|---|---|---|---|
| 1 | App launch | every cold start | **≤400ms**, interruptible | The **ground rule** alone: one horizontal hairline draws left→right and becomes the app's first structural line |
| 2 | First run | once per install | ~2000ms | **All three** annotations draw onto the empty-state figure outline |
| 3 | Result reveal | once per analysis | ~1200ms | The same three annotations draw onto **the user's own body** |

Narrative: *the mark exists → here is what it is for → here it is, on you.*

**Governing rule — frequency sets duration.** The more often a moment fires, the shorter it must be.
The launch intro is the risky one: it is seen constantly by someone who only wants to check their
quota.

### 4.1 The motion budget (write this into the brief)

> These three moments animate. **Nothing else in the app animates.** No ambient motion, no
> decorative transitions, no per-word reveals, no tickers.

Unwritten, "three moments" becomes the first three of eleven. This budget is the deliverable, not a
note.

The existing result reveal from §6 (pillar bars filling, 50ms stagger, count-up) is **retained** and
is part of moment 3 — the annotations draw, then the bars fill. It is one moment, not two.

### 4.2 Rules that apply to all three

- **Reduced motion:** each collapses to a single crossfade. Already mandated by §6 and already
  supported — `hooks/use-reduced-motion.ts` exists and is used by `components/pace-readout.tsx`.
- **Never replay.** Moment 3 fires on a result's *first* open only; re-opening from history renders
  finished instantly. This is §6's existing rule and `components/pace-reveal.tsx` already implements
  that discipline for the bars.
- **Warm starts are not cold starts.** Backgrounding and returning must NOT replay moment 1.
- **Interruptible.** A tap during moment 1 skips to content. Never trap a user behind branding.
- **First run must not gate sign-in.**

### 4.3 What this deliberately does not need

The maximalist version of this idea ("The Skeleton Assembles") required per-joint pose landmarks,
which `analyze-form` does not return, and which would have meant adding on-device pose detection
(Apple Vision / MediaPipe) plus `@shopify/react-native-skia`.

**Scoping to the brief's three existing annotation lines removes that dependency entirely.**

Implement the hairlines as **plain `View`s, not SVG**. `react-native-svg` is *not* a dependency of
this project (verified 2026-07-26) and does not need to become one: a hairline is a 1pt `View`, and
"drawing it on" is `scaleX`/`scaleY` 0→1 with `transformOrigin` set to the growth edge. Angle comes
from a static `rotate` transform.

This is the pattern `components/pace-reveal.tsx` already uses and documents — *"Pillar bar fill =
scaleX, never width"* — precisely because a transform never triggers a layout pass. Reusing it keeps
the motion cheap and consistent with the one animation the app already ships.

**Net new runtime dependencies for this entire redesign: none.** Pose detection becomes a possible
future enhancement, not a prerequisite.

---

## 5. Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `constants/theme.ts` | New tokens: `FontSize.display`/`.hero`, `FontFamily.prose`, `Radius.card: 0`, `Spacing.editorial` | — |
| `components/annotation-lines.tsx` (new) | **The one animation primitive.** Renders 1–3 hairline annotations as plain `View`s and draws them on, once, on demand via `scaleX`/`scaleY`. Reduced-motion aware. Knows nothing about launch/first-run/result | Reanimated, `use-reduced-motion` |
| `components/duotone-frame.tsx` (new) | Renders a user frame full-bleed, graded to the palette | expo-image |
| Launch intro (in `app/_layout.tsx`) | Owns cold-vs-warm detection and the splash handoff; renders the primitive with one line | annotation-lines |
| First-run intro | Owns "have I run before" persistence; renders the primitive with three lines | annotation-lines |
| `app/result/[id].tsx` | Renders the primitive with three lines, then the existing `pace-reveal` | annotation-lines, pace-reveal |

The primitive is deliberately ignorant of context. Each of the three callers owns its own *when*;
the primitive owns only the *how*. That is what stops this becoming three animations.

---

## 6. Risks and what they cost

| Risk | Reality |
|---|---|
| **Contrast suite** | `constants/__tests__/theme-contrast.test.ts` is welded to the tokens. Changing colour tokens means re-proving every pair to AA. §7 makes this non-negotiable. Type/radius/spacing changes do **not** affect it |
| **Dynamic Type vs 96pt** | These genuinely fight. The hero numeral needs an explicit clamp-and-reflow rule, not hope. §7 forbids clipping the score readout |
| **Splash handoff** | Expo's splash→first-frame transition is where cold-start flicker bugs live; Echo V1 shipped a real splash-flash bug that needed its own fix. Budget for it |
| **Duotone on skin** | See §3.5. This is the change most likely to look worse, not better |
| **Flaky test in the blast radius** | `app/analyzing.tsx:180`'s async dispatch produced an `act()` warning failure on one run and passed on the next. It is in a file this work touches; expect it and do not mistake it for a regression this work caused |

---

## 7. Phasing

Two implementation plans, in order. Phase 1 is independently shippable and carries most of the
visual change.

**Phase 1 — the static layer.** §3 entirely. No animation, no new dependencies, no new data. Ends
with the app looking substantially different and every test green.

**Phase 2 — the three moments.** §4 entirely. Builds `annotation-lines` once, wires three callers,
adds the motion budget to the brief.

---

## 8. Out of scope

Pose detection; Skia; scrollytelling; per-word reveals; marquee tickers; a new palette (the score
scale and warm base stay); onboarding carousels; any change to §3's score-readout structure or §7's
accessibility floor.
