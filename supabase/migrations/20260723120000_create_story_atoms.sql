-- Canonical atom registry (story-engine overhaul Phase 1). Every milestone atom a predicate
-- can complete through gets one row: spine atoms extracted from objective predicates at
-- guide time (stage 3), local atoms registered explicitly by the beat planner at plan time.
-- Slugs are the canonical identity (packages/rules/src/story/atoms.ts canonicalizeAtomSlug);
-- `label` is the exact authored text as it appears in predicates - what evaluation matches.
--
-- The registry's job is uniqueness + canonicalization + menus + lint, NOT foreign keys:
-- predicates are jsonb and keep human-readable atom strings by design.

create table story_atoms (
  id uuid primary key default gen_random_uuid(),
  adventure_id uuid not null references adventures (id) on delete cascade,
  slug text not null,
  kind text not null check (kind in ('flag', 'event', 'fact')),
  scope text not null check (scope in ('spine', 'local')),
  label text not null,
  source_table text not null,
  source_id uuid,
  created_at timestamptz not null default now(),
  unique (adventure_id, slug)
);

create index story_atoms_adventure_id on story_atoms (adventure_id);

alter table story_atoms enable row level security;

-- Same visibility as the rest of the guide content: adventure members read, creator writes
-- (the pipeline and session functions write via service role, which bypasses RLS).
create policy "story_atoms_select_members" on story_atoms
  for select to authenticated using (is_adventure_member(adventure_id));
