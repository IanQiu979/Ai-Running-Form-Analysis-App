-- Performance advisor fix (auth_rls_initplan): bare auth.uid() in a USING/
-- WITH CHECK clause is re-evaluated once per row; wrapping it as
-- (select auth.uid()) lets the planner evaluate it once per statement
-- instead (Postgres treats the scalar subquery as an InitPlan). Behavior is
-- identical — same rows match — this is a pure performance fix, applied to
-- every owner-scoped policy from the preceding migrations.

drop policy "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy "Users can view their own subscription" on public.subscriptions;
create policy "Users can view their own subscription"
  on public.subscriptions for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy "Users can view their own analyses" on public.analyses;
create policy "Users can view their own analyses"
  on public.analyses for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy "Users can delete their own analyses" on public.analyses;
create policy "Users can delete their own analyses"
  on public.analyses for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Same fix applied preemptively to the storage.objects policies (the
-- performance advisor run right after these were created did not flag them,
-- but they have the identical bare-auth.uid()-per-row shape, so there is no
-- reason to leave them inconsistent with the fix above).
drop policy "Users can view their own media objects" on storage.objects;
create policy "Users can view their own media objects"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy "Users can upload their own media objects" on storage.objects;
create policy "Users can upload their own media objects"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy "Users can delete their own media objects" on storage.objects;
create policy "Users can delete their own media objects"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
