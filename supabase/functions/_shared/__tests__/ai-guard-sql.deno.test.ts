/**
 * BEHAVIOURAL proof of the per-user AI daily cap — the real migration SQL, executed by a real
 * Postgres, not a text-level assertion over the migration file.
 *
 * WHY THIS FILE EXISTS AT ALL. `supabase/migrations/__tests__/*.test.ts` are text-level contracts
 * over migration source, and CLAUDE.md is blunt about that class of test's ceiling: "Verify any
 * privilege claim live... never with a text-level test over migration contents — a text test
 * passes while the privilege is fully intact." The same ceiling applies to a spend cap. The two
 * properties this change has to prove — that one user exhausting their allowance leaves another
 * user unaffected, and that the zero-pillar path is bounded — are statements about what Postgres
 * DOES, and no amount of regex over `.sql` can fail when they stop being true.
 *
 * WHY PGLITE AND NOT THE LOCAL STACK. `_shared/integration/*.local.ts` (issues #49/#59/#92) is
 * this repo's existing answer for "needs a real Postgres", and it is the right tool when the test
 * needs Storage, auth, or genuine concurrency. It is opt-in: it needs Docker and
 * `supabase start`, so it does not run in `npm test` or in CI, which is exactly the wrong place
 * for a regression lock on a spend control. PGlite is Postgres 17 compiled to WASM — same
 * planner, same plpgsql, same `jsonb`, same advisory locks — in-process, ~1s, no Docker, and it
 * runs under `npm run test:edge`'s EXISTING permission set (`--allow-read` plus the three
 * SUPABASE_* env vars; no net, no write, no ffi). So this lock runs on every commit.
 *
 * WHAT IS REAL AND WHAT IS A STAND-IN, stated so nobody over-reads the result:
 *   - REAL: every function under test is loaded verbatim from its committed migration file. The
 *     bytes Postgres executes here are the bytes that ship.
 *   - STAND-IN: `auth.users` / `auth.uid()`, which the platform provides in production and PGlite
 *     does not. Only the FK target and the RLS policy expressions need them, neither of which is
 *     under test here.
 *   - NOT COVERED: genuine concurrency. PGlite is single-connection, so `pg_advisory_xact_lock`
 *     is exercised but not contended. Concurrent serialization remains
 *     `_shared/integration/quota-rpc.local.ts`'s job, against the real stack.
 */
import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import { PGlite } from 'npm:@electric-sql/pglite@0.3.12';

const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url);

/**
 * The migrations this suite loads, in filename (= application) order. Deliberately the minimum
 * set the gate transitively needs, not the whole tree: `storage`, cron, and the media guard bring
 * in platform schemas PGlite has no equivalent for and none of them is reachable from
 * `gate_ai_call`.
 */
const MIGRATIONS = [
  '20260711150000_profiles.sql',
  '20260711150100_subscriptions.sql',
  '20260711150200_analyses.sql',
  '20260712210000_ai_spend_guardrails.sql',
  '20260712210100_ai_spend_guardrail_functions.sql',
  '20260712220000_anti_farm_release_reason_fix.sql',
  '20260819120000_zero_pillar_release_reason.sql',
  '20260804120000_pace_current_tier_function.sql',
  '20260907120000_per_user_ai_daily_cap.sql',
] as const;

/**
 * Everything Supabase's platform provides that PGlite does not. `auth.uid()` returns NULL here
 * (no request JWT), which is correct: every policy that calls it simply never matches, and no
 * test in this file depends on RLS — the functions under test are all SECURITY DEFINER and are
 * invoked as the owner.
 */
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

/** A real `auth.users` row, which the `on_auth_user_created` trigger turns into a `profiles` row
 * exactly as a signup does. Optionally puts the user on a paid tier. */
async function createUser(db: PGlite, tier: 'free' | 'pro' | 'elite'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
    [`${tier}-${crypto.randomUUID()}@example.test`]
  );
  const id = rows[0].id;
  if (tier !== 'free') {
    await db.query(
      `insert into public.subscriptions (user_id, tier, status, purchased_at)
       values ($1, $2::public.subscription_tier, 'active', now())`,
      [id, tier]
    );
  }
  return id;
}

