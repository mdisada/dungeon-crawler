-- Phase 3b (F04 SS3 / F02 SS9): NPCs get a lightweight, combat-ready stat block so they read like
-- player characters in F09 combat without carrying the full SRD authoring surface. The Ingredient
-- Generator (stage 4) emits an archetype + challenge rating per NPC; packages/rules/src/guide/
-- npc-stats.ts (deriveNpcStatBlock) turns that into concrete abilities, HP, AC, proficiency bonus,
-- save/skill modifiers, and a signature attack, stored here.
--
-- stat_block_ref (created in 20260717190100) stays as the seam for pointing an NPC at a full SRD
-- monster / character record instead; stat_block is the inline lightweight block this feature adds.

alter table npcs add column stat_block jsonb;

comment on column npcs.stat_block is
  'Lightweight combat stat block derived from an archetype + CR (packages/rules deriveNpcStatBlock): '
  'abilities, hp_max, ac, proficiency_bonus, skill/save proficiencies, and a signature attack.';
