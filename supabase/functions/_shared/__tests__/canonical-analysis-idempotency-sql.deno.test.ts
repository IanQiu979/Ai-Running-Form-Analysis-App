/**
 * Real-Postgres behavior lock for canonical analysis reservations.
 *
 * PGlite executes the committed migrations verbatim. Its single connection cannot create true
 * lock contention, but the paired-call test still exercises the unique canonical-claim invariant
 * and the observable one-owner/one-existing result. Contended advisory-lock coverage remains a
 * local-Supabase integration concern.
 */
import { assert, assertEquals, assertNotEquals, assertRejects } from 'jsr:@std/assert@1';
import { PGlite } from 'npm:@electric-sql/pglite@0.3.12';

const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url);
const MIGRATIONS = [
  '20260711150000_profiles.sql',
  '20260711150100_subscriptions.sql',
  '20260711150200_analyses.sql',
  '20260711150300_quota_period_helpers.sql',
  '20260712040000_analyses_quota_soft_delete.sql',
  '20260712220000_anti_farm_release_reason_fix.sql',
  '20260819120000_zero_pillar_release_reason.sql',
  '20260906120000_invalid_safety_release_reason.sql',
  '20260909120000_canonical_analysis_idempotency.sql',
] as const;

const PLATFORM_PRELUDE = `
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as $fn$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $fn$;
`;

const FINGERPRINT_A = 'a'.repeat(64);
const FINGERPRINT_B = 'b'.repeat(64);

interface ReserveResult {
  allowed: boolean;
  existing?: boolean;
  id?: string;
  reason?: string;
  status?: string;
  tier?: string;
  result?: unknown;
  is_fallback?: boolean;
}

async function freshDb(): Promise<PGlite> {
  const db = await new PGlite();
  await db.exec(PLATFORM_PRELUDE);
  for (const name of MIGRATIONS) {
    try {
      const sql = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
      await db.exec(sql);
    } catch (error) {
      // Before the TDD implementation exists, continue without only the target migration so the
      // red failure names the missing database behavior/function rather than a missing test file.
      if (name === '20260909120000_canonical_analysis_idempotency.sql' && error instanceof Deno.errors.NotFound) {
        continue;
      }
      throw new Error(`migration ${name} failed to apply: ${(error as Error).message}`);
    }
  }
  return db;
}

async function createUser(db: PGlite, tier: 'free' | 'pro' | 'elite' = 'free'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
    [`${tier}-${crypto.randomUUID()}@example.test`],
  );
  const userId = rows[0].id;
  if (tier !== 'free') {
    await db.query(
      `insert into public.subscriptions (user_id, tier, status, purchased_at)
       values ($1, $2::public.subscription_tier, 'active', now())`,
      [userId, tier],
    );
  }
  return userId;
}

function identity(inputFingerprint = FINGERPRINT_A, analyzerRevision = 'pace-v2.3-r1') {
  return { input_fingerprint: inputFingerprint, analyzer_revision: analyzerRevision };
}

async function reserve(
  db: PGlite,
  userId: string,
  key: string,
  analysisIdentity = identity(),
  fn: 'reserve_analysis' | 'reserve_analysis_unlimited' = 'reserve_analysis',
): Promise<ReserveResult> {
  const { rows } = await db.query<{ out: ReserveResult }>(
    `select public.${fn}($1::uuid, $2::text, 'photo'::public.media_type, 1, $3::jsonb) as out`,
    [userId, key, JSON.stringify(analysisIdentity)],
  );
  return rows[0].out;
}

async function withDb(run: (db: PGlite) => Promise<void>): Promise<void> {
  const db = await freshDb();
  try {
    await run(db);
  } finally {
    await db.close();
  }
}

Deno.test('canonical replay precedes Free quota and changed input under one key fails closed', async () => {
  await withDb(async (db) => {
    const userId = await createUser(db);
    const owner = await reserve(db, userId, 'owner');
    assertEquals(owner.allowed, true);
    assertEquals(owner.existing, false);

    await db.query(
      `update public.analyses set status = 'delivered', result = '{"verdict":"pinned"}'::jsonb
       where id = $1::uuid`,
      [owner.id],
    );

    const replay = await reserve(db, userId, 'retry-with-a-new-key');
    assertEquals(replay.allowed, true);
    assertEquals(replay.existing, true);
    assertEquals(replay.id, owner.id);
    assertEquals(replay.result, { verdict: 'pinned' });

    const quotaMiss = await reserve(db, userId, 'different-input', identity(FINGERPRINT_B));
    assertEquals(quotaMiss.allowed, false);
    assertEquals(quotaMiss.reason, 'quota_exceeded');

    const changedSameKey = await reserve(db, userId, 'owner', identity(FINGERPRINT_B));
    assertEquals(changedSameKey.allowed, false);
    assertEquals(changedSameKey.reason, 'idempotency_identity_mismatch');
  });
});

