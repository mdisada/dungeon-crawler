-- F09 SS9 Combat Lab: persistent test maps for the combat harness.
-- battle_maps rows index uploads in the private battle-maps bucket
-- (battle-maps/{user_id}/{map_id}.png). obstacles holds painted blocked cells as
-- [x,y] pairs on the canonical 32x32 grid (same shape as CombatState.obstacles),
-- saved per map so pathfinding/opportunity-attack tests survive refresh.
-- Owner-only access on both table and storage: the Lab is a per-user sandbox
-- (shared live sessions are a later slice and will go through the session function).

create table battle_maps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  path text not null,
  obstacles jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index battle_maps_user_id_idx on battle_maps (user_id);

alter table battle_maps enable row level security;

create policy "battle_maps_select_own" on battle_maps
  for select using (user_id = auth.uid());

create policy "battle_maps_insert_own" on battle_maps
  for insert with check (user_id = auth.uid());

create policy "battle_maps_update_own" on battle_maps
  for update using (user_id = auth.uid());

create policy "battle_maps_delete_own" on battle_maps
  for delete using (user_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('battle-maps', 'battle-maps', false)
on conflict (id) do nothing;

-- Path prefix is the owner's uid directly, so no EXISTS subquery is needed
-- (unlike the characters bucket, whose prefix is a character id).
create policy "battle_maps_storage_select_own" on storage.objects
  for select using (
    bucket_id = 'battle-maps'
    and (storage.foldername(objects.name))[1] = auth.uid()::text
  );

create policy "battle_maps_storage_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'battle-maps'
    and (storage.foldername(objects.name))[1] = auth.uid()::text
  );

create policy "battle_maps_storage_update_own" on storage.objects
  for update using (
    bucket_id = 'battle-maps'
    and (storage.foldername(objects.name))[1] = auth.uid()::text
  );

create policy "battle_maps_storage_delete_own" on storage.objects
  for delete using (
    bucket_id = 'battle-maps'
    and (storage.foldername(objects.name))[1] = auth.uid()::text
  );
