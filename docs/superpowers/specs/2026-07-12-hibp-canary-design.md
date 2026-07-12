# HIBP fail-open detection: a live-API canary

**Issue:** #74 — "Fail-open in the HIBP password check is undetectable"
**Date:** 2026-07-12
**Status:** approved, ready for implementation plan

## Problem

`lib/hibp.ts` fails open by design: when the HaveIBeenPwned range API is unreachable or
returns something unexpected, `checkPasswordBreached` returns `{ status: 'unavailable' }`, and
`app/(auth)/sign-in.tsx` lets the signup proceed. The file also never logs, deliberately — a
hash prefix in a crash-report breadcrumb would be a password disclosure.

Individually both choices are right. Together they make the control **unobservable**: if HIBP
changes its content-type, Cloudflare starts challenging us, our egress gets rate-limited, or a
captive portal intercepts the request, every signup silently passes the check forever and
nothing fires. #70 stays open on the explicit assumption that this interim control works in
production.

## Why the issue's own suggested fix is the wrong first move

#74 proposes emitting a `{ event: 'hibp_check', status }` counter once an observability stack
exists. That path is more expensive than it looks:

- `docs/app-store-privacy-labels.md` answers **"No, we do not track users"** and declares *App
  info and performance: Not collected (no crash/analytics SDK)*.
- `docs/privacy-checklist-m7.md` carries a standing "re-audit the moment an analytics or crash
  SDK lands".
- `lib/hibp.ts`'s own header warns that a crash SDK (Sentry) is **precisely** what would turn
  the range-API request URL into a durable, identity-linked 20-bit fingerprint of a user's
  password in breadcrumbs.

So reaching for Sentry to observe this control would degrade the very property the control
exists to protect.

Meanwhile, **three of the four failure modes #74 lists are properties of the HIBP endpoint, not
of any user's session**: a content-type change, a Cloudflare challenge, a rate-limit on our
egress. Endpoint rot is detectable with zero user data. That is what this spec builds.

## What we build

A scheduled canary that runs the **real shipped `checkPasswordBreached`** against the **live**
HIBP range API and fails loudly when it stops working.

### 1. The canary test

`lib/__tests__/hibp.canary.test.ts`.

The value hinges on exercising the actual shipped function. A reimplementation of the HIBP
protocol inside the canary would drift from `lib/hibp.ts` and prove nothing about the code that
ships.

Therefore exactly **one** thing is substituted: `expo-crypto`'s `digestStringAsync`, a native
module that cannot run in CI. It is replaced with a `node:crypto` SHA-1 shim that returns
**lowercase** hex — exactly as the real native module does on device. Nothing else is mocked.
Live `fetch`, the content-type guard, the single retry, the 4s shared `AbortController`
deadline, the `\r?\n` split, the `Add-Padding` count-0 row filter, and the uppercase
normalization all run for real. The canary therefore re-proves the lowercase/uppercase fix
end-to-end against HIBP's live response — the exact class of silent, permanent no-op the issue
is about.

Two assertions per run:

| Input | Required result | What its failure means |
|---|---|---|
| `password` (public test vector, SHA-1 `5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8`) | `{ status: 'breached', count > 0 }` | The load-bearing assertion. A challenge page, a content-type change, a rate-limit, or any parse breakage all collapse to `unavailable` or `safe` here. |
| A freshly generated random string (e.g. `crypto.randomUUID()`) | `{ status: 'safe' }` — **not** `unavailable` | Proves the parser positively read well-formed rows, rather than the check having quietly degraded to "everything is fine". |

Both assertions must reject `unavailable`. The only two strings the canary ever hashes are a
public test vector and a random UUID: **no user data is involved.**

### 2. Keeping `npm test` hermetic

`CLAUDE.md` requires a clean `typecheck && lint && test` before every commit. A live-network
test inside the default `npm test` would make that gate depend on a third party's uptime and on
the developer having a network connection.

So the canary is a **separate jest project**:

- `jest.canary.config.js` — `testEnvironment: 'node'` (Node 24 provides real global `fetch` and
  `AbortController`; the default `jest-expo` environment does not), matching only
  `**/*.canary.test.ts`.
- `npm run test:canary` — the new script that runs it.
- `jest.config.js` — gains a `testPathIgnorePatterns` entry for `*.canary.test.ts`, so the
  offline commit gate never runs it.

### 3. The alarm

`.github/workflows/hibp-canary.yml` — the repo's first CI workflow. Daily `schedule` cron plus
`workflow_dispatch` for manual runs.

**Anti-flake is the crux.** A canary hitting a live third-party API will occasionally blip, and
one that cries wolf gets muted — which puts us straight back at an unobservable control. The
job therefore retries the canary up to **three times with backoff**, and only a *sustained*
three-strike failure counts as rot.

On sustained failure the workflow **opens — or updates, if one is already open — an issue**
labelled `security`, naming which assertion broke. When the canary next passes, it comments on
that issue and **auto-closes** it. The signal self-heals and never accumulates stale noise.
Requires `issues: write` on the workflow's `GITHUB_TOKEN`.

Chosen over relying on GitHub's failure email alone: an email is easy to filter into oblivion,
and a canary nobody reads reproduces the exact bug in #74.

**Explicitly not doing:** gating PRs on the canary. A live-network required check would make
every unrelated PR flaky.

## What the canary cannot see

