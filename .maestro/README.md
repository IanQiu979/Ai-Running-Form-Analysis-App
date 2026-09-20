# `.maestro/` — the M7 gate (issue #86)

> **A stranger can go sign-up → analysis → result with no dead end.**

This directory is the first scripted attempt at proving that sentence — the MVP's actual
acceptance gate, previously written down only as prose in `docs/mvp-build-prompt.md` and
`docs/status.md`.

## UPDATE 2026-09-20 (issue #203) — run against the real EAS development build, real production Supabase

Everything below this section (through the 2026-07-25 update) describes an EARLIER era: a
`preview-local` build against a local Supabase stack, with `lib/analyze-form.ts` hard-bound to a
dev mock. Both of those are gone now — `analyze-form` has called the real, deployed, **paid**
edge function since issue #128 (2026-07-26), and this task ran the flows against the
`development`-profile EAS build (`dbd22da6`) and the live production project. Read this section
first; the rest of the file is kept for its still-accurate flow-by-flow history.

### Fixture account, sign-in instead of sign-up

`subflows/sign-up.yaml` stopped completing on this build on 2026-09-19: the enabled
`auth-email-submit` ("Create account") button was reachable in the accessibility tree but not
painted in the viewport after Turnstile succeeded — filed as **GitHub issue #230** and, on
2026-09-20, confirmed to be a **test-harness artefact, not an app defect**: iOS 26's "Use Strong
Password?" panel (415 pt, the keyboard window, which Maestro's XCTest screenshots do not render)
sat over the CTA, Maestro judged the CTA "visible" by window bounds and never scrolled, and the
same panel swallowed all but the first typed password character. `sign-up.yaml` now closes the
panel before typing and drops the keyboard before the consent tap, and reached Home live on this
build; the diagnosis and every screenshot are in
`docs/evidence/issue-203/signup-cta-unreachable.md` (PNGs under `docs/evidence/issue-230/`).
Every flow that only needs an authenticated session (`happy-path.yaml`, `dead-end-offline.yaml`)
still signs in via `subflows/sign-in.yaml` — by choice now, not necessity — using a
pre-provisioned synthetic fixture account:

- Email: `maestro.e2e.issue203@example.com` (`raw_user_meta_data.synthetic_fixture = true`,
  `fixture_purpose = "maestro-issue-203"` — query `auth.users` on the live project to confirm it
  still exists before assuming the password below is current).
- Password: rotate it with the SQL below if it's ever lost — nothing recovers it otherwise, since
  it's a bcrypt hash, not stored in this repo or anywhere else. Requires `pgcrypto` (already
  enabled on this project):
  ```sql
  update auth.users
  set encrypted_password = crypt('<new-password>', gen_salt('bf')),
      email_confirmed_at = coalesce(email_confirmed_at, now())
  where email = 'maestro.e2e.issue203@example.com'
  returning id, email;
  ```
  Run it with `mcp__claude_ai_Supabase__execute_sql` (or the Supabase SQL editor) against project
  `vputdomdlknvthnzritt` — never `supabase db query --linked`, which is read-only.
- Pass both as `MAESTRO_E2E_EMAIL` / `MAESTRO_E2E_PASSWORD` (see "Run it" below). The wrapper
  script requires them for `happy-path.yaml`/`dead-end-offline.yaml` and fails fast with a named
  error if either is missing.
- `subflows/grant-consent.yaml`'s phase 1 (the once-ever health/age checkboxes) is now
  conditional (`runFlow: when:`), because that grant is a `public.consents` row keyed to the
  ACCOUNT, not local app state — a reused fixture account skips straight to phase 2 on every run
  after its first, even though the harness reinstalls the app fresh each time.
