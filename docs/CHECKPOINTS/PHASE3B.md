=== CHECKPOINT: F04 — Adventure Guide Pipeline & Editor (Phase 3b) ===

BUILT:

- **Migrations** (all applied live; `db push --dry-run` showed exactly the three, then pushed):
  - `20260717190000_create_voice_profiles.sql` — `voice_profiles` + private `voices` bucket
    ({user_id}/ path policies); `adventures.narrator_voice_id` upgraded text → uuid FK.
  - `20260717190100_create_guide_content.sql` — chapters, scenes, objectives, npcs, locations,
    coop_sets, ingredients, hooks, encounters, guide_warnings; `adventures.meta_loop`;
    creator-only RLS on everything via an `owns_adventure()` helper; private `adventure-media`
    bucket ({adventure_id}/ path policies, objects.name qualified per the F02 bug).
  - `20260717190200_create_guide_jobs.sql` — pipeline job rows, select-only RLS (service-role
    writes only), one reusable slot per (adventure, stage, chapter).
- **Pure pipeline logic in `packages/rules/src/guide/`** (canonical; frontend imports it as
  `@rules/guide`): predicate validator + raw-JSON parser (F04 SS4 grammar), per-stage prompt
  builders and schema parsers for all 7 stages (objective titles ≤ 6 words enforced, predicate
  validation inside stage 3, local-key reference resolution in stages 4/5, handle digests for
  6/7), SS4.1 coop conformance (split-knowledge 2-3 clue members with affinities; density
  guardrail = at most 1 coop-demanding obstacle per 3 objectives), SRD XP budget engine
  (thresholds, CR→XP, encounter multiplier, 60-140%% verdict band), affinity binding with
  maximum matching + any_pc degradation, `validateGuideReady` (Start Adventure), regen
  diff/decide helpers, per-entity regeneration contracts.
