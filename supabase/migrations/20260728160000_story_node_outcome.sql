-- A node records WHAT IS TRUE once it resolves (2026-07-28).
--
-- A story_node already carries what the scene OPENS on (narration_seed) and what is AT RISK
-- (encounter_spec.stakes). Neither says what the world looks like afterwards, so nothing
-- downstream can know the state a played scene left behind - it has to re-read prose and infer.
--
-- That single absence is what makes the ladder contradiction possible. An objective's routes are
-- authored as parallel alternatives but PLAYED as a sequence: route k is reachable only by failing
-- route k-1, arriving on its setback line. With no stored outcome, route k's opening is written
-- against an untouched world. Live guide 350c0363 shipped two guaranteed contradictions of exactly
-- this shape - a setback in which "Selka Vane is consumed by the chaos" routing into a scene whose
-- seed has her alive and mid-ritual.
--
-- Stored rather than derived, deliberately: a stored field can be validated before anyone plays,
-- while a derivation only ever surfaces mid-story.
--
--   { "win": "one present-tense sentence", "loss": "one present-tense sentence" }
--
-- Nullable on purpose. A guide authored before this column, or one whose author omitted the field,
-- degrades to the previous behaviour rather than failing to generate.

alter table story_nodes add column if not exists outcome_summary jsonb;

comment on column story_nodes.outcome_summary is
  'What is true after this node resolves: {win, loss}, one present-tense sentence each. Read by '
  'later scenes and by the narrator instead of inferring state from prose. Null on legacy guides.';
