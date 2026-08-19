/**
 * Regression lock for the captain decision audit-v23-r1-decision-zero-pillar-charge-policy: do
 * NOT charge Pro/Elite quota for a structurally valid analysis result that assessed zero pillars.
 *
 * TEXT-LEVEL contract on the migration SQL itself, same constraint as this repo's other
 * migration-test suites (see anti_farm_release_reason_fix.test.ts's own header for why) — proves
 * the migration FILE says the right thing, not that Postgres executes it as written.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..');

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // filenames are timestamp-prefixed, so lexical sort == chronological order
}

function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
}

const FIX_MIGRATION = '20260819120000_zero_pillar_release_reason.sql';
const sql = readMigration(FIX_MIGRATION);

describe('the zero-pillar release_reason migration exists and is ordered last', () => {
  it('the migration file is present', () => {
    expect(migrationFiles()).toContain(FIX_MIGRATION);
  });

  it('sorts after every prior release_reason migration (forward migration, not a rewrite)', () => {
    const files = migrationFiles();
    const fixIndex = files.indexOf(FIX_MIGRATION);
    const priorFiles = [
      '20260711150400_quota_reserve_settle_release.sql',
      '20260712220000_anti_farm_release_reason_fix.sql',
      '20260713130000_stale_reservation_sweep.sql',
    ];
    for (const prior of priorFiles) {
      expect(fixIndex).toBeGreaterThan(files.indexOf(prior));
    }
  });
});

describe('release_reason vocabulary gains zero_pillars_assessed, as a superset extension', () => {
  it('drops and recreates the SAME constraint name — one taxonomy, one place it lives', () => {
    expect(sql).toMatch(/drop constraint analyses_release_reason_known_values/i);
    expect(sql).toMatch(/add constraint analyses_release_reason_known_values\s+check/i);
  });

  it('NULL remains allowed (a reason is still optional, not mandatory)', () => {
    const start = sql.indexOf('add constraint analyses_release_reason_known_values');
    const end = sql.indexOf(');', start);
    const body = sql.slice(start, end);
    expect(body).toMatch(/release_reason is null/i);
  });

  it('every previously-valid reason stays valid — this is a superset, not a replacement', () => {
    const start = sql.indexOf('add constraint analyses_release_reason_known_values');
    const end = sql.indexOf(');', start);
    const body = sql.slice(start, end);
    for (const reason of [
      'model_error',
      'provider_timeout',
      'internal_error',
      'validation_failed',
      'stale_sweep',
    ]) {
      expect(body).toContain(`'${reason}'`);
    }
  });

  it('adds zero_pillars_assessed to the constraint', () => {
    const start = sql.indexOf('add constraint analyses_release_reason_known_values');
    const end = sql.indexOf(');', start);
    const body = sql.slice(start, end);
    expect(body).toContain("'zero_pillars_assessed'");
  });
});

describe('zero_pillars_assessed must never become a farming signal', () => {
  it('this migration never redefines pace_is_farming_signal — the new reason relies on that classifier\'s existing "unknown reason = not a farming signal" default', () => {
    expect(sql).not.toMatch(/create (or replace )?function public\.pace_is_farming_signal/i);
  });

  it('the migration documents why the new reason is excluded from the anti-farm cap', () => {
    expect(sql).toMatch(/pace_is_farming_signal/);
    expect(sql).toMatch(/not (a farming signal|abuse)/i);
  });
});

describe('settle_analysis, release_analysis, and reserve_analysis are untouched by this migration', () => {
  it('never redefines settle_analysis', () => {
    expect(sql).not.toMatch(/create (or replace )?function public\.settle_analysis/i);
  });

  it('never redefines release_analysis', () => {
    expect(sql).not.toMatch(/create (or replace )?function public\.release_analysis/i);
  });

  it('never redefines reserve_analysis — the release_reason taxonomy is generic and needs no counting-query change', () => {
    expect(sql).not.toMatch(/create (or replace )?function public\.reserve_analysis/i);
  });
});
