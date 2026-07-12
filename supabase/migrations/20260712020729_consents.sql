-- consents: an append-only log of consent events — one immutable row per grant
-- or withdrawal.
--
-- This table is the record that lets us DEMONSTRATE consent (GDPR Art. 7(1)).
-- The checkbox in the app only COLLECTS consent; a checkbox that ticks, enables
-- a button and then evaporates proves nothing. The injury-risk inferences in
-- analyses.result are Art. 9 health data at rest, so the upload consent must be
-- explicit, affirmative and unbundled — a "by continuing" line is a notice, not
-- consent. See docs/privacy-checklist-m7.md and issue #68.
--
-- APPEND-ONLY BY CONSTRUCTION, not by convention. This table has owner-scoped
-- SELECT and INSERT policies and deliberately NO update or delete policy at all.
-- RLS default-denies anything it has no policy for, so no client can rewrite or
-- erase a consent event. A withdrawal (Art. 7(3) — withdrawing consent must be
-- as easy as giving it) is a NEW row with granted = false, never a mutation of
-- the original grant.

create table public.consents (
  id          uuid primary key default gen_random_uuid(),

  -- Defaulted from the JWT so the client never names a user at all; the INSERT
  -- policy's with-check re-verifies it regardless. References profiles(id) to
  -- match the house pattern (subscriptions, analyses), which cascades from
  -- auth.users. Do NOT read that cascade as a settled answer for delete-account
  -- (#57/#58): as written, deleting an account would purge consent rows as a
  -- side effect, with no code anywhere needing to know this table exists — but
  -- Art. 17(3)(e) expressly permits retaining consent proof for the defence of
  -- legal claims, and an account-deletion request is often the opening move of
  -- exactly such a claim. Whoever builds #57/#58 must make a conscious
  -- purge-vs-retain-for-defence choice for this table specifically, not
  -- inherit this FK's cascade by default. Left as `on delete cascade` here only
  -- because nothing can delete an account yet, so today the question does not
  -- arise.
  user_id     uuid not null default auth.uid()
              references public.profiles(id) on delete cascade,

  -- Versioned in the key itself ('upload.health.v1'), NOT in a separate column.
  -- Consent to one wording is not consent to a later one, so rewording the deck
  -- mints a new key and hasConsented('...v2') is automatically false for every
  -- existing user until they re-tick. A version column would have to be
  -- remembered and compared at every call site; a versioned key cannot be
  -- forgotten.
  consent_key text not null,

  granted     boolean not null,   -- false = withdrawal
  created_at  timestamptz not null default now()
);

-- The only read this table serves: "latest row for this user and key".
create index consents_user_key_created_idx
  on public.consents (user_id, consent_key, created_at desc);

alter table public.consents enable row level security;

-- (select auth.uid()) rather than a bare auth.uid(): the planner evaluates it
-- once per statement instead of once per row. See 20260711150600_rls_initplan_fix.
create policy "Users can view their own consents"
  on public.consents for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can record their own consents"
  on public.consents for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- No UPDATE policy. No DELETE policy. For anyone. This absence is what makes the
-- log append-only and the consent record admissible. Do not add one.
