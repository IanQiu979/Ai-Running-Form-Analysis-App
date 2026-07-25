/**
 * Structural regression lock for the #130 migration
 * (`supabase/migrations/20260713140000_attach_media_paths.sql`).
 *
 * WHAT THIS SUITE CAN PROVE: the migration's text carries the three load-bearing guards — the
 * namespace guard (a fresh entry point for the bug #8 closed, since this is a NEW writer of
 * `media_paths`), the delivered-only guard, and the write-once guard — and that EXECUTE is
 * service_role-only.
 *
 * WHAT IT CANNOT PROVE: that the SQL is valid Postgres or behaves as written. A local Docker
 * Supabase stack now exists (issue #92, this branch), but this suite is deliberately still a
 * text-level check pending a separate, deliberate follow-up to decide whether to convert it to
 * run against that local stack; until then, behavioral verification happens when whoever
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

// Scopes to the UPDATE's WHERE clause specifically, the same way the neighbouring "never writes
// status, result, is_fallback, or delivered_at" test slices the SET clause. Matching against the
// whole function body (which includes the comment block above the function) would let a comment
// that merely MENTIONS a guard satisfy the assertion even after the guard itself is deleted from
// the WHERE clause — for `deleted_at is null` that gap would hide the exact regression this suite
// exists to catch (an attach into a soft-deleted row silently un-redacting it).
function attachWhereClause(): string {
  const body = attachBody();
  const update = body.slice(body.indexOf('update public.analyses'));
  // Stop at `returning`. The refusal block BELOW the update now re-reads the row to name which
  // guard refused, so it mentions `deleted_at` and `status` itself — slicing to the end of the
  // body would let that lookup satisfy an assertion about the UPDATE's WHERE clause even after the
  // guard had been deleted from the WHERE clause, which is the exact substitution this helper
  // exists to prevent.
  const returningIdx = update.indexOf('returning');
  expect(returningIdx).toBeGreaterThan(-1);
  const statement = update.slice(0, returningIdx);
  return statement.slice(statement.indexOf('where'));
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
    expect(attachWhereClause()).toMatch(/status\s*=\s*'delivered'/);
  });

  it('refuses a soft-deleted row — the redaction trigger only fires on the delete transition', () => {
    expect(attachWhereClause()).toMatch(/and\s+deleted_at\s+is\s+null/);
  });

  it('is write-once: it refuses a row whose media_paths is already populated', () => {
    expect(attachWhereClause()).toMatch(/cardinality\(coalesce\(media_paths,\s*'\{\}'\)\)\s*=\s*0/);
  });

  it('reports a refusal rather than throwing, so the caller can log and move on', () => {
    // Refusals RETURN. `safeAttachFrames` runs after the analysis is already delivered and already
    // charged; a RAISE here would turn a bookkeeping miss into a 500 for a result the user paid for
    // and cannot retry.
    expect(attachBody()).toMatch(/return jsonb_build_object\('ok',\s*false,\s*'reason',/);
    expect(attachBody()).not.toMatch(/\braise\b/i);
  });

  it('names WHICH guard refused — two reasons mean "purge", one means "never touch it"', () => {
    // The four reasons are not cosmetic bookkeeping. They drive OPPOSITE cleanup actions in
    // `flow.ts`'s `safeAttachFrames`:
    //
    //   row_deleted / not_found -> the row is gone, so the frames we just uploaded are orphans
    //                              under an already-purged prefix. PURGE them.
    //   already_attached        -> the paths are recorded on a LIVE row. Purging would destroy a
    //                              working analysis's frame strip. Do NOT touch them.
    //
    // The first draft of this function collapsed all of these into one
    // `not_delivered_or_already_attached`, which makes the correct cleanup impossible to write:
    // the caller cannot tell the case that demands a purge from the case that forbids one.
    const body = attachBody();

    for (const reason of ['not_found', 'row_deleted', 'not_delivered', 'already_attached']) {
      expect(body).toContain(`'reason', '${reason}'`);
    }
    expect(body).not.toContain('not_delivered_or_already_attached');
  });

  it('works out which guard refused AFTER the write, never instead of it', () => {
    // The UPDATE's WHERE clause stays the sole enforcement point — a check-then-write would be
    // racy. The lookup below it only REPORTS which guard the write already refused on.
    const body = attachBody();
    expect(body.indexOf('update public.analyses')).toBeLessThan(body.indexOf("'row_deleted'"));
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
