# DECISIONS.md — Append-only decision log

Per `DEVELOPMENT-PLAN.md` §1.3: every CHANGES verdict and every architecture fork resolved with
the user gets an entry here — date, what, why, which specs/docs were updated. Newest entries at
the bottom. Never edit or delete past entries; if a decision is later reversed, add a new entry
that supersedes it and link back.

---

## 2026-07-16 — Backend architecture: rebuild on Edge Functions, not repoint the Python prototype

**What:** `MAIN-SPEC.md` specifies Supabase Edge Functions as the sole AI gateway and Postgres
(RLS + single-writer `apply_diff` + `state_version`) as the sole state authority. The prototype's
standalone `backend/main.py` Python process (OpenRouter direct + SQLite at
`backend/data/campaigns.db`) is retired as a runtime. Existing Python modules
(`backend/campaign/`, `backend/llm/`, `backend/tts.py`, `backend/job_queue.py`,
`backend/realtime_dispatch.py`) are kept only as reference for porting logic into Edge Functions
per the feature-by-feature mapping in `TASK.md` §4.

**Why:** Rebuilding on the spec'd architecture up front means every later feature (F02-F15) is
built against the real state-authority model from the start, avoiding a second migration later.
The user chose this over "keep Python, repoint at Postgres" explicitly to avoid that second
migration.

**Updated:** `TASK.md` §2 and §3 (this decision recorded); no F0X spec text needed changing since
this confirms MAIN-SPEC as-is rather than deviating from it.

---

## 2026-07-16 — Frontend state/data-fetching: plain useState/useEffect, no TanStack Query/Zustand

**What:** Root `CLAUDE.md`'s general "State Management Rules" and "Data Fetching Rules" (which
mandate SWR/TanStack Query + Zustand) are overridden for this project. `frontend/CLAUDE.md`'s
existing convention — plain `useState`/`useEffect` in each feature's `hooks/`, wrapping `api/`
functions — is canonical and wins over the root file.

**Why:** User's explicit call. Root `CLAUDE.md` is a generic template; `frontend/CLAUDE.md` reflects
the actual convention already in use in this codebase (see `frontend/src/features/new-campaign`,
`campaign-session` for existing examples).

**Updated:** Root `CLAUDE.md` §Project-Specific Overrides (new "State Management & Data Fetching"
subsection added). `frontend/CLAUDE.md` left as-is — it already documented the winning convention.

---

## 2026-07-16 — OAuth deferred to backlog; email/password only for v1

**What:** F01 calls for Google + Discord OAuth. Deferred — v1 ships Supabase email/password auth
only. Flagged as needing extra attention: protected-route/protected-page guards (lobby membership,
DM-only views, session access) since there's no OAuth-provider identity layer as a second factor.

**Why:** User's explicit call — OAuth adds account/dashboard setup overhead (Things Only The User
Can Do) that isn't worth blocking Phase 0-1 on. Auth correctness still matters, so the tradeoff is
compensated with more deliberate guard testing rather than skipped.

**Updated:** `TASK.md` §3 (this decision recorded). `docs/F01-auth-settings-ai-connectivity.md` not
yet re-read/edited for this — flag to re-check its OAuth section against this decision when F01
build actually starts (Phase 1), since the spec's acceptance criteria may still assume OAuth.

---

## 2026-07-17 — SRD 5.2.1 data source: Open5e API (document key `srd-2024`)