Deno.test('the same input is isolated by server-derived tier', async () => {
  await withDb(async (db) => {
    const userId = await createUser(db);
    const free = await reserve(db, userId, 'free-owner');
    await db.query(
      `insert into public.subscriptions (user_id, tier, status, purchased_at)
       values ($1, 'pro', 'active', now())`,
      [userId],
    );
    const pro = await reserve(db, userId, 'pro-owner');
    assertEquals(free.tier, 'free');
    assertEquals(pro.tier, 'pro');
    assertEquals(pro.existing, false);
    assertNotEquals(pro.id, free.id);
  });
});

Deno.test('analyzer revision is part of identity and malformed server identity is rejected', async () => {
  await withDb(async (db) => {
    const userId = await createUser(db, 'pro');
    const first = await reserve(db, userId, 'revision-one', identity(FINGERPRINT_A, 'pace-v2.3-r1'));
    const nextRevision = await reserve(
      db,
      userId,
      'revision-two',
      identity(FINGERPRINT_A, 'pace-v2.3-r2'),
    );
    assertEquals(first.existing, false);
    assertEquals(nextRevision.existing, false);
    assertNotEquals(nextRevision.id, first.id);

    for (const [key, badIdentity] of [
      ['uppercase-fingerprint', identity('A'.repeat(64))],
      ['short-fingerprint', identity('a'.repeat(63))],
      ['blank-revision', identity(FINGERPRINT_A, '')],
      ['unstable-revision', identity(FINGERPRINT_A, 'spaces are not stable')],
      [
        'non-string-revision',
        { input_fingerprint: FINGERPRINT_A, analyzer_revision: 123 } as unknown as ReturnType<
          typeof identity
        >,
      ],
    ] as const) {
      const denied = await reserve(db, userId, key, badIdentity);
      assertEquals(denied.allowed, false);
      assertEquals(denied.reason, 'invalid_analysis_identity');
    }
  });
});

Deno.test('release and soft-delete retire a claim so a fresh key can own the identity', async () => {
  await withDb(async (db) => {
    const userId = await createUser(db, 'elite');
    const released = await reserve(db, userId, 'released-owner');
    await db.query(
      `update public.analyses
       set status = 'released', released_at = now(), release_reason = 'model_error'
       where id = $1::uuid`,
      [released.id],
    );
    const afterRelease = await reserve(db, userId, 'after-release');
    assertEquals(afterRelease.existing, false);
    assertNotEquals(afterRelease.id, released.id);

    await db.query(
      `update public.analyses set status = 'delivered', result = '{"private":"body-data"}'::jsonb
       where id = $1::uuid`,
      [afterRelease.id],
    );
    await db.query(`update public.analyses set deleted_at = now() where id = $1::uuid`, [afterRelease.id]);

    const afterDelete = await reserve(
      db,
      userId,
      'after-delete',
      identity(),
      'reserve_analysis_unlimited',
    );
    assertEquals(afterDelete.existing, false);
    assertNotEquals(afterDelete.id, afterRelease.id);

    const { rows } = await db.query<{ claims: string; redacted: boolean }>(
      `select
         (select count(*)::text from public.canonical_analysis_claims where user_id = $1) as claims,
         (select result is null and media_paths = '{}'::text[] from public.analyses where id = $2) as redacted`,
      [userId, afterRelease.id],
    );
    assertEquals(Number(rows[0].claims), 1);
    assertEquals(rows[0].redacted, true);
  });
});

Deno.test('authenticated resolver follows direct and alias keys without exposing identity', async () => {
  await withDb(async (db) => {
    const ownerId = await createUser(db, 'pro');
    const otherId = await createUser(db, 'pro');
    const owner = await reserve(db, ownerId, 'direct-key');
    await db.query(
      `update public.analyses
       set status = 'delivered', result = '{"verdict":"same"}'::jsonb, is_fallback = true
       where id = $1::uuid`,
      [owner.id],
    );
    await reserve(db, ownerId, 'alias-key');

    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${ownerId}';`);
    const { rows } = await db.query<{ direct: Record<string, unknown>; alias: Record<string, unknown> }>(
      `select public.resolve_analysis_request('direct-key') as direct,
              public.resolve_analysis_request('alias-key') as alias`,
    );
    assertEquals(rows[0].direct, rows[0].alias);
    assertEquals(Object.keys(rows[0].direct).sort(), ['id', 'is_fallback', 'result', 'status']);
    await assertRejects(
      () => db.query(`select * from public.canonical_analysis_claims`),
      Error,
      'permission denied',
    );
    await assertRejects(
      () => db.query(`select * from public.analysis_request_aliases`),
      Error,
      'permission denied',
    );

    await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${otherId}';`);
    const { rows: hidden } = await db.query<{ out: unknown }>(
      `select public.resolve_analysis_request('alias-key') as out`,
    );
    assertEquals(hidden[0].out, null);
    await db.exec('reset role;');
  });
});

