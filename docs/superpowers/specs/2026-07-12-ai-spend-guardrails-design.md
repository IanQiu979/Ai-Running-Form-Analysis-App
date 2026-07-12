# AI spend guardrails — design

**Issue:** [#91](https://github.com/IanQiu979/v2.3_RunningFormAna/issues/91) — no spend ceiling and
no kill switch on the Anthropic path.
**Date:** 2026-07-12
**Severity:** HIGH (hot list: edge functions, schema, the `analyze-form` flow)

## The problem

Per-user spend is bounded — `reserve_analysis` caps Free at 1 lifetime analysis. Spend is therefore a
function of **account count**, and issue #48 establishes that account count is **unbounded**: the hosted
project has no signup rate-limit field, `mailer_autoconfirm` is on, and CAPTCHA is blocked. #48's own
conclusion is that it blocks M4 going *live*, not the M4 build — so M4 is expected to land with that hole
open, and there is nothing behind it: no spend ceiling, no global cap, no breaker, and no way to turn
`analyze-form` off without a redeploy.

### What a farm actually costs

`claude-sonnet-5` is $3.00/M input and $15.00/M output (list; $2/$10 introductory through 2026-08-31).
Frames are capped at 1568px on the long edge (`docs/architecture.md`, media pipeline), so each frame is
≤ ~1600 image tokens.

| Tier | Frames | Rough worst-case per analysis |
|---|---|---|
| Free | 1 | ~$0.05 |
| Pro | 5 | ~$0.13 |
| Elite | 8 | ~$0.20 |

500 fake accounts each burning their one free lifetime analysis is about **$25** — per farm run, with
account creation unbounded and nothing rate-limiting the runs.

## Scope

**Guardrail substrate only.** `analyze-form` does not exist yet (M4 is Not Started; there are no edge
functions at all). This is deliberate sequencing, not a workaround: building the brake *before* the thing
that spends money means M4 cannot land without it. M4 is not built here.

Issue #91 closes when the substrate ships. M4 inherits a binding contract, recorded in
`docs/architecture.md`, that `analyze-form` must call the gate.

## Architecture

### `public.ai_ops_config` — the kill switch and the dials

Singleton row, enforced by `id boolean primary key default true check (id)`.

| Column | Purpose |
|---|---|
| `analyze_enabled boolean not null default true` | **The kill switch.** |
| `disabled_reason text` | Surfaced to the client when the switch is off. |
| `daily_usd_cap numeric not null default 10.00` | Global daily ceiling, independent of per-user quota. |
| `breaker_failure_threshold integer not null default 5` | Consecutive failures that trip the breaker. |
| `breaker_cooldown_seconds integer not null default 900` | How long a tripped breaker stays open. |
| `pending_timeout_seconds integer not null default 300` | After this, a pending call is presumed dead. |

RLS **on with zero policies**, and `select`/`update` revoked from `anon` and `authenticated`. The client
cannot read it, let alone flip it. It is flipped from the Supabase dashboard or MCP with one `UPDATE` —
that is the "no redeploy" property the issue asks for.

**$10/day** is ~200 free-tier analyses or ~50 Elite analyses — far above any plausible pre-launch load
(there are zero real users), and it caps a farm run at $10 instead of unbounded. Raise it with one
`UPDATE` when real traffic arrives.

### `public.ai_model_pricing` — rates, not a migration

`model text primary key`, `input_usd_per_mtok`, `output_usd_per_mtok`, `cache_write_multiplier` (1.25),
`cache_read_multiplier` (0.10). Seeded with `claude-sonnet-5` at the **list** price ($3/$15), deliberately
not the cheaper introductory price, so the cap errs conservative. A price or model change is an `UPDATE`,
not a migration.

### `public.ai_call_log` — the ledger

One row per attempted model call.

- All **four** token fields stored separately — `input_tokens`, `output_tokens`,
  `cache_creation_input_tokens`, `cache_read_input_tokens` — because they bill at different rates. A single
  "tokens" column cannot produce a correct cost.
- `estimated_usd` (reserved at the gate) and `actual_usd` (computed at settle from the pricing table).
- `status`: `pending` | `success` | `model_error` | `validation_failed` | `fallback` | `cancelled`.
- `user_id` and `analysis_id` are **`on delete set null`, not cascade.** Deleting an account or purging an
  analysis erases the personal data but **preserves the spend history**. A farm cannot delete its own
  evidence, and the cost record stays queryable — satisfying both the issue's "queryable" requirement and
  GDPR (no personal data retained after deletion).

### The gate: reserve → settle

`gate_ai_call(...)` takes a global advisory lock, then checks in order:

1. **Kill switch** — `analyze_enabled` false → deny `killed`.
2. **Circuit breaker** — deny `breaker_open`.
3. **Daily cap** — deny `daily_cap`.

Today's spend is:

```
sum(actual_usd)    where settled today
  + sum(estimated_usd) where status = 'pending'
                         and created_at > now() - pending_timeout
```

Counting **pending estimates** is what makes the cap hold under a burst. Without it, N concurrent calls all
read the same stale "spent" figure and all proceed — the identical race the existing
`quota_reserve_settle_release` migration header explains at length for per-user quota. Orphaned pending rows
(function crashed mid-call) **age out of the sum** after `pending_timeout_seconds`, so no cron sweeper is
needed.

On allow, it inserts a `pending` row and returns `{ allowed: true, call_id }`.

`record_ai_call(...)` settles that row with real token counts, computes `actual_usd` from the pricing table,
and is a **no-op on an already-settled row** (safe on a retried invocation — same guard shape as
`settle_analysis`). If a call errored with **no usage data at all** (network timeout), it settles at the
**estimate, not zero** — an unknown cost is assumed to have been incurred, so the budget stays honest.

### The breaker is derived, not stored

Look at the last `breaker_failure_threshold` settled calls. If **all** of them are `model_error` or
`validation_failed`, **and** the most recent is within `breaker_cooldown_seconds`, the breaker is open.
There is no counter to reset or drift out of sync.

After the cooldown the streak is stale, so exactly one call probes through **half-open**: a success breaks
the streak, a failure re-arms it for another cooldown.

**Validation failures count, not just model errors.** A bad prompt change that makes every response
unparseable burns full token cost on every call and delivers nothing — exactly the "bad prompt change bills
a solo developer's personal card" scenario in the issue. A delivered fallback (≥2 pillars parsed) counts as
a **success**: the user got value, so it is not a failure.

## Call ordering — the decision that matters

The gate must run **before** `reserve_analysis`:

```
auth → consent → AI GATE → idempotency + quota reserve → model call → record + settle
```

If the gate ran *after* the quota reserve, every kill-switch/cap/breaker denial would have to **release**
that reservation — and `reserve_analysis` counts released rows against its **3-failed-attempt anti-farming
cap**. Three outages and a legitimate user is locked out with "too many failed attempts" for something we
did. Gating first means a denied request never creates a reservation: nothing to release, and the user's
retry budget is untouched.

This also means **`reserve_analysis` needs no changes.** No live `SECURITY DEFINER` function is modified by
this work.

**The one case that still needs care:** gate passes, then quota denies (user genuinely over quota). The
budget reservation is settled as `cancelled` with `actual_usd = 0`, releasing it immediately.

## What M4 consumes

`supabase/functions/_shared/ai-guard.ts` exposes `gateAiCall()` and `recordAiCall()`, plus the deny → HTTP
mapping. **All three denials are `503`, not a `4xx`** — it is our brake, not the user's fault, and the
client copy should say so.

The pure cost/estimate math is kept free of Deno-only imports so Jest can test it.

## Observability

`ai_spend_today()` returns today's spend, call counts by status, breaker state, and kill-switch state as
one JSONB row — for `db-audit`, `cost-monitor`, and manual inspection. Service-role only.

## Out of scope

- **A monthly DB cap.** The Anthropic Console spend limit is exactly that backstop; a second one here is
  duplicated state that can drift.
- **CAPTCHA / signup rate limiting** — that is #48's cause, blocked on Ian, and unaffected by this work.
- **Any part of `analyze-form` itself** — M4.

## Manual step that cannot be automated

**Set a hard spend ceiling in the Anthropic Console.** It is free configuration, and it is the only backstop
that survives a bug in this gate, a Supabase outage, or a leaked `ANTHROPIC_API_KEY`. Everything above is
defense-in-depth *behind* it. This ships as an open item in `docs/status.md` until Ian sets it.

## Testing

- **Jest** — the pure cost/estimate math in `_shared` (rate application across all four token fields,
  estimate derivation from frame count/tier).
- **Live SQL verification via Supabase MCP** — scripted scenarios against the real project: cap denies at
  the boundary; concurrent pending rows are counted; orphaned pending rows age out; breaker opens at 5,
  half-opens after cooldown, and clears on success; kill switch denies; `record_ai_call` is idempotent.

There is no existing DB test harness (`jest-expo`, `passWithNoTests: true`), so the SQL is verified against
the live project rather than a local pgTAP suite.
