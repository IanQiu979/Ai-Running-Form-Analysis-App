-- Age band at account creation + guardian consent for 13–17 runners (2026-09-20).
--
-- Captain's plan, approved 2026-09-20, mirroring what V2.2 shipped in
-- IanQiu979/Ai-Customized-Running-Plan-App#123 (cross-app decision: that repo's issue #95). The
-- under-18 posture is "13–17 may use the app WITH a parent's or guardian's consent". The legal
-- basis is explicit consent — GDPR Art. 9(2)(a) (health data with the data subject's, or here the
-- guardian's, explicit consent) and Thai PDPA s.26 — and "explicit consent" is a specific legal
-- claim, not a UI nicety, so it must be provable after the fact: a checkbox the client asserted is
-- not evidence of anything unless the server independently records that the event happened,
-- when, and against which version of the policy the guardian agreed to.
--
-- THREE PIECES, ONE TRANSACTION:
--
--   1. `profiles.age_band` — which regime the account is under ('18_plus' | '13_17'). On the
--      EXISTING profile row, not a second profile table: `public.profiles` is the one-row-per-
--      account table `handle_new_user()` already creates on every sign-up, for every provider.
--      NULL for every account created before this migration (no backfill — those accounts ticked
--      the old "I am 16+" line, which recorded nothing; the app treats a NULL band on an OAuth-
--      created account as "not yet asked" and on an email account as legacy, see `lib/age-band.ts`).
--
--   2. `public.guardian_consent` — one row per 13–17 user: the most recent consent event, not a
--      history (same reasoning as V2.2's `0004_guardian_consent.sql`: this project keeps exactly
--      the state it needs to enforce a rule, not a full audit log, unless a ruling asks for one).
--      `user_id` references `auth.users` directly, `on delete cascade`, so deleting the account
--      (`supabase/functions/_shared/delete-account.ts`'s LAST step, `auth.admin.deleteUser`)
--      purges it — the same purge-not-retain choice that file's header makes for `consents`, for
--      the same reason: a row keyed on a UUID nobody can map back to a person proves nothing and
--      defends nothing. `__tests__/guardian-consent-sql.deno.test.ts` proves the cascade.
--      `policy_version` is `_shared/legal.ts`'s `PRIVACY_POLICY_VERSION` (= docs/privacy-policy.md's
--      "Last updated"), so a row always says which revision the guardian actually saw.
--
--   3. `pace_record_age_band()` — the ONLY write path for both, SECURITY DEFINER, service_role-
--      only. Both edge functions (`signup-with-captcha`, `record-age-band`) call it with the
--      secret key; no client role can INSERT/UPDATE either table. It re-checks both rules the
--      functions already check (a band must be one of the two; '13_17' needs the attestation),
--      writes the band and the consent row in one transaction so neither can exist without the
--      other, and is WRITE-ONCE: a second call for a user whose band is already set raises
--      `age_band_already_recorded` rather than letting a minor re-record themselves as an adult.
--
-- RLS: owner-scoped SELECT only on `guardian_consent` (a user may read their own record; the
-- Settings screen may show it one day). No INSERT/UPDATE/DELETE policy for any client role, and
-- the legacy grant-all is revoked explicitly below (20260713153000_grant_hardening's discipline:
-- RLS filters rows for a privilege the role holds; it does not remove the privilege, and it never
-- applies to TRUNCATE).

alter table public.profiles
  add column age_band text
    constraint profiles_age_band_check check (age_band in ('18_plus', '13_17'));

comment on column public.profiles.age_band is
  'Age regime chosen at account creation: 18_plus | 13_17. NULL = created before 2026-09-20 or not yet asked (OAuth). Written once by pace_record_age_band(); never by a client.';

create table public.guardian_consent (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  granted_at     timestamptz not null default now(),
  policy_version text not null
);

comment on table public.guardian_consent is
  'Parent/guardian consent for a 13–17 account: the most recent consent event and the privacy-policy revision (Last updated date) it covered. Written only by pace_record_age_band(); purged with the auth user.';

alter table public.guardian_consent enable row level security;

-- (select auth.uid()) rather than a bare auth.uid(): evaluated once per statement, not per row
-- (20260711150600_rls_initplan_fix).
create policy "Users can view their own guardian consent"
  on public.guardian_consent for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- No INSERT, UPDATE or DELETE policy for any client role — RLS default-denies what it has no
-- policy for — AND the privileges themselves are removed, so the absence of a policy is not the
-- only thing standing between a client and this table. `service_role` keeps its default grants
-- (it bypasses RLS and is what the two edge functions hold); it is not named here on purpose.
revoke all on table public.guardian_consent from public, anon, authenticated;
grant select on table public.guardian_consent to authenticated;

create or replace function public.pace_record_age_band(
  p_user_id          uuid,
  p_age_band         text,
  p_guardian_consent boolean,
  p_policy_version   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_age_band is null or p_age_band not in ('18_plus', '13_17') then
    raise exception 'age_band_invalid';
  end if;

  if p_age_band = '13_17' and p_guardian_consent is distinct from true then
    raise exception 'guardian_consent_required';
  end if;

  if p_age_band = '13_17' and (p_policy_version is null or length(p_policy_version) = 0) then
    -- A consent row that cannot say which policy it covered is not a consent record.
    raise exception 'policy_version_required';
  end if;

  -- Write-once. The `age_band is null` predicate is the whole guard: a row that already carries a
  -- band is not updated, and the two branches below turn "not updated" into a named reason.
  update public.profiles
     set age_band = p_age_band
   where id = p_user_id
     and age_band is null;

  if not found then
    if exists (select 1 from public.profiles where id = p_user_id) then
      raise exception 'age_band_already_recorded';
    end if;
    -- `handle_new_user()` creates the profile in the same transaction as the auth.users insert,
    -- so a missing row means the user id itself is wrong, not a race.
    raise exception 'profile_not_found';
  end if;

  if p_age_band = '13_17' then
    -- `on conflict` is unreachable while the band is write-once (a second call never gets here),
    -- but stating the intended semantics — newest event wins — costs nothing and survives a
    -- future ruling that lets consent be re-affirmed.
    insert into public.guardian_consent (user_id, granted_at, policy_version)
    values (p_user_id, now(), p_policy_version)
    on conflict (user_id) do update
      set granted_at = excluded.granted_at,
          policy_version = excluded.policy_version;
  end if;
end;
$$;

comment on function public.pace_record_age_band(uuid, text, boolean, text) is
  'Records an account''s age band once, and its guardian consent when the band is 13_17, in one transaction. service_role only — called by the signup-with-captcha and record-age-band edge functions.';

-- SECURITY DEFINER + PostgREST auto-exposure: without this revoke the function would be callable
-- as POST /rest/v1/rpc/pace_record_age_band by any authenticated client, with p_user_id and
-- p_policy_version of the caller's choosing. Same treatment as reserve_analysis and friends.
revoke execute on function public.pace_record_age_band(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.pace_record_age_band(uuid, text, boolean, text) to service_role;
