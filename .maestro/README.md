# `.maestro/` — the M7 gate (issue #86)

> **A stranger can go sign-up → analysis → result with no dead end.**

This directory is the first scripted attempt at proving that sentence — the MVP's actual
acceptance gate, previously written down only as prose in `docs/mvp-build-prompt.md` and
`docs/status.md`. Read this whole file before running anything; the short version is **these
flows have never been executed and cannot be today.** See "What's blocked, and by what" below.

## Install Maestro

Maestro is a free CLI, not an npm dependency — it is not, and must not be, added to
`package.json` (a separate agent owns that file in this worktree).

```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
export PATH="$PATH:$HOME/.maestro/bin"   # add to your shell profile to persist
maestro -v                                # confirms the install
```

Maestro drives a **running app on a simulator/emulator or a physical device** — it is not a
browser tool. (Maestro Cloud, a paid hosted runner, is not needed; everything here targets a
local iOS Simulator / Android emulator.)

## Prerequisites — read before running anything

1. **An EAS development build, installed on a simulator (issue #84, not built yet).**
   `expo-dev-client` is a dependency, so plain `expo start` serves a dev-client deep link
   (`exp+…://expo-development-client/`) that **Expo Go cannot open**. Until #84 produces a real
   development build, there is no app for Maestro to launch, full stop. Once one exists:
   ```bash
   maestro test .maestro/flows/happy-path.yaml
   ```
   or run every top-level flow in one pass:
   ```bash
   maestro test .maestro
   ```
   (`config.yaml` scopes that to `flows/*.yaml` — files under `flows/subflows/` are pulled in
   via `runFlow:` and are not meant to run standalone.)

2. **No non-production environment exists (issue #92).** `analyze-form` (once #44 deploys) will
   be developed and tested against the **production** Supabase project and the **production**
   Anthropic key — there is no staging DB, no staging bucket, no staging AI budget. Concretely:
   do **not** run `happy-path.yaml` past its extraction step, and do not run
   `dead-end-analysis-failure.yaml` at all, against a real backend without a disposable test
   account and full awareness that a real Anthropic call and real spend would be involved the
   moment the capture→analyze handoff (#128) exists. Today neither flow can reach that point
   regardless (see below) — this note is for the day they can.

3. **Simulator media, if you use the library-upload path instead of the in-app record path.**
   `happy-path.yaml` deliberately uses in-app **Record** (an `expo-camera` `CameraView`, which
   Xcode 15+ Simulators can drive with a synthetic test-pattern feed) rather than **Upload**
   (which opens the native Photos picker — a system UI Maestro can only interact with by
   guessing at thumbnail coordinates, and only if the Simulator's Photos library has a seeded
   asset to show at all: `xcrun simctl addmedia <device> <path-to-a-short-clip>`). No fixture
   media file is checked into this repo — uploaded media is sensitive by this project's own
   rule (CLAUDE.md), and a running-form clip is exactly the kind of asset that shouldn't live in
   a public tree even as a "test fixture." Provide your own locally if you want to script the
   Upload path instead.

4. **A quota-exhausted / seeded test account for `dead-end-quota-exhausted.yaml`.** That flow
   needs a Free-tier user who already has one `'delivered'` (or `'reserved'`) row in `analyses`
   — reachable today only via a real `reserve_analysis`/`settle_analysis` RPC call, i.e. a real
   analysis, i.e. `analyze-form` (#44) deployed and the capture→analyze handoff (#128) wired.
   Until then this flow's account has to be seeded out of band (direct service-role insert, or
   a `seed-data`/`mocks-testdata` fixture — none exists in this repo today). Pass credentials in
   with `--env`:
   ```bash
   maestro test \
     --env MAESTRO_QUOTA_EXHAUSTED_EMAIL=... \
     --env MAESTRO_QUOTA_EXHAUSTED_PASSWORD=... \
     .maestro/flows/dead-end-quota-exhausted.yaml
   ```
   `dead-end-offline.yaml` and `dead-end-analysis-failure.yaml` take the equivalent
   `MAESTRO_OFFLINE_TEST_*` / `MAESTRO_ANALYSIS_FAILURE_TEST_*` pair; any already-signed-up
   account works for those two (no special seeding).

No secrets are hardcoded in any flow file — `happy-path.yaml` mints a fresh, unique
email/password at runtime (`evalScript`, see `flows/subflows/sign-up.yaml`) so it can be re-run
without colliding on "email already registered."

## What's in here

```
.maestro/
  config.yaml                              # scopes `maestro test .maestro` to flows/*.yaml
  flows/
    happy-path.yaml                        # sign-up -> consent -> capture -> extract -> Home
                                            # -> Settings -> sign out (see its own header for
                                            # exactly where it stops, and why)
    dead-end-quota-exhausted.yaml           # Free tier, quota used up -> must reach the paywall
    dead-end-offline.yaml                   # connectivity drops mid-flow -> must say so, offer Retry
    dead-end-analysis-failure.yaml          # model call fails/times out -> Retry/Cancel, no trap
    subflows/
      sign-up.yaml                          # reusable: fresh email/password stranger -> Home
      grant-consent.yaml                    # reusable: the Art. 9 consent gate, first-time-only
```

## What's runnable today (once #84 lands) vs what's blocked, and by what

**Real and scriptable today**, all built against `main` as of 2026-07-13:
- Sign-up (email/password) → Home.
- The consent gate (`components/consent-gate.tsx`) — fully wired, all three testIDs it needs
  already exist.
- Source picker → in-app Record → camera permission dance → a recorded clip → frame extraction
  → "Frames ready".
- Settings → Sign out (does **not** depend on an analysis existing — it's exercised in
  `happy-path.yaml` on a zero-analysis account for exactly that reason).

**Genuinely blocked**, and not by anything this directory can fix:

| Gap | Issue(s) | What's missing |
|---|---|---|
| Capture never hands off to analysis | **#128** | `app/capture/extracting.tsx`'s "Frames ready" screen has one control, "Done", and it returns to Home — confirmed by reading the file, not inferred from docs. `app/analyzing.tsx` (#80) exists but nothing navigates to it. |
| Analysis result is always fake even if reached | **#44**, **#128** | `lib/analyze-form.ts`'s `analyzeFormClient` is hard-bound to a mock with a hardcoded `'success'` outcome — no runtime switch. The real `analyze-form` edge function is written but not deployed. |
| No deterministic way to force a failure/timeout | **#44**, **#128** (new ask, see HANDOFF) | Even once the handoff exists, nothing lets an E2E script choose the mock's `'failed'`/`'timeout'` outcome, and the real endpoint has no documented fault-injection hook either. |
| Past Analyses tab doesn't exist | **#55** | `(tabs)/history` is not a registered route. `constants/copy.ts` has no `history.*` namespace (only `docs/design/copy-deck.md` does). |
| Delete-analysis has nothing to call it from | **#55**, **#57** | Even once #55 ships a UI, `DELETE /functions/v1/analysis/:id` (#57) is written+tested but **not deployed**. |
| Quota-exhausted Free user has no way forward | **#52**, **#54** | Confirmed a real, current dead end by reading the code: Home's CTA stays labeled "Analyze my form" and is just `disabled`; `constants/copy.ts` never renders `home.cta.upgradeToAnalyze`. There is no "See plans" entry point anywhere in the shipped app — `settings.plan.cta` is referenced only in a code comment, never implemented. `app/paywall.tsx` does not exist. This is exactly the dead end #52 itself names in its own issue body. |
| Offline has zero implementation | **#93** | Confirmed: no `offline.*` in `constants/copy.ts`, no connectivity listener anywhere in `app/` or `lib/`. Only the copy deck has these strings. |

Every flow file's own header comment repeats the specific issue numbers it's blocked on, so
this table and the flows can't silently drift apart.

## HANDOFF

See the `HANDOFF:` block in the PR/commit description (or ask the agent that ran this) for the
full per-screen testID list. Summary of what's requested and why:

- `auth-email-input` / `auth-password-input` on `app/(auth)/sign-in.tsx`'s two `TextInput`s —
  not required (placeholder text already works as a Maestro selector today) but more robust
  than a text match against copy that can change.
- `tab-history` on the future `(tabs)/history` tab bar button (#55) — a tab label is exactly the
  case this codebase already treats as testID-worthy elsewhere (dynamic per-item rows in
  `components/pace-readout.tsx`), since asserting-then-tapping "History" as plain text is
  fragile if the tab ever gets an icon-only treatment.
- `history-item-{id}` / a delete-confirm affordance on each history row (#55) — needed because
  rows are dynamic/list-based, the same reason `pillar-row-{pillarId}` already exists.
- A **non-UI ask**, not a testID: a deterministic, documented way to force `analyze-form` (or
  its dev mock) into a `failed`/`timeout` outcome for E2E purposes — see
  `dead-end-analysis-failure.yaml`'s header for exactly why this doesn't exist today and can't
  be worked around from outside the app.

## Honesty note

Every flow in this directory was written by reading the actual screens in `app/` and
`components/`, `constants/copy.ts`, `docs/design/copy-deck.md`, and `docs/architecture.md`'s
route tree — not assumed from the copy deck alone. None of them has been executed; there is no
development build to run them against (#84), and several of the screens they'd need to reach
don't exist yet (#52, #55) or aren't wired (#128). Treat this directory as a **specification of
the gate**, ready to run and start catching real regressions the moment those land — not as
proof the gate currently passes. It does not.
