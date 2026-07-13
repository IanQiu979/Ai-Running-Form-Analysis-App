/**
 * Regression locks for issues #100 and #4 (MEDIUM, defence-in-depth): `anon`/`authenticated` held
 * Supabase's legacy default `grant all` — including TRUNCATE, which RLS does not filter at all — on
 * `public.profiles`, `public.subscriptions`, `public.analyses`, and `storage.objects`. RLS was the
 * only barrier; this migration closes the privilege layer underneath it, mirroring
 * 20260712030617_consents_grant_hardening.sql's precedent.
 *
 * Same caveat as `analyses_quota_soft_delete.test.ts` (read first, and read again here because it
 * matters even more for this file): there is no pgTAP or local Postgres available to this repo (no
 * Docker in the sandbox this was written in, and issue #92 means there is no non-production Supabase
 * project to apply a real migration against). This suite is a TEXT-LEVEL contract on the migration
 * SQL itself — it proves the migration FILE says the right thing, not that Postgres executes it as
 * written or that PostgREST's behavior actually changes. Ground truth for what grants exist RIGHT
 * NOW was established separately, by hand, via `information_schema.role_table_grants` /
 * `has_function_privilege` queries against the live project (vputdomdlknvthnzritt) immediately
 * before this migration was written — see this migration's own "GROUND TRUTH" header comment for the
 * results. This suite cannot re-run those live queries (no DB connection available to Jest here), so
 * it checks the migration text against that recorded ground truth instead.
 *
 * WHAT THIS SUITE CANNOT PROVE:
 *   - That Postgres actually enforces these REVOKE/GRANT statements as intended.
 *   - That `storage.objects`'s signed-URL flow still works with SELECT-only, table-level access
 *     (needs a live check once this migration is actually applied — see the migration's own
 *     comment on why SELECT is deliberately NOT column-restricted).
 *   - Anything about the sibling `*_storage_user_budget.sql` migration (issue #7-in-flight, a
 *     different worktree, not present in this one) — that coordination was reasoned about by hand
 *     in this migration's own COORDINATION comment, not verified by a test here, since that
 *     migration's file does not exist on this branch to read from.
 *   - That Supabase's implicit `grant all` on table creation ever held the exact privilege set this
 *     file assumes as its starting point — confirmed live, once, by hand; not re-derivable from
 *     migration text alone (same limitation `analyses_quota_soft_delete.test.ts` documents).
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..');
const FIX_MIGRATION = '20260713153000_grant_hardening.sql';
const PURCHASE_TIER_MIGRATION = '20260713120000_purchase_tier_function.sql';
const ANALYSES_SOFT_DELETE_MIGRATION = '20260712040000_analyses_quota_soft_delete.sql';
const ANALYSES_DELETE_REMOVED_MIGRATION = '20260712230000_analyses_client_delete_removed.sql';
const FRAME_UPLOAD_ORDERING_MIGRATION = '20260712123606_frame_upload_ordering.sql';

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // filenames are timestamp-prefixed, so lexical sort == chronological order
}

function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
}

describe('grant hardening migration exists and is ordered last among its known dependents', () => {
  it('the fix migration file is present', () => {
    expect(migrationFiles()).toContain(FIX_MIGRATION);
  });

  it('sorts after every migration this file\'s own ground-truth reasoning depends on', () => {
    const files = migrationFiles();
    const fixIndex = files.indexOf(FIX_MIGRATION);
    const priorFiles = [
      '20260711150000_profiles.sql',
      '20260711150100_subscriptions.sql',
      '20260711150200_analyses.sql',
      '20260711150500_media_storage_bucket.sql',
      '20260712030617_consents_grant_hardening.sql',
      ANALYSES_SOFT_DELETE_MIGRATION,
      FRAME_UPLOAD_ORDERING_MIGRATION,
      ANALYSES_DELETE_REMOVED_MIGRATION,
      PURCHASE_TIER_MIGRATION,
    ];
    for (const prior of priorFiles) {
      expect(files).toContain(prior);
      expect(fixIndex).toBeGreaterThan(files.indexOf(prior));
    }
  });
});

/**
 * ⚠️ READ THIS BEFORE TRUSTING ANYTHING BELOW.
 *
 * Every assertion in this block PASSED, the migration APPLIED CLEANLY to production on
 * 2026-07-13 — and the revoke DID NOTHING. Verified after the push: `anon` and `authenticated`
 * still hold DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE on storage.objects.
 *
 * WHY: storage.objects is owned by `supabase_storage_admin`, and its ACL reads
 * `anon=arwdDxtm/supabase_storage_admin` — that role is the GRANTOR. Migrations run as
 * `postgres`. PostgreSQL's REVOKE only removes grants made BY the current role, and it does NOT
 * error when there is nothing it may revoke. `postgres` is not a member of
 * `supabase_storage_admin`, so it can neither SET ROLE to it nor use `REVOKE ... GRANTED BY`.
 * The statement is correct SQL, it is accepted, and it is inert. A platform constraint, not a
 * bug in the migration — see `20260713160000_media_guard_execute_revoke.sql`'s header.
 *
 * THE LESSON, which is the reason this comment is long: these are TEXT-LEVEL assertions. They
 * prove the migration FILE says the right thing. They can never prove Postgres DID the right
 * thing — and here that gap was not academic, it was the entire fix. `analyses_quota_soft_delete.
 * test.ts`'s header warned about exactly this class of blind spot; this is it, in the wild.
 *
 * DO NOT delete these assertions and DO NOT reword the REVOKE to try to make it "work" — it is
 * already correct. The real defense that DID land is the `pace_media_object_guard` BEFORE INSERT
 * trigger (issue #7), which every writer hits including `service_role` — a role that bypasses RLS
 * but cannot bypass a trigger. Issue #100 is REOPENED, not closed.
 */
