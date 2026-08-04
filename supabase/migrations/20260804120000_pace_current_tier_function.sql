-- A side-effect-free tier lookup, split out of reserve_analysis so the caller can learn a
-- user's tier WITHOUT reserving a row or consuming a quota slot (captain-approved 2026-07-26:
-- Free tier makes zero model calls and must not spend its lifetime quota on a canned preview).
--
-- Mirrors reserve_analysis's own tier derivation
-- (supabase/migrations/20260711150400_quota_reserve_settle_release.sql lines ~94-103) exactly —
-- no active row in public.subscriptions = 'free'. This function is intentionally NOT the
-- authority for anything reserve_analysis already governs (quota, frame cap, idempotency); it
-- only answers "which tier is this user on right now."
--
-- SECURITY: same shape as reserve_analysis/settle_analysis/release_analysis — SECURITY DEFINER,
-- pinned search_path, p_user_id taken as a plain argument (the caller is the edge function's
-- service-role client, already having verified the JWT via auth.getUser() — see flow.ts's
-- CONTRACT RULE 1). EXECUTE is revoked from public/anon/authenticated and granted only to
-- service_role, for the identical reason: without the revoke, PostgREST's default auto-exposure
-- would let any authenticated client read an arbitrary user's tier by passing a foreign
-- p_user_id.
create or replace function public.pace_current_tier(
  p_user_id uuid
)
returns public.analysis_tier
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier public.analysis_tier;
begin
  select tier into v_tier
  from public.subscriptions
  where user_id = p_user_id and status = 'active';

  if not found then
    v_tier := 'free';
  end if;

  return v_tier;
end;
$$;

revoke execute on function public.pace_current_tier(uuid) from public, anon, authenticated;
grant execute on function public.pace_current_tier(uuid) to service_role;
