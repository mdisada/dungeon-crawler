# F8 — Story & Loop System

**Depends on:** F4 (content shapes), F7 (proposal pipeline, event log)
**Depended on by:** F14 (relies on these guardrails), Narrator/NPC context quality

## 1. Purpose

The story brain: track nested loops, classify what players are actually doing, plan one beat ahead, manage the ingredient toy box, weave hooks toward objectives, keep variety, and run the antagonist's off-screen agenda.

## 2. Loop Stack Manager (deterministic)

```text
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

## 2.1 Quest contracts & the offer lifecycle (added 2026-07-18)

Design principle: **the story is offered, not imposed.** Players are never told what motivates
them — quest-shaped goals arrive as in-fiction offers with a giver, stated reward, and stakes,
and nothing quest-shaped becomes active until the party says yes. Acceptance is what creates
motivation; narration that presumes it ("you've come here to uncover the truth") is a defect.

```text
quest_offers: id, adventure_id, contract_id?,   -- authored contract (F4 §4.3) or live-woven
              quest_label, giver_npc_id,
              terms jsonb {reward: {gold, extras[]}, stakes, deadline?},
              status ('offered'|'accepted'|'declined'|'expired'),
              core_loop_id?,                    -- set on accept
              reweave_count int default 0, offered_at, resolved_at?
party ledger: gold int on GameState (players domain) + event-log entries per payout
```

- **Scope:** the adventure's entry hook AND every quest-shaped core loop entering play (side
  quests, pivots into a new quest line) begin as an offer. Objectives inside an accepted quest
  flow per §9 without re-asking. Non-quest loops (a dungeon the party walks into) need no offer.
- **Presentation:** in-fiction — giver NPC dialogue or narration stages the ask. Tracked state
  renders a persistent player-visible banner ("Offer: escort Maren to the coast — 50 gp") so
  what the game is waiting on is never ambiguous. At most **2 unresolved offers** outstanding.
- **Resolution is free-text:** the intent Router / social classifier detect accept / decline /
  negotiate from what players actually say — no Accept/Decline buttons. **Any PC's clear
  acceptance binds the party** (table realism, no voting UI); a prior objection is just
  conversation the giver responds to.
- **Negotiation:** an influence attempt against the giver through the normal F10 pipeline;
  success improves terms within the contract's authored floor/ceiling (F4 §4.3), gated by
  disposition and magnitude rules unchanged. Terms-as-accepted are recorded on the offer.
- **Accept:** system line in the story feed ("Contract accepted: 50 gp on delivery"), core loop
  pushed/activated with the contract attached, giver disposition +1, journal updated (§2.2).
- **Decline:** honored — never argued in the moment. Giver disposition shifts per personality;
  the Meta Loop Steward receives a decline event (the antagonist plan advances on its own
  schedule, §8); the Hook Weaver may **re-weave** the offer later from a genuinely different
  angle (higher pay, personal stakes, visible consequences) — at most **2 re-weaves**. After
  the re-weave budget, escalation stops being an offer: §8 surfacing brings the consequences
  physically to the party (the threat comes to them; survival needs no contract). If the party
  still disengages, the Ending Steward may author an emergent "walked away" ending (§8.1
  emergent rules) so the adventure concludes honestly instead of nagging forever.
- **Payout:** quest exit conditions met → `terms.reward.gold` credited to the party ledger
  (event-logged, narrated by the giver when alive/present). Item/XP extras stay narrative
  until F11 wires real progression — no fake inventory.

## 2.2 Quest journal (minimal, player-visible)

Extends the existing objective display, not a new page: active quest (label, giver, accepted
terms, stakes), suspended accepted quests, current objective, plus the outstanding-offer
banner. Accept/decline/payout moments also drop system lines into the story feed so decisions
stay legible in the transcript. Archive view (declined/completed history) is v1.1.

## 3. Loop Classifier Agent

Trigger: scene transitions; Action Router mismatch flag (3+ off-loop intents); DM manual "reclassify".

```text
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

```text
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
- **Every beat now carries a typed encounter spec (2026-07-19, §9.2):** the Planner also emits
  `encounter: {kind, label, stakes, rationale, on_success/on_partial/on_failure}` — the beat's one
  resolvable encounter, whose outcome maps are the sole progression writers. Outcome-map atoms are
  validated against the objective's milestone vocabulary + the beat's own exit-condition atoms
  (exact copies; drift is rejected → planner retry → template fallback with a null spec that
  degrades the beat to ad-hoc entries only). The new **Encounter Designer** agent fills the
  kind-specific mechanics (§9.2.1). The Planner and Designer both receive the party's character
  profiles (species traits / background / quirks) so encounters are designed around who the party
  actually is.

## 5. Ingredient Pool Manager

- CRUD over `ingredients` (F4 schema) during play; `reveal_ingredient` marks discovered + logs the reveal event.
- **Player theory canonization:** DM selects any player utterance in the session log → "Make it true" → creates an ingredient with `canon_source: 'player_theory'` + retro-consistency check (Consistency Manager verifies it contradicts nothing; if it does, shows the conflict before confirming). Full-AI: the NPC/Narrator agents may *propose* canonization (auto-approved only at Consistency-pass clean + no objective contradiction).
- Pool health metric: undiscovered ingredients serving the active objective; < 2 triggers a Beat Planner top-up request.

## 6. Hook Weaver Agent

Trigger: new beat opened; objective revealed; new ingredient placed; session start (backstory pass, F5).

```text
Input:  { target (objective|ingredient), party backstories + piety/renown state,
          active loop/beat, npc registry (dispositions), recent player interests
          (from event log tags) }
