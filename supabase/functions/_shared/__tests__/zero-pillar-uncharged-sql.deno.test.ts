/**
 * Behavioural proof for "Option E": a zero-pillar analysis is DELIVERED BUT UNCHARGED.
 *
 * The committed migrations are applied verbatim to PGlite (real Postgres 17, in-process) in
 * filename order through 20260910120000, and every assertion below exercises what Postgres
 * actually does — never what the .sql text says. That distinction is the whole point here: the
 * failure mode this migration guards against (a cooldown lookup reading rows nobody writes any
 * more) leaves the SQL source looking perfectly correct while the function silently returns 0
 * forever, so a text-level test would pass on a hole.
 *
 * Supabase's platform-owned Auth/Storage catalogs and managed cron scheduler are narrow stand-ins;
 * only the unavailable extension-install statements are bypassed. PGlite is single-connection, so
 * genuine concurrency (the advisory lock in reserve_analysis) remains a local-Supabase concern.
 */
import { assert, assertEquals } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.3.12";

const MIGRATIONS_DIR = new URL("../../../migrations/", import.meta.url);

const LAST_MIGRATION = "20260910120000_zero_pillar_delivered_uncharged.sql";

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

const FINGERPRINT_A = "a".repeat(64);
const FINGERPRINT_B = "b".repeat(64);
const FINGERPRINT_C = "c".repeat(64);
const REVISION = "pace-v2.3-r1";
const VERDICT = { verdict: "pinned", pillars: "none-assessed" } as const;

type Tier = "free" | "pro" | "elite";

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

interface SettleResult {
  ok: boolean;
  id?: string;
  status?: string;
  reason?: string;
  result?: unknown;
  is_fallback?: boolean;
  media_paths?: string[];
}

interface QuotaStatus {
  tier: Tier;
  used: number;
  limit: number | null;
  blocked: boolean;
  blocked_reason: string | null;
  blocked_until: string | null;
}

interface AnalysisRow {
  status: string;
  result: unknown;
  zeroPillarAt: string | null;
  deletedAt: string | null;
}

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

