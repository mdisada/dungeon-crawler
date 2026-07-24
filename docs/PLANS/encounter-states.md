# Encounter States - Story & Loop System Redesign

Status: IMPLEMENTED (all 7 slices, 2026-07-19) and deployed. Verified by the full battery
(rules 299, frontend 64, orchestration-live 128, story-live 124, memory-live 5,
scene-director-live 24/24) plus a 12-segment paid sim driven to a committed ending - see
docs/CHECKPOINTS/ENCOUNTER-STATES-SIM.md for the playtest findings and the follow-ups
(guide regeneration; Stage 4/5 danger/encounter-table authoring still pending).
Decisions were locked 2026-07-19 (revised same day to the TOTALIZING state machine).

## 1. Why

Live full-AI play today progresses through per-message LLM judgment (adjudication + a
milestone recognizer watching the transcript). Playtests (see
`tests/integration/story-sim-transcript.txt` runs, 2026-07-19) showed three failures:
aimless narration/conversation loops, slow progress toward objectives, and fragile
judgment points (fuzzy milestone claims, roleplay scenes that never end).

The redesign: **all narrative play happens inside a two-phase state machine.** The game is
always in exactly one of:

- **CUTSCENE**: the Narrator (or an NPC) delivers longer-form exposition, ending with an
  explicit in-fiction hook. The only thing player input can do here is enter the next
  encounter (see entry mapping, 4.1) - there is no free-form adjudication phase.
- **ENCOUNTER**: a typed, resolvable state (skill challenge, puzzle, social, combat, or a
  random-spawned interruption) with an authored spec, visible progress, deterministic
  resolution, and an explicit outcome-to-milestone map.

Off-script player ideas do not fall out of the machine - they become encounters too (an
ad-hoc micro-encounter) or fold into the next cutscene (trivial auto-success actions).
Mechanistic structure is the point: every input has a defined phase, a defined handler, and
a defined effect on progression.

## 2. Decisions locked (do not relitigate)

1. **Totalizing state machine** (REVISED 2026-07-19, supersedes the earlier "hybrid spine"
   choice - the user picked structure over sandbox): narrative play is always in exactly one
   phase, CUTSCENE or ENCOUNTER. There is no free-form adjudication phase. Off-script player
   intents become ad-hoc micro-encounters or fold into the next cutscene (see 4.1); they
   never bypass the machine.
2. **Explicit outcome maps**: every encounter spec carries `on_success` / `on_partial` /
   `on_failure` milestone lists validated against the authored milestone vocabulary.
   Resolution applies them deterministically. The transcript recognizer
   (`recognizeAndApplyMilestones`) is REMOVED from the runtime loop in Slice 3 - outcome
   maps and in-encounter adjudicator claims are the only progression writers.
3. **Beat Planner authors encounters at runtime** (like its `ingredient_requests` today),
   reusing pool ingredients first; a new Encounter Designer agent fills type-specific detail.
4. **Visible frame**: players see encounter type + progress in the UI (banner/panel), like
   the check prompt today.
5. **Skill challenges**: X-successes-before-Y-failures, tiered outcomes (full / partial /
   fail-forward). Full tier requires every active PC to contribute >= 1 success-attempt;
   repeating the same skill escalates its DC.
6. **Puzzles**: authored spec = secret solution description + 2-4 progress steps (each with
   an unlockable hint) + an authored failure consequence that ESCALATES (spawns an encounter,
   costs a resource, or advances the antagonist - never "nothing happens").
7. **Random encounters**: per-location authored danger score (0-5) + dynamic modifiers
   (antagonist step, time of day, recent noise events). Rolled server-side with seeded RNG,
   only at transition points: travel, advance_day, rest, puzzle/challenge failure, loud
   actions. Weighted tables authored per region at guide time; generated fallback.
8. **Social encounters**: spec = goal (from the beat) + 2-4 authored exit outcomes (e.g.
   convinced / refused / enraged) mapped to milestones + stakes. The existing NPC pipeline
   runs unchanged inside; disposition thresholds may force exits.
9. **Teamwork**: no strict turn order outside combat; per-PC contribution tracking in every
   encounter (feeds the full-success tier, puzzle hint pacing, and the variety manager).
10. **Narration between encounters**: 4-8 sentences allowed, must end with an explicit
    in-fiction ask telegraphing 1-3 concrete directions. Free-text player reply; the
    Adjudicator maps it to an encounter entry. No choice buttons (user decision on record:
    no Continue/Next-style controls).
11. **Memory**: minimal retrieval slice only - embed encounter resolutions + scene summaries
    (pgvector is already enabled), retrieve top-K at prompt assembly for Narrator / NPC /
    Beat Planner. Full F13 stays out of scope.
