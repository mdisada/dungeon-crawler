-- Phase 4 (F05 SS2-3): membership, invites, character locking, and the member-visible surface.
--
-- Access model (flagged on the Phase 4 checkpoint):
-- - adventure_members is client-READ-only. Every write (join, pick, ready, admit, leave) goes
--   through the `session` edge function with the service role so capacity caps, character
--   locking, and min-player gating are enforced server-side and race-free (F05 acceptance:
--   "capacity and min-player gating enforced server-side, not just in UI").
-- - Players never get raw select on `adventures` (plot_idea / meta_loop are spoilers). The
--   member-safe columns are exposed through the `member_adventures` view below; everything
--   else players see during live play arrives role-filtered from the `session` function.

-- 16-char URL-safe invite code (F05 SS2): base64 of 12 random bytes, +/ made URL-safe.
-- Regenerable by the DM through the session function (new code invalidates shared links).
alter table adventures add column invite_code text not null unique
  default substr(translate(encode(gen_random_bytes(12), 'base64'), '+/=', '-_'), 1, 16);

-- Display title for lobby/header (no title existed anywhere in F03/F04; derived from the
-- guide's first chapter title at activation if the creator never sets one - checkpoint note).
alter table adventures add column title text not null default '';

-- F05 SS3: party composition profile - skills/proficiencies, pillar strengths, backstory tags.
-- Recomputed by the session function on membership change.
alter table adventures add column party_profile jsonb;

-- Set by the SEED_DEMO seeder: demo adventures use canned recaps/summaries instead of LLM
-- calls so the scripted demo session never burns credits (DEVELOPMENT-PLAN SS1.3).
alter table adventures add column demo boolean not null default false;

create table adventure_members (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('dm', 'player')),
  character_id uuid references characters (id) on delete set null,
  ready boolean not null default false,
  -- Late joiners after session start spectate until the DM admits them (F05 SS3).
  spectator boolean not null default false,
  joined_at timestamptz not null default now(),
  unique (adventure_id, user_id)
);

create index adventure_members_adventure_id_idx on adventure_members (adventure_id);
create index adventure_members_user_id_idx on adventure_members (user_id);
create index adventure_members_character_id_idx on adventure_members (character_id);

-- Shared membership predicates for all Phase 4+ RLS (created after the table they read).
-- Security definer so policies on adventure_members itself (and on realtime.messages, which
-- has no rights on our tables) can call them without recursive RLS evaluation.
create function is_adventure_member(adv_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from adventure_members m
    where m.adventure_id = adv_id and m.user_id = auth.uid()
  ) or exists (
    select 1 from adventures a
    where a.id = adv_id and a.creator_id = auth.uid()
  )
$$;

create function is_adventure_dm(adv_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from adventure_members m
    where m.adventure_id = adv_id and m.user_id = auth.uid() and m.role = 'dm'
  ) or exists (
    select 1 from adventures a
    where a.id = adv_id and a.creator_id = auth.uid()
  )
$$;

alter table adventure_members enable row level security;

create policy "adventure_members_select_member" on adventure_members
  for select using (is_adventure_member(adventure_id));
-- No insert/update/delete policies: writes are service-role-only via the session function.

-- Character locking (F05 SS3): a picked character is locked to one adventure; unlocked on
-- completion/leave. The pick itself is an atomic service-role UPDATE guarded on this column.
alter table characters add column locked_adventure_id uuid
  references adventures (id) on delete set null;

create index characters_locked_adventure_id_idx on characters (locked_adventure_id);

-- Party members can see each other's picked characters (lobby list, sidebars, DM overview).
create policy "characters_select_party" on characters
  for select using (
    exists (
      select 1 from adventure_members m
      where m.character_id = characters.id and is_adventure_member(m.adventure_id)
    )
  );

-- Member-safe adventure surface. Owner-rights view (security_invoker = off) deliberately
-- bypasses the creator-only RLS on adventures; the WHERE clause scopes rows to the caller's
-- memberships and the column list keeps spoilers (plot_idea, meta_loop, plot_history) out.
create view member_adventures with (security_invoker = off) as
  select a.id, a.title, a.status, a.mode, a.type,
         a.min_players, a.max_players, a.invite_code, a.demo,
         a.creator_id, a.dm_user_id, a.created_at
  from adventures a
  where a.creator_id = auth.uid()
     or exists (
          select 1 from adventure_members m
          where m.adventure_id = a.id and m.user_id = auth.uid()
        );

revoke all on member_adventures from anon, authenticated;
grant select on member_adventures to authenticated;

-- Invite-code lookup happens inside the session function (service role), so no anon/member
-- select path exists for arbitrary adventures by code.

-- Members can read adventure media (location backgrounds, NPC portraits, maps) - the guide
-- editor already granted the creator full CRUD in 20260717190100.
create policy "adventure_media_select_member" on storage.objects
  for select using (
    bucket_id = 'adventure-media'
    and exists (
      select 1 from adventures a
      where a.id::text = (storage.foldername(objects.name))[1]
        and is_adventure_member(a.id)
    )
  );

-- Character images: party members can see each other's portraits/tokens during play.
create policy "characters_storage_select_party" on storage.objects
  for select using (
    bucket_id = 'characters'
    and exists (
      select 1 from adventure_members m
      where m.character_id::text = (storage.foldername(objects.name))[1]
        and is_adventure_member(m.adventure_id)
    )
  );

-- Music for the DM Immersion tab (F06 SS5): DM uploads, members stream.
insert into storage.buckets (id, name, public)
values ('music', 'music', false)
on conflict (id) do nothing;

create policy "music_select_member" on storage.objects
  for select using (
    bucket_id = 'music'
    and exists (
      select 1 from adventures a
      where a.id::text = (storage.foldername(objects.name))[1]
        and is_adventure_member(a.id)
    )
  );

create policy "music_insert_dm" on storage.objects
  for insert with check (
    bucket_id = 'music'
    and exists (
      select 1 from adventures a
      where a.id::text = (storage.foldername(objects.name))[1]
        and is_adventure_dm(a.id)
    )
  );

create policy "music_delete_dm" on storage.objects
  for delete using (
    bucket_id = 'music'
    and exists (
      select 1 from adventures a
      where a.id::text = (storage.foldername(objects.name))[1]
        and is_adventure_dm(a.id)
    )
  );
