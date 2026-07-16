# F9 — Combat Engine & Tactical Map

**Depends on:** F2 (character stats), F4 (encounters, NPC stat blocks, maps), F6 (map renderer), F7 (intent pipeline)
**Depended on by:** F11 (XP awards), F14

## 1. Purpose
Turn-based tactical combat on the grid map, fully deterministic, SRD-data-driven, with live-adjustable difficulty, boss phases, and NPCs on any side under any controller.

## 2. Combat state
```
combat_encounters: id, adventure_id, session_id, encounter_id?, status,
                   round int, difficulty jsonb (active modifier set),
                   started_at, ended_at, outcome?
combatants: id, combat_id, ref (character_id | npc_id | minion_template_id),
            allegiance ('party'|'enemy'|'neutral'),
            controller ('player:{user_id}'|'dm'|'ai'),
            initiative int, position {x,y}, hp_current, hp_max, hp_temp,
            conditions jsonb[], action_economy jsonb {action,bonus,move_ft,reaction},
            death_saves {s,f}, concentration_on?
```
Ephemeral working state in the Adventure Manager; checkpointed per round.

## 3. Combat flow
1. **Start:** DM launcher (assist) or Encounter Designer spec (full-AI/objective trigger) → map loads, combatants placed (spawn markers or DM drag), Budget Engine reports difficulty rating, **Roll initiative** → Dice Engine per combatant (public log).
2. **Turn loop (Turn Manager):**
   - Active combatant by initiative; economy reset at turn start; effect expiry checks at turn start/end (Effects Engine).
   - `controller: player` → client input (move drag, attack/cast from sidebar Combat tab). `dm` → DM acts via console. `ai` → NPC Tactician (§6) or minion heuristic.
   - Reaction windows: triggering events (leaving reach, spellcast in range) pause resolution and offer the reaction to eligible combatants (player prompt with 15s timer / Tactician decision / DM prompt); default decline on timeout.
   - Boss phase check after damage application (§5.2).
3. **End:** end condition (side eliminated/fled/surrendered, or DM end-combat) → outcome → XP via Progression Engine (F11) → Summarizer encounter summary → Scene Manager exits battle mode.

## 4. Engines detail

### 4.1 Actions supported (v1)
Move (Grid Engine path/cost, difficult terrain ×2), melee/ranged attack, cast spell (SRD spell data: attack-roll and save-based, single-target and AoE templates), dodge, dash, disengage, help, use item (healing potions etc.), grapple/shove (contested checks), death saves, opportunity attacks. **Deferred:** mounted combat, readied actions (v1.1), stealth-in-combat.

### 4.2 Conditions (v1 SRD subset)
blinded, charmed, frightened, grappled, incapacitated, invisible, paralyzed, poisoned, prone, restrained, stunned, unconscious + exhaustion levels. Each is data: `{modifiers: [...], prevents: [...], grants_advantage_to_attackers?, auto_fail_saves?[]}` consumed generically by the resolution engines. Concentration: damage → CON save DC max(10, dmg/2), fail drops the effect.

### 4.3 Grid Engine
Chebyshev distance (5 ft diagonals, standard simplified), obstacle-blocked movement + line of sight (Bresenham vs obstacle tiles), cover from obstacles (half/three-quarters as +2/+5 AC — computed, DM-overridable), AoE templates (sphere/cone/line/cube) rasterized to tiles with target lists.

## 5. Difficulty system

