-- Phase 3b (F04 SS5.1): voice profiles - uploaded 3-30s clips for Voxtral zero-shot cloning.
-- Owned by the uploading user (not the adventure) so a narrator voice can be reused across
-- adventures. Clips live in the private `voices` bucket under {user_id}/{profile_id}.wav.

create table voice_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default '',
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index voice_profiles_user_id_idx on voice_profiles (user_id);

alter table voice_profiles enable row level security;

create policy "voice_profiles_select_own" on voice_profiles
  for select using (auth.uid() = user_id);

create policy "voice_profiles_insert_own" on voice_profiles
  for insert with check (auth.uid() = user_id);

create policy "voice_profiles_update_own" on voice_profiles
  for update using (auth.uid() = user_id);

create policy "voice_profiles_delete_own" on voice_profiles
  for delete using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('voices', 'voices', false)
on conflict (id) do nothing;

-- Path convention: voices/{user_id}/... - first folder segment is the owner's uid, so no join
-- is needed (unlike the characters bucket). objects.name kept qualified anyway (see the F02
-- storage-policy bug fixed in 20260717170000).

create policy "voices_storage_select_own" on storage.objects
  for select using (
    bucket_id = 'voices'
    and auth.uid()::text = (storage.foldername(objects.name))[1]
  );

create policy "voices_storage_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'voices'
    and auth.uid()::text = (storage.foldername(objects.name))[1]
  );

create policy "voices_storage_update_own" on storage.objects
  for update using (
    bucket_id = 'voices'
    and auth.uid()::text = (storage.foldername(objects.name))[1]
  );

create policy "voices_storage_delete_own" on storage.objects
  for delete using (
    bucket_id = 'voices'
    and auth.uid()::text = (storage.foldername(objects.name))[1]
  );

-- F03 created narrator_voice_id as bare text before voice_profiles existed; now that the table
-- is real, make it a proper FK (column is all-null in every draft so far - no data to convert).
alter table adventures
  alter column narrator_voice_id type uuid using narrator_voice_id::uuid;

alter table adventures
  add constraint adventures_narrator_voice_id_fkey
  foreign key (narrator_voice_id) references voice_profiles (id) on delete set null;
