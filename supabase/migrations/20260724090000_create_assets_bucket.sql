-- F12 Assets Lab: one private bucket both generation routes write into, so a generated image or
-- audio clip has the same contract whether OpenRouter produced it (client uploads the bytes it
-- got back) or the local worker did (worker uploads with the service key, then broadcasts the
-- path). Consumers always receive a path and sign it at render time.
--
-- Path convention: assets/{user_id}/{kind}/{job_id}.{ext} for generated output and
-- assets/{user_id}/refs/{hash}.{ext} for reference inputs (image references, voice clips).
-- First folder segment is the owner's uid, so the policies need no join -- same shape as the
-- voices and battle-maps buckets, deliberately NOT the public narration-audio one.

insert into storage.buckets (id, name, public)
values ('assets', 'assets', false)
on conflict (id) do nothing;

create policy "assets_storage_select_own" on storage.objects
  for select using (
    bucket_id = 'assets'
    and (storage.foldername(objects.name))[1] = auth.uid()::text
  );

create policy "assets_storage_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'assets'
    and (storage.foldername(objects.name))[1] = auth.uid()::text
  );

create policy "assets_storage_update_own" on storage.objects
  for update using (
    bucket_id = 'assets'
    and (storage.foldername(objects.name))[1] = auth.uid()::text
  );

create policy "assets_storage_delete_own" on storage.objects
  for delete using (
    bucket_id = 'assets'
    and (storage.foldername(objects.name))[1] = auth.uid()::text
  );
