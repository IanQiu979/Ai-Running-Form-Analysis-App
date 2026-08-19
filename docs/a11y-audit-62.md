# Accessibility audit — issue #62 (M7 pass)

Read-only sweep of every screen in `app/` and shared component in `components/` against
the design-brief §7 floor, done via `accessibility-reviewer`° once all M1–M6 screens
existed. Issues #11, #28, #13, #22 (M1-only, already fixed/closed) are out of scope —
not re-litigated here. Findings below were then handed to `accessibility-implementer`.

## The floor (design-brief §7, non-negotiable)

1. 44x44 minimum hit targets
2. WCAG AA contrast (61-assertion Jest token test — already passing, kept green)
3. Dynamic Type: text scales, layouts reflow, never clip
4. Reduced motion honored
5. Every control labelled; decorative elements hidden from the a11y tree
6. Live regions announce on iOS (`useAnnounce`, not `accessibilityLiveRegion` alone —
   that prop is Android-only, see issue #11)

## Defects found → fixed

| # | Severity | File:line | Floor rule | Defect | Fix |
|---|---|---|---|---|---|
| 1 | Blocker | `components/pace-readout.tsx:176-180` (`PillarRow`) | #5 labelling | The row's outer `View` sets `accessible` + one `accessibilityLabel`, which collapses the *entire* row — including `pillar.feedback`, every `flags` pattern/detail, and every `drills` name/instructions — into one opaque VoiceOver/TalkBack node. All paid-tier coaching content (feedback, flags, drills) was structurally unreachable on every result screen and in `app/compare.tsx`. | Scope `accessible`/`accessibilityLabel` to just the header summary block (mirroring `overallBlock`, which genuinely has no children); let feedback/flags/drills render as normal, individually-reachable `Text` nodes. |
| 2 | High | `app/(tabs)/history.tsx:340` (row delete button) | #5 labelling | `accessibilityLabel` was the static string "Delete" for every row — unlike the sibling row-open `Pressable`, which builds a per-row label via `formatHistoryItemA11yLabel`. A screen-reader user couldn't tell which analysis a given Delete button would remove. | Interpolate the same date/score context into the delete button's label. |
| 3 | Medium | `components/consent-gate.tsx:98` | #6 live regions | `useAnnounce` only covered `error`; the `'health'` → `'subject'` phase transition (and `'checking'` → either) silently swapped the whole screen's title/content with no announcement, unlike `app/capture/extracting.tsx`'s pattern of folding every state into one `useAnnounce`. | Announce the active phase's title alongside the existing error announcement. |
| 4 | Medium | `app/analyzing.tsx`, `app/capture/index.tsx`, `app/(tabs)/history.tsx`, `app/(tabs)/index.tsx` (screen titles) | #5 labelling | Screen titles lacked `accessibilityRole="header"` on 4 of 8 titled screens, while `settings.tsx`, `paywall.tsx`, `compare.tsx`, `sign-in.tsx` already had it. Broke VoiceOver rotor heading-navigation on those 4 screens. | Add `accessibilityRole="header"` to match the established pattern on the other 4 screens. |
| 5 | Low | `app/(tabs)/index.tsx` (`pendingReleasedDismiss`) | #1 hit targets | Only `minHeight: HitTarget.min` was set, no `minWidth`, unlike `retryButton`/`settingsButton` in the same file which pair both per the 44×44 floor. | Add matching `minWidth: HitTarget.min`. |

## Verified clean (no findings)

- **Contrast** — no hardcoded/off-token colors found outside `constants/theme.ts`; the
  61-assertion token test remains the source of truth and stays green.
- **Dynamic Type** — no `numberOfLines` truncation or fixed-height clipping found on
  any screen or component.
- **Reduced motion** — only `components/pace-reveal.tsx` (via `components/pace-readout.tsx`)
  and `app/analyzing.tsx` run meaningful animation; both already gate on
  `hooks/use-reduced-motion.ts`'s `useReducedMotion()`. `analyzing.tsx`'s fade is a
  documented, deliberate exemption.
- **Decorative elements** — `components/framing-guide.tsx` already correctly hidden
  from the a11y tree.
- **Hit targets elsewhere** — every other pressable audited against the `HitTarget.min`
  / `hitSlop` convention already established by issues #13/#22 was compliant.

---

# Re-sweep — 2026-08-19

The pass above was done on 2026-07-25. Every screen in `app/` and every shared component in
`components/` has been rewritten or added since (the Calm redesign, #163–#189: `<Aperture>`,
`<KineticText>`, `<LowPolyField>`, `<Marquee>`, `<PillarDetailModal>`, `<FirstRunIntro>`,
`<SampleResultBanner>`, the scroll-reveal sign-in, the restructured result screen). This is a
second sweep of that new surface against the same §7 floor.

**Issues #11, #28 and #62 are all closed, and all three fixes verified as still present** —
`lib/use-announce.ts` exists and is called from 13 screens paired with `accessibilityLiveRegion`
for Android; sign-in's autofill + focus chaining is intact. Nothing below is a re-open of those.
What the redesign did was add new surface that never picked their patterns up.

## Defects found → fixed

| # | Severity | File | Floor rule | Defect | Fix |
|---|---|---|---|---|---|
| 1 | Medium | `components/pace-readout.tsx` (`overallBlock`), surfacing on `app/result/[id].tsx` + `app/result/sample.tsx` | #5 labelling | **The two result screens were the only screens in the app with ZERO `accessibilityRole="header"` nodes.** `app/result/[id].tsx`'s own body comment states the readout's "Overall" block *is* this screen's heading (the copy deck defines no `result.title`, so there is deliberately no title element) — but saying so in a comment never put it in VoiceOver's rotor. A screen-reader user had no way to jump to the score and had to swipe through the full-bleed hero and both banners to reach it. Same defect class as the 2026-07-25 pass's finding #4, on the two screens the #181 restructure rebuilt. | `accessibilityRole="header"` on the existing single accessible node. Spoken label unchanged; no invented copy. |
| 2 | Medium | `app/(auth)/reset-password.tsx` | #5 labelling | Email field carried `textContentType="emailAddress"` with **no `autoComplete`**, and no submitting return key. `textContentType` is the **iOS half only** — Android's autofill service reads `autoComplete` — so a saved email was never offered on Android. Same iOS/Android parity trap as #11's live regions. This screen shipped after #28 closed and never picked its pattern up. | `autoComplete="email"`, `returnKeyType="go"`, `onSubmitEditing={handleSubmit}` — #28's contract, verbatim. |
| 3 | Medium | `app/(auth)/update-password.tsx` | #5 labelling | Same defect: `textContentType="newPassword"` with no `autoComplete`, no return-key submit — so no password manager offered to generate or save the password this screen exists to set. | `autoComplete="new-password"` + return-key submit. |
| 4 | Medium | `app/settings.tsx` (step-up reauth modal) | #5 labelling | Same defect on the reauth password field, which is `autoFocus`ed — the keyboard is already up, and the return key did nothing. | `autoComplete="current-password"` + return-key submit. |
| 5 | Low | `components/first-run-intro.tsx` | #5 decorative hiding | The once-ever decorative overlay set `accessible={false}` + `importantForAccessibility` (**Android-only**) but omitted **`accessibilityElementsHidden`**, the iOS half. `accessible={false}` on iOS only declines to *merge* a subtree into one node — it does not hide it. Impact is limited because its two children (`<FramingGuide>`, `<AnnotationLines>`) already hide themselves, so this is a consistency/defence-in-depth fix, not a live silence. | Added `accessibilityElementsHidden`, matching every other decorative component here. |

## Verified clean (no findings)

- **Hit targets (#1)** — all 24 `Pressable` sites plus `<PillButton>`/`<CircleIconButton>`
  audited. `ControlHeight.circle` is exactly 44; `HitTarget.min` is paired as both `minHeight`
  **and** `minWidth` everywhere it appears. The three files with a bare `Pressable` and no
  `HitTarget`/`hitSlop` token (`app/capture/index.tsx`, `app/compare.tsx`,
  `components/launch-intro.tsx`) are a large padded card, a full-width row, and a full-screen
  overlay respectively — all far above the floor by geometry.
- **Contrast (#2)** — the 61-assertion token test remains the source of truth and stays green.
- **Dynamic Type (#3)** — the only `numberOfLines` uses are deliberate, documented guards:
  `<PillButton>` wraps to 2 lines and the pill grows; the overall numeral and `<KineticText>`
  words use `adjustsFontSizeToFit` + `minimumFontScale` rather than clipping; `<Marquee>`'s is
  decorative and hidden. No fixed `height` on a text container — CTAs use `minHeight`.
- **Reduced motion (#4)** — every animating component consumes `useReducedMotion()`.
  `app/result/[id].tsx` appears in an `Animated.*` grep but animates nothing: its
  `Animated.ScrollView` + `useAnimatedRef` are the deliberate no-op scaffold its header documents.
- **Live regions on iOS (#6)** — every file carrying `accessibilityLiveRegion` also calls
  `useAnnounce`. No screen relies on the Android-only prop alone.
- **`<PillarDetailModal>`** — the newest component and the cleanest: real close label, heading
  role on the pillar name, and a deliberate, documented decision NOT to hide its not-assessed
  copy (unlike `<PillarRow>`, it has no duplicate announcement standing in for it).
