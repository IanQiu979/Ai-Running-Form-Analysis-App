/**
 * Structural regression lock for the #130 migration
 * (`supabase/migrations/20260713140000_attach_media_paths.sql`).
 *
 * WHAT THIS SUITE CAN PROVE: the migration's text carries the three load-bearing guards — the
 * namespace guard (a fresh entry point for the bug #8 closed, since this is a NEW writer of
 * `media_paths`), the delivered-only guard, and the write-once guard — and that EXECUTE is
 * service_role-only.
 *
 * WHAT IT CANNOT PROVE: that the SQL is valid Postgres or behaves as written. There is no
 * non-production Supabase environment (#92), so behavioral verification happens when whoever
 * applies this migration (with #131's other three) runs it against the live database.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = join(
  __dirname,
  '..',
  'migrations',
  '20260713140000_attach_media_paths.sql'
);
const sql = readFileSync(MIGRATION_PATH, 'utf8');

function attachBody(): string {
  const start = sql.indexOf('create or replace function public.attach_media_paths(');
  const end = sql.indexOf('$$;', start);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, end);
}

describe('attach_media_paths: the namespace guard is replicated, not assumed', () => {
  it('rejects a path outside {p_user_id}/{p_analysis_id}/ before ever touching the row', () => {
    const body = attachBody();
    const guardIdx = body.indexOf('invalid_media_path');
    const updateIdx = body.indexOf('update public.analyses');

    expect(guardIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(-1);
    // The guard must run BEFORE the update. This RPC is a second writer of `media_paths`, so
    // without the guard it would reopen #8 from a new direction: a compromised or buggy edge
    // function pointing one user's analyses row at another user's frames.
    expect(guardIdx).toBeLessThan(updateIdx);
    expect(body).toMatch(
      /v_prefix\s*:=\s*p_user_id::text\s*\|\|\s*'\/'\s*\|\|\s*p_analysis_id::text\s*\|\|\s*'\/'/
    );
  });

  it('rejects the whole call rather than silently dropping the bad path', () => {
    // Same discipline as settle_analysis: a foreign path is a bug or an attack, and swallowing it
    // would hide both. The guard returns, it does not `continue`.
    expect(attachBody()).toMatch(/return jsonb_build_object\('ok',\s*false,\s*'reason',\s*'invalid_media_path'\)/);
  });

  it('actually performs the namespace comparison, not just builds a prefix', () => {
    // Without this, the whole guard could be gutted (delete the foreach, keep v_prefix, stub in
    // a dead `if false then ... end if`) and every other assertion in this describe block would
    // still pass while the RPC accepted any path from any user's namespace. Pin the loop and
    // every term of the actual comparison, not just its existence.
    const body = attachBody();
    expect(body).toMatch(/foreach\s+v_path\s+in\s+array\s+coalesce\(p_media_paths,\s*'\{\}'\)/);
    expect(body).toMatch(/position\(v_prefix\s+in\s+v_path\)\s*<>\s*1/);
    expect(body).toMatch(/length\(v_path\)\s*<=\s*length\(v_prefix\)/);
    expect(body).toMatch(/v_path\s+is\s+null/);
    expect(body).not.toMatch(/\braise\b/i); // refusals RETURN, never RAISE
  });
});

describe('attach_media_paths: it can only ever fill in a delivered row, once', () => {
  it('updates only rows already in status = delivered', () => {
    // Paths can never be attached to a 'reserved' row (that would break THE INVARIANT) or to a
    // 'released' one (that would name frames on a row the sweep just reclaimed).
    expect(attachBody()).toMatch(/status\s*=\s*'delivered'/);
  });

  it('refuses a soft-deleted row — the redaction trigger only fires on the delete transition', () => {
    expect(attachBody()).toMatch(/deleted_at is null/);
  });

  it('is write-once: it refuses a row whose media_paths is already populated', () => {
    expect(attachBody()).toMatch(/cardinality\(coalesce\(media_paths,\s*'\{\}'\)\)\s*=\s*0/);
  });

  it('reports a refusal rather than throwing, so the caller can log and move on', () => {
    expect(attachBody()).toContain('not_delivered_or_already_attached');
  });

  it('never writes status, result, is_fallback, or delivered_at — settle_analysis owns those', () => {
    const body = attachBody();
    const update = body.slice(body.indexOf('update public.analyses'));
    const setClause = update.slice(0, update.indexOf('where'));

    expect(setClause).toContain('media_paths');
    expect(setClause).not.toContain('status =');
    expect(setClause).not.toContain('result =');
    expect(setClause).not.toContain('is_fallback =');
    expect(setClause).not.toContain('delivered_at =');
  });
});

describe('attach_media_paths: no client can ever call it', () => {
  it('is security definer with a pinned search_path', () => {
    const body = attachBody();
    expect(body).toContain('security definer');
    expect(body).toContain('set search_path = public');
  });

  it('grants EXECUTE to service_role only', () => {
    expect(sql).toContain(
      'revoke execute on function public.attach_media_paths(uuid, uuid, text[]) from public, anon, authenticated;'
    );
    expect(sql).toContain(
      'grant execute on function public.attach_media_paths(uuid, uuid, text[]) to service_role;'
    );
  });
});
