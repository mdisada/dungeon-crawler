# PHASE 0 — Project Foundation

Checkpoint emitted 2026-07-17, revised twice same day: once after the user reported Docker
cannot be installed on their dev machine, once more after the actual data apply surfaced a real
bug in the SRD items ingestion (see BUILT/AI TESTS below and `docs/DECISIONS.md`). See
`DEVELOPMENT-PLAN.md` §1.2 for the block format and rule zero.

## Checkpoint: Phase 0 — Project Foundation

**BUILT:**

- Resolved the 3 open architecture decisions blocking Phase 0 with the user (backend on Edge
  Functions/Postgres, frontend stays plain useState/useEffect - no TanStack Query/Zustand, OAuth
  deferred to backlog). Logged in docs/DECISIONS.md; root CLAUDE.md's Project-Specific Overrides
  section filled in to match; TASK.md §2/§3 updated.
- supabase/ initialized (config.toml) with 2 migrations, both applied for real to the live
  Supabase project:
  - `20260716170222_enable_extensions.sql` - enables pgvector (already existed - no-op).
  - `20260716171413_create_srd_tables.sql` - srd_monsters, srd_spells, srd_classes,
    srd_class_features, srd_items (columns Engines need to filter on; rest folded into `data
    jsonb` rather than fully normalized - no Engine queries that data yet).
- `supabase/seed/ingest-srd.mjs`: fetches SRD 5.2.1 content from the Open5e API (document key
  srd-2024) and generates `supabase/seed.sql`. Seeded to the live project and verified there:
  331 monsters, 339 spells, 24 classes+subclasses, 352 class features, 440 items.
- `NOTICE.md`: CC-BY-4.0 attribution text for SRD 5.2.1 (Wizards of the Coast) plus a note on
  Open5e's separate code license and excluded (CC-BY-NC) artwork.
- `.github/workflows/ci.yml`: `frontend` job (npm ci, lint, test, build) and a
  `supabase-migrations` job (supabase db start / db reset / stop via Docker - runs on GitHub's
  hosted runners only, which have Docker regardless of the dev machine).
