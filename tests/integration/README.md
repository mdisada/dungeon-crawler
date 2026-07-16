# tests/integration

DB/RLS/pipeline integration tests (per `DEVELOPMENT-PLAN.md` SS1.3) - things that need a real
Postgres instance (RLS cross-user denial, single-writer `apply_diff`/`state_version` races,
proposal lifecycle, pipeline stage contracts). Not pure-function tests - those live in
`packages/rules` instead.

Empty until Phase 1 (F1 Auth, Settings & AI Connectivity) starts.
