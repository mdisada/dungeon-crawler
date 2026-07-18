# tests/integration

DB/RLS/pipeline integration tests (per `DEVELOPMENT-PLAN.md` SS1.3) - things that need a real
Postgres instance (RLS cross-user denial, single-writer `apply_diff`/`state_version` races,
proposal lifecycle, pipeline stage contracts). Not pure-function tests - those live in
`packages/rules` instead.

- `rls-cross-user.mjs` (F1) — RLS cross-user denial across every F1 table. Runs against the real
  linked project via two throwaway Admin-API users it creates and deletes itself; no Docker
  needed. `node tests/integration/rls-cross-user.mjs`.
- `session-live.mjs` (F05/F06, Phase 4) — full lifecycle against the deployed `session` function:
  join capacity cap, membership RLS + client-write lockout, character locking across two active
  adventures, min-player gating, DM-data isolation (resync filtering + dm/game channel
  authorization), state_diff broadcast reception, checkpoint restore identity
  (stable-stringify), session end/summary, leave/unlock. Throwaway users, self-cleaning.
  `node tests/integration/session-live.mjs`.
