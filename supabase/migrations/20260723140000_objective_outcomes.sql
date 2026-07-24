-- Fail-forward outcomes + guaranteed routes (story-engine overhaul Phase 4).
--
-- `outcome` makes an objective's END STATE explicit. Until now `reveal_state='completed'` was
-- the only terminal state, so an objective the party could not finish simply held the story
-- forever. A failed objective still advances the ladder and still feeds ending scoring (the
-- signal vocabulary has always supported {objective_id, outcome:'failed'} - nothing ever
-- produced one).
--
-- `guaranteed_route` is the code-authored rescue encounter: a spec whose on_success is the
-- minimal atom set that satisfies this objective's completion predicate. It is the director's
-- second-to-last rung and the fail-closed target for a misaligned beat, so the spine can
-- always be advanced by SOMETHING the party can actually play.

alter table objectives
  add column outcome text check (outcome in ('completed', 'failed')),
  add column guaranteed_route jsonb;

comment on column objectives.outcome is
  'Terminal state: completed | failed | null (still open). Failed objectives advance the '
  'ladder and score endings; see packages/rules/src/story/director.ts.';
comment on column objectives.guaranteed_route is
  'Code-authored rescue encounter spec (packages/rules/src/guide/guaranteed-route.ts). Its '
  'outcome map is generated, never LLM-authored - the Encounter Designer may only skin params.';
