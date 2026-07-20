-- Encounter-states Slice 3: the Beat Planner authors a typed encounter spec per beat
-- (kind, label, stakes, params, outcome maps). Instantiated into GameState.encounter on
-- entry; null degrades the beat to hook -> ad-hoc entries only.
alter table public.beats add column if not exists encounter_spec jsonb;