interface GateResult {
  allowed: boolean;
  reason?: string;
  call_id?: string;
  estimated_usd?: number;
  cap_usd?: number;
  spent_usd?: number;
  tier?: string;
}

/**
 * The worst-case Elite call `flow.ts` actually gates: 8 frames, elite's 8k output budget, at
 * `_shared/ai-pricing.ts`'s own constants (24000 + 8*1600 in, 8000 out). $0.2304 at the seeded
 * claude-sonnet-5 list price.
 */
const ELITE_CALL = { input: 24000 + 8 * 1600, output: 8000 };
/** The worst-case Free call: 1 frame, 4k output. $0.1368. */
const FREE_CALL = { input: 24000 + 1 * 1600, output: 4000 };

async function gate(
  db: PGlite,
  userId: string | null,
  call: { input: number; output: number } = ELITE_CALL,
  fn: 'gate_ai_call' | 'gate_ai_call_unlimited' = 'gate_ai_call'
): Promise<GateResult> {
  const { rows } = await db.query<{ out: GateResult }>(
    `select public.${fn}($1::uuid, $2::integer, $3::integer) as out`,
    [userId, call.input, call.output]
  );
  return rows[0].out;
}

/** Settles a gated call the way `flow.ts` settles a DELIVERED result — including a zero-pillar
 * one, which `statusForCall` reports as `'success'` because the response validated. Usage is the
 * gate's own estimate, i.e. the honest worst case. */
async function settleSuccess(
  db: PGlite,
  callId: string,
  call: { input: number; output: number } = ELITE_CALL
): Promise<void> {
  await db.query(
    `select public.record_ai_call($1::uuid, 'success'::public.ai_call_status, $2::integer, $3::integer)`,
    [callId, call.input, call.output]
  );
}

/** Gates and settles until the gate refuses, returning how many calls got through and why it
 * stopped. Bounded so a broken cap fails the test instead of looping forever. */
async function spendUntilDenied(
  db: PGlite,
  userId: string,
  call: { input: number; output: number } = ELITE_CALL,
  fn: 'gate_ai_call' | 'gate_ai_call_unlimited' = 'gate_ai_call'
): Promise<{ allowedCalls: number; denial: GateResult }> {
  for (let allowedCalls = 0; allowedCalls < 500; allowedCalls += 1) {
    const result = await gate(db, userId, call, fn);
    if (!result.allowed) {
      return { allowedCalls, denial: result };
    }
    await settleSuccess(db, result.call_id as string, call);
  }
  throw new Error('the gate never denied within 500 calls — a per-user cap is not being applied');
}

