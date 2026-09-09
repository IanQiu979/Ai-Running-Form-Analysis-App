/**
 * Behavioural proof for the Free zero-pillar cooldown. The committed migrations are applied
 * verbatim to PGlite in filename order, including the later per-user AI-cap migration, and the
 * assertions exercise Postgres behaviour rather than matching SQL source text.
 *
 * PGlite supplies real Postgres 17 SQL, functions, constraints, and privileges. Supabase's
 * platform-owned Auth/Storage catalogs and managed cron scheduler are narrow stand-ins. Only the
 * unavailable extension-install statements are bypassed; every migration's public-schema DDL
 * executes in order. Concurrency and PostgREST exposure are outside this focused test; the
 * function privilege checks cover the database boundary PostgREST obeys.
 */
import { assert, assertEquals } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.3.12";

const MIGRATIONS_DIR = new URL("../../../migrations/", import.meta.url);

const LAST_MIGRATION = "20260907120000_per_user_ai_daily_cap.sql";
const MANAGED_EXTENSION_INSTALL_STATEMENTS: Readonly<
  Record<string, readonly string[]>
> = {
  "20260713130000_stale_reservation_sweep.sql": [
    "create extension if not exists pg_cron with schema pg_catalog;",
  ],
  "20260806090000_sweep_orphaned_media_cron.sql": [
    "create extension if not exists pg_net;",
  ],
};

async function migrationChain(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (
      entry.isFile && /^\d{14}.*\.sql$/.test(entry.name) &&
      entry.name <= LAST_MIGRATION
    ) {
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
      `${name}'s managed-extension bypass must match exactly one statement`,
    );
    sql = sql.replace(statement, "");
  }
  return sql;
}

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

interface QuotaStatus {
  tier: "free" | "pro" | "elite";
  used: number;
  blocked: boolean;
  blocked_reason: string | null;
  blocked_until: string | null;
}

interface RpcResult {
  ok: boolean;
  id?: string;
  status?: string;
  reason?: string;
}