- No-Docker workflow: the dev machine can't run Docker, so schema changes go straight to the
  real, already-linked Supabase project. Migrations: `supabase db push --db-url
  <POSTGRES_URL_NON_POOLING>`. Seed data: `node supabase/seed/apply-seed.mjs
  "$POSTGRES_URL_NON_POOLING"` (new script - see AI TESTS for why `db push --include-seed`
  wasn't used instead). Documented in `supabase/README.md`, `docs/DECISIONS.md` (2026-07-17),
  `DEVELOPMENT-PLAN.md` §1.3, and root `CLAUDE.md`'s Project-Specific Overrides.
- frontend: added Vitest + React Testing Library + jsdom (root CLAUDE.md's mandated test stack
  had no tooling installed yet); vite.config.ts test block; src/test/setup.ts (matchMedia mock
  for src/lib/theme.ts); one real smoke test (theme-toggle.test.tsx); "test" script added.
- packages/rules scaffolded (package.json, tsconfig.json, vitest.config.ts, README) - empty of
  engines by design; first engine lands Phase 5 (Dice/Check) or Phase 7 (Combat/Effects/Budget/
  Progression) per DEVELOPMENT-PLAN.
- tests/integration/README.md, tests/fixtures/README.md, docs/CHECKPOINTS/README.md added as
  the documented-but-empty skeleton for later phases.

*Deviations flagged:*

- Repo scaffold itself (bulletproof-react/Vite/TS/shadcn) was already in place from the
  pre-spec prototype - left as-is per "don't refactor unrelated code," only test tooling added.
- packages/rules is deliberately NOT wired into CI yet (zero source/tests to run - an empty
  "passing" suite is exactly the passWithNoTests red flag CLAUDE.md warns about). Will add a CI
  job for it once the first engine lands.
- srd_items ends up with only one real source (Open5e's /items/) instead of the three
  (items+weapons+armor) originally planned - see AI TESTS, this was a bug fix, not a deviation
  discovered ahead of time, but flagging since it changes the earlier design.

**AI TESTS:**

- frontend: `npx tsc -b` → 0 errors. `npx eslint .` → 0 errors. `npx vitest run` → 1/1 passed.
- Migrations applied for real via `supabase db push --db-url "$POSTGRES_URL_NON_POOLING"`
  against the live Supabase project (previewed first with `--dry-run`, no surprises).
- First seed apply (via `db push --include-seed`) revealed a real bug: srd_items landed with
  440 rows instead of the expected 528, all mislabeled `category='gear'`. Root cause: the
  ingestion script fetched Open5e's /items/, /weapons/, and /armor/ endpoints as if they were
  three distinct datasets and merged them - they aren't. /items/ already embeds weapon/armor
  stats inline and shares the same keys, so the extra 88 rows were duplicates silently dropped
  by `on conflict (key) do nothing`, and every weapon/armor item kept the hardcoded 'gear' label
  instead of Open5e's real category. Fixed by dropping the redundant fetches and reading each
  item's own `category.name` field. Verified live after the fix: srd-2024_longsword now shows
  category 'Weapon' (was 'gear'); full category breakdown (Weapon 81, Armor 25, Adventuring Gear
  153, Tools 74, Ammunition 9, Poison 15, Trade Good 28, + 10 more categories) sums to exactly 440.
- Second bug found while re-seeding: `supabase db push --include-seed` does not reliably re-run
  a changed seed.sql - after the fix above, re-running it printed "Updating seed hash..." and
  exited clean, but the live data was still the old wrong values. Worked around by writing
  `supabase/seed/apply-seed.mjs`, which splits seed.sql into its 6 individual statements and runs
  each through `supabase db query --file` (which does execute reliably, but rejects multi-
  statement files, hence the split). Confirmed this actually applies changes (see above).
- Also spot-checked the original Phase 0 fixtures still hold post-fix: srd-2024_goblin-warrior,
  srd-2024_fireball, and srd-2024_fighter_proficiency-bonus (with its level-breakpoint table) all
  present with correct field values (CR/XP, spell level/school, proficiency bonus by level).

**COULD NOT VERIFY:**

- Whether Open5e's "srd-2024" document tag is a byte-perfect match for 5.2.1 vs. their listed
  "5.2" - the fixtures Phase 0 cares about check out, but the full dataset wasn't diffed against
  the official PDF.
- Whether the Vercel project you said is already linked actually points at this repo/branch -
  no dashboard access from here.
- Whether the OpenRouter spend limit is configured as you stated - taken on your word. (pgvector
  is now independently confirmed - the migration's `create extension if not exists vector`
  reported "already exists, skipping" against your real project.)

**YOUR TESTS:**

- [x] Open the hosted Supabase Studio (supabase.com/dashboard, your project) → Table Editor →
      confirm srd_monsters (331) / srd_spells (339) / srd_classes (24) / srd_class_features (352)
      / srd_items (440) all have rows.
- [x] SQL editor: `select * from srd_monsters where key = 'srd-2024_goblin-warrior';`
- [x] SQL editor: `select * from srd_spells where key = 'srd-2024_fireball';`
- [x] SQL editor: `select name, data_for_class_table from srd_class_features where key = 'srd-2024_fighter_proficiency-bonus';`
- [x] SQL editor: `select category, count(*) from srd_items group by category order by 2 desc;` — confirm a real category breakdown (Weapon, Armor, Adventuring Gear, ...), not one giant 'gear'.
- [x] In frontend/: `npm run dev`, confirm the app still loads (sign-in screen / existing shell).
- [x] In frontend/: `npm run test`, confirm it passes on your machine too.
- [x] Push this branch / open a PR and watch the new GitHub Actions "CI" workflow - confirm both
      the `frontend` and `supabase-migrations` jobs go green (this one still uses Docker, but on
      GitHub's runner, not yours).
- [x] Skim NOTICE.md - is the wording fine as a starting point?

**YOUR TASKS:**

- [x] Double check the OpenRouter spend limit is really set (a 30-second dashboard glance),
      since Phase 1 (F1) depends on it. (Migrations + seed are already live in your project with
      your go-ahead, and pgvector was independently confirmed - neither needs a task from you.)

**DESIGN REVIEW:**

- [x] NOTICE.md attribution - is repo-root NOTICE.md + a future in-app Credits page enough, or
      should it be more prominent (e.g. footer link) from the start?
- [x] OK to leave packages/rules out of CI until it has real engines (Phase 5/7), or do you want
      a placeholder job now?: NOTES: PUT PLACEHOLDERS PLEASE. Done: added a `rules` job to
      ci.yml (checkout + `npm ci` only). Both `tsc --noEmit` (errors on empty `src`, "no inputs
      were found") and `npm run test` (vitest run fails outright with zero test files) were tried
      and intentionally left out rather than faked with a placeholder source file - add both once
      the first engine lands (Phase 5/7) and packages/rules/src actually exists.
- [x] srd_items now comes from a single Open5e endpoint (not three) with its own category
      taxonomy (Weapon/Armor/Adventuring Gear/Tools/...) folded into one table with a jsonb
      payload - fine for now, or split into normalized weapon/armor tables before F2/F9 need it?:
      NOTES: SPLIT NOW. Done: `20260717120000_split_srd_weapons_armor.sql` adds srd_weapons (77
      rows) and srd_armor (25 rows), each keyed 1:1 to srd_items.key via FK, populated from the
      same /items/ payload's nested `weapon`/`armor` objects. srd_items itself is unchanged (still
      the full 440-row catalog). ingest-srd.mjs updated to emit both new insert blocks;
      seed.sql regenerated locally. **Not yet applied to the live project** - needs
      `supabase db push` + `apply-seed.mjs` per supabase/README.md; ask before running.
- [x] packages/rules is fully standalone (own package.json, no workspace link to frontend) per
      your call - when Edge Functions need to import engine logic from it later, that wiring
      (npm publish / vendoring / Deno npm: specifier) gets figured out then, not now. Flagging so
      it's not a surprise.

**GATE:** PASS WITH NOTES
