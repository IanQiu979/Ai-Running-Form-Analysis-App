# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

This project is pinned to Expo SDK 57 (`expo ^57.0.9`). Docs for a newer SDK describe APIs
this project does not have. If you upgrade the SDK, update this link in the same commit.

# Agent routing

`CLAUDE.md` (which imports this file) holds the **rules**; this file holds **who does the work**.
Every agent below inherits those rules. Agents marked ° are read-only: they report, never edit.

## Subagent Usage Policy

**Mandatory delegation.** Claude Code must not silently do multi-step or ambiguous work itself.
Before starting any task, classify its severity with the table below and route to the required
subagent workflow for that tier. Only a genuinely trivial, one-line task — a typo fix, a single
config value, answering a question from context already in hand — may be handled directly, with
no subagents.

**Severity classification.**

| Tier | Looks like (this project) | Required minimum |
|---|---|---|
| **LOW** | Single-file, no schema/API change, easily reversible — e.g. restyle one existing screen with tokens already in `constants/theme.ts`, fix an obvious one-line bug in a `lib/` helper, edit copy on one screen | Proceed directly, or with at most 1 subagent: the relevant implementation agent (e.g. `frontend-builder`, `debugger`) |
| **MEDIUM** | Multi-file, a new feature, a refactor touching shared code, anything that could change existing behavior — e.g. add a new screen + route and wire it into navigation, extend a shared `lib/` type used by both app and edge functions, refactor a component several screens depend on | `feature-planner`°/`bug-planner`° → implementation subagent(s) (see "Build"/"Design" below) → `verifier` (+ `test-writer` for new `lib/` logic) → `doc-writer` if user-facing behavior changed |
| **HIGH/CRITICAL** | Schema/migrations, auth/security-sensitive code, production config, cross-service changes, anything the user flags as risky — and specifically this project's existing hot list: **auth, RLS, payments, uploaded media, edge functions, schema, the `analyze-form` flow** | Full chain, next paragraph |

**HIGH/CRITICAL full chain** — every slot is required unless the user overrides one in the same
message that requests the work:

1. Plan — `feature-planner`°, `bug-planner`°, or `migration-planner`° (pick by what triggered the work)
2. Design/architecture review — `system-architect`°, `api-designer`°, and/or `threat-modeler`° for anything crossing a trust boundary
3. Implement — the domain agent(s) below (e.g. `database-engineer` for schema/RLS, `jobs-queues-edge` + `ai-feature-builder` for `analyze-form`, `supabase-auth` for auth)
4. Test — `test-writer` + `verifier`
5. Security/review — `security-auditor`° (mandatory for anything on the hot list) + `code-reviewer`°
6. Docs — `doc-writer`
7. Final verification/QA — `verifier` + `scope-guard`

**Subagent selection logic.** Severity tells you how many steps run; this table (plus the
routing tables below it) tells you which agent fills each one — a lookup, not a guess. ° marks
a read-only agent: it reports, never edits.

| Category | Agents | Full list |
|---|---|---|
| Planning (read-only) | `task-router`°, `market-research`°, `product-strategist`, `spec-writer`, `system-architect`°, `api-designer`°, `feature-planner`°, `bug-planner`°, `migration-planner`°, `threat-modeler`°, `test-strategist`°, `caching-strategist`°, `codebase-explorer`°, `adr-writer`, `diagram-generator` | "Plan & decide" |
| Design (UI/visual) | `ui-designer`, `design-system`, `frontend-builder`, `motion-animation`, `responsive-crossdevice`, `accessibility-implementer`, `accessibility-reviewer`°, `ux-copywriter` | "Design" |
| Implementation — UI/client, framework | `frontend-builder`, `i18n-localization`, `framework-upgrader` | "Build" |
| Implementation — app logic | `implementer`, `debugger`, `refactorer` | "Build" |
| Implementation — database/RLS | `database-engineer` | "Build" |
| Implementation — edge/jobs | `jobs-queues-edge` | "Build" |
| Implementation — AI/LLM (`analyze-form`) | `ai-feature-builder`, `prompt-engineer`, `llm-eval`, `rag-retrieval` | "Build" |
| Implementation — integrations | `integration-builder`, `mcp-integration-wiring` | "Build" / "Config & setup" |
| Implementation — config/tooling/env/auth | `env-config-manager`, `supabase-auth`, `config-manager`, `tooling-setup`, `project-bootstrapper` | "Config & setup" |
| Testing | `test-writer`, `mocks-testdata`, `seed-data`, `e2e-browser-tester`, `load-tester` | "Test" |
| Review/security (read-only) | `code-reviewer`°, `security-auditor`°, `privacy-compliance`°, `coverage-analyst`°, `tech-debt-tracker`°, `scope-guard` | "Verify & review" |
| Docs | `doc-writer` | "Config & setup" |
| QA/verification | `verifier`, `scope-guard` | "Verify & review" |
| Ship/operate | `github-ops`, `release-versioning`, `mobile-release`, `cicd-setup`, `feature-flag-rollout`, `incident-responder`, `uptime-healthcheck`, `observability-setup`, `analytics-instrumentation`, `mobile-perf-optimizer`, `ai-cost-optimizer`, `dependency-auditor`, `notifier` | "Ship & operate" / "Config & setup" |
| Observe/analyze (read-only) | `log-analyzer`°, `profiler`°, `cost-monitor`° | "Ship & operate" |

