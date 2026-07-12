-- Privilege-layer hardening for public.consents (security audit, issue #68).
--
-- 20260712020729_consents.sql got RLS right: owner-scoped SELECT/INSERT and
-- deliberately no UPDATE/DELETE policy. But RLS only filters/rejects rows for
-- a privilege that is already granted — it does not narrow which columns an
-- INSERT may name, and it does not apply to TRUNCATE at all. Supabase's
-- default `grant all` left both gaps open underneath the correct RLS policy.
-- This migration closes the privilege layer to match. It does not touch RLS
-- or lib/consent.ts (unaffected — see below).
--
-- Hole 1: `created_at` and `id` were client-suppliable, defeating withdrawal.
-- A DEFAULT only fires for a column the INSERT statement omits, and
-- `authenticated` held column-level INSERT on every column. A client could
-- INSERT created_at = '2999-01-01', and lib/consent.ts's hasConsented()
-- (`order by created_at desc limit 1`) would treat that row as permanently
-- "latest" — so a later genuine withdrawal (granted = false at real now())
-- would never win the sort. Art. 7(3) withdrawal silently defeated, and the
-- log's evidentiary value gone, since the data subject would be choosing
-- their own consent timestamp. Restricting the INSERT grant to exactly the
-- two columns the app ever sends closes this without touching lib/consent.ts:
-- column-level INSERT still lets DEFAULT fire for every column NOT in the
-- list, so user_id -> auth.uid(), created_at -> now(), id -> gen_random_uuid()
-- all keep working unchanged.
revoke insert on public.consents from authenticated, anon;
grant  insert (consent_key, granted) on public.consents to authenticated;

-- Hole 2: TRUNCATE is a table privilege, not a row-level one — RLS policies
-- do not apply to it at all, only the grant is checked. `authenticated` and
-- `anon` still held UPDATE, DELETE and TRUNCATE from the default `grant all`.
-- RLS correctly neutralises UPDATE/DELETE (no policy = default deny), but
-- TRUNCATE would bypass RLS entirely and succeed on the grant alone. Not
-- reachable today — both roles are NOLOGIN and PostgREST never emits
-- TRUNCATE — but this table's whole value is that it is append-only "by
-- construction, not by convention" (see the preceding migration's comment),
-- and that claim is only true once the privilege itself is gone, not merely
-- unreachable in practice.
revoke update, delete, truncate on public.consents from authenticated, anon;
