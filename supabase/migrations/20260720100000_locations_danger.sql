-- Encounter-states Slice 6: per-location authored danger score (0-5) and weighted random
-- encounter table ([{ weight, kind, label, params }]). Existing guides leave both at their
-- defaults - the runtime degrades to a generated fallback table; regenerate guides to author
-- them properly.
alter table public.locations add column if not exists danger integer not null default 0;
alter table public.locations add column if not exists encounter_table jsonb;
