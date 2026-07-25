/**
 * Structural regression lock for the #88 migration
 * (`supabase/migrations/20260712123606_frame_upload_ordering.sql`).
 *
 * The repo has no pgTAP harness (see the design spec and implementation plan under
 * `docs/superpowers/`). A local Docker Supabase stack now exists (issue #92, this branch), but
 * this suite is deliberately still a text-level check pending a separate, deliberate follow-up to
 * decide whether to convert it to run against that local stack. Real
 * behavioral verification (the RPCs actually enforce the namespace guard, the policies actually
 * gate PostgREST, `get_advisors` stays clean) has to happen against the live database, by
 * whoever applies this migration — see the plan's Task 2 for the exact queries to run.
 *
 * WHAT THIS SUITE CAN PROVE: the migration file's *text* contains the load-bearing pieces of the
 * contract — the old signatures are dropped (not just shadowed by an overload), the new
 * signatures have the right shape, the guard exists, and exactly the right policies are dropped
 * (not the SELECT ones the client still needs). It is a lint against the SQL text, not proof the
 * SQL is correct Postgres or that it behaves as written.
 *
 * WHAT THIS SUITE CANNOT PROVE: that `drop function` actually removes the old overload on a live
 * database, that the guard's `position()` check has no edge case, or that RLS enforces what the
 * policy text says. Those are exactly the plan's Task 2 assertions, deferred to whoever can apply
 * this migration to a real Postgres instance.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = join(__dirname, '..', 'migrations', '20260712123606_frame_upload_ordering.sql');
const sql = readFileSync(MIGRATION_PATH, 'utf8');

describe('reserve_analysis: p_media_paths is gone, not just shadowed', () => {
  it('drops the old 5-arg signature explicitly, before recreating it', () => {
    const dropIdx = sql.indexOf(
      'drop function if exists public.reserve_analysis(uuid, text, public.media_type, integer, text[]);'
    );
    const createIdx = sql.indexOf('create or replace function public.reserve_analysis(');

    expect(dropIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(-1);
    // Order matters: a create-or-replace with a shorter arg list, issued before the drop, would
    // still leave the old 5-arg overload live and callable with a client-supplied path (#8).
    expect(dropIdx).toBeLessThan(createIdx);
  });

  it('the recreated function does not declare p_media_paths', () => {
    const start = sql.indexOf('create or replace function public.reserve_analysis(');
    const end = sql.indexOf('$$;', start);
    const body = sql.slice(start, end);

    expect(body).not.toMatch(/p_media_paths/);
    // The 4 params that DO remain, in order — a stand-in for "exactly this signature".
    expect(body).toMatch(/p_user_id\s+uuid/);
    expect(body).toMatch(/p_idempotency_key\s+text/);
    expect(body).toMatch(/p_media_type\s+public\.media_type/);
    expect(body).toMatch(/p_frame_count\s+integer/);
  });

  it('the insert no longer lists media_paths as a column', () => {
    const insertMatch = sql.match(/insert into public\.analyses \(([\s\S]*?)\)/);
    expect(insertMatch).not.toBeNull();
    expect(insertMatch![1]).not.toMatch(/media_paths/);
  });

  it('grants EXECUTE on the new 4-arg signature to service_role only', () => {
    expect(sql).toContain(
      'revoke execute on function public.reserve_analysis(uuid, text, public.media_type, integer) from public, anon, authenticated;'
    );
    expect(sql).toContain(
      'grant execute on function public.reserve_analysis(uuid, text, public.media_type, integer) to service_role;'
    );
  });
});

describe('settle_analysis: gains p_media_paths, with a namespace guard', () => {
  it('drops the old 4-arg signature explicitly, before recreating it', () => {
    const dropIdx = sql.indexOf('drop function if exists public.settle_analysis(uuid, uuid, jsonb, boolean);');
    const createIdx = sql.indexOf('create or replace function public.settle_analysis(');

    expect(dropIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(-1);
    expect(dropIdx).toBeLessThan(createIdx);
  });

  it('declares p_media_paths text[] defaulting to empty', () => {
    const start = sql.indexOf('create or replace function public.settle_analysis(');
    const end = sql.indexOf('$$;', start);
    const body = sql.slice(start, end);

    expect(body).toMatch(/p_media_paths\s+text\[\]\s+default\s+'\{\}'/);
  });

  it('rejects a path outside {p_user_id}/{p_analysis_id}/ before ever touching the row', () => {
    const start = sql.indexOf('create or replace function public.settle_analysis(');
    const end = sql.indexOf('$$;', start);
    const body = sql.slice(start, end);
    const guardIdx = body.indexOf('invalid_media_path');
    const updateIdx = body.indexOf('update public.analyses');

    expect(guardIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(-1);
    // The guard must run BEFORE the update — a rejected path must write nothing, not get
    // silently dropped from an otherwise-successful settle.
    expect(guardIdx).toBeLessThan(updateIdx);
    // The prefix check itself: every path must start with the caller's own user_id/analysis_id.
    expect(body).toMatch(/v_prefix\s*:=\s*p_user_id::text\s*\|\|\s*'\/'\s*\|\|\s*p_analysis_id::text\s*\|\|\s*'\/'/);
  });

  it('grants EXECUTE on the new 5-arg signature to service_role only', () => {
    expect(sql).toContain(
      'revoke execute on function public.settle_analysis(uuid, uuid, jsonb, boolean, text[]) from public, anon, authenticated;'
    );
    expect(sql).toContain(
      'grant execute on function public.settle_analysis(uuid, uuid, jsonb, boolean, text[]) to service_role;'
    );
  });
});

describe('release_analysis is untouched', () => {
  it('is not dropped, recreated, or re-granted by this migration', () => {
    expect(sql).not.toMatch(/function public\.release_analysis/);
  });
});

describe('storage.objects: the client keeps SELECT, loses INSERT and DELETE', () => {
  it('drops exactly the upload and delete policies', () => {
    expect(sql).toContain('drop policy if exists "Users can upload their own media objects" on storage.objects;');
    expect(sql).toContain('drop policy if exists "Users can delete their own media objects" on storage.objects;');
  });

  it('does not touch the view (SELECT) policy — signed URLs for the frame strip still need it', () => {
    expect(sql).not.toMatch(/drop policy[^;]*"Users can view their own media objects"/);
  });
});

describe('public.analyses: the client loses DELETE, keeps SELECT', () => {
  it('drops the delete-own policy', () => {
    expect(sql).toContain('drop policy if exists "Users can delete their own analyses" on public.analyses;');
  });

  it('does not touch the view (SELECT) policy — quota display and Past Analyses still need it', () => {
    expect(sql).not.toMatch(/drop policy[^;]*"Users can view their own analyses"/);
  });
});