12. **Combat**: remains the placeholder auto-victory until Phase 7; encounters of kind
    `combat` route through the existing placeholder block.

## 3. Repo primer for a fresh session

- **Read `CLAUDE.md` first.** Key rules: canonical rules live in `packages/rules/src/` and
  are MIRRORED into `supabase/functions/_shared/` by `node scripts/sync-guide-shared.mjs`
  (never edit `_shared` copies); no Docker locally - migrations via
  `npx supabase db push --db-url "$POSTGRES_URL_NON_POOLING"` (URL in `backend/.env`);
  deploy with `npx supabase functions deploy session --project-ref nlbkcktjzjludhyhajig`
  (SUPABASE_ACCESS_TOKEN in `frontend/.env.local`).
- **The session edge function** (`supabase/functions/session/`) is the sole writer.
  Key modules: `intent.ts` (player_intent routing + Adjudicator), `agents.ts` (all agent
  prompts + scene_effects extraction), `scene-director.ts` (validated world-movement:
  travel/staging/milestones/encounter placeholder; milestone vocabulary + recognizer),
  `beats.ts` (Beat Planner, loops, idle-nudge ladder), `npc-dialogue.ts` (social pipeline),
  `narration.ts` (narrator styles 'beat' | 'outcome'), `progress.ts` (deterministic
  story-progress pass), `debug.ts` (email-gated debug feed).
- **State**: `GameState` in `packages/rules/src/state/types.ts`, merge-patch diffs via the
  single writer (`util.ts` `commitDiffs`). `scene.mode` is
  `narration|roleplay|battle|puzzle|downtime`.
- **Milestone vocabulary**: `listMilestoneAtoms` (`packages/rules/src/story/evaluate.ts`)
  extracts flags / events / boolean facts from the active objective + open beat predicates;
  `applyMilestones` (scene-director.ts) validates and applies; `evaluateStoryProgress`
  (progress.ts) completes objectives / exits beats.
- **Verification battery** (run after every slice):
  `cd packages/rules && npm test` (all pass, currently 257);
  `cd frontend && npx tsc -b && npx eslint . && npm test` (60);
  `node tests/integration/orchestration-live.mjs` (~123 checks, $0);
  `node tests/integration/story-live.mjs` (92 checks, $0);
  paid: `node tests/integration/scene-director-live.mjs` (~$0.05) and the full-game sim
  `node tests/integration/story-sim-live.mjs <adventureId> 30 <out> --keep` /
  `--resume --keep` / `--restore` (~$0.01 per segment; ALWAYS `--restore` afterwards).
- **Assist mode rule**: any new auto-action must be gated - auto in `full_ai`, a proposal
  (`recordProposal`, mode 'human') in `assist`. Follow the existing review-gate pattern.

## 4. Target architecture

```text
CUTSCENE (exposition, 4-8 sentences, ends with hook telegraphing the encounter)
   | player free-text reply (the ONLY exit from this phase)
   v
4.1 ENTRY MAPPING (Adjudicator, structured output)
   a) reply engages the offered encounter        -> enter it
   b) reply is an off-script but real endeavor   -> Encounter Designer spins an
      ad-hoc micro-encounter (small spec, empty or partial outcome map)
   c) reply is trivial / pure flavor             -> auto-success, folded into the
      next cutscene block (no state change)
   v
ENCOUNTER  (GameState.encounter: {kind, spec, progress, contributions})
   kind: skill_challenge | puzzle | social | combat | random-spawned variant
   - visible frame in UI (type, progress, stakes)
   - inside: existing pipelines (checks, NPC dialogue) constrained by the spec
   - resolution: tier (full/partial/fail) -> outcome map -> applyMilestones
   v
evaluateStoryProgress -> beat exit / objective completion -> next beat
   -> Beat Planner authors the NEXT encounter spec; resolution cutscene delivers
      consequences + the next hook
```

### 4.1 Entry mapping (the cutscene phase's single handler)

During CUTSCENE, all `say`/`do` intents route to entry mapping - never to free
adjudication. The Adjudicator returns `{entry: 'offered' | 'adhoc' | 'fold_in', ...}`:
`offered` instantiates the beat's authored spec; `adhoc` requests a micro-encounter from
the Encounter Designer (players going off-script get structure, not silence, and ad-hoc
outcome maps may be empty - agency without spine-skipping); `fold_in` narrates the trivial
action inside the next cutscene block. The idle-nudge ladder re-delivers the hook during
CUTSCENE and applies in-encounter pressure during ENCOUNTER.

### 4.2 Storage and interruption

Encounter specs are stored on the beat row (`beats.encounter_spec` jsonb) and instantiated
into `GameState.encounter` when entered. Random encounters interrupt at transition points
and stack one level deep: the interrupted encounter's state is preserved in
`encounter.interrupted` and restored after resolution. Battle mode (Phase 7) and the demo
script are outside this machine.

