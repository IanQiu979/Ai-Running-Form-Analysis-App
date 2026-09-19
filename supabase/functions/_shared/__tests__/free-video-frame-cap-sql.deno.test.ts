/**
 * BEHAVIOURAL proof of issue #89's frame-cap change — the real migration SQL, executed by a real
 * Postgres (PGlite), not a text-level assertion over the migration file. Same harness shape as
 * `zero-pillar-uncharged-sql.deno.test.ts` and `ai-guard-sql.deno.test.ts`; see the former's
 * header for what is real and what is a stand-in (auth/storage/cron schemas, no concurrency).
 *
 * WHAT IS PROVEN HERE, by tier AND by medium:
 *   - `reserve_analysis` accepts a Free VIDEO of exactly `PACE_FRAME_CAP.free` (5) frames and
 *     refuses 6 with `frame_cap_exceeded` reporting `frame_cap: 5` — the same burst Pro gets.
 *   - A PHOTO is exactly one frame on EVERY tier: 5 photo frames are refused with
 *     `invalid_frame_count_for_photo` before the tier is even consulted, and one photo frame is
 *     accepted on Free. The medium rule, not the tier rule, is what keeps a Free photo at 2 of 4.
 *   - Pro 5 / Elite 8 are unchanged (6 and 9 refused respectively).
 *   - `pace_quota_status` REPORTS the same table (`frame_cap`) the reserve ENFORCES, per tier —
 *     this is the number the client extracts, so the two cannot be allowed to disagree.
 *   - Everything else about the Free contract is unchanged: one lifetime analysis (`limit: 1`,
 *     the second reserve is `quota_exceeded`), and the override's 8-frame display is untouched.
 *   - The two replaced functions keep their hardened posture (SECURITY DEFINER, service_role only).
 */
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { PGlite } from 'npm:@electric-sql/pglite@0.3.12';

import { PACE_FRAME_CAP } from '../pace.ts';

const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url);

const LAST_MIGRATION = '20260919120000_free_video_stride_burst_frame_cap.sql';

const MANAGED_EXTENSION_INSTALL_STATEMENTS: Readonly<Record<string, readonly string[]>> = {
  '20260713130000_stale_reservation_sweep.sql': [
    'create extension if not exists pg_cron with schema pg_catalog;',
  ],
  '20260806090000_sweep_orphaned_media_cron.sql': ['create extension if not exists pg_net;'],
};

const PLATFORM_PRELUDE = `
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as $fn$
    select null::uuid;
  $fn$;

  create schema storage;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null,
    name text not null,
    metadata jsonb,
    created_at timestamptz not null default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $fn$
    select string_to_array(trim(both '/' from name), '/');
  $fn$;

  create schema cron;
  create table cron.job (
    jobid bigint generated always as identity primary key,
    jobname text not null unique,
    schedule text not null,
    command text not null
  );
  create or replace function cron.schedule(
    p_job_name text,
    p_schedule text,
    p_command text
  ) returns bigint language sql as $fn$
    insert into cron.job (jobname, schedule, command)
    values (p_job_name, p_schedule, p_command)
    on conflict (jobname) do update
      set schedule = excluded.schedule, command = excluded.command
    returning jobid;
  $fn$;
`;

const REVISION = 'pace-v2.3-r1';

type Tier = 'free' | 'pro' | 'elite';
type Medium = 'photo' | 'video';

interface ReserveResult {
  allowed: boolean;
  existing?: boolean;
  id?: string;
  reason?: string;
  status?: string;
  tier?: string;
  frame_cap?: number;
  used?: number;
  limit?: number;
}

interface QuotaStatus {
  tier: Tier;
  used: number;
  limit: number | null;
  frame_cap: number;
  is_lifetime: boolean;
  blocked: boolean;
  unlimited?: boolean;
}

async function migrationChain(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && /^\d{14}.*\.sql$/.test(entry.name) && entry.name <= LAST_MIGRATION) {
      names.push(entry.name);
    }
  }
  return names.sort();
}

function sqlForPGlite(name: string, source: string): string {
  let sql = source;
  for (const statement of MANAGED_EXTENSION_INSTALL_STATEMENTS[name] ?? []) {
    assertEquals(
      sql.split(statement).length - 1,
      1,
      `${name}'s managed-extension bypass must match exactly one statement`
    );
    sql = sql.replace(statement, '');
  }
  return sql;
}

