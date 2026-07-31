-- A reusable library of location art: the background plate and the battle map drawn from it, tagged
-- by what kind of place they show (city, dungeon, forest, tavern...).
--
-- Why a table rather than more columns on `locations`: a plate belongs to a PLACE, not to one
-- adventure's row. The same drowned harbour serves every adventure that needs a drowned harbour, and
-- at $0.015 a background plus $0.034 a map, redrawing it each time is the expensive way to get the
-- same picture. `locations` keeps pointing at its own chosen paths; this is the shelf those paths
-- can be picked from.
--
-- Modelled on `battle_maps`, which already solved the same problems (2026-07-24): text[] tags with a
-- GIN index for tag-match lookup, and public "starter" rows owned by the admin account that every
-- user can read. The storage caveat is the same one: adventure-media is private and its read policy
-- is per-adventure, so a public row needs a second storage policy joined on the path.

create table location_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The adventure it was first drawn for. Kept for provenance and for the storage policy; a row
  -- outliving its adventure is the point, so this is nullable and never cascades.
  adventure_id uuid references adventures (id) on delete set null,
  name text not null,
  kind text not null check (kind in ('background', 'map')),
  path text not null,
  tags text[] not null default '{}',
  -- Maps carry the grid the detector read off them; backgrounds leave it null.
  grid_cols int check (grid_cols is null or (grid_cols between 4 and 128)),
  grid_rows int check (grid_rows is null or (grid_rows between 4 and 128)),
  -- The brief that produced it, so a near-miss can be regenerated without rewriting the prompt.
  prompt text,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

create index location_media_user_id_idx on location_media (user_id);
create index location_media_tags_gin_idx on location_media using gin (tags);
create index location_media_kind_idx on location_media (kind);
create index location_media_is_public_idx on location_media (is_public) where is_public;

alter table location_media enable row level security;

create policy "location_media_select_own" on location_media
  for select using (user_id = auth.uid());

create policy "location_media_select_public" on location_media
  for select using (is_public);

create policy "location_media_insert_own" on location_media
  for insert with check (user_id = auth.uid());

create policy "location_media_update_own" on location_media
  for update using (user_id = auth.uid());

create policy "location_media_delete_own" on location_media
  for delete using (user_id = auth.uid());

-- Read the IMAGE of a library row you can see. Without this the private adventure-media bucket
-- would hand back a broken image for every row shared out of the adventure it was drawn in.
create policy "location_media_storage_select" on storage.objects
  for select using (
    bucket_id = 'adventure-media'
    and exists (
      select 1 from public.location_media m
      where m.path = objects.name
        and (m.is_public or m.user_id = auth.uid())
    )
  );

-- Same starter-account rule as battle_maps: art uploaded by the admin account is public, so a new
-- user opens the picker to a stocked shelf instead of an empty one.
create function public.location_media_autopublish() returns trigger
  language plpgsql security definer set search_path = '' as $fn$
begin
  if (select email from auth.users where id = new.user_id) = 'mig.isada@gmail.com' then
    new.is_public := true;
  end if;
  return new;
end
$fn$;

create trigger location_media_autopublish_trg
  before insert on location_media
  for each row execute function public.location_media_autopublish();