- `subflows/sign-in.yaml` also dismisses iOS's own Keychain "Save Password?" sheet, which fires
  on a real sign-in submit (distinct from the "Use Strong Password?" panel that fires on focusing
  sign-UP's empty password field — `sign-up.yaml` closes that one in-flow since 2026-09-20; the
  Settings → General → AutoFill & Passwords → Suggest Strong Passwords toggle `docs/status.md`
  Known Issue #38 describes is no longer required).
- **A reused account accumulates analyses, so `happy-path.yaml` cleans History first.** Its
  History leg deletes one row and asserts "No analyses yet", which only holds with exactly one
  persisted analysis — but `dead-end-offline.yaml` ends on the result readout without deleting
  its own, and any run that fails between the analysis and the delete leaves a row too. Right
  after sign-in, `happy-path.yaml` now runs `subflows/clear-history.yaml`, which deletes every
  row through the app's own History delete path (a no-op with zero rows) and returns to Home, so
  the leg is idempotent whatever a prior or interrupted run left behind. No service-role key or
  direct SQL is involved — the cleanup is the same UI purge a user would perform.
- **The same reuse means the Free-tier lifetime quota applies to the fixture, and History
  cleanup does NOT release it.** `reserve_analysis` counts the account's `reserved`/`delivered`
  rows regardless of `deleted_at` — deleting from History is a soft delete by design
  (`20260712040000_analyses_quota_soft_delete.sql`, issue #2), precisely so a delete cannot
  refund a free analysis. A Free fixture therefore gets exactly ONE live analysis ever; the
  second `happy-path`/`dead-end-offline` run routes Home's CTA to the paywall instead of
  Analyzing. This is masked today because no simulator run reaches the analyze handoff (capture
  is skipped — prerequisite #3, issue #232). Before the first run that does reach it (a real
  device, or a locally-fixtured Upload path), either grant the fixture an Elite entitlement (via
  `purchase-tier`) or provision a fresh fixture per run — a live-project decision, deliberately
  not made here. (There is no longer an all-users override to fall back on — it was deleted
  2026-09-20, `docs/status.md` Known Issue #49.)

### Run it

```bash
npm install   # a fresh worktree has no node_modules; ./node_modules/.bin/expo must exist
export PATH="$PATH:$HOME/.maestro/bin"
export MAESTRO_IOS_SIMULATOR_UDID=<a private-simulator UDID; never Simulator.app>
export MAESTRO_METRO_PORT=8093   # or your own; the script reuses a listener already on this port
export MAESTRO_ALLOW_PAID_ANALYSIS=1   # the wrapper still gates happy-path/dead-end-offline on it; on a simulator neither reaches analyze-form today (capture skipped, issue #232)
export MAESTRO_E2E_EMAIL=maestro.e2e.issue203@example.com
export MAESTRO_E2E_PASSWORD='<the fixture password>'
npm run e2e:maestro:ios-dev -- happy-path dead-end-offline
```

The script (`scripts/run-maestro-ios-dev-build.sh`, tested by
`scripts/test-run-maestro-ios-dev-build.sh` — `npm run test:e2e-harness`, a dependency-free
bash behavior-check suite with every external tool stubbed, so it is chained into `npm test` and
runs in the ordinary commit gate) downloads/caches the EAS build artifact, boots the
named simulator, starts or reuses Metro, does a fresh install + privacy reset before EACH flow,
runs Maestro with `--format junit`, and prints a `flow\tstatus` matrix — this is the CI-shaped,
repeatable command; nothing about it depends on this task's specific sandbox. See its own
`--help` (or the top of the script) for every environment variable, including the
`MAESTRO_ALLOW_FIXTURE_FLOWS`/`MAESTRO_QUOTA_EXHAUSTED_*` pair `dead-end-quota-exhausted.yaml`
needs and the hard block on `dead-end-analysis-failure.yaml` (still no fault-injection contract —
see "What's runnable today" below, unchanged).

`maestro test` only interpolates `${VAR}` for names passed via its own `-e/--env` flag — it does
**not** read the process environment on its own, despite what an earlier draft of this script's
usage text implied. Confirmed empirically 2026-09-19: an exported-but-not-`-e`'d var renders as
the literal string `"null"` in the running flow. The wrapper now passes each flow's own required
`-e` pair itself (`flow_env_args()`); you should never need `--env` yourself when going through
`npm run e2e:maestro:ios-dev`.

### Pass/fail matrix (2026-09-20, EAS build `dbd22da6`, iOS 26.5 Simulator)

| Flow | Result | Blocked by |
|---|---|---|
| `happy-path.yaml` | **FAIL** | Real, reproducible app/SDK bug — GitHub **issue #232**: `expo-camera`'s `record()` throws `SimulatorNotSupported` on this Simulator/SDK combination, so the in-app Record path can never start a clip. Confirmed deterministic across separate fresh-install runs (same exact native error each time), not the iOS-accessibility-bridge flakiness documented below. Everything BEFORE that step — sign-in, Home, consent, the camera permission soft-ask and OS dialog — passed cleanly after the flow-drift fixes in this task. |
| `dead-end-offline.yaml` | **FAIL** | Same root cause as above (issue #232) — this flow also uses the in-app Record path and fails at the identical step. |
| `dead-end-quota-exhausted.yaml` | Not run | Needs its own seeded quota-exhausted fixture account (`MAESTRO_QUOTA_EXHAUSTED_EMAIL`/`_PASSWORD`, `MAESTRO_ALLOW_FIXTURE_FLOWS=1`), which was out of this task's scope to provision. Unaffected by issue #232 (it never reaches capture). |
| `dead-end-analysis-failure.yaml` | Hard-blocked | No deterministic failure-injection contract exists yet for the real `analyze-form` endpoint (unchanged from the 2026-07-13 analysis below); the wrapper script refuses to run it at all. |

**Zero real `analyze-form` calls (and therefore $0 model spend) were made while producing this
matrix** — every run stopped at the Record step, before the capture→analyze handoff. `analyze-form`
IS the real, deployed, paid client today (see the top of this section), so once a run can
produce a clip (a real device, or a locally-fixtured Upload path — see the update below), budget
for exactly one live call per `happy-path`/`dead-end-offline` run — the wrapper
script enforces and prints this budget (`Selected client endpoint submission budget:
N ... cap: 2`) before it does anything else.

**UPDATE 2026-09-20 (issue #232 fix) — the two FAILs above are now a clean, deliberate SKIP, not
a fix that makes recording work on a simulator.** There is still no camera on the iOS Simulator;
that is a Simulator/SDK limitation, not something app code can work around. What changed is that
both flows now detect they cannot produce a clip and stop cleanly at the capture chooser with an
explicit `capture skipped: simulator` step (see each file's own header), instead of failing deep
inside the native `SimulatorNotSupported` rejection at `record-button`. Concretely:
`happy-path.yaml` now covers sign-in → Home → source picker → (skip) → Settings → sign out, and
`dead-end-offline.yaml` stops at the source picker with its offline-gate assertions commented out
as documentation (they need a real "Frames ready" clip, which needs a real device or a locally
provided fixture). **This still needs one real run against an installed EAS build to confirm the
`evalScript` skip step and the post-skip navigation (`happy-path.yaml`'s Back → History →
Settings leg) actually work against the live app** — that run was not performed as part of the
code change (no simulator available in this environment); do that before trusting this note over
an actual `maestro test` result.

### Other flow drift fixed in this pass (2026-09-19/20, issue #203)

Beyond the sign-in retarget above: the camera permission soft-ask panel
(`app/capture/record.tsx`'s `'undetermined'` state, title "Camera access required") only renders
BEFORE permission is granted — the "Record your run" title only exists in the granted-permission
branch. The flows used to assert "Record your run" first and tap the soft-ask CTA after, which
never actually passed against a harness that resets Simulator privacy on every run (only ever
worked if permission carried over from a prior run on the same install). Fixed order: soft-ask
title → tap "Allow camera access" → tap the OS dialog's real button → THEN assert "Record your
run". The OS dialog's button also reads **"Allow" / "Don't Allow"** on iOS 26.5 with this build,
not "OK" — update this the next time you verify against a different iOS version. Maestro was also
upgraded 1.39.0 → 2.10.0 on this host (`curl -Ls https://get.maestro.mobile.dev | bash`) while
chasing the accessibility-bridge flakiness on `subflows/grant-consent.yaml`'s "Who is in this
photo or video?" text assertion — the upgrade didn't fix that specific case (the fix was
asserting the `consent-subject-option-me` testID instead of that text; see the file's own
comment), but keep it current regardless.

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

1. **An EAS build installed on a simulator.** `expo-dev-client` is a dependency, so plain
   `expo start` serves a dev-client deep link (`exp+…://expo-development-client/`) that **Expo Go
   cannot open** — without a real build there is no app for Maestro to launch, full stop. The
   `development` profile builds on both platforms (issue #84, 2026-09-18); the build, poll and
   headless `simctl` install/launch recipe lives in `docs/architecture.md`'s "EAS build & release
   config" section. Then:
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

3. **The iOS Simulator has NO camera and cannot record at all — GitHub issue #232 (2026-09-20).**
   This prerequisite used to claim Xcode 15+ Simulators drive `CameraView` "with a synthetic
   test-pattern feed"; that claim was never re-verified against a real build and is false for
   this build's `expo-camera` version on iOS 26.5 — `recordAsync` rejects immediately with a
   native `SimulatorNotSupported` error (evidence:
   `docs/evidence/issue-203/record-unsupported-on-simulator.md`). `happy-path.yaml` and
   `dead-end-offline.yaml` now detect this and stop cleanly at the capture chooser ("Add
   footage") with an explicit "capture skipped: simulator" step, instead of failing deep inside
   the native rejection at `record-button` — see each file's own 2026-09-20 header. The
   **Upload** path (native Photos picker) is not scripted as a substitute either: it's a system
   UI Maestro can only interact with by guessing at thumbnail coordinates, and only if the
   Simulator's Photos library has a seeded asset to show at all
   (`xcrun simctl addmedia <device> <path-to-a-short-clip>`). No fixture media file is checked
   into this repo — uploaded media is sensitive by this project's own rule (CLAUDE.md), and a
   running-form clip is exactly the kind of asset that shouldn't live in a public tree even as a
   "test fixture." **The capture→analyze→History leg both flows used to cover is therefore
   untested on a simulator** until a real device is used, or you provide your own,
   locally-gitignored fixture clip and script the Upload path in its place.

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
      sign-up.yaml                          # reusable: hero -> details -> fresh email/password
                                            # stranger (consent ticked) -> Home
      grant-consent.yaml                    # reusable: the Art. 9 consent gate, first-time-only
      sign-in.yaml                          # reusable: hero -> details -> existing account -> Home
      clear-history.yaml                    # reusable: Home -> History -> delete every row -> Home
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
  → "Frames ready" → **"Start analysis" → `/analyzing` → mock resolves (~4s, hardcoded
  `'success'`) → Result screen with the mock's clearly-fake data → "Back to Home"** (#135, new).
- **History tab** (#55, new) — `(tabs)/history` is a real route; the happy path proves its
  EMPTY state honestly (the mock never writes an `analyses` row).
- **The offline dead-end at `/analyzing`** (#93, partial) — a real, live pre-flight
  `checkConnectivity()` gate in `app/analyzing.tsx`, wired into the ONE call site that exists so
  far (not the source picker). `setAirplaneMode: true` before tapping the ready-screen's
  "Start analysis" CTA reaches a genuine `offline.blocked.*` panel with a working Retry
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
