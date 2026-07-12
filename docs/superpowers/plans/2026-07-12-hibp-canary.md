# HIBP Live-API Canary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the fail-open in `lib/hibp.ts` detectable by running the real shipped
`checkPasswordBreached` against the live HaveIBeenPwned range API on a daily cron, and filing a
GitHub issue when it rots.

**Architecture:** A separate Jest project (`jest.canary.config.js`) runs one live-network test
that mocks exactly one thing — `expo-crypto`'s native `digestStringAsync`, replaced by a real
`node:crypto` SHA-1 — and leaves the network call, content-type guard, retry, deadline, and
parser real. It is excluded from `npm test` so the offline commit gate stays hermetic. A
GitHub Actions workflow runs it daily, retries three times to absorb transient blips, and
opens/closes a labelled issue on sustained failure/recovery.

**Tech Stack:** Jest 29 + `jest-expo` preset, `testEnvironment: 'node'` (Node 24 global
`fetch`), TypeScript strict, GitHub Actions, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-07-12-hibp-canary-design.md`

## Global Constraints

- **Do not modify `lib/hibp.ts`'s behavior.** Only its header comment may gain a pointer to the
  canary. The canary exists to observe that file, not to change it.
- **`npm test` must stay hermetic** — no network, no third-party uptime dependency. Verified:
  the default Jest `testMatch` *does* currently pick up `*.canary.test.ts`, so the
  `testPathIgnorePatterns` guard in Task 1 is mandatory, not decorative.
- **No user data, ever.** The only strings the canary hashes are the public test vector
  `password` and a fresh `randomUUID()`. Never log a hash, prefix, or password — `lib/hibp.ts`'s
  leak-safety rules bind the canary too.
- **No third-party telemetry SDK.** `docs/app-store-privacy-labels.md` declares "No, we do not
  track users" and no crash/analytics SDK. Nothing in this plan may change that answer.
- **A canary that cannot go red is the bug it was built to catch.** Task 1 Step 4 proves it
  fails offline. Do not skip it.
- Node version in CI: **24** (matches local `v24.15.0`).
- Every commit must pass `npm run typecheck && npm run lint && npm test`.

**Pre-verified facts** (spiked against the real toolchain on 2026-07-12 — do not re-litigate):
- `@types/node` resolves; `node:crypto` typechecks.
- `jest-expo` preset + `testEnvironment: 'node'` yields a real global `fetch`.
- `require()` inside a `jest.mock` factory in a `.ts` file passes `expo lint` — no
  `eslint-disable` needed.
- Live API today: `password` → `{ status: 'breached', count: 52372427 }`; random UUID →
  `{ status: 'safe' }`; forced-offline → `{ status: 'unavailable' }` (canary goes red).

---

### Task 1: The canary test and its isolated Jest project

**Files:**
- Create: `lib/__tests__/hibp.canary.test.ts`
- Create: `jest.canary.config.js`
- Modify: `jest.config.js` (add `testPathIgnorePatterns`)
- Modify: `package.json` (add `test:canary` script)
- Modify: `lib/hibp.ts` (header comment only — pointer to the canary)

**Interfaces:**
- Consumes: `checkPasswordBreached(password: string): Promise<BreachCheck>` from `lib/hibp.ts`,
  where `BreachCheck = { status: 'safe' } | { status: 'breached'; count: number } | { status: 'unavailable' }`.
- Produces: `npm run test:canary` — exits 0 when the live HIBP endpoint still behaves, non-zero
  otherwise. Task 2's workflow depends on exactly this script name and exit-code contract.

- [ ] **Step 1: Create the isolated Jest project config**

Create `jest.canary.config.js`:

```js
/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // The default jest-expo environment is React Native's, which does not expose Node's global
  // fetch. This canary's entire purpose is to make a REAL network call, so it runs under the
  // plain Node environment (Node 24 provides global fetch and AbortController).
  testEnvironment: 'node',
  // Only ever runs the canary. The hermetic unit suite is `jest.config.js`'s job.
  testMatch: ['**/*.canary.test.ts'],
  // Agent worktrees carry a full copy of the test suite; without this, jest discovers those
  // copies and runs the canary several times over. Mirrors jest.config.js.
  modulePathIgnorePatterns: ['<rootDir>/.claude/worktrees/'],
};
```

- [ ] **Step 2: Write the canary**

Create `lib/__tests__/hibp.canary.test.ts`:

```ts
/**
 * LIVE-NETWORK canary for `lib/hibp.ts` (issue #74).
 *
 * `hibp.test.ts` mocks `fetch` and proves the parser is correct against fixtures. It cannot
 * tell you that HIBP still *speaks* that shape. This file can: it runs the real, shipped
 * `checkPasswordBreached` against the live Pwned Passwords range API.
 *
 * Why this exists: `checkPasswordBreached` fails open — an unreachable or misbehaving endpoint
 * returns `unavailable` and sign-up proceeds — and `lib/hibp.ts` deliberately never logs.
 * Together those two correct decisions make the control silently unobservable. If HIBP changes
 * its content-type, Cloudflare starts challenging us, or our egress gets rate-limited, every
 * sign-up passes the check forever and nothing fires. This canary is what fires. It runs on a
 * daily cron (`.github/workflows/hibp-canary.yml`), NOT in `npm test` — the commit gate must
 * stay hermetic, so `jest.config.js` explicitly ignores this file and `jest.canary.config.js`
 * is the only config that runs it.
 *
 * Both assertions below must reject `unavailable`, not merely accept `breached`/`safe`. A
 * canary that cannot go red is the bug it was built to catch, wearing a different hat.
 *
 * Exactly ONE thing is faked: `expo-crypto`'s `digestStringAsync`, a native module with no Node
 * build. Its stand-in is a real `node:crypto` SHA-1 returning LOWERCASE hex — exactly what the
 * native module returns on device — so the lowercase/uppercase normalization in `lib/hibp.ts`
 * (the classic silent no-op this whole check is vulnerable to) is still proven end-to-end
 * against a live response. Everything else is real: the network call, the content-type guard,
 * the single retry, the 4s shared deadline, the CRLF split, and the `Add-Padding` count-0 row
 * filter.
 *
 * The only two strings this file ever hashes are the public test vector "password" and a fresh
 * random UUID. No user data is involved and none is transmitted — `lib/hibp.ts`'s leak-safety
 * rules (never log a hash, prefix, or password) bind this file too.
 */
