-- The narrator's diegetic orientation line, replacing the quest string (2026-07-30).
--
-- The narrator was handed `GOAL <objective title>` for orientation and instructed "never state as
-- a task". It stated it as a task anyway. Run e87b3506 (glm-5.2 narrator, 30 turns) closed five
-- published passages on the literal sentence "Learn why the plague bell tolls." and wove "The truth
-- in Voss's cellar waits" into a sixth:
--
--   "...The rope above sways in a draft that shouldn't reach this floor.
--    Learn why the plague bell tolls."
--
-- That is an instruction at war with itself - orient to this string, never say this string - where
-- the cheapest way to satisfy the first half is to say it. A quest title is UI copy; handing it to a
-- prose writer as a directive is the defect, and no amount of stripping the tail fixes the source
-- (the same run wove one into mid-paragraph prose, where the trailing-label guard cannot see it).
--
-- So the guide authors the orientation instead: one present-tense sentence naming the unresolved
-- thing in the world, not the task. Pasting THIS verbatim costs nothing - it already reads as prose
-- about the room.
--
-- NOT a spoiler channel. It may only name what the party can already see or has already been told.
-- The objective title remains the player's signpost in the sidebar (player-sidebar.tsx, "Current
-- objective"); this is only what the narrator writes from. Whether those titles are themselves
-- spoiler-free is a separate stage-3 authoring question - see docs/STORY-COHERENCE.md.
--
-- Nullable on purpose, same contract outcome_summary uses: a guide authored before this column, or
-- one whose author omitted the field, falls back to `GOAL <title>` and behaves exactly as before.
-- No backfill - a derived value would be the objective restated, which is the string being removed.

alter table story_nodes add column if not exists pull text;

comment on column story_nodes.pull is
  'Diegetic orientation for the narrator while this node is open: one present-tense sentence naming '
  'the unresolved situation, never the objective restated. Replaces GOAL <title> in the narrator '
  'prompt. Null on legacy guides, which fall back to the title.';
