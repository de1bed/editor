-- Private bucket for all media. Objects live under "<user_id>/<project_id>/...".
-- file_size_limit is set to 50 GB; the effective limit is also capped by the
-- project's global setting (Free plan: 50 MB — raise it on a paid plan).
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 53687091200)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

create policy "media: owner can read"
  on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "media: owner can upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "media: owner can update"
  on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "media: owner can delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
