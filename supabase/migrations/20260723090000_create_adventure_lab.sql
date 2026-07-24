-- Adventure Lab: simulated-playthrough test runs, driven by a LOCAL runner process
-- (tests/lab/lab-runner.mjs) and watched/annotated live from /adventure-lab.
--
-- The browser only enqueues and observes: lab_runs rows are the queue, lab_run_events the
-- structured live log (written by the runner with the service role), lab_comments the user's
-- pinned annotations for later Claude review. The page polls; no realtime channel needed for
-- an internal tool.

create table lab_runs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users (id) on delete cascade,
  -- queued -> running -> done | failed | cancelled
  status text not null default 'queued',
  -- Full run recipe: { mode, plot: {key,title,idea}, type, party_size, quality, turns, budget_usd,
  -- model, adventure_id? } - jsonb so the recipe can grow without migrations.
  config jsonb not null default '{}'::jsonb,
  -- The adventure the run generated (or reused) - kept for inspection and existing-mode reuse.
  adventure_id uuid references adventures (id) on delete set null,
  spent_usd numeric not null default 0,
  -- Compact end-of-run analysis (counts, incidents, pacing) written by the runner.
  summary jsonb,
  error text,
  log_path text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table lab_run_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references lab_runs (id) on delete cascade,
  -- setup | guide | play | analysis
  phase text not null,
  -- The function/step that produced this entry, e.g. 'pipeline.start', 'session.player_intent',
  -- 'player_agent.generate', 'game.narration_published' (mirrored event_log rows).
  fn text not null,
  label text not null default '',
  detail jsonb not null default '{}'::jsonb,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index lab_run_events_run_id_id on lab_run_events (run_id, id);

create table lab_comments (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references lab_runs (id) on delete cascade,
  -- Pin to a specific log row, or null for a run-level comment.
  event_id bigint references lab_run_events (id) on delete set null,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index lab_comments_run_id on lab_comments (run_id);

alter table lab_runs enable row level security;
alter table lab_run_events enable row level security;
alter table lab_comments enable row level security;

-- Owner-scoped: the lab UI is email-gated client-side, but RLS is the real boundary.
create policy "lab_runs_select_own" on lab_runs
  for select to authenticated using (created_by = (select auth.uid()));
create policy "lab_runs_insert_own" on lab_runs
  for insert to authenticated with check (created_by = (select auth.uid()));
-- Cancel button: owners may update their own rows (the runner writes via service role).
create policy "lab_runs_update_own" on lab_runs
  for update to authenticated using (created_by = (select auth.uid()));

create policy "lab_run_events_select_own" on lab_run_events
  for select to authenticated using (
    exists (select 1 from lab_runs r where r.id = run_id and r.created_by = (select auth.uid()))
  );

create policy "lab_comments_select_own" on lab_comments
  for select to authenticated using (
    exists (select 1 from lab_runs r where r.id = run_id and r.created_by = (select auth.uid()))
  );
create policy "lab_comments_insert_own" on lab_comments
  for insert to authenticated with check (
    author_id = (select auth.uid())
    and exists (select 1 from lab_runs r where r.id = run_id and r.created_by = (select auth.uid()))
  );
