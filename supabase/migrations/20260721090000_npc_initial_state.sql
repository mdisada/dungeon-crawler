-- Some NPCs are not alive when play begins - most obviously the victim of a murder mystery.
-- Nothing recorded that, so dm.facts.npcStates started empty, the Consistency Checker had no
-- fact to contradict, and the corpse answered the party in dialogue (live 2026-07-20).
alter table npcs
  add column initial_state text not null default 'alive'
    check (initial_state in ('alive', 'dead', 'absent'));

comment on column npcs.initial_state is
  'State at session start; seeds GameState dm.facts.npcStates so the Consistency Checker and '
  'the scene director know who cannot speak or be staged.';
