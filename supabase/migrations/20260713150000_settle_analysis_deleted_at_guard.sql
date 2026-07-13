-- Issue #133 (HIGH, security): settle_analysis had no deleted_at guard — a soft-deleted
-- 'reserved' row got un-redacted, then served back as a 200.
--
-- Found in the code review of #130 (attach_media_paths), pre-existing there, not introduced by
-- that branch. #130 added `and deleted_at is null` to attach_media_paths' WHERE clause for
-- exactly this reason; settle_analysis — one function over, same table, same trigger — never got
-- it. This migration is that same guard, on the function #130 missed.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- THE HOLE, IN SEQUENCE
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
--   1. A row is 'reserved' (an analyze-form invocation is running the model call).
--   2. The user deletes it — DELETE /functions/v1/analysis/:id (#57's deleteAnalysis(), which
--      soft-deletes via markDeleted() with NO status check: `AnalysesTable.markDeleted` matches
--      any not-yet-deleted row regardless of 'reserved'/'delivered'/'released').
--      `analyses_redact_on_soft_delete` fires (20260712040000), nulling `result` and
--      `media_paths` and stamping `deleted_at`.
--   3. The model call returns. settle_analysis, before this migration, matched on
--      `status = 'reserved'` ALONE:
--        where id = p_analysis_id and user_id = p_user_id and status = 'reserved'
--      `deleted_at` being non-null does not stop this UPDATE. It writes the REAL `result`,
--      `media_paths`, and `status = 'delivered'` back onto the row the user just deleted.
--   4. The redaction trigger does NOT re-fire — its WHEN clause only matches the
--      `deleted_at IS NULL -> NOT NULL` transition, and `deleted_at` is already set. The row is
--      now 'delivered', deleted, and carries a live, un-redacted result.
--   5. reserve_analysis's idempotent-replay branch (20260712123606_frame_upload_ordering.sql)
--      returns `result` for any existing (user_id, idempotency_key) row, whatever its
--      `deleted_at`. flow.ts's handleExisting() branches on `status === 'delivered'` and checks
--      `isPaceResult(reserve.result)` to decide 410-vs-200 — and a real, structurally valid
--      result now sits on the deleted row, so `isPaceResult` returns true and the client gets a
--      200 with a deleted analysis's result instead of the 410 the soft-delete contract promises.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- THE FIX — mirrors attach_media_paths' guard 2 byte-for-byte
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- `and deleted_at is null` added to settle_analysis's WHERE clause. A row that left 'reserved'
-- by being soft-deleted can no longer match, so the write in step 3 above can never happen — the
-- un-redaction is prevented at the source rather than patched after the fact. The refusal reason
-- stays the single `not_reserved_or_not_found` string settle_analysis already used for every
-- other "this row is not a live reservation" case (unmatched id, wrong user, already-settled,
-- already-released) — unlike attach_media_paths, settle_analysis's caller (flow.ts) does not
-- branch on WHICH reason a refusal carries, only on `settled.ok` (see CONSEQUENCES below), so
-- splitting the reason into row_deleted/not_found/etc. the way #130 did for attach_media_paths
-- would add surface with no caller that reads it. Kept simple on purpose.
--
-- SIGNATURE UNCHANGED. This is a `create or replace function` on the exact 5-arg signature
-- `settle_analysis(uuid, uuid, jsonb, boolean, text[])` #88 shipped
-- (20260712123606_frame_upload_ordering.sql, already applied to production) — no drop, no
-- overload, same idiom 20260712220000_anti_farm_release_reason_fix.sql used for a body-only
-- change to reserve_analysis. NEW migration, not an edit to 20260712123606, because that file is
-- already applied live (supabase db push) and migrations here are additive-only.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- CONSEQUENCES OF THE GUARD, TRACED THROUGH THE REST OF THE LIFECYCLE
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- With the write in step 3 now refused, the row started as 'reserved' and stays 'reserved' —
-- settle_analysis returns `{ok: false, reason: 'not_reserved_or_not_found'}`.
--
--   * flow.ts (supabase/functions/analyze-form/flow.ts:807-812) already does the right thing with
--     that refusal, unmodified: `if (!settled.ok) { throw ... }`. The throw is caught by
--     runAnalyzeForm's own catch (releaseReason stays/becomes 'internal_error', never a farming
--     signal — see that catch block's own comment), and the `finally` releases the reservation
--     because `reservation && !reservationSettled` is true. `release_analysis`'s WHERE clause
--     (`status = 'reserved'`, no deleted_at check — deliberately NOT mirrored here, see next
--     bullet) still matches this row, so it flips to 'released' and the quota slot is freed. The
--     in-flight caller is never charged for an analysis they deleted mid-run. No flow.ts change
--     needed — this file only had to stop the write that was corrupting the row underneath it.
--
--   * release_analysis intentionally does NOT get this guard. Its job after a refused settle is
--     to free the quota slot regardless of deleted_at — adding `and deleted_at is null` there
--     would make a soft-deleted 'reserved' row unreleasable, stranding it (and the user's quota
--     slot) until sweep_stale_reservations() eventually reclaims it on a timer instead of
--     immediately. release_analysis never writes `result` or `media_paths`, so it carries none of
--     settle_analysis's un-redaction risk — there is nothing here for a deleted_at guard to
--     protect against, only a regression to introduce if one were added.
--
--   * A LATER replay under the same idempotency_key (e.g. a client retry) then finds the row at
--     status = 'released' (not 'delivered'), and flow.ts's handleExisting() already returns 409
--     'previous_attempt_failed' for that status — never a 200, never a delivered result. The row's
--     `result` was never written by the exploit path in the first place (this migration prevented
--     the write, not merely its later replay), so there is no un-redacted payload to leak through
--     this branch either.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- AUDIT OF reserve_analysis's REPLAY BRANCH (issue #133's second ask) — NO CODE CHANGE HERE
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- The issue asks for the replay branch to "return a 410-shaped result for a soft-deleted row
-- rather than the redacted (null) result, so the distinction between 'deleted' and 'delivered but
-- empty' is not lost." Audited against the schema as it exists after the fix above:
--
--   * `result` (jsonb, nullable, no CHECK) is written ONLY by settle_analysis, and ONLY ever with
--     a real, `isPaceResult`-valid value — decideOutcome() never reaches the settle call on a
--     'failed' decision (flow.ts returns before calling settle_analysis in that branch), so a
--     'delivered' row's `result` is either (a) the genuine delivered result, or (b) null because
--     `redact_analyses_on_soft_delete` nulled it on the deleted_at transition. There is no third
--     way for a 'delivered' row to end up with `result = null` in this schema.
--   * With this migration's guard in place, settle_analysis can no longer write (a) onto a row
--     that is already soft-deleted (traced above) — so for any row reserve_analysis's replay
--     branch finds with `status = 'delivered' and result is null`, that null is ALWAYS the
--     redaction, never a race with an in-flight settle. flow.ts's existing check
--     (`!isPaceResult(reserve.result)` -> 410 'analysis_deleted', flow.ts:511-519, covered by the
--     'rule 2' test at flow.deno.test.ts:360) already implements exactly the distinction the issue
--     asks for: "delivered but empty" cannot occur for any reason other than deletion, so treating
--     null-result-on-delivered as 410 is not a heuristic, it is the only remaining case.
--   * reserve_analysis's own return shape (`allowed, existing, id, status, tier, result,
--     is_fallback`) is therefore left UNCHANGED by this migration. Adding an explicit
--     `deleted_at`/`is_deleted` field would be observability sugar only — flow.ts does not read
--     one today (and this migration does not add a caller for it, per the task's explicit "do NOT
--     edit flow.ts" instruction) — and, more importantly, reserve_analysis is NOT this migration's
--     function to redefine: a sibling migration in this same batch
--     (*_reserve_analysis_media_path_guard.sql) independently rewrites reserve_analysis's body.
--     `create or replace function` replaces the WHOLE body, so a second migration also redefining
--     reserve_analysis here would silently collide with that one exactly the way #88's own header
--     comment (20260712123606_frame_upload_ordering.sql) warned about for the #2/#88 overlap —
--     whichever applied last would erase the other's change. Leaving reserve_analysis untouched
--     here avoids re-creating that hazard.
--   * The one state the null-result heuristic does NOT label 410: a row deleted while still
--     'reserved' (traced above) settles at status = 'released', not 'delivered', so flow.ts's
--     existing 'released' branch (409 'previous_attempt_failed') handles the replay instead of the
--     'delivered' branch. This is not a data-exposure gap — `result` was never written for that
--     row — only a coarser message ("a previous attempt failed, start a new one" instead of "this
--     was deleted"). Tightening that message is a UX precision improvement, not a security fix,
--     and is out of this migration's scope; noted for the orchestrator rather than acted on here.

create or replace function public.settle_analysis(
  p_user_id     uuid,
  p_analysis_id uuid,
  p_result      jsonb,
  p_is_fallback boolean default false,
  p_media_paths text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.analyses;
  v_prefix text;
  v_path   text;
begin
  v_prefix := p_user_id::text || '/' || p_analysis_id::text || '/';

  -- Every path must sit under this row's own prefix, and must name a file
  -- inside it (not the bare prefix). Reject the whole call rather than
  -- silently dropping the bad element — a caller passing a foreign path is a
  -- bug or an attack, and swallowing it would hide both. Unchanged from
  -- 20260712123606.
  foreach v_path in array coalesce(p_media_paths, '{}')
  loop
    if v_path is null or position(v_prefix in v_path) <> 1 or length(v_path) <= length(v_prefix) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_media_path');
    end if;
  end loop;

  -- THE FIX: `and deleted_at is null` added below, mirroring attach_media_paths' guard 2
  -- (20260713140000_attach_media_paths.sql). A row soft-deleted while 'reserved' can no longer
  -- match this UPDATE, so this RPC can never write a real result onto a row the redaction trigger
  -- already emptied — the un-redaction described in issue #133 becomes impossible by construction,
  -- the same way #130 closed it for attach_media_paths.
  update public.analyses
  set status = 'delivered',
      result = p_result,
      is_fallback = coalesce(p_is_fallback, false),
      media_paths = coalesce(p_media_paths, '{}'),
      delivered_at = now()
  where id = p_analysis_id
    and user_id = p_user_id
    and status = 'reserved'
    and deleted_at is null
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_reserved_or_not_found');
  end if;

  return jsonb_build_object(
    'ok', true, 'id', v_row.id, 'status', v_row.status,
    'result', v_row.result, 'is_fallback', v_row.is_fallback,
    'media_paths', to_jsonb(v_row.media_paths)
  );
end;
$$;

-- Same signature as 20260712123606 — reissued, not changed, so a fresh `supabase db push` against
-- a project that never saw that migration (or a review diff) still ends with the correct grants.
revoke execute on function public.settle_analysis(uuid, uuid, jsonb, boolean, text[]) from public, anon, authenticated;
grant execute on function public.settle_analysis(uuid, uuid, jsonb, boolean, text[]) to service_role;
