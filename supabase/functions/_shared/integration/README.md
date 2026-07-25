# Local-Postgres/Storage integration tests

Issues #49 and #59 both call out the same gap: `_shared/__tests__/*.deno.test.ts` proves the
quota-RPC and delete-purge *contracts* against fakes (ordering, idempotency, recursion, failure
atomicity) — but three properties can only be proved against a real Postgres and real Storage,
because a mock cannot fail the way production fails:

- `reserve_analysis`'s `pg_advisory_xact_lock` genuinely serializing concurrent reserves
  (`quota-rpc.local.ts`).
- `pace_add_months_clamped`/`pace_current_period`'s month-end clamping, which is hand-rolled
  specifically because Postgres's native `+ interval` does not clamp (`quota-rpc.local.ts`).
- "Zero orphaned storage objects" after a delete, checked from the Storage side — the assertion
  issue #59 is explicit must not be "the row is gone" (`delete-purge.local.ts`).

## Running

Requires issue #92's local Docker stack:

```sh
supabase start          # once per session; `supabase status` if already running
npm run test:edge:local
```

`scripts/test-edge-local.sh` reads `supabase status -o env`, points `SUPABASE_URL`/
`SUPABASE_SECRET_KEYS` at the local stack (the same two env vars the real edge functions read in
production — see `delete-account-client.ts`/`delete-analysis-client.ts`), and runs `deno test`
against exactly the files in this directory.

**`supabase/config.toml`'s `auto_expose_new_tables = true`** is required for these tests to pass:
without it, a fresh local stack does not grant `service_role` table access the way the live
production project already has (verified live — see `docs/architecture.md`'s "service_role holds
unrestricted table-level grants" note). See that config line's comment for the full story before
touching it.

## Why these files are named `*.local.ts`, not `*.test.ts` or `*.deno.test.ts`

They need infrastructure (`supabase start`) that a fresh checkout, CI, or `npm test` cannot
assume is running. `*.local.ts` matches neither `deno test`'s default discovery glob
(`*.test.ts`/`*_test.ts`) nor Jest's — the same convention `grounding-eval.live.ts` already uses
in this repo for a test that needs infrastructure (a paid API key) `npm test` cannot assume either.
`npm run typecheck:edge` (`deno check`) still checks these files on every commit; only their
*execution* is opt-in.

## Cleanup

Every test creates its own throwaway `auth.users` row (`client.ts`'s `createTestUser`) and deletes
it in a `finally` block — deleting the auth user cascades to `profiles`/`subscriptions`/`analyses`
(see `20260711150000_profiles.sql`/`20260711150200_analyses.sql`), so no separate row cleanup is
needed. Test-uploaded Storage objects are removed by the delete/purge functions under test
themselves, which is what these tests are proving.
