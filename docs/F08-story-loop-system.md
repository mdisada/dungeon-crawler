# F8 — Story & Loop System

**Depends on:** F4 (content shapes), F7 (proposal pipeline, event log)
**Depended on by:** F14 (relies on these guardrails), Narrator/NPC context quality

## 1. Purpose

The story brain: track nested loops, classify what players are actually doing, plan one beat ahead, manage the ingredient toy box, weave hooks toward objectives, keep variety, and run the antagonist's off-screen agenda.

## 2. Loop Stack Manager (deterministic)

```
meta_loop:   adventure_id pk, arc_summary, entry_point, exit_conditions jsonb,
             antagonist_plan jsonb {steps[], current_step},
             committed_bbeg_npc_id?, suspicion_tally jsonb {npc_id: score}
core_loops:  id, adventure_id, type ('mystery'|'monster_hunt'|'dungeon_crawl'|
             'siege_defense'|'infiltration'|'intrigue'|'rebellion'|'survival'|
             'escort'|'heist'|'custom'), status ('active'|'suspended'|'completed'),
             stack_position int, current_beat_id?, opened_at, custom_label?
beats:       id, core_loop_id, index, name, goals jsonb, exit_conditions jsonb,
             ingredient_requests jsonb[], status
progression_loops: id, adventure_id, kind ('xp'|'renown'|'piety'|'personal'),
             config jsonb, state jsonb    -- detailed in F11
```

Operations: `push(loop)`, `suspend(loop)`, `resume(loop)`, `complete(loop)`, `advance_beat(loop, beat)`. Exactly one core loop `active`; suspensions preserve beat position (mystery pauses while the dungeon crawl runs, resumes at the same beat).

**Loop type library:** each type ships a template — canonical beat sequence + expected intent profile + entry/exit heuristics (e.g. `monster_hunt: rumor → preparation → the_hunt → confrontation → aftermath`). Templates are defaults; Beat Planner may deviate.

## 3. Loop Classifier Agent

Trigger: scene transitions; Action Router mismatch flag (3+ off-loop intents); DM manual "reclassify".

```
Input:  { last_n_events (condensed, n≈15), active_loop {type, beat},
          available_loop_types + expected intent profiles,
          current_objective, scene_state }
Output: { assessment: "on_loop" | "pivot",
          pivot?: { new_type, why (evidence refs), suggested_first_beat,
                    action_on_current: "suspend" | "complete" },
          confidence: 0–1 }
```

- `pivot` with confidence ≥ 0.65 → proposal (`type: loop_pivot`). Assist: DM accepts/edits/rejects. Full-AI: auto-accept at ≥ 0.8; between 0.65–0.8, continue current loop and re-evaluate after 5 more events (conservative bias).
- **Never executes** — always proposes.

## 4. Beat Planner Agent

Trigger: pivot accepted; beat exit conditions met; DM "plan next beat".

```
Input:  { loop {type, template, completed_beats}, current_objective + hidden_desc,
          scene_state, party_summary, undiscovered ingredients near scene,
          variety_flags (from Variety Manager) }
Output: { beat: { name, goals: [player-facing situations to establish],
                  exit_conditions (structured, same atoms as F4 predicates),
                  ingredient_requests: [{type, purpose, pillar_tags}],
                  braided?: [{goal_pair: [i, j], link: {kind: 'dc_mod'}}],
                  narration_seed: string } }
```

- Plans **one beat only**. Ingredient requests first try the Ingredient Pool (reuse undiscovered toys); unmet requests go to the Ingredient Generator; new ingredients enter as proposals in assist mode (batch-approve UI: checkbox list).
- `narration_seed` feeds the Narrator when the beat opens.
- **Braided goals** (min_players > 1): the Planner may mark simultaneous goal pairs meant for different PCs (distract the captain + search the office), resolved via F7 §3.4. The Variety Manager's cooperation counters (§7) govern when braided beats are appropriate; the Planner receives the party composition profile so goals map onto skills the party actually has.

## 5. Ingredient Pool Manager

- CRUD over `ingredients` (F4 schema) during play; `reveal_ingredient` marks discovered + logs the reveal event.
- **Player theory canonization:** DM selects any player utterance in the session log → "Make it true" → creates an ingredient with `canon_source: 'player_theory'` + retro-consistency check (Consistency Manager verifies it contradicts nothing; if it does, shows the conflict before confirming). Full-AI: the NPC/Narrator agents may *propose* canonization (auto-approved only at Consistency-pass clean + no objective contradiction).
- Pool health metric: undiscovered ingredients serving the active objective; < 2 triggers a Beat Planner top-up request.

## 6. Hook Weaver Agent

Trigger: new beat opened; objective revealed; new ingredient placed; session start (backstory pass, F5).

