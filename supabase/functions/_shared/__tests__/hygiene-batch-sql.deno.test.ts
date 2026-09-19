/**
 * Behavioural proof for the two 2026-09-19 hygiene migrations, applied verbatim to PGlite
 * (Postgres 17 as WASM, in-process — the `ai-guard-sql.deno.test.ts` harness):
 *
 *   - `20260919140000_before_user_created_hook.sql` — the `before-user-created` auth hook that
 *     closes raw `/auth/v1/signup` for every provider but `google` and `apple`, and is
 *     executable by `supabase_auth_admin` only.
 *   - `20260919150000_sweep_orphaned_media_live.sql` — re-schedules `sweep-orphaned-media-daily`
 *     with `{"dryRun": false}` and must UPDATE the existing job, not add a second one.
 *
 * `cron.schedule` here is the same named-upsert stand-in `zero-pillar-cooldown-sql.deno.test.ts`
 * uses (pg_cron itself is a managed extension PGlite cannot load); the assertion is on the row
 * the migration leaves behind, which is what the real scheduler executes.
 */
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { PGlite } from 'npm:@electric-sql/pglite@0.3.12';

const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url);
const HOOK_MIGRATION = '20260919140000_before_user_created_hook.sql';
const CRON_MIGRATION = '20260806090000_sweep_orphaned_media_cron.sql';
const LIVE_MIGRATION = '20260919150000_sweep_orphaned_media_live.sql';
const PG_NET_INSTALL = 'create extension if not exists pg_net;';

const PRELUDE = `
  create role anon;
  create role authenticated;
  create role service_role;
  create role supabase_auth_admin;

  create schema cron;
  create table cron.job (
    jobid bigint generated always as identity primary key,
    jobname text not null unique,
    schedule text not null,
    command text not null
  );
  create or replace function cron.schedule(p_job_name text, p_schedule text, p_command text)
  returns bigint language sql as $fn$
    insert into cron.job (jobname, schedule, command)
    values (p_job_name, p_schedule, p_command)
    on conflict (jobname) do update
      set schedule = excluded.schedule, command = excluded.command
    returning jobid;
  $fn$;
`;

async function migration(name: string): Promise<string> {
  return await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
}

async function freshDb(): Promise<PGlite> {
  const db = await new PGlite();
  await db.exec(PRELUDE);
  return db;
}

function hookEvent(provider: string | null): string {
  const appMetadata = provider === null ? {} : { provider, providers: [provider] };
  return JSON.stringify({
    metadata: { uuid: '00000000-0000-0000-0000-000000000000', name: 'before-user-created' },
    user: { id: '11111111-1111-1111-1111-111111111111', email: 'runner@example.com', app_metadata: appMetadata },
  });
}

async function callHook(db: PGlite, provider: string | null): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ out: Record<string, unknown> }>(
    'select public.pace_before_user_created($1::jsonb) as out',
    [hookEvent(provider)],
  );
  return rows[0].out;
}

Deno.test('before-user-created hook: allow-lists google and apple; email, phone, anonymous, unknown and missing providers are rejected', async () => {
  const db = await freshDb();
  await db.exec(await migration(HOOK_MIGRATION));

  for (const provider of ['email', 'phone', 'anonymous', 'saml', 'web3', null]) {
    const out = await callHook(db, provider);
    const error = out.error as { http_code: number; message: string } | undefined;
    assert(error, `provider ${provider} must be rejected`);
    assertEquals(error.http_code, 403);
    assertEquals(error.message, 'Accounts are created through the Pace Analysis AI app only.');
  }

  for (const provider of ['google', 'apple']) {
    assertEquals(await callHook(db, provider), {}, `provider ${provider} must be allowed`);
  }
  await db.close();
});

Deno.test('before-user-created hook: only supabase_auth_admin may execute it', async () => {
  const db = await freshDb();
  await db.exec(await migration(HOOK_MIGRATION));

  const { rows } = await db.query<{ role: string; can: boolean }>(`
    select r.role, has_function_privilege(r.role, 'public.pace_before_user_created(jsonb)', 'execute') as can
    from unnest(array['supabase_auth_admin', 'anon', 'authenticated', 'service_role']) as r(role)
  `);
  assertEquals(
    Object.fromEntries(rows.map((r) => [r.role, r.can])),
    { supabase_auth_admin: true, anon: false, authenticated: false, service_role: false },
  );
  await db.close();
});

Deno.test('sweeper live migration: updates the existing daily job in place to dryRun false', async () => {
  const db = await freshDb();
  const cronSql = await migration(CRON_MIGRATION);
  assertEquals(cronSql.split(PG_NET_INSTALL).length - 1, 1, 'pg_net bypass must match exactly one statement');
  await db.exec(cronSql.replace(PG_NET_INSTALL, ''));

  const before = await db.query<{ jobid: number; command: string }>(
    `select jobid, command from cron.job where jobname = 'sweep-orphaned-media-daily'`,
  );
  assertEquals(before.rows.length, 1);
  assert(before.rows[0].command.includes(`body := '{}'::jsonb`), 'the original schedule is a dry run');

  await db.exec(await migration(LIVE_MIGRATION));

  const after = await db.query<{ jobid: number; schedule: string; command: string }>(
    `select jobid, schedule, command from cron.job where jobname = 'sweep-orphaned-media-daily'`,
  );
  assertEquals(after.rows.length, 1, 'still exactly one job by that name');
  assertEquals(after.rows[0].jobid, before.rows[0].jobid, 'same job, updated in place');
  assertEquals(after.rows[0].schedule, '0 9 * * *');
  assert(after.rows[0].command.includes(`body := '{"dryRun": false}'::jsonb`), 'armed for live deletion');
  assert(!after.rows[0].command.includes(`body := '{}'`), 'dry-run body is gone');
  assert(
    after.rows[0].command.includes(`where name = 'sweep_orphaned_media_cron_secret'`),
    'the Vault secret is still referenced by name',
  );
  assert(after.rows[0].command.includes('/functions/v1/sweep-orphaned-media'), 'same endpoint');

  const all = await db.query<{ n: number }>('select count(*)::int as n from cron.job');
  assertEquals(all.rows[0].n, 1);
  await db.close();
});
