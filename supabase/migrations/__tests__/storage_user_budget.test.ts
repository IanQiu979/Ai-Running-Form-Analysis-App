/**
 * Regression locks for issue #7's residual fix (after reconciling the issue against the live
 * #88/`20260712123606_frame_upload_ordering.sql` contract — see this migration's own header for
 * the full reconciliation): a per-user object-count/byte budget on `storage.objects`, plus an
 * ownership guard that makes a NEW orphaned object structurally impossible, both enforced by a
 * `BEFORE INSERT` trigger (not an RLS policy — the only live writer, `service_role`, bypasses RLS
 * but not triggers). A third piece, `public.list_orphaned_media_prefixes`, is a read-only
 * detection RPC for whatever predates the guard or manages to route around it anyway.
 *
 * SAME METHODOLOGY AS `analyses_quota_soft_delete.test.ts` (read first, per this issue's own
 * instructions) AND `stale-reservation-sweep.deno.test.ts`: there is no local Postgres or Docker
 * available to this repo, so this is a TEXT-LEVEL contract on the migration SQL, not a live
 * database test. It proves the migration FILE says the right thing, not that Postgres executes it
 * as written.
 *
 * WHAT THIS SUITE CANNOT PROVE:
 *   - That the trigger actually fires on every INSERT, or that `RAISE EXCEPTION` actually aborts
 *     the statement the way Postgres semantics say it should — only that the function body
 *     contains the right conditions and raises under them.
 *   - That `postgres` actually holds TRIGGER privilege on `storage.objects` at apply time — this
 *     was checked by hand against the live project (`has_table_privilege('postgres',
 *     'storage.objects', 'TRIGGER')` = true, `storage.objects` owned by `supabase_storage_admin`,
 *     `postgres` NOT a member of that role) immediately before writing this migration, not proven
 *     here.
 *   - That `(bucketid_objname)` / `idx_objects_bucket_id_name` actually get chosen by the planner
 *     for the `name like v_user_id || '/%'` budget query — only that the query is written to be
 *     index-friendly, not that `EXPLAIN` confirms it.
 *   - That `metadata->>'size'` is actually populated by Supabase Storage's real upload path at
 *     INSERT time (assumed from documented Storage behavior, not verified against a live upload —
 *     there are zero objects in the live 'media' bucket as of this migration, confirmed via
 *     `execute_sql`, so there is no real row to inspect).
 *   - Anything about `supabase/functions/analyze-form/**` or any other parallel worktree's file —
 *     this migration's own text is checked to never reference or redefine them, but their actual
 *     behavior is out of this file's reach entirely.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..');

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // filenames are timestamp-prefixed, so lexical sort == chronological order
}

function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
}

/** Strips `--` line comments before scanning — this migration's header legitimately discusses, in
 * prose, several of the exact identifiers/strings the tests below look for (e.g. it names
 * `reserve_analysis`/`settle_analysis` at length while explaining what it does NOT touch), so a
 * naive substring search over the raw file would false-positive on its own documentation. Same
 * technique `stale-reservation-sweep.deno.test.ts` / `purchase-tier.deno.test.ts` use. */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const FIX_MIGRATION = '20260713152000_storage_user_budget.sql';

describe('the fix migration exists and is ordered correctly', () => {
  it('the migration file is present', () => {
    expect(migrationFiles()).toContain(FIX_MIGRATION);
  });

  it('sorts after every migration that predates it, including the sibling #88/#130/#47 chain', () => {
    const files = migrationFiles();
    const fixIndex = files.indexOf(FIX_MIGRATION);
    const priorFiles = [
      '20260711150500_media_storage_bucket.sql',
      '20260711150600_rls_initplan_fix.sql',
      '20260712123606_frame_upload_ordering.sql',
      '20260712230000_analyses_client_delete_removed.sql',
    ];
    for (const prior of priorFiles) {
      expect(fixIndex).toBeGreaterThan(files.indexOf(prior));
    }
  });
});

