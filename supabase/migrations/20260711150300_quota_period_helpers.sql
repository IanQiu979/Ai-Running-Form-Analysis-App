-- Purchase-day-anchored, month-end-clamped quota periods — ported verbatim
-- from V2.2's currentPeriod(anchorDate, now) semantics
-- (planning/03-engineering-requirements.md, "Quota-period arithmetic"),
-- reimplemented in SQL so reserve_analysis (next migration) can compute the
-- current period atomically, inside the same transaction as the quota
-- count-and-insert. No cron job, no stored period_start/period_end to roll
-- over — the period is always derived from subscriptions.purchased_at at
-- read time.
--
-- Native `timestamp + interval 'n months'` does NOT clamp on day overflow —
-- Postgres spills e.g. Jan 31 + 1 month into Mar 3, not Feb 28 — so
-- month-end clamping (Jan 31 -> Feb 28 -> Mar 31 -> Apr 30 ...) has to be
-- done by hand below.

create or replace function public.pace_add_months_clamped(base timestamptz, n integer)
returns timestamptz
language plpgsql
immutable
set search_path = public
as $$
declare
  base_utc timestamp := base at time zone 'utc';
  y        integer := extract(year from base_utc)::integer;
  mo       integer := extract(month from base_utc)::integer;
  d        integer := extract(day from base_utc)::integer;
  -- Offset by 120000 months (10,000 years) before dividing so the
  -- division/modulo below stays well-defined for a negative n too —
  -- Postgres integer division truncates toward zero, which mishandles
  -- negative month counts without this offset.
  total    integer := (y * 12 + (mo - 1)) + n + 120000;
  new_y    integer := total / 12 - 10000;
  new_mo   integer := (total % 12) + 1;
  last_day integer;
  new_d    integer;
begin
  last_day := extract(day from ((make_date(new_y, new_mo, 1) + interval '1 month') - interval '1 day'))::integer;
  new_d := least(d, last_day);
  return (
    make_timestamp(new_y, new_mo, new_d,
      extract(hour from base_utc)::integer,
      extract(minute from base_utc)::integer,
      extract(second from base_utc)::double precision)
  ) at time zone 'utc';
end;
$$;

revoke execute on function public.pace_add_months_clamped(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.pace_add_months_clamped(timestamptz, integer) to service_role;

-- Returns the half-open [start, end) period containing as_of, for periods of
-- 1 calendar month anchored on anchor's day-of-month, month-end clamped.
-- Example: anchor = Jan 31 -> periods [Jan 31, Feb 28), [Feb 28, Mar 31),
-- [Mar 31, Apr 30), ... matching the "Jan 31 -> Feb 28 -> Mar 31" example in
-- planning/03-engineering-requirements.md.
create or replace function public.pace_current_period(anchor timestamptz, as_of timestamptz)
returns tstzrange
language plpgsql
immutable
set search_path = public
as $$
declare
  n       integer;
  p_start timestamptz;
  p_end   timestamptz;
begin
  n := (extract(year from (as_of at time zone 'utc'))::integer - extract(year from (anchor at time zone 'utc'))::integer) * 12
     + (extract(month from (as_of at time zone 'utc'))::integer - extract(month from (anchor at time zone 'utc'))::integer);

  p_start := public.pace_add_months_clamped(anchor, n);
  if p_start > as_of then
    n := n - 1;
    p_start := public.pace_add_months_clamped(anchor, n);
  end if;
  p_end := public.pace_add_months_clamped(anchor, n + 1);

  -- Defensive walk in case the initial month-length jump landed outside
  -- [p_start, p_end) by more than one step. Shouldn't happen for 1-month
  -- periods given the arithmetic above, but cheap to make airtight rather
  -- than assumed.
  while p_end <= as_of loop
    n := n + 1;
    p_start := p_end;
    p_end := public.pace_add_months_clamped(anchor, n + 1);
  end loop;
  while p_start > as_of loop
    n := n - 1;
    p_start := public.pace_add_months_clamped(anchor, n);
    p_end := public.pace_add_months_clamped(anchor, n + 1);
  end loop;

  return tstzrange(p_start, p_end, '[)');
end;
$$;

revoke execute on function public.pace_current_period(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.pace_current_period(timestamptz, timestamptz) to service_role;