async function freshDb(): Promise<PGlite> {
  const db = await new PGlite();
  await db.exec(PLATFORM_PRELUDE);

  const migrations = await migrationChain();
  assertEquals(migrations.at(-1), LAST_MIGRATION, 'the #89 migration must be the last file in the applied chain');

  for (const name of migrations) {
    const source = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
    try {
      await db.exec(sqlForPGlite(name, source));
    } catch (error) {
      throw new Error(`migration ${name} failed to apply: ${(error as Error).message}`);
    }
  }
  return db;
}

async function withDb(run: (db: PGlite) => Promise<void>): Promise<void> {
  const db = await freshDb();
  try {
    await run(db);
  } finally {
    await db.close();
  }
}

async function createUser(db: PGlite, tier: Tier = 'free'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
    [`${tier}-${crypto.randomUUID()}@example.test`]
  );
  const userId = rows[0].id;
  if (tier !== 'free') {
    await db.query(
      `insert into public.subscriptions (user_id, tier, status, purchased_at)
       values ($1, $2::public.subscription_tier, 'active', now())`,
      [userId, tier]
    );
  }
  return userId;
}

/** Each call gets its own idempotency key and its own fingerprint, so no test here ever hits the
 * request-key or canonical-claim replay paths — the frame gate is what is under test. */
async function reserve(db: PGlite, userId: string, medium: Medium, frameCount: number): Promise<ReserveResult> {
  const key = crypto.randomUUID();
  const fingerprint = key.replaceAll('-', '').padEnd(64, '0').slice(0, 64);
  const { rows } = await db.query<{ out: ReserveResult }>(
    `select public.reserve_analysis($1::uuid, $2::text, $3::public.media_type, $4::integer, $5::jsonb) as out`,
    [userId, key, medium, frameCount, JSON.stringify({ input_fingerprint: fingerprint, analyzer_revision: REVISION })]
  );
  return rows[0].out;
}

async function quotaStatus(
  db: PGlite,
  userId: string,
  fn: 'pace_quota_status' | 'pace_quota_status_unlimited' = 'pace_quota_status'
): Promise<QuotaStatus> {
  const { rows } = await db.query<{ out: QuotaStatus }>(`select public.${fn}($1::uuid) as out`, [userId]);
  return rows[0].out;
}

// -------------------------------------------------------------------------------------------
// The cap, by tier and by medium
// -------------------------------------------------------------------------------------------

Deno.test('#89: a Free VIDEO reserves at exactly PACE_FRAME_CAP.free (5) frames and is refused at 6', async () => {
  await withDb(async (db) => {
    const user = await createUser(db, 'free');

    const overCap = await reserve(db, user, 'video', PACE_FRAME_CAP.free + 1);
    assertEquals(overCap.allowed, false);
    assertEquals(overCap.reason, 'frame_cap_exceeded');
    assertEquals(overCap.tier, 'free');
    assertEquals(overCap.frame_cap, PACE_FRAME_CAP.free, 'the refusal reports the real Free cap');
    assertEquals(overCap.frame_cap, 5);

    // The refusal above must not have consumed the lifetime slot: it returned before any insert.
    const atCap = await reserve(db, user, 'video', PACE_FRAME_CAP.free);
    assertEquals(atCap.allowed, true, JSON.stringify(atCap));
    assertEquals(atCap.existing, false);
    assertEquals(atCap.status, 'reserved');
    assertEquals(atCap.tier, 'free');

    const { rows } = await db.query<{ frame_count: number; media_type: string }>(
      `select frame_count, media_type from public.analyses where id = $1::uuid`,
      [atCap.id]
    );
    assertEquals(rows[0], { frame_count: 5, media_type: 'video' });
  });
});

Deno.test("#89: Free's video burst IS Pro's — the two tiers share one frame cap", async () => {
  await withDb(async (db) => {
    const free = await createUser(db, 'free');
    const pro = await createUser(db, 'pro');

    const freeStatus = await quotaStatus(db, free);
    const proStatus = await quotaStatus(db, pro);
    assertEquals(freeStatus.frame_cap, proStatus.frame_cap, 'Free and Pro extract the same burst');
    assertEquals(freeStatus.frame_cap, PACE_FRAME_CAP.free);
    assertEquals(proStatus.frame_cap, PACE_FRAME_CAP.pro);

    // And the SQL agrees with the TypeScript table on every tier, not just the one that moved.
    const elite = await createUser(db, 'elite');
    assertEquals((await quotaStatus(db, elite)).frame_cap, PACE_FRAME_CAP.elite);
  });
});

