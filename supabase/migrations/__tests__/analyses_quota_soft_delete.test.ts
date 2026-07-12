/**
 * Regression locks for issue #2 (HIGH, security): the free "lifetime" quota was resettable
 * because `analyses` had a client-facing DELETE policy while `reserve_analysis` counted live
 * rows to derive both the quota-used count and the 3-failed-attempt anti-farming count.
 *
 * There is no pgTAP or local Postgres available to this repo (no Docker in the sandbox this was
 * written in, and issue #92 means there is no non-production Supabase project to apply a real
 * migration against for a true end-to-end RLS test). So this suite is a TEXT-LEVEL contract on
 * the migration SQL itself, not a live database test — it proves the migration FILES say the
 * right thing, not that Postgres executes them as written. Treat it as a tripwire against
 * regressing the fix in a later migration, not as proof the RLS policies behave correctly live
 * (that still needs a manual `pg_policies`/`role_table_grants` check against the real project,
 * same as was done by hand while designing this fix).
 *
 * WHAT THIS SUITE CANNOT PROVE:
 *   - That Postgres actually enforces the USING/WITH CHECK clauses as intended (only that the
 *     clause text matches the intended shape).
 *   - That the trigger's WHEN clause fires (or doesn't fire) as reasoned about — only that the
 *     WHEN condition text is present, scoped to the deleted_at transition.
 *   - Anything about grants BEYOND what 20260712040000 itself states — Supabase's implicit
 *     `grant all` on table creation happens outside any migration file's text, so a full
 *     sequential grant/revoke simulation across all migrations isn't possible from text alone.
 *   - Anything about issue #88 (frame-upload ordering, a sibling branch not present in this
 *     worktree) — that composability was checked by hand by reading #88's migration file
 *     directly (see this migration's own POSTSCRIPT comment), not by a test here, since #88's
 *     migration file does not exist on this branch to read from.
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

const FIX_MIGRATION = '20260712040000_analyses_quota_soft_delete.sql';
const QUOTA_RPC_MIGRATION = '20260711150400_quota_reserve_settle_release.sql';

describe('issue #2 fix migration exists and is ordered last', () => {
  it('the fix migration file is present', () => {
    expect(migrationFiles()).toContain(FIX_MIGRATION);
  });

  it('is a forward migration (sorts after every migration that predates it), not a rewrite', () => {
    const files = migrationFiles();
    const fixIndex = files.indexOf(FIX_MIGRATION);
    const priorFiles = [
      '20260711150000_profiles.sql',
      '20260711150100_subscriptions.sql',
      '20260711150200_analyses.sql',
      '20260711150300_quota_period_helpers.sql',
      '20260711150400_quota_reserve_settle_release.sql',
      '20260711150500_media_storage_bucket.sql',
      '20260711150600_rls_initplan_fix.sql',
      '20260712020729_consents.sql',
      '20260712030617_consents_grant_hardening.sql',
    ];
    for (const prior of priorFiles) {
      expect(fixIndex).toBeGreaterThan(files.indexOf(prior));
    }
  });
});

describe('net effect on public.analyses policies across the full migration sequence', () => {
  // A minimal create/drop simulator over every migration touching `public.analyses` policies,
  // in chronological order — not a full SQL parser, just enough to answer "what policies are
  // live on this table by the end", which is the property that actually matters for the exploit.
  type Policy = { name: string; cmd: string; sql: string };

  function simulateAnalysesPolicies(): Policy[] {
    const active = new Map<string, Policy>();

    for (const file of migrationFiles()) {
      const sql = readMigration(file);

      // DROP POLICY "name" ON public.analyses;
      const dropRe = /drop policy\s+(?:if exists\s+)?"([^"]+)"\s+on\s+public\.analyses/gi;
      for (const m of sql.matchAll(dropRe)) {
        active.delete(m[1]);
      }

      // CREATE POLICY "name" ON public.analyses FOR <cmd> ... (captures up to the next
      // top-level statement terminator so USING/WITH CHECK are included in `sql`).
      const createRe =
        /create policy\s+"([^"]+)"\s+on\s+public\.analyses\s+for\s+(\w+)([\s\S]*?);/gi;
      for (const m of sql.matchAll(createRe)) {
        const [, name, cmd, body] = m;
        active.set(name, { name, cmd: cmd.toLowerCase(), sql: body });
      }
    }

    return [...active.values()];
  }

  it('no DELETE policy survives on public.analyses — this is the exploit itself', () => {
    const policies = simulateAnalysesPolicies();
    const deletePolicies = policies.filter((p) => p.cmd === 'delete');
    expect(deletePolicies).toEqual([]);
  });

  it('exactly one SELECT and one UPDATE policy remain, both owner-scoped', () => {
    const policies = simulateAnalysesPolicies();
    const byCmd = (cmd: string) => policies.filter((p) => p.cmd === cmd);

    expect(byCmd('select')).toHaveLength(1);
    expect(byCmd('update')).toHaveLength(1);
    // No insert policy for the client either — rows are only ever created by reserve_analysis.
    expect(byCmd('insert')).toHaveLength(0);

    for (const p of [...byCmd('select'), ...byCmd('update')]) {
      expect(p.sql).toMatch(/auth\.uid\(\)\)?\s*=\s*user_id/);
    }
  });

  it('the surviving UPDATE policy only permits the not-deleted -> deleted transition', () => {
    const policies = simulateAnalysesPolicies();
    const softDelete = policies.find((p) => p.cmd === 'update');
    expect(softDelete).toBeDefined();

    // USING must exclude already-deleted rows (so a soft-deleted row becomes immutable) — split
    // on "with check" first so each half is checked against the right clause, since the USING
    // clause itself contains a nested `(select auth.uid())` paren group that defeats a naive
    // single-level `[^)]*` match.
    const [usingClause, withCheckClause] = softDelete!.sql.split(/with check/i);
    expect(usingClause).toMatch(/using/i);
    expect(usingClause).toMatch(/deleted_at is null/i);
    // WITH CHECK must require the row to end up deleted (no un-delete, no silent no-op update).
    expect(withCheckClause).toBeDefined();
    expect(withCheckClause).toMatch(/deleted_at is not null/i);
  });
});

describe('fix migration: privilege layer under the RLS policy', () => {
  const sql = readMigration(FIX_MIGRATION);

  it('revokes the blanket grant on public.analyses from both client-facing roles', () => {
    expect(sql).toMatch(/revoke all on public\.analyses from authenticated,\s*anon/i);
  });

  it('grants back SELECT unrestricted (unaffected by this fix)', () => {
    expect(sql).toMatch(/grant select on public\.analyses to authenticated/i);
  });

  it('grants UPDATE restricted to exactly the deleted_at column — not a table-wide UPDATE', () => {
    expect(sql).toMatch(/grant update\s*\(deleted_at\)\s*on public\.analyses to authenticated/i);
    // Guard against a regression back to a table-wide grant, which would let a column-level
    // restriction elsewhere be bypassed by simply not restricting it here.
    expect(sql).not.toMatch(/grant update on public\.analyses to authenticated/i);
  });

  it('never re-grants DELETE or TRUNCATE on analyses to a client-facing role', () => {
    expect(sql).not.toMatch(/grant\s+(all|delete|truncate)[^;]*on public\.analyses to (authenticated|anon)/i);
  });
});

describe('fix migration: soft-delete redacts the sensitive payload', () => {
  const sql = readMigration(FIX_MIGRATION);

  it('the trigger only fires on the genuine delete transition, not on every UPDATE', () => {
    // This WHEN clause is what keeps settle_analysis/release_analysis's own UPDATEs (which
    // never touch deleted_at, in either their original form or issue #88's rewritten
    // signatures) from ever entering the trigger body.
    expect(sql).toMatch(
      /when\s*\(\s*old\.deleted_at is null\s+and\s+new\.deleted_at is not null\s*\)/i
    );
  });

  it('redacts result and media_paths (the sensitive columns) on soft-delete', () => {
    const fnMatch = sql.match(
      /create or replace function public\.redact_analyses_on_soft_delete[\s\S]*?\$\$;/i
    );
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];
    expect(fnBody).toMatch(/new\.result\s*:=\s*null/i);
    expect(fnBody).toMatch(/new\.media_paths\s*:=\s*'\{\}'/i);
    // status is the one column reserve_analysis's counting actually depends on — the whole
    // fix collapses if a future edit makes this trigger touch it.
    expect(fnBody).not.toMatch(/new\.status/i);
  });
});

describe('quota RPCs remain untouched by the soft-delete column', () => {
  it('reserve_analysis never filters on deleted_at — a soft-deleted row must keep counting', () => {
    const sql = readMigration(QUOTA_RPC_MIGRATION);
    // This is the actual mechanism that makes the fix work: reserve_analysis counts by
    // `status` alone, so a soft-deleted row (deleted_at set, status untouched) still counts
    // exactly as it did before. If a later change adds `and deleted_at is null` to either
    // count(*) query in reserve_analysis, that reopens the exact hole issue #2 filed against.
    // (This checks the version of reserve_analysis present on THIS branch. Issue #88, on a
    // sibling branch not present here, rewrites reserve_analysis's signature but was verified
    // by hand — not by this test — to leave the same counting logic untouched; see this fix
    // migration's own POSTSCRIPT comment.)
    expect(sql).not.toMatch(/deleted_at/i);
  });

  it('this fix migration never redefines reserve_analysis or settle_analysis itself', () => {
    // The whole point of the soft-delete design over the rejected ledger design: this fix does
    // not need to touch either RPC, so it cannot collide with issue #88's independent rewrite
    // of both functions on a sibling branch.
    const sql = readMigration(FIX_MIGRATION);
    expect(sql).not.toMatch(/create (or replace )?function public\.reserve_analysis/i);
    expect(sql).not.toMatch(/create (or replace )?function public\.settle_analysis/i);
  });
});
