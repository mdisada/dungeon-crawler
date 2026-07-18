-- Phase 4 (F05 SS4, F06 SS6): session lifecycle + the authoritative live-state row.
--
-- adventure_state scaffolds F07's single-writer contract early: one jsonb GameState per
-- adventure plus a monotonically increasing state_version. Only the service role (the
-- `session` edge function - later F07's Adventure Manager) ever writes it; clients receive
-- diffs over Realtime and resync through the function, which strips DM-only domains for
-- players. Direct select is therefore DM-only (flagged on the Phase 4 checkpoint).

create table sessions (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  index integer not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (adventure_id, index)
);

create index sessions_adventure_id_idx on sessions (adventure_id);

create table checkpoints (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  session_id uuid references sessions (id) on delete set null,
  created_at timestamptz not null default now(),
  label text,
  -- 'manual' rows are kept forever; 'auto' rows are pruned to the newest 20 (F05 SS4.2).
  kind text not null default 'auto' check (kind in ('auto', 'manual')),
  state_version bigint not null default 0,
  state_snapshot jsonb not null
);

create index checkpoints_adventure_id_idx on checkpoints (adventure_id, created_at desc);

create table session_summaries (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  session_id uuid not null references sessions (id) on delete cascade,
  -- Structured Summarizer output (events, NPC state changes, promises, items, objective
  -- progress). Spoiler-safe by construction - it feeds the player-visible recap.
  summary jsonb not null,
  created_at timestamptz not null default now()
);

create index session_summaries_adventure_id_idx on session_summaries (adventure_id);

-- FK columns that close the F05 SS4 loop, added after both tables exist.
alter table sessions add column start_checkpoint_id uuid references checkpoints (id) on delete set null;
alter table sessions add column end_summary_id uuid references session_summaries (id) on delete set null;

create table adventure_state (
  adventure_id uuid primary key references adventures (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  state_version bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Append-only resolved-event log (MAIN-SPEC SS7.2). Phase 4 writes lifecycle + demo-driver
-- events; F07 makes it the live source of truth. Feeds the end-of-session Summarizer.
create table event_log (
  id bigint generated always as identity primary key,
  adventure_id uuid not null references adventures (id) on delete cascade,
  session_id uuid references sessions (id) on delete set null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index event_log_adventure_id_idx on event_log (adventure_id, id);
create index event_log_session_id_idx on event_log (session_id);

alter table sessions enable row level security;
alter table checkpoints enable row level security;
alter table session_summaries enable row level security;
alter table adventure_state enable row level security;
alter table event_log enable row level security;

-- Members see the session list and (spoiler-safe) summaries; snapshots, raw state, and the
-- event log stay DM-side. All writes are service-role-only: no insert/update/delete policies.
create policy "sessions_select_member" on sessions
  for select using (is_adventure_member(adventure_id));

create policy "checkpoints_select_dm" on checkpoints
  for select using (is_adventure_dm(adventure_id));

create policy "session_summaries_select_member" on session_summaries
  for select using (is_adventure_member(adventure_id));

create policy "adventure_state_select_dm" on adventure_state
  for select using (is_adventure_dm(adventure_id));

create policy "event_log_select_dm" on event_log
  for select using (is_adventure_dm(adventure_id));
