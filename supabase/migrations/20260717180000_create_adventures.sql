-- Phase 3a (F03 SS4): adventures - wizard draft + lifecycle row. Creator-only RLS for now;
-- player/lobby access arrives with F05's membership model and will add its own policies then.
-- `mode`/`type` are nullable because a draft starts with neither chosen (the CTA validates them
-- before generation), unlike the spec's implied not-null final shape.

create table adventures (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users (id) on delete cascade,
  dm_user_id uuid references auth.users (id) on delete set null,

  mode text check (mode in ('full_ai', 'assist')),
  min_players integer not null default 1 check (min_players between 1 and 8),
  max_players integer not null default 4 check (max_players between 1 and 8),
  type text check (type in ('one_shot', 'multi_chapter')),
  chapters_min integer check (chapters_min between 2 and 12),
  chapters_max integer check (chapters_max between 2 and 12),

  plot_idea text not null default '',
  -- Undo/redo snapshot stack (F03 SS3.4): { "entries": text[], "index": int }, capped at 25
  -- entries client-side. Stored as a single jsonb object (not the spec's jsonb[]) so the cursor
  -- position survives reload too - flagged on the Phase 3a checkpoint.
  plot_history jsonb not null default '{"entries": [""], "index": 0}'::jsonb,

  status text not null default 'draft'
    check (status in ('draft', 'generating', 'guide_ready', 'active', 'completed', 'archived')),
  narrator_voice_id text,
  -- Full-AI only: difficulty fixed at creation (F09 modifier set later; { "preset": text } now).
  difficulty_setting jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (min_players <= max_players),
  check (chapters_min is null or chapters_max is null or chapters_min <= chapters_max)
);

create index adventures_creator_id_idx on adventures (creator_id);

alter table adventures enable row level security;

create policy "adventures_select_own" on adventures
  for select using (auth.uid() = creator_id);

create policy "adventures_insert_own" on adventures
  for insert with check (auth.uid() = creator_id);

create policy "adventures_update_own" on adventures
  for update using (auth.uid() = creator_id);

create policy "adventures_delete_own" on adventures
  for delete using (auth.uid() = creator_id);
