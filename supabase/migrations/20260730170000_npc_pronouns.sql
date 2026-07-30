-- An NPC's pronouns, authored rather than inferred (2026-07-30).
--
-- Gender existed only as whatever pronoun happened to sit inside `npcs.description`, and the live
-- narrator inferred the rest from the name. Run 13b7c386: Maren Foss is authored "Thin, grey-faced
-- foreman with permanent salt-burn on HIS forearms", and the narration used he/him for 42 transcript
-- entries, switched to she/her at #43, and never switched back - through #83, in the NPC the party
-- spoke to most.
--
-- The word "his" WAS in the prompt, inside the identity clause the narrator receives on every call.
-- It lost to the name: "Maren" reads female to a model, and a pronoun buried mid-sentence is weak
-- evidence against a strong prior. A guard cannot fix that and a stronger instruction has already
-- been tried; the fix is to state it as a token that cannot be misread.
--
-- Constrained rather than free text. A model handed an open string will eventually write "male" or
-- "uses feminine pronouns" instead of a pronoun pair, and the value has to be unambiguous at the
-- point of use - it is rendered straight into the narrator's roster line as "Name (he/him)".
--
-- Nullable, same contract as story_nodes.pull and locations.arrival_line: a guide authored before
-- this column renders nothing and behaves exactly as it did before. No backfill - guessing a pronoun
-- from a name in a migration would reproduce the precise bug this exists to remove.

alter table npcs add column if not exists pronouns text;

alter table npcs drop constraint if exists npcs_pronouns_check;
alter table npcs add constraint npcs_pronouns_check
  check (pronouns is null or pronouns in ('he/him', 'she/her', 'they/them', 'it/its'));

comment on column npcs.pronouns is
  'Authored pronoun pair, rendered verbatim into the narrator and NPC-agent rosters. One of '
  'he/him, she/her, they/them, it/its. Null on guides predating 2026-07-30, which fall back to '
  'whatever the description implies - the behaviour that let a narrator change an NPC''s sex '
  'mid-run.';
