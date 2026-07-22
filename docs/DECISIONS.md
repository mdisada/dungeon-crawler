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

---

## 2026-07-17 — F1 build: OpenRouter model catalog verified real; TTS blocked on real voice media; no Deno/CI test infra added

**What:** Three findings from building F1 (Auth, Settings & AI Connectivity):

1. **All 8 curated MAIN-SPEC §4.7 models are real, live OpenRouter endpoints**, confirmed via
   per-model `/api/v1/models/{id}/endpoints` lookups (the bulk `/api/v1/models` list omits some
   categories and gave false negatives on a first pass — don't trust it alone): `xiaomi/mimo-v2.5`,
   `deepseek/deepseek-v4-flash`, `deepseek/deepseek-v4-pro`, `google/gemini-2.5-flash-lite`,
   `mistralai/mistral-nemo`, `mistralai/voxtral-mini-tts-2603` (TTS), `qwen/qwen3-embedding-8b`
   (embedding), `google/gemini-3.1-flash-lite-image` (image — its own endpoint metadata literally
   names it "Nano Banana 2 Lite", confirming the spec's nickname).
2. **The F1 §3.2 TTS streaming validation task turned out to depend on a prerequisite the spec put
   in Phase 3, not Phase 1.** OpenRouter's TTS path is a dedicated `POST /api/v1/audio/speech`
   endpoint (not chat completions), and it requires a `voice` parameter that must be a `voice_id`
   from a voice profile created by uploading a real 2-3s reference clip to Mistral's Voices API —
   there is no built-in/preset voice to test with. This is exactly `DEVELOPMENT-PLAN.md` PHASE 3's
   "upload a narrator voice clip" task. Confirmed real request/response shapes for the endpoint (via
   OpenRouter's docs) and wired `ai-proxy`'s `kind: tts` branch against them, including a
   best-effort cost lookup via `GET /api/v1/generation?id=` (the audio endpoint returns raw bytes,
   not a JSON usage object). Whether OpenRouter streams the audio progressively or buffers it is
   recorded as **COULD NOT VERIFY** on the Phase 1 checkpoint, to be confirmed for real once Phase 3
   provides a real voice clip.
3. **No Deno test tooling or CI changes were added**, on the user's explicit call after Deno wasn't
   already installed locally: the pure model-routing/resolution logic
   (`supabase/functions/_shared/model-routing.ts`) is deliberately plain TypeScript with zero
   Deno-specific APIs, and is duplicated (not imported, since edge function bundles can't reach
   outside `supabase/functions/`) into `frontend/src/features/settings/model-routing.ts`, which
   **is** unit-tested via the existing Vitest setup. RLS cross-user denial is instead verified by
   `tests/integration/rls-cross-user.mjs`, a plain Node script run directly against the real linked
   project (creates and deletes two throwaway users via the Admin API) — no local Docker stack or
   CI job needed, consistent with the project's existing no-Docker-locally workflow.

**Why:** (1) avoids silently inventing model IDs or guessing a fallback provider that wasn't
actually needed. (2) the dependency is real, not a shortcut — TTS output cannot be exercised at all
without a cloned voice, so treating it as blocked-on-Phase-3 media is honest rather than faking a
generic voice. (3) the user pushed back on installing new tooling (Deno) for a single edge function
feature when equivalent coverage was achievable with what the project already runs; keeping
CI unmodified also avoids the "CI file changes need explicit sign-off" friction for something this
size.

**Updated:** `docs/F01-auth-settings-ai-connectivity.md` §2 (OAuth-deferred note added, per the
2026-07-16 OAuth entry's own flag to do this when F01 build starts). `TASK.md` §2/§5.

---

## 2026-07-17 — F2 build: ability bonuses from background (2024 SRD), ruleset seam, character portability, NPC shape

**What:** Four decisions taken at the start of the F2 (Character Page & Creator) build, resolved
with the user during planning:

1. **Ability-score bonuses come from the *background*, not the species.** F02 §3 step 3 was written
   in 2014-D&D terms ("Racial bonuses applied automatically and shown as `15 (+2)`"). The SRD 5.2.1
   (2024) data we actually ingested does not work that way: Open5e's `srd-2024` **species**
   (`/species/` — 9: dragonborn, dwarf, elf, gnome, goliath, halfling, human, orc, tiefling) grant
   traits only (size, speed, darkvision, lineage) and **no ability-score increase**; the
   **background** (`/backgrounds/` — only 4 in the free SRD: acolyte, criminal, sage, soldier) lists
   three abilities and the player assigns **+2/+1** or **+1/+1/+1** among them, plus an Origin feat,
   a skill-proficiency pair, a tool proficiency, and an equipment A/B choice. The wizard follows the
   2024 model faithfully rather than back-porting fictional racial ASI onto the SRD species.

2. **A `ruleset` seam is introduced now (built, but only `srd-5.2.1` implemented).** A character is
   not hardwired to one edition. `characters.ruleset text not null default 'srd-5.2.1'` records the
   authoring edition; the SRD tables' existing `source` column is the ruleset key; `packages/rules`
   engine functions take a `ruleset` param so other editions (e.g. a 2014-style racial-ASI ruleset)
   can be added later without rewriting call sites; the wizard reads its ASI/trait rules from the
   active ruleset. No second ruleset is built now — only the seam. The eventual F03 adventure wizard
   will expose ruleset selection (noted in F02 for cross-reference).

3. **Characters must be portable across adventures/rulesets, so raw authoring choices are stored,
   not just derived numbers.** The `characters` row persists base ability scores (pre-ASI), the
   chosen ASI assignment, species/background/class keys, chosen skill/tool proficiencies, and
   equipment picks. Derived AC/HP/saves/skills are always recomputed by `packages/rules` from those
   inputs + the active ruleset — never frozen into the row as the source of truth — so a character
   taken into an adventure running a different ruleset recomputes rather than migrating stored math.

4. **NPCs share the character/statblock shape (documented, not built this phase).** F02's spec gains
   a short section describing NPCs as character-shaped records (same abilities/HP/AC/skills/
   equipment/images, re-derivable via the same `packages/rules` functions), distinguished by an
   owner/kind marker (`is_npc` / `controlled_by`), so F07/F09/F10 can build combat-ready and
   optionally-playable NPCs on the same engine. No NPC tables or UI are built in Phase 2.

**Why:** (1) Using the real 2024 data honestly beats inventing non-SRD racial bonuses to satisfy a
spec paragraph that predates the edition we ingested. (2)-(3) The user explicitly wants characters
reusable across adventures that may run different rules — storing choices (not frozen math) plus a
ruleset param is the minimum forward-looking seam that makes that possible without over-building a
multi-edition engine now. (4) NPCs are combat/roleplay entities later; capturing the shared shape in
the spec now avoids a divergent NPC model when F07/F09/F10 arrive.

**Updated:** `docs/F02-character-page-creator.md` (§3 step 3/4 ability model, §5 data model
`ruleset` + raw-choice storage, new NPC-structure + ruleset-portability notes); this entry.
Migrations, `packages/rules`, and `frontend/src/features/characters/` implement it.

## 2026-07-17 — F2 review round: wizard restructure, portrait pipeline revision, two RLS bugs

**Verdict:** CHANGES (user review of the first playable wizard build, same day).

**Bugs found by the user's manual testing (all fixed):**

1. **Every Phase 0 SRD table was unreadable from the app.** RLS was enabled on
   srd_monsters/spells/classes/class_features/items/weapons/armor with **zero policies** — all
   frontend reads silently returned nothing since Phase 0. Undetected because Phase 0 verification
   used Studio's SQL editor (superuser, bypasses RLS), never the anon-key path.
   `20260717160000_srd_tables_read_policies.sql` adds read-all policies; verified via anon-key
   REST call. Lesson recorded: verify RLS'd tables through the anon-key path, not Studio.
2. **Character image uploads always violated RLS.** The storage policies' EXISTS subquery over
   `characters c` referenced unqualified `name`, which bound to `c.name` (the character's name)
   instead of `storage.objects.name` (the file path) — the check could never pass.
   `20260717170000_fix_characters_storage_policies.sql` qualifies it as `objects.name`; verified
   by a live repro script (throwaway user + real upload, 200).
3. Bard's skill choices were dead (parser only knew "Choose N: list", not "Choose any N skills");
   Cleric has no Core Traits feature in the seeded data at all (hardcoded fallback added,
   transcribed from SRD 5.2.1); base-ui `SelectValue` rendered raw keys ("srd-2024_bard") — all
   keyed selects now pass a render function; Background step's ASI radio was derived state that
   snapped back (now real state); race Size/Speed rendered twice.

**Design changes requested (spec §3/§4 updated first, then implemented):**

- Class skill choices moved into the **Class** step; **Equipment** became its own step (class
  A/B/C + background A/B radio groups). Old drafts' step values are remapped on load.
- Standard Array now starts **pre-assigned and always-valid**; picking a value swaps it with the
  ability that held it (no more unexplained "each value exactly once" error).
- Background step shows **full detail cards**: skill one-liners, tool proficiency, and the Origin
  feat's real benefits — which required a new `srd_feats` table
  (`20260717170100_create_srd_feats_and_character_voice.sql`, 17 feats from Open5e /v2/feats) and
  an ingest-srd.mjs `buildFeats()` section. Also implements the SRD-2024 duplicate-skill rule
  (background grants a skill you already picked → choose a replacement).
- Personality step: suggestion chips (quirks/history/appearance incl. race-specific) that append
  to the freeform box; age/height/hair/eyes **pre-rolled from per-race ranges** (dwarf/elf
  lifespans etc., hardcoded ranges in `lib/physical-defaults.ts` — the SRD has no such tables) with
  a reroll button; **voice choice** (default narrator vs. uploaded clip) — new `characters.voice`
  jsonb column; the clip uploads to the character's Storage folder now, actual cloning is Phase 3
  (F12) work.
- Portrait pipeline revised: **auto-generates on step entry** from the accumulated description;
  **iterative image editing** (current image + change text → OpenRouter `/v1/images` with
  `input_references` — ai-proxy's image branch now passes the payload through instead of
  whitelisting `prompt`; redeployed); **the user crops only the token** (head framing) and the
  avatar (1.35× framing) + half-body portrait (3:4, head in upper fifth) are derived from that
  rect client-side. The last-5 generation history from the original spec is dropped for now (the
  edit loop supersedes it; only the latest full-body is kept).

**Updated:** `docs/F02-character-page-creator.md` (§3 steps, §4 pipeline, §5 data model:
`voice`, `srd_feats`, storage paths); this entry. Not rebuilt: Review step still lists only
computed stats (equipment picks/voice not yet summarized there) — acceptable for the checkpoint.

---

## 2026-07-17 — Phase 3b (F04) architecture decisions made during BUILD

**What:** Six implementation-level forks resolved while building the Adventure Guide pipeline &
editor, recorded for the Phase 3b gate review (`docs/CHECKPOINTS/PHASE3B.md`):

1. **Guide pipeline logic is canonical in `packages/rules/src/guide/` and mirrored (generated,
   not hand-copied) into `supabase/functions/_shared/guide/` by `scripts/sync-guide-shared.mjs`**
   (`--check` mode available for CI later). Extends the model-routing mirror precedent
   (2026-07-17 entry) to ~16 files: edge function bundles still can't reach outside
   `supabase/functions/`, but the stage parsers/prompts/validators need Vitest coverage and
   frontend access (`@rules/guide`). Source files use explicit `.ts`-extension imports
   (`allowImportingTsExtensions`) so the same files run under Deno unchanged.
2. **New `ingredient_generator` agent role** (default `deepseek/deepseek-v4-pro`) added to both
   model-routing mirrors and the Settings model map. MAIN-SPEC §4 lists the Ingredient Generator
   agent but §4.7's routing table omits it — treated as a spec gap, not a deviation.
3. **Pipeline execution model:** `guide_jobs` rows (one per stage × chapter slice, service-role
   writes only) processed by the `guide-pipeline` edge function, ONE job per invocation,
   self-chained via a fire-and-forget service-role re-invocation. The editor polls jobs every
   2.5s while generating and re-kicks the runner if the queue stalls (kick delivery is
   best-effort). A stage failure pauses the queue with the error on the job row (retry button
   per F04 §2); stale `running` jobs (>6 min) are failed automatically.
4. **Regeneration semantics (F04 §7):** every user edit sets `human_edited` on the row
   (row-level autosave on blur). Stage reruns delete-and-replace only `human_edited = false`
   rows; per-row "Regenerate" (chapters/objectives/npcs/locations) overwrites untouched rows but
   writes a `pending_regen` proposal on edited rows, rendered as a field diff with
   accept/reject. Structured-output enforcement is prompt + parse + one retry with validator
   feedback (no `response_format` dependence on the routed model, matching F03's precedent).
5. **Guide-time party assumptions for the Stage 5 budget check** (real Budget Engine is F09):
   party level = 1 + chapter index (one-shots: 3), party size = wizard min/max midpoint,
   difficulty = wizard preset (AI-Assist defaults standard). Out-of-band encounters become
   stage-5 `guide_warnings`, not failures.
6. **"Start Adventure" only validates for now** (≥1 objective/chapter, valid predicates, ≥1
   location, via `validateGuideReady`) — activation/embedding/lobby is F05/F13 work; wiring a
   fake `status='active'` with no lobby would violate rule zero.

**Why:** each keeps F04 buildable now without Docker/Deno tooling locally, without depending on
unbuilt features (F09 budget, F12 cloning/queue, F05 lobby), and with the regeneration and coop
acceptance criteria testable in Vitest.

**Updated:** `TASK.md` §2/§5, `docs/CHECKPOINTS/PHASE3B.md` (checkpoint block), this entry.
Voice preview: upload/profile/picker work end-to-end, but real Voxtral zero-shot clone preview
is F12 — preview falls back to playing the raw uploaded clip and says so.

---

## 2026-07-17 — Phase 3b addendum: edge wall-clock resilience (found by live smoke test)

**What:** The first live pipeline run (deployed with the user's access token, throwaway user,
tiny one-shot) died at stage 4: the LLM call took ~120s, its output failed validation, and the
in-invocation feedback retry was killed by the edge runtime's **150s free-tier wall clock**,
leaving the job stuck `running` with nothing kicking the queue. Fixes, re-verified by a second
clean run (`guide_ready` in 308s, 7/7 stages first-attempt, $0.034 total):

1. Jobs auto-requeue once on failure (fresh invocation = fresh wall clock) before the queue
   pauses for a manual retry; stale `running` rows (>4 min) are likewise requeued-or-failed.
2. The in-invocation validation retry only fires when <45s of invocation time has elapsed —
   otherwise fail fast and let the requeue retry in a fresh invocation.
3. The editor's stall nudge fires on ANY frozen pending state (queued *or* running), not just
   queued-with-nothing-running; `run` is a cheap no-op while a stage is genuinely in flight.
4. Stage output budgets cut (stage 4: 6000→4000 max tokens + explicit brevity rule; stage 5:
   5000→3500; stage 6: 4000→3000) so a single call plus writes fits comfortably in 150s.

**Why:** supersedes the "retry once with validator feedback in the same invocation" detail of
decision 4 in the Phase 3b entry above — same contract, but time-budget-aware.

**Updated:** `packages/rules/src/guide/stages/*` (token caps, stage-4 brevity),
`supabase/functions/guide-pipeline/runner.ts`, `frontend/src/features/guide/hooks/use-guide.ts`,
mirror re-synced, function redeployed; `docs/CHECKPOINTS/PHASE3B.md` AI TESTS updated.

---

## 2026-07-17 — Multiple fluid endings (new feature; F04 data+generation now, F08 steering later)

**What:** An adventure gets 3-5 hidden **candidate endings** instead of one fixed conclusion; the
story lands whichever ending the players' actual trajectory is closest to. User's four scoping
calls: **gentle pull** (reinforce the leading ending via hooks/beats, keep all reachable until a
late commitment — F08's existing pull-not-push principle applied to the resolution),
**adventure-level only** (chapter arcs still adapt via loops; per-chapter branch points are
backlog), **emergent-approved** (DM — or Full-AI on a clean Consistency pass — can author an
off-map ending mid-play, like player-theory canonization), **fold into F04 now** (the pipeline is
warm and nothing downstream depends on the guide shape yet, so getting the ending data model right
now is cheapest).

Architecturally this is the **BBEG-commitment tally** (F08 §8) generalized to the whole outcome: a
score accumulates per ending, and at a late threshold the system commits one.

- **F4 (built now):** new `endings` table (title/description/climax hidden, `tone`,
  `trigger_conditions {summary, signals:[{predicate, weight, note}]}` where each signal is a §4
  predicate atom + signed weight, `exclusivity_group`, `is_emergent`, `status`). New pipeline
  **Stage 8 "Ending Designer"** (whole-guide, runs last, sets `guide_ready`); Stage 1 additionally
  seeds 2-4 short ending premises so chapters escalate toward divergence. Reachability check
  (distinct endings, ≥1 valid signal each) → warnings. Hidden **Endings editor tab**. "Start
  Adventure" now also requires ≥ 2 endings. Stage numbering: endings appended as **stage 8**
  (guide_jobs constraint bumped 1-7 → 1-8) rather than inserting mid-sequence — avoids renumbering
  the verified hooks(6)/consistency(7) stages; `guide_ready` flip moved from stage 7 to stage 8.
- **F8 (specced now, built in Phase 6):** Ending Steward extends the Meta Loop Steward —
  deterministic weighted-signal scoring each state diff (argmax = leading, tie→lowest index so one
  always leads), an LLM holistic pass on chapter boundaries, gentle-pull steering into Beat
  Planner/Hook Weaver, late commitment proposal (assist: DM; Full-AI: auto only on decisive margin
  + clean Consistency), and emergent-ending proposals. Live state (`ending_scores`,
  `committed_ending_id`, `endings.status` transitions) is F8's, not in F4's authored shape.

**Why:** reuses the predicate engine + the proven commitment/canonization patterns rather than a
new subsystem; keeps players' agency central (their trajectory picks the ending) while the late
commitment preserves coherence; keeps the data shape stable before any downstream feature reads it.

**Updated:** `docs/F04-...md` (§2 pipeline, §3 data model, §4.2 new, §5.4 editor tab, §6/§7),
`docs/F08-...md` (§8.1 new, §10 criterion), this entry. Implementation: new migration, rules
`stage8`/stage1-premises/reachability, `guide-pipeline` stage 8 + renumbered guide_ready,
frontend Endings tab. F08 live steering is deferred to Phase 6.

---

## 2026-07-18 — Phase 3b addendum 2: reasoning tokens off for pipeline LLM calls

**What:** Live smoke run 3 failed stage 4 twice with "Model response had no content" — real cost
billed, 77-102s latencies: deepseek-v4-pro intermittently spent the entire completion budget on
reasoning tokens and returned empty content. `_shared/llm.ts` now sends
`reasoning: {enabled: false}` on pipeline calls (structured-output jobs — tokens belong to the
JSON), with an automatic one-shot fallback WITHOUT the parameter on any 4xx (models/providers
that reject it), and `guide_jobs` gets 3 attempts (was 2). Verified by smoke run 4: all 8 stages
to `guide_ready` in 375s / $0.052, stages ~2-3x faster and cheaper than with reasoning on; stage
4 still flaked twice on empties and the auto-requeue absorbed it.

**Why:** empty-content-with-cost is a silent failure mode the validation-feedback retry can't
fix (there is nothing to give feedback on); disabling reasoning removes the cause, the extra
attempt covers the residual flake. Note `ai-proxy`'s user-facing text path is untouched —
narrator/NPC prose may legitimately want reasoning; this only governs pipeline stage calls.

**Updated:** `supabase/functions/_shared/llm.ts`, `guide-pipeline/runner.ts` (MAX_ATTEMPTS 3),
redeployed; `docs/CHECKPOINTS/PHASE3B.md` AI TESTS.

---

## 2026-07-18 — Phase 3b addendum 3: entity registry + closed-vocabulary ending signals

**Trigger:** the user's first real pipeline run exposed two problems. (1) The run paused at a
stage-4 validation failure (coop-set near-miss; the >45s first call left no in-invocation budget,
so retries ran cold without the validator's feedback and never converged) — leaving zero
NPCs/locations/ingredients/endings, and the thin-context per-entity regen buttons then produced
entities disjointed from the plot (Mount Cinderpeak / Xyloth / High Priestess Lyra named in prose,
absent as rows). (2) Design review of endings: free-form flag/fact signals authored at guide time
have no guarantee the live Adjudicator ever writes those exact keys — signals could silently never
fire, and detailed authored climaxes can be contradicted by actual play.

**Decisions (user-scoped, all four recommended options accepted):**

- **Entity registry, no approval pause (F04 §2.1):** stage 1 emits the global named cast/places
  (`meta_loop.entities`), stage 2 emits per-chapter entity lists (`chapters.entities`), stage 4
  hard-validates that every listed entity becomes a row (feedback retry on miss), stage 7 warns on
  globals that never landed, and per-entity regen prompts carry the registry. Zero extra user
  clicks; the editor stays the review surface. Opt-in "pause after outline" toggle = backlog.
- **Closed-vocabulary ending signals (F04 §4.2):** signal `when` refs are restricted to
  `{objective_id, outcome}`, `{npc_id, state}`, or `{dial, gte|lte}` — only state the live system
  deterministically maintains. LLM authors by list number, pipeline maps to UUIDs and
  hard-validates resolution (dangling ref = stage failure). Free-text event atoms dropped.
- **Story dials:** stage 8 declares 2-4 adventure axes (`adventures.story_dials`); live values
  -5..5 nudged by F8's Summarizer with logged justifications; signals reference thresholds.
- **Vague canon, live climax:** an ending's canonical content is direction (title/tone/premise +
  trigger profile); `climax_summary` is an illustrative sketch and F8's Ending Steward re-authors
  the real climax at commitment from the actual event log (F08 §8.1).
- **Cross-invocation validation feedback (runner fix):** the failing job row already persists the
  validator's errors; the next attempt now feeds them back into the prompt even when the previous
  invocation had no budget for an in-invocation retry — the failure mode that stranded the user's
  run.

**Why:** consistency enforced mechanically beats approval gates (fewer clicks, no silent gaps);
signals that reference guaranteed-tracked state make ending selection objective and testable;
authoring the finale at commitment time makes story drift impossible by construction.

**Updated:** `docs/F04-...md` (§2, §2.1 new, §3, §4.2, §5.4, §7), `docs/F08-...md` (§8.1, §10),
this entry. Implementation: migration (chapters.entities + adventures.story_dials), rules stages
1/2/4/7/8 + regen, runner feedback, edge wiring, frontend Endings tab signal editor + dials.

---

## 2026-07-18 — Phase 4 BUILD: membership/session architecture decisions

Recorded at BUILD time (same convention as the Phase 3b entry); user gate happens at the
Phase 4 checkpoint.

- **All membership writes go through the `session` edge function; `adventure_members` is
  client-read-only.** Capacity caps, character locking (single guarded UPDATE on
  `characters.locked_adventure_id`), ready/min-player gating, and spectator admission are
  enforced server-side and race-free — F05's "enforced server-side, not just in UI" criterion
  can't be met with client-side RLS inserts.
- **`adventure_state` (jsonb GameState + `state_version`) scaffolds F07's single-writer
  contract.** Only the service role writes it, every write is optimistic-locked on the version
  it read, and every write fans out per-domain diffs over Realtime. Direct select is DM-only:
  players get their state exclusively through the role-filtered `resync` action, which is what
  makes "DM-only data never reaches player clients" a server guarantee instead of client
  courtesy. The GameState contract + merge-patch differ + hash live canonically in
  `packages/rules/src/state/` (mirrored to `_shared/state/`, same mechanism as guide).
- **Private Realtime channels with authorization policies** (`realtime.messages` RLS):
  `game:{id}` member-receive, `dm:{id}` DM-receive, `lobby:{id}` member presence
  send+receive. Verified live: player denied on dm channel, non-member denied on game channel.
- **`member_adventures` security-definer view instead of member RLS on `adventures`.** A member
  select policy on the table would expose `plot_idea`/`meta_loop`/`plot_history` (spoilers);
  the view whitelists safe columns. Also added `adventures.title` (no title existed in any
  spec/table — derived from chapter 1 at activation if unset), `party_profile`, `demo`, and
  `invite_code`.
- **No Zustand for the F06 client store (spec deviation).** F06 SS6 names Zustand, but the
  2026-07-16 no-Zustand decision stands: the play page uses a page-scoped context + the shared
  `applyDiffs` reducer logic. Revisit only if cross-tree state genuinely outgrows this.
- **First-session pass applies composition profile + coop affinity bindings directly** (writes
  `ingredients.reveals_to`), not as DM proposals — the proposal tray is F07 (Phase 5). Spec
  deviation flagged on the checkpoint. Backstory hook slots + interlocks (the LLM half of the
  Hook Weaver pass) are deferred to Phase 6 with F08 SS6; `party_profile.backstoryTags` stays
  empty until then.
- **Demo adventures (`demo=true`, seeded by `seed-demo-adventure.mjs`) use canned recap/summary
  text** — the scripted demo session spends zero credit. Real adventures route recap through
  the `narrator` role and session summaries through `summarizer`, with graceful fallbacks so an
  LLM failure never blocks session start/end.
- **Auto-checkpoints** fire on scene-mode transitions (demo driver) and session start/end;
  the spec's 10-minute timer has no serverless home until F07's orchestrator loop exists —
  noted on the checkpoint, revisit in Phase 5.

**Updated:** migrations `20260718110000-110200`, `supabase/functions/session/`,
`packages/rules/src/state/`, `frontend/src/features/play/`, seeders, CI mirror check now covers
`_shared/state`, `tests/integration/session-live.mjs`.

---

## 2026-07-18 — Phase 4 gate (PASS WITH NOTES): AI-Assist mode moved to Phase 10

User's gate reply on the Phase 4 checkpoint: the user is not a dungeon master, so the design of
the human-DM game flow is on hold, and **AI-Assist mode moves to Phase 10**. The Phase 4 design
review answers are provisional ("not breaking yet") — more design inputs will come during the
next phases.

- **Development is Full-AI-behavior-first from Phase 5 onward.** The F07 proposal pipeline is
  still built in full (MAIN-SPEC principle 1 stands: one pipeline, one flag), but the built-and-
  tested default is `approval_mode: auto` — every proposal auto-applies and writes a
  `proposal_log` audit row (`auto_applied`), identical to what F14 specifies.
- **Deferred to Phase 10:** the DM console / proposal tray UX (F07 §5), human
  accept/edit/reject flows, and assist-specific behaviors (proposal expiry timers, F09's 8s
  fast-proposal window, batch-approve UIs). The Phase 4 docked proposal-tray scaffold stays
  dormant until then. The assist-mode DM flow gets its own design pass at Phase 10.
- **Phase 9 (F14) becomes a hardening phase** (policy table, degradation ladder, X-card, wipe
  paths) rather than first contact with Full-AI. Its pre-gate trust report can no longer use
  F14 §7's human acceptance rates (no human decisions will exist) — it will use incident rates,
  consistency-block frequency, and user-flagged wrong moments, with a reworked §7 threshold set
  proposed for approval at that pre-gate. F14 §7's rework is deliberately deferred to then.
- **Not changed:** F03's mode selector still offers AI-Assist at creation (an assist adventure
  simply can't be meaningfully run until Phase 10); F07/F09/F14 spec text describing assist mode
  stays as-is — sequencing moved, not the architecture.

**Why:** the product owner can't evaluate a DM-facing workflow they don't have the experience to
judge; testing effort goes where their judgment is strongest (the player experience), and the
full-AI pipeline is the same code path with the flag flipped.

**Updated:** `MAIN-SPEC.md` §10 (build order steps 4/8/9), `DEVELOPMENT-PLAN.md` (Phases 5, 9,
10), `docs/CHECKPOINTS/PHASE4.md` (verdict + design-review skip notes), `TASK.md`.

---

## 2026-07-18 — Phase 5 BUILD: orchestration architecture decisions

Recorded at BUILD time (same convention as Phase 3b/4); user gate happens at the Phase 5
checkpoint.

- **The session function stays the single writer** — F07's Adventure Manager did not become a
  new function; the intent pipeline (router → adjudicator/dialogue → proposals → commit) lives
  in `supabase/functions/session/` and inherits `applyAndBroadcast`. A `commitDiffs` retry
  wrapper rebuilds diffs from fresh state on optimistic-lock conflicts (verified live by the
  concurrent-intent race test).
- **New `packages/rules/src/play/` module, mirrored to `_shared/play`** (router classification,
  check engine with seeded RNG, social DC table, group/assist rules, disposition/opening/reveal
  guardrails, LLM-output parsers with server-side clamping). `src/character` is now also
  mirrored (server-side skill modifiers needed real character math; its imports gained explicit
  `.ts` extensions for Deno).
- **Conversation State and the pending-check stash live in GameState's dm domain**, not a
  separate table — the dm domain is already DM-channel-only, and the stash (with the hidden DC)
  is verified to never reach player resyncs. Prompts (`dialogue.pending`), openings, typing
  indicator, and `addressedCharacterId` are new player-visible dialogue fields; migration
  20260718130000 backfills existing state rows.
- **Prompt deadlines are enforced on call, not by timers** — edge functions have no timers, so
  clients sweep expired prompts via `resolve_pending` and the server validates the deadline
  (409 before expiry, verified live). Same constraint family as the Phase 4 auto-checkpoint note.
- **Demo adventures use canned agent outputs for every Phase 5 agent** (adjudicator, social
  classifier, NPC, narrator, consistency, summaries) including deliberately adversarial
  fixtures (over-reveal, dead-NPC narration) — the 68-check live integration suite runs at
  exactly zero LLM spend (asserted via usage_log).
- **TTS is deferred to Phase 8 (F12)** despite the plan's Phase 5 "listen to streaming TTS"
  task: `voice_profiles` stores raw clips only — the provider-side voice creation (Mistral
  Voices API) that OpenRouter's TTS endpoint requires was never built and is F12 scope.
- **Deferred with reasons, nothing silent:** braided intents + loop-mismatch streak flag need
  F8 beats (Phase 6); objective completion predicate evaluation moves to Phase 6 with F08's
  story loop; assist-mode `needs_dm` rulings create pending proposals whose console arrives in
  Phase 10 (the server-side decide endpoint is complete and tested, incl. expiry); full-AI
  narration options auto-pick option 1 per F14's auto policy; multi-NPC crosstalk and "Ask the
  table" are v1.1 per spec.
- **Known simplification:** ingredient reveal conditions are free text, so the gate can only
  require "a successful check this utterance" — an insight success can satisfy a
  persuasion-worded condition. Tighten in F08/F13 if it bites in play.

**Updated:** migration `20260718130000_create_orchestration.sql` (proposals, npc_dispositions,
npc_interactions, npcs.generated, state backfill), `supabase/functions/session/` (+agents,
intent, prompts, npc-dialogue, narration, proposals, orchestrate), `packages/rules/src/play/`,
state contract extensions, `frontend/src/features/play/` (IntentInputRow, CheckPrompt, Story
tab, proposal tray, tap-to-roll), `tests/integration/orchestration-live.mjs`.

## 2026-07-18 — Phase 5 gate PASS; Phase 6 design: reactive story contract (quest offers & acceptance)

**Verdict:** Phase 5 (F07 + F10) GATE: PASS — all checkpoint boxes checked
(`docs/CHECKPOINTS/PHASE5.md`), including the paid real-LLM solo session and the two-player
cooperation test. F07 and F10 move to **gated**.

**CHANGES (user, at Phase 6 kickoff):** in fully-AI adventures the story felt passive — the
opening presumed party motivation ("You've come to these remote shores to uncover the truth…"),
narration never put a decision in front of the players, and quests were never *asked for or
accepted*. The user wants the player reactive and complicit in the story: a clear extrinsic
motivation (e.g. someone offers payment), an explicit yes before a quest drives play, and
narration that ends with the ball in the players' court — while the AI still guides the story
to an ending. Design resolved via a full grill-me interview (all recommendations accepted):

1. **Scope:** the entry hook AND every quest-shaped core loop arrive as offers; objectives
   inside an accepted quest flow without re-asking.
2. **Mechanic:** in-fiction offers + tracked `quest_offers` state with a player-visible banner;
   accept/decline/negotiate detected from free text by the Router/classifier — no buttons.
3. **Party semantics:** any PC's clear acceptance binds the party (no voting UI).
4. **Negotiation:** haggling runs through the existing F10 influence pipeline, bounded by
   guide-authored reward floor/ceiling.
5. **Decline:** honored; giver disposition shifts; Meta Loop Steward advances the antagonist
   plan; Hook Weaver re-weaves from a different angle at most 2×; then consequences physically
   reach the party; persistent disengagement → emergent "walked away" ending (Ending Steward).
6. **Motivation source:** authored `quest_contracts` in the guide (F04 Stage 6: exactly one
   entry contract, giver staged in the entry scene; optional side contracts), adapted live.
7. **Rewards:** simple party gold ledger in game state now (event-logged payouts); items/XP
   stay narrative until F11.
8. **UI:** minimal quest journal extending the objective display (active quest, giver, terms,
   stakes, suspended quests) + system lines in the story feed on accept/decline/payout.
9. **Concurrency:** accepted quests map onto the F8 loop stack (one active, others suspended);
   ≤ 2 unresolved offers outstanding.
10. **Narration contract:** every beat ends at a concrete decision point (situational, not a
    formulaic "What do you do?"); openings stage the entry offer and never presume motivation.
11. **Pacing:** event-driven in full-AI — beat exit → Beat Planner → Narrator opens the next
    beat automatically; idle players get one in-fiction nudge (default 3 min, configurable);
    plot never advances without player input; "Narrate next" stays as manual override.
12. **Ending guarantee:** unchanged — Ending Steward (F8 §8.1) still steers to a conclusion;
    the refusal ending makes even total disengagement a real ending.

**Spec updates (spec-first per change rules):** `docs/F08-story-loop-system.md` new §2.1
(quest contracts & offer lifecycle), §2.2 (quest journal), §6 offer-delivery note, §9
acceptance-gates-activation, new §9.1 (reactive narration & pacing contract), §10 criteria;
`docs/F04-adventure-guide-pipeline-editor.md` `quest_contracts` shape + §4.3, Stage 6 output,
Start-Adventure validation (entry contract; first objective now hidden behind the entry offer),
§7 criteria; `docs/F07-live-orchestration-core.md` §5.1 narration contract note.

## 2026-07-18 — Phase 6 slice 1 BUILD: offer-pipeline architecture decisions

- **Offer detection is a pre-routing hook, not a Router route:** with an open offer, `say`/`do`
  text runs a cheap offer classifier (canned keyword match on demo, one small LLM call live)
  before `classifyIntent`; `unrelated` falls through to the normal pipeline untouched. Keeps
  the deterministic Router pure and the offer path additive.
- **Reaction beats go through the Narrator only** (`story.ts` never imports the NPC pipeline):
  giver reactions to accept/decline/haggle are narration, not `npcReply`, because
  `npc-dialogue.ts` must import `finishNegotiation` for the check-resume path and an import
  cycle would result. Revisit in slice 3 if giver-voiced replies matter (a shared beat module
  would break the cycle).
- **Journal state placement:** offers/quests live on the `objectives` domain (the journal is an
  extension of the objective display per F08 §2.2), party gold on `players.gold`. No new diff
  domain. `quest_offers`/`core_loops`/`beats`/`quest_contracts` tables are DM-read-only
  (negotiation ceilings and beat plans are hidden info); the player-visible subset travels in
  GameState only — verified by RLS checks in the live suite.
- **Accepted quests push a `custom`-type core loop** labeled with the quest; the Loop
  Classifier (slice 3) owns real typing/pivots. Negotiation stash is a third
  `pendingContext` flow (`negotiate`) beside `do`/`social`, resumed by `continueAfterCheck`.
- **Re-weaves are DM-triggered for now** (`dm_command stage_offer`, budget-enforced, terms
  escalate halfway to ceiling per declined round); the Hook Weaver automates re-weave timing
  and angle in slice 3. Third decline logs `consequence_due` for the slice-4 Steward.
- **`complete_quest` is a DM override** (F07 §5.2 checkbox family) with `paid_at` as the
  payout idempotency guard (second call 409s); automatic completion via objective predicates
  is later Phase 6 work.
- **Demo seed unchanged:** the Phase 4/5 scripted demo pre-activates its objective, so it does
  not exercise offers; the story suite builds its own contract fixture. A demo contract (and
  Stage 6 authoring) lands with slice 2 so the user's manual demo run shows the offer flow.

**Updated:** migration `20260718150000_create_story_loops.sql`, `packages/rules/src/story/`
(+ `_shared/story` mirror, sync script now mirrors 5 modules), state contract
(players.gold, objectives.offers/quests), `supabase/functions/session/` (story.ts new; agents,
intent, prompts, npc-dialogue, lifecycle extended), `frontend/src/features/play/`
(offer-banner.tsx new; player-sidebar, dm-overview-panel, play-page extended),
`tests/integration/story-live.mjs` (50 checks). Deployed live; migration applied.

## 2026-07-18 — Phase 6 slices 2-5 BUILD: full F08 story brain (decisions + deviations)

**Built on top of slice 1:** Stage 6 quest-contract authoring (F04 §4.3: entry contract
hard-validated - giver resolves to a first-chapter NPC, dangling refs = stage failure; re-runs
preserve human-edited contracts), contract editor cards in the Plot tab + Start-Adventure
validation, demo-seed entry contract (first objective now hidden behind Maren's offer), Beat
Planner + Loop Classifier + live Hook Weaver + Variety Manager + idle nudge (slice 3), and
predicate evaluation + Ending Steward + Meta Loop Steward + player-theory canonization
(slice 4). Architecture decisions, nothing silent:

- **Classifier trigger is deterministic:** `intent kind -> pillar` tagging vs the loop
  template's pillar profile; 3 consecutive off-loop intents run the classifier (streak in
  `dm.story.offLoopStreak`; mid-band full-AI pivots set a -5 cooldown = "re-evaluate after 5
  events"). Thresholds per spec: propose >= 0.65, full-AI auto-accept >= 0.8.
- **Braided beats: emission only.** The Planner emits pairs gated on the composition profile
  (skills present + party size, soft-dropped otherwise); pairs are stored and fed to agent
  context, but the live linked-DC resolution between two clients (F07 §3.4 golden fixture)
  is deferred to Phase 7, where F09's encounter specs consume the same link shape. The F07 §8
  braided acceptance criterion stays open until then.
- **Ingredient Generator folded into planner requests:** unmet requests become ingredient rows
  from the request's own purpose text (no second LLM call); pool reuse asserted by fixture
  (`beat_ingredient_reused` vs `ingredient_generated` events).
- **Predicate world state lives in `dm.facts`** (`world`/`flags` beside `npcStates`) + marker
  events (`story_event` rows, exact-tag match). Progress passes run at story-relevant points
  (dm story commands, quest completion, beat opens, check resolutions via commands), not
  literally on every diff. **`propose_objective_completion` (Adjudicator ambiguous atoms) is
  deferred** - v1 completion sources are deterministic predicates + the DM-command override
  family. Flagged for the gate; revisit before F14 hardening.
- **Ending Steward:** deterministic scoring on every progress pass (argmax, index tie-break),
  commitment only when the final objective is in play + margin >= 3 + >= 30 recorded events;
  full-AI auto-commit gated on the Consistency scan; climax re-authored live from the event
  log at commitment. **The holistic LLM confirm pass (chapter boundaries) and emergent/refusal
  ending authoring are deferred** - `consequence_due` (re-weave budget exhausted) is the
  authored hook for the refusal path; wire both when F13's condensed-event summaries exist.
- **Dial nudges run at session end** over the transcript (±1/±2 clamped, justification logged
  per move); per-scene nudges can move to `end_encounter` later without schema change.
- **Suspicion = keyword heuristic + registry-name match** (F08 §11 starting point); BBEG
  commitment at tally >= 5 with >= 2 sessions, full-AI commits only if the NPC isn't dead,
  retro-pass plants a hook. **Canonization** ships the full-AI path (clean registry-wide
  Consistency scan -> `player_theory` ingredient; conflicts surface as `canonization_blocked`
  with violations); the DM "Make it true" surface is Phase 10.
- **Idle nudge is client-swept** (DM client timer -> `idle_nudge` action; server validates
  idleness against event-log age, dedupes, and never advances plot) - same no-timers family
  as prompt deadlines. Default 3 min, `set_auto { nudge_minutes }` to change.
- **Backstory interlocks (F08 §6) defer to Phase 7** - they link *personal* progression
  loops, which don't exist until F11.
- **Existing guide_ready adventures predate contracts:** they fail the new Start-Adventure
  validation until Stage 6 is re-run (Regenerate guide) or a contract is added in the editor.
  Active adventures are unaffected (no entry gating once started).

**Updated:** migrations `20260718160000` (contract editing columns) + `20260718170000`
(meta_loop, adventures ending columns); `packages/rules/src/guide/` (stage6 contracts,
validation) + `src/story/` (templates, classifier, beats, evaluate, endings, variety - rules
suite now 255 tests); `supabase/functions/guide-pipeline/stages-weave.ts`;
`supabase/functions/session/` (story-agents.ts, beats.ts, progress.ts, steward.ts new;
intent/lifecycle/npc-dialogue/index extended); `frontend/src/features/guide/` (contract card,
validation, types) and `features/play/` (idle sweep); seed;
`tests/integration/story-live.mjs` -> 92 checks. All deployed; both functions redeployed.

## 2026-07-19 - Encounter states: totalizing machine + retrieval memory (Slices 1-7)

- **Narrative play is a two-phase machine** (CUTSCENE | ENCOUNTER) in full-AI narrative
  modes: entry mapping (`offered`/`adhoc`/`fold_in`) replaced free-form say/do adjudication;
  the transcript milestone recognizer was REMOVED - encounter outcome maps (validated against
  the authored milestone vocabulary) and in-encounter adjudicator claims are the only
  progression writers. Assist mode keeps free adjudication (human DM drives).
- **Embedding model for memory_fragments:** `openai/text-embedding-3-small` via the
  OpenRouter `/embeddings` endpoint with `dimensions: 1024` ($0.02/M tokens - cheapest
  reliably-available embeddings model on the account; matches the `vector(1024)` column).
  Single helper `callEmbedding` in `_shared/llm.ts`, logged to usage_log as kind
  'embedding'. Retrieval is enrichment only: every failure degrades to "no memories".
- **Guide-time danger/encounter_table authoring deferred:** locations gained `danger` +
  `encounter_table` columns and the runtime honors them, but Stage 4/5 prompts do not author
  them yet - every existing guide lacks them anyway, so the generated fallback table is the
  operative path. Regenerate guides once stage authoring lands.

## 2026-07-20 - Unified player input (Say/Do removed)

- Playtest decision: the player talks to ONE input and the DM interprets. The UI sends
  everything as kind 'say' (single Send button; explicit Roll stays); the server treats
  say/do identically in narrative modes and interprets intent where a decision is needed:
  the social classifier gained {"kind": "action"} to escape physical actions out of NPC
  conversations, the Adjudicator gained flags.talk (questions/table talk -> an answered DM
  reply, never a check), and the Puzzle Judge gained "talk" (questions cost no attempts).
  Mid-encounter says with nobody staged route to the new encounter_talk handler - inputs
  never silently vanish. kind 'do' remains accepted on the wire (tests, back-compat);
  variety/classifier bookkeeping now uses the interpreted pillar, not the button.

## 2026-07-20 - DM-called checks with skill-option buttons

- Table-style check flow (the "Phillip and the gargoyles" pattern): the DM calls for checks;
  players never roll unprompted. The Adjudicator may offer `skill_options` (up to 3, primary
  first) on any check; the prompt UI turns them into per-skill Roll buttons and
  `roll_pending` accepts the picked skill (validated against the offer; modifier per pick;
  skill challenges carry per-option escalated DCs in the stash). Questions probing hidden
  info now spec a check instead of a free talk answer - only plain-sight questions stay
  free. The input row's always-visible skill select + Roll was removed (the character-sheet
  rolls in the sidebar remain); the fast-path `roll` intent stays on the wire.

## 2026-07-20 - Character-aware play + visible dice

- **Character profiles feed every agent**: `characterProfiles()` (orchestrate.ts) builds one
  line per PC from race_key -> srd_races traits (Darkvision etc.), background_key,
  personality/freeform quirks, and background_narrative (all capped). Fed to the Adjudicator
  (rules on traits: trivializing trait -> auto_success/advantage/lower DC, named in the
  rationale), the challenge adjudicator, entry mapper, Beat Planner (plans around who the
  party IS), Narrator (personalization line in NARRATOR_BASE + exposition; party block in
  the grounded prompt), and the NPC bundle (NPCs react to traits/quirks).
- **Every rolled check prints its die**: "Kestrel rolls investigation: 7 (d20 5 +2) -
  failure" transcript lines on solo/group/assist/auto rolls (prompts.ts rollLine). The DC
  stays hidden; the fast-path roll line was already visible.
- **Trait-aware encounter design** (same day): both Encounter Designers (authored + ad-hoc)
  receive the party profile lines and design around them, emitting `trait_notes` in the
  challenge params; the mid-challenge adjudicator context carries those notes so rulings
  stay consistent with the design (a dark passage designed as "the dwarf's Darkvision moment"
  rules that way on every attempt).

## 2026-07-20 - Story-flow playtest fixes (circling + NPC amnesia)

- **Anti-circling**: committing to move IS engagement - the entry mapper maps "I walk
  forward"-style replies to `offered` (verified live: instant encounter entry), sees its own
  recently folded-in replies (a repeat/continuation must never fold twice), and fold_in
  narration now CARRIES the action forward - never re-asking answered questions; single
  obvious paths get walked, not re-offered as menus. Same guidance added to the narrator's
  beat/exposition styles (no fake forks, no re-offered choices).
- **NPC in-scene memory**: runNpcAgent never received the current scene's transcript - only
  the latest utterance - so NPCs forgot items handed over two lines earlier (the orb,
  Whispers in the Dark). NpcContext now carries recentLines (last 12) rendered as "THIS
  SCENE SO FAR (never contradict or forget it)"; the gist path gets the tail too.
- Known flake, unrelated: the npc_agent default model intermittently returns empty
  completions (pre-existing, one retry built in) - swap the npc_agent entry in the model map
  if it recurs in play.

## 2026-07-20 - Stuck-hint ladder (ask-for-hints when players don't know what to do)

- Distinct from the idle nudge (which fires on silence): a "stuck" detector for players who are
  ACTIVELY trying but not progressing. Pure decision in `packages/rules/src/play/hints.ts`
  (`decideHint`); the server (`session/hints.ts`) counts no-progress player turns since the last
  progress event (milestone/beat-exit/objective/encounter_resolved/encounter_opened/scene_travel/
  offer_accepted/successful encounter_attempt/offered-or-adhoc entry) and delivers an escalating,
  diegetic nudge drawn from real content.
- **One 4-rung ladder, two entry points:** (1) re-frame [no new info], (2) orient [surface an
  undiscovered ingredient or a Hook Weaver seed], (3) steer [next authored puzzle hint / a
  companion proposes an approach / narrow the challenge in-fiction], (4) fail-forward [resolve the
  open encounter via its on_failure, or the world opens a path] - never a hard-lock, never a
  mechanic named. Player-requested (the "get your bearings" compass button) climbs immediately;
  the full-AI auto-sweep (client timer, 20s after the table settles, like the idle sweep) engages
  only past `hintTurns` (default 3, DM-configurable via set_auto) and unlocks one rung per ~2
  no-progress turns. Rung 4 (fail-forward) is full-AI only; assist stops at rung 3 and routes
  through the narration review gate. Logged `hint_given {rung, source}`.

## 2026-07-22 - Stage 7 auto-repairs its own consistency findings (F04 SS2 amendment)

- F04 SS2 said the consistency pass "never rewrites content". Amended: creators were shown
  1-3 stage-7 warnings per generated guide (measured across ~54 paid generations) and the
  fix was always manual. Stage 7 now runs the same loop live play's consistency system uses -
  check, ONE constrained regeneration, re-check, fail open - against the guide itself.
- The amendment keeps SS2's actual principle, which was "never SILENT rewrites": every applied
  repair logs a `guide_repair` event with the warning, the before/after text, and the model's
  note; a `guide_repair_summary` records found/attempted/applied/residual; `human_edited` rows
  are never touched (same rule as stage reruns); anything unresolved still ships as a warning.
- Scope is deliberately textual: repairs may rewrite only whitelisted fields
  (`REPAIRABLE_FIELDS` in `packages/rules/src/guide/stages/stage7.ts` - objective
  title/hidden_description, npc/location description, ingredient text/reveals). Structural
  findings (missing rows, chapter moves) are not repairable and remain warnings. Repaired
  objective titles are held to the stage-3 word cap by the parser.
- Repair direction is story-first by prompt: keep twists hidden (retitle openly, push secrets
  into hidden_description), re-point dangling references at EXISTING canon (never invent new
  named entities), preserve flavor. The residue warning set comes from RE-RUNNING the checker
  on the patched digest, so shipped warnings describe the guide as it now is - including
  anything a repair newly broke.
- Stage-5 encounter-budget warnings are explicitly out of scope (combat balance, not
  consistency; the F09 combat work owns that).
