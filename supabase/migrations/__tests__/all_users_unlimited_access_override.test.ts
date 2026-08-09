/**
 * Regression locks for the temporary ALL_USERS_UNLIMITED_ACCESS database wrappers.
 * These are text-level contract checks; the real concurrency/idempotency properties continue to
 * be covered by the normal reserve_analysis integration suite, whose lock key the wrapper shares.
 */
import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.resolve(
  __dirname,
  '../20260807090000_all_users_unlimited_access_override.sql'
);
const sql = fs.readFileSync(migrationPath, 'utf8');

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  const end = sql.indexOf('$$;', start);
  if (start < 0 || end < 0) throw new Error(`Could not find ${name}`);
  return sql.slice(start, end);
}

describe('temporary all-users unlimited access wrappers', () => {
  it('is additive — never replaces the hardened normal entitlement/quota RPCs', () => {
    expect(sql).not.toMatch(/create or replace function public\.reserve_analysis\s*\(/);
    expect(sql).not.toMatch(/create or replace function public\.pace_quota_status\s*\(/);
    expect(sql).not.toMatch(/create or replace function public\.pace_current_tier\s*\(/);
    expect(sql).toContain('create or replace function public.reserve_analysis_unlimited(');
    expect(sql).toContain('create or replace function public.pace_quota_status_unlimited(');
    expect(sql).toContain('create or replace function public.pace_current_tier_unlimited(');
  });

  it('keeps request validation, the Elite frame cap, the shared lock, idempotency, and immutable usage row', () => {
    const reserve = functionBody('reserve_analysis_unlimited');
    expect(reserve).toMatch(/invalid_idempotency_key/);
    expect(reserve).toMatch(/invalid_frame_count_for_photo/);
    expect(reserve).toMatch(/if p_frame_count > 8 then/);
    expect(reserve).toMatch(/pg_advisory_xact_lock\(hashtext\(p_user_id::text \|\| ':analysis_reserve'\)\)/);
    expect(reserve).toMatch(/where user_id = p_user_id and idempotency_key = p_idempotency_key/);
    expect(reserve).toMatch(/insert into public\.analyses/);
    expect(reserve).toMatch(/'elite'/);
    expect(reserve).not.toMatch(/delete from public\.analyses/i);
  });

  it('bypasses only quota and anti-farm refusals while reporting an unlimited Elite status', () => {
    const reserve = functionBody('reserve_analysis_unlimited');
    expect(reserve).not.toMatch(/quota_exceeded/);
    expect(reserve).not.toMatch(/too_many_failed_attempts/);

    const quota = functionBody('pace_quota_status_unlimited');
    expect(quota).toContain("'tier', 'elite'");
    expect(quota).toContain("'limit', null");
    expect(quota).toContain("'frame_cap', 8");
    expect(quota).toContain("'blocked', false");
    expect(quota).toContain("'unlimited', true");
    expect(quota).not.toMatch(/deleted_at/);
  });

  it('keeps every wrapper service-role only', () => {
    for (const signature of [
      'public.pace_current_tier_unlimited(uuid)',
      'public.reserve_analysis_unlimited(uuid, text, public.media_type, integer)',
      'public.pace_quota_status_unlimited(uuid, timestamptz)',
    ]) {
      expect(sql).toContain(`revoke execute on function ${signature}`);
      expect(sql).toContain(`grant execute on function ${signature}`);
      expect(sql).toContain('to service_role;');
    }
  });
});
