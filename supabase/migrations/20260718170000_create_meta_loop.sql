-- Phase 6 slices 3-4 (F08 SS2, SS8, SS8.1): the meta loop (antagonist plan + suspicion tally)
-- and live ending-selection state on adventures. Service-role write only; DM-scoped reads
-- (antagonist plans and ending scores are the hidden-est info in the system).

create table meta_loop (
  adventure_id uuid primary key references adventures (id) on delete cascade,
  arc_summary text not null default '',
  entry_point text not null default '',
  exit_conditions jsonb not null default '[]'::jsonb,
  -- {steps: [{summary, status: 'pending'|'done'|'stalled'}], current_step: int}
  antagonist_plan jsonb not null default '{"steps": [], "current_step": 0}'::jsonb,
  committed_bbeg_npc_id uuid references npcs (id) on delete set null,
  suspicion_tally jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table meta_loop enable row level security;

create policy meta_loop_select_dm on meta_loop
  for select using (is_adventure_dm(adventure_id));

-- Live ending-selection state (F08 SS8.1): scores/dials on the adventure, statuses on endings.
alter table adventures add column ending_scores jsonb not null default '{}'::jsonb;
alter table adventures add column dial_values jsonb not null default '{}'::jsonb;
alter table adventures add column committed_ending_id uuid references endings (id) on delete set null;