### 5.1 Difficulty Scaler
A difficulty setting is a named modifier set applied at resolution time (stat blocks never mutated):
```json
{ "name": "Hard", "hp_mult": 1.3, "to_hit": +1, "dc": +1, "dmg_mult": 1.15,
  "minion_delta": +2, "legendary_actions": 0 }
```
Presets: Story (0.75/−2/−1/0.8), Easy, Standard (all neutral), Hard, Deadly (1.5/+2/+2/1.3, +legendary action on bosses). Custom via advanced sliders.
- **Assist:** DM slider on the Combat tab, adjustable **before or mid-encounter**; mid-encounter change applies from the next resolution (current HP rescaled proportionally on hp_mult change), broadcast as a subtle log line only to the DM.
- **Full-AI:** fixed at adventure creation (`adventures.difficulty_setting`), applied to every encounter spec.
- Budget Engine reports effective difficulty (XP budget × modifier weighting) so the DM slider shows "≈ Deadly for this party" live, counting allied NPCs party-side (each as an effective party member weighted by CR-to-level mapping).

### 5.2 Boss phases
Authored in F4 (`npcs.boss_phases`):
```json
[{ "trigger": {"hp_below_pct": 50},
   "changes": { "add_abilities": [...], "remove_abilities": [...],
                "stat_mods": {...}, "summon": {"template": "cultist", "count": 2},
                "terrain_event": "pillars_collapse", "narration_seed": "..." },
   "fired": false }]
```
Checked after every damage application; firing applies changes via the Scaler mechanism, spawns summons at DM-placed/nearest-valid tiles, and hands the narration seed to the Narrator (blocking mini-narration).

## 6. NPC combatants & Tactician

### 6.1 Joining combat
`add_combatant(npc_id, allegiance, controller)` — available to the DM anytime (console: "Add to combat" on any present NPC) and to agents as a proposal (e.g. Adjudicator resolves "I ask the captain to fight with us" → success → proposal to add captain, allegiance party, controller ai). Initiative rolled on entry (joins at rolled position, acts from next round). Mid-combat allegiance flips supported (betrayal!) as a DM action / proposal.

### 6.2 NPC Tactician Agent (bosses + named NPCs)
```
Input:  { self (stat block + tactics_profile + current state),
          battlefield (positions, allegiances, visible HP states, terrain),
          legal_actions (enumerated by the engines — the agent CHOOSES, never invents),
          allegiance objectives ("protect the wizard", "flee below 25%") }
Output: { action: {type, target?, path?, ability_ref?}, intent_note: string }
```
- **Legal-actions enumeration is the safety rail:** engines compute every legal action+target; the Tactician selects among them, so an invalid choice is impossible (fallback: highest-heuristic legal action on schema failure).
- `tactics_profile` (from F4): archetype (brute/skirmisher/controller/support/coward), focus rules, flee threshold, protect list.
- Assist mode: Tactician choice surfaces as a fast proposal (auto-applies after 8s unless DM intervenes — combat pacing must not wait on the console for every mook).

### 6.3 Minion heuristic (no LLM)
`minion_templates` (F4/SRD): simple scripted policy — target selection (nearest / lowest-HP / focus-marked), move-to-range, attack, morale check (flee when side < 25% strength if `cowardly`). Keeps token costs near zero for trash fights.

## 7. Combat log & UI hooks
Every resolution appends structured events (roll breakdowns: `d20(14)+7=21 vs AC 18 — hit; 2d6(9)+4=13 slashing`) → session log, floating numbers, initiative ribbon updates (F6).

## 8. Acceptance criteria
- [ ] Golden-file tests: scripted combats (fixtures with seeded RNG) produce byte-identical event logs across runs.
- [ ] SRD math verified against hand-calculated cases (crits, resistance stacking, cover, concentration).
- [ ] Mid-combat difficulty change rescales correctly and applies to next resolution only.
- [ ] Boss phase fires exactly once per trigger; summons appear on legal tiles.
- [ ] Allied NPC added mid-fight is counted by the Budget readout and acts via Tactician; DM can seize control for a turn.
- [ ] Tactician can never output an illegal action (property test over random battlefield states).
- [ ] Minion turns complete with zero LLM calls.
- [ ] Disconnected-player turn handling per F5 §5.

## 9. Open questions
- Flanking (optional rule) — off by default, toggle later.
- Fog of war / vision — out of scope v1 (all tokens visible).
