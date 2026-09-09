# Task 1 report — database definitions and executable migration proof

## Outcome

Added a focused PGlite/Deno behavioral suite that applies the minimum transitive migration set
verbatim and in filename order through `20260907120000_per_user_ai_daily_cap.sql`. The recovered
`20260906130000` and `20260906140000` SQL already met every required database behavior, so no
production SQL change was necessary.

## Files changed

- `supabase/functions/_shared/__tests__/zero-pillar-cooldown-sql.deno.test.ts` — new executable
  Postgres proof for ordered application, release-reason acceptance, Free active/expired status,
  quota refund, paid-tier exclusion, anti-farm precedence, the authoritative one-argument helper,
  the 900-second source of truth, effective RPC grants, and compatibility with the later per-user
  AI-cap migration.
- `.superpowers/sdd/2026-09-09-free-zero-pillar-cooldown/task-1-report.md` — this report.

The owned migrations were inspected and mutation-tested but finish byte-for-byte unchanged:

- `supabase/migrations/20260906130000_free_zero_pillar_cooldown.sql`
- `supabase/migrations/20260906140000_quota_status_zero_pillar_cooldown.sql`

## Red evidence

The first run of the newly added test was unexpectedly green (5 passed, 0 failed), establishing
that the recovered SQL already contained the intended behavior. Because production behavior
predated its missing executable proof, I then mutation-checked the suite: temporarily changed the
owned cooldown source of truth from `select 900` to `select 901`, ran the focused suite, and
restored `select 900` immediately with `apply_patch`.

Command:

```text
deno test --config supabase/functions/deno.json --allow-read \
  supabase/functions/_shared/__tests__/zero-pillar-cooldown-sql.deno.test.ts
```

Expected red result:

```text
Free reports an active then expired zero-pillar cooldown without consuming quota ... FAILED
  actual blocked_until: 2026-09-09T12:15:01+00:00
  expected:             2026-09-09T12:15:00+00:00
the one-argument cooldown helper is authoritative and RPCs are service-role-only ... FAILED
  actual: 901
  expected: 900
FAILED | 3 passed | 2 failed
```

After restoration, `git diff --` for both owned migration files was empty.

## Green evidence

Focused cooldown proof plus the existing later-migration AI-cap proof:

```text
deno test --config supabase/functions/deno.json --allow-read \
  supabase/functions/_shared/__tests__/zero-pillar-cooldown-sql.deno.test.ts \
  supabase/functions/_shared/__tests__/ai-guard-sql.deno.test.ts

ok | 20 passed | 0 failed (14s)
```

The focused portion was 5/5 and the existing `20260907120000` behavioral proof was 15/15.

Full edge gate:

```text
npm run test:edge

FAILED | 485 passed | 3 failed (13s)
```

All PGlite database tests passed inside that run. The three failures were in
`supabase/functions/analyze-form/__tests__/flow.deno.test.ts`:

- `cooldown: expiry lets Free run, and paid tiers never query the Free throttle` (expected 200,
  received 500)
- `cooldown: an unavailable lookup fails open to the existing spend caps` (expected 200, received
  500)
- `no pillar tells a VIDEO submitter to send a video` (no `settle_analysis` call was present)

Those edge-flow files are explicitly outside this task's ownership and are being finalized by the
edge/client tasks.

## Self-review

- The test executes committed SQL; it does not regex migration text.
- The migration fixture asserts its own lexical order before application and includes the later
  `20260907120000` migration after both cooldown migrations.
- Fixtures use real `auth.users` inserts, the real profile trigger, real `release_analysis`, the
  final release-reason constraint, and real `pace_quota_status`/cooldown helper calls.
- Expected timestamps and cap values are literal, independently derived values.
- Free's released zero-pillar row reports `used = 0`; active and expired boundaries are both
  covered. Pro and Elite are covered separately.
- Three real `validation_failed` releases plus an active zero-pillar cooldown prove the 24-hour
  anti-farm reason and expiry win.
- Catalog lookup proves the one-argument helper exists and the caller-controlled two-argument
  overload does not. The helper's live remaining-time behavior is also exercised.
- Effective `has_function_privilege` checks prove `anon` and `authenticated` cannot execute the
  three cooldown/status RPCs while `service_role` can.
- The later AI-cap columns are smoke-tested after ordered application, and its full existing
  PGlite suite remains green.
- No live database or production data was touched.

## Concerns

- The repository-wide edge gate is not currently green because of the three out-of-scope
  `analyze-form` flow failures listed above. Database/migration proofs are green.
- PGlite is single-connection and does not prove concurrency or PostgREST routing; neither is a
  behavior introduced by these read-only cooldown/status functions. Effective database grants are
  covered directly.
