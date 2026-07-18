-- Phase 2 (F02 SS5, SS9): player characters. Owner-only RLS, mirroring the profiles/user_settings
-- pattern from Phase 1. `ruleset` + the raw authoring-choice columns (abilities, ability_bonuses,
-- skill/tool proficiencies, equipment) exist so a character can be re-derived under a different
-- ruleset later rather than only storing frozen derived math - see docs/DECISIONS.md 2026-07-17
-- "F2 build" and docs/F02-character-page-creator.md SS9.

create table characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default '',

  ruleset text not null default 'srd-5.2.1',
  race_key text references srd_races (key),
  class_key text references srd_classes (key),
  background_key text references srd_backgrounds (key),
  level integer not null default 1,
  alignment text,

  -- Base ability scores (pre-ASI) chosen via Standard Array / Point Buy / Manual.
  abilities jsonb not null default '{}'::jsonb,
  -- The chosen ASI assignment (srd-5.2.1: from the background's ability_options), e.g.
  -- { "str": 2, "dex": 1 } or { "str": 1, "dex": 1, "con": 1 }. Applied on top of `abilities` by
  -- packages/rules, never pre-summed into this row.
  ability_bonuses jsonb not null default '{}'::jsonb,

  skill_proficiencies text[] not null default '{}',
  tool_proficiencies text[] not null default '{}',
  equipment jsonb not null default '[]'::jsonb,

  hp_max integer,
  hp_current integer,
  hp_temp integer not null default 0,
  xp integer not null default 0,

  personality jsonb not null default '{}'::jsonb,
  freeform_text text not null default '',
  physical jsonb not null default '{}'::jsonb,
  background_narrative text,

  images jsonb not null default '{}'::jsonb,
  persistent_conditions jsonb not null default '[]'::jsonb,

  draft jsonb not null default '{}'::jsonb,
  is_complete boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index characters_user_id_idx on characters (user_id);

alter table characters enable row level security;

create policy "characters_select_own" on characters
  for select using (auth.uid() = user_id);

create policy "characters_insert_own" on characters
  for insert with check (auth.uid() = user_id);

create policy "characters_update_own" on characters
  for update using (auth.uid() = user_id);

create policy "characters_delete_own" on characters
  for delete using (auth.uid() = user_id);

-- Portrait/crop image set. Private bucket; owner-scoped via the {character_id} path prefix
-- checked against characters.user_id (path convention: characters/{character_id}/... , see
-- docs/F02-character-page-creator.md SS4-5).
insert into storage.buckets (id, name, public)
values ('characters', 'characters', false)
on conflict (id) do nothing;

create policy "characters_storage_select_own" on storage.objects
  for select using (
    bucket_id = 'characters'
    and exists (
      select 1 from characters c
      where c.id::text = (storage.foldername(name))[1]
      and c.user_id = auth.uid()
    )
  );

create policy "characters_storage_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'characters'
    and exists (
      select 1 from characters c
      where c.id::text = (storage.foldername(name))[1]
      and c.user_id = auth.uid()
    )
  );

create policy "characters_storage_update_own" on storage.objects
  for update using (
    bucket_id = 'characters'
    and exists (
      select 1 from characters c
      where c.id::text = (storage.foldername(name))[1]
      and c.user_id = auth.uid()
    )
  );

create policy "characters_storage_delete_own" on storage.objects
  for delete using (
    bucket_id = 'characters'
    and exists (
      select 1 from characters c
      where c.id::text = (storage.foldername(name))[1]
      and c.user_id = auth.uid()
    )
  );
