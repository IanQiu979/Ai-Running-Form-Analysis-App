/**
 * Regression locks for issue #133 (HIGH, security): `settle_analysis` had no `deleted_at` guard —
 * a 'reserved' row soft-deleted mid-run got un-redacted when the model call finally returned, and
 * `reserve_analysis`'s idempotent-replay branch then served that un-redacted result back as a 200
 * instead of the 410 the soft-delete contract promises. Found in the code review of #130, which
 * added the identical guard to `attach_media_paths` but missed `settle_analysis` — same table,
 * same trigger, one function over.
 *
 * Same constraint as every other migration test suite in this repo (see
 * analyses_quota_soft_delete.test.ts and anti_farm_release_reason_fix.test.ts): no pgTAP or local
 * Postgres is available here (no Docker in this sandbox, and issue #92 means there is no
 * non-production Supabase project to apply a real migration against). So this suite is a
 * TEXT-LEVEL contract on the migration SQL itself — it proves the migration FILE says the right
 * thing, not that Postgres executes it as written. Treat it as a tripwire against regressing the
 * fix in a later migration, not as proof the guard behaves correctly live.
 *
 * WHAT THIS SUITE CANNOT PROVE:
 *   - That Postgres actually refuses the UPDATE for a soft-deleted row at runtime (only that the
 *     WHERE clause text contains the guard).
 *   - That `reserve_analysis`'s replay branch, `release_analysis`, or `flow.ts`'s `handleExisting`
 *     behave correctly end-to-end against a live database — that was reasoned through by hand
 *     against the actual schema and RPC bodies while designing this fix (see this migration's own
 *     header comment), not verified by executing SQL here.
 *   - Anything about a sibling migration in this same batch
 *     (`*_reserve_analysis_media_path_guard.sql`) that independently rewrites `reserve_analysis` —
 *     it does not exist in this worktree to read from, so the "this migration must not also
 *     redefine `reserve_analysis`" tests below only check THIS file's own text, not the merged
 *     result of both branches.
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

const FIX_MIGRATION = '20260713150000_settle_analysis_deleted_at_guard.sql';
const FRAME_UPLOAD_ORDERING_MIGRATION = '20260712123606_frame_upload_ordering.sql';
const ATTACH_MEDIA_PATHS_MIGRATION = '20260713140000_attach_media_paths.sql';

function extractFunctionBody(source: string, name: string): string {
  const start = source.indexOf(`create or replace function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('$$;', start);
  return source.slice(start, end);
}

describe('issue #133 fix migration exists and is ordered last', () => {
  it('the fix migration file is present', () => {
    expect(migrationFiles()).toContain(FIX_MIGRATION);
  });

  it('sorts after every migration that predates it (a NEW migration, not a rewrite of 20260712123606 — that one is already applied to production)', () => {
    const files = migrationFiles();
    const fixIndex = files.indexOf(FIX_MIGRATION);
    const priorFiles = [
      '20260711150000_profiles.sql',
      '20260711150100_subscriptions.sql',
      '20260711150200_analyses.sql',
      '20260711150300_quota_period_helpers.sql',
      '20260711150400_quota_reserve_settle_release.sql',
      '20260711150500_media_storage_bucket.sql',
      '20260711150600_rls_initplan_fix.sql',
      '20260712020729_consents.sql',
      '20260712030617_consents_grant_hardening.sql',
      '20260712040000_analyses_quota_soft_delete.sql',
      FRAME_UPLOAD_ORDERING_MIGRATION,
      '20260712210000_ai_spend_guardrails.sql',
      '20260712210100_ai_spend_guardrail_functions.sql',
      '20260712220000_anti_farm_release_reason_fix.sql',
      '20260712230000_analyses_client_delete_removed.sql',
      '20260712233000_quota_status_function.sql',
      '20260713120000_purchase_tier_function.sql',
      '20260713130000_stale_reservation_sweep.sql',
      ATTACH_MEDIA_PATHS_MIGRATION,
    ];
    for (const prior of priorFiles) {
      expect(fixIndex).toBeGreaterThan(files.indexOf(prior));
    }
  });

  it('does not itself redefine 20260712123606 in place — it is additive (that migration is already live in production)', () => {
    // Nothing enforces this at the filesystem level beyond "this is a new file with a new
    // timestamp", but the point of a NEW migration is that the old file's text is left alone.
    const original = readMigration(FRAME_UPLOAD_ORDERING_MIGRATION);
    expect(original).toMatch(/where id = p_analysis_id and user_id = p_user_id and status = 'reserved'\s*\n\s*returning \* into v_row;/);
    expect(original).not.toMatch(/deleted_at is null/i);
  });
});

describe('settle_analysis: the actual fix — the WHERE clause gains the deleted_at guard', () => {
  const sql = readMigration(FIX_MIGRATION);

  it('redefines settle_analysis', () => {
    expect(sql).toMatch(/create or replace function public\.settle_analysis\(/i);
  });

  it('the UPDATE matches only a still-reserved, NOT-deleted row', () => {
    const body = extractFunctionBody(sql, 'settle_analysis');
    const updateMatch = body.match(/update public\.analyses\s+set[\s\S]*?where([\s\S]*?)returning/i);
    expect(updateMatch).not.toBeNull();
    const whereClause = updateMatch![1];
    expect(whereClause).toMatch(/id = p_analysis_id/);
    expect(whereClause).toMatch(/user_id = p_user_id/);
    expect(whereClause).toMatch(/status = 'reserved'/);
    // THE FIX. Without this, a row soft-deleted while 'reserved' still matches and gets its
    // result/media_paths/status written — the exact un-redaction issue #133 describes.
    expect(whereClause).toMatch(/deleted_at is null/i);
  });

  it('mirrors attach_media_paths\' identical guard, not a different spelling of it', () => {
    const attachSql = readMigration(ATTACH_MEDIA_PATHS_MIGRATION);
    const attachBody = extractFunctionBody(attachSql, 'attach_media_paths');
    const attachUpdateMatch = attachBody.match(/update public\.analyses\s+set[\s\S]*?where([\s\S]*?)returning/i);
    expect(attachUpdateMatch).not.toBeNull();
    const attachWhereClause = attachUpdateMatch![1];
    expect(attachWhereClause).toMatch(/deleted_at is null/i);

    // Both WHERE clauses express the same predicate shape: an equality on id, an equality on
    // user_id, and a `deleted_at is null` check. This does not assert byte-identical text (the two
    // functions have different status predicates — attach_media_paths matches 'delivered',
    // settle_analysis matches 'reserved') but does assert neither WHERE clause was spelled as
    // `deleted_at is not null` (inverted) or `deleted_at is distinct from ...` (a different,
    // easy-to-typo predicate). Scoped to the WHERE clause specifically, not the whole function body
    // — attach_media_paths' post-refusal diagnostic branch legitimately reads
    // `v_row.deleted_at is not null` to classify WHY the write refused, which is unrelated to the
    // enforcement guard itself.
    const settleBody = extractFunctionBody(readMigration(FIX_MIGRATION), 'settle_analysis');
    const settleUpdateMatch = settleBody.match(/update public\.analyses\s+set[\s\S]*?where([\s\S]*?)returning/i);
    expect(settleUpdateMatch).not.toBeNull();
    expect(settleUpdateMatch![1]).not.toMatch(/deleted_at is not null/i);
    expect(attachWhereClause).not.toMatch(/deleted_at is not null/i);
  });
});

describe('settle_analysis: signature and every other line preserved verbatim from #88 (20260712123606)', () => {
  const sql = readMigration(FIX_MIGRATION);
  const body = extractFunctionBody(sql, 'settle_analysis');

  it('keeps the exact 5-arg signature #88 landed — p_media_paths still defaults to \'{}\'', () => {
    expect(body).toMatch(/p_user_id\s+uuid/);
    expect(body).toMatch(/p_analysis_id\s+uuid/);
    expect(body).toMatch(/p_result\s+jsonb/);
    expect(body).toMatch(/p_is_fallback\s+boolean\s+default\s+false/);
    expect(body).toMatch(/p_media_paths\s+text\[\]\s+default\s+'\{\}'/);
    // No DROP FUNCTION anywhere in this migration — the signature is unchanged, so #88's own
    // "drop before recreate" overload hazard (its header comment, section 1) does not apply here.
    expect(sql).not.toMatch(/drop function/i);
  });

  it('preserves the namespace guard (every media path must sit under this row\'s own prefix) unchanged', () => {
    expect(body).toMatch(/v_prefix := p_user_id::text \|\| '\/' \|\| p_analysis_id::text \|\| '\/'/);
    expect(body).toMatch(/foreach v_path in array coalesce\(p_media_paths, '\{\}'\)/);
    expect(body).toMatch(/invalid_media_path/);
  });

  it('the UPDATE still sets status, result, is_fallback, media_paths, and delivered_at', () => {
    const updateMatch = body.match(/update public\.analyses\s+set([\s\S]*?)where/i);
    expect(updateMatch).not.toBeNull();
    const setClause = updateMatch![1];
    expect(setClause).toMatch(/status = 'delivered'/);
    expect(setClause).toMatch(/result = p_result/);
    expect(setClause).toMatch(/is_fallback = coalesce\(p_is_fallback, false\)/);
    expect(setClause).toMatch(/media_paths = coalesce\(p_media_paths, '\{\}'\)/);
    expect(setClause).toMatch(/delivered_at = now\(\)/);
  });

  it('the refusal reason stays the single not_reserved_or_not_found string — flow.ts branches on `ok`, not on which reason, so no reason-splitting was introduced', () => {
    expect(body).toMatch(/not_reserved_or_not_found/);
    // Unlike attach_media_paths (which splits into not_found/row_deleted/not_delivered/
    // already_attached because its caller must decide whether to purge Storage), settle_analysis
    // has no caller that reads the reason string beyond truthiness — see flow.ts:807-812. Splitting
    // it here would be unused surface, not a fix.
    expect(body).not.toMatch(/row_deleted/);
    expect(body).not.toMatch(/already_attached/);
  });

  it('the success response still returns id, status, result, is_fallback, media_paths', () => {
    const returnMatch = body.match(/return jsonb_build_object\(\s*'ok', true[\s\S]*?\);/);
    expect(returnMatch).not.toBeNull();
    expect(returnMatch![0]).toMatch(/'id', v_row\.id/);
    expect(returnMatch![0]).toMatch(/'status', v_row\.status/);
    expect(returnMatch![0]).toMatch(/'result', v_row\.result/);
    expect(returnMatch![0]).toMatch(/'is_fallback', v_row\.is_fallback/);
    expect(returnMatch![0]).toMatch(/'media_paths', to_jsonb\(v_row\.media_paths\)/);
  });

  it('re-grants EXECUTE on the unchanged 5-arg signature to service_role only', () => {
    expect(sql).toContain(
      'revoke execute on function public.settle_analysis(uuid, uuid, jsonb, boolean, text[]) from public, anon, authenticated;'
    );
    expect(sql).toContain(
      'grant execute on function public.settle_analysis(uuid, uuid, jsonb, boolean, text[]) to service_role;'
    );
  });
});

describe('release_analysis and reserve_analysis are deliberately untouched by this migration', () => {
  const sql = readMigration(FIX_MIGRATION);

  it('this migration never redefines release_analysis — it must keep releasing a deleted "reserved" row so the quota slot is freed, not stranded', () => {
    expect(sql).not.toMatch(/create (or replace )?function public\.release_analysis/i);
  });

  it('this migration never redefines reserve_analysis — a sibling migration in this batch (*_reserve_analysis_media_path_guard.sql) independently rewrites it, and `create or replace function` replaces the whole body, so two migrations both redefining it would silently collide (the #2/#88 hazard #88\'s own header warned about)', () => {
    expect(sql).not.toMatch(/create (or replace )?function public\.reserve_analysis/i);
  });

  it('documents why release_analysis is NOT guarded by deleted_at, so a future edit does not "fix" it into stranding quota slots', () => {
    expect(sql).toMatch(/release_analysis intentionally does NOT get this guard/i);
  });
});

describe('the invariant this migration establishes: a delivered row\'s result is null if and only if it was soft-deleted', () => {
  const sql = readMigration(FIX_MIGRATION);

  it('the header traces the full lifecycle: refused settle -> release_analysis frees the slot -> replay sees status=released, never a leaked result', () => {
    expect(sql).toMatch(/release_analysis/);
    expect(sql).toMatch(/not_reserved_or_not_found/);
    expect(sql).toMatch(/previous_attempt_failed/i);
  });

  it('documents the audit of reserve_analysis\'s replay branch (issue #133\'s second ask) without editing flow.ts or reserve_analysis', () => {
    expect(sql).toMatch(/AUDIT OF reserve_analysis/i);
    expect(sql).toMatch(/NO CODE CHANGE HERE/i);
    expect(sql).not.toMatch(/create (or replace )?function public\.reserve_analysis/i);
  });
});

describe('no data backfill statement — this is a pure function-body fix, nothing to repair on existing rows', () => {
  const sql = readMigration(FIX_MIGRATION);

  it('the only "update public.analyses" statement in the file is the one inside settle_analysis\'s own body — no standalone backfill UPDATE runs at migration time', () => {
    // A raw top-level UPDATE would run once, immediately, against every existing row. This
    // migration must ship none — the fix is entirely in the function definition, which only takes
    // effect on the next call. Checked by counting occurrences: settle_analysis's body legitimately
    // contains exactly one (the RPC's own UPDATE, unindented by any surrounding DO/BEGIN block), so
    // more than one, or one appearing outside a `create or replace function` body, would indicate an
    // unintended extra statement.
    const matches = sql.match(/update public\.analyses\b/gi) ?? [];
    expect(matches).toHaveLength(1);

    const idx = sql.search(/update public\.analyses\b/i);
    const functionStart = sql.indexOf('create or replace function public.settle_analysis(');
    const functionEnd = sql.indexOf('$$;', functionStart);
    expect(idx).toBeGreaterThan(functionStart);
    expect(idx).toBeLessThan(functionEnd);
  });
});
