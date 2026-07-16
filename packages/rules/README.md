# @dnd-ai/rules

Pure, deterministic engine logic (MAIN-SPEC.md SS5: Dice, Check Resolution, Combat Resolution,
Effects, Encounter Budget, Difficulty Scaler, Progression, Grid/Range). No LLM calls, no side
effects, no Supabase client - just functions and their unit tests, so they stay independently
testable and reusable from wherever they end up running (Edge Functions today; anywhere else
later).

Standalone package - not an npm workspace member of `frontend/` (see `docs/DECISIONS.md`,
2026-07-16). Install its own deps with `npm install` inside this directory.

## Layout

- `src/<engine-name>/` - one folder per engine, colocated with its tests and golden fixture
  files (e.g. scripted combat logs with expected byte-identical output).
- Empty until the first engine is built (Dice/Check Resolution land with F7 in Phase 5;
  Combat/Effects/Budget/Progression land with F9/F11 in Phase 7 - see `DEVELOPMENT-PLAN.md`).

## Commands

- `npm test` - run the suite (Vitest)
- `npm run typecheck` - `tsc --noEmit`
