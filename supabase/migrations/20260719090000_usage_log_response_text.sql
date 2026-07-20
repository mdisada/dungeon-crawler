-- Debug view (2026-07-19): store the raw model response per agent call so the email-gated
-- Debug tab can show full agent outputs (adjudicator, consistency checker, ...). Nullable;
-- only the session pipeline's non-streaming text calls populate it (ai-proxy streams and
-- keeps inserting null).
alter table usage_log add column response_text text;