- **`scripts/sync-guide-shared.mjs`** — generates `supabase/functions/_shared/guide/` from the
  canonical package (edge bundles can't reach outside `supabase/functions/`); `--check` mode
  detects a stale mirror. Mirror is synced.
- **`guide-pipeline` edge function** (`supabase/functions/guide-pipeline/`): actions `start`
  (wipe + stage-1 job + kick), `run` (one job per invocation, self-chaining kick, stale-job
  recovery), `retry` (failed job → queued), `regenerate` (per-row for
  chapters/objectives/npcs/locations — overwrite if untouched, `pending_regen` proposal if
  human-edited). Model routing per creator's settings incl. new `ingredient_generator` role
  (both model-routing mirrors + Settings UI updated); per-call `usage_log` rows; LLM validation
  failures retried once with the validator's errors fed back. Stage 5 writes budget warnings;
  stage 6 derives objective link chips from hooks; stage 7 writes warnings and flips
  `guide_ready`. **Deployed** (with the `SUPABASE_ACCESS_TOKEN` you provided; `ai-proxy`
  redeployed too so both share the updated model-routing) and **smoke-tested end-to-end live**
  — see AI TESTS. Wall-clock resilience added after the first smoke run exposed the edge
  runtime's 150s limit killing stage 4 mid-retry: jobs auto-requeue once into a fresh
  invocation (in-invocation validation retry only fires when >45s of budget remains), stale
  `running` corpses are requeued after 4 min, and the editor's stall nudge now also fires on a
  frozen `running` job.
- **Frontend `features/guide/`** at `/adventures/:id/guide`: header (status, Start Adventure
  validation CTA, Regenerate guide, ingredients drawer toggle), live pipeline progress with
  per-stage chapter counts + retry buttons, Plot & Objectives tab (chapter accordion, editable
  arc summaries, objective rows with inline title edit / hidden description / predicate editor
  (form builder + raw-JSON escape hatch) / link chips / consistency badges / add & delete /
  per-row regenerate), NPCs tab (list + overview, editable fields, explicit-click image
  generation through the F2 TokenCropTool, per-NPC voice picker), Locations tab (description,
  manual background generation keeping last 3, 32×32 battle-map editor: generate/upload image,
  obstacle tiles, spawn markers), collapsible Ingredients drawer (chapter/type filters, coop
  sets as grouped cards with affinity chips + dissolve), regen proposals rendered as
  field-level diffs with accept/reject. Every edit autosaves row-level (on blur) and marks
  `human_edited`. `/adventures/:id` now redirects non-drafts to the guide; the wizard CTA calls
  the pipeline `start` action.
- `tests/integration/rls-guide.mjs` — all guide tables + voice_profiles cross-user denial +
  guide_jobs client-write lockout.
- Six BUILD-time architecture decisions recorded in `docs/DECISIONS.md` (2026-07-17 Phase 3b
  entry): rules-package-canonical mirror, ingredient_generator role (spec gap), job-chain
  execution model, regeneration semantics, guide-time party assumptions, Start-Adventure-as-
  validation-only.
- **Multiple fluid endings (added mid-checkpoint on your request; specs updated first — F04
  SS4.2 + F08 SS8.1, decision logged):** new `endings` table
  (`20260717200000_create_endings.sql`, applied live) — 3-5 hidden candidate endings with
  weighted trigger signals (single predicate atoms + signed weights); Stage 1 now also seeds 2-4
  divergent ending premises; new pipeline **Stage 8 "Ending Designer"** runs last, writes
  reachability warnings (ungrounded/duplicate/no-positive-signal endings), and now owns the
  `guide_ready` flip. Hidden **Endings tab** in the editor (cards with editable
  description/climax/tone, per-signal predicate builder + weight, add/delete/regenerate with the
  same pending_regen diff flow). "Start Adventure" validation now also requires ≥ 2 endings.
  Live scoring/steering/commitment is F08's Ending Steward (specced, built in Phase 6).
- **Reasoning-token fix (found by smoke run 3):** deepseek-v4-pro intermittently burned the
  whole completion budget on reasoning tokens and returned empty content. Pipeline LLM calls now
  request `reasoning: {enabled: false}` (with a no-reasoning-param fallback on 4xx), and jobs get
  3 attempts. Side effect: stages run ~2-3x faster and cheaper.
- **Entity registry + closed-vocabulary endings (added mid-checkpoint on your feedback; specs
  updated first — F04 §2.1 + §4.2 rewritten, F08 §8.1, decision addendum 3 logged):** your first
  real run exposed two problems — regenerated NPCs/locations/endings were disjointed from the plot
  (Mount Cinderpeak / Xyloth / High Priestess Lyra named in prose but absent as rows), and ending
  trigger signals used free-form flags/facts the live system has no guarantee of ever writing.
  Fixes: (1) an **entity registry** — stage 1 emits the global named cast/places, stage 2 emits
  per-chapter entity lists (`chapters.entities`), stage 4 **hard-validates** every listed entity
  becomes a row (feedback retry on a miss), stage 7 warns on globals that never landed, and
  per-entity regen prompts carry the registry so regenerated entities stay in the canonical cast;
  (2) **closed-vocabulary ending signals** — a signal's `when` is now `{objective_id, outcome}` /
  `{npc_id, state}` / `{dial, gte|lte}` only, mapped from LLM list-numbers to row UUIDs and
  hard-validated (dangling ref = stage failure); (3) **story dials** (`adventures.story_dials`,
  2-4 axes stage 8 declares, live values -5..5 nudged by F08's Summarizer) capture tonal
  trajectory objective outcomes can't; (4) endings are now **direction not script** —
  `climax_summary` is an illustrative sketch, F08 re-authors the real climax live at commitment so
  play can't contradict it. New migration `20260718090000_entity_registry_and_story_dials.sql`
  (applied live). Also fixed a **cross-invocation feedback gap** in the runner: a job that
  wall-clock-died mid-validation now carries its persisted validator errors into the fresh
  invocation's first call (the failure mode that stranded your run at stage 4).

AI TESTS:

- `packages/rules`: 103/103 pass (`tsc --noEmit` clean; endings/registry suite: stage-8 dials +
  closed-vocab signal parse, out-of-range/unknown-dial/dangling-ref rejection, both-or-neither
  gte/lte, distinctness warnings, stage-1 premises + entity registry, stage-2 chapter entity list,
  stage-4 required-entity coverage (missing-entity rejection), lenient name matching, stage-7
  registry-coverage warnings, ending regen closed-vocab ref mapping, ≥2-endings validation) —
  recorded-fixture schema-conformance per
  stage (code fences, preamble chatter, chapter-count bounds, one-shot = 1 chapter, >6-word
  title + bad predicate both reported, unknown placement/coop/handle keys, boss-update
  completeness, battles-need-enemies), predicate suite (spec example, every atom, nesting,
  rejection paths, raw-JSON round-trip), coop conformance (density cap, member/affinity rules,
  solo exemption, min_players≥2 requirement), affinity fixtures (3-PC distinct binding, 1-PC
  any_pc degradation, augmenting-path reassignment), budget math (CR→XP, multipliers,
  thresholds, verdict band, unknown CRs), regen preserves-edits diff, per-entity regen parsing.
- `frontend`: `npx tsc -b` 0 errors, `npx eslint .` 0 errors, 29/29 tests pass (predicate-builder
  round-trip incl. the spec example — F04 SS7 criterion), `npm run build` clean. Endings tab
  rebuilt for the closed-vocabulary signal editor (Objective/NPC/Dial pickers) + story-dials
  display.
- Migrations applied live; `node tests/integration/rls-guide.mjs` — PASS live.
- `node scripts/sync-guide-shared.mjs --check` — mirror in sync.
- **Live end-to-end pipeline runs (deployed function, real models, throwaway users + tiny
  one-shots, cleaned up after): PASS twice.** Run 2 (7 stages): `guide_ready` in 308s, $0.034,
  fully conformant content incl. a split-knowledge coop set with distinct affinities. Run 4
  (all **8** stages, after the endings amendment): `guide_ready` in 375s, $0.052 — **4 distinct
  candidate endings** (exorcism-freedom / bury-it-under-glass / willing-vessel / catastrophic-
  activation) each with 4 weighted atom signals *including negative counter-signals*, zero
  reachability warnings; stage 4 flaked twice (empty reasoning-only responses) and the
  auto-requeue absorbed it (`done(3)`). Run 1 exposed the 150s wall-clock kill, run 3 exposed
  the reasoning-token empties — both fixed as described in BUILT and re-verified.

COULD NOT VERIFY:

- **Whether a generated guide is *good*** — coherent chapters, non-spoiling objectives,
  interesting NPCs, toys-not-railroads (the F04 known-unknowable; your critical read is the
  test). Note: the smoke run produced 13 consistency/budget warnings on a 1-chapter guide —
  possibly the Consistency Checker over-flagging; judge on your real run.
- No Deno-level typecheck of the edge function (no Deno locally, per the Phase 1 decision) —
  though the API bundler accepted it and the live run exercised every stage's code path.
- Image/map generation quality (placeholder mode only here) and the crop-tool feel on NPC art.
- Voice preview plays the raw uploaded clip when TTS cloning fails/unavailable — real Voxtral
  zero-shot cloning is F12; the ai-proxy TTS path with a clip URL as `voice` is untested.
- No RTL component tests for the editor (same gap flagged on F2/F3 checkpoints).

YOUR TESTS:

- [x] Run the wizard end-to-end: create an adventure (min players ≥ 2, multi-chapter) with a
      plot you actually want to play, click **Generate Adventure Guide**, and watch the
      pipeline progress through all 7 stages (measured cost: a 1-chapter one-shot ran $0.034;
      a 3-chapter campaign ≈ 15 calls, est. **$0.10-0.20** — authorize before clicking).
- [x] Read the whole generated guide critically (DEVELOPMENT-PLAN 3b task 2): objectives short
      and open? hidden descriptions catch the plot? ingredients toys, not railroads? coop sets
      sensible split clues with plausible `reveals_to` affinities? Check chapter count landed
      inside your wizard range.
- [x] Edit an objective title, then hit its **Regenerate** — confirm you get an amber proposal
      diff (not an overwrite) and both Accept / Keep mine work. Regenerate an *unedited* row —
      confirm it just changes.
- [x] Open **Completion conditions** on an objective: round-trip builder ⇄ Raw JSON; paste
      broken JSON and confirm it's blocked with errors.
- [x] If any stage fails (or force it: briefly switch your Settings provider to "local", retry a
      stage, switch back) — confirm the pause + error + Retry button behavior.
- [x] **Upload a narrator voice clip** (3-30s WAV — DEVELOPMENT-PLAN 3b task 3) and hit
      Preview; note whether you get a cloned line or the raw-clip fallback message.
- [x] On an NPC: click **Generate image** (real credit, ~a cent), crop the token, confirm all
      four images land and the portrait shows in the list. Record 1-2 NPC clips and assign them
      (task 5).
- [x] On a location: generate a background, then a battle map; paint obstacles + spawns and
      save; **upload 2-3 of your own 1024×1024 map designs** (task 4) and decide: generated
      maps / your uploads / templated zones → record the verdict in DECISIONS.md.
- [x] Open the Ingredients drawer: filter by chapter/type, edit a clue, dissolve a coop set.
- [x] ~~Open the Endings tab (old free-form predicate shape)~~ — superseded by the closed-vocab
      rewrite below; re-test on a freshly regenerated guide.
- [x] **(amendment 2) Regenerate the guide** and confirm cohesion: every NPC/location named in
      your plot now exists as a row (no more Mount-Cinderpeak-style ghosts). Check each chapter's
      generated NPCs/locations match what its arc mentions.
- [x] **(amendment 2) Open the Endings tab** (new shape): read the story **dials** at the top —
      are they the right 2-4 axes your endings diverge on? Read the 3-5 candidates — genuinely
      different resolutions? Each signal now picks Objective/NPC/Dial from a dropdown (no free
      text) — add one, flip a comparator, edit a weight, regenerate one ending and confirm the
      diff proposal. Note the climax is labeled an illustrative sketch (real one is written live).
- [x] Click **Start Adventure** on the finished guide (expect "valid, lobby arrives with F05");
      delete a predicate first and confirm validation catches it. Also delete endings down to
      one and confirm validation demands at least two.
- [x] Run `node tests/integration/rls-guide.mjs` from the repo root and confirm `PASS`.

YOUR TASKS:

- [x] ~~Deploy the pipeline function~~ — done with the `SUPABASE_ACCESS_TOKEN` from
      `frontend/.env.local` (`npx supabase functions deploy guide-pipeline --use-api
      --project-ref nlbkcktjzjludhyhajig`); `ai-proxy` redeployed alongside. Verified by two
      live smoke runs.
- [x] Authorize the full pipeline run above (est. $0.10-0.20 for a 3-chapter campaign at
      measured rates).
- [x] Narrator voice clip (3-30s WAV), 1-2 NPC clips, 2-3 of your own 1024×1024 map designs.

DESIGN REVIEW:

- [x] Ingredient volume: prompts target 6-10 per chapter (hard parse bounds 4-12) — right
      default? (F04 §8 open question.)
- [x] Predicate builder: are the three atom forms usable as-is, or do you want preset buttons
      ("NPC defeated", "location reached") that prefill a fact/event atom?
- [x] Coop density guardrail reads §4.1 as floor(objectives/3) coop-DEMANDING sets per chapter
      (a 2-objective chapter gets 0 demanding, split-knowledge still allowed) — agree?
- [x] Budget assumptions: party level = 1 + chapter index (one-shot 3), size = range midpoint —
      fine until F09's real Budget Engine?
- [x] Editor layout: three tabs + right drawer (per spec) — comfortable at your screen size?
      Anything the Guide header should surface that it doesn't?
- [x] CI currently doesn't check the `_shared/guide` mirror; adding
      `node scripts/sync-guide-shared.mjs --check` to the rules job needs your approval to
      touch `.github/workflows/ci.yml` — want it?
- [x] **(amendment 2)** Closed-vocabulary signals restrict endings to objective outcomes / NPC
      states / dial thresholds only (no free-form flags) — happy that's expressive enough, or do
      you want a fourth ref kind before F08 builds the live scorer? And is "climax authored live
      at commitment" (vs. the guide's illustrative sketch) the right call?

GATE: PASS (2026-07-18 — user confirmed all YOUR TESTS boxes complete; CI mirror check added to
`.github/workflows/ci.yml` rules job per the approved design-review item)
