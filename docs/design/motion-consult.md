# Motion consult — Phase 0.5 addendum to the design brief §6

> Produced 2026-07-11 by the `motion-animation` consult (Phase 0.5 step 3 of
> `docs/mvp-build-prompt.md`). Verdict: **every motion in brief §6 is implementable with the
> already-installed stack** (Reanimated 4.1.1, gesture-handler 2.28, worklets 0.5.1, RN 0.81
> `transformOrigin`, native-stack `animation: 'fade'`) — **no new dependencies**. The gaps below
> are adopted as spec; `frontend-builder` treats this file as binding alongside brief §6.

## Implementation notes (binding for `frontend-builder`)

1. **Pillar bar fill = `scaleX`, never width.** Fixed-width fill view with
   `transformOrigin: 'left'`, animate `scaleX` 0→score via
   `withDelay(i * 50, withSpring(...))` per bar. Width animation is layout-thrashing and
   violates the transform/opacity-only rule.
2. **Overall numeral count-up** (first reveal only): `useAnimatedProps` on a disabled
   `TextInput` driven by a shared value + `withTiming` — off the JS thread. Never per-frame
   `setState`. IBM Plex Mono's tabular figures keep the width stable.
3. **First-reveal vs history-reopen flag:** ephemeral only — a nav param / in-memory signal set
   immediately after the analyze call succeeds (e.g.
   `router.replace('/result/[id]', { params: { justAnalyzed: '1' } })`). Never derived from
   AsyncStorage or a DB field, so it can't replay after relaunch nor suppress a genuine first
   view. Re-open from history sets shared values straight to target (no animation).
4. **Reveal trigger = first-visible, not on-mount.** Fire the readout reveal via
   `onLayout`/viewability when the bars first enter the viewport — preserves the "earned
   moment" on small devices where the hero pushes the readout below the fold, and is the same
   trigger indirection a post-MVP scroll-linked reveal needs.
5. **Results screen scroll container:** build on Reanimated's `Animated.ScrollView` +
   `useAnimatedRef` from day one (zero effects wired now) so the post-MVP scroll-driven phase
   is additive, not a container swap.
6. **Swipe-to-delete (Past Analyses):** gesture-handler-driven `translateX`, position-tracking
   and interruptible by construction. Gesture-driven 1:1 direct manipulation is exempt from
   reduced-motion policy (same category as scrolling); no separate fallback needed — stated
   here so the silence isn't read as an omission.

## The wait state — V2.2's honesty mechanic, restated (the rule §6 references but omits)

The analysis is ONE atomic 20–60s vision call — there are no real backend sub-phases. The step
list is therefore explicitly client-side pacing, and it must follow V2.2's mechanic exactly:

- Short fixed step list (e.g. "Reading your form" → "Scoring the four pillars" →
  "Finalizing your read"), each with a fixed client-side floor (V2.2 precedent: ~400ms/step).
- **Reveal gates on BOTH the step timeline finishing AND the response arriving — whichever is
  later.** Response lands early → remaining steps still play at normal cadence, never
  accelerated or skipped.
- Steps finish first (the expected path) → last step stays lit, steady, non-pulsing; after a
  ~1.5–2s dwell, fade in once (never loops): *"Still analyzing — a full read takes a moment."*
- The captions must never be presented or implemented as if they track real backend phases.

**Contrast:** screen 5's upload % and "Extracting frames n/N" are REAL counts from real events
(upload progress callback, frame-loop index) — build those from actual state, and do not build
the atomic-call step list the same way (no advancing on elapsed time as if it were N real units
of work).

## Reduced-motion coverage (complete map)

| Motion | Variant |
|---|---|
| Result reveal (fill + stagger + count-up) | Single crossfade, no stagger, no count-up (per §6) |
| Stack push transitions | Android: forced `animation: 'fade'` via `useReducedMotion()`; iOS: native automatic (QA on-device — iOS keys this to "Prefer Cross-Fade Transitions", a distinct setting) |
| Wait-state step list (ring→dot, dwell line) | **Keep as-is** — low-amplitude, single-shot, opacity/color-only functional state signaling (V2.2 precedent: reduced motion targets vestibular triggers, not state indicators) |
| Real-progress bars (upload %, frame n/N) | **Keep as-is**, same reasoning |
| Compare screen (two stored results) | The "re-open from history renders instantly" rule applies here too — no reveal animation |
| Swipe-to-delete | Exempt (gesture-driven 1:1 tracking) |

## Handoffs

- `doc-writer`: brief screen 6 cites "build prompt Ruling 15" (Retry/Cancel must never trap the
  user) — the build prompt's rulings end at 14. Dangling cross-reference; reconcile.
