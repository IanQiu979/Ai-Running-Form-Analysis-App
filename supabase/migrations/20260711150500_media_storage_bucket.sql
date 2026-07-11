-- Private media bucket for the analyzed frames only — the original
-- full-resolution video is never uploaded (Ruling 1). No bucket name is
-- specified in planning/03-engineering-requirements.md or
-- docs/architecture.md beyond "the private bucket for frames", so this uses
-- 'media' per the task default. file_size_limit is a generous per-object
-- ceiling given frames target ~150-350KB at JPEG q~0.7, downscaled to
-- <=1568px long edge (planning/03, "Frame pipeline").
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

-- Owner-scoped storage.objects RLS: paths are {user_id}/{analysis_id}/...
-- (planning/03, "Media pipeline"), so the first path segment
-- (storage.foldername(name))[1]) must equal the caller's own auth.uid().
-- INSERT/SELECT/DELETE only, bucket-scoped, matching the private/
-- owner-only-RLS requirement in CLAUDE.md's Secrets & env section.

create policy "Users can view their own media objects"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can upload their own media objects"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete their own media objects"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- No UPDATE policy: frames are write-once (upload) or delete — an
-- analysis's frames are never edited in place, only removed (deleting the
-- analysis purges its objects) and replaced by a new analysis with new
-- paths. RLS default-denies UPDATE with no policy present.