import { randomUUID } from 'node:crypto';

import { checkPasswordBreached } from '../hibp';

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA1: 'SHA-1' },
  // `require` inside the factory rather than a top-level import: Jest hoists `jest.mock` above
  // the import statements, so referencing an imported binding here throws an out-of-scope error.
  digestStringAsync: (_algorithm: unknown, data: string) =>
    Promise.resolve(require('node:crypto').createHash('sha1').update(data, 'utf8').digest('hex')),
}));

// The function's own budget is a 4s internal deadline. This outer timeout is deliberately far
// looser: a CI runner's first TLS handshake to a cold host is slower than a warm laptop's, and
// a canary that fails on its own impatience is a canary that gets muted.
const LIVE_TIMEOUT_MS = 30_000;

describe('HIBP live-endpoint canary', () => {
  it('still reports a known-breached password as breached', async () => {
    const result = await checkPasswordBreached('password');

    // The load-bearing assertion. A Cloudflare challenge page, a content-type change, a
    // rate-limit on our egress, or any parse breakage all collapse to `unavailable` or `safe`
    // right here — which is precisely the rot that is invisible in production today.
    expect(result.status).toBe('breached');
    // A count of 0 would mean we matched an `Add-Padding` decoy row rather than the real one.
    expect(result.status === 'breached' && result.count > 0).toBe(true);
  }, LIVE_TIMEOUT_MS);

  it('still reports a random, never-breached password as safe — not unavailable', async () => {
    const result = await checkPasswordBreached(`canary-${randomUUID()}`);

    // `safe` is a positive assertion in `lib/hibp.ts`: it is returned only after at least one
    // well-formed range row has parsed. So if this is not `safe`, the parser has stopped
    // recognising HIBP's response shape — even in a world where the `breached` case above
    // somehow still passed.
    expect(result.status).toBe('safe');
  }, LIVE_TIMEOUT_MS);
});
```

- [ ] **Step 3: Run the canary against the live API**

Run: `npx jest --config jest.canary.config.js`
Expected: PASS, 2 tests. (Today the live count for `password` is ~52,372,427.)

- [ ] **Step 4: Prove the canary can go RED — do not skip this**

A canary that only ever passes reproduces the exact bug in #74. Temporarily add this line as
the first statement inside the `'still reports a known-breached password as breached'` test, to
simulate the endpoint being unreachable:

```ts
    globalThis.fetch = () => Promise.reject(new Error('offline'));
