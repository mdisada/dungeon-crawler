-- Phase 3b amendment (F04 SS4.2): multiple fluid endings. An adventure carries 3-5 hidden
-- candidate endings; live play (F08 Ending Steward) scores them and commits one near the climax.
-- This migration owns only the authored content shape + the guide-time status seam; the live
-- scoring columns (ending_scores, committed_ending_id) arrive with F08 in Phase 6.
--
-- Stage numbering: the Ending Designer is appended as pipeline stage 8 (rather than inserted
-- mid-sequence) so the already-verified hooks(6)/consistency(7) stages don't renumber. Bump the
-- guide_jobs stage constraint 1-7 -> 1-8 accordingly.

create table endings (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  index integer not null,
  title text not null default '',              -- hidden DM-facing label
  description text not null default '',        -- hidden: what this ending looks like narratively
  climax_summary text not null default '',     -- hidden: how the final confrontation plays out
  tone text not null default '',               -- e.g. tragic / triumphant / pyrrhic / bittersweet
  -- { summary text, signals: [{ predicate <F04 atom>, weight number, note text }] } (F04 SS4.2).
  trigger_conditions jsonb not null default '{"summary": "", "signals": []}'::jsonb,
  exclusivity_group text not null default 'main',
  is_emergent boolean not null default false,  -- authored at guide time = false; live (F08) = true
  -- 'candidate' at guide time; F08's Ending Steward drives leading/committed/discarded.
  status text not null default 'candidate'
    check (status in ('candidate', 'leading', 'committed', 'discarded')),
  human_edited boolean not null default false,
  pending_regen jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index endings_adventure_id_idx on endings (adventure_id);

alter table endings enable row level security;

-- Same creator-only CRUD as the other guide-content tables (owns_adventure() from
-- 20260717190100_create_guide_content.sql); the pipeline writes with the service role.
create policy "endings_select_own" on endings
  for select using (owns_adventure(adventure_id));
create policy "endings_insert_own" on endings
  for insert with check (owns_adventure(adventure_id));
create policy "endings_update_own" on endings
  for update using (owns_adventure(adventure_id));
create policy "endings_delete_own" on endings
  for delete using (owns_adventure(adventure_id));

-- Ending Designer is pipeline stage 8.
alter table guide_jobs drop constraint guide_jobs_stage_check;
alter table guide_jobs add constraint guide_jobs_stage_check check (stage between 1 and 8);
