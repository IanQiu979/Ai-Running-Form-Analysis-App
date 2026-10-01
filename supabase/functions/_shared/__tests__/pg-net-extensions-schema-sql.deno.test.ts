/**
 * BEHAVIOURAL proof of `20261001120000_pg_net_extensions_schema.sql`'s in-flight guard (issue
 * #205), executed by a real Postgres (PGlite) — same harness as `ai-guard-sql.deno.test.ts`.
 *
 * PGlite cannot load pg_net (a managed, preloaded C extension), so the one statement that needs
 * it — `create extension pg_net schema extensions;` — is stripped by the same exact-match bypass
 * the chain suites use for `20260806090000`'s install. `drop extension if exists pg_net;` stays
 * in and is a NOTICE-only no-op here. What remains is exactly the logic this file owns:
 *   - a queued pg_net request aborts the migration before the DROP, so it is never lost silently;
 *   - an empty queue, and an environment with no `net` schema at all, both pass;
 *   - `lock_timeout` is not left behind for the next migration in the same push.
 * The move itself (extnamespace → `extensions`, member objects still in `net`, the sweep route
 * still answering) can only be proved live; the scout report's verification steps do that.
 */
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { PGlite } from 'npm:@electric-sql/pglite@0.3.12';

const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url);
const MIGRATION = '20261001120000_pg_net_extensions_schema.sql';
const PG_NET_CREATE = 'create extension pg_net schema extensions;';

async function migrationForPGlite(): Promise<string> {
  const sql = await Deno.readTextFile(new URL(MIGRATION, MIGRATIONS_DIR));
  assertEquals(sql.split(PG_NET_CREATE).length - 1, 1, 'pg_net bypass must match exactly one statement');
  return sql.replace(PG_NET_CREATE, '');
}

/** The two pg_net tables the guard and the worker touch, as pg_net.sql creates them. */
const FAKE_NET = `
  create schema net;
  create unlogged table net.http_request_queue (
    id bigserial, method text not null, url text not null, headers jsonb, body bytea,
    timeout_milliseconds int not null
  );
`;

async function lockTimeout(db: PGlite): Promise<string> {
  const { rows } = await db.query<{ lock_timeout: string }>('show lock_timeout');
  return rows[0].lock_timeout;
}

Deno.test('pg_net move: a queued request aborts the migration before anything is dropped', async () => {
  const db = await new PGlite();
  await db.exec(FAKE_NET);
  await db.exec(`insert into net.http_request_queue (method, url, headers, timeout_milliseconds)
                 values ('POST', 'https://example.test/functions/v1/sweep-orphaned-media', '{}', 30000)`);

  const sql = await migrationForPGlite();
  await assertRejects(() => db.exec(sql), Error, 'pg_net has 1 queued request(s)');

  const { rows } = await db.query<{ n: number }>('select count(*)::int as n from net.http_request_queue');
  assertEquals(rows[0].n, 1, 'the queued request is still there');
  await db.close();
});

Deno.test('pg_net move: an empty queue passes and lock_timeout is reset afterwards', async () => {
  const db = await new PGlite();
  await db.exec(FAKE_NET);
  const before = await lockTimeout(db);

  await db.exec(await migrationForPGlite());

  assertEquals(await lockTimeout(db), before, 'the 10s lock_timeout must not leak into later migrations');
  await db.close();
});

Deno.test('pg_net move: an environment where pg_net was never installed passes', async () => {
  const db = await new PGlite();
  await db.exec(await migrationForPGlite());
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from pg_namespace where nspname = 'net'`);
  assertEquals(rows[0].n, 0);
  await db.close();
});
