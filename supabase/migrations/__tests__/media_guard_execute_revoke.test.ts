/**
 * Regression locks for `20260713160000_media_guard_execute_revoke.sql`.
 *
 * Both of the things this migration exists for were found by VERIFYING the 2026-07-13 production
 * push against the live database, not by any test — which is the point worth remembering:
 *
 *   1. Issue #7's `pace_enforce_media_object_guard()` is SECURITY DEFINER (correctly — a trigger
 *      on storage.objects must read public.analyses regardless of caller). But it inherited the
 *      default EXECUTE-to-PUBLIC grant and lives in the PostgREST-exposed `public` schema, so it
 *      became callable by `anon` as POST /rest/v1/rpc/pace_enforce_media_object_guard. Supabase's
 *      own advisor flagged it (lints 0028/0029) within minutes of the push.
 *
 *   2. Issue #100's `revoke all on storage.objects` applied cleanly and did NOTHING — see
 *      `grant_hardening.test.ts`'s storage block header for the full why.
 *
 * As with every migration test in this repo: TEXT-LEVEL only (no local Postgres, no Docker). This
 * proves the file says the right thing. It emphatically CANNOT prove Postgres did the right thing
 * — and item 2 above is precisely what that blind spot costs. The live state was confirmed by
 * direct query after applying:
 *
 *     has_function_privilege('anon', 'public.pace_enforce_media_object_guard()', 'execute') => false
 *     pace_media_object_guard trigger still armed on storage.objects                        => true
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..');
const MIGRATION = '20260713160000_media_guard_execute_revoke.sql';

function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
}

describe('20260713160000 — EXECUTE revoke on the media-object guard', () => {
  const sql = readMigration(MIGRATION);

  it('exists in the migrations directory', () => {
    expect(readdirSync(MIGRATIONS_DIR)).toContain(MIGRATION);
  });

  it.each(['public', 'anon', 'authenticated'])(
    'revokes EXECUTE on pace_enforce_media_object_guard() from %s',
    (role) => {
      expect(sql).toMatch(
        new RegExp(
          `revoke execute on function public\\.pace_enforce_media_object_guard\\(\\) from ${role}`,
          'i'
        )
      );
    }
  );

  it('never re-grants EXECUTE on it to a client-facing role', () => {
    expect(sql).not.toMatch(
      /grant\s+execute[^;]*pace_enforce_media_object_guard[^;]*to\s+(anon|authenticated|public)/i
    );
  });

  // The guard trigger is the ONLY control on the bucket that survives a service_role writer
  // (which bypasses RLS but not triggers), and issue #100's grant revoke is inert. So dropping
  // the trigger would leave the bucket genuinely undefended, not merely less defended.
  it('does NOT drop the pace_media_object_guard trigger while revoking EXECUTE on its function', () => {
    expect(sql).not.toMatch(/drop\s+trigger[^;]*pace_media_object_guard/i);
  });

  it('does NOT drop or replace the guard function itself', () => {
    expect(sql).not.toMatch(/drop\s+function[^;]*pace_enforce_media_object_guard/i);
    expect(sql).not.toMatch(/create\s+or\s+replace\s+function[^;]*pace_enforce_media_object_guard/i);
  });

  it("records WHY issue #100's storage.objects revoke cannot work, so nobody re-litigates it", () => {
    expect(sql).toMatch(/supabase_storage_admin/i);
    expect(sql).toMatch(/grantor/i);
  });
});