describe("storage.objects — the revoke that applies cleanly and does nothing (issue #100)", () => {
  const sql = readMigration(FIX_MIGRATION);

  it('still ATTEMPTS the revoke — correct SQL, inert at runtime; see this block\'s header', () => {
    expect(sql).toMatch(/revoke all on storage\.objects from authenticated,\s*anon/i);
  });

  it('re-grants SELECT, unrestricted by column, to authenticated only', () => {
    expect(sql).toMatch(/grant select on storage\.objects to authenticated/i);
  });

  it('never re-grants anon anything on storage.objects', () => {
    expect(sql).not.toMatch(/grant\s+[^;]*on storage\.objects to (anon|public)\b/i);
  });

  it('never re-grants INSERT, UPDATE, DELETE, or TRUNCATE on storage.objects to a client-facing role', () => {
    expect(sql).not.toMatch(
      /grant\s+(all|insert|update|delete|truncate)[^;]*on storage\.objects to (authenticated|anon)/i
    );
  });
});

describe('public.subscriptions and public.profiles — tightened past the partial revoke', () => {
  const sql = readMigration(FIX_MIGRATION);

  it('revokes all from both roles on both tables (not just the narrower verb list)', () => {
    expect(sql).toMatch(/revoke all on public\.subscriptions from authenticated,\s*anon/i);
    expect(sql).toMatch(/revoke all on public\.profiles from authenticated,\s*anon/i);
  });

  it('re-grants SELECT to authenticated only, table-level, on both', () => {
    expect(sql).toMatch(/grant select on public\.subscriptions to authenticated/i);
    expect(sql).toMatch(/grant select on public\.profiles to authenticated/i);
  });

  it('never re-grants anon anything on either table', () => {
    expect(sql).not.toMatch(/grant\s+[^;]*on public\.subscriptions to (anon|public)\b/i);
    expect(sql).not.toMatch(/grant\s+[^;]*on public\.profiles to (anon|public)\b/i);
  });

  it('never re-grants INSERT, UPDATE, DELETE, or TRUNCATE to a client-facing role on either table', () => {
    expect(sql).not.toMatch(
      /grant\s+(all|insert|update|delete|truncate)[^;]*on public\.subscriptions to (authenticated|anon)/i
    );
    expect(sql).not.toMatch(
      /grant\s+(all|insert|update|delete|truncate)[^;]*on public\.profiles to (authenticated|anon)/i
    );
  });

  it('20260713120000 (the migration this section tightens) really does leave the narrower gap this closes', () => {
    // Proves this section is closing a REAL, currently-open gap rather than inventing redundant
    // work: 20260713120000 revokes insert/update/delete/truncate but deliberately never revokes
    // SELECT/REFERENCES/TRIGGER from anon, which is the stray grant this file's section 2 removes.
    const priorSql = readMigration(PURCHASE_TIER_MIGRATION);
    expect(priorSql).toMatch(
      /revoke insert, update, delete, truncate on public\.subscriptions from authenticated, anon/i
    );
    expect(priorSql).toMatch(
      /revoke insert, update, delete, truncate on public\.profiles\s+from authenticated, anon/i
    );
    // And it never itself issues a `revoke all` or a `select`-narrowing revoke on either table —
    // confirming there is real, non-duplicated work for this migration to do.
    expect(priorSql).not.toMatch(/revoke all on public\.(subscriptions|profiles)/i);
  });
});

