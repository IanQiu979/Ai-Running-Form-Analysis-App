/**
 * Companion to `supabase/functions/_shared/__tests__/pg-net-extensions-schema-sql.deno.test.ts`,
 * which proves the in-flight guard's BEHAVIOUR against a real (WASM) Postgres.
 *
 * This file asserts only what the diff does NOT do, which no runtime can check without pg_net:
 * it does not try `alter extension ... set schema` (pg_net 0.20.3 is not relocatable, so that
 * statement fails on the live project), it does not CASCADE the drop (an unexpected dependent must
 * stop the migration, not be deleted with it), it does not re-schedule the sweep job, it does not
 * write a REVOKE that `postgres` cannot make take effect (issue #205; docs/status.md Known Issue
 * #18 is the same trap on `storage.objects`), and it leaves `20260806090000`'s original install
 * statement alone — four PGlite chain suites strip that exact line.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..');
const MOVE_MIGRATION = '20261001120000_pg_net_extensions_schema.sql';
const INSTALL_MIGRATION = '20260806090000_sweep_orphaned_media_cron.sql';

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // timestamp-prefixed, so lexical sort == application order
}

/** The file with `--` comments removed, so prose about a statement is never mistaken for one. */
function statements(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), 'utf8')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

const code = statements(MOVE_MIGRATION);

describe('the pg_net schema move (issue #205)', () => {
  it('sorts after the migrations that installed pg_net and last scheduled the sweep', () => {
    const files = migrationFiles();
    expect(files.indexOf(MOVE_MIGRATION)).toBeGreaterThan(files.indexOf(INSTALL_MIGRATION));
    expect(files.indexOf(MOVE_MIGRATION)).toBeGreaterThan(
      files.indexOf('20260919150000_sweep_orphaned_media_live.sql'),
    );
  });

  it('re-creates pg_net in extensions exactly once, after a non-cascading drop', () => {
    expect(code.match(/create extension pg_net schema extensions;/g)).toHaveLength(1);
    expect(code).toMatch(/drop extension if exists pg_net;/);
    expect(code).not.toMatch(/cascade/i);
    expect(code.indexOf('drop extension')).toBeLessThan(code.indexOf('create extension'));
  });

  it('checks the request queue before the drop', () => {
    expect(code.indexOf('net.http_request_queue')).toBeLessThan(code.indexOf('drop extension'));
  });

  it('does not attempt SET SCHEMA, which pg_net 0.20.3 does not support', () => {
    expect(code).not.toMatch(/set\s+schema/i);
  });

  it('writes no grant or revoke, and does not touch the cron schedule', () => {
    expect(code).not.toMatch(/\b(grant|revoke)\b/i);
    expect(code).not.toMatch(/cron\./i);
  });

  it('leaves the original install statement in 20260806090000 untouched', () => {
    expect(statements(INSTALL_MIGRATION).match(/create extension if not exists pg_net;/g)).toHaveLength(1);
  });
});
