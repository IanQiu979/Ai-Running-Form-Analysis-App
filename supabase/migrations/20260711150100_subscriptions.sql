-- subscriptions: at most one row per user, representing their *current*
-- paid tier. A user with NO row here is 'free' — 'free' is intentionally
-- never a value of subscription_tier (contrast analysis_tier on
-- public.analyses in the next migration, which does include 'free', since
-- every analysis records whichever tier was actually active when it ran).
--
-- Written only by future server-side code (the dummy purchase-tier edge
-- function, running as service_role) — never by the client. No client
-- insert/update policy exists below; see the comment on that omission.

create type public.subscription_tier as enum ('pro', 'elite');
create type public.subscription_status as enum ('active', 'canceled');

create table public.subscriptions (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  tier         public.subscription_tier not null,
  -- The period anchor. Quota periods are purchase-day-anchored, month-end
  -- clamped, and computed at *read* time from this single column (see
  -- public.pace_current_period, added in a later migration) — there is no
  -- stored period_start/period_end and no cron rollover job, matching
  -- planning/03-engineering-requirements.md's "Quota-period arithmetic".
  purchased_at timestamptz not null default now(),
  status       public.subscription_status not null default 'active',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;

create policy "Users can view their own subscription"
  on public.subscriptions for select
  to authenticated
  using (auth.uid() = user_id);

-- No insert/update/delete policy for authenticated/anon: tier changes are
-- server-only, via a future purchase-tier edge function running as the
-- service role (which bypasses RLS entirely by design). A client-writable
-- INSERT/UPDATE policy here would let any authenticated user self-grant
-- elite tier for free with a single REST call — see Echo V1's schema.sql,
-- which shipped and then removed exactly that policy for exactly that
-- reason. Do not add one; route tier writes through a service-role edge
-- function instead.
