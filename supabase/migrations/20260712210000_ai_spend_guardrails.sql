-- AI spend guardrails — schema (issue #91, design spec
-- docs/superpowers/specs/2026-07-12-ai-spend-guardrails-design.md).
--
-- `analyze-form` (M4, issue #44) does not exist yet. This migration ships the substrate it will
-- be *forced* to call before it can spend a single Anthropic token: a kill switch, a global
-- daily spend cap, the raw material for a circuit breaker, and a per-call cost ledger. The gate
-- (`gate_ai_call` / `record_ai_call` / `ai_spend_today`) that reads these tables lives in the
-- next migration, `20260712210100_ai_spend_guardrail_functions.sql`.
--
-- Why now, with no caller yet: issue #48 established that account creation on this project is
-- currently unbounded (no signup rate limit, autoconfirm on, CAPTCHA blocked on Ian), and #48's
-- own conclusion is that this blocks M4 going *live*, not the M4 *build* — so M4 is expected to
-- land with that hole still open. Building the brake before the thing that spends money means
-- M4 physically cannot ship without passing through it (see the functions migration's header for
-- how "physically" is scoped — it's a DB-privilege guarantee against the *client*, plus a
-- documented, security-audit-gated contract against `analyze-form` itself skipping the gate).
--
-- All three tables are operator-facing only. RLS is enabled with zero policies (default-deny for
-- every privilege RLS covers), and — per the lesson in 20260712030617_consents_grant_hardening.sql
-- (RLS never touches TRUNCATE, and a bare `enable row level security` doesn't revoke the
-- Supabase-default `grant all`) — every grant to `anon`/`authenticated` is explicitly revoked on
-- top of that, not left to RLS alone. No client, anonymous or authenticated, can read, write, or
-- truncate any of this. An operator flips the kill switch with one `UPDATE` from the Supabase
-- dashboard/SQL editor or via MCP — no redeploy, which is the exact property issue #91 asks for.

-- public.ai_ops_config: singleton row (the `id boolean primary key default true check (id)`
-- trick makes a second row a constraint violation, not just a convention) holding the kill
-- switch and every operator-tunable dial the gate reads.
create table public.ai_ops_config (
  id                        boolean primary key default true check (id),

  -- THE KILL SWITCH. false = analyze-form must refuse every call, immediately, no redeploy.
  analyze_enabled           boolean not null default true,
  -- Surfaced to the client when the switch is off (e.g. "under maintenance"); operator-set, not
  -- user input.
  disabled_reason           text,

  -- Global daily ceiling in USD, independent of and in addition to per-user quota
  -- (reserve_analysis). $10/day is ~200 Free-tier analyses or ~50 Elite analyses at list price —
  -- far above any plausible pre-launch load (there are zero real users today) but it caps a farm
  -- run at $10 instead of unbounded. Raise it with one UPDATE once real traffic arrives.
  daily_usd_cap             numeric not null default 10.00 check (daily_usd_cap > 0),

  -- Circuit breaker dials — see ai_breaker_state() in the next migration for how these are
  -- applied. "N consecutive failures trips the function" from the issue.
  breaker_failure_threshold integer not null default 5 check (breaker_failure_threshold > 0),
  breaker_cooldown_seconds  integer not null default 900 check (breaker_cooldown_seconds > 0),

  -- After this many seconds, a still-'pending' ai_call_log row is presumed dead (the edge
  -- function crashed mid-call, or a network partition ate the response) and stops counting
  -- toward today's spend and toward an in-flight breaker probe. No cron sweeper needed — the row
  -- just ages out of every query that matters; see the next migration.
  pending_timeout_seconds   integer not null default 300 check (pending_timeout_seconds > 0),

  updated_at                timestamptz not null default now()
);

insert into public.ai_ops_config (id) values (true);

create trigger ai_ops_config_updated_at
  before update on public.ai_ops_config
  for each row execute function public.set_updated_at();

alter table public.ai_ops_config enable row level security;
revoke all on public.ai_ops_config from public, anon, authenticated;

comment on table public.ai_ops_config is
  'Operator-only kill switch + spend/breaker dials for the analyze-form AI gate (issue #91). '
  'Flip analyze_enabled to false from the Supabase dashboard/SQL editor/MCP to halt all '
  'Anthropic spend immediately, with no redeploy.';

-- public.ai_model_pricing: rates, not code. A price or model change is an UPDATE against this
-- table, never a migration. Seeded at claude-sonnet-5's LIST price ($3/M input, $15/M output),
-- deliberately not the cheaper 2026-08-31 introductory rate ($2/$10), so the daily cap and every
-- estimate computed against it err conservative — real spend can only come in under what the
-- gate assumed, never over.
create table public.ai_model_pricing (
  model                  text primary key,
  input_usd_per_mtok     numeric not null check (input_usd_per_mtok >= 0),
  output_usd_per_mtok    numeric not null check (output_usd_per_mtok >= 0),
  -- Anthropic prompt-caching multipliers, applied to input_usd_per_mtok: writing a cache entry
  -- costs MORE than a plain input token (1.25x), reading a hit costs much LESS (0.10x). Both
  -- default to Anthropic's published multipliers and only matter once analyze-form actually
  -- uses caching (it bundles the certified PACE knowledge as a system prompt every call — a
  -- natural caching candidate, not built here).
  cache_write_multiplier numeric not null default 1.25 check (cache_write_multiplier >= 0),
  cache_read_multiplier  numeric not null default 0.10 check (cache_read_multiplier >= 0),
  updated_at             timestamptz not null default now()
);

insert into public.ai_model_pricing (model, input_usd_per_mtok, output_usd_per_mtok)
values ('claude-sonnet-5', 3.00, 15.00);

create trigger ai_model_pricing_updated_at
  before update on public.ai_model_pricing
  for each row execute function public.set_updated_at();

alter table public.ai_model_pricing enable row level security;
revoke all on public.ai_model_pricing from public, anon, authenticated;

comment on table public.ai_model_pricing is
  'Per-model $/Mtok rates used by record_ai_call() to compute actual_usd. Update the row to '
  'reprice or add a model — never a migration. Mirrored (deliberately, not automatically kept '
  'in sync) by the AI_MODEL_PRICING constant in supabase/functions/_shared/ai-pricing.ts, which '
  'is used only for the pre-call estimate the gate checks against the daily cap before real '
  'usage exists; this table is the sole source of truth for what actually gets billed.';

-- public.ai_call_log: one row per attempted model call — the ledger the issue asks for
-- ("per-call token accounting written somewhere queryable, so cost is observable before it is a
-- bill"). status starts 'pending' at the gate and is settled exactly once by record_ai_call().
create type public.ai_call_status as enum (
  'pending',           -- reserved by gate_ai_call, not yet settled
  'success',           -- model call succeeded and the response validated
  'model_error',       -- the Anthropic call itself failed (timeout, 5xx, malformed response)
  'validation_failed', -- the model responded but structural validation rejected it outright
  'fallback',          -- a partial result was delivered (>=2 pillars parsed) — counts as a
                        -- SUCCESS for the breaker (the user got value), tracked separately here
                        -- only for cost/observability breakdown
  'cancelled'          -- gate allowed the call but it was never made (e.g. idempotent replay of
                        -- an already-delivered analysis, or quota denied after the gate passed)
);

create table public.ai_call_log (
  id                           uuid primary key default gen_random_uuid(),

  -- Deliberately ON DELETE SET NULL, not CASCADE, on both FKs: deleting an account or purging an
  -- analysis must erase personal data, but must NOT erase spend history. A farm cannot delete
  -- its own evidence, cost stays queryable after the fact, and no personal data survives the
  -- delete (user_id/analysis_id are the only columns that could identify a person here) —
  -- satisfying the issue's "queryable" requirement and GDPR erasure at once.
  user_id                      uuid references public.profiles(id) on delete set null,
  -- Not known at gate time (the gate runs BEFORE reserve_analysis mints an analyses row — see
  -- the functions migration's "call ordering" note), so this starts null and record_ai_call()
  -- may backfill it once the caller has a real analysis id.
  analysis_id                  uuid references public.analyses(id) on delete set null,

  model                        text not null references public.ai_model_pricing(model),
  status                       public.ai_call_status not null default 'pending',

  -- Reserved at the gate, from supabase/functions/_shared/ai-pricing.ts's pure estimate math
  -- (frame count + tier -> token estimate -> $ via this table's rates at gate time). This is
  -- what the daily cap is actually checked against for a call in flight, and what a call with no
  -- usage data at all (a network timeout — see record_ai_call()) settles at, so an unknown cost
  -- is assumed incurred rather than assumed free.
  estimated_input_tokens       integer not null check (estimated_input_tokens >= 0),
  estimated_output_tokens      integer not null check (estimated_output_tokens >= 0),
  estimated_usd                numeric not null check (estimated_usd >= 0),

  -- All FOUR token fields, stored separately, because Anthropic bills each at a different rate
  -- (cache_write_multiplier / cache_read_multiplier above) — a single "tokens" column cannot
  -- reconstruct a correct cost after the fact. Null until settled.
  input_tokens                 integer,
  output_tokens                integer,
  cache_creation_input_tokens  integer,
  cache_read_input_tokens      integer,
  actual_usd                   numeric,

  created_at                   timestamptz not null default now(), -- = gate/reservation time
  settled_at                   timestamptz                          -- set once, by record_ai_call
);

-- Backs the daily-cap "pending estimates within pending_timeout" sum and the breaker's
-- probe-in-flight check in gate_ai_call/ai_breaker_state — both filter on status = 'pending' and
-- range-scan created_at.
create index ai_call_log_pending_created_idx
  on public.ai_call_log (created_at)
  where status = 'pending';

-- Backs the daily-cap "settled today" sum and the breaker's "last N settled calls" lookup — both
-- filter on status <> 'pending' and want the most recent rows first.
create index ai_call_log_settled_idx
  on public.ai_call_log (settled_at desc)
  where status <> 'pending';

alter table public.ai_call_log enable row level security;
revoke all on public.ai_call_log from public, anon, authenticated;

comment on table public.ai_call_log is
  'One row per attempted Anthropic call, written only by gate_ai_call()/record_ai_call() '
  '(service_role only). Operator-facing spend ledger for issue #91 — never readable or '
  'writable by anon/authenticated. user_id/analysis_id go null on account/analysis deletion; '
  'the cost row itself is kept.';