**What:** Phase 0's SRD ingestion script (`supabase/seed/ingest-srd.mjs`) pulls monsters, spells,
classes/subclasses (+ per-level feature tables), and items from the
[Open5e API](https://api.open5e.com/v2/), filtered to their `srd-2024` document key, which they
confirm covers the 2024-revision SRD 5.2.1 content (verified live: monster/spell/class field
shapes match SRD 5.2.1 stat blocks, e.g. goblin variants, Fireball, Fighter's proficiency-bonus
table). Final counts, seeded to the real project: 331 monsters, 339 spells, 24 classes+subclasses,
352 class features, 440 items (spanning Weapon/Armor/Adventuring Gear/Tools/etc. per Open5e's own
`category` field).

Correction during first real apply: the script originally *also* fetched Open5e's separate
`/weapons/` and `/armor/` endpoints and merged them into `srd_items` alongside `/items/`, on the
assumption they were distinct datasets (528 total rows). They aren't - `/items/` already embeds
weapon/armor stats inline (nested `weapon`/`armor` objects) and shares the same keys, so the extra
88 rows were pure duplicates that got silently dropped by `on conflict (key) do nothing`, and
every item that happened to be a weapon/armor ended up mislabeled with a hardcoded `'gear'`
category instead of Open5e's real category taxonomy. Fixed by dropping the redundant
weapons/armor fetch and using each item's own `category.name` field directly.

**Why:** Confirmed as an actively-maintained, already-structured (JSON) public source, avoiding a
manual PDF-parsing effort. SRD 5.2.1 (the 2024 rules revision) is licensed exclusively under
CC-BY-4.0 by Wizards of the Coast (no OGL option, unlike the 2014 SRD 5.1) — see `NOTICE.md` for
the required attribution text. Open5e's own code license (modified MIT) is separate from and
doesn't affect the CC-BY status of the SRD text itself; their artwork is separately
CC-BY-NC-4.0-licensed and is deliberately not ingested (incompatible for redistribution here).

**Gap flagged:** no structured source confirmed yet for the character-advancement XP-threshold
table (XP required per level) — will need manual transcription from SRD rules text when the
Progression Engine (F11, Phase 7) is built.

**Updated:** `NOTICE.md` created (attribution text; in-app placement still pending user approval —
see Phase 0 checkpoint design review). `supabase/migrations/20260716171413_create_srd_tables.sql`
and `supabase/seed/ingest-srd.mjs` added.

---

## 2026-07-17 — No Docker locally; migrations/seed applied via `db push`, not `db start`/`db reset`

**What:** The user cannot install Docker on their dev machine, which rules out the Supabase CLI's
local emulation stack (`supabase start`, `supabase db reset`, local Studio) as the day-to-day
testing workflow originally assumed in `DEVELOPMENT-PLAN.md` Phase 0. Instead: migrations are
authored by hand under `supabase/migrations/` as before, and applied directly to the real, already-
linked Supabase project with `supabase db push --db-url <POSTGRES_URL_NON_POOLING>` — this only
opens a direct Postgres connection and needs no Docker at all. Both migrations were applied for
real this way (`enable_extensions` — pgvector already existed; `create_srd_tables` — all 5 tables
created). Verification/inspection happens through the **hosted** Supabase Studio
(supabase.com/dashboard/project/&lt;ref&gt;) instead of a local one.

CI is unaffected: `.github/workflows/ci.yml`'s `supabase-migrations` job still uses
`supabase db start`/`db reset` inside GitHub Actions, which has Docker on its hosted runners
regardless of the developer's own machine. That job remains the "do migrations apply cleanly from
an empty database" check; `db push` against the real project is the day-to-day dev/apply path.

**Seeding needed a second fix.** `db push --include-seed` looked right (confirmed via `--dry-run`
that it detects `supabase/seed.sql`) and was used for the first real apply. But after fixing the
items-ingestion bug (see the SRD data source entry above) and re-running `db push --include-seed`,
the live data hadn't changed — the CLI printed "Updating seed hash to supabase/seed.sql..." and
exited without error, but a spot-check of `srd_items` showed the old, wrong data still there. The
CLI's seed step only *executes* `seed.sql` the first time it sees a given project; once applied, a
changed file just updates the tracked hash silently rather than re-running it. Falling back to
`supabase db query --file` (which does execute reliably) hit its own limit: it rejects multi-
statement files ("cannot insert multiple commands into a prepared statement"), and `seed.sql`
is one `truncate` plus five `insert` statements. Resolved with a small new script,
`supabase/seed/apply-seed.mjs`, which splits `seed.sql` on statement boundaries and runs each one
through `supabase db query --file` individually. Re-running it after the fix was verified against
the live project: `srd_items.category` for Longsword changed from `'gear'` to `'Weapon'`, and the
full category breakdown (Weapon 81, Armor 25, Adventuring Gear 153, Tools 74, ...) now sums to 440.

**Why:** Docker is not installable on the user's machine — a hard constraint, not a preference.
`db push --db-url` was confirmed (via CLI `--help` and a live dry run) to work without Docker,
`supabase link`, or even `supabase login`, since it takes the connection string directly, so
migrations needed no custom tooling. Seeding did, once `--include-seed`'s one-shot-only behavior
was discovered empirically (not documented in `--help`) — `apply-seed.mjs` was the smallest fix
that keeps using the official CLI's connection/auth handling rather than adding a `pg` dependency.

**How to apply:** Any future Phase 0+ instructions to "run `supabase start`" or "reset your local
DB" should instead read: migrations via `supabase db push --db-url $POSTGRES_URL_NON_POOLING`;
seed data via `node supabase/seed/apply-seed.mjs "$POSTGRES_URL_NON_POOLING"` (not `db push
--include-seed` — see above). `POSTGRES_URL_NON_POOLING` currently lives in `backend/.env` (kept
there as the least-churn source until `backend/` is fully retired per the Phase 0 backend-
architecture decision above; move it to a root/`supabase/.env` when that happens).

**Updated:** `DEVELOPMENT-PLAN.md` §1.3 and Phase 0 build line; `docs/CHECKPOINTS/PHASE0.md`
(YOUR TESTS / COULD NOT VERIFY / AI TESTS rewritten); `supabase/README.md` documenting the
workflow; `supabase/seed/apply-seed.mjs` added; `supabase/seed/ingest-srd.mjs` fixed (see above).
