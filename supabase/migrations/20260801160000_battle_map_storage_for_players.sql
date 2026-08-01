-- Let the table see the map it is fighting on.
--
-- `battle-maps` storage is owner-only (battle_maps_storage_select_own: the path's first folder must
-- equal auth.uid()). That was right while the bucket served only the Combat Lab, which the original
-- migration calls "a per-user sandbox" - and it stayed invisible after F09 bound library maps to
-- encounters, because the session function signed the artwork with the service role, which bypasses
-- RLS entirely.
--
-- Signing moved to the client on 2026-08-01 (see MediaRef: a signed URL cannot be stored in durable
-- state without rotting). The client signs as the PLAYER, so RLS applies for the first time - and
-- under the owner-only rule every player except the map's owner would get no artwork, including the
-- adventure's own creator whenever the fight uses a public starter map owned by the admin account.
--
-- The other two buckets already had the equivalent grant and are unaffected: adventure-media has
-- `adventure_media_select_member` and characters has `characters_storage_select_party`, both added
-- 2026-07-18 when play stopped being single-player.
--
-- The grant is as narrow as the fact it encodes: you may see a battle map's artwork if that map is
-- assigned to an encounter in an adventure you belong to. Not "if it is public" - a starter map
-- nobody has staged is still nobody's business.
--
-- SECURITY DEFINER is load-bearing. A policy's USING expression runs as the invoking user, so a
-- plain subquery over `battle_maps` would itself be filtered by that table's owner-only RLS and the
-- EXISTS would be false for exactly the players this is meant to admit. Same pattern, and the same
-- reason, as is_adventure_member.

create or replace function battle_map_staged_for_viewer(object_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from battle_maps m
    join encounters e on e.battle_map_id = m.id
    where m.path = object_name
      and is_adventure_member(e.adventure_id)
  );
$$;

comment on function battle_map_staged_for_viewer(text) is
  'True when the battle-maps storage object is the artwork of a map assigned to an encounter in an '
  'adventure the caller belongs to. Used by the storage select policy so players can sign the map '
  'they are fighting on without gaining access to the rest of the owner''s library.';

create policy "battle_maps_storage_select_staged" on storage.objects
  for select using (
    bucket_id = 'battle-maps'
    and battle_map_staged_for_viewer(objects.name)
  );
