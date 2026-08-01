-- A default narrator voice (2026-08-01, owner's call).
--
-- Until now an adventure with no narrator_voice_id resolved to `silent`: nothing was spoken and
-- nothing was spent. That made silence the accident rather than the choice - an adventure could go
-- live with no voice assigned and nobody was told (nothing in art-readiness checks for one), which
-- is indistinguishable from the feature being broken. One built-in voice now carries a flag, and
-- narration-tts falls back to it when a table has assigned none.
--
-- Two rules, both enforced here rather than by convention:
--   - only a BUILT-IN (ownerless) voice may be the default. A user's uploaded clip is not something
--     someone else's table should ever be narrated with.
--   - at most one row holds the flag. The unique index is on a constant expression, so the partial
--     predicate is what does the work.
alter table voice_profiles add column is_default boolean not null default false;

alter table voice_profiles
  add constraint voice_profiles_default_is_builtin
  check (not is_default or user_id is null);

create unique index voice_profiles_one_default on voice_profiles ((true)) where is_default;
