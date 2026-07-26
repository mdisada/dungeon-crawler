-- Personal hook slots + bindings (story-engine overhaul, 2026-07-26).
--
-- An adventure is authored before anyone knows who will play it - min_players/max_players is all
-- the guide has. So per-player content is authored as SLOTS keyed to archetype axes (a background
-- theme, a class, a motive), and bound to real characters once, at first session. This
-- generalizes two patterns already in the codebase: hooks.from_ref backstory slots (authored with
-- a null source) and affinity.ts's bindCoopSet (matched to concrete characters in firstSessionPass).
--
-- HARD INVARIANT, enforced by the stage-8 lint: a personal atom may NEVER appear in a story-node
-- transition, an objective predicate, or an ending signal. Personal arcs gate REWARDS and
-- epilogue colour only. That is what keeps a 2-player run and a 5-player run the same story, keeps
-- the reachability question tractable, and stops one absent player's unfinished arc from stranding
-- the table.

create table personal_slots (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  key text not null,
  -- Archetype axes this slot fits, matched against a character at binding:
  -- {background_tags: [], class_keys: [], themes: []}. Never a named person - the party is unknown.
  archetype jsonb not null default '{}'::jsonb,
  -- Seed for the 2-3 sentence per-player intro: WHY this character is here. Establishes a stake,
  -- never an agreement - motivation is what accepting the offer creates (F08 SS9.1).
  intro_seed text not null default '',
  -- {label, predicate, reward: {gold?, boon?, epilogue_tag?}} - predicate over PERSONAL atoms only.
  objective_template jsonb not null default '{}'::jsonb,
  -- Where this slot's content can surface: [{node_key, overlay_seed}]. Content INSIDE existing
  -- nodes - never new topology, so party size never changes the graph.
  overlay_attachments jsonb not null default '[]'::jsonb,
  human_edited boolean not null default false,
  pending_regen jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (adventure_id, key)
);

create index personal_slots_adventure_id_idx on personal_slots (adventure_id);

alter table personal_slots enable row level security;

create policy personal_slots_select_own on personal_slots for select using (owns_adventure(adventure_id));
create policy personal_slots_insert_own on personal_slots for insert with check (owns_adventure(adventure_id));
create policy personal_slots_update_own on personal_slots for update using (owns_adventure(adventure_id));
create policy personal_slots_delete_own on personal_slots for delete using (owns_adventure(adventure_id));

-- One row per character who got a slot at first session. Play-time state: service-role write,
-- party-visible read (the player-visible subset also travels in GameState.players.list[].personal).
create table personal_bindings (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  character_id uuid not null references characters (id) on delete cascade,
  slot_id uuid not null references personal_slots (id) on delete cascade,
  -- The instantiated intro, written from the slot seed + THIS character's own authored fields.
  intro_text text not null default '',
  -- The instantiated personal objective {label, predicate, reward}.
  objective jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'completed', 'failed')),
  -- Payout idempotency guard, mirroring quest_offers.paid_at: a personal reward pays exactly once.
  reward_paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (adventure_id, character_id)
);

create index personal_bindings_adventure_id_idx on personal_bindings (adventure_id);

alter table personal_bindings enable row level security;

-- Party members read (a character's stake is table-visible, like their name and class).
create policy personal_bindings_select_members on personal_bindings
  for select to authenticated using (is_adventure_member(adventure_id));