```
Input:  { target (objective|ingredient), party backstories + piety/renown state,
          active loop/beat, npc registry (dispositions), recent player interests
          (from event log tags) }
Output: { hooks: [{ placement: npc_dialogue|scene_detail|rumor|event,
                    text_seed, targets_character_id?, serves_objective_id }] }
```

Hooks are delivered as context to the Narrator/NPC agents ("work this in naturally"), not broadcast directly. This is the mechanism behind "the app directs players toward unlocking the next objective" — always pull (hooks inside the current loop), never push (forced scenes).

**Backstory interlocks (min_players > 1):** at the first-session pass (F5) and on personal-loop milestones, the Weaver deliberately links personal loops *across* characters where the material allows — A's vendetta beast is guarded by the cult from B's past — so personal progression invites each other's help. Interlocks are recorded as hooks with `kind: 'interlock'` and referenced by both personal loops. Guardrail: interlocks connect, never gate — a personal loop must remain completable without the other PC's loop (assist, not padlock).

## 7. Variety Manager (pure counting)

- Tracks: core-loop type counts over a sliding window (last 5 completed loops), per-player pillar engagement (intents tagged combat/social/exploration by the Router), and **cooperation events** (combos, assists claimed, group checks, braided beats resolved, coop sets completed — all from the event log) plus **spotlight distribution** (share of resolved intents per player).
- Rules (configurable): same loop type 3× consecutively → flag `variety: suggest_alternate_type`; any player's dominant pillar unused for 2 sessions → flag `pillar_starved: {player, pillar}`. Cooperation rules: zero coop events in a session → flag `coop_low` (Beat Planner weights toward a braided beat / coop set); 3 consecutive coop-*demanding* obstacles → flag `coop_fatigue` (suppress demands, keep rewards — the anti-padlock guard); one player > 60% of resolved intents over a session → flag `spotlight: {player}` (feeds NPC differential engagement, F10 §3.7). Flags are inputs to the Beat Planner and Encounter Designer, never hard constraints.

## 8. Meta Loop Steward Agent

- **Antagonist turns:** World Clock triggers every N in-game days (default 3) and at session end. Input: antagonist plan + current step + party's visible impact on it. Output: `{ step_progress: advance|stall|setback, off_screen_event, surfacing_suggestions: [rumor|scene_detail|npc_reaction] }` → non-blocking proposal ("Off-screen: the cult acquired the second relic. Surface via refugee rumors?"). Accepted surfacings become ingredients.
- **Suspicion tally:** Summarizer tags player expressions of suspicion/hostility toward NPCs; Steward maintains `suspicion_tally`. At threshold (default: score ≥ 5 with ≥ 2 sessions of signals) → **BBEG commitment proposal**: "Players strongly suspect/hate Lady Aster. Commit her as the antagonist's agent? Locks retroactive continuity." Assist: human decides. **Full-AI: commits at threshold automatically but only if the Consistency Manager confirms no contradicting established facts.** Commitment writes `committed_bbeg_npc_id` and triggers a Hook Weaver retro-pass.

## 9. Objective flow (ties F4 → live play)

- One objective `active` (player-visible) at a time per the reveal order; predicates auto-evaluated on every state diff; Adjudicator handles ambiguous atoms via `propose_objective_completion`.
- Completion → proposal (assist) / conservative auto (full-AI, F14) → next objective `active` → Hook Weaver plants its hooks into the current loop → Narrator gets a reveal seed.
- DM manual checkbox = override event (F7 §5.2).

## 10. Acceptance criteria

- [ ] Simulated transcript fixtures: mystery→siege pivot detected within 5 events at ≥ 0.65 confidence; on-loop play produces no false pivots across a 50-event fixture.
- [ ] Suspend/resume preserves beat position across an interleaved loop sequence.
- [ ] Beat Planner reuses pool ingredients before requesting new ones (assert generator not called when pool suffices).
- [ ] Player-theory canonization creates a consistent ingredient and blocks contradicting ones with a shown conflict.
- [ ] Steward advances the antagonist plan on clock ticks with no player action; surfacing proposals appear non-blocking.
- [ ] Variety flags fire per rules and alter Beat Planner output (fixture comparison).
- [ ] Cooperation counters: `coop_low`, `coop_fatigue`, and `spotlight` fire against seeded event-log fixtures; braided beats emitted only when the composition profile supports the goal pair.
- [ ] Interlock guardrail: a personal loop with an interlock remains completable when the linked PC's loop is untouched (predicate fixture).

## 11. Open questions

- Loop template library size at launch (proposal: the 10 types in §2, each with a 3–5 beat template).
- Suspicion signal extraction quality — start with Summarizer tagging + simple keyword heuristics; refine with proposal-log feedback.