## 5. Slices (implement in order)

### Slice 1 - Encounter state domain + visible frame

Goal: the state plumbing and UI, no behavior change.

- `packages/rules/src/state/types.ts`: add `EncounterState`
  `{ id, kind: 'skill_challenge'|'puzzle'|'social'|'combat', label, stakes: string,
     progress: Json, contributions: Record<characterId, number>, startedAt }` and
  `GameState.encounter: EncounterState | null` (optional field; sync mirrors, run rules tests).
- Server: `encounterDiffs(open/close)` helpers in a new `session/encounters.ts`;
  `resync` passes it through automatically (state is whole-row).
- Frontend: `EncounterBanner` component rendered by the play page in non-battle modes
  (like OfferBanner): kind icon, label, progress line, stakes. Debug tab Story panel adds
  the encounter block.
- Accept: rules + frontend suites green; banner renders from a hand-seeded state in a
  component test.

### Slice 2 - Skill-challenge engine + routing

Goal: the first real encounter type, end to end.

- `packages/rules/src/play/skill-challenge.ts` (pure, unit-tested):
  `{ neededSuccesses, maxFailures, suggestedSkills: string[], perSkillUses: Record<skill, count> }`;
  functions: `recordAttempt(state, characterId, skill, success)` returning updated state +
  `status: 'ongoing'|'full'|'partial'|'failed'` (full requires all active PCs contributed;
  partial = reached successes without full participation OR exactly at failure edge - encode
  precisely in tests), `escalatedDc(baseDc, usesOfSkill)` (+2 per repeat).
- Server: while `encounter.kind === 'skill_challenge'`, `do`/bare-`roll` intents route into
  the challenge: Adjudicator specs skill+DC as usual but resolution feeds `recordAttempt`;
  each attempt narrated with the 'outcome' style + progress note. On terminal status: apply
  the spec's outcome map (`on_success`/`on_partial`/`on_failure` -> `applyMilestones`),
  close the encounter, run `evaluateStoryProgress`, narrate resolution ('beat' style hook).
- Accept: engine unit tests (participation tier, DC escalation, edge cases); a live probe in
  `scene-director-live.mjs` opening a hand-seeded challenge and driving it to each tier.

### Slice 3 - The machine switch: authoring, entry mapping, phase enforcement

Goal: the totalizing loop goes live. This is the largest slice.

- `beats` table migration: add `encounter_spec jsonb` (nullable).
- Beat Planner prompt (`session/story-agents.ts`) emits
  `encounter: { kind, label, stakes, rationale, params, on_success, on_partial, on_failure }`
  alongside goals; parser (`packages/rules/src/story/beats.ts` parseBeatPlan) validates the
  kind and the outcome maps against the milestone vocabulary passed in context (entries MUST
  be copied exactly - reject otherwise, planner retry, template fallback with spec null; a
  null spec degrades that beat to hook -> ad-hoc entries only).
- New Encounter Designer agent (`agent_role: 'encounter_designer'`, already in model
  routing): expands params per kind (challenge skills/counts, puzzle solution+steps, social
  exits) for authored specs AND generates ad-hoc micro-encounter specs for off-script
  entries (4.1b).
- Narration: 'exposition' style (4-8 sentences, ends with an explicit ask telegraphing the
  encounter) added to `NARRATOR_SYSTEMS`; beat openings and resolution cutscenes use it.
- **Phase enforcement (full_ai narrative modes)**: while `GameState.encounter` is null the
  game is in CUTSCENE - `intent.ts` routes all say/do to entry mapping (4.1); the free
  adjudication path is removed for these modes. While an encounter is open, say/do route to
  that encounter's handler. `roll` fast-path, dm_command, battle mode, and the demo driver
  are untouched.
- **Recognizer removal**: delete the `recognizeAndApplyMilestones` call from `intent.ts`
  (keep the function only if the sim harness still references it; otherwise delete fully).
- Test updates are IN SCOPE for this slice: `orchestration-live.mjs` / `story-live.mjs`
  assertions that exercised free-form say/do adjudication in narrative modes must be
  rewritten against the machine (entry mapping resolutions, canned encounter specs in demo
  mode). Do not weaken RLS/gating assertions.
- Accept: demo canned beat plans extended with a canned encounter spec so both $0 suites
  assert the full lifecycle; paid sim shows cutscene -> entry -> encounter -> resolution
  cutscene -> next beat, and an off-script reply spawning an ad-hoc micro-encounter.

### Slice 4 - Social encounter spec

Goal: conversations get goals and ends.