```

Run: `npx jest --config jest.canary.config.js`
Expected: **FAIL** — `Expected: "breached" / Received: "unavailable"`.

Now **delete that line** and re-run:

Run: `npx jest --config jest.canary.config.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Keep the canary out of the hermetic commit gate**

The default Jest `testMatch` picks up `**/__tests__/**/*.ts`, which *includes* the canary —
verified. Without this change, `npm test` would make a live network call and the commit gate
would fail on a plane.

In `jest.config.js`, add `testPathIgnorePatterns` immediately after the `passWithNoTests` line:

```js
  // The live-network canary (`*.canary.test.ts`) must never run in the commit gate: it would
  // make `npm test` depend on a third party's uptime and on having a network connection. It
  // runs only under `jest.canary.config.js`, on a cron. See docs/superpowers/specs/
  // 2026-07-12-hibp-canary-design.md.
  testPathIgnorePatterns: ['<rootDir>/.*\\.canary\\.test\\.ts$'],
```

- [ ] **Step 6: Add the script**

In `package.json`, add to `"scripts"` immediately after `"test": "jest"`:

```json
    "test:canary": "jest --config jest.canary.config.js",
```

- [ ] **Step 7: Verify the isolation actually holds**

Run: `npx jest --listTests | grep -c canary`
Expected: `0` — the canary is invisible to the default project.

Run: `npm test`
Expected: PASS, and the canary suite is **not** among the suites run.

Run: `npm run test:canary`
Expected: PASS, 2 tests.

- [ ] **Step 8: Point `lib/hibp.ts` at its canary**

The file's header already carries an "Operational note for later". Add a second one directly
beneath it so the next reader of this module knows its live health is watched. Insert after the
existing `Operational note` paragraph (ending `...sitting in crash-report breadcrumbs tied to
their account.`), before the closing `*/`:

```
 *
 * This function fails open and never logs, which makes it silently unobservable in production
 * (issue #74). Its live-endpoint health is therefore watched from outside, by
 * `lib/__tests__/hibp.canary.test.ts` on a daily cron (`.github/workflows/hibp-canary.yml`):
 * that canary runs THIS function against the real range API and files an issue when it rots.
 * If you change this file's parsing, response handling, or the range-API URL, the canary is
 * what tells you whether it still works against the real thing.
```

- [ ] **Step 9: Full gate, then commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean, no network required.

