# V2.3 Redesign — Phase 2 (The Three Animated Moments) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the three animated moments spec `2026-07-26-redesign-design.md` §4 names — app
launch, first run, result reveal — as one motif (three hairline annotations: ground rule, posture
line, landing marker) drawn on by one primitive, with zero new runtime dependencies.

**Base:** branched off `main` at `3537118` (Phase 1, merged via PR #159/#158, is already live
there — the device-verified branch, not this repo's earlier unmerged `feat/v23-redesign-phase-1`,
which is superseded and left alone). Phase 1's tokens (`FontSize.hero`, `Radius.card: 0`,
`Spacing.editorial`, `DuotoneFrame`, `NotchedCard`) are all in place and untouched by this plan.

**Read before starting:** `docs/superpowers/specs/2026-07-26-redesign-design.md` §4 (the contract),
`components/pace-reveal.tsx` (the existing animation and its documented discipline —
`AnimatedPillarBarFill`'s scaleX pattern is reused verbatim), `hooks/use-reduced-motion.ts`
(already exists, already used by `app/_layout.tsx` and `components/pace-readout.tsx` — do not
write a second one).

## Global Constraints

- **`react-native-svg` is NOT installed and must NOT become a dependency.** Every hairline is a
  plain `View`. "Drawing it on" is `scaleX`/`scaleY` 0→1 with `transformOrigin` at the growth edge;
  angle is a static `rotate` transform — exactly `pace-reveal.tsx`'s documented "Pillar bar fill =
  scaleX, never width" pattern, because a transform never triggers a layout pass.
- **Net new runtime dependencies: zero.** If a task seems to need one, stop and report instead of
  adding it.
- **`components/annotation-lines.tsx` is the single primitive.** It renders 1–3 hairlines and
  draws them on, once, on demand. It knows nothing about launch, first run, or results — each
  caller owns its own *when*; the primitive owns only the *how*. This is what keeps three moments
  from becoming three animations.
- **Reduced motion:** every moment collapses to a single crossfade, via the existing
  `useReducedMotion()` hook. No second reduced-motion mechanism.
- **Never replay.** A component that has already played its one-time reveal must not replay it on
  a warm start (backgrounding/foregrounding) or on re-open. Follow `pace-reveal.tsx` /
  `pace-readout.tsx`'s existing `revealed` ref-guarded pattern.
- **Interruptible (moment 1 only).** A tap during the launch moment skips straight to content.
- **First run must not gate sign-in** — the first-run intro is a device/install-scoped flag
  (AsyncStorage, like `lib/pending-analysis.ts`'s marker), never an account/consent fact
  (`lib/consent.ts`'s server-backed model does not apply here — this must work before a session
  exists).
- **Pinned to Expo SDK 54.** Do not upgrade anything.
- Verification commands: `npm run typecheck` · `npm test` · `npx jest <path>` for a single suite.
- Known pre-existing flake, NOT caused by this work: `app/analyzing.tsx:180` can emit an `act()`
  warning failure on an isolated `npx jest` run and pass on a re-run.
- **Do not commit until a task is green. Do not push. Do not open a PR.**
- **Touch only what this plan names.** No drive-by cleanups.

---

## Architectural notes (read before Task 5 especially)

**The hero's three hairlines are fixed geometry, not real per-joint landmarks.**
`app/result/[id].tsx`'s current header already states why: `@shared/pace` carries no coordinate
data, and inventing overlay geometry the contract doesn't provide would be fabrication. So the
ground rule / posture line / landing marker render at the same fixed, generic relative positions
on every hero frame (the same "art geometry, not layout" choice `components/framing-guide.tsx`
already made for its own figure). This means the three lines are **permanent decoration on the
hero**, on every result view, first or repeat — Task 5 does not add a `firstReveal`-only overlay
that disappears afterward. What's one-time is the *drawing-on* transform: `firstReveal` plays the
0→1 scale animation once; every other render (re-open from history) mounts the same lines already
at scale 1, statically, with zero Reanimated import in that path — matching
`pace-readout.tsx`'s own `instant` mode discipline.

**Sequencing for moment 3:** spec §4 is explicit that the annotations draw first, "then the
existing bars fill." Today `PaceReadout`'s reveal triggers off its own `onLayout`. Task 5 changes
the trigger for the `firstReveal` case only: the pillar/numeral reveal now waits for the hero's
annotation-lines to finish drawing (an `onAnnotationsComplete` callback threaded down from
`app/result/[id].tsx`), not just layout. The non-`firstReveal` path (`instant` mode) is completely
unaffected — it never waits on anything.

**Home's "empty state figure outline"** (brief §4 screen 2) is a separate, not-yet-built piece of
UI unrelated to this plan's "first run" moment — this plan's moment 2 fires once, ever, as its own
overlay (reusing `FramingGuide`'s figure as its backdrop), not as a permanent addition to Home.
Building a permanent empty-state figure on Home is out of scope here; not named by this plan.

---

## File Structure

| File | Responsibility |
|---|---|
| `components/annotation-lines.tsx` | CREATE — the one animation primitive: 1–3 hairlines, drawn on via scaleX/scaleY, reduced-motion aware |
| `components/__tests__/annotation-lines.test.tsx` | CREATE |
| `lib/first-run.ts` | CREATE — AsyncStorage-backed once-per-install marker |
| `lib/__tests__/first-run.test.ts` | CREATE |
| `components/launch-intro.tsx` | CREATE — moment 1: the ground rule alone, ≤400ms, interruptible |
| `components/__tests__/launch-intro.test.tsx` | CREATE |
| `components/first-run-intro.tsx` | CREATE — moment 2: all three lines onto `FramingGuide`'s figure, ~2000ms |
| `components/__tests__/first-run-intro.test.tsx` | CREATE |
| `app/_layout.tsx` | MODIFY — mount `LaunchIntro` then (conditionally) `FirstRunIntro` above the Stack |
| `components/duotone-frame.tsx` | MODIFY — render the fixed-geometry annotation lines over the hero, drawn on once when told to |
| `components/__tests__/duotone-frame.test.tsx` | MODIFY — extend for the new props |
| `components/pace-readout.tsx` | MODIFY — reveal trigger accepts an external "ready" signal, not just its own layout |
| `components/__tests__/pace-readout.test.tsx` | MODIFY — extend |
| `app/result/[id].tsx` | MODIFY — thread the hero's annotation-complete callback into `PaceReadout`'s reveal gate |
| `docs/design/frontend-design-brief.md` | MODIFY — record that the three budgeted moments are now built |
| `docs/change_log.md` | MODIFY — dated entry |

---

### Task 1: The annotation-lines primitive

**Files:**
- Create: `components/annotation-lines.tsx`
- Test: `components/__tests__/annotation-lines.test.tsx`

**Interfaces:**
- Consumes: `Colors`, `Motion` from `constants/theme`; `useReducedMotion`
- Produces: `<AnnotationLines lines={AnnotationLine[]} play={boolean} onComplete?={() => void} testID?={string} />`, where each `AnnotationLine` is `{ id: string; top: string|number; left: string|number; width: string|number; rotate?: string }` — a hairline's fixed position/angle, supplied by the caller (this primitive invents no geometry itself).

**Why:** one primitive, reused by all three moments, is what stops "three moments" from becoming
three separate animation implementations. It knows nothing about launch, first run, or results.

- [ ] **Step 1: Write the failing test**

Create `components/__tests__/annotation-lines.test.tsx`:

```tsx
/**
 * The one animation primitive (spec 2026-07-26 §4/§5). Locks: it renders exactly the lines it's
 * given, they're hidden from the a11y tree (purely decorative — brief §7), `play=false` renders
 * them already at full scale with no growth (the "re-open renders finished" case), and reduced
 * motion collapses to `onComplete` firing without a staggered per-line draw.
 */
import { render, screen } from '@testing-library/react-native';

import { AnnotationLines, type AnnotationLine } from '../annotation-lines';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: jest.fn(() => false) }));

const LINES: AnnotationLine[] = [
  { id: 'ground', top: '80%', left: '10%', width: '80%' },
  { id: 'posture', top: '20%', left: '48%', width: '60%', rotate: '90deg' },
  { id: 'landing', top: '75%', left: '60%', width: '12%', rotate: '30deg' },
];

describe('AnnotationLines', () => {
  it('renders one hairline per supplied line', () => {
    render(<AnnotationLines lines={LINES} play={false} testID="lines" />);
    expect(screen.getByTestId('lines-ground', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('lines-posture', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('lines-landing', { includeHiddenElements: true })).toBeTruthy();
  });

  it('hides every line from assistive technology — purely decorative', () => {
    render(<AnnotationLines lines={LINES} play={false} testID="lines" />);
    expect(
      screen.getByTestId('lines-ground', { includeHiddenElements: true }).props.accessibilityElementsHidden
    ).toBe(true);
  });

  it('renders already fully drawn when play=false (the re-open, no-animation case)', () => {
    render(<AnnotationLines lines={LINES} play={false} testID="lines" />);
    const node = screen.getByTestId('lines-ground', { includeHiddenElements: true });
    const style = Array.isArray(node.props.style) ? Object.assign({}, ...node.props.style) : node.props.style;
    expect(style.transform).toEqual(expect.arrayContaining([{ scaleX: 1 }]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest components/__tests__/annotation-lines.test.tsx`
Expected: FAIL — `Cannot find module '../annotation-lines'`.

- [ ] **Step 3: Write minimal implementation**

Create `components/annotation-lines.tsx`. Each line is a 1pt `View`, absolutely positioned per its
`top`/`left`/`width`/`rotate`, whose `scaleX` (or `scaleY` for a vertical line — decide from
whether `rotate` is near-vertical) animates 0→1 via `withTiming` when `play` flips true, or is
static at 1 when `play` is false. `transformOrigin` is set to the growth edge (`'left'` for a
horizontal/rotated line). Reduced motion (`useReducedMotion()`): skip the timed grow and set scale
to 1 immediately, still firing `onComplete` once. Mirror `pace-reveal.tsx`'s `useSharedValue` +
`useAnimatedStyle` pattern exactly; do not invent a different animation approach.

`onComplete` fires once, after the slowest line's `withTiming` resolves (Reanimated's
`withTiming(1, config, (finished) => { if (finished) runOnJS(onComplete)() })` on whichever line is
given the longest duration, or a single shared duration for all three — caller passes the duration
via `Motion.duration` tokens, this primitive does not invent a new one).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest components/__tests__/annotation-lines.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/annotation-lines.tsx components/__tests__/annotation-lines.test.tsx
git commit -m "feat(motion): AnnotationLines — the one primitive behind all three moments

Renders 1-3 fixed-geometry hairlines as plain Views, drawn on via scaleX/scaleY
(pace-reveal.tsx's existing pattern — a transform never triggers layout). Knows
nothing about launch, first run, or results; each caller owns its own when."
```

---

### Task 2: The first-run marker

**Files:**
- Create: `lib/first-run.ts`
- Test: `lib/__tests__/first-run.test.ts`

**Interfaces:**
- Consumes: `@react-native-async-storage/async-storage`
- Produces: `hasSeenFirstRun(): Promise<boolean>`, `markFirstRunSeen(): Promise<void>`

**Why:** the first-run intro fires once per install, not once per account — it must work before
a session exists (brief: "First run must not gate sign-in"), so it cannot be
`lib/consent.ts`'s server-backed, account-scoped model. Plain `AsyncStorage`, same reasoning
`lib/pending-analysis.ts`'s header already gives for its own marker: device-scoped, non-secret,
survives a process restart.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/first-run.test.ts` (mock `@react-native-async-storage/async-storage`, same
convention as `lib/__tests__/pending-analysis.test.ts` if that mock pattern already exists — check
it first and reuse rather than reinvent):

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hasSeenFirstRun, markFirstRunSeen } from '../first-run';

describe('first-run marker', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('defaults to not-seen on a fresh install', async () => {
    expect(await hasSeenFirstRun()).toBe(false);
  });

  it('is seen after being marked', async () => {
    await markFirstRunSeen();
    expect(await hasSeenFirstRun()).toBe(true);
  });

  it('a corrupt or unreadable stored value fails safe to not-seen, never throws', async () => {
    await AsyncStorage.setItem('pace.firstRunSeen.v1', 'not-json-or-a-boolean');
    await expect(hasSeenFirstRun()).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest lib/__tests__/first-run.test.ts`
Expected: FAIL — `Cannot find module '../first-run'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/first-run.ts`, keyed `pace.firstRunSeen.v1` (version in the key, `consent.ts`'s own
convention, in case the intro's content changes enough to warrant re-showing it later).
`hasSeenFirstRun` never throws — a read failure or corrupt value is treated as `false` (fail safe
to "show it": worst case a returning user sees the intro once more, never worse than that).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest lib/__tests__/first-run.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/first-run.ts lib/__tests__/first-run.test.ts
git commit -m "feat(motion): first-run marker — device-scoped, AsyncStorage, fails safe

Plain AsyncStorage, not lib/consent.ts's server-backed model: the first-run
intro must work before a session exists. A read failure or corrupt value
defaults to not-seen, never throws — worst case the intro shows once more."
```

---

### Task 3: Moment 1 — the app-launch intro

**Files:**
- Create: `components/launch-intro.tsx`
- Test: `components/__tests__/launch-intro.test.tsx`
- Modify: `app/_layout.tsx`

**Interfaces:**
- Consumes: `AnnotationLines`, `Colors`, `Motion.duration`
- Produces: `<LaunchIntro onDone={() => void} />` — renders the ground rule alone, ≤400ms, then
  calls `onDone` once. A tap anywhere skips straight to `onDone`.

**Why:** the risky moment — seen on every cold start by someone who only wants to check their
quota. Frequency sets duration: this is the shortest of the three and the only interruptible one.

**Warm-start safety, by construction, not a flag:** `LaunchIntro` is mounted once by
`RootLayoutNav`, which itself does not remount across background/foreground (only a killed-and-
relaunched process re-mounts it) — so a `useState`/`useRef` "have I already played" guard local to
this component is sufficient; no persistence needed. This mirrors how `justAnalyzed`/`pace-
reveal.tsx`'s `revealed` ref already rely on "no remount = no replay" elsewhere in this codebase.

- [ ] **Step 1: Write the failing test**

Create `components/__tests__/launch-intro.test.tsx`. Assert: renders one `AnnotationLines`
line (the ground rule) with `testID` present; a tap on the overlay calls `onDone`; reduced motion
(`useReducedMotion` mocked `true`) calls `onDone` without needing a tap.

- [ ] **Step 2: Run test to verify it fails** — `Cannot find module '../launch-intro'`.

- [ ] **Step 3: Write minimal implementation**

`LaunchIntro` renders a full-screen `Pressable` (background `Colors[scheme].background`, matching
the splash screen's own background so there is no flash at the handoff — see spec's "Splash
handoff" hazard) containing one `<AnnotationLines lines={[groundRuleLine]} play onComplete={onDone} />`.
The `Pressable`'s `onPress` also calls `onDone` directly (interruptible). Budget the single line's
`AnnotationLines` duration at ≤400ms via a duration prop, not `Motion.duration.slow` (320ms is
closest and already under budget — reuse it rather than inventing a fourth duration token unless
it doesn't fit; if it doesn't, that's a stop-and-report, not a new token invented silently).

- [ ] **Step 4: Run test to verify it passes**.

- [ ] **Step 5: Wire into `app/_layout.tsx`**

In `RootLayoutNav`, add local state `launchDone` (default `false`). Render `<LaunchIntro onDone={() => setLaunchDone(true)} />` layered above the `Stack` (same level as `OfflineBanner`) while
`!launchDone`; render nothing once `launchDone`. Placed AFTER `isReady` gates true (i.e., it
appears the instant the Stack would have first painted — never adds to the fonts/session wait,
only overlays on top of it).

- [ ] **Step 6: Verify the whole suite**

Run: `npm test`. Expected: all suites pass (re-run once if `app/analyzing.tsx:180` flakes — not
this work's fault).

Run: `npm run typecheck`. Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add components/launch-intro.tsx components/__tests__/launch-intro.test.tsx app/_layout.tsx
git commit -m "feat(motion): moment 1 — the app-launch ground rule, <=400ms, interruptible

Mounted once by RootLayoutNav, which itself survives background/foreground —
so 'warm starts are not cold starts' falls out of no-remount, not a persisted
flag. A tap skips straight to content; reduced motion skips straight there too."
```

---

### Task 4: Moment 2 — the first-run intro

**Files:**
- Create: `components/first-run-intro.tsx`
- Test: `components/__tests__/first-run-intro.test.tsx`
- Modify: `app/_layout.tsx`

**Interfaces:**
- Consumes: `AnnotationLines`, `FramingGuide` (its figure, reused as the "empty-state figure
  outline" backdrop — see this plan's architectural note), `lib/first-run.ts`
- Produces: `<FirstRunIntro onDone={() => void} />` — all three lines draw onto the figure over
  ~2000ms, then calls `onDone` and marks itself seen.

**Why:** "here is what the mark is for" — the narrative's second beat, shown once, ever, before
the user has any real result to show it on.

- [ ] **Step 1: Write the failing test**

Assert: renders `FramingGuide`'s figure plus three `AnnotationLines` lines; calls
`markFirstRunSeen()` (mock `lib/first-run.ts`) exactly once when its animation completes; reduced
motion collapses to a single crossfade (no per-line stagger) but still calls `onDone` and marks
seen.

- [ ] **Step 2: Run test to verify it fails**.

- [ ] **Step 3: Write minimal implementation**

Full-screen overlay, `FramingGuide` centered, `AnnotationLines` with all three fixed-geometry
lines (ground rule, posture line, landing marker — same relative positions Task 5 will use over
the hero, since this is a preview of that same visual) drawn on over ~2000ms
(`Motion.duration.slow` staggered per-line, or a single longer duration — pick whichever keeps
this file simple; do not add a new duration token without checking `Motion.duration` first).
`onComplete` calls both `markFirstRunSeen()` and `onDone`.

- [ ] **Step 4: Run test to verify it passes**.

- [ ] **Step 5: Wire into `app/_layout.tsx`**

After `launchDone` flips true, read `hasSeenFirstRun()` once (kicked off in parallel with
`LaunchIntro`'s animation so it has time to resolve — do not add a loading spinner for this read;
if it hasn't resolved by the time `launchDone` flips, treat as "already seen" and skip the intro
rather than blocking — never trap the user waiting on a storage read). If not seen, render
`<FirstRunIntro onDone={...} />` next; otherwise proceed straight to normal content. **This must
not gate the auth check** — `RootLayoutNav`'s existing `session`/`isPasswordRecovery` guard and
the Stack underneath render exactly as they do today regardless of this overlay's state; the
overlay only sits visually on top, same as `LaunchIntro`.

- [ ] **Step 6: Verify the whole suite** — `npm test`, `npm run typecheck`.

- [ ] **Step 7: Commit**

```bash
git add components/first-run-intro.tsx components/__tests__/first-run-intro.test.tsx app/_layout.tsx
git commit -m "feat(motion): moment 2 — the first-run intro, once per install

All three lines draw onto FramingGuide's figure (reused, not rebuilt) over
~2000ms, gated by lib/first-run.ts. Sits visually above the existing
session/auth guard in app/_layout.tsx and never blocks or delays it."
```

---

### Task 5: Moment 3 — the result reveal, on the user's own body

**Files:**
- Modify: `components/duotone-frame.tsx`
- Modify: `components/__tests__/duotone-frame.test.tsx`
- Modify: `components/pace-readout.tsx`
- Modify: `components/__tests__/pace-readout.test.tsx`
- Modify: `app/result/[id].tsx`

**Interfaces:**
- `DuotoneFrame` gains `annotate?: boolean` (render the three fixed-geometry lines at all — true
  on every result, per this plan's architectural note) and `playAnnotation?: boolean` +
  `onAnnotationComplete?: () => void` (the one-time draw-on, `firstReveal` only).
- `PaceReadout`'s reveal trigger changes from "fires on its own `onLayout`" to "fires when told" —
  add a `revealReady?: boolean` prop; when `firstReveal` is true, the existing `onLayout`-driven
  `revealed` state additionally requires `revealReady` (default `true` for every existing call
  site that doesn't pass it, so nothing besides `app/result/[id].tsx`'s `firstReveal` path changes
  behavior).

**Why:** spec §4 moment 3: "all three [lines], on the user's own body, **then** the existing bars
fill." The lines are permanent hero decoration (this plan's architectural note); what's new is
sequencing the existing bar/numeral reveal to wait for them on a first open.

- [ ] **Step 1: Extend `DuotoneFrame`'s test first**

Add cases to `components/__tests__/duotone-frame.test.tsx`: `annotate` renders three lines over
the frame, hidden from the a11y tree; `playAnnotation=false` renders them already fully drawn (no
animation import in that path — mirror `pace-readout.tsx`'s `instant` mode discipline); when
`playAnnotation=true`, `onAnnotationComplete` fires once the draw finishes (use the same
reduced-motion mock pattern Task 1's test uses).

- [ ] **Step 2: Run test to verify it fails**.

- [ ] **Step 3: Implement in `DuotoneFrame`**

Render `<AnnotationLines>` absolutely over the existing `Image`+grade overlay when `annotate` is
true, with `play={playAnnotation}` and the three fixed relative positions (ground rule near the
bottom, posture line vertical through the torso, landing marker near the leading foot — same
positions `FirstRunIntro`'s preview used in Task 4, so the "here it is on you" beat visually
rhymes with "here is what it is for").

- [ ] **Step 4: Run test to verify it passes**.

- [ ] **Step 5: Extend `PaceReadout`'s test, then wire `revealReady`**

Add a case to `components/__tests__/pace-readout.test.tsx`: with `firstReveal` true and
`revealReady={false}`, the reveal does not start even after `onLayout` fires; passing
`revealReady={true}` afterward starts it. Existing tests (no `revealReady` passed) must keep
passing unchanged — this is the default-true contract.

Implement: `revealed` becomes `hasLaidOut && (revealReady ?? true)`, recomputed the same way the
existing `onLayout` handler already gates `revealed` — do not change anything for `instant` mode.

- [ ] **Step 6: Run test to verify it passes**.

- [ ] **Step 7: Wire `app/result/[id].tsx`**

Pass `annotate` (always true) and `playAnnotation={justAnnotated}` + an `onAnnotationComplete`
callback into `DuotoneFrame`; track `[annotationsDone, setAnnotationsDone]`, initialized to `true`
when `!justAnalyzed` (nothing to wait for on a re-open) and `false` when `justAnalyzed` (wait for
the callback). Pass `revealReady={annotationsDone}` into `PaceReadout`.

- [ ] **Step 8: Verify the whole suite**

Run: `npm test` (re-run `app/analyzing.test.tsx` once if it flakes — documented, not this work's
fault). Run: `npm run typecheck`.

- [ ] **Step 9: Commit**

```bash
git add components/duotone-frame.tsx components/__tests__/duotone-frame.test.tsx \
        components/pace-readout.tsx components/__tests__/pace-readout.test.tsx \
        'app/result/[id].tsx'
git commit -m "feat(motion): moment 3 — annotations draw on the hero, then the bars fill

DuotoneFrame always renders the three fixed-geometry hairlines (permanent hero
decoration, per the redesign spec); only the draw-on transform is one-time,
gated by firstReveal. PaceReadout's reveal now waits for that draw via a new
revealReady prop (default true, so every other call site is unaffected)
before starting its own bar/numeral reveal — matching spec 4's 'lines, then
bars' sequencing."
```

---

### Task 6: Record the built moments in the brief and changelog

**Files:**
- Modify: `docs/design/frontend-design-brief.md` (§6.1)
- Modify: `docs/change_log.md`

**Why:** §6.1 currently describes the motion budget as a forward-looking constraint ("Phase 1
adds none of them; they are... built in Phase 2"). Now that they exist, the brief should say so —
CLAUDE.md's own rule ("update docs/change_log.md on every behavior-changing commit").

- [ ] **Step 1: Amend §6.1's closing line** to state the three moments are built, name this
  plan's file, and reiterate the budget is still closed at three — nothing else animates.

- [ ] **Step 2: Append a dated `docs/change_log.md` entry** summarizing the three moments and the
  zero-new-dependency constraint they shipped under.

- [ ] **Step 3: Verify nothing broke** — `npm test` (docs-only change, but the knowledge-bundle
  verify step and full suite still run here).

- [ ] **Step 4: Commit**

```bash
git add docs/design/frontend-design-brief.md docs/change_log.md
git commit -m "docs(design): record Phase 2's three built moments in the brief and changelog

Section 6.1 described the budget as forward-looking; it now names the plan
that built it. Budget stays closed at three -- nothing else animates."
```

---

## Verification checklist for the whole phase

- [ ] `npm run typecheck` clean
- [ ] `npm test` — all suites green
- [ ] Zero new entries in `package.json`
- [ ] Launch intro judged on a real device: does it ever flash against the splash handoff; is a
  tap-to-skip actually reachable and instant
- [ ] First-run intro judged on a real device (fresh install / cleared app data): fires once, never
  again, never blocks reaching sign-in
- [ ] Result reveal judged on a real device: lines draw before bars fill on first open; re-open
  from history renders everything finished instantly, no replay
- [ ] Reduced motion checked for all three moments