Deno.test('paired identical reservations produce one owner and one existing canonical result', async () => {
  await withDb(async (db) => {
    const userId = await createUser(db, 'pro');
    const [first, second] = await Promise.all([
      reserve(db, userId, 'race-a'),
      reserve(db, userId, 'race-b'),
    ]);
    assertEquals(first.id, second.id);
    assertEquals([first.existing, second.existing].sort(), [false, true]);
    const { rows } = await db.query<{ analyses: string; claims: string; aliases: string }>(
      `select
         (select count(*)::text from public.analyses where user_id = $1) as analyses,
         (select count(*)::text from public.canonical_analysis_claims where user_id = $1) as claims,
         (select count(*)::text from public.analysis_request_aliases where user_id = $1) as aliases`,
      [userId],
    );
    assertEquals(Number(rows[0].analyses), 1);
    assertEquals(Number(rows[0].claims), 1);
    assertEquals(Number(rows[0].aliases), 2);
  });
});

Deno.test('existing-result replays execute a row-locking read in both five-argument overloads', async () => {
  await withDb(async (db) => {
    const userId = await createUser(db, 'pro');
    await reserve(db, userId, 'normal-owner');
    await reserve(db, userId, 'unlimited-owner', identity(FINGERPRINT_B), 'reserve_analysis_unlimited');

    for (const [keys, analysisIdentity, fn] of [
      [['normal-owner', 'normal-new-alias'], identity(), 'reserve_analysis'],
      [
        ['unlimited-owner', 'unlimited-new-alias'],
        identity(FINGERPRINT_B),
        'reserve_analysis_unlimited',
      ],
    ] as const) {
      for (const key of keys) {
        await db.exec('begin read only');
        try {
          // The first key takes the direct/alias replay path; the second takes the active-claim
          // path and would later INSERT an alias. Asserting the exact first rejected operation is
          // SELECT FOR SHARE proves both reads lock before either a response or alias write.
          // PGlite cannot share one in-memory DB across two connections, so actual blocking/wakeup
          // behavior remains a local-Supabase integration concern.
          await assertRejects(
            () => reserve(db, userId, key, analysisIdentity, fn),
            Error,
            'cannot execute SELECT FOR SHARE in a read-only transaction',
          );
        } finally {
          await db.exec('rollback');
        }
      }
    }
  });
});

Deno.test('identity tables are RLS-default-deny and account deletion removes all identity data', async () => {
  await withDb(async (db) => {
    const { rows: privileges } = await db.query<{
      anon_claims: boolean;
      auth_claims: boolean;
      anon_aliases: boolean;
      auth_aliases: boolean;
      auth_resolver: boolean;
      auth_reserve: boolean;
    }>(
      `select
         has_table_privilege('anon', 'public.canonical_analysis_claims', 'select') as anon_claims,
         has_table_privilege('authenticated', 'public.canonical_analysis_claims', 'select') as auth_claims,
         has_table_privilege('anon', 'public.analysis_request_aliases', 'select') as anon_aliases,
         has_table_privilege('authenticated', 'public.analysis_request_aliases', 'select') as auth_aliases,
         has_function_privilege('authenticated', 'public.resolve_analysis_request(text)', 'execute') as auth_resolver,
         has_function_privilege(
           'authenticated',
           'public.reserve_analysis(uuid,text,public.media_type,integer,jsonb)',
           'execute'
         ) as auth_reserve`,
    );
    assertEquals(privileges[0], {
      anon_claims: false,
      auth_claims: false,
      anon_aliases: false,
      auth_aliases: false,
      auth_resolver: true,
      auth_reserve: false,
    });

    const { rows: rls } = await db.query<{ name: string; rls: boolean; policies: string }>(
      `select c.relname as name, c.relrowsecurity as rls, count(p.polname)::text as policies
       from pg_class c
       left join pg_policy p on p.polrelid = c.oid
       where c.oid in (
         'public.canonical_analysis_claims'::regclass,
         'public.analysis_request_aliases'::regclass
       )
       group by c.relname, c.relrowsecurity
       order by c.relname`,
    );
    assertEquals(rls, [
      { name: 'analysis_request_aliases', rls: true, policies: '0' },
      { name: 'canonical_analysis_claims', rls: true, policies: '0' },
    ]);

    const userId = await createUser(db, 'pro');
    await reserve(db, userId, 'account-delete');
    await db.query(`delete from auth.users where id = $1::uuid`, [userId]);
    const { rows: counts } = await db.query<{ analyses: string; claims: string; aliases: string }>(
      `select
         (select count(*)::text from public.analyses where user_id = $1) as analyses,
         (select count(*)::text from public.canonical_analysis_claims where user_id = $1) as claims,
         (select count(*)::text from public.analysis_request_aliases where user_id = $1) as aliases`,
      [userId],
    );
    assertEquals(counts[0], { analyses: '0', claims: '0', aliases: '0' });
  });
});

Deno.test('legacy four-argument reservation signature remains callable', async () => {
  await withDb(async (db) => {
    const userId = await createUser(db, 'pro');
    const { rows } = await db.query<{ normal: ReserveResult }>(
      `select public.reserve_analysis($1::uuid, 'legacy-normal', 'photo'::public.media_type, 1) as normal`,
      [userId],
    );
    assert(rows[0].normal.allowed);
  });
});
