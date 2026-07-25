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
