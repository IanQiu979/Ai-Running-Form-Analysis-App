/**
 * Regression locks for issue #8 (reserve_analysis accepts arbitrary p_media_paths with no
 * ownership check).
 *
 * READ THIS FIRST — this suite does NOT do what the issue's literal text asked for, and that is
 * deliberate. Issue #8 (and the task that produced this file) was written against the ORIGINAL
 * 5-arg `reserve_analysis` (20260711150400_quota_reserve_settle_release.sql), which inserted
 * `p_media_paths` verbatim with no check that each path lived under `{user_id}/`. That hole was
 * real for the 5-arg signature. But #88 (20260712123606_frame_upload_ordering.sql, merged
 * 2026-07-12) restructured the reserve/settle lifecycle for an independent reason and, as a
 * necessary consequence, DROPPED `p_media_paths` from `reserve_analysis` entirely — not merely
 * guarded it. #88's own migration comment says so directly: "The guard [in settle_analysis] is
 * what permanently closes #8." #130 (20260713140000_attach_media_paths.sql) added a second
 * writer, attach_media_paths, carrying the byte-for-byte identical guard.
 *
 * Verified live against this project's database (vputdomdlknvthnzritt), read-only, 2026-07-13:
 * `reserve_analysis`'s live signature is exactly the 4-arg one with no p_media_paths, and
 * `public.analyses` has zero rows (see 20260713151000's own header for the queries run).
 *
 * So re-adding a guarded `p_media_paths` parameter to `reserve_analysis` — the literal shape the
 * issue and the originating task asked for — would not be a fix. It would (a) reopen the
 * pre-#88 bug #88 exists to close, and (b) create a second, ambiguous overload that breaks the
 * live analyze-form flow (supabase/functions/analyze-form/flow.ts calls reserve_analysis with
 * exactly 4 named arguments; PostgREST would refuse to resolve that call once a 5-arg overload
 * with a defaulted 5th argument also matched it — see the fix migration's header for the exact
 * mechanism). This suite instead locks in: (1) that the 4-arg, no-media-paths signature is what
 * the full migration sequence actually produces and that this fix migration does not reintroduce
 * p_media_paths to reserve_analysis, and (2) that the fix migration adds a table-level CHECK
 * constraint — a backstop that applies to every writer of media_paths, present and future,
 * rather than a guard that only protects call sites that remember to carry it.
 *
 * WHAT THIS SUITE CANNOT PROVE (same limitation as every other migration test in this directory —
 * no pgTAP, no local Postgres, no Docker in this sandbox, and issue #92 means there is no
 * non-production Supabase project to apply a real migration against):
 *   - That Postgres actually accepts `plpgsql ... immutable` for pace_media_paths_within_namespace
 *     or that the CHECK constraint's function call resolves and evaluates the way this file
 *     assumes — only that the SQL text has the shape that should produce that behavior.
 *   - That the CHECK constraint actually rejects a bad INSERT/UPDATE at runtime, or that FOREACH
 *     over a text[] compiles as written — that was checked by hand by ensuring the loop body
 *     is byte-identical to settle_analysis's/attach_media_paths's own guard (which the project
 *     already treats as correct and live-equivalent for two functions), not by executing it here.
 *   - Anything about migrations from the other agents running in parallel on sibling branches
 *     (`*_settle_analysis_deleted_at_guard.sql`, `*_storage_user_budget.sql`,
 *     `*_grant_hardening.sql`) — those files do not exist on this branch/worktree to read from.
 *   - That PostgREST's overload-resolution behavior described above is exactly what would happen
 *     in production — that claim is based on documented Postgres/PostgREST function-resolution
 *     semantics, not a live reproduction, since reproducing it would require actually creating
 *     the harmful overload against a real database.
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

const ORIGINAL_RPC_MIGRATION = '20260711150400_quota_reserve_settle_release.sql';
const FRAME_UPLOAD_ORDERING = '20260712123606_frame_upload_ordering.sql';
const ANTI_FARM_FIX = '20260712220000_anti_farm_release_reason_fix.sql';
const ATTACH_MEDIA_PATHS = '20260713140000_attach_media_paths.sql';
const FIX_MIGRATION = '20260713151000_reserve_analysis_media_path_guard.sql';

const NAMESPACE_GUARD_PREFIX_LINE =
  "v_prefix := p_user_id::text || '/' || p_analysis_id::text || '/';";
const NAMESPACE_GUARD_CONDITION =
  'if v_path is null or position(v_prefix in v_path) <> 1 or length(v_path) <= length(v_prefix) then';

describe('fix migration exists and is ordered after everything it depends on', () => {
  it('the fix migration file is present', () => {
    expect(migrationFiles()).toContain(FIX_MIGRATION);
  });

  it('sorts after the original RPC migration, #88, and #130', () => {
    const files = migrationFiles();
    const fixIndex = files.indexOf(FIX_MIGRATION);
    for (const prior of [
      ORIGINAL_RPC_MIGRATION,
      FRAME_UPLOAD_ORDERING,
      ANTI_FARM_FIX,
      ATTACH_MEDIA_PATHS,
    ]) {
      expect(fixIndex).toBeGreaterThan(files.indexOf(prior));
    }
  });
});

describe('premise check: reserve_analysis no longer accepts p_media_paths anywhere in the sequence', () => {
  // A minimal simulator: scan every migration touching public.reserve_analysis's CREATE OR
  // REPLACE, in chronological order, and keep only the LAST parameter list seen — that is the
  // signature the full migration sequence actually produces, mirroring how `create or replace`
  // behaves live (each redefinition fully replaces the previous body/signature, since #88 also
  // explicitly `drop function`-ed the old 5-arg overload rather than letting it coexist).
  function finalReserveAnalysisParamList(): string {
    let params = '';
    const defRe =
      /create or replace function public\.reserve_analysis\s*\(([\s\S]*?)\)\s*returns/gi;
    for (const file of migrationFiles()) {
      const sql = readMigration(file);
      for (const m of sql.matchAll(defRe)) {
        params = m[1];
      }
    }
    return params;
  }

  it('the original migration DID define the vulnerable 5-arg signature (sanity check on the simulator itself)', () => {
    const sql = readMigration(ORIGINAL_RPC_MIGRATION);
    expect(sql).toMatch(/create or replace function public\.reserve_analysis\(/i);
    expect(sql).toMatch(/p_media_paths\s+text\[\]\s+default\s+'\{\}'/i);
  });

  it('#88 drops the old 5-arg overload explicitly, not just replaces it', () => {
    const sql = readMigration(FRAME_UPLOAD_ORDERING);
    expect(sql).toMatch(
      /drop function if exists public\.reserve_analysis\(uuid, text, public\.media_type, integer, text\[\]\)/i
    );
  });

  it('the FINAL reserve_analysis signature across the whole migration sequence has no p_media_paths', () => {
    const finalParams = finalReserveAnalysisParamList();
    expect(finalParams).not.toMatch(/p_media_paths/i);
    // And it is exactly the 4 arguments flow.ts's call site depends on.
    expect(finalParams).toMatch(/p_user_id\s+uuid/i);
    expect(finalParams).toMatch(/p_idempotency_key\s+text/i);
    expect(finalParams).toMatch(/p_media_type\s+public\.media_type/i);
    expect(finalParams).toMatch(/p_frame_count\s+integer/i);
  });

  it('this fix migration does not redefine reserve_analysis at all (the tripwire: no future edit of this file may add p_media_paths back)', () => {
    const sql = readMigration(FIX_MIGRATION);
    expect(sql).not.toMatch(/create (or replace )?function public\.reserve_analysis/i);
    expect(sql).not.toMatch(/drop function if exists public\.reserve_analysis/i);
  });

  it("analyze-form's actual call site passes exactly 4 named arguments to reserve_analysis, matching the live signature", () => {
    const flowSql = readFileSync(
      join(MIGRATIONS_DIR, '..', 'functions', 'analyze-form', 'flow.ts'),
      'utf8'
    );
    const callMatch = flowSql.match(
      /rpc\.rpc\('reserve_analysis',\s*\{([\s\S]*?)\}\s*\)/
    );
    expect(callMatch).not.toBeNull();
    const callArgs = callMatch![1];
    for (const arg of ['p_user_id', 'p_idempotency_key', 'p_media_type', 'p_frame_count']) {
      expect(callArgs).toMatch(new RegExp(`${arg}\\s*:`));
    }
    // Checks for an actual `p_media_paths:` key, not the explanatory comment mentioning the
    // name (flow.ts deliberately documents *why* it's absent — see the comment right there).
    expect(callArgs).not.toMatch(/p_media_paths\s*:/);
  });
});

describe("the two actual writers of media_paths (settle_analysis, attach_media_paths) already carry the guard #8 asked for", () => {
  it('settle_analysis (#88) carries the namespace guard', () => {
    const sql = readMigration(FRAME_UPLOAD_ORDERING);
    expect(sql).toContain(NAMESPACE_GUARD_PREFIX_LINE);
    expect(sql).toContain(NAMESPACE_GUARD_CONDITION);
  });

  it('attach_media_paths (#130) carries the byte-identical guard', () => {
    const sql = readMigration(ATTACH_MEDIA_PATHS);
    expect(sql).toContain(NAMESPACE_GUARD_PREFIX_LINE);
    expect(sql).toContain(NAMESPACE_GUARD_CONDITION);
  });
});

describe('fix migration: adds a table-level backstop covering every writer, present and future', () => {
  const sql = readMigration(FIX_MIGRATION);

  it('defines pace_media_paths_within_namespace as immutable plpgsql with a pinned search_path', () => {
    const fnMatch = sql.match(
      /create or replace function public\.pace_media_paths_within_namespace[\s\S]*?\$\$;/i
    );
    expect(fnMatch).not.toBeNull();
    const fnText = fnMatch![0];
    expect(fnText).toMatch(/language plpgsql/i);
    expect(fnText).toMatch(/immutable/i);
    expect(fnText).toMatch(/set search_path = public/i);
  });

  it("the helper's guard logic is byte-identical to settle_analysis's/attach_media_paths's own guard — no drift between the three", () => {
    expect(sql).toContain(NAMESPACE_GUARD_PREFIX_LINE);
    expect(sql).toContain(NAMESPACE_GUARD_CONDITION);
  });

  it('an empty or null media_paths is explicitly allowed (matches every current row and the default column value)', () => {
    const fnMatch = sql.match(
      /create or replace function public\.pace_media_paths_within_namespace[\s\S]*?\$\$;/i
    );
    const fnText = fnMatch![0];
    expect(fnText).toMatch(
      /if p_media_paths is null or cardinality\(p_media_paths\) = 0 then\s*\n\s*return true;/i
    );
  });

  it('EXECUTE is revoked from client-facing roles and granted only to service_role, matching every sibling pace_* helper', () => {
    expect(sql).toMatch(
      /revoke execute on function public\.pace_media_paths_within_namespace\(uuid, uuid, text\[\]\) from public,\s*anon,\s*authenticated/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.pace_media_paths_within_namespace\(uuid, uuid, text\[\]\) to service_role/i
    );
  });

  it('adds a CHECK constraint on public.analyses wired to the helper with the row\'s own user_id/id/media_paths', () => {
    expect(sql).toMatch(/alter table public\.analyses/i);
    expect(sql).toMatch(/add constraint analyses_media_paths_within_owner_namespace/i);
    expect(sql).toMatch(
      /check\s*\(\s*public\.pace_media_paths_within_namespace\(user_id,\s*id,\s*media_paths\)\s*\)/i
    );
  });
});

describe('sanity: this fix migration never widens access, only adds a restriction', () => {
  it('contains no GRANT of INSERT/UPDATE/DELETE on public.analyses to a client-facing role', () => {
    const sql = readMigration(FIX_MIGRATION);
    expect(sql).not.toMatch(
      /grant\s+(all|insert|update|delete)[^;]*on public\.analyses to (authenticated|anon)/i
    );
  });

  it('contains no policy change on public.analyses or storage.objects', () => {
    const sql = readMigration(FIX_MIGRATION);
    expect(sql).not.toMatch(/create policy|drop policy/i);
  });
});