```bash
git add jest.canary.config.js jest.config.js package.json lib/__tests__/hibp.canary.test.ts lib/hibp.ts
git commit -m "test: live-API canary for the HIBP check, isolated from the commit gate (refs #74)

lib/hibp.ts fails open and never logs, so a broken HIBP endpoint would
silently pass every signup forever. This runs the real shipped
checkPasswordBreached against the live range API, asserting a known-breached
password still comes back breached and a random one still comes back safe --
both rejecting 'unavailable'.

Mocks only expo-crypto's native digest (a real node:crypto SHA-1 returning
lowercase hex, as the native module does), so the uppercase normalization is
proven end-to-end against a live response.

Runs under jest.canary.config.js only; jest.config.js ignores it so npm test
stays hermetic and offline.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: The daily workflow and its self-healing alarm

**Files:**
- Create: `.github/workflows/hibp-canary.yml`

**Interfaces:**
- Consumes: `npm run test:canary` from Task 1 (exit 0 = healthy, non-zero = rot).
- Produces: a labelled (`security`, `hibp-canary`) GitHub issue on sustained failure, closed
  automatically on recovery.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/hibp-canary.yml`. This is the repo's first CI workflow.

```yaml
# Live-endpoint canary for the HIBP leaked-password check (issue #74).
#
# lib/hibp.ts fails open by design and deliberately never logs, so if HIBP changes its
# content-type, Cloudflare starts challenging us, or our egress gets rate-limited, every signup
# would silently pass the check forever with nothing to show for it. This is the thing that
# notices.
#
# It does NOT gate PRs: a live-network required check would make every unrelated PR flaky.
name: HIBP canary

on:
  schedule:
    # 07:00 UTC daily. The check is an interim, bypassable-by-design control, so a detection
    # latency of up to a day is acceptable; a tighter cron just burns a third party's bandwidth.
    - cron: '0 7 * * *'
  workflow_dispatch:

# Never let two runs race to open/close the same issue.
concurrency:
  group: hibp-canary
  cancel-in-progress: false

permissions:
  contents: read
  issues: write

jobs:
  canary:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - run: npm ci

      # Three attempts with backoff. A canary hitting a live third-party API WILL occasionally
      # blip, and one that cries wolf gets muted -- which lands us right back at an unobservable
      # control. Only sustained failure counts as rot. This step always exits 0; the outcome is
      # carried in its output so the steps below can act on it.
      - name: Run the canary (3 attempts)
        id: canary
        run: |
          for attempt in 1 2 3; do
            echo "::group::Canary attempt ${attempt}/3"
            if npm run test:canary; then
              echo "::endgroup::"
              echo "result=pass" >> "$GITHUB_OUTPUT"
              exit 0
            fi
            echo "::endgroup::"
            if [ "${attempt}" -lt 3 ]; then
              backoff=$((attempt * 60))
              echo "Attempt ${attempt} failed. Sleeping ${backoff}s before retrying."
              sleep "${backoff}"
            fi
          done
          echo "result=fail" >> "$GITHUB_OUTPUT"
          exit 0

      # Idempotent: `--force` makes this a no-op when the label already exists, so the workflow
      # is self-contained and does not depend on a label having been created by hand.
      - name: Ensure the canary label exists
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh label create hibp-canary \
            --color B60205 \
            --description "Raised automatically by the HIBP live-endpoint canary" \
            --force

      - name: Open or update the alarm issue
        if: steps.canary.outputs.result == 'fail'
        env:
          GH_TOKEN: ${{ github.token }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: |
          existing="$(gh issue list --label hibp-canary --state open --limit 1 --json number --jq '.[0].number // empty')"

          body="$(cat <<EOF
          The HIBP live-endpoint canary failed **3 consecutive attempts**, so this is sustained
          rot rather than a transient blip.

          **What this means:** \`lib/hibp.ts\` fails open. Right now, every sign-up is very
          likely passing the leaked-password check regardless of whether the password is
          breached — silently, with no user-visible symptom. The control is effectively off.

          **Likely causes**, in the order worth checking:
          - HIBP changed the range API's content-type (the check requires \`text/plain\`)
          - Cloudflare is challenging our requests (an HTTP 200 HTML challenge page)
          - our egress IP is being rate-limited
          - the range API's response shape changed

          **Reproduce locally:** \`npm run test:canary\`

          Failing run: ${RUN_URL}
          Design: \`docs/superpowers/specs/2026-07-12-hibp-canary-design.md\`
          Refs #70, #74
          EOF
          )"

          if [ -n "${existing}" ]; then
            gh issue comment "${existing}" --body "Still failing as of ${RUN_URL}"
          else
            gh issue create \
              --title "HIBP canary is red — the leaked-password check has silently stopped working" \
              --label hibp-canary \
              --label security \
              --body "${body}"
          fi

      # Self-healing: recovery closes the alarm, so a stale red issue never accumulates and the
      # signal keeps meaning something.
      - name: Close the alarm issue on recovery
        if: steps.canary.outputs.result == 'pass'
        env:
          GH_TOKEN: ${{ github.token }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        run: |
          existing="$(gh issue list --label hibp-canary --state open --limit 1 --json number --jq '.[0].number // empty')"
          if [ -n "${existing}" ]; then
            gh issue close "${existing}" \
              --comment "Canary is green again as of ${RUN_URL} — the HIBP check is working. Closing automatically."
          fi

      # Surface the failure in the Actions tab too, not just as an issue.
      - name: Fail the job if the canary is red
        if: steps.canary.outputs.result == 'fail'
        run: exit 1
```

