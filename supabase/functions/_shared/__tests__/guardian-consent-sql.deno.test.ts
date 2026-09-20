/**
 * BEHAVIOURAL proof of `20260920120000_guardian_consent.sql` — the real migration, executed by a
 * real Postgres (PGlite), not a text-level assertion over the file. Same harness as
 * `ai-guard-sql.deno.test.ts`; read that file's header for what is real here and what is a
 * stand-in (`auth.users` / `auth.uid()` are the platform's, recreated minimally).
 *
 * The claims under test are all statements about what Postgres DOES with the bytes that ship:
 *   - `pace_record_age_band` writes the band, and a consent row only for 13–17, in one call;
 *   - it refuses an unknown band, and 13–17 without the attestation, leaving nothing behind;
 *   - it is write-once — a minor cannot re-record themselves as an adult;
 *   - deleting the `auth.users` row (delete-account's last step) cascades the consent row away;
 *   - no client role can write either table or call the function; `authenticated` can only
 *     SELECT its own consent row. Privileges are checked with `has_*_privilege`, per CLAUDE.md.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { PGlite } from 'npm:@electric-sql/pglite@0.3.12';

const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url);

/** `profiles` (the FK target and the `handle_new_user` trigger) plus the migration under test. */
const MIGRATIONS = ['20260711150000_profiles.sql', '20260920120000_guardian_consent.sql'] as const;

const PLATFORM_PRELUDE = `
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as $fn$
    select null::uuid;
  $fn$;
`;

const POLICY_VERSION = '2026-09-20';

async function freshDb(): Promise<PGlite> {
  const db = await new PGlite();
  await db.exec(PLATFORM_PRELUDE);
  for (const name of MIGRATIONS) {
    const sql = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(`migration ${name} failed to apply: ${(err as Error).message}`);
    }
  }
  return db;
}

/** A real `auth.users` insert, which `on_auth_user_created` turns into a `profiles` row. */
async function createUser(db: PGlite): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
    [`${crypto.randomUUID()}@example.test`]
  );
  return rows[0].id;
}

function recordAgeBand(
  db: PGlite,
  userId: string,
  ageBand: string | null,
  guardianConsent: boolean | null,
  policyVersion: string | null = POLICY_VERSION
) {
  return db.query(`select public.pace_record_age_band($1, $2, $3, $4)`, [
    userId,
    ageBand,
    guardianConsent,
    policyVersion,
  ]);
}

async function readBand(db: PGlite, userId: string): Promise<string | null> {
  const { rows } = await db.query<{ age_band: string | null }>(
    `select age_band from public.profiles where id = $1`,
    [userId]
  );
  return rows[0].age_band;
}

async function readConsent(db: PGlite, userId: string) {
  const { rows } = await db.query<{ policy_version: string; granted_at: string }>(
    `select policy_version, granted_at from public.guardian_consent where user_id = $1`,
    [userId]
  );
  return rows;
}

Deno.test('18_plus records the band and writes no guardian_consent row', async () => {
  const db = await freshDb();
  try {
    const userId = await createUser(db);
    await recordAgeBand(db, userId, '18_plus', false);
    assertEquals(await readBand(db, userId), '18_plus');
    assertEquals((await readConsent(db, userId)).length, 0);
  } finally {
    await db.close();
  }
});

Deno.test('13_17 with the attestation records the band AND a consent row stamped with the policy version', async () => {
  const db = await freshDb();
  try {
    const userId = await createUser(db);
    await recordAgeBand(db, userId, '13_17', true);
    assertEquals(await readBand(db, userId), '13_17');
    const consent = await readConsent(db, userId);
    assertEquals(consent.length, 1);
    assertEquals(consent[0].policy_version, POLICY_VERSION);
    assert(consent[0].granted_at, 'granted_at is stamped');
  } finally {
    await db.close();
  }
});

Deno.test('13_17 without the attestation is refused by name and leaves nothing behind', async () => {
  const db = await freshDb();
  try {
    const userId = await createUser(db);
    for (const consent of [false, null]) {
      await assertRejects(
        () => recordAgeBand(db, userId, '13_17', consent),
        Error,
        'guardian_consent_required'
      );
    }
    assertEquals(await readBand(db, userId), null);
    assertEquals((await readConsent(db, userId)).length, 0);
  } finally {
    await db.close();
  }
});

Deno.test('an unknown band (including under 13, which is not offered) is refused by name', async () => {
  const db = await freshDb();
  try {
    const userId = await createUser(db);
    for (const band of ['under_13', '16_plus', '', null]) {
      await assertRejects(() => recordAgeBand(db, userId, band, true), Error, 'age_band_invalid');
    }
    assertEquals(await readBand(db, userId), null);
  } finally {
    await db.close();
  }
});