describe('GUARD 1 — ownership: object path must name a real, owned, non-deleted analyses row', () => {
  const sql = stripSqlComments(readMigration(FIX_MIGRATION));

  it('rejects any object path with fewer than 2 folder segments', () => {
    expect(sql).toMatch(/v_segments\s*:=\s*storage\.foldername\(new\.name\)/i);
    expect(sql).toMatch(/cardinality\(v_segments\)\s*<\s*2/i);
  });

  it('checks existence against public.analyses scoped by id, user_id, AND deleted_at is null', () => {
    const existsMatch = sql.match(/select 1\s+from public\.analyses\s+where([\s\S]*?)\);/i);
    expect(existsMatch).not.toBeNull();
    const clause = existsMatch![1];
    expect(clause).toMatch(/id\s*=\s*v_analysis_id::uuid/i);
    expect(clause).toMatch(/user_id\s*=\s*v_user_id::uuid/i);
    expect(clause).toMatch(/deleted_at is null/i);
  });

  it('treats a malformed uuid in either segment as "no such row", not an uncaught error', () => {
    expect(sql).toMatch(/exception\s+when\s+invalid_text_representation\s+then/i);
    expect(sql).toMatch(/v_owns_analysis\s*:=\s*false/i);
  });

  it('raises (not silently drops) when ownership fails', () => {
    expect(sql).toMatch(/if not v_owns_analysis then/i);
    expect(sql).toMatch(/raise exception[^;]*does not correspond to an existing, non-deleted analysis/i);
  });

  it('is scoped to the media bucket only — other buckets return early untouched', () => {
    expect(sql).toMatch(/if new\.bucket_id\s*<>\s*'media'\s+then\s*\n\s*return new;/i);
  });
});

describe('GUARD 2 — per-user budget: object count and byte total, derived not guessed', () => {
  const sql = stripSqlComments(readMigration(FIX_MIGRATION));

  it('the object-count budget is 3000, declared as a named constant', () => {
    expect(sql).toMatch(/v_max_objects_per_user\s+constant\s+integer\s*:=\s*3000/i);
  });

  it('the byte budget is 500 MiB (524288000 bytes), declared as a named constant', () => {
    expect(sql).toMatch(/v_max_bytes_per_user\s+constant\s+bigint\s*:=\s*524288000/i);
  });

  it('checks the NEW object against both totals (existing + 1 / existing + new bytes), not just existing', () => {
    expect(sql).toMatch(/v_existing_objects\s*\+\s*1\s*>\s*v_max_objects_per_user/i);
    expect(sql).toMatch(/v_existing_bytes\s*\+\s*v_new_bytes\s*>\s*v_max_bytes_per_user/i);
  });

  it('sums metadata size defensively with coalesce-to-zero on both sides', () => {
    expect(sql).toMatch(/sum\(coalesce\(\(metadata->>'size'\)::bigint,\s*0\)\)/i);
    expect(sql).toMatch(/v_new_bytes\s*:=\s*coalesce\(\(new\.metadata->>'size'\)::bigint,\s*0\)/i);
  });

  it('the aggregate query filters on a LIKE-prefix, not the foldername() expression, for index-friendliness', () => {
    // storage.foldername() is an expression Postgres cannot use bucketid_objname/idx_objects_bucket_id_name
    // for; `name like v_user_id || '/%'` is written specifically so it can.
    expect(sql).toMatch(/where bucket_id = 'media'\s*\n\s*and name like \(v_user_id \|\| '\/%'\)/i);
  });
});

describe('the trigger wiring', () => {
  const sql = stripSqlComments(readMigration(FIX_MIGRATION));

  it('creates a BEFORE INSERT (not AFTER, not UPDATE/DELETE) trigger on storage.objects', () => {
    expect(sql).toMatch(/create trigger pace_media_object_guard\s*\n\s*before insert on storage\.objects/i);
  });

  it('drops any prior trigger of the same name first (safe to re-run)', () => {
    expect(sql).toMatch(/drop trigger if exists pace_media_object_guard on storage\.objects/i);
  });

  it('the trigger function is SECURITY DEFINER with a pinned search_path, matching every other RPC in this schema', () => {
    const fnMatch = sql.match(/create or replace function public\.pace_enforce_media_object_guard\(\)([\s\S]*?)\$\$;/i);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![1]).toMatch(/security definer/i);
    expect(fnMatch![1]).toMatch(/set search_path = public/i);
  });

  it('executes public.pace_enforce_media_object_guard, not some other function', () => {
    expect(sql).toMatch(/execute function public\.pace_enforce_media_object_guard\(\)/i);
  });
});

