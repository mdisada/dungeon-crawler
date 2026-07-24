-- Award surfaces for the reachability lint (story-engine overhaul Phase 5).
--
-- Until now NOTHING authored at guide time carried award metadata: outcome maps were invented
-- by the Beat Planner at RUNTIME, so a guide-time question like "can this objective's atoms
-- ever be awarded?" had no data to answer from and would have passed vacuously.
--
-- These two columns are that data. `encounters.outcome_atoms` is what a candidate encounter
-- credits on success; `ingredients.awards_atoms` is what discovering a clue credits. Together
-- with objectives.guaranteed_route they let `lintStoryGraph` prove every objective is
-- reachable BEFORE the adventure ships.

alter table encounters add column outcome_atoms jsonb;
alter table ingredients add column awards_atoms jsonb;

comment on column encounters.outcome_atoms is
  'Milestone atoms a full success here credits, chosen at stage 5 from the chapter objectives '
  'atom menu. Feeds the reachability lint and seeds the live outcome mapper.';
comment on column ingredients.awards_atoms is
  'Milestone atoms discovering this ingredient credits (optional - most clues award nothing).';
