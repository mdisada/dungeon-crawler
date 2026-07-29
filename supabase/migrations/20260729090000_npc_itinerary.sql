-- Where a character is, and when (2026-07-28).
--
-- `npcs` has never had a location. An NPC's whereabouts existed only implicitly, in which nodes
-- stage them, and nothing read it - so the narrator was never told where anyone is, and the
-- runtime could not tell "they are not here yet" from "they are gone from the story". That gap is
-- what let a scene close mark three NPCs `absent` on ordinary exit prose and silently delete an
-- authored objective's entire cast.
--
-- DERIVED, not authored. Objectives are ordered, nodes belong to objectives, and nodes carry a
-- location - so node placement already encodes both where a character appears and when. Deriving
-- it means it cannot contradict node placement; an authored column could, and would the first time
-- two stages disagreed.
--
--   [ { "objectiveIndex": 2, "locationId": "..." },     -- the Harbourmaster's Office
--     { "objectiveIndex": 3, "locationId": "..." } ]    -- then the Spillstone, for the climax
--
-- Empty for anyone no placed node stages, which is honest: their location is unconstrained, and a
-- confident wrong answer is worse than none. Routes of one objective are ALTERNATIVES, so two
-- locations under the same objective index is correct authoring, never travel.

alter table npcs add column if not exists itinerary jsonb not null default '[]'::jsonb;

comment on column npcs.itinerary is
  'Ordered stops [{objectiveIndex, locationId}] derived at guide time from the nodes that stage '
  'this NPC. Empty means unconstrained - no placed node stages them. Never authored directly.';
