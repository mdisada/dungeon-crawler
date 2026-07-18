-- Bug fix (found during F02 manual testing): in 20260717150100_create_characters.sql the storage
-- policies wrote `storage.foldername(name)` inside an EXISTS subquery over `characters c` - and
-- since characters has its own `name` column, the unqualified reference bound to c.name (the
-- character's name) instead of storage.objects.name (the file path). The check could never be
-- true, so every upload to the characters bucket failed with an RLS violation. Recreate all four
-- policies with the outer column explicitly qualified as objects.name.

drop policy "characters_storage_select_own" on storage.objects;
drop policy "characters_storage_insert_own" on storage.objects;
drop policy "characters_storage_update_own" on storage.objects;
drop policy "characters_storage_delete_own" on storage.objects;

create policy "characters_storage_select_own" on storage.objects
  for select using (
    bucket_id = 'characters'
    and exists (
      select 1 from characters c
      where c.id::text = (storage.foldername(objects.name))[1]
      and c.user_id = auth.uid()
    )
  );

create policy "characters_storage_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'characters'
    and exists (
      select 1 from characters c
      where c.id::text = (storage.foldername(objects.name))[1]
      and c.user_id = auth.uid()
    )
  );

create policy "characters_storage_update_own" on storage.objects
  for update using (
    bucket_id = 'characters'
    and exists (
      select 1 from characters c
      where c.id::text = (storage.foldername(objects.name))[1]
      and c.user_id = auth.uid()
    )
  );

create policy "characters_storage_delete_own" on storage.objects
  for delete using (
    bucket_id = 'characters'
    and exists (
      select 1 from characters c
      where c.id::text = (storage.foldername(objects.name))[1]
      and c.user_id = auth.uid()
    )
  );
