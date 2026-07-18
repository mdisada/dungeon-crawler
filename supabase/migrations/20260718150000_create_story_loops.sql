-- Phase 6 slice 1 (F08 SS2 + SS2.1, F04 SS4.3): quest contracts (authored negotiation bounds),
-- the core-loop stack + beats, and live quest offers. Contracts are guide content (creator
-- CRUD via owns_adventure, same as 20260717190100); loop/offer tables are play-time state -
-- service-role write only, DM-scoped reads (terms ceilings and beat plans are hidden info;
-- the player-visible subset travels in GameState).

create table quest_contracts (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  chapter_id uuid references chapters (id) on delete set null,
  label text not null,
  giver_npc_id uuid not null references npcs (id) on delete cascade,
  is_entry boolean not null default false,
  -- {gold_floor, gold_ceiling, extras[]} - the bounds live negotiation clamps into (F08 SS2.1).
  reward jsonb not null default '{}'::jsonb,
  stakes text not null default '',
  -- Optional in-fiction deadline, world-clock days: {days}.
  deadline jsonb,
  objective_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

-- Exactly one entry contract per adventure (F04 SS4.3 hard validation backs this up).
create unique index quest_contracts_entry_unique on quest_contracts (adventure_id) where is_entry;
create index quest_contracts_adventure_id_idx on quest_contracts (adventure_id);

alter table quest_contracts enable row level security;

create policy quest_contracts_select_own on quest_contracts for select using (owns_adventure(adventure_id));
create policy quest_contracts_insert_own on quest_contracts for insert with check (owns_adventure(adventure_id));
create policy quest_contracts_update_own on quest_contracts for update using (owns_adventure(adventure_id));
create policy quest_contracts_delete_own on quest_contracts for delete using (owns_adventure(adventure_id));

create table core_loops (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  type text not null check (type in (
    'mystery', 'monster_hunt', 'dungeon_crawl', 'siege_defense', 'infiltration',
    'intrigue', 'rebellion', 'survival', 'escort', 'heist', 'custom'
  )),
  status text not null default 'active' check (status in ('active', 'suspended', 'completed')),
  stack_position integer not null,
  current_beat_id uuid, -- fk added below (beats references core_loops)
  custom_label text,
  opened_at timestamptz not null default now()
);

create index core_loops_adventure_id_idx on core_loops (adventure_id, stack_position desc);

alter table core_loops enable row level security;

create policy core_loops_select_dm on core_loops
  for select using (is_adventure_dm(adventure_id));

create table beats (
  id uuid primary key default gen_random_uuid(),
  core_loop_id uuid not null references core_loops (id) on delete cascade,
  index integer not null,
  name text not null,
  goals jsonb not null default '[]'::jsonb,
  exit_conditions jsonb not null default '[]'::jsonb,
  ingredient_requests jsonb not null default '[]'::jsonb,
  status text not null default 'planned' check (status in ('planned', 'active', 'completed')),
  created_at timestamptz not null default now()
);

create index beats_core_loop_id_idx on beats (core_loop_id, index);

alter table beats enable row level security;

create policy beats_select_dm on beats
  for select using (is_adventure_dm((select adventure_id from core_loops where id = core_loop_id)));

alter table core_loops
  add constraint core_loops_current_beat_fkey
  foreign key (current_beat_id) references beats (id) on delete set null;

create table quest_offers (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  contract_id uuid references quest_contracts (id) on delete set null,
  quest_label text not null,
  giver_npc_id uuid references npcs (id) on delete set null,
  -- {gold, extras[], stakes, deadlineDays} - terms as currently offered/accepted (F08 SS2.1).
  terms jsonb not null default '{}'::jsonb,
  status text not null default 'offered' check (status in ('offered', 'accepted', 'declined', 'expired')),
  core_loop_id uuid references core_loops (id) on delete set null,
  reweave_count integer not null default 0,
  -- Payout idempotency guard: gold credits exactly once (F08 SS10).
  paid_at timestamptz,
  offered_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index quest_offers_adventure_id_idx on quest_offers (adventure_id, offered_at desc);
create index quest_offers_open_idx on quest_offers (adventure_id) where status = 'offered';

alter table quest_offers enable row level security;

create policy quest_offers_select_dm on quest_offers
  for select using (is_adventure_dm(adventure_id));

-- Backfill live GameState rows with the slice-1 fields: the party ledger and the
-- offers/quests journal (merge-patch semantics keep everything else intact).
update adventure_state
set state = state
  || jsonb_build_object(
    'players', coalesce(state->'players', '{}'::jsonb) || '{"gold": 0}'::jsonb
  )
  || jsonb_build_object(
    'objectives', coalesce(state->'objectives', '{}'::jsonb) || '{"offers": [], "quests": []}'::jsonb
  );
