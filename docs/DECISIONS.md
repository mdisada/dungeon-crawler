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
