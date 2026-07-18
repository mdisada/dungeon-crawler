-- Phase 5 (F07 SS4 + F10 SS5-6): proposal pipeline, per-PC NPC dispositions, and NPC
-- interaction memory. All three tables are service-role-write-only (the session function is
-- the single writer); clients get at most DM-scoped reads via the Phase 4 security-definer
-- helpers. approval_mode 'auto' is the built-and-tested default this phase - the human
-- accept/edit/reject console lands in Phase 10 (docs/DECISIONS.md 2026-07-18).

create table proposals (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  session_id uuid references sessions (id) on delete set null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  options jsonb,
  approval_mode text not null check (approval_mode in ('human', 'auto')),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'edited', 'rejected', 'expired', 'auto_applied')),
  -- {chosen_option?, edit_diff?, decided_by, decided_at} - null until decided/auto-applied.
  decision jsonb,
  context_refs jsonb,
  blocking boolean not null default false,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index proposals_adventure_id_idx on proposals (adventure_id, created_at desc);
create index proposals_pending_idx on proposals (adventure_id) where status = 'pending';

alter table proposals enable row level security;

-- DM-only read (proposals carry hidden context); writes stay service-role only.
create policy proposals_select_dm on proposals
  for select using (is_adventure_dm(adventure_id));

create table npc_dispositions (
  npc_id uuid not null references npcs (id) on delete cascade,
  character_id uuid not null references characters (id) on delete cascade,
  adventure_id uuid not null references adventures (id) on delete cascade,
  value integer not null default 0 check (value between -10 and 10),
  updated_at timestamptz not null default now(),
  primary key (npc_id, character_id)
);

create index npc_dispositions_adventure_id_idx on npc_dispositions (adventure_id);

alter table npc_dispositions enable row level security;

-- Numbers + reasons surface on the DM sidebar only (F10 SS5); players read nothing.
create policy npc_dispositions_select_dm on npc_dispositions
  for select using (is_adventure_dm(adventure_id));

create table npc_interactions (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  npc_id uuid not null references npcs (id) on delete cascade,
  session_id uuid references sessions (id) on delete set null,
  -- Summarizer distillation (F10 SS6): what was said/promised/revealed + disposition arc.
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index npc_interactions_npc_id_idx on npc_interactions (npc_id, created_at desc);
create index npc_interactions_adventure_id_idx on npc_interactions (adventure_id);

alter table npc_interactions enable row level security;

create policy npc_interactions_select_dm on npc_interactions
  for select using (is_adventure_dm(adventure_id));

-- Generated on-the-fly NPCs (F10 SS4) are ordinary npcs rows with this flag; promotable to
-- full NPCs in the guide editor later.
alter table npcs add column generated boolean not null default false;

-- Backfill Phase 4 GameState rows with the Phase 5 dialogue/dm fields (typing, pending,
-- openings, addressed PC, consistency facts, conversation state) so the new code never reads
-- an undefined domain field. Merge-patch semantics keep everything else intact.
update adventure_state
set state = state
  || jsonb_build_object(
    'dialogue',
    coalesce(state->'dialogue', '{}'::jsonb)
      || '{"typing": false, "pending": null, "openings": [], "addressedCharacterId": null}'::jsonb
  )
  || case
    when state->'dm' is not null and state->'dm' <> 'null'::jsonb then jsonb_build_object(
      'dm',
      (state->'dm')
        || '{"facts": {"npcStates": {}}, "conversation": {"topicStack": [], "revealedThisScene": [], "pendingContext": null}}'::jsonb
    )
    else '{}'::jsonb
  end;