- [ ] **Step 2: Lint the YAML by parsing it**

There is no YAML linter in this repo, so parse it to catch a syntax error before pushing:

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/hibp-canary.yml','utf8');if(!s.includes('test:canary'))throw new Error('script ref missing');console.log('read OK,',s.split('\n').length,'lines')"`
Expected: `read OK, <n> lines`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/hibp-canary.yml
git commit -m "ci: daily HIBP canary workflow with a self-healing alarm (refs #74)

Runs the live-API canary on a daily cron. Retries 3x with backoff so a
transient blip does not cry wolf -- a canary that cries wolf gets muted, which
is the same failure as having none. Sustained failure opens (or updates) a
labelled security issue; recovery closes it automatically.

Deliberately does not gate PRs: a live-network required check would make every
unrelated PR flaky.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 4: Know what cannot be verified until this is on `main`**

GitHub only runs `schedule` and `workflow_dispatch` workflows from the **default branch**. The
workflow therefore cannot be triggered from this branch or its PR. After the PR merges, run
`gh workflow run "HIBP canary"` and then `gh run watch` to confirm it goes green. Record this
as the post-merge verification step — do not claim the workflow works before then.

---

### Task 3: Rewrite issue #74 and reconcile the docs

**Files:**
- Modify: `docs/change_log.md` (prepend a dated entry)
- Modify: `docs/status.md`
- Modify: `docs/architecture.md`
- Modify: `docs/privacy-checklist-m7.md`
- Modify: `docs/blocked-on-apple.md` (the `#74` bullet, ~line 212)
- Rewrite: GitHub issue #74 (via `gh`)

**Interfaces:**
- Consumes: the shipped canary from Tasks 1 and 2.
- Produces: no code. This task exists so the *next* person to touch observability does not
  reach for Sentry and quietly undo the leak-safety of `lib/hibp.ts`.

- [ ] **Step 1: Narrow issue #74 rather than closing it**

The endpoint-side majority is now covered; the device-side residue is not. Rewrite the issue so
it describes only what remains, and so it carries the Sentry warning.

