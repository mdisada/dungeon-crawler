-- Bind every authored node to WHERE it happens.
--
-- A node is the playable unit, and until now it carried who (encounter_spec.npc_ids) and what
-- (narration_seed) but never where. Nothing in the system could state "this node happens at the
-- harbour office; the party is standing on the quay", so the beat-opening narration had only a
-- defensive clause to lean on ("never presume travel or actions they did not take") against a
-- premise that assumed otherwise. In run 77451545 the beat "Attack Cael Wytherr to stop his
-- writing" opened at 05:58:20 and published "Bram kicks the sealed door inward" at 05:58:28 - the
-- party travelled to that office at 05:58:52, thirty-two seconds later. The encounter then opened
-- on real arrival and narrated the same door a second time.
--
-- Authored in stage 5b from the chapter's closed location list, resolved to an id by the
-- orchestrator exactly as encounter_spec.npc_ids already is, and STORED: a stored column can be
-- validated before anyone plays, a derivation can only be caught mid-story. The runtime reads it
-- to tell "the party is here" from "the party must still get here" - it never infers location.
--
-- NULL means "wherever the party already is": rescue nodes, which must stay reachable from
-- anywhere, and legacy guides authored before nodes were placed.
--
-- `on delete set null` rather than cascade - losing a location must not silently delete the nodes
-- that played there, and the guide validator reports the null.
alter table story_nodes
  add column if not exists location_id uuid references locations (id) on delete set null;

create index if not exists story_nodes_location_idx on story_nodes (location_id);
