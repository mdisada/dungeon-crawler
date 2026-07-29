-- Authored detail a player can actually poke at (2026-07-29).
--
-- MEASURED. In a 30-turn run the narrator wrote 20,040 characters of prose while the entire guide
-- held 6,933 of authored player-facing text - 2.9 to 1, on a third of a playthrough. Locations were
-- the thinnest part of it: 3 rows, 402 chars, ONE SENTENCE each.
--
-- And that is exactly where the traffic is. 72% of folded player inputs are questions and
-- examinations - "what's the pounding", "what's in the chest", "what did the notice say" - so the
-- commonest thing a player does is interrogate a room described in one sentence. The narrator has
-- nothing to read, so it invents; the invention is recorded nowhere, so the next turn either drops
-- it or re-invents it differently. That is the contradiction engine, and it is an AUTHORING gap
-- rather than a narration bug.
--
-- This is the shape a published module actually uses: boxed read-aloud text, then a list of
-- features with what each one yields. The guide already has the boxed text (node narration seeds);
-- it had none of the features.
alter table locations
  add column if not exists features jsonb not null default '[]'::jsonb;

comment on column locations.features is
  'Authored examinable detail: [{ "name": "the bellows", "detail": "what a character finds on '
  'looking closely" }]. Read by the narrator for the party''s CURRENT location so an examination '
  'is a lookup instead of an invention. Authored at stage 4. See docs/DECISIONS.md 2026-07-29.';

-- One authored line for arriving here, so travel reads as written rather than improvised.
--
-- `story_nodes.transitions[].arrival_context` already exists but is authored only for FAILURE
-- edges - ordinary arrival has always been improvised. Live in bac9f4b9 that produced a party
-- being carted "leaving Ashbridge" out of an underground chamber, and arriving at Toll House to be
-- shown the Vetch Foundry's gates.
alter table locations
  add column if not exists arrival_line text not null default '';

comment on column locations.arrival_line is
  'One or two sentences for the moment the party arrives here. Authored at stage 4; used by the '
  'travel narration instead of improvising the journey''s end.';