async function freshDb(): Promise<PGlite> {
  const db = await new PGlite();
  await db.exec(PLATFORM_PRELUDE);

  const migrations = await migrationChain();
  assertEquals(
    migrations.at(-1),
    LAST_MIGRATION,
    "the Option E migration must be the last file in the applied chain",
  );
  assertEquals(
    migrations.filter((name) =>
      Object.hasOwn(MANAGED_EXTENSION_INSTALL_STATEMENTS, name)
    ),
    Object.keys(MANAGED_EXTENSION_INSTALL_STATEMENTS).sort(),
    "the managed-extension statement map must contain no stale migration names",
  );

  for (const name of migrations) {
    const source = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
    try {
      await db.exec(sqlForPGlite(name, source));
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

async function createUser(db: PGlite, tier: Tier = "free"): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
    [`${tier}-${crypto.randomUUID()}@example.test`],
  );
  const userId = rows[0].id;
  if (tier !== "free") {
    await db.query(
      `insert into public.subscriptions (user_id, tier, status, purchased_at)
       values ($1, $2::public.subscription_tier, 'active', now())`,
      [userId, tier],
    );
  }
  return userId;
}

async function reserve(
  db: PGlite,
  userId: string,
  key: string,
  fingerprint = FINGERPRINT_A,
  fn: "reserve_analysis" | "reserve_analysis_unlimited" = "reserve_analysis",
): Promise<ReserveResult> {
  const { rows } = await db.query<{ out: ReserveResult }>(
    `select public.${fn}($1::uuid, $2::text, 'photo'::public.media_type, 1, $3::jsonb) as out`,
    [
      userId,
      key,
      JSON.stringify({
        input_fingerprint: fingerprint,
        analyzer_revision: REVISION,
      }),
    ],
  );
  return rows[0].out;
}

function arrayLiteral(paths: readonly string[]): string {
  if (paths.length === 0) return `'{}'::text[]`;
  // Test-local paths only ever contain uuids and slashes, but quote-double anyway.
  return `array[${
    paths.map((p) => `'${p.replaceAll("'", "''")}'`).join(", ")
  }]::text[]`;
}

/** The NEW six-argument overload — the only one that can stamp zero_pillar_at. */
async function settleWithFlag(
  db: PGlite,
  userId: string,
  analysisId: string,
  zeroPillar: boolean,
  mediaPaths: readonly string[] = [],
): Promise<SettleResult> {
  const { rows } = await db.query<{ out: SettleResult }>(
    `select public.settle_analysis(
       $1::uuid, $2::uuid, $3::jsonb, false, ${arrayLiteral(mediaPaths)}, $4::boolean
     ) as out`,
    [userId, analysisId, JSON.stringify(VERDICT), zeroPillar],
  );
  return rows[0].out;
}

async function quotaStatus(
  db: PGlite,
  userId: string,
  asOf = "now()",
): Promise<QuotaStatus> {
  const { rows } = await db.query<{ out: QuotaStatus }>(
    `select public.pace_quota_status($1::uuid, ${asOf}) as out`,
    [userId],
  );
  return rows[0].out;
}

async function cooldownRemaining(
  db: PGlite,
  userId: string,
): Promise<number> {
  const { rows } = await db.query<{ seconds: number }>(
    `select public.pace_zero_pillar_cooldown_remaining($1::uuid) as seconds`,
    [userId],
  );
  return Number(rows[0].seconds);
}

async function readAnalysis(db: PGlite, id: string): Promise<AnalysisRow> {
  const { rows } = await db.query<AnalysisRow>(
    `select status::text as status,
            result,
            zero_pillar_at::text as "zeroPillarAt",
            deleted_at::text as "deletedAt"
     from public.analyses where id = $1::uuid`,
    [id],
  );
  return rows[0];
}

/** How many rows the LEGACY (PR #213) cooldown predicate would have found. */
async function legacyZeroPillarReleases(
  db: PGlite,
  userId: string,
): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `select count(*)::text as count from public.analyses
     where user_id = $1::uuid and status = 'released'
       and release_reason = 'zero_pillars_assessed'`,
    [userId],
  );
  return Number(rows[0].count);
}

Deno.test("a zero-pillar settle delivers a pinned, uncharged result and leaves Free's lifetime slot intact", async () => {
  await withDb(async (db) => {
    const userId = await createUser(db);
    const reserved = await reserve(db, userId, "zero-pillar-owner");
    assertEquals(reserved.allowed, true);
    assertEquals(reserved.existing, false);

    const settled = await settleWithFlag(db, userId, reserved.id!, true);
    assertEquals(settled.ok, true);
    assertEquals(settled.status, "delivered");
    assertEquals(settled.result, VERDICT);

    // PINNED: settled, with the verdict actually on the row.
    const row = await readAnalysis(db, reserved.id!);
    assertEquals(row.status, "delivered");
    assertEquals(row.result, VERDICT);
    assert(
      row.zeroPillarAt !== null,
      "a zero-pillar settle must stamp zero_pillar_at",
    );

    // UNCHARGED: the pre-flight says nothing was used...
    const status = await quotaStatus(db, userId);
    assertEquals(status.tier, "free");
    assertEquals(Number(status.used), 0);
    assertEquals(Number(status.limit), 1);

    // ...and reserve_analysis agrees, which is the claim that actually matters.
    const nextClip = await reserve(db, userId, "second-clip", FINGERPRINT_B);
    assertEquals(nextClip.allowed, true);
    assertEquals(nextClip.existing, false);
    assert(nextClip.id !== reserved.id);
  });
});

Deno.test("the canonical claim stays active after a zero-pillar settle, so identical evidence replays the pinned verdict", async () => {
  await withDb(async (db) => {
    const userId = await createUser(db);
    const owner = await reserve(db, userId, "canonical-owner");
    await settleWithFlag(db, userId, owner.id!, true);

    // The claim was NOT retired — the row never went 'released', which is the whole reason
    // Option E stopped using release as the uncharging mechanism.
    const { rows: claims } = await db.query<{ count: string }>(
      `select count(*)::text as count from public.canonical_analysis_claims
       where user_id = $1::uuid and analysis_id = $2::uuid`,
      [userId, owner.id],
    );
    assertEquals(Number(claims[0].count), 1);

    const replay = await reserve(db, userId, "same-clip-new-key");
    assertEquals(replay.allowed, true);
    assertEquals(replay.existing, true);
    assertEquals(replay.id, owner.id);
    assertEquals(replay.status, "delivered");
    assertEquals(
      replay.result,
      VERDICT,
      "identical evidence must replay the persisted verdict rather than reach the model",
    );

    const { rows: analyses } = await db.query<{ count: string }>(
      `select count(*)::text as count from public.analyses where user_id = $1::uuid`,
      [userId],
    );
    assertEquals(Number(analyses[0].count), 1);
  });
});

Deno.test("a normal scored settle leaves zero_pillar_at null and does consume quota on every tier", async () => {
  await withDb(async (db) => {
    const free = await createUser(db);
    const scored = await reserve(db, free, "scored-owner");
    const settled = await settleWithFlag(db, free, scored.id!, false);
    assertEquals(settled.ok, true);

    const row = await readAnalysis(db, scored.id!);
    assertEquals(row.status, "delivered");
    assertEquals(
      row.zeroPillarAt,
      null,
      "the exemption must not be blanket — a scored result carries no marker",
    );

    const status = await quotaStatus(db, free);
    assertEquals(Number(status.used), 1);
    assertEquals(status.blocked, false);

    const blocked = await reserve(db, free, "third-clip", FINGERPRINT_C);
    assertEquals(blocked.allowed, false);
    assertEquals(blocked.reason, "quota_exceeded");

    // The same split holds on a windowed (paid) tier, where the count is period-scoped.
    const pro = await createUser(db, "pro");
    const proScored = await reserve(db, pro, "pro-scored");
    await settleWithFlag(db, pro, proScored.id!, false);
    assertEquals(Number((await quotaStatus(db, pro)).used), 1);

    const proBlank = await reserve(db, pro, "pro-blank", FINGERPRINT_B);
    await settleWithFlag(db, pro, proBlank.id!, true);
    assertEquals(
      Number((await quotaStatus(db, pro)).used),
      1,
      "a pro zero-pillar result must not add to the period count",
    );
  });
});

Deno.test("the farming bound still holds: a zero-pillar settle opens the cooldown even though no released row exists", async () => {
  await withDb(async (db) => {
    const userId = await createUser(db);
    const owner = await reserve(db, userId, "cooldown-owner");
    await settleWithFlag(db, userId, owner.id!, true);

    // The legacy predicate finds NOTHING here. If the cooldown had been left reading it, this
    // whole throttle would return 0 forever without ever erroring — the exact fail-open the
    // migration header calls out.
    assertEquals(await legacyZeroPillarReleases(db, userId), 0);

    const remaining = await cooldownRemaining(db, userId);
    assert(
      remaining > 890 && remaining <= 900,
      `expected an active 900-second cooldown from the new representation, got ${remaining}`,
    );

    const status = await quotaStatus(db, userId);
    assertEquals(status.blocked, true);
    assertEquals(status.blocked_reason, "zero_pillar_cooldown");
    assert(status.blocked_until !== null);

    // Deleting the analysis must not buy a fresh model call: zero_pillar_at survives redaction.
    await db.query(
      `update public.analyses set deleted_at = now() where id = $1::uuid`,
      [owner.id],
    );
    const redacted = await readAnalysis(db, owner.id!);
    assertEquals(redacted.result, null);
    assert(redacted.zeroPillarAt !== null);
    assert(
      (await cooldownRemaining(db, userId)) > 890,
      "soft-deleting the row must not clear the cooldown it anchors",
    );

    // Once the anchor ages out, the throttle lifts — it is a delay, not a ban.
    await db.query(
      `update public.analyses set zero_pillar_at = now() - interval '16 minutes'
       where id = $1::uuid`,
      [owner.id],
    );
    assertEquals(await cooldownRemaining(db, userId), 0);
    assertEquals((await quotaStatus(db, userId)).blocked, false);
  });
});

Deno.test("the cooldown still finds a legacy released zero-pillar row, so rollback and history keep working", async () => {
  await withDb(async (db) => {
    const userId = await createUser(db);
    const reserved = await reserve(db, userId, "legacy-release");
    const { rows } = await db.query<{ out: { ok: boolean } }>(
      `select public.release_analysis($1::uuid, $2::uuid, 'zero_pillars_assessed') as out`,
      [userId, reserved.id],
    );
    assertEquals(rows[0].out.ok, true);
    assertEquals(await legacyZeroPillarReleases(db, userId), 1);

    const remaining = await cooldownRemaining(db, userId);
    assert(
      remaining > 890 && remaining <= 900,
      `the legacy representation must still open the cooldown, got ${remaining}`,
    );

    const status = await quotaStatus(db, userId);
    assertEquals(Number(status.used), 0);
    assertEquals(status.blocked, true);
    assertEquals(status.blocked_reason, "zero_pillar_cooldown");

    // Both arms of the union are live at once: the most recent event wins.
    const second = await reserve(db, userId, "mixed-representation", FINGERPRINT_B);
    await settleWithFlag(db, userId, second.id!, true);
    await db.query(
      `update public.analyses set released_at = now() - interval '14 minutes'
       where id = $1::uuid`,
      [reserved.id],
    );
    assert(
      (await cooldownRemaining(db, userId)) > 890,
      "the newer zero_pillar_at anchor must win over an older legacy release",
    );
  });
});

Deno.test("the pre-existing five-argument settle_analysis stays callable and unambiguous for a DB-first rollout", async () => {
  await withDb(async (db) => {
    const { rows: signatures } = await db.query<{
      five: string | null;
      six: string | null;
    }>(
      `select
         to_regprocedure('public.settle_analysis(uuid,uuid,jsonb,boolean,text[])')::text as five,
         to_regprocedure('public.settle_analysis(uuid,uuid,jsonb,boolean,text[],boolean)')::text
           as six`,
    );
    assert(
      signatures[0].five !== null,
      "the deployed edge function's five-argument signature must survive",
    );
    assert(signatures[0].six !== null, "the new overload must exist");

    // Elite, so the four separate settles below are not cut short by Free's one-slot limit.
    const userId = await createUser(db, "elite");

    // Positional five-argument call — what the currently deployed build sends.
    const positional = await reserve(db, userId, "legacy-positional");
    const { rows: legacy } = await db.query<{ out: SettleResult }>(
      `select public.settle_analysis($1::uuid, $2::uuid, '{"legacy":true}'::jsonb, false, '{}'::text[]) as out`,
      [userId, positional.id],
    );
    assertEquals(legacy[0].out.ok, true);
    assertEquals(legacy[0].out.status, "delivered");
    assertEquals(
      (await readAnalysis(db, positional.id!)).zeroPillarAt,
      null,
      "the legacy overload must never stamp the marker",
    );

    // Named-argument calls are where a defaulted sixth parameter would have collided. Four and
    // five named arguments must each resolve to exactly one function.
    const namedFour = await reserve(db, userId, "named-four", FINGERPRINT_B);
    const { rows: four } = await db.query<{ out: SettleResult }>(
      `select public.settle_analysis(
         p_user_id => $1::uuid, p_analysis_id => $2::uuid,
         p_result => '{"named":4}'::jsonb, p_is_fallback => false
       ) as out`,
      [userId, namedFour.id],
    );
    assertEquals(four[0].out.ok, true);

    const namedFive = await reserve(db, userId, "named-five", FINGERPRINT_C);
    const { rows: five } = await db.query<{ out: SettleResult }>(
      `select public.settle_analysis(
         p_user_id => $1::uuid, p_analysis_id => $2::uuid,
         p_result => '{"named":5}'::jsonb, p_is_fallback => false,
         p_media_paths => '{}'::text[]
       ) as out`,
      [userId, namedFive.id],
    );
    assertEquals(five[0].out.ok, true);

    const namedSix = await reserve(db, userId, "named-six", "d".repeat(64));
    const { rows: six } = await db.query<{ out: SettleResult }>(
      `select public.settle_analysis(
         p_user_id => $1::uuid, p_analysis_id => $2::uuid,
         p_result => '{"named":6}'::jsonb, p_is_fallback => false,
         p_media_paths => '{}'::text[], p_zero_pillar => true
       ) as out`,
      [userId, namedSix.id],
    );
    assertEquals(six[0].out.ok, true);
    assert((await readAnalysis(db, namedSix.id!)).zeroPillarAt !== null);
  });
});

Deno.test("p_zero_pillar cannot be passed without the full argument list — the caller must send p_media_paths", async () => {
  await withDb(async (db) => {
    const userId = await createUser(db, "elite");
    const target = await reserve(db, userId, "omitted-media-paths");

    // `p_zero_pillar` carries NO default (see the migration header: a defaulted sixth argument
    // makes a three-or-four-argument call ambiguous between the two overloads). The price of that
    // is that the six-argument overload cannot be reached by a partial named-argument call, even
    // though `p_media_paths` defaults on the FIVE-argument one.
    //
    // THIS IS A LIVE CALLER MISMATCH, NOT A HYPOTHETICAL. `analyze-form/flow.ts`'s settleAnalysis()
    // currently sends exactly p_user_id, p_analysis_id, p_result, p_is_fallback, p_zero_pillar —
    // omitting p_media_paths, with a comment that the RPC's default covers it. That is true of the
    // five-argument overload and false of this one, so every settle would fail resolution. The fix
    // is one line in flow.ts (`p_media_paths: []`), not a default here; this test is the lock that
    // keeps the two facts from drifting apart again.
    let message = "";
    try {
      await db.query(
        `select public.settle_analysis(
           p_user_id => $1::uuid, p_analysis_id => $2::uuid,
           p_result => '{"v":1}'::jsonb, p_is_fallback => false, p_zero_pillar => true
         ) as out`,
        [userId, target.id],
      );
    } catch (error) {
      message = (error as Error).message;
    }
    assert(
      /does not exist|is not unique/.test(message),
      `omitting p_media_paths must not resolve to any settle_analysis overload, got: ${
        message || "a successful call"
      }`,
    );
    assertEquals((await readAnalysis(db, target.id!)).status, "reserved");

    // Adding it back is all it takes.
    const { rows } = await db.query<{ out: SettleResult }>(
      `select public.settle_analysis(
         p_user_id => $1::uuid, p_analysis_id => $2::uuid,
         p_result => '{"v":1}'::jsonb, p_is_fallback => false,
         p_media_paths => '{}'::text[], p_zero_pillar => true
       ) as out`,
      [userId, target.id],
    );
    assertEquals(rows[0].out.ok, true);
    assert((await readAnalysis(db, target.id!)).zeroPillarAt !== null);
  });
});

Deno.test("the new overload keeps the media-path prefix validation and the deleted_at guard (no #133 regression)", async () => {
  await withDb(async (db) => {
    const userId = await createUser(db);
    const otherId = await createUser(db);

    const target = await reserve(db, userId, "prefix-guard");
    for (
      const badPath of [
        `${otherId}/${target.id}/frame-0.jpg`, // another user's prefix
        `${userId}/${crypto.randomUUID()}/frame-0.jpg`, // another analysis' prefix
        `${userId}/${target.id}/`, // the bare prefix, naming no file
        `frame-0.jpg`, // no prefix at all
      ]
    ) {
      const refused = await settleWithFlag(db, userId, target.id!, true, [
        badPath,
      ]);
      assertEquals(refused.ok, false, `path must be rejected: ${badPath}`);
      assertEquals(refused.reason, "invalid_media_path");
    }
    const untouched = await readAnalysis(db, target.id!);
    assertEquals(untouched.status, "reserved");
    assertEquals(untouched.zeroPillarAt, null);

    const good = await settleWithFlag(db, userId, target.id!, true, [
      `${userId}/${target.id}/frame-0.jpg`,
    ]);
    assertEquals(good.ok, true);
    assertEquals(good.media_paths, [`${userId}/${target.id}/frame-0.jpg`]);

    // A row soft-deleted while 'reserved' can never be settled — the un-redaction issue #133
    // closed must not reopen through the new door.
    const deleted = await reserve(db, userId, "deleted-guard", FINGERPRINT_B);
    await db.query(
      `update public.analyses set deleted_at = now() where id = $1::uuid`,
      [deleted.id],
    );
    const refusedDelete = await settleWithFlag(db, userId, deleted.id!, true);
    assertEquals(refusedDelete.ok, false);
    assertEquals(refusedDelete.reason, "not_reserved_or_not_found");

    const stillDeleted = await readAnalysis(db, deleted.id!);
    assertEquals(stillDeleted.status, "reserved");
    assertEquals(stillDeleted.result, null);
    assertEquals(stillDeleted.zeroPillarAt, null);
    assert(stillDeleted.deletedAt !== null);

    // Cross-user settles are still refused outright.
    const foreign = await reserve(db, otherId, "foreign-settle");
    assertEquals(
      (await settleWithFlag(db, userId, foreign.id!, true)).reason,
      "not_reserved_or_not_found",
    );
  });
});

Deno.test("the unlimited-override display count honours the exemption too", async () => {
  await withDb(async (db) => {
    const userId = await createUser(db, "elite");
    const scored = await reserve(
      db,
      userId,
      "override-scored",
      FINGERPRINT_A,
      "reserve_analysis_unlimited",
    );
    await settleWithFlag(db, userId, scored.id!, false);
    const blank = await reserve(
      db,
      userId,
      "override-blank",
      FINGERPRINT_B,
      "reserve_analysis_unlimited",
    );
    await settleWithFlag(db, userId, blank.id!, true);

    const { rows } = await db.query<{ out: QuotaStatus }>(
      `select public.pace_quota_status_unlimited($1::uuid, now()) as out`,
      [userId],
    );
    assertEquals(
      Number(rows[0].out.used),
      1,
      "the override's diagnostic count must agree with pace_quota_status",
    );
  });
});

Deno.test("every function this migration touches keeps its hardened posture", async () => {
  await withDb(async (db) => {
    const { rows: column } = await db.query<{
      type: string;
      nullable: string;
      dflt: string | null;
    }>(
      `select data_type as type, is_nullable as nullable, column_default as dflt
       from information_schema.columns
       where table_schema = 'public' and table_name = 'analyses'
         and column_name = 'zero_pillar_at'`,
    );
    assertEquals(column[0], {
      type: "timestamp with time zone",
      nullable: "YES",
      dflt: null,
    });

    for (
      const [signature, expectedSearchPath] of [
        [
          "public.settle_analysis(uuid,uuid,jsonb,boolean,text[],boolean)",
          "search_path=public",
        ],
        [
          "public.reserve_analysis(uuid,text,public.media_type,integer,jsonb)",
          "search_path=public",
        ],
        [
          "public.pace_quota_status(uuid,timestamp with time zone)",
          "search_path=public",
        ],
        [
          "public.pace_quota_status_unlimited(uuid,timestamp with time zone)",
          "search_path=public",
        ],
        [
          "public.pace_zero_pillar_cooldown_remaining(uuid)",
          "search_path=public, pg_temp",
        ],
      ] as const
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
      const { rows: service } = await db.query<{ allowed: boolean }>(
        `select has_function_privilege('service_role', $1, 'EXECUTE') as allowed`,
        [signature],
      );
      assertEquals(
        service[0].allowed,
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

    // The client can neither see nor write the marker directly.
    for (const role of ["anon", "authenticated"]) {
      const { rows } = await db.query<{ update: boolean }>(
        `select has_column_privilege($1, 'public.analyses', 'zero_pillar_at', 'UPDATE') as update`,
        [role],
      );
      assertEquals(
        rows[0].update,
        false,
        `${role} must not be able to write zero_pillar_at`,
      );
    }
  });
});
