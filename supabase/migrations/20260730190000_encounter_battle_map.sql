-- Bind every authored battle encounter to the map it is fought on (F09 SS3.4).
--
-- Until now the live combat initiator read `locations.map` jsonb for obstacles, spawn cells and
-- grid size - and NOTHING has ever written that column. Not the guide pipeline, not the editors.
-- So every fight that reached the real engine was resolved on a featureless 32x32 field with no
-- cover and no spawn markers, both sides dropped by the initiator's free-column fallback. The
-- tactical layer had no terrain to be tactical about.
--
-- The maps themselves already exist: `battle_maps` carries grid_cols/rows, painted obstacles,
-- per-side spawn cells, image fit and tags, and the admin account's uploads auto-publish as
-- public starter maps every user can read. What was missing is the assignment - the link from a
-- fight to a place to fight it.
--
-- Assigned at stage 5 by deterministic tag match against the encounter's fiction (code, not a
-- model: which map fits a "crypt ambush" is a lookup, and MAIN-SPEC SS1.1(2a) gives code identity).
-- Stored rather than derived at play time so the choice can be reviewed and hand-corrected in the
-- guide editor before anyone plays, and so two runs of one guide fight on the same ground.
--
-- NULL means "no map assigned" - the initiator falls back to the open-field default exactly as it
-- behaves today, so the 23 existing guides keep working untouched.
--
-- `on delete set null`, never cascade: deleting a battle map must not delete the encounters that
-- were fought there.
alter table encounters
  add column if not exists battle_map_id uuid references battle_maps (id) on delete set null;

create index if not exists encounters_battle_map_idx on encounters (battle_map_id);

comment on column encounters.battle_map_id is
  'The battle map this fight is resolved on. Assigned at stage 5 by tag match against the '
  'encounter summary and its location (see packages/rules/src/guide/map-match.ts); editable in '
  'the guide editor. NULL falls back to the initiator''s open-field default.';
