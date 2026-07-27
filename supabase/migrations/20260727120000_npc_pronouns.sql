-- NPC pronouns (2026-07-27). The narrator's cast roster carried bare names, so it guessed a
-- gender per draft and drifted mid-scene: live, Warden Sef Karthen was "her attention" in one
-- line and "his boots" nine lines later. No prompt instruction can fix that - the information did
-- not exist anywhere in the schema. Code supplies the fact; the model stops guessing.
alter table npcs add column if not exists pronouns text not null default '';

-- Backfill from the authored description, which is where a gender was previously only implied.
-- Deliberately narrow: it reads pronouns to get pronouns (a lexical fact, not an inference about
-- the character), and anything ambiguous or silent stays empty rather than guessing - an omitted
-- pronoun is the status quo, a wrong one is worse than none.
update npcs set pronouns = case
  when description ~* '(^|[^a-z])(she|her|hers)([^a-z]|$)'
   and description !~* '(^|[^a-z])(he|him|his)([^a-z]|$)' then 'she/her'
  when description ~* '(^|[^a-z])(he|him|his)([^a-z]|$)'
   and description !~* '(^|[^a-z])(she|her|hers)([^a-z]|$)' then 'he/him'
  else ''
end
where pronouns = '';
