# F7 — Live Orchestration Core

**Depends on:** F1, F4 schemas, F5
**Depended on by:** F8–F11, F14

## 1. Purpose

The heart of live play: intent routing, adjudication, the proposal pipeline, the DM console interaction model, consistency validation, and single-writer state sync.

## 2. Where it runs

v1: the Adventure Manager runs as a Supabase Edge Function invoked per intent + Postgres as authority, with a `state_version` integer per adventure for optimistic concurrency (every diff increments; stale writes rejected and recomputed). All mutations go through one `apply_diff` RPC (Postgres function) that validates version, writes, appends to event log, and notifies Realtime — this is the "single writer" in practice.

## 3. Intent pipeline

### 3.1 Intent envelope (client → server)

```json
{ "intent_id": "uuid", "actor": "user_id/character_id",
  "kind": "say | do | roll | move | attack | cast | use_item | dm_command",
  "payload": {}, "scene_version": 123 }
```

### 3.2 Action Router

> **Superseded in narrative modes by §3.10 (encounter-states machine + unified input, 2026-07-19/20).**
> The router below still governs battle mode, the fast path, and `dm_command`; but in
> narration/roleplay/downtime/puzzle a full-AI table no longer free-adjudicates every `do`, and
> `say`/`do` are one unified utterance the server interprets (§3.10). Kept here for the fast-path
> and combat contract.

Deterministic classification, in order:

1. **Fast path (no LLM):** `move`, `roll` (explicit skill/dice), `attack`/`cast`/`use_item` with valid targets → straight to Engines via Turn Manager.
2. **Structured `say`** in roleplay → Dialogue pipeline (F10).
3. **Free-text `do`** → Adjudicator Agent.
4. **`dm_command`** → DM command handler (§5).
Additionally: every routed intent is checked against the active loop's expected intent types; a streak of 3+ mismatches flags the Loop Classifier (F8).

### 3.3 Adjudicator contract

```
Input:  { intent_text, actor_summary, scene_state, active_loop_beat,
          current_objective (revealed title + DM-only hidden desc),
          relevant_lore (query_lore top-k) }
Output: { interpretation: string,                     -- what the player is attempting
          resolution: 
            { type: "auto_success" | "auto_fail" | "check",
              check?: { skill, dc (bounded 5–25), adv_dis, rationale,
                        group?: bool,
                        requires_assist?: { skill, effect: 'enable'|'bonus' } },
              consequences_hint: string },
          flags: { impossible?: bool, needs_dm?: bool, talk?: bool } }
```

- DCs clamped server-side to the bounded range regardless of output.
- `needs_dm` (assist mode) short-circuits to a DM proposal ("Player wants to X — how should this resolve?") with the Adjudicator's suggestion as option 1.
- Check specs go to the Check Engine; result + interpretation → event log → Narrator.
- **`check.skill_options` + `flags.talk` (2026-07-20, see §3.11):** a check may offer up to 3
  applicable skills the player picks from ("Does Investigation apply?" "Sure!"); `flags.talk`
  marks an utterance that only asks the DM a plain-sight question and gets an in-fiction answer,
  never a check. The Adjudicator also weighs the actor's species traits / background / quirks
  (§3.11) and names the deciding trait in `rationale`.

### 3.4 Group, assisted & braided resolution (cooperation mechanics)

- **Group checks:** for party-scale actions (sneaking past the camp, the climb together), the Adjudicator prefers `group: true` — every present PC rolls, success if ≥ half pass (SRD group-check rule). All players prompted simultaneously (20s window); idle/disconnected PCs auto-roll flat.
- **Assisted checks:** `requires_assist` publishes an assist slot to the other players (sidebar prompt: "Kaelen needs someone with Athletics to hold the gate"). A second PC commits their action + the named skill; `effect: 'enable'` gates the primary roll on the assist succeeding, `effect: 'bonus'` grants the primary advantage. Unclaimed after 15s → primary rolls unassisted (or the attempt fails-forward with a narrated off-ramp if enable-gated). Assist commitments are logged as cooperation events (F15).
- **Braided intents:** when the active beat is flagged `braided` (F8 §4), the Turn Intent Buffer holds simultaneous intents from different PCs in the same scene window and resolves them **interleaved**: each resolution can emit a DC modifier consumed by its linked pending intent (a distraction that succeeds by 5+ lowers the linked search DC by 4; by 1–4, by 2; failure raises it by 2). Links are declared in the beat's `braided` goal pairs and applied deterministically by the Check Engine — no LLM in the resolution path.
- The Adjudicator receives the party composition profile (F5) so it knows which skills exist in the party before speccing group/assist checks — it must never spec an assist skill nobody has.

### 3.10 Encounter-states machine & unified input (implemented 2026-07-19/20)

