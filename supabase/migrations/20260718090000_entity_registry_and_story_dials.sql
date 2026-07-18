-- Phase 3b addendum 3 (F04 SS2.1 + SS4.2): entity registry + story dials.
--
-- chapters.entities: the chapter's named-entity list [{kind 'npc'|'location', name, note}] -
-- the cohesion contract between the story stages (1-2, which name entities in prose) and the
-- content stage (4, which must produce a row for every listed entity). Stage 1's GLOBAL registry
-- lives inside adventures.meta_loop (jsonb, no schema change needed).
--
-- adventures.story_dials: 2-4 adventure-specific trajectory axes [{key, name, description}]
-- declared by stage 8; ending trigger signals may reference them by key with a -5..5 threshold.
-- Live dial VALUES are F08 state (Phase 6), not stored here.

alter table chapters add column entities jsonb not null default '[]'::jsonb;
alter table adventures add column story_dials jsonb not null default '[]'::jsonb;
