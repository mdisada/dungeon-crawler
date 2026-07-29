-- Plot facts are established by PLAYING a beat, not by winning it (owner direction, 2026-07-29;
-- see docs/DECISIONS.md).
--
-- The invariant this serves: the plot is prewritten and linear except the ending, and encounters -
-- all four kinds - change narration, rewards, punishments and ending-steer, never whether the story
-- advances. Measured before this change, across 103 story nodes in 12 guides:
--
--   103/103 had an `on_success` atom their objective NEEDED to complete
--   103/103 had NO plot-satisfying atom in `on_failure`
--    32/103 had an entirely empty `on_failure`
--
-- So winning the encounter WAS the plot. Live in run 9a5f87a6 the party lost all three routes of
-- objective 0 and it was retired `failed` with its plot atom never written, while its setbacks all
-- fired. The price was recorded and the fact was not.

-- `kind` splits the plot spine from optional threads.
--
-- A `main` objective is a plot point rendered for the player so they can see where the story is -
-- not a challenge with a pass/fail. It becomes true; `outcome` may never be 'failed' for one.
-- A `side` objective is genuinely optional, can be lost, and losing it only colours the story.
--
-- Defaults to 'main' because every objective authored before this migration is spine content, and
-- because the safe direction is "cannot be failed" - a side objective wrongly marked main costs a
-- thread that should have been losable, while a main objective wrongly marked side can strip a fact
-- the plot depends on.
alter table objectives
  add column if not exists kind text not null default 'main'
    check (kind in ('main', 'side'));

comment on column objectives.kind is
  'main = a plot point, rendered for the player; becomes true regardless of how the routes went, '
  'and never terminates with outcome=failed. side = an optional thread that can genuinely be lost, '
  'where losing only colours the story. See docs/DECISIONS.md 2026-07-29.';

-- What plot fact this beat MAKES TRUE, independent of how it went.
--
-- Deliberately a separate column rather than another outcome map: the whole defect was that the
-- plot atom lived inside `on_success`, so losing withheld it. Runtime credits these on ANY
-- resolution tier, alongside the tier's outcome map. The outcome maps keep only flavour - rewards,
-- setbacks, ending-steer.
--
-- Empty is legal and means "this beat establishes nothing on its own" (a pure-colour scene).
alter table story_nodes
  add column if not exists establishes text[] not null default '{}';

comment on column story_nodes.establishes is
  'Atoms this beat makes true when it RESOLVES, at any tier. Authored at stage 5, validated '
  'against the objective''s atom menu, and never overlapping the outcome maps - those carry '
  'flavour only. See docs/DECISIONS.md 2026-07-29.';
