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

## 2.1 Quest contracts & the offer lifecycle (added 2026-07-18)

Design principle: **the story is offered, not imposed.** Players are never told what motivates
them — quest-shaped goals arrive as in-fiction offers with a giver, stated reward, and stakes,
and nothing quest-shaped becomes active until the party says yes. Acceptance is what creates
motivation; narration that presumes it ("you've come here to uncover the truth") is a defect.

```
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
  override for the creator/DM.
- **Idle nudge:** players idle past a threshold (default 3 min, DM-configurable) → one
  in-fiction nudge (an NPC speaks up, a distant sound, the giver presses for an answer). A
  nudge never advances plot state without player input.

## 10. Acceptance criteria

- [ ] Simulated transcript fixtures: mystery→siege pivot detected within 5 events at ≥ 0.65 confidence; on-loop play produces no false pivots across a 50-event fixture.
- [ ] Suspend/resume preserves beat position across an interleaved loop sequence.
- [ ] Beat Planner reuses pool ingredients before requesting new ones (assert generator not called when pool suffices).
- [ ] Player-theory canonization creates a consistent ingredient and blocks contradicting ones with a shown conflict.
- [ ] Steward advances the antagonist plan on clock ticks with no player action; surfacing proposals appear non-blocking.
- [ ] Variety flags fire per rules and alter Beat Planner output (fixture comparison).
- [ ] Cooperation counters: `coop_low`, `coop_fatigue`, and `spotlight` fire against seeded event-log fixtures; braided beats emitted only when the composition profile supports the goal pair.
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

## 11. Open questions

- Loop template library size at launch (proposal: the 10 types in §2, each with a 3–5 beat template).
- Suspicion signal extraction quality — start with Summarizer tagging + simple keyword heuristics; refine with proposal-log feedback.