The redesign in `docs/PLANS/encounter-states.md` (all 7 slices shipped; playtest report
`docs/CHECKPOINTS/ENCOUNTER-STATES-SIM.md`) makes full-AI narrative play a **totalizing
two-phase state machine** — the router above no longer free-adjudicates every `do`. The machine
itself lives in F8 §9.2 (authoring, phases, encounter kinds); this section documents the
orchestration surface it changed.

- **Unified input (2026-07-20):** the player types one line and the DM interprets — the UI sends
  everything as `say` behind one **Send** button (the always-visible skill-select + Roll were
  removed; the fast-path `roll` intent stays on the wire). Server-side, `say` and `do` route
  identically in narration/roleplay/downtime/puzzle; the interpreters decide what the words are.
  The variety/Loop-Classifier bookkeeping (§3.2, F8 §7) records the *interpreted* pillar, not the
  button pressed.
- **Phase routing (narrative modes, full-AI):** while `GameState.encounter` is null the game is in
  CUTSCENE → say/do route to **entry mapping** (F8 §9.2.2), never free adjudication. While an
  encounter is open, say/do route to that encounter's handler (skill-challenge / puzzle /
  in-encounter adjudication); a `say` with staged NPCs still enters the F10 dialogue pipeline.
  Assist mode keeps the human DM as driver — free adjudication persists there, only open
  challenges/puzzles intercept its intents.
- **`encounter_talk`:** a say/question mid-encounter with no NPC staged is answered in-fiction
  without counting an attempt (questions cost nothing) — inputs never silently vanish. The
  Adjudicator's `flags.talk` and the Puzzle Judge's `talk` result funnel questions here.
- **Action-escape:** inside an NPC conversation the social classifier (F10) can return
  `{kind: 'action'}`; the utterance then re-routes out of the dialogue pipeline into the
  challenge/puzzle/adjudication flow with the line already staged.
- **Recognizer removed:** the transcript milestone recognizer (old F14) is deleted from the
  runtime — validated encounter **outcome maps** and in-encounter adjudicator claims are the only
  progression writers (F8 §9.2).

### 3.11 Character-aware play, DM-called checks & visible dice (2026-07-20)