```bash
gh issue edit 74 \
  --title "HIBP fail-open: device-side failures are still undetectable (endpoint-side now covered by the canary)" \
  --body "$(cat <<'EOF'
## What changed

A daily live-API canary now covers the **endpoint-side** half of this issue
(`.github/workflows/hibp-canary.yml`, `lib/__tests__/hibp.canary.test.ts`). It runs the real
`checkPasswordBreached` against the live Pwned Passwords range API and files an issue when it
rots — so a content-type change, a Cloudflare challenge, an egress rate-limit, or a response
shape change is now detected within a day, with **zero user data collected**.

That covers three of the four failure modes this issue originally listed.

## What is still open

The canary runs from a GitHub runner: different IP, different user-agent, no captive portal. It
cannot see:

- a **captive portal** on an individual user's Wi-Fi intercepting the request
- **Cloudflare specifically challenging React Native's user-agent** while happily serving CI

Both are genuinely device-side and need per-user telemetry to observe — the privacy-safe status
counter this issue originally proposed:

\`\`\`
{ event: 'hibp_check', status: 'safe' | 'breached' | 'unavailable' }
\`\`\`

The status is ~3 bits and is not password-derived, so it is safe to emit. Alert if the
`unavailable` rate stays high over a rolling window.

## Read this before adding an observability stack

**Sentry (or any crash SDK) is actively contraindicated here** — this is not a free choice of
vendor:

- `lib/hibp.ts`'s header spells it out: crash SDKs capture breadcrumbs of outbound request
  URLs, and every HIBP request URL **contains the 5-char SHA-1 prefix of the user's password**.
  Adding Sentry without configuring `denyUrls` / `beforeBreadcrumb` to drop
  `api.pwnedpasswords.com` would turn crash reports into a durable, identity-linked 20-bit
  fingerprint of every user's password. The observability tool would degrade the very property
  the control exists to protect.
- `docs/app-store-privacy-labels.md` currently answers **\"No, we do not track users\"** and
  declares no crash/analytics SDK. `docs/privacy-checklist-m7.md` carries a standing
  re-audit-on-SDK-landing requirement. Any telemetry here forces that re-audit.

A first-party anonymous counter (e.g. aggregate `{day, status, count}` rows in Supabase, no
identifiers) is the cheaper path and avoids a third-party SDK entirely — but it needs an
anon-writable surface, so it must be designed with abuse/spam in mind.

Still deferred to whenever `observability-setup` work happens. Refs #70, #73.
Design: `docs/superpowers/specs/2026-07-12-hibp-canary-design.md`
EOF
)"
```

- [ ] **Step 2: Correct the `#74` line in `docs/blocked-on-apple.md`**

Replace the existing bullet (~line 212):

```markdown
- **#74** — needs an **observability stack** to exist before the HIBP fail-open can be made detectable.
```

with:

```markdown
- **#74** — **partially resolved 2026-07-12.** The endpoint-side half is now covered by a daily
  live-API canary (`.github/workflows/hibp-canary.yml`) that needs no observability stack and
  collects no user data. Only the device-side residue (captive portals, Cloudflare challenging
  React Native's user-agent) still needs an **observability stack**. Note that **Sentry is
  actively contraindicated** for it — its breadcrumbs would fingerprint the very passwords the
  check protects; see the issue.
```

- [ ] **Step 3: Record the canary in `docs/privacy-checklist-m7.md`**

This exists so a future privacy audit does not mistake CI traffic for user telemetry and
re-open the App Store label question. Append to the HIBP section of that file:

```markdown
**The HIBP canary collects no user data.** `.github/workflows/hibp-canary.yml` runs
`lib/__tests__/hibp.canary.test.ts` daily against the live Pwned Passwords range API. The only
two strings it ever hashes are the public test vector `password` and a fresh random UUID. It
runs on a GitHub runner, not on a user's device; it transmits nothing about any user; and it
adds no SDK to the app bundle. It therefore does **not** change any App Store privacy-label
answer, and "No, we do not track users" remains correct.
```

- [ ] **Step 4: Append the change-log entry**

Add a dated entry to `docs/change_log.md`, matching the file's existing entry format:

