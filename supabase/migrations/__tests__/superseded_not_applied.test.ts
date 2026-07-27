/**
 * Regression lock for `docs/superseded/` — SQL kept for the reasoning in its header comments,
 * which must never become SQL the project applies.
 *
 * `docs/superseded/20260712124139_analysis_usage_ledger.sql` is an append-only usage ledger
 * recovered from a deleted Supabase preview branch. It was never committed to a migration set and
 * never applied anywhere. Production solved the same issue (#2's client-DELETE quota reset) a
 * different way — `20260712040000_analyses_quota_soft_delete.sql` plus
 * `20260712230000_analyses_client_delete_removed.sql` — so applying the ledger now would conflict
 * with the migrations that replaced it. Its filename timestamp (`20260712124139`) sorts *between*
 * those two, so a stray copy would not even land at the end of the sequence: `supabase db push`
 * would interleave it into the middle of the quota-accounting history.
 *
 * Nothing else in the repo prevented that. `supabase db push` applies every `.sql` under
 * `supabase/migrations/`, and before this suite existed the whole gate
 * (`typecheck && lint && test`) stayed green with a copy of the ledger sitting in that directory —
 * verified by hand: copy it in, `jest supabase/migrations/__tests__` passes 147/147. The file's own
 * `-- SUPERSEDED — DO NOT APPLY` header is a comment; Postgres executes the rest regardless.
 *
 * Same text-level-only constraint as every other migration suite here (no pgTAP / local Postgres —
 * see analyses_quota_soft_delete.test.ts's header for the rationale). That constraint is not a
 * weakness for this particular check: "which files exist in the applied migration directory" is
 * exactly what `supabase db push` globs, so the filesystem *is* the thing under test.
 */
import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..');
const SUPERSEDED_DIR = join(__dirname, '..', '..', '..', 'docs', 'superseded');

function sqlFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const supersededFiles = sqlFiles(SUPERSEDED_DIR);
const migrationFiles = sqlFiles(MIGRATIONS_DIR);

describe('docs/superseded/ is quarantined from the applied migration set', () => {
  it('contains the recovered ledger (the directory has not been silently emptied)', () => {
    expect(supersededFiles).toContain('20260712124139_analysis_usage_ledger.sql');
  });

  it.each(supersededFiles)('%s is not present in supabase/migrations/ by name', (name) => {
    expect(migrationFiles).not.toContain(name);
  });

  // Renaming the file on the way in would defeat a name-only check, and the timestamp prefix is
  // the one part of a migration filename people do edit. Compare contents instead.
  it('no applied migration is a byte-for-byte copy of a superseded file, under any name', () => {
    const supersededHashes = new Map(
      supersededFiles.map((f) => [sha256(join(SUPERSEDED_DIR, f)), f]),
    );

    const smuggled = migrationFiles
      .map((f) => ({ applied: f, superseded: supersededHashes.get(sha256(join(MIGRATIONS_DIR, f))) }))
      .filter((m) => m.superseded !== undefined);

    expect(smuggled).toEqual([]);
  });

  it.each(supersededFiles)('%s carries a DO-NOT-APPLY header for anyone who opens it', (name) => {
    const firstLine = readFileSync(join(SUPERSEDED_DIR, name), 'utf8').split('\n')[0];
    expect(firstLine).toMatch(/SUPERSEDED — DO NOT APPLY/);
  });

  // The ledger is only safe to leave unapplied because production already carries the two
  // migrations that fixed #2 by the other route. If either ever disappeared, this directory would
  // stop being dead history and start being an unfixed exploit.
  it.each([
    '20260712040000_analyses_quota_soft_delete.sql',
    '20260712230000_analyses_client_delete_removed.sql',
  ])('%s — the migration that superseded the ledger — is still applied', (name) => {
    expect(migrationFiles).toContain(name);
  });
});
