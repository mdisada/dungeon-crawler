-- Which named forces an objective's completion makes EXPLAINABLE (2026-07-28).
--
-- Lore notes are the DM's briefing on what a force means, and they are the answers to the
-- objectives. `f9d4f6b` withholds all of them from the narrator, always, because one leaked
-- verbatim into narration #11 of run 1de855de and pre-answered an objective that had not opened
-- yet. That stopped the leak but left the narrator unable to explain anything, ever - even once
-- the party had earned it.
--
-- This is the gate. Derived at guide time (packages/rules/src/guide/lore-reveals.ts) from the
-- first objective whose hidden_description names the force, then STORED - so it can be read,
-- checked and corrected before anyone plays, rather than recomputed mid-story.
--
-- The safety property is the empty array: a force no objective mentions reveals nowhere, and the
-- narrator treats it exactly as it does today. The gate can only ever loosen, never leak.

alter table objectives add column if not exists reveals_lore text[] not null default '{}';

comment on column objectives.reveals_lore is
  'Lore entity names whose notes become available to the narrator once this objective completes. '
  'Derived at guide time; empty means those forces stay name-only, which is the pre-gate default.';
