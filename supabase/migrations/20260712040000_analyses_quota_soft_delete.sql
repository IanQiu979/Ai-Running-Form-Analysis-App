-- Fixes issue #2 (HIGH, security): the free "lifetime" quota was resettable.
--
-- ROOT CAUSE: public.analyses carried a client-facing owner-scoped DELETE policy
-- ("Users can delete their own analyses", 20260711150200_analyses.sql:71-74,
-- reissued 20260711150600_rls_initplan_fix.sql:26-30), while reserve_analysis
-- (20260711150400_quota_reserve_settle_release.sql) derives both the quota-used
-- count and the 3-failed-attempt anti-farming count by COUNTING LIVE ROWS —
-- `count(*) where status in ('reserved','delivered')` for quota,
-- `count(*) where status = 'released'` for the anti-farm cap. A user could
-- DELETE /rest/v1/analyses?id=eq.<id> with their own JWT (no special access —
-- the same publishable key shipped in the app bundle) and both counters would
-- drop back to zero, farming unlimited free Anthropic vision calls and
-- defeating the retry-farm guard in the same move. Verified still present on
-- this branch (PR #98, already merged into main, only touched
-- app/(tabs)/index.tsx and docs/design/copy-deck.md — a client-side stale-
-- fetch race and signOut hardening, unrelated to this table's RLS/grants) and
-- against the live project (pg_policies confirmed the DELETE policy and the
-- underlying grant are both still live as of this migration).
--
-- DESIGN DECISION: soft-delete, not an append-only usage ledger.
--
-- The issue write-up named two candidate mechanisms: (a) soft-delete
-- (`deleted_at`, counted regardless of it, client DELETE dropped) or (b) a
-- separate append-only usage ledger / counter that reserve_analysis
-- increments and nothing can decrement. A ledger would need its own logic to
-- track the "how many count toward quota vs. the anti-farm cap" distinction
-- that status already encodes on analyses (reserved/delivered vs. released),
-- effectively duplicating status in a second place — exactly the kind of
-- second copy this schema has otherwise avoided (see reserve_analysis's own
-- header comment: "this RPC is the sole enforcement point ... so there is no
-- second copy of these numbers to drift out of sync with").
--
-- Soft-delete instead makes quota accounting a NO-OP change: reserve_analysis
-- already counts by `status` alone and never looks at row survival beyond
-- "the row exists" — so a `deleted_at` column that reserve_analysis's queries
-- simply never filter on means a soft-deleted row keeps counting exactly as
-- it did before, with zero changes required to reserve_analysis itself. The
-- only new surface is: (1) the column, (2) swapping the client's hard DELETE
-- policy for a column-and-transition-restricted soft-delete UPDATE policy,
-- and (3) closing the privilege layer under it (see consents_grant_hardening,
-- 20260712030617, for the precedent this follows).
--
-- This decision was independently confirmed correct once #2 and #88 (frame-
-- upload ordering, worktree-88, commit 71da995) were compared side by side:
-- #88 also rewrites reserve_analysis (drops the old 5-arg signature, adds a
-- new 4-arg one with p_media_paths removed) but leaves its COUNTING LOGIC
-- untouched — #88's own header comment flags the overlap and warns that two
-- `create or replace function` migrations touching reserve_analysis cannot
-- both apply blindly, since whichever lands last wins the whole body. A
-- ledger design would have required rewriting reserve_analysis's counting
-- block too, colliding head-on with #88's rewrite. This migration never
-- touches reserve_analysis (or settle_analysis) at all, so it composes with
-- #88 cleanly regardless of which order the two migrations end up applied in
-- — see the postscript at the bottom of this file for the specific check.
--
-- The other candidate in the issue — routing deletion through
-- DELETE /functions/v1/analysis/:id (#57) — is not available yet: no edge
-- functions exist in this repo at all (supabase/functions/ has only
-- .env.example), so a fix for #2 cannot depend on #57 landing first. M6
-- ("delete purges row + storage") also is not started, so this migration
-- does not touch any UI; it only makes the underlying mechanism safe for
-- whichever M6 delete flow gets built on top of it.
--
-- M6 REQUIREMENT PRESERVED: users can still delete an analysis and its
-- storage frames. The storage side is untouched — storage.objects still has
-- its own owner-scoped DELETE policy (20260711150500_media_storage_bucket.sql,
-- reissued 20260711150600), so a client can still physically remove the
-- frame objects from the private bucket. On the analyses side, a client can
-- still "delete" a row from their own point of view: it disappears from
-- anything that later filters on deleted_at, and it becomes permanently
-- immutable the moment it's soft-deleted (the USING clause below only
-- matches deleted_at IS NULL rows, so a second write to an already-deleted
-- row matches zero rows — safe no-op, same idiom as settle_analysis/
-- release_analysis's own "duplicate/late call is a safe no-op" guards).
-- Deleting does NOT refund quota: status (what reserve_analysis actually
-- counts) is never touched by the soft-delete path, by construction — see
-- the column-level grant below, which makes it a permission error for the
-- client to even name `status` in the same UPDATE statement. (This
-- paragraph's storage claim is specific to THIS branch, which does not yet
-- include #88 — see the postscript for how it changes once merged.)
--
-- PRIVACY: the row is kept for quota integrity, but its sensitive payload
-- doesn't have to be. `result` (the PACE analysis — Art. 9-adjacent
-- injury-risk inferences, per the consents migrations' own framing) and
-- `media_paths` (pointers into the private media bucket) are redacted to
-- null/empty by the trigger below at the moment of soft-delete, so a
-- "deleted" analysis retains only the columns reserve_analysis's counting
-- depends on (status, tier_at_run, created_at, user_id) plus deleted_at
-- itself. This is a stronger privacy posture than a bare `deleted_at` flag
-- would give, at no cost to the quota fix.

-- 1. The column reserve_analysis will never filter on (intentionally — see
--    above). Nullable, no default beyond NULL: "not deleted" is the absence
--    of a value, matching delivered_at/released_at's existing shape on this
--    same table.
alter table public.analyses add column deleted_at timestamptz;

-- 2. Redact-on-delete trigger. Scoped with a WHEN clause to the exact
--    transition a soft-delete performs (deleted_at NULL -> NOT NULL) so it
--    never fires for settle_analysis/release_analysis's own updates, which
--    never touch deleted_at at all (their SET clauses don't name it, so
--    NEW.deleted_at == OLD.deleted_at == null for those calls, and the WHEN
--    condition is false) — those two RPCs are completely unaffected by this
--    migration, in either their current form or #88's rewritten form (see
--    postscript). Plain SECURITY INVOKER, no elevated privilege needed to
--    write NEW.* from inside a trigger body regardless of the invoking
--    role's column grants (same as the existing set_updated_at() trigger on
--    this same table, which writes updated_at with no dedicated grant for
--    it either).
create or replace function public.redact_analyses_on_soft_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Ignore whatever value the client's UPDATE statement sent for deleted_at
  -- (the column-level grant below only restricts WHICH column can appear in
  -- the SET clause, not what value it's set to) and stamp the real deletion
  -- time server-side instead.
  new.deleted_at := now();
  new.result := null;
  new.media_paths := '{}';
  return new;
end;
$$;

create trigger analyses_redact_on_soft_delete
  before update on public.analyses
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.redact_analyses_on_soft_delete();

-- 3. Drop the client-facing hard DELETE policy — this is the actual hole.
drop policy "Users can delete their own analyses" on public.analyses;

-- 4. Replace it with a soft-delete UPDATE policy, restricted to exactly the
--    null -> non-null deleted_at transition on the caller's own, not-yet-
--    deleted rows. USING gates which existing rows are eligible (yours, and
--    not already deleted — so a soft-deleted row is permanently immutable to
--    the client from that point on); WITH CHECK gates what the row is
--    allowed to become (still yours, and now deleted). Postgres evaluates
--    WITH CHECK against the row AFTER BEFORE ROW triggers run, so this sees
--    the trigger-stamped deleted_at, not whatever the client sent.
create policy "Users can soft-delete their own analyses"
  on public.analyses for update
  to authenticated
  using ((select auth.uid()) = user_id and deleted_at is null)
  with check ((select auth.uid()) = user_id and deleted_at is not null);

-- 5. Close the privilege layer underneath the RLS change, same discipline as
--    20260712030617_consents_grant_hardening.sql: RLS policies only filter
--    rows for a privilege the role already holds at the grant layer, and
--    Supabase's default `grant all` on table creation had left anon and
--    authenticated holding blanket INSERT/UPDATE/DELETE/TRUNCATE on
--    `analyses` underneath the old (narrower) set of policies the whole
--    time — confirmed live via information_schema.role_table_grants before
--    writing this migration. DELETE and TRUNCATE in particular must not
--    survive this fix: DELETE is the exploit itself, and TRUNCATE bypasses
--    RLS entirely (it's a table-level privilege, not a row-level one), so
--    leaving it granted would reopen the identical hole through a different
--    statement. service_role and the migration-owning role are untouched —
--    they're not named below, and the quota RPCs run as SECURITY DEFINER
--    under the owning role regardless, which already bypasses RLS (the same
--    property reserve_analysis's own INSERT already relies on today, since
--    authenticated/anon have never had an INSERT policy on this table).
revoke all on public.analyses from authenticated, anon;
grant select on public.analyses to authenticated;
grant update (deleted_at) on public.analyses to authenticated;
-- anon gets nothing: no policy on this table has ever targeted anon, and
-- none should — analyses is never readable or writable pre-auth.

-- ---------------------------------------------------------------------------
-- POSTSCRIPT — checked against #88 (frame-upload ordering, worktree-88,
-- commit 71da995) before this file was finalized, since #88 also touches
-- public.analyses and storage.objects and its own header comment flags an
-- overlap with this issue.
--
-- What #88 does that touches the same surface:
--   * `drop policy if exists "Users can delete their own analyses" on
--     public.analyses;` — the identical policy this migration drops in
--     step 3 above, for an independent reason (a client-side row delete
--     would strand that row's frames now that #88 also removes the client's
--     storage.objects DELETE policy). Both migrations want the same end
--     state on this one policy. #88 uses `if exists`, so whichever of the
--     two migrations applies second is a safe no-op on this statement
--     specifically — no error either ordering.
--   * Drops and recreates reserve_analysis (5-arg -> 4-arg, p_media_paths
--     removed) and settle_analysis (4-arg -> 5-arg, p_media_paths added
--     with a namespace guard). This migration does not touch either
--     function, in any form — see the DESIGN DECISION note above for why
--     that's a deliberate property of the soft-delete approach, not an
--     oversight. Whichever of #88's or the original 20260711150400
--     signatures is active when this migration runs, its counting query is
--     untouched by this file and keeps counting live `analyses` rows
--     correctly, because after this migration a "live" row is never
--     actually hard-deleted again — soft-delete leaves status alone.
--   * Drops the client's storage.objects INSERT and DELETE policies (frames
--     move to a server-side, post-model-call upload owned by the edge
--     function; purge becomes exclusively #57's job). This means the M6
--     paragraph above ("a client can still physically remove the frame
--     objects from the private bucket") is accurate only for THIS branch in
--     isolation, which does not yet include #88. Once the two branches are
--     merged, frame purging stops being a client-side storage.objects
--     DELETE and becomes #57's job either way (#88's own stated
--     consequence, independent of this migration) — that does not weaken
--     this fix: the soft-delete on `analyses` still means the client can
--     make an analysis disappear from their own view and its sensitive
--     payload gets redacted immediately, with actual object purge following
--     whenever #57 runs, same as #88 already commits to for every other
--     analysis. Nothing here depends on the client retaining storage
--     DELETE.
--
-- What #88 does NOT do: it never revokes or re-grants table-level or
-- column-level privileges on public.analyses (only the RLS policy drop in
-- the bullet above) — step 5's grant hardening in this migration is not
-- duplicated by #88 and remains solely this migration's responsibility.
--
-- Net result: this migration and #88 can apply in either order without a
-- Postgres error and without either one silently undoing the other's fix.
-- No manual reconciliation of function bodies is needed for THIS migration,
-- unlike the ledger design #88's own comment warned against — because this
-- migration never redefines reserve_analysis or settle_analysis in the
-- first place.
-- ---------------------------------------------------------------------------
