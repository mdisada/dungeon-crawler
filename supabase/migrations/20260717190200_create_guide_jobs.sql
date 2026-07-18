-- Phase 3b (F04 SS2): pipeline job rows. One row per (stage, chapter-slice) of a guide
-- generation run; the guide-pipeline edge function is the only writer (service role - no
-- insert/update/delete policies here). The editor polls these for live stage progress and a
-- failed row's retry button re-invokes the function.

create table guide_jobs (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  stage integer not null check (stage between 1 and 7),
  chapter_id uuid references chapters (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed')),
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index guide_jobs_adventure_id_idx on guide_jobs (adventure_id);

-- One live job per stage slice; retries reset the row instead of appending history.
create unique index guide_jobs_stage_slice_unique
  on guide_jobs (adventure_id, stage, coalesce(chapter_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table guide_jobs enable row level security;

create policy "guide_jobs_select_own" on guide_jobs
  for select using (owns_adventure(adventure_id));
