-- Phase 2 (F02 SS3 steps 1 & 4, SS5): SRD 5.2.1 species (races) and backgrounds reference tables.
-- Read-only rules content ingested from Open5e's srd-2024 document (see supabase/seed/ingest-srd.mjs
-- and NOTICE.md). In the 2024 SRD, ability-score increases come from the *background*, not the
-- species (see docs/DECISIONS.md 2026-07-17 "F2 build") - so srd_backgrounds carries the ASI's
-- eligible abilities, while srd_races carries traits only.
--
-- Note: unlike the Phase 0 srd_* tables (which have no RLS), these enable RLS with a read-only
-- public policy - strictly safer (writes denied) while staying readable by authenticated clients.
-- The Phase 0 srd_* tables should get the same treatment (flagged in the F02 checkpoint).

create table if not exists srd_races (
  key text primary key,
  name text not null,
  size text,                 -- best-effort from the "Size" trait prose; may be null
  speed text,                -- best-effort from the "Speed" trait prose; may be null
  traits jsonb not null,     -- [{ name, desc }] - shown read-only in the wizard
  data jsonb not null,       -- full Open5e species payload
  source text not null default 'srd-5.2.1'
);

create table if not exists srd_backgrounds (
  key text primary key,
  name text not null,
  ability_options jsonb not null,       -- ["Strength","Dexterity","Constitution"] - ASI eligible abilities
  skill_proficiencies jsonb not null,   -- ["Athletics","Intimidation"] - granted (fixed) skills
  tool_proficiency jsonb,               -- { desc } (may be a choice, e.g. "one kind of Gaming Set")
  feat text,                            -- Origin feat name (mechanics out of v1 scope)
  equipment jsonb,                      -- { desc } - the A/B equipment choice text
  data jsonb not null,                  -- full Open5e background payload
  source text not null default 'srd-5.2.1'
);

alter table srd_races enable row level security;
alter table srd_backgrounds enable row level security;

create policy "srd_races_read_all" on srd_races for select using (true);
create policy "srd_backgrounds_read_all" on srd_backgrounds for select using (true);
