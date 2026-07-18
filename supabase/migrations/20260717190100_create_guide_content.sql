-- Phase 3b (F04 SS3): Adventure Guide content tables. Every table hangs off adventures and is
-- creator-only for now (player/lobby read access arrives with F05's membership model, mirroring
-- the note on 20260717180000_create_adventures.sql).
--
-- Deviations from the F04 SS3 sketch (flagged on the Phase 3b checkpoint):
-- - scenes/objectives carry a denormalized adventure_id so RLS stays one EXISTS deep.
-- - generated-content tables carry `human_edited` + `pending_regen` to implement SS7's
--   "regeneration proposes a diff view when a row was human-edited" without clobbering rows.
-- - coop_sets is a real table (the SS4.1 combined `reveals` text "lives on the coop_set").
-- - guide_warnings is a real table for the Stage 7 consistency flags (SS2: "surfaced as
--   warnings in the editor (never silent rewrites)").
-- - adventures gains meta_loop jsonb (Stage 1 output: meta loop record, per MAIN-SPEC SS7.2).

alter table adventures add column meta_loop jsonb;

-- Shared ownership predicate for all guide-content RLS below. Not security definer: it runs
-- with the caller's rights, so it simply mirrors the adventures_select_own policy.
create function owns_adventure(adv_id uuid) returns boolean
language sql stable as $$
  select exists (select 1 from adventures a where a.id = adv_id and a.creator_id = auth.uid())
$$;

create table chapters (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  index integer not null,
  title text not null default '',
  arc_summary text not null default '',
  status text not null default 'pending' check (status in ('pending', 'active', 'completed')),
  human_edited boolean not null default false,
  pending_regen jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chapters_adventure_id_idx on chapters (adventure_id);

create table scenes (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  chapter_id uuid not null references chapters (id) on delete cascade,
  index integer not null,
  sketch text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index scenes_chapter_id_idx on scenes (chapter_id);
create index scenes_adventure_id_idx on scenes (adventure_id);

create table npcs (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  chapter_id uuid references chapters (id) on delete set null,
  name text not null default '',
  role text not null default 'npc' check (role in ('npc', 'boss')),
  personality jsonb not null default '{}'::jsonb,
  stat_block_ref jsonb,
  faction text not null default '',
  voice_id uuid references voice_profiles (id) on delete set null,
  image_prompt text not null default '',
  images jsonb not null default '{}'::jsonb,
  description text not null default '',
  tactics_profile jsonb,
  boss_phases jsonb,
  human_edited boolean not null default false,
  pending_regen jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index npcs_adventure_id_idx on npcs (adventure_id);

create table locations (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  chapter_id uuid references chapters (id) on delete set null,
  name text not null default '',
  description text not null default '',
  image_prompt text not null default '',
  background_url text,
  -- SS5.3 "regenerate keeps last 3" - superseded background image paths, newest first.
  previous_background_urls text[] not null default '{}',
  map jsonb,
  human_edited boolean not null default false,
  pending_regen jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index locations_adventure_id_idx on locations (adventure_id);

create table objectives (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  chapter_id uuid not null references chapters (id) on delete cascade,
  index integer not null,
  title text not null default '',
  hidden_description text not null default '',
  completion_predicates jsonb,
  reveal_state text not null default 'hidden'
    check (reveal_state in ('hidden', 'revealed', 'active', 'completed')),
  linked_location_ids uuid[] not null default '{}',
  linked_npc_ids uuid[] not null default '{}',
  encounter_ids uuid[] not null default '{}',
  human_edited boolean not null default false,
  pending_regen jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index objectives_chapter_id_idx on objectives (chapter_id);
create index objectives_adventure_id_idx on objectives (adventure_id);

create table coop_sets (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  chapter_id uuid references chapters (id) on delete set null,
  kind text not null check (kind in ('split_knowledge', 'complementary_obstacle')),
  -- SS4.1: the pooled information lives on the set, never on a single member clue.
  reveals text not null default '',
  human_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index coop_sets_adventure_id_idx on coop_sets (adventure_id);

create table ingredients (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  chapter_id uuid references chapters (id) on delete set null,
  type text not null check (type in ('clue', 'secret', 'event', 'item', 'rumor')),
  content jsonb not null default '{}'::jsonb,
  placement jsonb not null default '{}'::jsonb,
  reveals text not null default '',
  pillar_tags text[] not null default '{}',
  reveals_to jsonb,
  coop_set_id uuid references coop_sets (id) on delete set null,
  objective_links uuid[] not null default '{}',
  discovered boolean not null default false,
  canon_source text not null default 'generated'
    check (canon_source in ('generated', 'dm', 'player_theory')),
  human_edited boolean not null default false,
  pending_regen jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ingredients_adventure_id_idx on ingredients (adventure_id);
create index ingredients_coop_set_id_idx on ingredients (coop_set_id);

create table hooks (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  -- {"table": "npcs"|"locations"|"ingredients", "id": uuid} - the content this hook hangs on.
  from_ref jsonb not null,
  to_objective_id uuid not null references objectives (id) on delete cascade,
  hook_text text not null default '',
  kind text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index hooks_adventure_id_idx on hooks (adventure_id);

create table encounters (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  chapter_id uuid references chapters (id) on delete set null,
  type text not null check (type in ('battle', 'social', 'environment')),
  spec jsonb not null default '{}'::jsonb,
  budget jsonb not null default '{}'::jsonb,
  location_id uuid references locations (id) on delete set null,
  human_edited boolean not null default false,
  pending_regen jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index encounters_adventure_id_idx on encounters (adventure_id);

create table guide_warnings (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  -- Which pipeline stage produced it (5 = budget verdicts, 7 = consistency pass) - reruns of a
  -- stage replace only their own warnings.
  stage integer not null default 7,
  target_table text,
  target_id uuid,
  message text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index guide_warnings_adventure_id_idx on guide_warnings (adventure_id);

-- Identical creator-only RLS on every guide table: full CRUD for the adventure owner (the
-- editor writes rows directly); the pipeline writes with the service role and bypasses RLS.
do $$
declare
  t text;
begin
  foreach t in array array[
    'chapters', 'scenes', 'npcs', 'locations', 'objectives',
    'coop_sets', 'ingredients', 'hooks', 'encounters', 'guide_warnings'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select using (owns_adventure(adventure_id))',
      t || '_select_own', t);
    execute format(
      'create policy %I on %I for insert with check (owns_adventure(adventure_id))',
      t || '_insert_own', t);
    execute format(
      'create policy %I on %I for update using (owns_adventure(adventure_id))',
      t || '_update_own', t);
    execute format(
      'create policy %I on %I for delete using (owns_adventure(adventure_id))',
      t || '_delete_own', t);
  end loop;
end $$;

-- NPC/location/map images. Private bucket; owner-scoped via the {adventure_id} path prefix
-- (path convention: adventure-media/{adventure_id}/...). objects.name kept qualified - see the
-- F02 storage-policy bug fixed in 20260717170000.
insert into storage.buckets (id, name, public)
values ('adventure-media', 'adventure-media', false)
on conflict (id) do nothing;

create policy "adventure_media_select_own" on storage.objects
  for select using (
    bucket_id = 'adventure-media'
    and exists (
      select 1 from adventures a
      where a.id::text = (storage.foldername(objects.name))[1]
      and a.creator_id = auth.uid()
    )
  );

create policy "adventure_media_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'adventure-media'
    and exists (
      select 1 from adventures a
      where a.id::text = (storage.foldername(objects.name))[1]
      and a.creator_id = auth.uid()
    )
  );

create policy "adventure_media_update_own" on storage.objects
  for update using (
    bucket_id = 'adventure-media'
    and exists (
      select 1 from adventures a
      where a.id::text = (storage.foldername(objects.name))[1]
      and a.creator_id = auth.uid()
    )
  );

create policy "adventure_media_delete_own" on storage.objects
  for delete using (
    bucket_id = 'adventure-media'
    and exists (
      select 1 from adventures a
      where a.id::text = (storage.foldername(objects.name))[1]
      and a.creator_id = auth.uid()
    )
  );
