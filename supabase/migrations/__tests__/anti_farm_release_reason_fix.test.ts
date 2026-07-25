/**
 * Regression locks for issue #6 (HIGH, live in production): the free tier's 3-failed-attempt
 * anti-farming cap never reset, and never distinguished a release caused by OUR infrastructure
 * (a model timeout, an Anthropic outage, our own bug) from one caused by genuine abuse (a
 * prompt-injection / deliberate-junk submission that fails structural validation). Three bad
 * days at Anthropic permanently bricked a free account with no recovery path.
 *
 * REVISED after review (same day): the first cut of this fix excluded server-fault reasons but
 * left free's cap lifetime-scoped, reasoning that a confirmed `validation_failed` release was
 * pure abuse. That was wrong — `validation_failed` is an OUTCOME label ("we couldn't produce a
 * valid result"), not an INTENT label, and fires on genuinely hard/honest inputs too (#45's
 * retry+honest-partial fallback, which would reduce but not eliminate that, doesn't exist yet).
 * A lifetime cap on it reopened a narrower version of the same bug: 3 confusing (not malicious)
 * videos could permanently lock out a first-time user who never got a result. The invariant this
 * migration must now satisfy: a user who has never successfully received an analysis must never
 * be PERMANENTLY unable to obtain one — anti-farming may throttle, not permanently deny. Free's
 * anti-farm count is windowed to a rolling 24h (matching what the original spec always said —
 * "3 free retries per period", distinct from the lifetime quota — `planning/02`,
 * `planning/03`, `docs/mvp-build-prompt.md:223`).
 *
 * Same constraint as the other migration test suites in this repo (see
 * analyses_quota_soft_delete.test.ts and supabase/__tests__/frame-upload-ordering.test.ts): a
 * local Docker Supabase stack now exists (issue #92, this branch), but this suite is deliberately
 * still a pgTAP-style text-level check pending a separate, deliberate follow-up to decide whether
 * to convert it to run against that local stack, so this is a TEXT-LEVEL contract on the migration SQL itself — it proves the
 * migration FILE says the right thing, not that Postgres executes it as written. The live
 * behavior (the CHECK constraint actually rejects an unknown reason, the classifier actually
 * returns the right boolean, reserve_analysis actually stops counting a model_error release, the
 * rolling window actually ages a row out) was verified by hand against the live project
 * (vputdomdlknvthnzritt) via `pg_get_functiondef`/`execute_sql` while designing this fix, not by
 * this suite.
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

const FIX_MIGRATION = '20260712220000_anti_farm_release_reason_fix.sql';
const sql = readMigration(FIX_MIGRATION);

describe('issue #6 fix migration exists and is ordered last', () => {
  it('the fix migration file is present', () => {
    expect(migrationFiles()).toContain(FIX_MIGRATION);
  });

  it('sorts after every migration that predates it (forward migration, not a rewrite)', () => {
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
      '20260712123606_frame_upload_ordering.sql',
      '20260712210000_ai_spend_guardrails.sql',
      '20260712210100_ai_spend_guardrail_functions.sql',
    ];
    for (const prior of priorFiles) {
      expect(fixIndex).toBeGreaterThan(files.indexOf(prior));
    }
  });
});

describe('release_reason is pinned to a known, closed vocabulary', () => {
  it('adds a CHECK constraint on public.analyses.release_reason', () => {
    expect(sql).toMatch(/alter table public\.analyses\s+add constraint analyses_release_reason_known_values\s+check/i);
  });

  it('NULL remains allowed (a reason is still optional, not mandatory)', () => {
    const start = sql.indexOf('add constraint analyses_release_reason_known_values');
    const end = sql.indexOf(');', start);
    const body = sql.slice(start, end);
    expect(body).toMatch(/release_reason is null/i);
  });

  it('the exact taxonomy: 3 server-fault reasons excluded from the cap, 1 farming signal counted', () => {
    const start = sql.indexOf('add constraint analyses_release_reason_known_values');
    const end = sql.indexOf(');', start);
    const body = sql.slice(start, end);
    for (const reason of ['model_error', 'provider_timeout', 'internal_error', 'validation_failed']) {
      expect(body).toContain(`'${reason}'`);
    }
  });
});

describe('public.pace_is_farming_signal: the classifier is its own function, not inlined', () => {
  it('is defined as a standalone, immutable SQL function', () => {
    expect(sql).toMatch(
      /create or replace function public\.pace_is_farming_signal\(p_release_reason text\)/i
    );
    const start = sql.indexOf('create or replace function public.pace_is_farming_signal');
    const end = sql.indexOf('$$;', start);
    const body = sql.slice(start, end);
    expect(body).toMatch(/immutable/i);
    expect(body).toMatch(/language sql/i);
  });

  it('classifies only validation_failed as a farming signal', () => {
    const start = sql.indexOf('create or replace function public.pace_is_farming_signal');
    const end = sql.indexOf('$$;', start);
    const body = sql.slice(start, end);
    expect(body).toMatch(/'validation_failed'/);
    // The server-fault reasons must NOT appear inside the classifier body — if one did, it would
    // mean a server-fault release counts toward the cap again, silently reintroducing the bug.
    expect(body).not.toMatch(/'model_error'/);
    expect(body).not.toMatch(/'provider_timeout'/);
    expect(body).not.toMatch(/'internal_error'/);
  });

  it('always returns a real boolean (coalesced), never NULL for an unclassified/NULL reason', () => {
    const start = sql.indexOf('create or replace function public.pace_is_farming_signal');
    const end = sql.indexOf('$$;', start);
    const body = sql.slice(start, end);
    expect(body).toMatch(/coalesce\(/i);
  });

  it('EXECUTE is service_role-only, matching every other quota RPC/helper in this project', () => {
    expect(sql).toContain(
      'revoke execute on function public.pace_is_farming_signal(text) from public, anon, authenticated;'
    );
    expect(sql).toContain('grant execute on function public.pace_is_farming_signal(text) to service_role;');
  });
});

describe('reserve_analysis: signature and every non-counting line preserved verbatim from #88', () => {
  function extractReserveAnalysisBody(source: string): string {
    const start = source.indexOf('create or replace function public.reserve_analysis(');
    const end = source.indexOf('$$;', start);
    return source.slice(start, end);
  }

  it('keeps the exact 4-arg signature #88 landed — no p_media_paths reintroduced, no drop needed', () => {
    const body = extractReserveAnalysisBody(sql);
    expect(body).toMatch(/p_user_id\s+uuid/);
    expect(body).toMatch(/p_idempotency_key\s+text/);
    expect(body).toMatch(/p_media_type\s+public\.media_type/);
    expect(body).toMatch(/p_frame_count\s+integer/);
    expect(body).not.toMatch(/p_media_paths/);
    // No DROP FUNCTION anywhere in this migration — the signature is unchanged, so #88's
    // "drop before recreate" overload hazard does not apply here.
    expect(sql).not.toMatch(/drop function/i);
  });

  it('the insert still lists exactly 4 columns (no media_paths) — #88\'s frame-upload-ordering fix is untouched', () => {
    const body = extractReserveAnalysisBody(sql);
    const insertMatch = body.match(/insert into public\.analyses \(([\s\S]*?)\)/);
    expect(insertMatch).not.toBeNull();
    expect(insertMatch![1]).not.toMatch(/media_paths/);
    expect(insertMatch![1]).toMatch(/user_id/);
    expect(insertMatch![1]).toMatch(/idempotency_key/);
  });

  it('never filters on deleted_at — #2\'s soft-delete counting fix (a soft-deleted row must keep counting) is untouched', () => {
    const body = extractReserveAnalysisBody(sql);
    expect(body).not.toMatch(/deleted_at/i);
  });

  it('preserves the advisory lock, idempotency lookup, tier derivation, and frame-cap gate unchanged', () => {
    const body = extractReserveAnalysisBody(sql);
    expect(body).toMatch(/pg_advisory_xact_lock\(hashtext\(p_user_id::text \|\| ':analysis_reserve'\)\)/);
    expect(body).toMatch(/where user_id = p_user_id and idempotency_key = p_idempotency_key/);
    expect(body).toMatch(/v_limit := case v_tier when 'free' then 1 when 'pro' then 10 when 'elite' then 30 end/);
    expect(body).toMatch(/v_frame_cap := case v_tier when 'free' then 1 when 'pro' then 5 when 'elite' then 8 end/);
    expect(body).toMatch(/frame_cap_exceeded/);
  });

  it('the anti-farming threshold is still 3 — the cap is not deleted, only correctly scoped', () => {
    const body = extractReserveAnalysisBody(sql);
    expect(body).toMatch(/if v_released_count >= 3 then/);
    expect(body).toMatch(/too_many_failed_attempts/);
  });

  it('the quota check (v_active_count >= v_limit) is unchanged and still runs after the anti-farm check', () => {
    const body = extractReserveAnalysisBody(sql);
    const farmIdx = body.indexOf('too_many_failed_attempts');
    const quotaIdx = body.indexOf('quota_exceeded');
    expect(farmIdx).toBeGreaterThan(-1);
    expect(quotaIdx).toBeGreaterThan(-1);
    expect(farmIdx).toBeLessThan(quotaIdx);
  });

  it('the exception handler (unique_violation backstop) is preserved verbatim', () => {
    const body = extractReserveAnalysisBody(sql);
    expect(body).toMatch(/exception\s+when unique_violation then/);
  });

  it('re-grants EXECUTE on the unchanged 4-arg signature to service_role only', () => {
    expect(sql).toContain(
      'revoke execute on function public.reserve_analysis(uuid, text, public.media_type, integer) from public, anon, authenticated;'
    );
    expect(sql).toContain(
      'grant execute on function public.reserve_analysis(uuid, text, public.media_type, integer) to service_role;'
    );
  });
});

describe('reserve_analysis: the actual fix — both counting branches filter by farming signal', () => {
  function extractReserveAnalysisBody(source: string): string {
    const start = source.indexOf('create or replace function public.reserve_analysis(');
    const end = source.indexOf('$$;', start);
    return source.slice(start, end);
  }

  it('free branch: v_released_count is filtered through pace_is_farming_signal', () => {
    const body = extractReserveAnalysisBody(sql);
    const freeBranchStart = body.indexOf("if v_tier = 'free' then");
    const freeBranchEnd = body.indexOf('else', freeBranchStart);
    const freeBranch = body.slice(freeBranchStart, freeBranchEnd);

    expect(freeBranch).toMatch(/status = 'released'/);
    expect(freeBranch).toMatch(/public\.pace_is_farming_signal\(release_reason\)/);
  });

  it('free branch: v_released_count is ALSO windowed to a rolling 24h — this is the actual invariant fix', () => {
    // The residual bug the coordinator caught: excluding server-fault reasons alone still left a
    // LIFETIME cap on validation_failed, which can permanently lock out a legitimate user whose
    // videos are merely hard to read, not abusive. Windowing means that lockout is never
    // permanent — the count ages out on its own.
    const body = extractReserveAnalysisBody(sql);
    const freeBranchStart = body.indexOf("if v_tier = 'free' then");
    const freeBranchEnd = body.indexOf('else', freeBranchStart);
    const freeBranch = body.slice(freeBranchStart, freeBranchEnd);

    const releasedCountMatch = freeBranch.match(
      /select count\(\*\) into v_released_count[\s\S]*?;/
    );
    expect(releasedCountMatch).not.toBeNull();
    expect(releasedCountMatch![0]).toMatch(/released_at\s*>\s*now\(\)\s*-\s*interval\s*'24 hours'/i);
  });

  it('free branch: v_active_count (the quota count) is untouched — still lifetime, still no reason filter', () => {
    const body = extractReserveAnalysisBody(sql);
    const freeBranchStart = body.indexOf("if v_tier = 'free' then");
    const freeBranchEnd = body.indexOf('else', freeBranchStart);
    const freeBranch = body.slice(freeBranchStart, freeBranchEnd);
    const activeCountMatch = freeBranch.match(
      /select count\(\*\) into v_active_count[\s\S]*?status in \('reserved', 'delivered'\);/
    );
    expect(activeCountMatch).not.toBeNull();
    // The active-count query must NOT gain the farming-signal filter — that filter only applies
    // to the released-row anti-farm count, never to what counts as "used quota".
    expect(activeCountMatch![0]).not.toMatch(/pace_is_farming_signal/);
  });

  it('pro/elite branch: v_released_count keeps its period window AND gains the farming-signal filter', () => {
    const body = extractReserveAnalysisBody(sql);
    const elseBranchStart = body.indexOf('else', body.indexOf("if v_tier = 'free' then"));
    const elseBranchEnd = body.indexOf('end if;', elseBranchStart);
    const elseBranch = body.slice(elseBranchStart, elseBranchEnd);

    expect(elseBranch).toMatch(/status = 'released'/);
    expect(elseBranch).toMatch(/created_at <@ v_window/);
    expect(elseBranch).toMatch(/public\.pace_is_farming_signal\(release_reason\)/);
  });

  it('pro/elite branch: v_active_count keeps its period window, no reason filter added there', () => {
    const body = extractReserveAnalysisBody(sql);
    const elseBranchStart = body.indexOf('else', body.indexOf("if v_tier = 'free' then"));
    const elseBranchEnd = body.indexOf('end if;', elseBranchStart);
    const elseBranch = body.slice(elseBranchStart, elseBranchEnd);
    const activeCountMatch = elseBranch.match(
      /select count\(\*\) into v_active_count[\s\S]*?created_at <@ v_window;/
    );
    expect(activeCountMatch).not.toBeNull();
    expect(activeCountMatch![0]).not.toMatch(/pace_is_farming_signal/);
  });
});

describe('the invariant: a first-time user can never be PERMANENTLY denied their first result', () => {
  function extractReserveAnalysisBody(source: string): string {
    const start = source.indexOf('create or replace function public.reserve_analysis(');
    const end = source.indexOf('$$;', start);
    return source.slice(start, end);
  }

  it('free branch anchors its window on released_at (recency of the strike), not created_at (reservation time)', () => {
    const body = extractReserveAnalysisBody(sql);
    const freeBranchStart = body.indexOf("if v_tier = 'free' then");
    const freeBranchEnd = body.indexOf('else', freeBranchStart);
    const freeBranch = body.slice(freeBranchStart, freeBranchEnd);
    const releasedCountMatch = freeBranch.match(/select count\(\*\) into v_released_count[\s\S]*?;/);
    expect(releasedCountMatch).not.toBeNull();
    expect(releasedCountMatch![0]).not.toMatch(/created_at/);
  });

  it('pro/elite branch is NOT shrunk to 24h — its existing period window is left as-is, only gains the reason filter', () => {
    const body = extractReserveAnalysisBody(sql);
    const elseBranchStart = body.indexOf('else', body.indexOf("if v_tier = 'free' then"));
    const elseBranchEnd = body.indexOf('end if;', elseBranchStart);
    const elseBranch = body.slice(elseBranchStart, elseBranchEnd);
    expect(elseBranch).not.toMatch(/interval\s*'24 hours'/i);
  });

  it("the migration documents the invariant explicitly, so a future edit can't silently drop it", () => {
    expect(sql).toMatch(/PERMANENTLY/);
    expect(sql).toMatch(/invariant/i);
  });

  it('the header explicitly retracts the superseded lifetime-cap reasoning rather than leaving it uncorrected', () => {
    expect(sql).toMatch(/REVISED after review/i);
    expect(sql).toMatch(/That reasoning was wrong/i);
  });
});

describe('settle_analysis and release_analysis themselves are untouched by this migration', () => {
  it('this migration never redefines settle_analysis', () => {
    expect(sql).not.toMatch(/create (or replace )?function public\.settle_analysis/i);
  });

  it('this migration never redefines release_analysis — the fix lives entirely in the constraint, the classifier, and reserve_analysis\'s counting queries', () => {
    expect(sql).not.toMatch(/create (or replace )?function public\.release_analysis/i);
  });
});

describe('no data backfill statement — the live table has 0 rows, verified explicitly in the header', () => {
  it('ships no UPDATE against public.analyses (nothing to repair)', () => {
    expect(sql).not.toMatch(/update public\.analyses\s+set/i);
  });

  it('documents the live verification (0 analyses, 2 profiles) rather than silently omitting it', () => {
    expect(sql).toMatch(/0 analyses/);
    expect(sql).toMatch(/2/);
  });
});
