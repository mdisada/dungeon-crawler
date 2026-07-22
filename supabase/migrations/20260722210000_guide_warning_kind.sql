-- Severity split for guide_warnings (2026-07-22): the editor showed records of automatic
-- fixes (stage-5 rebalances, stage-4 coop demotions, dropped surplus tactics) under the same
-- "Consistency warnings" header as findings that genuinely need the creator - so a healthy
-- generation read as a wall of problems. 'info' = a record of something the pipeline already
-- resolved; 'warning' = needs human judgment. Default 'warning' so untagged writers stay loud.
alter table guide_warnings
  add column kind text not null default 'warning'
  constraint guide_warnings_kind_check check (kind in ('info', 'warning'));