async function freshDb(): Promise<PGlite> {
  const db = await new PGlite();
  await db.exec(PLATFORM_PRELUDE);

  const migrations = await migrationChain();
  assertEquals(migrations.at(-1), LAST_MIGRATION);
  assertEquals(
    migrations.filter((name) =>
      Object.hasOwn(MANAGED_EXTENSION_INSTALL_STATEMENTS, name)
    ),
    Object.keys(MANAGED_EXTENSION_INSTALL_STATEMENTS).sort(),
    "the managed-extension statement map must contain no stale migration names",
  );

  for (const name of migrations) {
    const source = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
    const sql = sqlForPGlite(name, source);
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(
        `migration ${name} failed to apply: ${(error as Error).message}`,
      );
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

async function createUser(
  db: PGlite,
  tier: "free" | "pro" | "elite" = "free",
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
    [`${tier}-${crypto.randomUUID()}@example.test`],
  );
  const userId = rows[0].id;
  if (tier !== "free") {
    await db.query(
      `insert into public.subscriptions (user_id, tier, status, purchased_at)
       values ($1, $2::public.subscription_tier, 'active', '2026-09-01T00:00:00Z')`,
      [userId, tier],
    );
  }
  return userId;
}

async function insertReserved(
  db: PGlite,
  userId: string,
  key: string,
  tier: "free" | "pro" | "elite" = "free",
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.analyses
       (user_id, media_type, frame_count, tier_at_run, status, idempotency_key)
     values ($1, 'photo', 1, $3::public.analysis_tier, 'reserved', $2)
     returning id`,
    [userId, key, tier],
  );
  return rows[0].id;
}

async function release(
  db: PGlite,
  userId: string,
  analysisId: string,
  reason:
    | "zero_pillars_assessed"
    | "zero_pillar_cooldown"
    | "validation_failed",
): Promise<RpcResult> {
  const { rows } = await db.query<{ out: RpcResult }>(
    `select public.release_analysis($1::uuid, $2::uuid, $3::text) as out`,
    [userId, analysisId, reason],
  );
  return rows[0].out;
}

async function quotaStatus(
  db: PGlite,
  userId: string,
  asOf: string,
): Promise<QuotaStatus> {
  const { rows } = await db.query<{ out: QuotaStatus }>(
    `select public.pace_quota_status($1::uuid, $2::timestamptz) as out`,
    [userId, asOf],
  );
  return rows[0].out;
}

Deno.test("the ordered migrations retain the cooldown release reason through the later AI-cap migration", async () => {
  await withDb(async (db) => {
    const userId = await createUser(db);
    const analysisId = await insertReserved(db, userId, "cooldown-release");
    const released = await release(
      db,
      userId,
      analysisId,
      "zero_pillar_cooldown",
    );

    assertEquals(released.ok, true);
    assertEquals(released.status, "released");

    const { rows } = await db.query<{ reason: string }>(
      `select release_reason as reason from public.analyses where id = $1`,
      [analysisId],
    );
    assertEquals(rows[0].reason, "zero_pillar_cooldown");

    // The migration after the cooldown still has its executable cap surface.
    const { rows: cap } = await db.query<
      { free: string; pro: string; elite: string }
    >(
      `select user_daily_usd_cap_free::text as free,
              user_daily_usd_cap_pro::text as pro,
              user_daily_usd_cap_elite::text as elite
       from public.ai_ops_config where id`,
    );
    assertEquals(cap[0], { free: "0.75", pro: "2.00", elite: "4.00" });
  });
});

Deno.test("the cron shim still executes stale-sweep public DDL in migration order", async () => {
  await withDb(async (db) => {
    const { rows } = await db.query<{
      sweep: string | null;
      indexName: string | null;
    }>(
      `select
         to_regprocedure('public.sweep_stale_reservations(interval,integer)')::text as sweep,
         to_regclass('public.analyses_reserved_created_idx')::text as "indexName"`,
    );
    assert(
      rows[0].sweep !== null,
      "stale_reservation_sweep's service RPC must not disappear with its pg_cron setup",
    );
    assertEquals(rows[0].indexName, "analyses_reserved_created_idx");

    for (const role of ["anon", "authenticated"]) {
      const { rows: privilege } = await db.query<{ allowed: boolean }>(
        `select has_function_privilege(
           $1, 'public.sweep_stale_reservations(interval,integer)', 'EXECUTE'
         ) as allowed`,
        [role],
      );
      assertEquals(privilege[0].allowed, false);
    }
    const { rows: servicePrivilege } = await db.query<{ allowed: boolean }>(
      `select has_function_privilege(
         'service_role', 'public.sweep_stale_reservations(interval,integer)', 'EXECUTE'
       ) as allowed`,
    );
    assertEquals(servicePrivilege[0].allowed, true);

    const userId = await createUser(db);
    const analysisId = await insertReserved(db, userId, "stale-reservation");
    await db.query(
      `update public.analyses set created_at = now() - interval '16 minutes' where id = $1`,
      [analysisId],
    );
    const { rows: swept } = await db.query<{ count: number }>(
      `select public.sweep_stale_reservations(interval '15 minutes', 500) as count`,
    );
    assertEquals(swept[0].count, 1);
    const { rows: released } = await db.query<
      { status: string; reason: string }
    >(
      `select status::text, release_reason as reason from public.analyses where id = $1`,
      [analysisId],
    );
    assertEquals(released[0], { status: "released", reason: "stale_sweep" });

    const { rows: scheduled } = await db.query<{ names: string[] }>(
      `select array_agg(jobname order by jobname) as names from cron.job`,
    );
    assertEquals(scheduled[0].names, [
      "sweep-orphaned-media-daily",
      "sweep-stale-analysis-reservations",
    ]);
  });
});

Deno.test("Free reports an active then expired zero-pillar cooldown without consuming quota", async () => {
  await withDb(async (db) => {
    const userId = await createUser(db);
    const analysisId = await insertReserved(db, userId, "zero-pillar-result");
    assertEquals(
      (await release(db, userId, analysisId, "zero_pillars_assessed")).ok,
      true,
    );
    await db.query(
      `update public.analyses set released_at = '2026-09-09T12:00:00Z' where id = $1`,
      [analysisId],
    );

    const active = await quotaStatus(db, userId, "2026-09-09T12:05:00Z");
    assertEquals(active.tier, "free");
    assertEquals(
      Number(active.used),
      0,
      "a released zero-pillar result must not consume quota",
    );
    assertEquals(active.blocked, true);
    assertEquals(active.blocked_reason, "zero_pillar_cooldown");
    assertEquals(active.blocked_until, "2026-09-09T12:15:00+00:00");

    const expired = await quotaStatus(db, userId, "2026-09-09T12:15:01Z");
    assertEquals(Number(expired.used), 0);
    assertEquals(expired.blocked, false);
    assertEquals(expired.blocked_reason, null);
    assertEquals(expired.blocked_until, null);
  });
});

Deno.test("paid tiers never report the Free zero-pillar cooldown", async () => {
  await withDb(async (db) => {
    for (const tier of ["pro", "elite"] as const) {
      const userId = await createUser(db, tier);
      const analysisId = await insertReserved(
        db,
        userId,
        `${tier}-zero-pillar`,
        tier,
      );
      assertEquals(
        (await release(db, userId, analysisId, "zero_pillars_assessed")).ok,
        true,
      );
      await db.query(
        `update public.analyses set released_at = '2026-09-09T12:00:00Z' where id = $1`,
        [analysisId],
      );

      const status = await quotaStatus(db, userId, "2026-09-09T12:05:00Z");
      assertEquals(status.tier, tier);
      assertEquals(Number(status.used), 0);
      assertEquals(status.blocked, false);
      assertEquals(status.blocked_reason, null);
      assertEquals(status.blocked_until, null);
    }
  });
});

Deno.test("the anti-farm block takes precedence over an active zero-pillar cooldown", async () => {
  await withDb(async (db) => {
    const userId = await createUser(db);

    for (let i = 0; i < 3; i += 1) {
      const analysisId = await insertReserved(db, userId, `farming-${i}`);
      assertEquals(
        (await release(db, userId, analysisId, "validation_failed")).ok,
        true,
      );
      await db.query(
        `update public.analyses
         set released_at = ('2026-09-09T11:00:00Z'::timestamptz + $2::integer * interval '1 minute')
         where id = $1`,
        [analysisId, i],
      );
    }

    const zeroPillarId = await insertReserved(db, userId, "zero-pillar-too");
    assertEquals(
      (await release(db, userId, zeroPillarId, "zero_pillars_assessed")).ok,
      true,
    );
    await db.query(
      `update public.analyses set released_at = '2026-09-09T12:00:00Z' where id = $1`,
      [zeroPillarId],
    );

    const status = await quotaStatus(db, userId, "2026-09-09T12:05:00Z");
    assertEquals(status.blocked, true);
    assertEquals(status.blocked_reason, "too_many_failed_attempts");
    assertEquals(status.blocked_until, "2026-09-10T11:00:00+00:00");
  });
});

Deno.test("the one-argument cooldown helper is authoritative and RPCs are service-role-only", async () => {
  await withDb(async (db) => {
    const { rows: functions } = await db.query<{
      seconds: number;
      one_arg: string | null;
      two_arg: string | null;
    }>(
      `select public.pace_zero_pillar_cooldown_seconds() as seconds,
              to_regprocedure('public.pace_zero_pillar_cooldown_remaining(uuid)')::text as one_arg,
              to_regprocedure('public.pace_zero_pillar_cooldown_remaining(uuid,integer)')::text
                as two_arg`,
    );
    assertEquals(functions[0].seconds, 900);
    assert(
      functions[0].one_arg !== null,
      "the authoritative one-argument helper must exist",
    );
    assertEquals(
      functions[0].two_arg,
      null,
      "the caller-controlled two-argument overload must not exist",
    );

    const userId = await createUser(db);
    const analysisId = await insertReserved(db, userId, "helper-behaviour");
    assertEquals(
      (await release(db, userId, analysisId, "zero_pillars_assessed")).ok,
      true,
    );
    const { rows: remaining } = await db.query<{ seconds: number }>(
      `select public.pace_zero_pillar_cooldown_remaining($1::uuid) as seconds`,
      [userId],
    );
    assert(
      remaining[0].seconds > 890 && remaining[0].seconds <= 900,
      `the authoritative helper returned ${
        remaining[0].seconds
      }, expected an active 900-second window`,
    );

    for (
      const [signature, expectedSearchPath] of [
        [
          "public.pace_zero_pillar_cooldown_seconds()",
          "search_path=public, pg_temp",
        ],
        [
          "public.pace_zero_pillar_cooldown_remaining(uuid)",
          "search_path=public, pg_temp",
        ],
        [
          "public.pace_quota_status(uuid,timestamp with time zone)",
          "search_path=public",
        ],
      ]
    ) {
      for (const role of ["anon", "authenticated"]) {
        const { rows } = await db.query<{ allowed: boolean }>(
          `select has_function_privilege($1, $2, 'EXECUTE') as allowed`,
          [role, signature],
        );
        assertEquals(
          rows[0].allowed,
          false,
          `${role} must not execute ${signature}`,
        );
      }

      const { rows } = await db.query<{ allowed: boolean }>(
        `select has_function_privilege('service_role', $1, 'EXECUTE') as allowed`,
        [signature],
      );
      assertEquals(
        rows[0].allowed,
        true,
        `service_role must execute ${signature}`,
      );

      const { rows: metadata } = await db.query<{
        securityDefiner: boolean;
        settings: string[] | null;
      }>(
        `select p.prosecdef as "securityDefiner", p.proconfig as settings
         from pg_proc p where p.oid = to_regprocedure($1)`,
        [signature],
      );
      assertEquals(
        metadata[0].securityDefiner,
        true,
        `${signature} must execute with its hardened owner context`,
      );
      assertEquals(
        metadata[0].settings,
        [expectedSearchPath],
        `${signature} must pin its search_path`,
      );
    }
  });
});
