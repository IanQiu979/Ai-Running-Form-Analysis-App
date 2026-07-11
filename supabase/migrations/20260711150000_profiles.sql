-- profiles: one row per auth.users row, created automatically on signup by
-- the trigger below. Mirrors auth.users.id 1:1 so the rest of the schema
-- (subscriptions, analyses) can FK against a table in the public schema
-- instead of auth.users directly — same convention Echo V1's schema.sql
-- uses throughout.

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

-- No insert/update/delete policy for authenticated/anon: the row is created
-- only by the handle_new_user() trigger below (SECURITY DEFINER), and this
-- MVP has no profile-editing UI yet. RLS default-denies writes with no
-- policy present — add an owner-scoped UPDATE policy if/when profile editing
-- ships.

-- Auto-create a profile row whenever a new auth.users row is inserted, i.e.
-- on signup for every provider (email/password, Google OAuth now; Apple
-- later). SECURITY DEFINER + a pinned search_path is required because this
-- function writes into public.profiles from a trigger firing on auth.users,
-- which the authenticating role does not itself have INSERT rights on.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- handle_new_user() is a trigger function only — it should never be
-- client-invocable. Because it's SECURITY DEFINER, PostgREST would otherwise
-- auto-expose it as a callable RPC (POST /rest/v1/rpc/handle_new_user) to
-- anon/authenticated by default. Postgres fires triggers regardless of a
-- trigger function's EXECUTE grants (triggers don't go through PostgREST's
-- privilege check), so this revoke does not affect on_auth_user_created.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Shared updated_at trigger helper, reused by subscriptions and analyses
-- (created here since profiles is the first migration; profiles itself has
-- no updated_at column, so no trigger call for it below). search_path is
-- pinned to close the function_search_path_mutable advisor finding even
-- though this function is SECURITY INVOKER (it only sets NEW.updated_at, no
-- privilege escalation) — an unset search_path is lower-severity on an
-- INVOKER function than a DEFINER one, but still resolved against whatever
-- search_path the calling session has, so pinning it is correct regardless.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