Deno.test('a PHOTO is exactly one frame on every tier — the medium rule, not the tier cap, keeps a Free photo at 2 of 4', async () => {
  await withDb(async (db) => {
    for (const tier of ['free', 'pro', 'elite'] as const) {
      const user = await createUser(db, tier);

      // Five photo frames would be within every tier's cap; the medium rule refuses them first.
      const fivePhotoFrames = await reserve(db, user, 'photo', PACE_FRAME_CAP[tier]);
      assertEquals(fivePhotoFrames.allowed, false, `${tier}: a multi-frame photo must be refused`);
      assertEquals(fivePhotoFrames.reason, 'invalid_frame_count_for_photo');

      const onePhotoFrame = await reserve(db, user, 'photo', 1);
      assertEquals(onePhotoFrame.allowed, true, `${tier}: ${JSON.stringify(onePhotoFrame)}`);
      assertEquals(onePhotoFrame.status, 'reserved');
    }
  });
});

Deno.test('Pro 5 and Elite 8 are unchanged: one over the cap is refused, the cap itself is accepted', async () => {
  await withDb(async (db) => {
    for (const tier of ['pro', 'elite'] as const) {
      const user = await createUser(db, tier);
      const cap = PACE_FRAME_CAP[tier];

      const over = await reserve(db, user, 'video', cap + 1);
      assertEquals(over.allowed, false, `${tier}: ${cap + 1} frames must be refused`);
      assertEquals(over.reason, 'frame_cap_exceeded');
      assertEquals(over.frame_cap, cap);

      const at = await reserve(db, user, 'video', cap);
      assertEquals(at.allowed, true, `${tier}: ${JSON.stringify(at)}`);
      assertEquals(at.tier, tier);
    }
  });
});

// -------------------------------------------------------------------------------------------
// What did NOT move
// -------------------------------------------------------------------------------------------

Deno.test("Free is still ONE lifetime analysis: the burst widens the frames, not the count", async () => {
  await withDb(async (db) => {
    const user = await createUser(db, 'free');

    const before = await quotaStatus(db, user);
    assertEquals(before.limit, 1);
    assertEquals(before.is_lifetime, true);
    assertEquals(before.used, 0);

    const first = await reserve(db, user, 'video', PACE_FRAME_CAP.free);
    assertEquals(first.allowed, true, JSON.stringify(first));

    const second = await reserve(db, user, 'video', PACE_FRAME_CAP.free);
    assertEquals(second.allowed, false);
    assertEquals(second.reason, 'quota_exceeded');
    assertEquals(second.used, 1);
    assertEquals(second.limit, 1);

    const after = await quotaStatus(db, user);
    assertEquals(after.used, 1);
    assertEquals(after.frame_cap, 5, 'the reported cap does not change once the slot is spent');
  });
});

Deno.test('the unlimited-override display still reports 8 frames and is untouched by this migration', async () => {
  await withDb(async (db) => {
    const user = await createUser(db, 'free');
    const status = await quotaStatus(db, user, 'pace_quota_status_unlimited');
    assertEquals(status.unlimited, true);
    assertEquals(status.frame_cap, PACE_FRAME_CAP.elite);
  });
});

Deno.test('the legacy four-argument reserve_analysis keeps its rollback-only free cap of 1', async () => {
  // Deliberately NOT widened (see the migration header): a build old enough to call this overload
  // predates the canonical-identity contract entirely. Proven so the omission is visible.
  await withDb(async (db) => {
    const user = await createUser(db, 'free');
    const { rows } = await db.query<{ out: ReserveResult }>(
      `select public.reserve_analysis($1::uuid, $2::text, 'video'::public.media_type, 5) as out`,
      [user, crypto.randomUUID()]
    );
    assertEquals(rows[0].out.allowed, false);
    assertEquals(rows[0].out.reason, 'frame_cap_exceeded');
    assertEquals(rows[0].out.frame_cap, 1);
  });
});

Deno.test('both replaced functions keep their hardened posture: SECURITY DEFINER, service_role only', async () => {
  await withDb(async (db) => {
    const { rows } = await db.query<{ name: string; secdef: boolean; anon: boolean; authenticated: boolean; service: boolean }>(
      `select p.proname as name,
              p.prosecdef as secdef,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('service_role', p.oid, 'execute') as service
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and (
           (p.proname = 'reserve_analysis' and p.pronargs = 5)
           or (p.proname = 'pace_quota_status' and p.pronargs = 2)
         )
       order by p.proname`
    );
    assertEquals(rows.map((r) => r.name), ['pace_quota_status', 'reserve_analysis']);
    for (const row of rows) {
      assert(row.secdef, `${row.name} must be SECURITY DEFINER`);
      assertEquals(row.anon, false, `${row.name}: anon must not execute`);
      assertEquals(row.authenticated, false, `${row.name}: authenticated must not execute`);
      assertEquals(row.service, true, `${row.name}: service_role must execute`);
    }
  });
});
