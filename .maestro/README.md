# `.maestro/` — the M7 gate (issue #86)

> **A stranger can go sign-up → analysis → result with no dead end.**

This directory is the first scripted attempt at proving that sentence — the MVP's actual
acceptance gate, previously written down only as prose in `docs/mvp-build-prompt.md` and
`docs/status.md`.

**UPDATE 2026-07-25 (issues #84, #86, #92) — executed for real, for the first time, against a
real build.** A `preview-local` EAS simulator build (issue #84 — a standalone build, not
`developmentClient`, so it needs no Metro connection and has no dev-menu overlay to fight; see
`eas.json`) was built, installed on an iOS Simulator, and driven with
`maestro test .maestro/flows/happy-path.yaml` against issue #92's local Supabase stack. That
first real execution found and fixed FOUR real bugs that had been sitting in these
checked-in-but-never-run flow files: a `wait:` command that isn't valid Maestro syntax (two
files), subflow files missing the `appId` this Maestro CLI version (1.39.0) requires even for a
`runFlow:`-only file, a stale `tapOn: "Continue with email"` step that no longer matches
`sign-in.tsx` after issue #16 (`toggleMode()` now opens the email form itself), and a cold-launch
race on the very first assertion. See each file's own 2026-07-25 comments for specifics.

**Confirmed correct, by direct visual verification**: sign-up through the sign-in screen renders
exactly as the flow expects — one full run made it past sign-up entirely into the capture flow
before an unrelated driver hiccup. **Not confirmed as a clean, repeatable pass**: repeated runs in
THIS sandbox hit a genuine Maestro-iOS-driver flakiness, not an app or script bug — proven, not
assumed: on more than one run, the debug screenshot Maestro itself saved on an `assertVisible`
FAILURE shows the correct screen with the exact expected text plainly visible, while
`maestro.log` shows the driver polling a STABLE, unchanging view-hierarchy snapshot (same node
depth, same content) for 20-50 straight seconds without ever matching text that is visibly right
there. That is Maestro's own iOS accessibility-tree bridge intermittently failing to
resolve/refresh, not a timing race this flow's timeouts can fix (45s wasn't enough either) and
not a build/environment/backend problem — this sandbox also runs other agents concurrently on the
same simulator pool, which plausibly aggravates it (one run's screenshot briefly showed a
different project's screen mid-test), but the root symptom is the driver, not contention alone.
Re-run `maestro test .maestro/flows/happy-path.yaml` against a `preview-local` build on an
otherwise-idle host — and consider `maestro --version` for a newer CLI, since this exact iOS
accessibility-snapshot flakiness is a known category of issue in the Maestro project — to get a
clean pass. See "What's runnable today" below for what's now believed correct vs still genuinely
unverified end-to-end (that section was independently re-verified against the code the same day
this execution report was written, and its conclusions stand alongside this one).

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

2. **A local, non-production Supabase environment now exists (issue #92, resolved 2026-07-25) —
   use it, never production.** `supabase start` (local Docker) stands up a full local project;
   see `docs/architecture.md`'s "Current — local Supabase stack" section for setup. Point
   whatever build you install on the simulator/emulator at the LOCAL stack's URL and
   anon/publishable key (an isolated `eas.json` build profile, not the shared "development"
   environment on the EAS dashboard, is how the first build under issue #84 did this — see that
   profile's own comment). `happy-path.yaml` reaches "Analyzing"/"Result" today via
   `lib/analyze-form.ts`'s mock client (issue #128, deliberately not swapped to the real
   endpoint) — no edge function needs to be deployed or served for it to pass. Still true and
   important: `analyze-form` is deployed and live in production (issue #128, since 2026-07-26),
   and `dead-end-analysis-failure.yaml` (which needs the mock's `outcome` forced to
   `'failed'`/`'timeout'`, not currently possible from outside the app — see the HANDOFF section)
   must never be pointed at a real backend with a real `ANTHROPIC_API_KEY` without a disposable
   test account and full awareness of real spend.

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

## What's runnable today vs what's blocked, and by what

**REWRITTEN 2026-07-13, same day as the rest of this directory** — this section as originally
written (see git history) was accurate when it said "these flows have never been executed."
Since then, in the same day's parallel batches: #135 (capture→analyze handoff), #55 (History
tab), #52/#54 (paywall + wiring), and a partial #93 (offline) all landed on `main`. This section
is rewritten against a direct re-read of the current code, not carried forward from the stale
version. As of the 2026-07-25 execution report above, the flows have now actually been run
against a real build — see that section for what passed vs. hit driver flakiness.

**Real and scriptable today**, confirmed against `main`:
- Sign-up (email/password) → Home.
- The consent gate (`components/consent-gate.tsx`) — fully wired.
- Source picker → in-app Record → camera permission dance → a recorded clip → frame extraction
  → "Frames ready" → **"Analyze my form" → `/analyzing` → mock resolves (~4s, hardcoded
  `'success'`) → Result screen with the mock's clearly-fake data → "Back to Home"** (#135, new).
- **History tab** (#55, new) — `(tabs)/history` is a real route; the happy path proves its
  EMPTY state honestly (the mock never writes an `analyses` row).
- **The offline dead-end at `/analyzing`** (#93, partial) — a real, live pre-flight
  `checkConnectivity()` gate in `app/analyzing.tsx`, wired into the ONE call site that exists so
  far (not the source picker). `setAirplaneMode: true` before tapping the ready-screen's
  "Analyze my form" CTA reaches a genuine `offline.blocked.*` panel with a working Retry
  (re-checks connectivity, resumes) and Cancel (returns to Home). See `dead-end-offline.yaml`'s
  header for the exact call-site and what's still NOT wired (the source picker itself).
- **The quota-exhausted paywall UI** (#52/#54, new) — Home's CTA genuinely relabels and routes
  to `/paywall`, which is a real screen with a live "Back" button. Still blocked from an E2E
  run only by the precondition below (no way to seed a quota-exhausted account), not by
  missing UI.
- Settings → Sign out (does **not** depend on an analysis existing — it's exercised in
  `happy-path.yaml` on a zero-analysis account for exactly that reason).

**Genuinely blocked**, and not by anything this directory can fix:

| Gap | Issue(s) | What's missing |
|---|---|---|
| Analysis result is always fake | **#44** | `lib/analyze-form.ts`'s `analyzeFormClient` is hard-bound to a dev mock with a hardcoded `'success'` outcome — no runtime switch (no env var, no dev menu, no query param; grepped). The real `analyze-form` edge function is written and **deployed and live** (issue #128, since 2026-07-26), but the client is deliberately not yet swapped to call it. |
| No deterministic way to force a failure/timeout | **#44** (new ask, see HANDOFF) | Nothing lets an E2E script choose the mock's `'failed'`/`'timeout'` outcome from outside a source change, and the real endpoint has no documented fault-injection hook either. `dead-end-analysis-failure.yaml` is written and ready but cannot pass until this exists. Racing the mock's 4s success against the screen's own 120s client timeout does not help — the mock always wins. |
| Delete-analysis has nothing to call it from | **#57** | `DELETE /functions/v1/analysis/:id` is written, tested, and **deployed and live** (issue #128, since 2026-07-26) — moot anyway today since no real `analyses` row can be created (see next row). |
| No way to seed a quota-exhausted account | **#44** | A Free user with a spent quota needs a real `analyses` row via `reserve_analysis`/`settle_analysis` — which needs #44 deployed. The mock in `lib/analyze-form.ts` never calls Supabase at all, so even unlimited happy-path runs never produce one. `dead-end-quota-exhausted.yaml` is written and ready, blocked only on this seed data (or #44 deploying so it can be produced for real). |
| Offline check only covers one call site | **#93** (remainder) | `lib/connectivity.ts`'s `checkConnectivity()` is wired into `app/analyzing.tsx` only. `app/capture/index.tsx` (the source picker) has no connectivity check — capture works uninterrupted offline today, arguably by design ("capture itself is not blocked" per the deck) but not signposted beyond the passive global banner at that stage. |

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
route tree — not assumed from the copy deck alone. As of the 2026-07-25 execution report at the
top of this file, the happy path has been run for real against a built app; treat this directory
as a **specification of the gate that has now started to be exercised**, not yet as proof the
gate passes cleanly end to end — repeatable, driver-flakiness-free runs are still outstanding.