```markdown
## 2026-07-12 — HIBP fail-open is now observable (refs #74)

`lib/hibp.ts` fails open and deliberately never logs, which made the leaked-password check
silently unobservable: if HIBP's endpoint rotted, every sign-up would pass the check forever
with nothing to show for it.

- **Added** `lib/__tests__/hibp.canary.test.ts` — a live-network canary that runs the real
  shipped `checkPasswordBreached` against the live Pwned Passwords range API, asserting a
  known-breached password still returns `breached` and a random one still returns `safe`. Both
  reject `unavailable`. It mocks only `expo-crypto`'s native digest (a real `node:crypto` SHA-1
  returning lowercase hex, as the native module does), so the uppercase normalization is proven
  end-to-end against a live response.
- **Added** `jest.canary.config.js` + `npm run test:canary`, and excluded `*.canary.test.ts`
  from `jest.config.js`, so `npm test` stays hermetic and offline.
- **Added** `.github/workflows/hibp-canary.yml` — the repo's first CI workflow. Daily cron,
  3 attempts with backoff (a canary that cries wolf gets muted), opens/updates a labelled
  `security` issue on sustained failure and auto-closes it on recovery.
- **Narrowed** issue #74 to the device-side residue only, recording that **Sentry is actively
  contraindicated** here: its breadcrumbs would fingerprint the very passwords the check
  protects.
- **No user data is collected** and no SDK was added — the App Store privacy-label answers are
  unchanged.
```

- [ ] **Step 5: Note CI in `docs/status.md` and `docs/architecture.md`**

In `docs/status.md`, note under the relevant milestone that the repo now has CI (one scheduled
workflow, no PR gate). In `docs/architecture.md`, add the workflow to the current-state
description — the repo previously had no CI at all, so this is a genuine change to the system
picture, not a "planned" item.

- [ ] **Step 6: Gate and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean.

```bash
git add docs/
git commit -m "docs: record the HIBP canary; narrow #74 to the device-side residue

Notes that Sentry is actively contraindicated for the remaining telemetry work
-- its breadcrumbs would fingerprint the very passwords lib/hibp.ts protects --
so whoever picks up observability-setup does not naively reach for it.

Records that the canary collects no user data, so the App Store privacy-label
answers are unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Review and ship

**Files:** none (review + PR).

- [ ] **Step 1: Security review**

The canary observes a security control and touches a file whose leak-safety rules are strict.
Dispatch `security-auditor`° over the diff. It must specifically confirm: no hash, prefix, or
password is ever logged; no user data leaves any device; `lib/hibp.ts`'s runtime behavior is
byte-for-byte unchanged (comment-only edit); and the workflow's `GITHUB_TOKEN` permissions are
minimal (`contents: read`, `issues: write`).

- [ ] **Step 2: Code review**

Dispatch `code-reviewer`° over the full diff.

- [ ] **Step 3: Open the PR**

Per `CLAUDE.md` § Git etiquette, this is multi-file and security-adjacent, so it goes through a
PR rather than straight to `main`. Use `github-ops`.

- [ ] **Step 4: Post-merge verification — the plan is not done until this passes**

Scheduled workflows only run from the default branch, so this is the first moment the workflow
can actually execute:

```bash
gh workflow run "HIBP canary"
gh run watch
```

Expected: green, 2 tests passed. Until this runs green on `main`, the canary is unproven in the
place it actually has to work.

---

## Self-review notes

- **Spec coverage:** canary test (Task 1), hermetic-gate isolation (Task 1 Steps 5–7), workflow
  + anti-flake + self-healing issue (Task 2), the "cannot go red" acceptance criterion (Task 1
  Step 4), #74 rewrite and all five doc files (Task 3), the security/privacy review (Task 4).
  Every spec section maps to a task.
- **Success criterion 4** ("workflow runs green on `workflow_dispatch`") is only satisfiable
  post-merge; that is called out explicitly in Task 2 Step 4 and Task 4 Step 4 rather than being
  silently claimed.
- **Naming consistency:** `npm run test:canary` and `jest.canary.config.js` are referenced
  identically in Tasks 1, 2, and 3.
