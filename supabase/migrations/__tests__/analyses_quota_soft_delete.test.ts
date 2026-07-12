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

  // NOTE ON THESE TWO TESTS (updated by 20260712230000_analyses_client_delete_removed.sql):
  // simulateAnalysesPolicies() scans the FULL migrations directory chronologically, so it
  // reflects whatever migration files exist at test-run time, not just this file's own effect.
  // #57's agent found that this migration's soft-delete UPDATE policy — the fix for #2 at the
  // time, before a server-side delete endpoint existed — was itself a bypass around that now-built
  // endpoint that orphans Storage frames (issue #3 reintroduced). 20260712230000 drops the policy
  // entirely; delete is now exclusively server-side (service_role, which bypasses RLS and is
  // unaffected by any policy on this table). That is not a regression of #2's fix — #2's actual
  // goal (a client can no longer reset the quota/anti-farm counters by deleting a row) is preserved
  // a fortiori: the client now has no write path to this table at all, not even a restricted one.
  it('exactly one SELECT policy remains, owner-scoped — no UPDATE policy survives the full sequence', () => {
    const policies = simulateAnalysesPolicies();
    const byCmd = (cmd: string) => policies.filter((p) => p.cmd === cmd);

    expect(byCmd('select')).toHaveLength(1);
    // The soft-delete UPDATE policy this migration introduced is gone by the end of the full
    // migration sequence — dropped by 20260712230000 once #57's server-side delete function made
    // it a dangerous bypass rather than a legitimate fallback. See the note above.
    expect(byCmd('update')).toHaveLength(0);
    // No insert policy for the client either — rows are only ever created by reserve_analysis.
    expect(byCmd('insert')).toHaveLength(0);
    // No delete policy either (the original exploit this file's own fix closed).
    expect(byCmd('delete')).toHaveLength(0);

    for (const p of byCmd('select')) {
      expect(p.sql).toMatch(/auth\.uid\(\)\)?\s*=\s*user_id/);
    }
  });

  it('this file still introduces a real, correctly-shaped soft-delete UPDATE policy (checked directly against this migration, independent of later supersession)', () => {
    // Unlike the test above (which reflects the END state across every migration file present),
    // this asserts what THIS migration's own text says — proof #2's fix was correct when it
    // shipped, regardless of what a later migration does to it.
    const sql = readMigration(FIX_MIGRATION);
    const policyMatch = sql.match(
      /create policy\s+"Users can soft-delete their own analyses"\s+on\s+public\.analyses\s+for\s+update([\s\S]*?);/i
    );
    expect(policyMatch).not.toBeNull();
    const [usingClause, withCheckClause] = policyMatch![1].split(/with check/i);
    expect(usingClause).toMatch(/using/i);
    expect(usingClause).toMatch(/deleted_at is null/i);
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