When two categories could plausibly apply, use the more specific one — an RLS change is
"database/RLS", not generic "app logic".

**Escalation.** Unsure which tier applies? Default to the higher tier, never the lower one.
Re-classify mid-task if new information raises the blast radius (e.g. a "single screen" edit
turns out to need a new RLS policy).

## Plan & decide (all read-only)

| Need | Agent |
|---|---|
| Route a vague request to the right agents | `task-router`° |
| Scan a market, set the roadmap, write the PRD | `market-research`° → `product-strategist` → `spec-writer` |
| System boundaries and client-vs-server · endpoint contracts | `system-architect`° · `api-designer`° |
| File-by-file plan for a feature in this codebase | `feature-planner`° |
| Vague symptom, no confirmed root cause | `bug-planner`° |
| Blast radius of an SDK/framework bump | `migration-planner`° |
| Enumerate what an attacker could do, pre-code | `threat-modeler`° |
| What to test, at which level · what to cache and when to bust | `test-strategist`° · `caching-strategist`° |
| Map an unfamiliar codebase | `codebase-explorer`° (cheap lookups: built-in `Explore`) |
| Record a decision / draw the system | `adr-writer`, `diagram-generator` |

## Build

| Need | Agent |
|---|---|
| Execute a written plan | `implementer` |
| UI components and screens | `frontend-builder` |
| Fix a diagnosed break · clean up with zero behavior change | `debugger` · `refactorer` |
| Schema, migrations, RLS (incl. the private media bucket) | `database-engineer` |
| Edge functions, cron, background jobs | `jobs-queues-edge` |
| The `analyze-form` LLM flow, server-side only | `ai-feature-builder` |
| Its prompt · score its output · retrieval | `prompt-engineer` · `llm-eval` · `rag-retrieval` |
| Third-party SDKs (payments, push, health) | `integration-builder` |
| Execute an Expo SDK / RN major upgrade | `framework-upgrader` (plan it first) |
| Extract strings, plurals, RTL | `i18n-localization` |

## Design

`ui-designer` picks the visual direction · `design-system` owns `constants/theme.ts` tokens and
primitives · `frontend-builder` writes the components · `motion-animation` for transitions ·
`responsive-crossdevice` for sizes, safe areas, orientation · `accessibility-implementer` builds
a11y in (`accessibility-reviewer`° audits it) · `ux-copywriter` for in-app copy.

## Verify & review

| Need | Agent |
|---|---|
| Get `typecheck && lint && test` clean after any edit | `verifier` |
| Review a nontrivial diff before commit | `code-reviewer`° |
| Auth, payments, media, public API · what personal data we disclose | `security-auditor`° · `privacy-compliance`° |
| Uncovered code that matters · what's rotting, what to pay down | `coverage-analyst`° · `tech-debt-tracker`° |
| Did the builder stray outside the planned files | `scope-guard` |

## Test

`test-writer` (after any nontrivial change) · `mocks-testdata` for fixtures · `seed-data` for a
dev/staging DB · `e2e-browser-tester` (RN ⇒ Maestro/Detox, not a browser) · `load-tester`.

## Ship & operate

| Need | Agent |
|---|---|
| Commit, push, PR, issues, branch cleanup | `github-ops` (see CLAUDE.md § Git etiquette) |
| Bump version and changelog, then build and submit | `release-versioning` → `mobile-release` |
| GitHub Actions gates · flags, staged rollout, kill switches | `cicd-setup` · `feature-flag-rollout` |
| Production is on fire → read the logs → postmortem | `incident-responder`, `log-analyzer`° |
| Health checks and SLOs · Sentry, logging, alert rules | `uptime-healthcheck` · `observability-setup` |
| Funnel and activation events | `analytics-instrumentation` |
| Find hotspots then fix · watch spend then cut tokens | `profiler`° → `mobile-perf-optimizer` · `cost-monitor`° → `ai-cost-optimizer` |
| CVEs and stale deps | `dependency-auditor` |

## Config & setup

`env-config-manager` owns `.env`, `EXPO_PUBLIC_*`, and `ANTHROPIC_API_KEY` placement — read
CLAUDE.md § Secrets first · `supabase-auth` for OAuth, PKCE, deep links, auth-keyed RLS ·
`config-manager` for `.claude/settings.json` and hooks · `tooling-setup` for eslint/tsconfig ·
`project-bootstrapper` for a new repo · `mcp-integration-wiring` for MCP servers ·
`doc-writer` to update `docs/change_log.md`, `status.md`, `architecture.md` after a change ·
`notifier` to ping macOS when long work finishes · `statusline-setup` for the status line.

Built-ins: `Explore`° and `Plan`° for cheap search and planning; `general-purpose` only when
nothing above fits. Ignore the `vercel:*` agents — this is an Expo/Supabase app, not a Vercel one.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
