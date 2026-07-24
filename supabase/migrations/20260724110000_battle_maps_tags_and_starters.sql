-- Battle-map tags + public "starter" maps (map-pipeline feature).
--
-- Tags: a text[] with a GIN index for tag-match map lookups (dungeon/forest/crypt...).
-- Starter maps: maps owned by the admin starter account (mig.isada@gmail.com) are public - every
-- user can read them (to browse/seed a location from a starter). A single is_public boolean drives
-- it: a one-time backfill stamps existing rows, and a before-insert trigger auto-publishes that
-- account's future uploads. Owner-only insert/update/delete are unchanged, so only the admin
-- account can create or edit starters.
--
-- Storage caveat: the battle-maps bucket is PRIVATE and its read policy is folder[1]=auth.uid(),
-- so table-level public read alone would render broken images. A second storage SELECT policy lets
-- any user read the image of a battle_maps row marked public (joined by path == object name).

alter table battle_maps
  add column tags text[] not null default '{}',
  add column is_public boolean not null default false;

create index battle_maps_tags_gin_idx on battle_maps using gin (tags);
create index battle_maps_is_public_idx on battle_maps (is_public) where is_public;

-- Public read of starter maps (OR-ed with the existing owner select policy).
create policy "battle_maps_select_public" on battle_maps
  for select using (is_public);

-- Public read of starter map IMAGES from the private bucket (the load-bearing storage policy).
create policy "battle_maps_storage_select_public" on storage.objects
  for select using (
    bucket_id = 'battle-maps'
    and exists (
      select 1 from public.battle_maps m
      where m.path = objects.name and m.is_public
    )
  );

-- Auto-publish maps uploaded by the admin starter account. SECURITY DEFINER so it can read
-- auth.users; empty search_path forces schema-qualification (Supabase security lint).
create function public.battle_maps_autopublish() returns trigger
  language plpgsql security definer set search_path = '' as $fn$
begin
  if (select email from auth.users where id = new.user_id) = 'mig.isada@gmail.com' then
    new.is_public := true;
  end if;
  return new;
end
$fn$;

create trigger battle_maps_autopublish_trg
  before insert on battle_maps
  for each row execute function public.battle_maps_autopublish();

-- One-time backfill: mark the admin account's existing maps public (no-op on an empty CI DB).
update battle_maps set is_public = true
  where user_id = (select id from auth.users where email = 'mig.isada@gmail.com');
