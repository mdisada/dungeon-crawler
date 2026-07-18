-- Phase 6 slice 2 (F04 SS4.3): quest contracts join the guide-editor conventions - row-level
-- autosave marks human_edited so a Stage 6 re-run preserves creator edits instead of
-- clobbering them (same contract as every other guide-content table).

alter table quest_contracts add column human_edited boolean not null default false;
alter table quest_contracts add column updated_at timestamptz not null default now();
