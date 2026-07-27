-- Authored story graph (story-engine overhaul, 2026-07-26). The BG3 move: hoist beat/encounter
-- authoring OUT of runtime and INTO guide generation, where a bad output is linted and
-- regenerated invisibly instead of shipping to a player mid-session.
--
-- Until now `beats` (+ beats.encounter_spec) were RUNTIME state written by planAndOpenBeat's two
-- LLM calls every turn - the largest remaining live-failure surface. `story_nodes` is the
-- authored, pre-linted graph those beats now instantiate FROM: each node carries the same
-- encounter_spec shape a beat used to, plus the authored transitions/affordances that let the
-- runtime NAVIGATE instead of PLAN. A runtime beats row keeps existing (beats.node_id points at
-- the node it came from) so every downstream consumer - route-health, the lab inspector,
-- openBeatSpec - keeps working unchanged.
--
-- This is guide content, authored by stage 5 and editable in the guide editor exactly like
-- objectives/encounters (which also hold hidden info). Creator-only RLS via owns_adventure; the
-- pipeline and session functions write via the service role and bypass it. The player-visible
-- subset (the current node's affordances -> choice chips) travels through GameState, never a
-- direct read.

create table story_nodes (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  chapter_id uuid not null references chapters (id) on delete cascade,
  objective_id uuid not null references objectives (id) on delete cascade,
  -- Stable authoring identity, unique per adventure. Transitions reference nodes by key (not id)
  -- so a guide can be authored/edited/regenerated before ids settle, mirroring the entity handles
  -- stages 6/7 already use.
  key text not null,
  index integer not null default 0,
  kind text not null check (kind in ('skill_challenge', 'social', 'puzzle', 'combat')),
  -- 'route' = an authored way through the objective (>= 2 required per objective, Three-Clue Rule).
  -- 'rescue' = the materialized guaranteed_route, the director's rung-4 target of last resort.
  role text not null default 'route' check (role in ('route', 'rescue')),
  label text not null default '',
  -- The authored cutscene/exposition intent the narrator opens the node with (the "what").
  narration_seed text not null default '',
  -- Same shape beats.encounter_spec has always used: {kind,label,stakes,rationale,template,twist,
  -- params,npc_ids,exits,on_success,on_partial,on_failure}. Outcome-map atoms are lint-verified
  -- (subset of the registry) BEFORE guide_ready, so the runtime never authors or repairs them.
  encounter_spec jsonb,
  -- 3-5 authored engagement options: [{key, label, hint}]. Surfaced to players as choice chips
  -- and to the closed-menu entry mapper. The label's mechanical half is code-derived from the
  -- spec at authoring; the LLM writes only the flavor hint, so a chip cannot contradict its spec.
  affordances jsonb not null default '[]'::jsonb,
  -- [{on: 'full'|'partial'|'failed'|<predicate>, to_node_key, arrival_context}]. arrival_context
  -- is the tier-aware "how" the narrator uses when the party ARRIVES via this edge, so a failed
  -- outcome is never narrated from the destination's success-flavored seed.
  transitions jsonb not null default '[]'::jsonb,
  -- Atoms this node declares (kind 'flag'|'event'), registered into story_atoms (scope 'local')
  -- at AUTHORING - runtime atom invention ends. [{name, kind}].
  local_atoms jsonb not null default '[]'::jsonb,
  human_edited boolean not null default false,
  pending_regen jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (adventure_id, key)
);

create index story_nodes_adventure_id_idx on story_nodes (adventure_id);
create index story_nodes_objective_id_idx on story_nodes (objective_id, index);

alter table story_nodes enable row level security;

-- Creator-only CRUD, identical to the other guide-content tables (20260717190100).
create policy story_nodes_select_own on story_nodes for select using (owns_adventure(adventure_id));
create policy story_nodes_insert_own on story_nodes for insert with check (owns_adventure(adventure_id));
create policy story_nodes_update_own on story_nodes for update using (owns_adventure(adventure_id));
create policy story_nodes_delete_own on story_nodes for delete using (owns_adventure(adventure_id));

-- A runtime beat records which authored node instantiated it (null for legacy guides with no
-- graph, and for ad-hoc micro-encounters the escape valve still spins up at runtime).
alter table beats add column if not exists node_id uuid references story_nodes (id) on delete set null;

-- Personal-slot atoms (Phase 3) get their own scope. Kept strictly separate from spine/local so
-- the reachability lint can enforce the hard invariant: a 'personal' atom may NEVER appear in a
-- node transition, objective predicate, or ending signal - it gates rewards only.
alter table story_atoms drop constraint if exists story_atoms_scope_check;
alter table story_atoms add constraint story_atoms_scope_check
  check (scope in ('spine', 'local', 'personal'));
