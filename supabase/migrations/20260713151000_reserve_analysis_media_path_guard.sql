-- Issue #8: reserve_analysis accepts arbitrary p_media_paths with no ownership check.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHY THIS MIGRATION DOES NOT TOUCH reserve_analysis'S SIGNATURE
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- Issue #8 was filed and re-audited against the ORIGINAL 5-arg reserve_analysis
-- (20260711150400_quota_reserve_settle_release.sql:37-43), which inserted `p_media_paths`
-- verbatim with no ownership check. That hole is real for the 5-arg version — but the 5-arg
-- version no longer exists, and re-adding it would reopen a *worse*, already-fixed bug and
-- break the live analyze-form flow. Both claims are checked below, not assumed.
--
-- #88 (20260712123606_frame_upload_ordering.sql, merged 2026-07-12) restructured the
-- reserve/settle lifecycle for an independent reason — the old contract made the client name a
-- storage path under {user_id}/{analysis_id}/ before reserve_analysis had minted analysis_id,
-- and every rejection branch returned before the insert, so a rejected reservation could leave
-- uploaded frames with no row ever pointing at them. The fix DROPPED p_media_paths from
-- reserve_analysis entirely (not merely guarded it) and moved path-recording to AFTER the row
-- exists: settle_analysis gained p_media_paths (with a namespace guard), and #130
-- (20260713140000_attach_media_paths.sql) added a second, later writer — attach_media_paths —
-- carrying the byte-for-byte identical guard. #88's own migration comment says this outright:
-- "The guard [in settle_analysis] is what permanently closes #8: after this, not even the
-- service role can record a path outside the row's own {user_id}/{analysis_id}/ namespace."
--
-- Verified directly against this project's LIVE database (vputdomdlknvthnzritt) before writing
-- this file, 2026-07-13, read-only:
--
--   select p.proname, pg_get_function_identity_arguments(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'reserve_analysis';
--   -> reserve_analysis(p_user_id uuid, p_idempotency_key text, p_media_type media_type,
--                        p_frame_count integer)
--
-- Four arguments, live, today. No p_media_paths, no second overload. This matches
-- supabase/functions/analyze-form/flow.ts's own call site (reserveAnalysis(), ~line 363),
-- which passes exactly these four names and says so in its own comment: "Four args, not five:
-- p_media_paths was dropped by #88."
--
-- So there is nothing left to guard INSIDE reserve_analysis: it cannot record a media path,
-- foreign or otherwise, because it no longer accepts one as input. Two things follow from that:
--
--   1. Re-adding a `p_media_paths text[] default '{}'` parameter to reserve_analysis (even
--      guarded, even matching attach_media_paths's exact guard style as the parent task for
--      this migration originally asked) would not be a fix — it would REOPEN the pre-#88 bug:
--      the client naming a path before the analysis_id exists, and a rejected reservation
--      stranding uploaded frames. #88 `drop function if exists ... (uuid, text,
--      public.media_type, integer, text[])`-ed the old 5-arg signature explicitly rather than
--      replacing it, precisely so a 5-arg overload could never again coexist with the 4-arg one
--      (Postgres overloads functions on their argument list, not just their name).
--   2. It would also be a LIVE BREAK, not just a design regression: PostgREST resolves an RPC
--      call by matching the JSON body's argument names against candidate function signatures.
--      flow.ts calls reserve_analysis with exactly 4 named arguments. Introducing a second,
--      5-arg overload whose 5th parameter defaults means BOTH overloads become valid candidates
--      for that same 4-argument call — Postgres raises "function ... is not unique" rather than
--      silently picking one, which would break every real analyze-form request the moment this
--      migration applied. (Confirmed no such second overload exists live — the query above
--      returned exactly one reserve_analysis row.) Per this agent's standing instructions
--      ("if a proposed change would break an existing application code path, say so before
--      applying it — grep the application code, don't assume the schema change is isolated"),
--      that is reported here instead of applied.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION ADDS INSTEAD: A TABLE-LEVEL BACKSTOP
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- settle_analysis and attach_media_paths already enforce the exact namespace guard issue #8
-- asked for, each in its own function body. That closes both of today's ACTUAL writers of
-- media_paths. What per-function guards structurally cannot close: a THIRD writer, added by
-- some future migration, that forgets the guard — exactly the failure mode attach_media_paths's
-- own header warns about ("a compromised or buggy edge function could point one user's analyses
-- row at another user's frames — through here, even though settle_analysis is airtight"). A
-- guard living inside one function only ever protects call sites that remember to carry it.
--
-- A CHECK constraint on the table itself closes that residual gap for good: it applies to EVERY
-- writer — reserve_analysis (if ever reworked to touch media_paths again), settle_analysis,
-- attach_media_paths, any future RPC, even a manual service-role UPDATE run by hand — because
-- Postgres enforces it at the row level, not the call site. It is strictly stronger
-- defense-in-depth than "guard every function that writes this column", and it costs nothing
-- today: it is byte-for-byte the same rule settle_analysis and attach_media_paths already both
-- enforce in their own bodies, so no currently-passing write becomes rejected.
--
-- Checked against live data before adding this (2026-07-13, vputdomdlknvthnzritt, read-only):
--
--   select count(*) as total_rows,
--     count(*) filter (where cardinality(media_paths) > 0) as rows_with_paths
--   from public.analyses;
--   -> total_rows = 0, rows_with_paths = 0
--
-- No backfill hazard — the table is empty in production today — but the constraint is written
-- to hold for any future data regardless, not because the table happens to be empty now.
--
-- The check logic is lifted verbatim from settle_analysis's/attach_media_paths's own guard
-- (`position(v_prefix in v_path) <> 1 or length(v_path) <= length(v_prefix)`), wrapped in a
-- small helper function because a CHECK constraint's expression cannot itself contain a
-- set-returning construct like `unnest()` in a subquery — FOREACH over the array, inside a
-- plpgsql function, sidesteps that restriction cleanly. IMMUTABLE is accurate here (the
-- function only reads its own arguments — no table access, no now(), no randomness), matching
-- the sibling pace_* helpers' declared volatility.

create or replace function public.pace_media_paths_within_namespace(
  p_user_id     uuid,
  p_analysis_id uuid,
  p_media_paths text[]
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_prefix text;
  v_path   text;
begin
  if p_media_paths is null or cardinality(p_media_paths) = 0 then
    return true;
  end if;

  v_prefix := p_user_id::text || '/' || p_analysis_id::text || '/';

  foreach v_path in array p_media_paths loop
    if v_path is null or position(v_prefix in v_path) <> 1 or length(v_path) <= length(v_prefix) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

revoke execute on function public.pace_media_paths_within_namespace(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.pace_media_paths_within_namespace(uuid, uuid, text[]) to service_role;

-- The backstop itself. References this row's own user_id/id, so no subquery is needed — Postgres
-- CHECK constraints may reference other columns of the same row.
alter table public.analyses
  add constraint analyses_media_paths_within_owner_namespace
  check (public.pace_media_paths_within_namespace(user_id, id, media_paths));
