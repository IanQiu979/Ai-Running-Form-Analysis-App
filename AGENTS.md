# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

This project is pinned to Expo SDK 54 (`expo ~54.0.34`). Docs for a newer SDK describe APIs
this project does not have. If you upgrade the SDK, update this link in the same commit.

# Agent routing

`CLAUDE.md` (which imports this file) holds the **rules**; this file holds **who does the work**.
Every agent below inherits those rules. Agents marked ° are read-only: they report, never edit.

## How much process to run

Severity decides how many steps run — not how many files change. A one-file edit can be Large.
Spawning a subagent is the *expensive* path (it starts cold and re-derives context), so small
work goes inline; delegate it only when it is isolated and you want this context kept clean.

| Tier | Looks like | Run |
|---|---|---|
| **Trivial** | typo, copy, comment, constant, one obvious line | Just edit it. No plan, no review. |
| **Small** | contained, behavior obvious, no new surface | Edit → `verifier`. Stop there. |
| **Large** | new surface, multi-file, **or any change to** auth, RLS, payments, uploaded media, edge functions, schema, the `analyze-form` flow — however few files it touches | plan° → build → `verifier` → `code-reviewer`° → `doc-writer`, plus `security-auditor`° for anything in that list |

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