async function withDb(run: (db: PGlite) => Promise<void>): Promise<void> {
  const db = await freshDb();
  try {
    await run(db);
  } finally {
    await db.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The finding: the cap was global, so one user could spend everyone else's day.
// ─────────────────────────────────────────────────────────────────────────────────────────────

Deno.test('one user exhausting their allowance does not deny another user', async () => {
  await withDb(async (db) => {
    const farmer = await createUser(db, 'elite');
    const bystander = await createUser(db, 'elite');

    const { allowedCalls, denial } = await spendUntilDenied(db, farmer);

    // The farmer is stopped by THEIR OWN ceiling, not by the shared one. Against the pre-fix
    // gate this assertion is unreachable: `user_daily_cap` did not exist as a reason, and the
    // farmer would have run on until the $10 global cap denied everybody.
    assertEquals(denial.reason, 'user_daily_cap');
    assertEquals(Number(denial.cap_usd), 4.0);
    assertEquals(denial.tier, 'elite');
    assert(allowedCalls > 0, 'the farmer should get some calls before being capped');

    // And the bystander — who has spent nothing — is completely unaffected.
    const bystanderGate = await gate(db, bystander);
    assertEquals(
      bystanderGate.allowed,
      true,
      `a second user was denied (${bystanderGate.reason}) by another user's spending`
    );

    // The global ceiling is intact and was never the thing that fired.
    const { rows } = await db.query<{ out: { spend_total_usd: number; daily_usd_cap: number } }>(
      `select public.ai_spend_today() as out`
    );
    assert(
      Number(rows[0].out.spend_total_usd) < Number(rows[0].out.daily_usd_cap),
      'the per-user cap must bite well before the global cap does'
    );
  });
});

Deno.test('the global cap is retained as the outer ceiling, not replaced', async () => {
  await withDb(async (db) => {
    // Raise every per-user cap out of the way; the global one must still stop the spend.
    await db.exec(`
      update public.ai_ops_config
      set user_daily_usd_cap_free = 100, user_daily_usd_cap_pro = 100,
          user_daily_usd_cap_elite = 100, daily_usd_cap = 1.00;
    `);
    const user = await createUser(db, 'elite');
    const { denial } = await spendUntilDenied(db, user);
    assertEquals(denial.reason, 'daily_cap');
    assertEquals(Number(denial.cap_usd), 1.0);
  });
});

Deno.test('when both ceilings would deny, the caller is told about their own', async () => {
  await withDb(async (db) => {
    // Both caps are already exceeded by a single Elite call ($0.2304).
    await db.exec(`
      update public.ai_ops_config
      set user_daily_usd_cap_elite = 0.01, daily_usd_cap = 0.01;
    `);
    const user = await createUser(db, 'elite');
    const denial = await gate(db, user);
    assertEquals(denial.allowed, false);
    assertEquals(
      denial.reason,
      'user_daily_cap',
      "a user over their own allowance must not be told it is the platform's fault"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The zero-pillar farming path specifically.
// ─────────────────────────────────────────────────────────────────────────────────────────────

Deno.test(
  'the zero-pillar path is bounded per user even though it charges no quota and no anti-farm strike',
  async () => {
    await withDb(async (db) => {
      const farmer = await createUser(db, 'elite');
      const bystander = await createUser(db, 'elite');

      // The two controls that DELIBERATELY do not fire on this path. Both are captain decisions
      // (audit-v23-r1-decision-zero-pillar-charge-policy) and this change must not have "fixed"
      // the hole by quietly reversing either of them — so assert they are still forgiving.
      const { rows: farming } = await db.query<{ is_signal: boolean }>(
        `select public.pace_is_farming_signal('zero_pillars_assessed') as is_signal`
      );
      assertEquals(
        farming[0].is_signal,
        false,
        'an honest zero-pillar result must still not count as a farming signal'
      );

      // Now farm: every iteration is a real, fully-billed model call whose result validated with
      // all four pillars not-assessed, so `flow.ts` releases the reservation with
      // 'zero_pillars_assessed' (quota refunded) and settles the ledger row as 'success'.
      let calls = 0;
      for (;;) {
        const gated = await gate(db, farmer);
        if (!gated.allowed) {
          assertEquals(
            gated.reason,
            'user_daily_cap',
            `farming was stopped by ${gated.reason}, which is not a per-user control`
          );
          break;
        }
        calls += 1;
        // The reservation this call paid for, handed straight back — no quota consumed, ever.
        const { rows: reserved } = await db.query<{ id: string }>(
          `insert into public.analyses
             (user_id, media_type, frame_count, tier_at_run, status, idempotency_key,
              release_reason, released_at)
           values ($1, 'video', 8, 'elite', 'released', $2, 'zero_pillars_assessed', now())
           returning id`,
          [farmer, `farm-${calls}`]
        );
        assert(reserved[0].id);
        await settleSuccess(db, gated.call_id as string);
        assert(calls < 500, 'zero-pillar farming was never stopped');
      }

      // Proof that neither per-user control the farmer walked past ever engaged: every analysis
      // row is 'released' (so the quota count of reserved+delivered rows is zero), and not one of
      // them is a farming signal (so `reserve_analysis`'s 3-strike cap never ticked).
      const { rows: counts } = await db.query<{ charged: number; strikes: number }>(
        `select
           count(*) filter (where status in ('reserved', 'delivered')) as charged,
           count(*) filter (where public.pace_is_farming_signal(release_reason)) as strikes
         from public.analyses where user_id = $1`,
        [farmer]
      );
      assertEquals(Number(counts[0].charged), 0, 'the farmer should have burned no quota at all');
      assertEquals(Number(counts[0].strikes), 0, 'the farmer should have taken no anti-farm strike');

      // The spend cap is therefore the ONLY thing that stopped them — and it did, at their own
      // allowance, with everyone else's day untouched.
      assert(calls > 0);
      assertEquals((await gate(db, bystander)).allowed, true);
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The cap is keyed by user AND by tier, and the tier is derived server-side.
// ─────────────────────────────────────────────────────────────────────────────────────────────

Deno.test('the cap is tier-scaled, and the tier is read from the DB, not from the caller', async () => {
  await withDb(async (db) => {
    const free = await createUser(db, 'free');
    const pro = await createUser(db, 'pro');
    const elite = await createUser(db, 'elite');

    // Nothing in the call names a tier — `gate_ai_call` takes no tier argument at all. Each
    // user's ceiling comes from their own `subscriptions` row.
    const freeDenial = (await spendUntilDenied(db, free, FREE_CALL)).denial;
    const proDenial = (await spendUntilDenied(db, pro, FREE_CALL)).denial;
    const eliteDenial = (await spendUntilDenied(db, elite, FREE_CALL)).denial;

    assertEquals(freeDenial.tier, 'free');
    assertEquals(Number(freeDenial.cap_usd), 0.75);
    assertEquals(proDenial.tier, 'pro');
    assertEquals(Number(proDenial.cap_usd), 2.0);
    assertEquals(eliteDenial.tier, 'elite');
    assertEquals(Number(eliteDenial.cap_usd), 4.0);
  });
});

Deno.test('losing a paid subscription immediately drops the caller onto the Free cap', async () => {
  await withDb(async (db) => {
    const user = await createUser(db, 'pro');
    assertEquals(Number((await spendUntilDenied(db, user, FREE_CALL)).denial.cap_usd), 2.0);

    await db.query(`update public.subscriptions set status = 'canceled' where user_id = $1`, [user]);
    const afterCancel = await gate(db, user, FREE_CALL);
    assertEquals(afterCancel.allowed, false);
    assertEquals(afterCancel.tier, 'free');
    assertEquals(Number(afterCancel.cap_usd), 0.75);
  });
});

Deno.test('gate_ai_call_unlimited applies the Elite cap — it does not disable the cap', async () => {
  await withDb(async (db) => {
    // A user with NO subscription: `gate_ai_call` would cap them at Free, the override at Elite.
    const user = await createUser(db, 'free');
    const { denial } = await spendUntilDenied(db, user, ELITE_CALL, 'gate_ai_call_unlimited');
    assertEquals(denial.reason, 'user_daily_cap');
    assertEquals(denial.tier, 'elite');
    assertEquals(Number(denial.cap_usd), 4.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The cap has no blind spots, and no unattributable spend.
// ─────────────────────────────────────────────────────────────────────────────────────────────

Deno.test('a failed call with no usage data still counts against the user, at its estimate', async () => {
  await withDb(async (db) => {
    const user = await createUser(db, 'elite');
    const first = await gate(db, user);
    assert(first.allowed);
    // `record_ai_call` settles a usage-less failure at the estimate, not at zero.
    await db.query(
      `select public.record_ai_call($1::uuid, 'model_error'::public.ai_call_status)`,
      [first.call_id]
    );

    const { rows } = await db.query<{ spent: string }>(
      `select coalesce(sum(actual_usd), 0)::text as spent from public.ai_call_log where user_id = $1`,
      [user]
    );
    assertEquals(Number(rows[0].spent), Number(first.estimated_usd));

    // …and the very next gate for that user sees it.
    const second = await gate(db, user);
    assert(second.allowed);
    assertEquals(Number(second.estimated_usd), Number(first.estimated_usd));
  });
});

Deno.test('a call that names no user is refused outright and reserves nothing', async () => {
  await withDb(async (db) => {
    const denial = await gate(db, null);
    assertEquals(denial.allowed, false);
    assertEquals(denial.reason, 'invalid_user');

    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.ai_call_log`
    );
    assertEquals(
      Number(rows[0].n),
      0,
      'an unattributable call must not reserve budget it can never be charged for'
    );
  });
});

Deno.test('a deleted account keeps counting globally but against nobody per-user', async () => {
  await withDb(async (db) => {
    const user = await createUser(db, 'elite');
    const gated = await gate(db, user);
    assert(gated.allowed);
    await settleSuccess(db, gated.call_id as string);

    await db.query(`delete from auth.users where id = $1`, [user]);

    const { rows } = await db.query<{ orphans: string; total: string }>(
      `select count(*) filter (where user_id is null)::text as orphans,
              count(*)::text as total
       from public.ai_call_log`
    );
    assertEquals(Number(rows[0].total), 1, 'spend history must survive account deletion');
    assertEquals(Number(rows[0].orphans), 1, 'the row is de-identified, not deleted');

    const { rows: spend } = await db.query<{ out: { spend_total_usd: number } }>(
      `select public.ai_spend_today() as out`
    );
    assert(
      Number(spend[0].out.spend_total_usd) > 0,
      'the money was really spent; the global cap must still see it'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The dials, and the pre-existing guardrails this change must not have broken.
// ─────────────────────────────────────────────────────────────────────────────────────────────

Deno.test('the per-user caps are operator-tunable with one UPDATE, no redeploy', async () => {
  await withDb(async (db) => {
    const user = await createUser(db, 'elite');
    await db.exec(`update public.ai_ops_config set user_daily_usd_cap_elite = 0.50;`);
    const { allowedCalls, denial } = await spendUntilDenied(db, user);
    assertEquals(Number(denial.cap_usd), 0.5);
    assertEquals(allowedCalls, 2); // 2 x $0.2304 = $0.4608; a third would exceed $0.50.
  });
});

Deno.test('the kill switch and the circuit breaker still precede the caps', async () => {
  await withDb(async (db) => {
    const user = await createUser(db, 'elite');

    await db.exec(`update public.ai_ops_config set analyze_enabled = false;`);
    assertEquals((await gate(db, user)).reason, 'killed');
    await db.exec(`update public.ai_ops_config set analyze_enabled = true;`);

    // Five consecutive settled failures with the cooldown still fresh = breaker open.
    for (let i = 0; i < 5; i += 1) {
      const gated = await gate(db, user);
      assert(gated.allowed);
      await db.query(
        `select public.record_ai_call($1::uuid, 'validation_failed'::public.ai_call_status)`,
        [gated.call_id]
      );
    }
    assertEquals((await gate(db, user)).reason, 'breaker_open');
  });
});

Deno.test('an unpriced model is still refused before anything is reserved', async () => {
  await withDb(async (db) => {
    const user = await createUser(db, 'elite');
    const { rows } = await db.query<{ out: GateResult }>(
      `select public.gate_ai_call($1::uuid, 100, 100, 'not-a-model') as out`,
      [user]
    );
    assertEquals(rows[0].out.reason, 'unknown_model');
  });
});

Deno.test('the gate stays service_role-only after the rewrite', async () => {
  await withDb(async (db) => {
    for (const [fn, args] of [
      ['gate_ai_call', 'uuid, integer, integer, text, uuid'],
      ['gate_ai_call_unlimited', 'uuid, integer, integer, text, uuid'],
      ['gate_ai_call_for_tier', 'uuid, public.analysis_tier, integer, integer, text, uuid'],
      ['ai_user_daily_cap_usd', 'public.analysis_tier'],
    ] as const) {
      const signature = `public.${fn}(${args})`;
      for (const role of ['anon', 'authenticated']) {
        const { rows } = await db.query<{ allowed: boolean }>(
          `select has_function_privilege($1, $2, 'EXECUTE') as allowed`,
          [role, signature]
        );
        assertEquals(rows[0].allowed, false, `${role} must not be able to execute ${signature}`);
      }
      const { rows } = await db.query<{ allowed: boolean }>(
        `select has_function_privilege('service_role', $1, 'EXECUTE') as allowed`,
        [signature]
      );
      assertEquals(rows[0].allowed, true, `service_role must be able to execute ${signature}`);
    }
  });
});

Deno.test('gate_ai_call keeps its exact pre-existing signature', async () => {
  await withDb(async (db) => {
    const { rows } = await db.query<{ args: string; n: string }>(
      `select pg_get_function_identity_arguments(p.oid) as args, count(*) over () as n
       from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = 'gate_ai_call'`
    );
    assertEquals(Number(rows[0].n), 1, 'a second overload of gate_ai_call would split its callers');
    assertEquals(rows[0].args, 'p_user_id uuid, p_estimated_input_tokens integer, ' +
      'p_estimated_output_tokens integer, p_model text, p_analysis_id uuid');
    assertNotEquals(rows[0].args, '');
  });
});