describe('the orphan-detection RPC is read-only and service_role-locked', () => {
  const rawSql = readMigration(FIX_MIGRATION);
  const sql = stripSqlComments(rawSql);

  it('defaults to a 15-minute staleness window, matching the sweep migration\'s own threshold', () => {
    expect(sql).toMatch(/p_older_than\s+interval\s+default\s+interval\s+'15 minutes'/i);
  });

  it('excludes prefixes with an existing, non-deleted analyses row (the "not exists" clause)', () => {
    const fnMatch = sql.match(/create or replace function public\.list_orphaned_media_prefixes[\s\S]*?\$\$;/i);
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![0];
    expect(body).toMatch(/not exists \(/i);
    expect(body).toMatch(/a\.id::text\s*=\s*\(storage\.foldername\(o\.name\)\)\[2\]/i);
    expect(body).toMatch(/a\.user_id::text\s*=\s*\(storage\.foldername\(o\.name\)\)\[1\]/i);
    expect(body).toMatch(/a\.deleted_at is null/i);
  });

  it('is STABLE (read-only) and SECURITY DEFINER with a pinned search_path', () => {
    const fnMatch = sql.match(/create or replace function public\.list_orphaned_media_prefixes[\s\S]*?as \$\$/i);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/\bstable\b/i);
    expect(fnMatch![0]).toMatch(/security definer/i);
    expect(fnMatch![0]).toMatch(/set search_path = public/i);
  });

  it('EXECUTE is revoked from public/anon/authenticated and granted only to service_role', () => {
    expect(rawSql).toContain(
      'revoke execute on function public.list_orphaned_media_prefixes(interval, integer) from public, anon, authenticated;'
    );
    expect(rawSql).toContain(
      'grant execute on function public.list_orphaned_media_prefixes(interval, integer) to service_role;'
    );
  });

  it('never issues a DELETE or storage removal — detection only, matching the header\'s stated scope', () => {
    // The function body itself (not the surrounding prose, already stripped) must contain no
    // DELETE/remove call — this migration deliberately stops at detection.
    const fnMatch = sql.match(/create or replace function public\.list_orphaned_media_prefixes[\s\S]*?\$\$;/i);
    expect(fnMatch![0]).not.toMatch(/delete from/i);
  });
});

describe('scope discipline: this migration does not collide with parallel worktrees', () => {
  const sql = readMigration(FIX_MIGRATION);

  it('never redefines any RPC owned by another agent\'s migration', () => {
    for (const forbidden of [
      'reserve_analysis',
      'settle_analysis',
      'release_analysis',
      'attach_media_paths',
      'sweep_stale_reservations',
      'pace_current_period',
      'pace_purchase_tier',
      'pace_quota_status',
      'pace_is_farming_signal',
    ]) {
      expect(sql).not.toMatch(new RegExp(`create or replace function public\\.${forbidden}\\(`, 'i'));
    }
  });

  it('never touches storage.objects\' table-level GRANT/REVOKE — that is the sibling *_grant_hardening.sql migration\'s job', () => {
    const stripped = stripSqlComments(sql);
    expect(stripped).not.toMatch(/revoke\s+(insert|delete|all)[^;]*on\s+storage\.objects\s+from/i);
    expect(stripped).not.toMatch(/grant\s+(insert|delete|all)[^;]*on\s+storage\.objects\s+to/i);
  });

  it('never creates or drops an RLS policy on storage.objects — the guard is a trigger, deliberately not a policy', () => {
    const stripped = stripSqlComments(sql);
    expect(stripped).not.toMatch(/create policy[^;]*on storage\.objects/i);
    expect(stripped).not.toMatch(/drop policy[^;]*on storage\.objects/i);
  });

  it('never schedules a cron job — no scheduling mechanism is wired from this migration (see NEEDS-IAN in the issue report)', () => {
    const stripped = stripSqlComments(sql);
    expect(stripped).not.toMatch(/cron\.schedule/i);
  });

  it('never calls pg_net or references a Storage HTTP endpoint — actual object deletion is out of a migration\'s reach', () => {
    const stripped = stripSqlComments(sql);
    expect(stripped).not.toMatch(/net\.http_post|net\.http_get/i);
    expect(stripped).not.toMatch(/functions\/v1\//i);
  });
});
