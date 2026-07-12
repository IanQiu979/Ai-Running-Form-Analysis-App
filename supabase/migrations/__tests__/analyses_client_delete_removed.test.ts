/**
 * Regression locks for the fix found by issue #57's agent (building `DELETE
 * /functions/v1/analysis/:id` in a sibling worktree): #2's soft-delete UPDATE grant/policy on
 * `public.analyses` was a client-reachable bypass around that endpoint. A client could PATCH
 * `deleted_at` directly, mark the row deleted, fire #2's redaction trigger (which wipes
 * `media_paths`) — and leave every frame sitting in the private Storage bucket forever, since
 * nothing on that path ever purges it. That is issue #3 (deleted media never actually purged)
 * reintroduced through the door #2 opened. Not exploited today (no client code does this, 0 rows
 * live) but RLS permitted it, and CLAUDE.md is explicit this must never happen.
 *
 * Same text-level-only constraint as every other migration test suite in this repo (no pgTAP/
 * local Postgres — see analyses_quota_soft_delete.test.ts's header for the full rationale). The
 * live grant/policy shape (exactly one column-level UPDATE grant on `deleted_at` for
 * `authenticated`, exactly one soft-delete UPDATE policy, `service_role` holding its own separate
 * full grant set unaffected by any REVOKE targeting `authenticated`) was verified by hand against
 * the live project (vputdomdlknvthnzritt) via `pg_policy` / `information_schema.role_table_grants`
 * / `information_schema.column_privileges` while designing this fix, not by this suite. The app
 * was also grepped by hand (`app/`, `lib/`, `components/`) for any client-side write to
 * `deleted_at` or `.update()` against `analyses` — zero hits — confirming this migration breaks
 * no existing code path.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..');

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
}

const FIX_MIGRATION = '20260712230000_analyses_client_delete_removed.sql';
const ANTI_FARM_MIGRATION = '20260712220000_anti_farm_release_reason_fix.sql';
const SOFT_DELETE_MIGRATION = '20260712040000_analyses_quota_soft_delete.sql';
const sql = readMigration(FIX_MIGRATION);

describe('fix migration exists and is ordered after both the soft-delete migration and this branch\'s anti-farm fix', () => {
  it('the fix migration file is present', () => {
    expect(migrationFiles()).toContain(FIX_MIGRATION);
  });

  it('sorts after 20260712040000 (the soft-delete migration it partially supersedes)', () => {
    const files = migrationFiles();
    expect(files.indexOf(FIX_MIGRATION)).toBeGreaterThan(files.indexOf(SOFT_DELETE_MIGRATION));
  });

  it('sorts after this branch\'s anti-farm migration (20260712220000) — later timestamp, applies second', () => {
    const files = migrationFiles();
    expect(files.indexOf(FIX_MIGRATION)).toBeGreaterThan(files.indexOf(ANTI_FARM_MIGRATION));
  });
});

describe('revokes exactly the vestigial grant — nothing broader', () => {
  it('revokes UPDATE(deleted_at) from authenticated', () => {
    expect(sql).toContain('revoke update (deleted_at) on public.analyses from authenticated;');
  });

  it('does not touch anon, service_role, or postgres in the revoke', () => {
    const revokeMatch = sql.match(/revoke update \(deleted_at\) on public\.analyses from ([^;]+);/i);
    expect(revokeMatch).not.toBeNull();
    expect(revokeMatch![1]).not.toMatch(/anon|service_role|postgres/i);
  });

  it('never issues a broader "revoke all" or table-wide UPDATE revoke — SELECT must survive untouched', () => {
    expect(sql).not.toMatch(/revoke all on public\.analyses/i);
    expect(sql).not.toMatch(/revoke select on public\.analyses/i);
    expect(sql).not.toMatch(/revoke update on public\.analyses/i); // table-wide, not column-scoped
  });
});

describe('drops exactly the soft-delete policy — nothing broader', () => {
  it('drops "Users can soft-delete their own analyses"', () => {
    expect(sql).toContain('drop policy "Users can soft-delete their own analyses" on public.analyses;');
  });

  it('does not touch the SELECT policy — quota display and Past Analyses still need it', () => {
    expect(sql).not.toMatch(/drop policy[^;]*"Users can view their own analyses"/i);
  });

  it('drops no other policy by name', () => {
    const dropMatches = [...sql.matchAll(/drop policy\s+(?:if exists\s+)?"([^"]+)"/gi)].map((m) => m[1]);
    expect(dropMatches).toEqual(['Users can soft-delete their own analyses']);
  });
});

describe('leaves everything else on this table alone, as instructed', () => {
  it('does not touch the deleted_at column (no ALTER TABLE / DROP COLUMN)', () => {
    expect(sql).not.toMatch(/alter table public\.analyses/i);
    expect(sql).not.toMatch(/drop column/i);
  });

  it('does not touch the redaction trigger or its function — the edge function still needs both', () => {
    expect(sql).not.toMatch(/redact_analyses_on_soft_delete/i);
    expect(sql).not.toMatch(/drop trigger/i);
  });

  it('never redefines reserve_analysis, settle_analysis, or release_analysis — keeps this concern in its own file, separate from the anti-farm fix', () => {
    expect(sql).not.toMatch(/create (or replace )?function public\.(reserve|settle|release)_analysis/i);
  });

  it('does not grant anything back — this migration is pure revoke/drop, no compensating grant', () => {
    expect(sql).not.toMatch(/^\s*grant\s/im);
  });
});

describe('composes cleanly with the anti-farm migration in this same branch', () => {
  it('the two files share no identical statement — zero literal overlap', () => {
    const antiFarmSql = readMigration(ANTI_FARM_MIGRATION);
    // Split into non-trivial statement-ish lines and check none of this migration's real SQL
    // lines (ignoring comments/blank lines) appear verbatim in the anti-farm migration.
    const realLines = sql
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('--'));
    for (const line of realLines) {
      expect(antiFarmSql).not.toContain(line);
    }
  });

  it('the anti-farm migration never touches analyses policies or table-level grants (confirms no ordering dependency)', () => {
    const antiFarmSql = readMigration(ANTI_FARM_MIGRATION);
    // The anti-farm migration DOES contain "revoke/grant execute on function ..." (for
    // reserve_analysis and pace_is_farming_signal) — that's expected and fine. What must be
    // absent is any policy statement or any table-level SELECT/UPDATE/INSERT/DELETE grant on
    // public.analyses itself, which would indicate the two migrations aren't actually
    // independent of each other.
    expect(antiFarmSql).not.toMatch(/create policy|drop policy/i);
    expect(antiFarmSql).not.toMatch(/(revoke|grant)\s+(select|update|insert|delete)[^;]*on public\.analyses/i);
  });
});

describe('no data backfill — nothing to repair', () => {
  it('ships no UPDATE/INSERT/DELETE against table data (this is a pure DDL/privilege migration)', () => {
    expect(sql).not.toMatch(/^\s*(update|insert into|delete from)\s+public\.analyses/im);
  });
});
