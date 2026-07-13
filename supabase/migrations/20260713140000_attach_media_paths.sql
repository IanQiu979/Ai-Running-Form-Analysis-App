-- Issue #130 (M4): attach_media_paths — the half of the settle that runs AFTER the frames land.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHY THIS FUNCTION EXISTS: THE INVARIANT
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
--   A 'reserved' row can never have frames.
--
-- `analyze-form` used to upload the frames and THEN call settle_analysis with their paths. That
-- ordering created orphans in TWO ways, one of which #130 did not even describe:
--
--   1. THE CRASH (what #47/#130 are about). The isolate is killed (wall-clock, OOM, a deploy)
--      between the upload and the settle. The row stays 'reserved' and the frames sit in the
--      bucket with nothing pointing at them. `sweep_stale_reservations()` reclaims the row — but
--      it is SQL, it cannot call Storage's HTTP API, so the frames leak permanently.
--
--   2. THE REFUSED SETTLE (no crash required, and the reason a purge bolted onto the sweep would
--      NOT have been enough). settle_analysis returns `not_reserved_or_not_found` whenever the row
--      has already left 'reserved' — a concurrent duplicate, a late replay. By then the frames are
--      ALREADY uploaded. flow.ts throws, the `finally` calls release_analysis, and the released row
--      never names them. That row is never touched by the sweep, so no sweep-side purge could ever
--      reach those objects.
--
-- Inverting the order kills both by construction. settle_analysis now runs FIRST, with no paths
-- (its p_media_paths already defaults to '{}'). Only once the row is 'delivered' do the frames go
-- up — and then THIS function records where they went. Now:
--
--   * killed before the settle -> 'reserved' row, ZERO frames uploaded. The sweep reclaims the row
--     and has nothing to purge. This is why sweep_stale_reservations() needs no Storage access, no
--     pg_net, no Vault secret, and no scheduled edge function — see that migration's Design
--     Decision 5.
--   * settle refuses           -> released row, ZERO frames uploaded. Case 2 above cannot happen.
--   * killed mid-upload        -> 'delivered' row whose frames sit under its OWN prefix, where
--     deletion (DELETE /analysis/:id #57, delete-account #58) finds them anyway — purge walks the
--     PREFIX, never `media_paths`.
--
-- THE PRICE, stated rather than hidden: a 'delivered' row can now carry an empty or short
-- `media_paths`. That shortens the Past Analyses frame strip (#55) for that one analysis and does
-- nothing else. `media_paths` has always been the DISPLAY list, never the deletion authority
-- (flow.ts's own uploadFrames header), so nothing downstream is weakened by it being incomplete.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- THE THREE GUARDS, all load-bearing
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
--   1. THE NAMESPACE GUARD, byte-for-byte the one settle_analysis carries
--      (20260712123606_frame_upload_ordering.sql). This is NOT belt-and-braces: this function is a
--      SECOND writer of `media_paths`, i.e. a brand-new entry point for exactly the bug #8 closed.
--      Without the guard, a compromised or buggy edge function could point one user's analyses row
--      at another user's frames — through here, even though settle_analysis is airtight. A foreign
--      path rejects the WHOLE call; it is never silently dropped, because a caller passing one is a
--      bug or an attack and swallowing it would hide both.
--
--   2. status = 'delivered' AND deleted_at is null. Paths cannot be attached to a 'reserved' row
--      (that would violate the invariant this whole file exists to establish) nor to a
--      'released' one (that would name frames on a row the sweep just reclaimed). The
--      `deleted_at is null` half exists because a soft-deleted row can otherwise still match
--      every other condition here: markDeleted only sets `deleted_at` (status stays 'delivered'
--      by design, so quota keeps counting the row), and redact_analyses_on_soft_delete
--      (20260712040000_analyses_quota_soft_delete.sql) has already wiped media_paths back to
--      '{}' on that same transition — which re-arms guard 3's write-once check instead of
--      blocking it. That trigger only fires on the null -> non-null deleted_at transition, so it
--      will NOT re-fire if this function writes media_paths afterward; refusing here is the only
--      thing standing between a user's delete and this RPC silently un-redacting the row with
--      live pointers into the private frame bucket.
--
--   3. WRITE-ONCE (cardinality(media_paths) = 0). A replay or a second call cannot rewrite the
--      display list of an already-complete analysis. Deliberate consequence: a partial upload can
--      never be repaired by a later retry. Accepted — the strip is cosmetic, and the simpler rule
--      is the safer one.
--
-- Refusals RETURN, they never raise: the caller (flow.ts's safeAttachFrames) is running after the
-- analysis is already delivered and already charged, and must never be able to turn a bookkeeping
-- miss into a failed request.

create or replace function public.attach_media_paths(
  p_user_id     uuid,
  p_analysis_id uuid,
  p_media_paths text[]
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

  -- Guard 1. Identical to settle_analysis's. Runs before the row is touched.
  foreach v_path in array coalesce(p_media_paths, '{}')
  loop
    if v_path is null or position(v_prefix in v_path) <> 1 or length(v_path) <= length(v_prefix) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_media_path');
    end if;
  end loop;

  -- Guards 2 and 3 live in the WHERE clause, so they are enforced by the write itself rather than
  -- by a check-then-write that a concurrent caller could race.
  update public.analyses
  set media_paths = coalesce(p_media_paths, '{}')
  where id = p_analysis_id
    and user_id = p_user_id
    and status = 'delivered'
    and deleted_at is null
    and cardinality(coalesce(media_paths, '{}')) = 0
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_delivered_or_already_attached');
  end if;

  return jsonb_build_object(
    'ok', true, 'id', v_row.id, 'media_paths', to_jsonb(v_row.media_paths)
  );
end;
$$;

revoke execute on function public.attach_media_paths(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.attach_media_paths(uuid, uuid, text[]) to service_role;