Deno.test('13_17 without a policy version is refused — a consent row must say what it covered', async () => {
  const db = await freshDb();
  try {
    const userId = await createUser(db);
    await assertRejects(() => recordAgeBand(db, userId, '13_17', true, ''), Error, 'policy_version_required');
    assertEquals(await readBand(db, userId), null);
  } finally {
    await db.close();
  }
});

Deno.test('the band is write-once: a minor cannot re-record themselves as 18_plus', async () => {
  const db = await freshDb();
  try {
    const userId = await createUser(db);
    await recordAgeBand(db, userId, '13_17', true);
    await assertRejects(
      () => recordAgeBand(db, userId, '18_plus', false),
      Error,
      'age_band_already_recorded'
    );
    assertEquals(await readBand(db, userId), '13_17');
    assertEquals((await readConsent(db, userId)).length, 1);
  } finally {
    await db.close();
  }
});

Deno.test('an unknown user id is refused as profile_not_found, not silently accepted', async () => {
  const db = await freshDb();
  try {
    await assertRejects(
      () => recordAgeBand(db, crypto.randomUUID(), '18_plus', false),
      Error,
      'profile_not_found'
    );
  } finally {
    await db.close();
  }
});

Deno.test('the profiles CHECK rejects a band written around the function', async () => {
  const db = await freshDb();
  try {
    const userId = await createUser(db);
    await assertRejects(
      () => db.query(`update public.profiles set age_band = 'under_13' where id = $1`, [userId]),
      Error,
      'profiles_age_band_check'
    );
  } finally {
    await db.close();
  }
});

Deno.test('deleting the auth.users row (delete-account) cascades the guardian_consent row away', async () => {
  const db = await freshDb();
  try {
    const userId = await createUser(db);
    await recordAgeBand(db, userId, '13_17', true);
    assertEquals((await readConsent(db, userId)).length, 1);
    // delete-account.ts deletes the `profiles` row first, then the auth user. Mirror that order:
    // the consent row must survive the first step (its FK is to auth.users, not profiles) and go
    // with the second.
    await db.query(`delete from public.profiles where id = $1`, [userId]);
    assertEquals((await readConsent(db, userId)).length, 1, 'survives the profile delete');
    await db.query(`delete from auth.users where id = $1`, [userId]);
    assertEquals((await readConsent(db, userId)).length, 0, 'gone with the auth user');
  } finally {
    await db.close();
  }
});

Deno.test('privileges: clients can only SELECT guardian_consent; only service_role may call the function', async () => {
  const db = await freshDb();
  try {
    const { rows } = await db.query<{
      auth_select: boolean;
      auth_insert: boolean;
      auth_update: boolean;
      auth_delete: boolean;
      auth_truncate: boolean;
      anon_select: boolean;
      anon_exec: boolean;
      auth_exec: boolean;
      service_exec: boolean;
    }>(`
      select
        has_table_privilege('authenticated', 'public.guardian_consent', 'select')   as auth_select,
        has_table_privilege('authenticated', 'public.guardian_consent', 'insert')   as auth_insert,
        has_table_privilege('authenticated', 'public.guardian_consent', 'update')   as auth_update,
        has_table_privilege('authenticated', 'public.guardian_consent', 'delete')   as auth_delete,
        has_table_privilege('authenticated', 'public.guardian_consent', 'truncate') as auth_truncate,
        has_table_privilege('anon', 'public.guardian_consent', 'select')            as anon_select,
        has_function_privilege('anon', 'public.pace_record_age_band(uuid, text, boolean, text)', 'execute')          as anon_exec,
        has_function_privilege('authenticated', 'public.pace_record_age_band(uuid, text, boolean, text)', 'execute') as auth_exec,
        has_function_privilege('service_role', 'public.pace_record_age_band(uuid, text, boolean, text)', 'execute')  as service_exec
    `);
    const p = rows[0];
    assertEquals(p.auth_select, true);
    assertEquals(p.auth_insert, false);
    assertEquals(p.auth_update, false);
    assertEquals(p.auth_delete, false);
    assertEquals(p.auth_truncate, false);
    assertEquals(p.anon_select, false);
    assertEquals(p.anon_exec, false);
    assertEquals(p.auth_exec, false);
    assertEquals(p.service_exec, true);

    const { rows: rls } = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where oid = 'public.guardian_consent'::regclass`
    );
    assertEquals(rls[0].relrowsecurity, true);
    const { rows: policies } = await db.query<{ polcmd: string }>(
      `select polcmd from pg_policy where polrelid = 'public.guardian_consent'::regclass`
    );
    assertEquals(policies.map((row) => row.polcmd), ['r'], 'exactly one policy, SELECT only');
  } finally {
    await db.close();
  }
});