- **Character profiles feed every agent:** a per-PC line built from `race_key` → SRD species
  traits (a dwarf's Darkvision with its rules text), background, personality/freeform quirks, and
  backstory (all capped) is fed to the Adjudicator, entry mapper, Beat Planner, Encounter
  Designer (F8), Narrator, and NPC bundle (F10). Rulings account for traits — a trait that
  trivializes the action → auto-success/advantage/lower DC, named in the rationale; a hindering
  trait → the opposite. Narration and NPCs personalize to who the party actually is.
- **DM-called checks with skill options (the "does my Investigation apply?" flow):** players never
  roll unprompted in narrative modes — the DM (Adjudicator) calls the check and may offer 1–3
  applicable skills via `check.skill_options`. The pending-prompt UI renders one `Roll <skill>`
  button per option; `roll_pending` accepts the chosen skill (validated against the offer;
  modifier per pick; skill challenges carry per-option escalated DCs). Questions probing hidden
  info spec a check; only plain-sight questions stay free (`flags.talk`).
- **Visible dice:** every rolled check prints a transcript line — `Kestrel rolls investigation:
  7 (d20 5 +2) - failure` — on solo/group/assist/auto rolls (advantage/disadvantage and
  picked-vs-primary noted). The DC stays the DM's secret.
- **"DM is thinking" covers the whole chain:** the client shows the indicator from the instant
  Send is pressed (its own in-flight state), and `evaluateStoryProgress` holds the server-side
  typing flag for the entire story-progress pass (beat re-plans, Encounter Designer, ending
  scoring) — the window that previously read as "stuck" after a narration published.

## 4. Proposal pipeline

```
proposals: id, adventure_id, session_id, type, payload jsonb, options jsonb[],
           approval_mode ('human'|'auto'), status ('pending'|'accepted'|'edited'|
           'rejected'|'expired'|'auto_applied'),
           decision jsonb {chosen_option?, edit_diff?, decided_by, decided_at},
           context_refs jsonb, created_at
```

- **Assist mode:** proposal → `dm:{adventure_id}` channel → proposal tray. Accept/edit/reject → decision recorded → accepted payload committed via `apply_diff`. Pending proposals expire (configurable, default 5 min) if superseded by events.
- **Full-AI:** `approval_mode: auto` → committed immediately, logged as `auto_applied`.
- Blocking vs non-blocking: narration and rulings **block** the pipeline (players see a subtle "DM is thinking" indicator); ambient proposals (loop pivots, ingredient placements, antagonist reports) are **non-blocking**.

## 5. DM console interactions (assist mode)

### 5.1 Free-prompt narration ("AI gives choices, human picks")

DM text area accepts anything, e.g. "Narrate the next story":

1. Prompt + condensed context (memory, current objective, active beat, recent events) → Narrator in **options mode**: `{ options: [{summary: string ≤ 1 sentence, id}] × 3–4 }`.
2. Options render as chips; DM clicks one → full narration generated from that option → preview with inline edit → **Publish** (broadcast + TTS) or regenerate.
3. Both stages logged as proposals.

**Narration contract (added 2026-07-18, per F8 §9.1):** the Narrator's system prompt requires
every published beat to end at a concrete decision point facing the players (an NPC awaiting an
answer, a fork, a threat, an open offer), optionally with a direct question when natural — never
a formulaic closer. Session-opening premise narration (F5 lifecycle) must stage the entry offer
scene and never presume party motivation; motivation comes from accepting the offer (F8 §2.1).

### 5.2 Overrides

The DM can override anything:

- Edit any pending proposal before accepting.
- Retract the last published narration (≤ 60s window): broadcast a correction event; event log keeps both with `retracted` marking.
- Direct state edits (HP, flags, disposition, objective checkboxes) via sidebar → logged as `dm_override` events (these feed the Consistency Manager's fact base immediately).
- Take over any AI-controlled combatant for a turn.

### 5.3 Ruling requests

"Ask the table"-style: DM can convert any proposal into a visible player-facing choice (e.g. resolution options) — v1.1, stub the button.

## 6. Consistency Manager

Runs before any narration/dialogue broadcast:

1. **Deterministic checks:** named entities in the draft resolved against NPC registry (dead/absent NPC speaking?), item references vs inventories, location references vs current scene.
2. **LLM pass** (Consistency Checker, FlashLite): draft + condensed fact sheet → `{ok: bool, violations: [{claim, conflicts_with}]}`.
3. On violation: assist mode → annotate the proposal ("⚠ mentions Joren, who died in session 2"); full-AI → one automatic regeneration with violations injected as constraints; second failure → fall back to a minimal mechanical description ("The attack hits for 7 damage.") and log an incident (F15).

## 7. Realtime sync protocol

- Server → clients: `game:{adventure_id}` typed diffs with `state_version`; clients apply in order, request full resync on gap.
- Clients → server: intents only (HTTPS RPC, not channel writes), so authorization is enforceable per intent.
- DM channel `dm:{adventure_id}`: proposals + hidden context; join gated by role check.

## 8. Acceptance criteria

- [ ] Fast-path intents (move/attack/roll) never trigger an LLM call (assert via usage_log).
- [ ] Concurrent intents from two clients resolve deterministically via state_version (no lost updates in a 2-client race test).
- [ ] Adjudicator DC clamping enforced server-side.
- [ ] Proposal accept/edit/reject round-trip recorded with diffs; expired proposals cannot be applied.
- [ ] Consistency pass blocks a seeded dead-NPC narration in both modes.
- [ ] "Narrate the next story" produces 3–4 one-sentence options → pick → publish flow works end-to-end with TTS.
- [ ] Group check: simultaneous prompts, half-pass rule, idle auto-roll (fixture with one idle client).
- [ ] Assisted check: enable-gated and bonus variants both flow end-to-end; unclaimed-slot timeout paths verified; Adjudicator never specs an assist skill absent from the composition profile (property test).
- [ ] Braided pair: two clients resolve linked intents; DC modifier applied per degree-of-success table (golden fixture).

**Encounter-states machine (§3.10–3.11, verified 2026-07-20 in `orchestration-live.mjs` /
`story-live.mjs` / paid probes):**

- [x] Full-AI cutscene say/do routes through entry mapping (folded_in / offered / adhoc), never
      free adjudication; a mid-encounter question is answered via `encounter_talk` with no attempt
      counted.
- [x] Unified input: one `say`-only Send path; `do` still accepted on the wire; variety
      bookkeeping records the interpreted pillar.
- [x] DM-called check offers `skill_options`; player rolls a picked skill (validated, per-skill
      DC in a challenge); `check_rolled` records the picked skill.
- [x] Every rolled check emits a visible `<name> rolls <skill>: <total> (d20 <d20> +<mod>) -
      <success|failure>` transcript line (solo/group/assist/auto).
- [x] Character profiles (species traits / background / quirks) reach the Adjudicator, Narrator,
      and NPC bundle; a trait that trivializes an action shifts the ruling (Darkvision in the dark).

## 9. Open questions

- Latency budget: target ≤ 4s from free-text intent to narration start (assist adds human time). If Adjudicator+Narrator serial calls exceed this, merge them into one call for simple cases (single agent with two-part output) — measure first.
