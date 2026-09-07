/**
 * Companion to `supabase/functions/_shared/__tests__/ai-guard-sql.deno.test.ts`, which is where
 * this change's BEHAVIOUR is proved — that suite runs the committed migrations against a real
 * (WASM) Postgres and asserts what the gate actually does.
 *
 * What is left for a text-level suite is the class of claim no runtime assertion can make: what
 * the migration DOESN'T do. "This change did not quietly reverse a captain decision" and "this
 * change did not delete the global ceiling" are statements about the diff, and the diff is the
 * only place they can be checked. Same constraint (and same rationale) as every other suite in
 * this directory — see `anti_farm_release_reason_fix.test.ts`'s header.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..');
const FIX_MIGRATION = '20260907120000_per_user_ai_daily_cap.sql';

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // timestamp-prefixed, so lexical sort == application order
}

const sql = readFileSync(join(MIGRATIONS_DIR, FIX_MIGRATION), 'utf8');

describe('the per-user AI daily cap migration is a forward migration', () => {
  it('is present in the applied migration set', () => {
    expect(migrationFiles()).toContain(FIX_MIGRATION);
  });

  it('sorts after every migration whose functions it rewrites or reads', () => {
    const files = migrationFiles();
    const index = files.indexOf(FIX_MIGRATION);
    for (const prior of [
      '20260712210000_ai_spend_guardrails.sql', // ai_ops_config / ai_call_log
      '20260712210100_ai_spend_guardrail_functions.sql', // gate_ai_call / ai_spend_today
      '20260804120000_pace_current_tier_function.sql', // the tier lookup the gate now calls
      '20260807090000_all_users_unlimited_access_override.sql', // the _unlimited sibling pattern
      '20260819120000_zero_pillar_release_reason.sql', // the hole this closes
    ]) {
      expect(files.indexOf(prior)).toBeGreaterThan(-1);
      expect(index).toBeGreaterThan(files.indexOf(prior));
    }
  });
});

describe('the captain decisions this change must NOT have reversed', () => {
  // `zero_pillars_assessed` refunds the quota slot and is deliberately not a farming signal
  // (audit-v23-r1-decision-zero-pillar-charge-policy). Closing the spend hole by making an honest
  // "nothing assessable in this clip" into abuse would be the wrong fix, and it would be an easy
  // one to reach for — so lock it out at the diff level.
  it.each([
    'pace_is_farming_signal',
    'reserve_analysis',
    'release_analysis',
    'settle_analysis',
    'analyses_release_reason_known_values',
  ])('does not redefine %s', (name) => {
    expect(sql).not.toMatch(new RegExp(`(create|replace|drop|alter)[\\s\\S]{0,80}${name}\\s*\\(`, 'i'));
  });

  it('never adds zero_pillars_assessed to any farming/abuse classifier', () => {
    // The string may appear in prose (it does, at length); it must not appear in executable SQL.
    const executable = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(executable).not.toContain('zero_pillars_assessed');
  });
});

describe('the global ceiling is retained, not replaced', () => {
  it('does not drop or rename daily_usd_cap', () => {
    expect(sql).not.toMatch(/drop\s+column\s+.*daily_usd_cap/i);
    expect(sql).not.toMatch(/rename\s+column\s+daily_usd_cap/i);
  });

  it('still checks spend against v_cfg.daily_usd_cap in the rewritten gate', () => {
    expect(sql).toMatch(/v_spent_usd \+ v_estimated_usd > v_cfg\.daily_usd_cap/);
  });

  it('adds the three per-user dials as NOT NULL with positive-value checks', () => {
    for (const column of [
      'user_daily_usd_cap_free',
      'user_daily_usd_cap_pro',
      'user_daily_usd_cap_elite',
    ]) {
      expect(sql).toMatch(new RegExp(`add column ${column}\\s+numeric not null default`, 'i'));
      expect(sql).toMatch(new RegExp(`check \\(${column} > 0\\)`, 'i'));
    }
  });
});

describe('nothing new is exposed to a client', () => {
  // Statements wrap across lines, so flatten first — a line-anchored regex would only ever see
  // the first line of a multi-line grant.
  const flattened = sql.replace(/\s+/g, ' ');
  const grants = [...flattened.matchAll(/grant execute on function .+? to ([^;]+);/gi)];

  it('grants EXECUTE on every new function to service_role and to nobody else', () => {
    expect(grants.length).toBe(5);
    for (const [, grantees] of grants) {
      expect(grantees.trim()).toBe('service_role');
    }
  });

  it('revokes EXECUTE from public/anon/authenticated on every function it defines', () => {
    const defined = [...sql.matchAll(/create or replace function (public\.\w+)\(/g)].map((m) => m[1]);
    expect(defined.sort()).toEqual([
      'public.ai_spend_today',
      'public.ai_user_daily_cap_usd',
      'public.gate_ai_call',
      'public.gate_ai_call_for_tier',
      'public.gate_ai_call_unlimited',
    ]);
    for (const fn of defined) {
      expect(sql).toMatch(
        new RegExp(`revoke execute on function ${fn.replace('.', '\\.')}\\([\\s\\S]*?from public, anon, authenticated`, 'i')
      );
    }
  });
});
