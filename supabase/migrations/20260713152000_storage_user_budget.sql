-- Issue #7 — the private media bucket has no per-user storage budget.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- RECONCILING THE ISSUE AGAINST THE LIVE CONTRACT — MUCH OF #7 AS FILED IS ALREADY CLOSED
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- #7 was filed when frames were uploaded direct-to-bucket by the CLIENT, before `analyze-form`
-- ran ("at upload time there is legitimately no analysis row to check against yet" — the issue's
-- own words). That premise is gone. Per CLAUDE.md's Secrets & env section and
-- `20260712123606_frame_upload_ordering.sql` (applied and verified live 2026-07-12): the client
-- never writes to the bucket at all. It sends frames as base64 in the `analyze-form` request body;
-- the edge function uploads them with the service-role key, only after `reserve_analysis` has
-- already minted the row. `storage.objects` carries zero INSERT and zero DELETE policies for
-- `authenticated` — only an owner-scoped SELECT (for signed URLs). `docs/status.md` Known Issue
-- #16 already records this as closing #7 "at the RLS-policy level."
--
-- So the ORIGINAL exploit ("any authenticated user can fill the bucket with uploads unconnected
-- to any analysis" via the client's own INSERT policy) is not live today, and this migration does
-- not need to re-close it. Two things remain, deliberately not this migration's job:
--
--   1. The table-level `GRANT INSERT`/`GRANT DELETE` to `authenticated` were never revoked
--      (`docs/status.md` Known Issue #18, issue #100) — no defense in depth if a policy is ever
--      carelessly re-added. A sibling migration (`*_grant_hardening.sql`, a parallel worktree) is
--      revoking those grants. This migration does NOT touch them, to avoid a double-revoke
--      collision — see that migration for the fix.
--   2. Whether `analyze-form` uploads frames before or after its own `settle_analysis` call is a
--      question for `supabase/functions/analyze-form/**`, out of this migration's file lane
--      entirely. Both orderings this repo has on file (`20260712123606`, live; and
--      `20260713140000_attach_media_paths.sql` + its "settle-before-upload" refinement, also
--      applied live) already guarantee, by construction, that a `public.analyses` row with
--      the right id exists BEFORE any object naming it is written — see
--      `20260712123606`'s own "THE INVARIANT". This migration's guard 1 below enforces that
--      invariant at the one layer no application-layer bug can route around: the table itself.
--
-- WHAT IS ACTUALLY STILL OPEN, and what this migration fixes: the audit's own residual read is
-- right — "nothing bounds object count or total bytes per user, and nothing sweeps prefixes whose
-- analysis row never settled or was never created." Two real, independent gaps:
--
--   GUARD 1 — OWNERSHIP. Nothing today requires the `{analysis_id}` segment of an object's path
--   to correspond to a REAL, owned, non-deleted `analyses` row. Today this is only true by
--   convention (every legitimate caller is `analyze-form`, and it only ever builds paths from a
--   real reserved id) — nothing enforces it. A future regression (a policy added back carelessly,
--   RLS disabled by mistake on this table, a compromised service-role key, a bug in `analyze-form`
--   itself) could still write objects "unconnected to any analysis" — the issue's own title —
--   and nothing in the schema would refuse it. This is exactly issue #7's own second suggested fix
--   ("tighten the path constraint so the second segment must be an existing analyses.id owned by
--   the caller"), implemented as a trigger rather than an RLS policy because the object's only
--   writer today is `service_role`, which bypasses RLS but NOT triggers.
--
--   GUARD 2 — BUDGET. Even every object legitimately tied to a real analysis is currently
--   unbounded in aggregate: a user's frames are kept indefinitely (Past Analyses, CLAUDE.md), so a
--   long-lived account's total storage only ever grows. Tier quotas (`reserve_analysis`:
--   free 1 lifetime / pro 10 per month / elite 30 per month; frame caps free 1 / pro 5 / elite 8,
--   `pace.ts`'s `PACE_FRAME_CAP`) bound how fast a user can add analyses, not how much they can
--   accumulate over the account's whole lifetime. Free-plan storage is 1 GB total with 5 GB/month
--   egress (`docs/status.md` Known Issue #9) — a real, low, shared ceiling. This adds a hard
--   per-user backstop so no single account (legitimate heavy use, a bug, or an attack) can consume
--   more than a bounded slice of that shared resource.
--
--   ORPHAN DETECTION (read-only). Given Guard 1 makes a NEW orphaned prefix structurally
--   impossible going forward, "sweep prefixes whose row never settled or was never created" is a
--   smaller ask than it first reads: `sweep_stale_reservations()` already reclaims stale 'reserved'
--   rows without needing a Storage purge (a 'reserved' row can never have frames, by construction —
--   see that migration's Design Decision 5), and a hard-deleted row's objects are already reachable
--   by `delete-account`'s whole-`{user_id}/`-prefix sweep. What is NOT buildable safely from a
--   migration is the ACTUAL byte deletion: `storage.objects` is Postgres METADATA only — deleting a
--   row here does not delete the underlying object from the store, only the Storage HTTP API does
--   that (the same reason `20260713130000_stale_reservation_sweep.sql`'s own "DESIGN DECISION 3"
--   rejected wiring `pg_net` + a Vault secret from a migration file). So this migration adds a
--   read-only, service-role-only DETECTION function — `public.list_orphaned_media_prefixes` — that
--   finds any prefix with no corresponding (or already-deleted) `analyses` row, for a future
--   scheduled edge function to purge via the real Storage API. See the `NEEDS-IAN` note in this
--   issue's report for the scheduling piece, which cannot be done from this repo.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHY A TRIGGER, NOT AN RLS POLICY
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- `service_role` — the only role with any live path to INSERT into `storage.objects` today —
-- bypasses row-level security by definition. An RLS policy could never constrain it. A `BEFORE
-- INSERT` trigger is not subject to that bypass: it fires for every row-producing INSERT
-- regardless of role, which is exactly the defense-in-depth this issue needs (a guard that holds
-- even against a compromised or buggy trusted caller, not just against the client).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- DERIVING THE BUDGET NUMBERS — FROM THE ACTUAL CAPS, NOT GUESSED
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- `PACE_MAX_REQUEST_BODY_BYTES` (`supabase/functions/_shared/pace.ts`) caps the ENTIRE
-- `analyze-form` request body — every frame's base64 payload combined — at 5 MiB. Base64 inflates
-- raw bytes by ~4/3, so the true worst-case RAW bytes written to Storage for one single analysis,
-- at any tier, is bounded around 5 MiB * 3/4 ≈ 3.75 MiB — independent of frame count, because the
-- whole-body cap binds before the per-tier frame cap (`PACE_FRAME_CAP`: free 1 / pro 5 / elite 8)
-- could ever multiply it higher. (The bucket's own 5 MiB *per-object* `file_size_limit` is a much
-- looser, per-frame ceiling that the whole-body cap already makes unreachable in practice.)
--
-- Elite's quota is 30 analyses per rolling month (`reserve_analysis`). A maxed-out Elite account
-- over a full quarter (90 days ≈ 3 billing periods) could legitimately reach:
--     bytes:   90 analyses * 3.75 MiB/analysis ≈ 337.5 MiB
--     objects: 90 analyses * 8 frames/analysis  = 720 objects
-- Real frames target far less than the worst case (~150-350 KB each, downscaled JPEG —
-- `20260711150500_media_storage_bucket.sql`'s own comment), so 337.5 MiB is already a pessimistic
-- upper bound, not a realistic one.
--
-- Budget chosen: 500 MiB / 3000 objects per user — comfortably above the worst-case-bytes quarter
-- above (≈1.5x headroom) and well above the worst-case-objects quarter (≈4x headroom), while still
-- being a REAL, finite ceiling rather than none, and still capping any single account at HALF of
-- the entire free-plan bucket (1 GB) at most — the exact "one account can't fill the shared bucket"
-- property #7 asks for. This is deliberately a backstop, not a tier-aware allowance: legitimate
-- long-horizon growth for a heavy paying user pushing toward this ceiling is a real product signal
-- (`docs/status.md` Known Issue #9 already flags free-plan capacity as something to watch), not
-- evidence this number is wrong — raising it is a one-line follow-up migration, not a redesign.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
--   * Does not touch `storage.objects`' table-level GRANTs (issue #100 / Known Issue #18 — a
--     sibling migration owns that).
--   * Does not touch `analyze-form`, `settle_analysis`, `attach_media_paths`, or any RPC owned by
--     a parallel worktree.
--   * Does not attempt to DELETE any Storage object from SQL — proven unsafe/ineffective above.
--   * Does not schedule anything (no `cron.schedule`) — there is no Deno-callable purge wired to a
--     schedule yet; see the `NEEDS-IAN` note in this issue's final report.

-- ---------------------------------------------------------------------------------------------
-- 1. The combined guard trigger: ownership (Guard 1) + per-user budget (Guard 2).
--    One function, one trigger, one pass over `storage.objects` per insert — both guards need the
--    same path-segment parse, so splitting them into two triggers would just double the work.
-- ---------------------------------------------------------------------------------------------

create or replace function public.pace_enforce_media_object_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Budget constants — see this file's header, "DERIVING THE BUDGET NUMBERS", for the derivation.
  v_max_objects_per_user constant integer := 3000;
  v_max_bytes_per_user   constant bigint  := 524288000; -- 500 MiB

  v_segments         text[];
  v_user_id          text;
  v_analysis_id      text;
  v_owns_analysis     boolean;
  v_existing_objects integer;
  v_existing_bytes   bigint;
  v_new_bytes        bigint;
begin
  -- Scope to the 'media' bucket only. Any other bucket this project ever adds is unaffected.
  if new.bucket_id <> 'media' then
    return new;
  end if;

  -- ---------------------------------------------------------------------------
  -- GUARD 1 — OWNERSHIP. Every legitimate object in this bucket has always been shaped
  -- {user_id}/{analysis_id}/<file> (every owner-scoped policy in this schema already assumes
  -- exactly this — `(storage.foldername(name))[1] = auth.uid()::text`). Reject anything that
  -- doesn't parse into at least two folder segments outright: it cannot be a legitimate frame
  -- object, and letting it through with an unattributable owner would make Guard 2's per-user
  -- budget unenforceable against it anyway.
  -- ---------------------------------------------------------------------------
  v_segments := storage.foldername(new.name);
  if v_segments is null or cardinality(v_segments) < 2 then
    raise exception 'pace_enforce_media_object_guard: object path "%" in bucket "media" is not shaped {user_id}/{analysis_id}/<file>', new.name
      using errcode = '23514'; -- check_violation
  end if;

  v_user_id := v_segments[1];
  v_analysis_id := v_segments[2];

  -- The {analysis_id} segment must name a REAL analyses row owned by the {user_id} segment, and
  -- that row must not already be deleted. This is the direct enforcement of "no object exists
  -- unless an analyses row already points at it" (frame_upload_ordering.sql's own THE INVARIANT)
  -- at the one layer that holds regardless of which role performs the INSERT and regardless of
  -- whether analyze-form uploads before or after its own settle call — both orderings on file in
  -- this repo already guarantee the row exists first. A malformed uuid in either segment is
  -- treated the same as "no such row": rejected, not a 500.
  begin
    v_owns_analysis := exists (
      select 1
      from public.analyses
      where id = v_analysis_id::uuid
        and user_id = v_user_id::uuid
        and deleted_at is null
    );
  exception
    when invalid_text_representation then
      v_owns_analysis := false;
  end;

  if not v_owns_analysis then
    raise exception 'pace_enforce_media_object_guard: object "%" does not correspond to an existing, non-deleted analysis owned by user %', new.name, v_user_id
      using errcode = '23514';
  end if;

  -- ---------------------------------------------------------------------------
  -- GUARD 2 — PER-USER BUDGET. Count and sum bytes for everything this user already has in
  -- 'media', then check the NEW object would not push either total over budget. `name like
  -- v_user_id || '/%'` (not the foldername expression) is used for the aggregate's WHERE clause
  -- specifically so the planner can use the existing `(bucket_id, name)` btree indexes
  -- (`bucketid_objname` / `idx_objects_bucket_id_name`) as a range scan rather than a full scan of
  -- the bucket — `storage.foldername` is still used above to PARSE the segments, just not to
  -- filter this aggregate.
  -- ---------------------------------------------------------------------------
  select count(*), coalesce(sum(coalesce((metadata->>'size')::bigint, 0)), 0)
    into v_existing_objects, v_existing_bytes
  from storage.objects
  where bucket_id = 'media'
    and name like (v_user_id || '/%');

  v_new_bytes := coalesce((new.metadata->>'size')::bigint, 0);

  if v_existing_objects + 1 > v_max_objects_per_user then
    raise exception 'pace_enforce_media_object_guard: user % would exceed the % object budget for bucket "media"', v_user_id, v_max_objects_per_user
      using errcode = '23514';
  end if;

  if v_existing_bytes + v_new_bytes > v_max_bytes_per_user then
    raise exception 'pace_enforce_media_object_guard: user % would exceed the % byte budget for bucket "media"', v_user_id, v_max_bytes_per_user
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- `postgres` does not own `storage.objects` (owned by `supabase_storage_admin`) but Supabase's
-- bootstrap grants it TRIGGER privilege on the table — the same privilege level that already lets
-- every prior migration in this repo `create policy ... on storage.objects`. Verified live
-- (`has_table_privilege('postgres', 'storage.objects', 'TRIGGER')`) before writing this file.
drop trigger if exists pace_media_object_guard on storage.objects;
create trigger pace_media_object_guard
  before insert on storage.objects
  for each row
  execute function public.pace_enforce_media_object_guard();

-- No EXECUTE grant/revoke needed for a trigger function the way an RPC needs one — a trigger is
-- never called directly by any role, only fired by Postgres itself on the INSERT event. Locking
-- down who can call it directly would be meaningless (nobody does) and PostgreSQL does not expose
-- trigger functions to EXECUTE the way it does ordinary functions in practice for this purpose.

-- ---------------------------------------------------------------------------------------------
-- 2. Read-only orphan detection — service_role only. See this file's header, "ORPHAN DETECTION",
--    for why this migration stops at DETECTION rather than attempting to purge: `storage.objects`
--    is metadata only, and actually removing an object requires the Storage HTTP API, which no
--    migration in this repo safely reaches (no `pg_net` + Vault secret from a migration file — the
--    same reasoning `20260713130000_stale_reservation_sweep.sql`'s Design Decision 3 already
--    documents for the sibling sweep).
--
--    Finds every {user_id}/{analysis_id}/ prefix in the 'media' bucket with NO corresponding
--    non-deleted `analyses` row, whose oldest object is older than p_older_than. Under Guard 1
--    above, a NEW orphan cannot be created going forward — this exists as a backstop for whatever
--    predates this migration, or whatever a future bug manages to route around it anyway.
-- ---------------------------------------------------------------------------------------------

create or replace function public.list_orphaned_media_prefixes(
  p_older_than interval default interval '15 minutes',
  p_limit integer default 500
)
returns table (
  user_id text,
  analysis_id text,
  prefix text,
  object_count bigint,
  oldest_object_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (storage.foldername(o.name))[1] as user_id,
    (storage.foldername(o.name))[2] as analysis_id,
    (storage.foldername(o.name))[1] || '/' || (storage.foldername(o.name))[2] || '/' as prefix,
    count(*) as object_count,
    min(o.created_at) as oldest_object_at
  from storage.objects o
  where o.bucket_id = 'media'
    and cardinality(storage.foldername(o.name)) >= 2
    and not exists (
      select 1
      from public.analyses a
      where a.id::text = (storage.foldername(o.name))[2]
        and a.user_id::text = (storage.foldername(o.name))[1]
        and a.deleted_at is null
    )
  group by 1, 2
  having min(o.created_at) < now() - p_older_than
  order by min(o.created_at)
  limit greatest(p_limit, 0);
$$;

revoke execute on function public.list_orphaned_media_prefixes(interval, integer) from public, anon, authenticated;
grant execute on function public.list_orphaned_media_prefixes(interval, integer) to service_role;