Output: { hooks: [{ placement: npc_dialogue|scene_detail|rumor|event,
                    text_seed, targets_character_id?, serves_objective_id }] }
```

Hooks are delivered as context to the Narrator/NPC agents ("work this in naturally"), not broadcast directly. This is the mechanism behind "the app directs players toward unlocking the next objective" — always pull (hooks inside the current loop), never push (forced scenes).

**Offer delivery (2026-07-18):** when a hook's target is a quest contract (§2.1), the Weaver's
job is to stage the giver scene — get the giver and the party into the same fiction so the ask
lands in dialogue. Re-weaves after a decline must come from a *different* angle (new placement,
escalated terms, or newly visible stakes), never a verbatim re-pitch; the Weaver receives
`reweave_count` and prior declined terms as input.

**Backstory interlocks (min_players > 1):** at the first-session pass (F5) and on personal-loop milestones, the Weaver deliberately links personal loops *across* characters where the material allows — A's vendetta beast is guarded by the cult from B's past — so personal progression invites each other's help. Interlocks are recorded as hooks with `kind: 'interlock'` and referenced by both personal loops. Guardrail: interlocks connect, never gate — a personal loop must remain completable without the other PC's loop (assist, not padlock).

## 7. Variety Manager (pure counting)

- Tracks: core-loop type counts over a sliding window (last 5 completed loops), per-player pillar engagement (intents tagged combat/social/exploration by the Router), and **cooperation events** (combos, assists claimed, group checks, braided beats resolved, coop sets completed — all from the event log) plus **spotlight distribution** (share of resolved intents per player).
- Rules (configurable): same loop type 3× consecutively → flag `variety: suggest_alternate_type`; any player's dominant pillar unused for 2 sessions → flag `pillar_starved: {player, pillar}`. Cooperation rules: zero coop events in a session → flag `coop_low` (Beat Planner weights toward a braided beat / coop set); 3 consecutive coop-*demanding* obstacles → flag `coop_fatigue` (suppress demands, keep rewards — the anti-padlock guard); one player > 60% of resolved intents over a session → flag `spotlight: {player}` (feeds NPC differential engagement, F10 §3.7). Flags are inputs to the Beat Planner and Encounter Designer, never hard constraints.

## 8. Meta Loop Steward Agent

- **Antagonist turns:** World Clock triggers every N in-game days (default 3) and at session end. Input: antagonist plan + current step + party's visible impact on it. Output: `{ step_progress: advance|stall|setback, off_screen_event, surfacing_suggestions: [rumor|scene_detail|npc_reaction] }` → non-blocking proposal ("Off-screen: the cult acquired the second relic. Surface via refugee rumors?"). Accepted surfacings become ingredients.
- **Suspicion tally:** Summarizer tags player expressions of suspicion/hostility toward NPCs; Steward maintains `suspicion_tally`. At threshold (default: score ≥ 5 with ≥ 2 sessions of signals) → **BBEG commitment proposal**: "Players strongly suspect/hate Lady Aster. Commit her as the antagonist's agent? Locks retroactive continuity." Assist: human decides. **Full-AI: commits at threshold automatically but only if the Consistency Manager confirms no contradicting established facts.** Commitment writes `committed_bbeg_npc_id` and triggers a Hook Weaver retro-pass.

## 8.1 Ending Steward (multiple fluid endings)

Extends the Meta Loop Steward. F4 authors 3-5 hidden **candidate endings**, each with weighted
`trigger_conditions` (F4 §4.2). The Steward makes the conclusion *fluid* — the players' emerging
trajectory picks which ending the story lands, and the system gently reinforces it without ever
forcing it.

**Live state** (not in F4's authored shape): `endings.status` transitions
`candidate → leading → committed` (or `discarded`); the adventure tracks
`ending_scores jsonb {ending_id: score}`, `dial_values jsonb {key: -5..5}` (all start 0), and
`committed_ending_id?`.

- **Signal vocabulary (closed, F4 §4.2):** signals reference only state this system is guaranteed
  to maintain — objective outcomes (completed/failed, already auto-evaluated on every diff, §9),
  registry NPC states (dead/alive/allied/hostile, from F10 disposition + world state), and story
  dial thresholds. No free-form flags: a signal that can never fire is worse than no signal.
- **Dial upkeep (Summarizer):** after each scene/beat close, the Summarizer nudges any moved dial
  by ±1 (±2 for a defining moment) with a one-line logged justification appended to the event log
  (auditable; DM can correct the value in assist mode). Dials are trajectory memory, not judgment.
- **Scoring (deterministic, every state diff / objective completion / dial change / clock tick):**
  for each candidate ending, sum the `weight` of every signal whose `when` currently holds — pure
  lookups against objective states, NPC states, and dial values (an Engine, not an LLM). The
  argmax is the **leading** ending; ties break by lowest `index` (so one always leads → no
  dead-end). Cheap, testable, runs on every diff.
- **Holistic pass (LLM, on chapter boundaries / clock ticks):** the Steward gets the condensed
  event log + the (close-scoring) candidate endings and confirms/adjusts the leading pick for
  tone and relationship nuance the flags don't capture — mirrors the deterministic-atoms +
  Adjudicator split used elsewhere. Low frequency, high-stakes-planning model.
- **Gentle pull, never push:** the leading ending is passed as context to the Beat Planner
  (`narration_seed` / beat framing bends toward its trajectory) and Hook Weaver (hooks lean toward
  its climax), but **all endings stay reachable until commitment** — this is the §6 pull-not-push
  principle applied to the resolution. Early game the pull is light; it strengthens as one ending
  pulls clear.
- **Commitment:** near the climax (final chapter's last objective active, or a score margin +
  min-events threshold), the Steward drafts a **commitment proposal** exactly like the BBEG one
  (§8): assist → DM decides; Full-AI → auto-commit only when the margin is decisive **and** the
  Consistency Manager confirms no contradiction. Commitment **re-authors the climax live**: the
  Steward drafts the concrete finale from the actual event log + committed relationships, seeded
  by the ending's premise — the guide's `climax_summary` was only an illustrative sketch (F4
  §4.2), so the story can't have drifted away from a script that didn't exist. It then writes
  `committed_ending_id`, sets the climax objective's reveal path, and triggers a Hook Weaver
  retro-pass. Other endings → `discarded`.
- **Emergent endings:** if the leading score stays low/ambiguous (players went off-map), the
  Steward may **propose a new ending** authored from the actual trajectory (`is_emergent = true`),
  gated the same way as player-theory canonization (§5): assist → DM approves; Full-AI → only on a
  clean Consistency pass. Keeps agency real without abandoning coherence.

Guardrail: the pull must not collapse into a railroad — commitment happens *late*, and a player
action that flips the leading ending before commitment always re-ranks (the players steer, the
system follows).

## 9. Objective flow (ties F4 → live play)

- One objective `active` (player-visible) at a time per the reveal order; predicates auto-evaluated on every state diff; Adjudicator handles ambiguous atoms via `propose_objective_completion`.
- **Acceptance gates activation (2026-07-18):** a quest's first objective only becomes `active`
  once its offer is `accepted` (§2.1); before that, the loop's entry beat *is* the offer scene.
  Objectives inside an accepted quest then flow per the reveal order without re-asking.
- Completion → proposal (assist) / conservative auto (full-AI, F14) → next objective `active` → Hook Weaver plants its hooks into the current loop → Narrator gets a reveal seed.
- DM manual checkbox = override event (F7 §5.2).

## 9.1 Reactive narration & pacing contract (added 2026-07-18)

- **Every narration beat ends at a concrete decision point** facing the players — an NPC
  awaiting an answer, a fork, a threat, an open offer — and MAY end with a direct question to
  the party or a named PC when natural. Never a formulaic "What do you do?" appended to every
  beat; the situation itself must put the ball visibly in the players' court. Enforced via the
  Narrator system prompt (F7 §5.1 narration contract).
- **Session openings stage the offer, never the motivation:** the opening premise establishes
  scene and atmosphere and leads *into* the entry offer scene. It must not presume party
  motivation ("you've come to these shores to uncover the truth") — motivation is what
  acceptance creates.
- **Beat goals are situations, not events:** the Beat Planner phrases `goals` as situations
  demanding a player decision, not things that happen to the party.
- **Pacing is event-driven in full-AI:** beat exit conditions met → Beat Planner plans the next
  beat → Narrator opens it automatically (no button press). "Narrate next" remains a manual
  override for the creator/DM. **In the encounter-states machine (§9.2) progression is even
  tighter:** a beat resolves only through its encounter's outcome map, objective completion
  force-re-plans the open beat (a stale beat can no longer re-offer a dead encounter), and the
  Narrator's fold-in / hook prompts never re-offer a direction the party already chose or pad a
  single obvious path into a menu (anti-circling, 2026-07-20).
- **Idle nudge:** players idle past a threshold (default 3 min, DM-configurable) → one
  in-fiction nudge (an NPC speaks up, a distant sound, the giver presses for an answer). A
  nudge never advances plot state without player input. Phase-aware: mid-encounter the nudge
  applies pressure inside the encounter; in a cutscene it re-delivers the standing hook.

## 9.2 Encounter-states machine (implemented 2026-07-19/20)

Full plan: `docs/PLANS/encounter-states.md`; playtest report + fixes:
`docs/CHECKPOINTS/ENCOUNTER-STATES-SIM.md`; decisions in `docs/DECISIONS.md` (2026-07-19/20).
This supersedes the earlier "per-message LLM judgment + transcript recognizer" pacing model:
in full-AI narrative modes **the story spine advances only through typed, resolvable encounter
states.**

### 9.2.1 The two phases

Narrative play is always in exactly one phase:

- **CUTSCENE** (`GameState.encounter` is null): the Narrator delivers longer-form exposition
  (`'exposition'` style, 4–8 sentences) ending on an in-fiction hook telegraphing the offered
  encounter. Player replies go to **entry mapping** (§9.2.2) — there is no free-form adjudication
  phase in full-AI.
- **ENCOUNTER** (`GameState.encounter` set): a typed, resolvable state with an authored spec,
  a **visible frame** (kind icon + label + progress + stakes + how-to-engage, pinned for
  everyone — like the check prompt), per-PC contribution tracking, deterministic resolution into
  a tier (full / partial / failed), and an explicit outcome-to-milestone map. The hidden half
  (outcome maps, secrets like a puzzle's solution) lives on the `dm` domain; the visible frame on
  a new `encounter` state domain.

Encounter specs are stored on the beat row (`beats.encounter_spec jsonb`) and instantiated into
`GameState.encounter` on entry. The **Encounter Designer** agent (`agent_role:
'encounter_designer'`) expands the Planner's spec into kind-specific mechanics and also structures
off-script endeavors as ad-hoc micro-encounters; it emits `trait_notes` naming which party traits
bear on the encounter, which the mid-encounter adjudicator reuses so rulings stay consistent with
the design.

### 9.2.2 Entry mapping (the cutscene handler)

During CUTSCENE every full-AI say/do goes to the Adjudicator-driven entry mapper, which returns
`{entry: 'offered' | 'adhoc' | 'fold_in', ...}`:

- **offered** — the reply engages OR **moves toward** the offered encounter (attempting it,
  approaching its site, walking/climbing onward, picking a direction the hook laid out). Committing
  to move IS engagement → the beat's authored spec instantiates.
- **adhoc** — a real endeavor pointed elsewhere → the Encounter Designer spins a micro-encounter
  (small spec, empty/partial outcome map: agency without spine-skipping).
- **fold_in** — talk/color that changes nothing about where the party stands. The mapper sees its
  own recently folded-in replies; a repeat or continuation is treated as commitment (never folds
  twice — the anti-circling fix, 2026-07-20). Fold narration carries the action forward and never
  re-asks an answered question or re-offers a chosen path.

### 9.2.3 Encounter kinds

- **Skill challenge:** X successes before Y failures, tiered (full requires every active PC to
  contribute ≥ 1 success-attempt; partial = successes without full participation OR scraping the
  failure edge). Repeating a skill escalates its DC (+2/repeat, per-skill). Pure engine in
  `packages/rules/src/play/skill-challenge.ts`.
- **Social:** goal + 2–4 authored exits (each mapped to a tier + milestones) + staged NPCs; the
  F10 pipeline runs unchanged inside. Exit detection after each NPC reply is a narrow structured
  judge over the authored exits only; disposition ≤ −8 forces a hostile exit; scene end without an
  exit resolves as `left_unresolved` (see F10 §3.8).
- **Puzzle:** secret solution + 2–4 steps (each an unlockable hint) + a bounded mistake budget +
  an authored fail consequence that ALWAYS escalates (spawn / resource cost / antagonist step —
  never "nothing happens"). Attempts scored by a Puzzle Judge holding the secret;
  `scene.mode = 'puzzle'` while active. Engine in `packages/rules/src/play/puzzle.ts`.
- **Random:** per-location authored `danger` (0–5) + dynamic modifiers (antagonist step, noise
  events), rolled with seeded RNG at transition points only (travel, advance_day, encounter
  failure, loud actions), logged `random_encounter_roll` (roll/threshold/pick) for the debug tab.
  A spawn interrupts the open encounter (single-depth `encounter.interrupted` stack) and restores
  it on resolution. Weighted tables authored per location at guide time; generated fallback when
  absent. Math in `packages/rules/src/play/danger.ts`.
- **Combat:** stays the pre-Phase-7 placeholder (instant party victory), routed through the same
  frame + outcome map.

### 9.2.4 Resolution & progression

On a terminal status the tier selects the outcome map (`on_success`/`on_partial`/`on_failure`),
`applyMilestones` validates and applies it against the authored vocabulary, the frame closes (or
restores an interrupted encounter), a resolution cutscene narrates consequences forward + the next
hook, and `evaluateStoryProgress` runs (which may exit the beat and open the next). **Outcome maps
and in-encounter adjudicator claims are the only progression writers — the transcript recognizer
is removed** (a milestone reachable only through free-form fiction is an authoring bug: route it
through an outcome map). Every encounter event goes to `event_log` (`encounter_opened`,
`entry_mapped`, `encounter_attempt`, `encounter_resolved` with tier + milestones, `encounter_exit`,
`encounter_restored`, `random_encounter_roll`).

### 9.2.5 Memory (minimal retrieval slice, F13 preview)

`memory_fragments (adventure_id, kind, content, embedding vector(1024))` + the
`match_memory_fragments` RPC (pgvector). Encounter resolutions and scene summaries are embedded
(OpenRouter `text-embedding-3-small` @ 1024 dims); top-K is retrieved at prompt assembly for the
Narrator (exposition), NPC bundle, and Beat Planner as "Established earlier: …" lines. Strictly
enrichment — any embed/retrieve failure degrades to no memories; demo adventures skip it. Full F13
(lore-wide RAG) stays out of scope.

### 9.2.6 Known guide debt

Guides authored before the machine have objective predicates / ending signals keyed on atoms live
play can't claim, and no per-location `danger`/`encounter_table` (Stage 4/5 authoring is still
pending; the runtime fallback table covers it). **Regenerate guides** so authored vocabulary lands
in the machine's claimable shape — see the sim report.

## 10. Acceptance criteria

- [x] Simulated transcript fixtures: mystery→siege pivot detected within 5 events at ≥ 0.65 confidence; on-loop play produces no false pivots across a 50-event fixture.
- [x] Suspend/resume preserves beat position across an interleaved loop sequence.
- [x] Beat Planner reuses pool ingredients before requesting new ones (assert generator not called when pool suffices).
- [x] Player-theory canonization creates a consistent ingredient and blocks contradicting ones with a shown conflict.
- [x] Steward advances the antagonist plan on clock ticks with no player action; surfacing proposals appear non-blocking.
- [x] Variety flags fire per rules and alter Beat Planner output (fixture comparison).
- [x] Cooperation counters: `coop_low`, `coop_fatigue`, and `spotlight` fire against seeded event-log fixtures; braided beats emitted only when the composition profile supports the goal pair.
- [ ] Interlock guardrail: a personal loop with an interlock remains completable when the linked PC's loop is untouched (predicate fixture).
- [ ] Ending Steward: deterministic scoring ranks candidate endings from a seeded fixture of
      objective outcomes + NPC states + dial values; a player action that flips the winning signal
      re-ranks the leading ending; dial nudges are logged with justifications; commitment fires
      only at the late threshold and re-authors the climax from the event log; auto-commit
      (Full-AI) blocked on a Consistency contradiction.
- [ ] Offer lifecycle: the entry hook arrives as an `offered` quest_offer with banner state; a
      free-text accept activates the quest loop, drops the system line, and shifts giver
      disposition; the quest's first objective is NOT `active` before acceptance (fixture).
- [ ] Any-accept binds: with two PCs, one objection followed by the other's clear accept
      resolves the offer `accepted`; the objection routes to NPC conversation, not a veto.
- [ ] Negotiation: a successful influence attempt improves terms within the contract's authored
      floor/ceiling and never beyond the ceiling (clamp fixture); failure leaves terms unchanged;
      accepted terms are what the payout uses.
- [ ] Decline path: decline honored (no re-pitch in the same scene), steward receives the
      decline event, re-weave arrives from a different angle with `reweave_count` incremented;
      after 2 re-weaves no further offers — consequence surfacing fires instead (fixture
      sequence); refusal ending only creatable after the re-weave budget is exhausted.
- [ ] Ledger payout: quest completion credits accepted gold to the party ledger with an event-log
      entry (idempotent — no double-pay on re-evaluation).
- [ ] Reactive narration: demo/canned narration fixtures end on a decision point; the opening
      premise prompt forbids presumed motivation and stages the entry offer (prompt-contract
      assertion + fixture).

**Encounter-states machine (§9.2, verified 2026-07-19/20 — `story-live.mjs` $0 lifecycle + a
12-segment paid sim driven to a committed ending):**

- [x] Opened beat carries a canned encounter spec; an "offered" reply enters it; attempts drive it
      to a tier; the outcome map applies milestones; the beat exits and the next opens.
- [x] Skill-challenge tiers (participation / edge / DC escalation) unit-tested; social exits +
      disposition-forced exit; puzzle progress/hints/attempt-exhaustion + escalating consequence;
      random spawn interrupts and restores the interrupted encounter (single-depth stack).
- [x] Outcome maps validated against authored vocabulary (drift rejected); recognizer removed;
      objective completion force-re-plans the open beat.
- [x] Minimal retrieval memory: pgvector insert + nearest-neighbor retrieval, adventure-scoped,
      anon-unreadable; embed/retrieve failures degrade to no memories.

---

## 12. The deterministic story spine (overhaul, 2026-07-23)

**Why.** Paid playtests produced adventures that could not be finished. Run `6675274d` (*Below
the Sunken Chapel*) reached a state where the active objective's only route was a social
encounter naming a dead collective NPC and a survivor who existed only in prose: staging
refused, the encounter never opened, so the beat was never "spent", so nothing ever re-planned
it — a permanently unwinnable story. Three independent causes had to line up, and every safety
net was structurally blind to at least one of them.

The diagnosis was not "the model made a mistake". It was that **identity, sequencing and
liveness were all delegated to free text**, then checked by string equality. MAIN-SPEC §1.1(2a)
is the resulting principle; this section is its implementation.

Rollout flags (module consts, shadow-first, in `session/`): `ATOM_REGISTRY_ENFORCES`,
`PLANNER_CREATES_NPCS`, `DIRECTOR_APPLIES`, `GUARANTEED_ROUTE_APPLIES`, `FAIL_FORWARD_APPLIES`.

### 12.1 The canonical atom registry

`story_atoms` (unique `slug` per adventure) is the one naming authority for the flag/event/fact
strings predicates complete through. Spine atoms are extracted from objective predicates by
stage 3 (re-synced by stage 8 after repairs, and by objective regen); local atoms are
**declared** by a beat plan and allocated by code.

Every producer resolves through `resolveAtomText`, and every award still funnels through the
single gate `applyMilestones`. Three divergent vocabulary windows (award gate, Adjudicator,
Archivist) collapsed into one `milestoneVocabulary`.

**Auto-repair is canonical equality only** — case, punctuation, apostrophes, separators.
Anything fuzzier is *suggestion* material, proven by adversarial review with executed repros:
antonyms sit 1–2 edits apart (`guards_averted` → `guards_alerted`; the whole `un-` prefix
class), token reorder flips subject and object (`party_betrayed_varga` ≠
`varga_betrayed_party`), and sequential atoms collide (`ward_2_broken` → `ward_1_broken`, whose
predicate is *already true*, exiting the new beat instantly). The Beat Planner is explicitly
instructed to author success/setback **pairs**, so it manufactures antonym neighbours by design.

### 12.2 Two-call Beat Planner

Call 1 plans the beat and declares `new_local_atoms` (≤4) plus any `create_npcs` it needs;
exit conditions may only reference declared or objective atoms. Call 2 maps outcome tiers over
a **schema-enum'd menu** of registered atoms. This removes the documented circularity that
previously forced free-text generation (half the outcome vocabulary was the atoms of the same
response). A bare `{"flag":"x"}` is coerced to `eq:true` rather than failing the whole beat.

### 12.3 Plan-time stageability

Liveness moved from open time to **plan time**. The planner and Encounter Designer see only
NPCs that can take a stage now; names resolve to ids when the beat is authored; a social spec
with nobody stageable is **deterministically downgraded** to a skill challenge carrying the
same outcome maps (the tier bridge makes this lossless for the spine). The planner may declare
`create_npcs` for a role the roster lacks — the "Elara" fix, where a scene was written around
someone who existed only in prose. Stage 4 hard-fails a chapter whose NPCs are all dead/absent.

### 12.4 Route health

Four verdicts — `healthy`, `stillborn`, `spent`, `missing` — replacing `beatHasNoRouteLeft`, which required the
beat's encounter to have *opened and resolved* and was therefore blind to the failure that
started this. A never-opened beat past a grace window whose social spec resolves to no living
NPC is **stillborn** and forces a re-plan.

### 12.5 The Progress Director — one ladder, every turn

Runs at the `intent.ts` post-route hook: the only place *every* turn passes.
`evaluateStoryProgress` fires only on encounter resolutions, fact writes and scene effects, so a
turn that folded into narration previously reached **no detector at all**.

Counters live in `dm.story.director`; the decision is pure (`story/director.ts`). One action per
turn, monotonic (never repeats or regresses a rung without intervening progress):

| Rung | Action | Default threshold |
| --- | --- | --- |
| 1 | `nudge` — re-frame the obstacle, no new information | 2 no-progress turns |
| 2 | `reveal` — surface an undiscovered clue or hook in-fiction | 4 |
| 3 | `replan_beat` — the beat is not working; author a new one | 6 |
| 4 | `guaranteed_route` — open the objective's code-authored rescue | 9 |
| 5 | `fail_forward` — retire the objective, narrate the cost | 15 |

A broken route (`stillborn`/`missing`) jumps straight to rung 3 — hinting at a beat that can
never be played is useless. An open encounter holds rungs 1–2 but not the rescues. Thresholds
carry ±1 seeded jitter ("telegraph, don't schedule") and are DM-tunable via
`dm.settings.directorThresholds`.

**Offer pressure** is an orthogonal track: nothing on the ladder can help before the story is
accepted. It presses with a 4-turn backoff, then — after `OFFER_PRESSURE_MAX_PRESSES` — stops
asking and **forces the start** (`forceAcceptOffer`), narrated as events overtaking the party,
never as scolding. Without that terminal step a passive party has no active objective, making
the entire ladder unreachable: observed live as 6 presses and 0 objectives across 30 turns.

This ladder **replaced three uncoordinated ones** — the stuck-hint sweep, the dead-table stall
promoter (which wrote no progression *by design*), and the idle nudge's two-tier escalation.
`decideHint`, `maybeAutoHint` and the promoter path are deleted. The idle nudge survives as a
wall-clock trigger only: a different axis (nobody acting at all), capped at 2, and merging it
would create a `beats ↔ director` module cycle.

### 12.6 Guaranteed routes and fail-forward

Each objective carries a `guaranteed_route`: the **minimal atom set that provably satisfies its
predicate** (cheapest `any` branch, full `all` union; `eq:false` branches are unsatisfiable by
writing and skipped), wrapped as a playable skill challenge. Property-tested against
`evaluatePredicate`. Partial and failure tiers stay empty — it is a route, not a handout. The
beat alignment guard now fails **closed** to these atoms instead of shipping a misaligned beat.

`objectives.outcome` makes end state explicit (`completed | failed`). A failed objective still
advances the ladder and still scores endings — the signal vocabulary always accepted
`{objective_id, outcome:'failed'}` and nothing ever produced one, and `updateEndings` hardcoded
`'completed'`, so tragic/pyrrhic endings were unreachable by construction. Fail-forward is
full-AI only (assist records a DM proposal), sits at a deliberately distant threshold, and is
narrated as the antagonist gaining ground. When every objective is terminal the ending commits
even without a decisive score.

### 12.7 Encounter templates (anti-generic)

Code-authored rescues risk making every stuck moment feel the same. The tabletop answer is the
random table: not free invention, and not one shape either. `story/templates-encounter.ts`
holds 14 curated shapes (chase, infiltration, ritual, endurance, investigation sweep;
interrogation, negotiation, rally, deception; mechanism, riddle lock, environmental; ambush,
holdout), each requiring one **twist axis** — timer, terrain, moral choice, secondary
objective. The Designer picks from a menu with recently-used shapes removed; code owns the
mechanical skeleton.

### 12.7a Reachability gate (Phase 5)

Stage 7 checks prose contradictions; it cannot see whether an adventure is *finishable*. That
is a graph property, decidable deterministically, so it is a gate rather than a warning —
`packages/rules/src/guide/graph.ts`, run at the end of stage 8 immediately before the
`guide_ready` flip.

The prerequisite was **award surfaces**: nothing authored carried award metadata (outcome maps
were invented at runtime), so a guide-time reachability question would have passed vacuously.
`encounters.outcome_atoms` is now **derived** — the designer already declares which objective an
encounter serves, and that objective's predicate already determines what completing it needs,
so code computes the atoms rather than asking a model to re-pick them.
`ingredients.awards_atoms` is the optional clue-side equivalent.

| Finding | Severity |
| --- | --- |
| `objective_no_claimable_atom` — nothing live play can ever claim | error |
| `objective_unreachable` — no route awards its atoms and no guaranteed route | error |
| `chapter_no_living_npc` — the Sunken Chapel failure | error |
| `ending_unreachable` — keys only on objectives that do not exist | error |
| `objective_thin_routes` — fewer than 2 authored routes (Three-Clue Rule; the rescue route is the third clue, not the first) | warning |
| `no_failure_ending` — every ending demands completions, so a fail-forward run has nowhere to land | warning |
| `orphan_award_atoms` — an award no objective reads | warning |

`REACHABILITY_GATE` is `'off' | 'warn' | 'fail'`, currently **`'warn'`** — findings are recorded
as `guide_warnings` and a `reachability_lint` event, and the guide still ships. Tighten to
`'fail'` after a release of lab data: a false hard error blocks generation outright, which is
worse than the bug it prevents.

### 12.7b Canon vs. creative (Phase 6)

The Consistency Checker was being handed the live transcript (`factSheet`'s "Recent lines") *and*
the generating prompt verbatim. A narrator told to continue along a direction wrote exactly that,
and the checker then saw the identical sentence as both an established Fact and the Draft under
review — reporting a contradiction with itself:

```text
claim:        "two figures emerge from the oppressive blackness..."
conflictsWith "two figures emerge from the oppressive blackness"
```

`parseConsistency` forces `ok:false` whenever violations exist, so that self-conflict blocked the
draft, forced a regeneration under a `NEVER:` constraint quoting the very thing it was asked to
write, and on the second failure published the mechanical fallback. **Players saw "The attempt is
resolved; the outcome stands."**

`session/canon.ts` splits the two audiences. The **narrator** still receives everything — prompt,
transcript, retrieved memories, party profiles — because it needs them to write well. The
**checker** receives canon only: location/day, party roster, the dead/absent roster, and
committed world flags. Things that would still be true if nobody had said anything this scene.

The Archivist's NPC life/death verdicts now require a **verbatim evidence quote** that must
actually appear in the transcript (the recognition judge's discipline). A false "dead" removes an
NPC from staging and blocks their dialogue for the rest of the session; unverified claims log
`npc_state_unverified` and become a DM proposal instead. Restorative `present` needs no proof —
it can only widen what is possible, and that is what keeps an arrived NPC from being locked out.

### 12.8 Invariants

1. Every atom in any predicate, outcome map or award resolves to a `story_atoms` row.
2. `applyMilestones` remains the only progression writer, and accepts only registry atoms.
3. No beat opens with an unstageable encounter.
4. Every turn the active objective has ≥1 live route, or the ladder escalated exactly one rung.
5. Pending offers re-surface within threshold and eventually start the story.
6. A beat's `on_success` always credits the current objective (fail-closed); a **climax** beat
   credits its objective's *full* minimal satisfying set, so winning the finale ends the story.
7. Every objective terminates within its ladder bound; failures advance the story.
8. The ending commits when every objective is terminal, publishes its prose to the player
   **exactly once** (atomic single-winner claim), and marks the adventure done.
9. Every adventure has **1–3 combat encounters, at least one** (`COMBAT_FLOOR`/`COMBAT_BUDGET`).
10. The **final objective is the climax** (once an arc exists behind it), framed as the peak
    whatever its form — a fight, an escape, a reckoning; combat is never imposed on it.

### 12.9 Verification & known gaps

Verified by `packages/rules` unit tests (588), the $0 `story-live.mjs` suite (132 assertions),
and paid Adventure Lab runs (`docs/F15` §4). The dungeon plot that was permanently unwinnable now
completes objectives; escalation rungs climb on threshold; and — after §12.10 — a one-shot
**finishes naturally end to end**: a heist reached its climax and correct ending in 18 turns of
un-driven play (rising action → a tide-clocked climax → the right conclusion, published once).
Historical natural-completion rate before that work was 1 of 14.

**Still harness-assisted, not yet reliable un-driven:** natural-play *throughput*. A one-shot
finishes when it reaches its finale, but pacing is variable — the Adventure Lab's climax-aware
autocomplete (drive objectives up to the finale, then let the climax play) is how most genres are
exercised cheaply. Objective *design* (3–4 atom `all` chains take many turns) is the lever, not
the machinery. **Backstops deployed but not yet seen firing:** `combat_floor_forced` (guidance
has sufficed every run) and the climax full-set alignment (`climax_alignment_forced`).

**Combat is a placeholder auto-win** until F09. A defeated boss's state is therefore assigned
somewhat arbitrarily (e.g. `absent`), which the ending signals read — real fight outcomes
(killed / captured / fled) will feed those signals once the battle map lands.

### 12.10 Climax, combat floor, and the ending reaching the player (2026-07-24)

The overhaul made the spine *traversable*; this pass made a traversal *land as a story*.

**The climax is a designated beat.** When the active objective is the last non-terminal one AND
something has already resolved (an arc must exist — without the second clause a single-objective
quest flagged turn one as its own finale and completed instantly), `planAndOpenBeat` treats the
beat as the climax: the opening cutscene is framed as the culmination, **type-agnostic** ("pitch
the stakes at their peak… a confrontation, a desperate escape, a reckoning, a choice"). Forcing
every story to peak on a boss fight is the generic-gameplay trap — a heist climaxes on the escape.

**A boss combat opens itself; a social/skill climax is played.** A beat's encounter normally
waits for the party to commit to it (`entry='offered'`). For a finale *fight* that let the
confrontation go un-triggered if the party never phrased an attack, so a combat climax auto-opens
(lead-in → resolution → aftermath). A social or skill finale still waits — it is meant to be
played. The climax beat also credits its objective's **full** minimal satisfying set, not one
atom, or an `all`-chain finale could win half a conjunction and loop.

**Combat floor and ceiling: 1 major fight guaranteed, 3 total** (`COMBAT_FLOOR=1`,
`COMBAT_BUDGET=3`). Adventurers should draw steel at least once; real-time combat is the slowest
thing at the table, so three is the ceiling. The floor escalates as guidance past the ladder
midpoint, then a hard structural force at the climax if still unmet; the ceiling downgrades an
over-budget non-climax combat to a skill challenge. Court was dropped from the genre set for the
same reason — a premise where "steel settles nothing" makes an armed party's kit inert.

**The ending reaches the player, once.** Publishing the climax through `publishNarration` re-ran
the narrator — a second heavy call at the end of the longest tail — and when that worker hit its
resource limit the ending was silently lost. It now publishes the climax author's finished prose
**directly**, guarded by the deterministic structural claim-check (no dead/absent speaker) rather
than a fragile second LLM pass, and the commit is an **atomic single-winner claim**
(`.is('committed_ending_id', null)`) after three overlapping progress passes had narrated the
same ending three times. Combat *resolution* is a marker event; the lead-in and aftermath stay as
narration — the seam the F09 battle map plugs into.

**Ending selection:** `state:alive` means present and not dead — it no longer counts an `absent`
NPC as alive, which had flipped a won heist onto a defeat ending 3–2 (a departed boss firing both
a triumph's "villain lives" penalty and a tragedy's reward).

**Deferred to Phase 5:** the guide-time reachability lint needs award surfaces
(`encounters.outcome_atoms`, `ingredients.awards_atoms`) that no authored row carries today.
Note that MAIN-SPEC §1.1a backlog item 1 (parallel objectives) would change what "reachable"
means — decide before building it.

## 11. Open questions

- Loop template library size at launch (proposal: the 10 types in §2, each with a 3–5 beat template).
- Suspicion signal extraction quality — start with Summarizer tagging + simple keyword heuristics; refine with proposal-log feedback.
- Whether the objective ladder should ever allow **parallel** active objectives (MAIN-SPEC §1.1a
  backlog 1). Today it is strictly sequential, which is the single largest railroad factor.