It runs from a GitHub runner — different IP, different user-agent, no captive portal. Two
failure modes from #74 stay invisible:

- a captive portal on an individual user's Wi-Fi
- Cloudflare specifically challenging **React Native's** user-agent

Both are genuinely device-side and do need per-user telemetry. They are the residue, not the
bulk.

## Documentation changes

- **#74 is rewritten, not closed.** Narrowed to the residual device-side gap above, still
  deferred to `observability-setup`, and updated with the finding that **Sentry is actively
  contraindicated** here by `lib/hibp.ts`'s header — so whoever picks up observability does not
  naively reach for it. It also records that the endpoint-side majority is now covered by the
  canary.
- `docs/blocked-on-apple.md:212` — same correction to the one-line #74 entry.
- `docs/privacy-checklist-m7.md` — a line recording that the canary exists and transmits **no
  user data**, so a future privacy audit does not mistake CI traffic for telemetry and re-open
  the App Store label question.
- `docs/change_log.md` — dated entry.
- `docs/status.md` / `docs/architecture.md` — note that CI now exists (one scheduled workflow).

## Success criteria

1. `npm run test:canary` passes against the live API today.
2. The canary is proven to actually *fail* when the endpoint is unreachable — not silently
   pass. `lib/hibp.ts` hardcodes the range-API URL, so this is verified by running the canary
   with no network: it must exit non-zero (`unavailable` fails both assertions), never green.
   A canary that can only ever pass is the bug in #74 wearing a different hat.
3. `npm run typecheck && npm run lint && npm test` stays clean **with no network access** —
   proving the canary did not leak into the commit gate.
4. The workflow runs green on `workflow_dispatch`.
5. A deliberately failing canary run opens a labelled issue; a subsequent green run closes it.

## Update — 2026-07-12: a second, read-only assertion for the server-side setting (issue #70)

This spec originally watched exactly one thing: `lib/hibp.ts`'s live endpoint health, because
that client-side check was the *only* control in production — issue #70 was blocked on Supabase
Pro, so server-side enforcement did not exist yet. That premise changed the same day, later in
the pass: the org moved to Pro, `password_hibp_enabled = true` was applied live, and issue #70
closed. The client-side check in this spec is no longer the enforcement point — see
`docs/superpowers/specs/2026-07-12-hibp-password-check-design.md`'s own outcome section.

That created a new, worse-than-before observability gap this spec did not originally cover: the
*authoritative* control (the server-side setting) had **no monitor at all**, while the
now-secondary, bypassable, fail-open convenience check had a daily one. The setting is
Pro-plan-gated, so a billing lapse, a plan downgrade, or a stray Dashboard toggle silently
reverts it — and `lib/hibp.ts` fails open by design (this is exactly the class of bug this whole
spec exists to catch), so it would not notice a server-side revert on its own. Nothing else in
the repo can observe this setting either: the Supabase CLI has no `config.toml` key for it, so
the config file cannot reconcile drift the way it does for `minimum_password_length`.

`.github/workflows/hibp-canary.yml` therefore gained a second, independent step in the same job:

- **Read-only, deliberately.** It GETs `/v1/projects/{ref}/config/auth` via the Management API
  and asserts `password_hibp_enabled === true`. The obvious alternative — attempt a real signup
  with a known-breached password and assert it's rejected, mirroring how the client canary
  proves its endpoint — is a trap here: in the exact failure mode this step exists to catch
  (protection is off), that probe *succeeds* and creates a real, autoconfirmed account on the
  production project with a breached password. A monitor must not be able to cause the harm it
  watches for. A config GET cannot.
- **A separate, distinctly-titled alarm issue** (`SERVER_TITLE`, not `CANARY_TITLE`) from the
  client canary's, opened/updated/closed with the same self-healing pattern. Kept distinct on
  purpose: the client canary going red means the pre-check rotted; this step going red means the
  actual enforcement is gone. Collapsing them into one issue would let either mask the other.
- **Needs a `SUPABASE_ACCESS_TOKEN` repo secret** (a Supabase personal access token) to call the
  Management API. That secret does not exist in this repo yet (confirmed via `gh secret list` —
  empty). Until Ian adds it, the step deliberately fails the job (`result=unarmed`) rather than
  passing green, on the same principle the rest of this spec is built on: a monitor that
  silently does nothing must never be mistaken for coverage. Adding the secret is the one
  remaining step to arm it; see `docs/status.md`'s Known Issues.
- **Not a probe against `lib/hibp.ts`.** This step is entirely independent of the client-side
  canary above — different target (hosted Management API vs. the public HIBP range API),
  different failure semantics (a stray `unknown`/unreachable Management API call is treated as
  `unknown` and never files an alarm on the strength of a failed HTTP call alone, same
  fail-safe-on-ambiguity principle as `## What the canary cannot see` above).

This does not change the original "What we build" section's design or its success criteria —
the client-endpoint canary still exists, is still read-only, still excluded from `npm test`,
and still self-heals the same way. It is additive: the job now has two independent watchers for
two independent controls.

## Agent routing (per AGENTS.md)

MEDIUM severity — multi-file, adds CI, adjacent to a security control but modifies no
auth/RLS/schema/edge-function code. Chain: `feature-planner`° → `implementer` (+ `cicd-setup`
for the workflow) → `test-writer`/`verifier` → `security-auditor`° (cheap insurance: it is a
security control's observability) + `code-reviewer`° → `doc-writer` → `github-ops` for the PR.