describe('public.analyses — restated as already fully hardened, not new work', () => {
  const sql = readMigration(FIX_MIGRATION);

  it('restates revoke all + grant select (idempotent against the live state)', () => {
    expect(sql).toMatch(/revoke all on public\.analyses from authenticated,\s*anon/i);
    expect(sql).toMatch(/grant select on public\.analyses to authenticated/i);
  });

  it('never re-grants anon anything, or any write verb to authenticated, on analyses', () => {
    expect(sql).not.toMatch(/grant\s+[^;]*on public\.analyses to (anon|public)\b/i);
    expect(sql).not.toMatch(
      /grant\s+(all|insert|update|delete|truncate)[^;]*on public\.analyses to authenticated/i
    );
  });

  it('the migrations this section claims already fully hardened analyses really do', () => {
    // Proves the "already done, this is a restatement" claim rather than asserting it blind.
    const softDeleteSql = readMigration(ANALYSES_SOFT_DELETE_MIGRATION);
    expect(softDeleteSql).toMatch(/revoke all on public\.analyses from authenticated, anon/i);
    expect(softDeleteSql).toMatch(/grant select on public\.analyses to authenticated/i);

    const deleteRemovedSql = readMigration(ANALYSES_DELETE_REMOVED_MIGRATION);
    expect(deleteRemovedSql).toMatch(/revoke update \(deleted_at\) on public\.analyses from authenticated/i);
  });
});

describe('storage.objects RLS policies are untouched by this migration (grants and policies are separate gates)', () => {
  it('this file contains no CREATE POLICY or DROP POLICY statement at all', () => {
    const sql = readMigration(FIX_MIGRATION);
    // Strip comment lines first: the header prose legitimately discusses "CREATE/DROP POLICY" as a
    // concept (explaining that grants and policies are independent DDL) without ever issuing one —
    // matching against comment text would be a false positive on the file's own explanation of why
    // it contains none.
    const codeOnly = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(codeOnly).not.toMatch(/create\s+policy/i);
    expect(codeOnly).not.toMatch(/drop\s+policy/i);
  });

  it('the owner-scoped SELECT policy this migration\'s SELECT grant relies on still exists upstream', () => {
    // Sanity check on the dependency, not a re-test of RLS correctness itself: a grant with no
    // policy behind it would default-deny every row, which would silently break signed URLs.
    const bucketSql = readMigration('20260711150500_media_storage_bucket.sql');
    expect(bucketSql).toMatch(
      /create policy\s+"Users can view their own media objects"\s+on\s+storage\.objects\s+for\s+select/i
    );
    // And confirm the client's write policies really are gone (frame_upload_ordering's job, not
    // this migration's) — otherwise this migration's revoke would be masking a still-reachable
    // write path rather than removing a dead one.
    const orderingSql = readMigration(FRAME_UPLOAD_ORDERING_MIGRATION);
    expect(orderingSql).toMatch(
      /drop policy if exists "Users can upload their own media objects" on storage\.objects/i
    );
    expect(orderingSql).toMatch(
      /drop policy if exists "Users can delete their own media objects" on storage\.objects/i
    );
  });
});

describe('public.set_updated_at() — issue #4\'s rider', () => {
  const sql = readMigration(FIX_MIGRATION);

  it('revokes EXECUTE from public, anon, and authenticated', () => {
    expect(sql).toMatch(
      /revoke execute on function public\.set_updated_at\(\)\s+from public,\s*anon,\s*authenticated/i
    );
  });

  it('this was a real, previously-unfixed gap — handle_new_user got this treatment, set_updated_at did not, until now', () => {
    const profilesSql = readMigration('20260711150000_profiles.sql');
    // handle_new_user's own revoke, present since the first migration.
    expect(profilesSql).toMatch(
      /revoke execute on function public\.handle_new_user\(\)\s+from public,\s*anon,\s*authenticated/i
    );
    // set_updated_at is defined in the same file but, before this fix migration, never revoked
    // anywhere in the repo.
    expect(profilesSql).toMatch(/create or replace function public\.set_updated_at/i);
    const allOtherFiles = migrationFiles().filter((f) => f !== FIX_MIGRATION);
    for (const file of allOtherFiles) {
      expect(readMigration(file)).not.toMatch(/revoke execute on function public\.set_updated_at/i);
    }
  });
});

describe('this migration touches only its declared four tables and one function', () => {
  it('contains no CREATE, ALTER, or DROP TABLE/FUNCTION — a pure grant/revoke pass, nothing structural', () => {
    const sql = readMigration(FIX_MIGRATION);
    expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    expect(sql).not.toMatch(/create\s+table/i);
    expect(sql).not.toMatch(/alter\s+table/i);
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/drop\s+function/i);
  });

  it('every revoke/grant targets exactly one of the four declared surfaces', () => {
    const sql = readMigration(FIX_MIGRATION);
    const targets = [
      'storage\\.objects',
      'public\\.subscriptions',
      'public\\.profiles',
      'public\\.analyses',
      'function public\\.set_updated_at\\(\\)',
    ];
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => /^(revoke|grant)\s/i.test(s));
    expect(statements.length).toBeGreaterThan(0);
    for (const stmt of statements) {
      const matchesADeclaredTarget = targets.some((t) => new RegExp(`\\bon\\s+${t}\\b`, 'i').test(stmt));
      expect(matchesADeclaredTarget).toBe(true);
    }
  });
});