- Spec params: `{ goal, exits: [{ outcome, description, milestones: [...] }], stakes,
  npcIds }`. Entering stages the NPCs (existing `startSocial`); `GameState.encounter`
  carries progress (exchanges count, disposition trajectory).
- Exit detection: after each NPC reply, a cheap structured call (reuse 'summarizer' role)
  judges "has an authored exit outcome CLEARLY occurred?" against the 2-4 exits only -
  narrow, not the open recognizer. Disposition thresholds force exits (<= -8 hostile exit).
  Player departure / NPC leave resolves as the nearest exit or 'left_unresolved'.
- On exit: outcome map -> milestones -> close encounter -> progress pass -> narration hook.
- Accept: story-live demo path with canned exits; live probe: a social encounter reaching an
  authored exit updates the debug Story panel and exits the beat.

### Slice 5 - Puzzles

Goal: the puzzle scene mode earns its name.

- Spec params: `{ solution: string (secret), steps: [{ description, hint }], maxAttempts,
  failConsequence: { kind: 'spawn_encounter'|'cost'|'antagonist_step', params } }`.
- Attempts route through the Adjudicator with the secret solution in context: it scores
  `attempt_result: 'solves'|'advances_step_N'|'mistaken'` (structured output, validated).
  Progress + per-PC contributions tracked; hints unlock on step completion or when a
  DIFFERENT PC attempts. `maxAttempts` exhausted -> failConsequence executes (spawn uses the
  random-encounter machinery from slice 6 or the combat placeholder) - never nothing.
- `scene.mode = 'puzzle'` while active (the battle-map renderer ignores it without combat
  state; verify the play-page renderer path).
- Accept: unit tests for progress/hints/attempt exhaustion; live probe with a seeded puzzle.

### Slice 6 - Random encounters + danger

Goal: the world pushes back, legibly.

- `locations` migration: `danger integer default 0`, `encounter_table jsonb` (weighted
  entries: `{ weight, kind, label, params }`). Guide Stage 4/5 prompt additions author both;
  generated fallback table when missing.
- `session/danger.ts`: `dangerScore(location, timeOfDay, antagonistStep, noiseEvents)` and
  `maybeSpawnEncounter(trigger)` - seeded RNG, logged (`random_encounter_roll` event with
  the roll, threshold, and table pick) so the debug tab shows why. Triggers wired at:
  `scene_travel`, `advance_day`, rest, challenge/puzzle failure, `loud` actions (Adjudicator
  flags `scene_effects.loud: true`).
- Spawned encounters interrupt: push current `GameState.encounter` onto
  `encounter.interrupted` (single-depth stack), restore on resolution.
- Accept: unit tests for weighting/modifiers; sim segment demonstrating a travel-triggered
  spawn and restoration of the interrupted encounter.

### Slice 7 - Minimal retrieval (memory)

Goal: long-form narration stays consistent across sessions.

- Migration: `memory_fragments (id, adventure_id, kind: 'encounter'|'scene_summary',
  content text, embedding vector(1024), created_at)` + ivfflat index. Embedding via
  OpenRouter embeddings endpoint (single helper in `_shared/llm.ts`; pick the cheapest
  embedding model available on the account and record the choice in docs/DECISIONS.md).
- Write path: on encounter resolution and on `endEncounter` scene summaries.
- Read path: `retrieveMemories(adventureId, queryText, k=4)` called in prompt assembly for
  Narrator (exposition style), NPC bundle, and Beat Planner - injected as
  "Established earlier: ..." lines.
- Accept: unit test with pgvector against the live DB (insert + retrieve); sim across two
  `--resume` segments referencing a slice-1-segment fact in later narration.

## 6. Cross-cutting rules

- Every new auto-action follows the assist gate (auto full_ai / proposal in assist).
- Every encounter event goes to `event_log` (`encounter_opened`, `encounter_attempt`,
  `encounter_resolved` with tier + milestones applied) - the debug tab and sim harness
  read these; extend both watchers' type lists.
- The recognizer is gone after Slice 3: if a milestone can only be reached through
  free-form fiction, that is an authoring bug - route it through an encounter outcome map.
- Cutscene inputs NEVER silently vanish: every reply gets entry, ad-hoc structure, or a
  fold-in acknowledgment in the next cutscene block.
- Existing guides lack danger/encounter tables: all slices must degrade to generated
  fallbacks; recommend guide regeneration in the release note.
- 546 WORKER_RESOURCE_LIMIT exists: keep per-request agent chains <= ~4 LLM calls; the
  pending/typing self-heal (2-min event silence) is the backstop. Job Queue remains a
  separate future phase.

## 7. Out of scope

Phase 7 combat engine internals; full F13 (lore-wide RAG, query_lore); TTS/immersion
pipeline; the Job Queue migration; any Continue/Next-style UI control (explicitly rejected).
