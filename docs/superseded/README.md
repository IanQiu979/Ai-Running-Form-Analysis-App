# Superseded migrations

SQL in this directory is **not** applied. It is kept for the reasoning it contains.

Do not move these files into `supabase/migrations/` — they were written against a
design the project later abandoned, and re-applying them would conflict with the
migrations that replaced them.

| File | Origin | Superseded by |
|---|---|---|
| `20260712124139_analysis_usage_ledger.sql` | Supabase preview branch `issue-2-analysis-usage-ledger` (deleted 2026-07-27) | `20260712040000_analyses_quota_soft_delete.sql`, `20260712230000_analyses_client_delete_removed.sql` |

## `20260712124139_analysis_usage_ledger.sql`

An append-only `public.analysis_usage` ledger fixing issue #2: `reserve_analysis`
counted quota from live `public.analyses` rows, while `authenticated` held an
owner-scoped DELETE policy on that same table — so a free user could delete their
analysis row and reset both their lifetime quota and the 3-release anti-farm cap,
yielding unlimited vision calls.

The ledger approach counted `reserved` minus `released` events on a table with no
DELETE policy, so usage could not be un-recorded. Production instead kept counting
`analyses` but made the rows soft-deleted and removed client DELETE entirely,
reaching the same guarantee with less machinery.

Worth reading before touching quota accounting — the header comments document the
exploit, the equivalence proof between the old and new counting rules, and an
accepted residual (deleting an account and re-signing-up resets a per-account
quota; inherent to any per-account quota, deliberately not defended).

This migration only ever existed inside the preview branch's database. It was never
committed, never applied to production, and was recovered before that branch was
deleted.
