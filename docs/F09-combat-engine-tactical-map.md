# F9 — Combat Engine & Tactical Map

**Depends on:** F2 (character stats), F4 (encounters, NPC stat blocks, maps), F6 (map renderer), F7 (intent pipeline), F8 (story loop — the manifest/result boundary below)
**Depended on by:** F11 (XP awards), F14

> **Status (2026-07-24):** the deterministic engine (`packages/rules/src/combat/`) and the standalone Combat Lab (§11) exist and are proven in isolation. What does **not** exist yet: the story-integration boundary (§3), server-authoritative live play (§5), and every rich subsystem the original spec listed as "v1" (Tactician, Momentum/combos, cooperative mechanics, boss phases, full conditions, death saves). This revision re-scopes those under an explicit sequence (§2) and adds the integration layer the original spec never had. See the reconciliation log (§13) for what changed against the pre-integration draft and why.

## 1. Purpose

Turn-based tactical combat on the grid map, fully deterministic, SRD-data-driven, with live-adjustable difficulty, boss phases, and NPCs on any side under any controller.

**One hard constraint from the story overhaul (2026-07-24):** combat is an **isolated black box**. It takes a **manifest** in and hands a **result** out (§3). It must never reach into the story consistency/pacing agents or their workflow — the story loop calls combat exactly the way it already calls `runCombatPlaceholderEncounter` today (a lead-in, then a resolved tier), and combat calls nothing in the story loop back except by returning its result. This isolation is why combat can grow (Tactician, combos, coop) without touching a single line of the spine.

## 2. Sequencing — what ships first

The original spec bundled a very large "v1." It ships as an ordered sequence instead; each step is independently playable and independently verifiable. **Combat reaches real solo play at F09.0a and real multiplayer at F09.0b** — everything after that is depth, not blockers.

The tactical core the whole sequence rests on is the engine as it already stands: initiative (DEX tiebreak), turn order + action economy, move (grid path/cost, difficult terrain), melee/ranged attack (full roll breakdowns, crits), dodge/dash/disengage, opportunity attacks (auto-resolved by the engine), HP-to-zero (NPCs die, PCs fall **unconscious** — no death saves), prone + unconscious conditions, spells (SRD attack- and save-based, single-target + AoE templates), the minion heuristic (§8.3), and the difficulty scaler presets (§7). F09.0 wires that proven engine into the story loop, split into a story-contract slice and a live-sync slice:

- **F09.0a — Story contract, single-player, non-networked (first playable).** The vertical slice through the integration boundary (§3): the combat **initiator** builds a **manifest** from authored data, the engine runs the fight for one player (every adventure has ≥1 player), and a **result** flows back out — scene-mode entry (§3.7), boss-down-ends (§3.6), the spare/capture beat setting `bossOutcome`, lead-in + aftermath narration, and the `CombatResult → tier → resolveOpenEncounter` contract with fail-forward on a loss. No per-action network round-trip, no turn timer, no concurrent clients — the fight is driven single-writer, so this slice proves the **story-facing correctness** (right manifest from authored rows, right tier and boss fate to the spine, right ending signal) in isolation from live-sync concerns. This is the slice that replaces the `runCombatPlaceholderEncounter` body with a real fight. Because §11.1 already exercises initiator→manifest→engine→result offline in the Lab, F09.0a is that same path proven **inside the session loop**.
- **F09.0b — Server-authoritative multiplayer live loop.** Add the live machinery on top of the proven contract: every action round-trips through `apply_diff` on the `combat` domain and broadcasts via Realtime (§4/§5), multiple human + AI combatants, the **turn timer** (human turn skips on timeout; AI acts instantly), and the scene-mode switch broadcast to all clients. This is where the latency profile in §12 matters; F09.0a carries none of it.
- **F09.1 — NPC Tactician (§8.2).** Bosses and named NPCs graduate from the heuristic to the LLM Tactician (choose-from-legal-actions). Highest-value depth upgrade; the first increment because a smart boss is the single biggest felt difference.
- **F09.2 — Momentum & combos (§8.4).** The deterministic teamwork-reward layer. Zero-LLM; slots cleanly onto the existing event stream.
- **F09.3 — Cooperative encounter mechanics (§8.5).** Paired mechanics, damage thresholds, protect-the-objective specs, anti-clustering tactics profiles. Matters most once parties are commonly ≥2.
- **F09.4 — Depth fill.** Boss phases (§7.2), the full SRD condition set (§6.2), death saves, grapple/shove/help/use-item, reaction windows beyond opportunity attacks, mid-combat narration triggers (§3.5).

Nothing below is cut — it is scheduled. Where a section describes an F09.1+ subsystem, it says so inline.

**Every increment is validated in the Combat Lab first.** Each F09.x feature is exercised in the Lab (§11) — against SRD fixtures *and* against real authored fights loaded from a playthrough (§11.1) — before it is wired into live server-authoritative play. The Lab is the per-feature test surface, not just the engine's initial proving ground.

## 3. Story integration boundary (F09.0 — the new layer)

This is the seam the original spec lacked. Today `runCombatPlaceholderEncounter` (`session/encounters.ts`) opens a combat beat, writes a lead-in, and auto-resolves the tier `full` — reporting no deaths and reading no authored enemy data. F09.0 replaces the placeholder body with a real fight while keeping that exact call signature, so the spine is unchanged.

### 3.1 The combat initiator (code-join + thin ad-hoc agent)

A combat beat's job is mostly **joining authored data**, not inventing it — the guide already authored everything a fight needs, it is just never read at combat time:

- `encounters.spec.enemies` = `[{name, cr, count}]` (Stage 5, `guide/stages/stage5.ts`)
- `npcs.stat_block` = full `NpcStatBlock` (`guide/npc-stats.ts`); the boss is `npcs.role='boss'`, floored CR2, archetype `leader`
- `npcs.tactics_profile`, `npcs.boss_phases` (authored, consumed in F09.1/F09.4)
- the encounter's assigned `battle_map_id` (§3.4) and its obstacles
- the roster's living PCs (the party being deployed)

The initiator is **code-first**: it deterministically assembles the manifest from those rows. A **thin ad-hoc agent** runs only in the gap cases the guide could not pre-author — an unscripted fight the player picked ("I attack the guards") with no authored `encounters` row — and even then it only **selects from menus** (which fixture enemies, which nearest-tag map, boss or not), never free-invents stat blocks. This matches the standing rule: code owns structure and context; the LLM picks from menus.

Because the initiator is pure and code-first, it is **reused verbatim by the Combat Lab** (§11.1) to rebuild any real playthrough's fight from its `encounters` row — the manifest is the single artifact that crosses the isolation boundary in both directions.

### 3.2 The manifest (INPUT contract)

```text
CombatManifest {
  encounterId?          // authored row, or null for ad-hoc
  mapId                 // resolved battle map (§3.4)
  party:   Combatant[]  // living PCs, engine shape, placed on party spawns
  enemies: Combatant[]  // expanded from spec.enemies x count, stat blocks from npcs/fixtures
  bossRef?              // the enemy id the engine must treat as the boss (§3.6) — the engine
                        // has NO boss concept, so the manifest MUST mark it explicitly
  difficulty            // resolved preset: per-adventure baseline x per-encounter intensity (§7.1)
  beatSpec              // the StoredBeatSpec whose onSuccess/onPartial/onFailure atoms the tier maps to
}
```

`Combatant` is **the engine's shape** (`packages/rules/src/combat/types.ts`) — one truth. The legacy `CombatState`/`TokenState` are deleted (§4/§13).

### 3.3 The result (OUTPUT contract)

```text
CombatResult {
  outcome: 'victory' | 'defeat'   // engine's binary winner
  tier:    'full' | 'partial' | 'failed'   // what the story consumes, as today
  bossOutcome: 'killed' | 'escaped' | 'captured' | 'spared' | 'none'   // from the spare/capture beat (§3.6)
  casualties: { pcIds: string[]; npcIds: string[] }   // who fell (PCs unconscious, NPCs dead)
}
```

The story consumes `tier` exactly as `resolveOpenEncounter(tier, aftermath)` does now. `bossOutcome` and `casualties` are **new channels** the placeholder never had: they drive `applyNpcState(boss, 'dead'|'absent'|'alive')`, which feeds the ending signals (`state:dead|alive|absent` in `packages/rules/src/story/endings.ts`). A won fight where the boss is **spared** or **escapes** must NOT flip the boss to `absent`-counted-as-defeat — this is exactly the alive/absent bug fixed on 2026-07-24; the result contract is what makes the boss's fate explicit instead of inferred.

- **Losses are fail-forward** (owner decision, matches the story overhaul): `defeat` maps to tier `failed`, which advances the story as an antagonist gain — it does not dead-end. No party wipe / permadeath in v1: PCs fall **unconscious**, only NPCs (and the boss) die.

### 3.4 Map source (built-in starter library + Stage 5 assignment)

- A **built-in, tagged starter map library** ships in the rules/assets package (tags: `dungeon`, `forest`, `interior`, `street`, `cave`, `crypt`, ...). Fixtures double as golden-test setups.
- **Stage 5 assigns** each authored encounter a `battle_map_id` by tag match to the encounter's fiction. **Nearest-tag fallback** when no exact tag exists (loose match is acceptable — a fight always has a floor).
- User-uploaded maps (the Lab's `battle_maps` table + `battle-maps` bucket, §11) remain available and can be assigned the same way; the starter library just guarantees coverage without authoring.

### 3.5 Narration seam (v1 = lead-in + aftermath only)

- **v1:** the story narrates the **lead-in** before combat and the **aftermath** after — the two seams that already exist (`narrationBeat(...)` before, `resolveOpenEncounter` aftermath after). During the fight, narration is silent; the tactical UI carries the moment.
- **Mid-combat narration is deferred to F09.4** and, when it lands, is a **non-blocking overlay** — a triggered flavor line (boss below 25% HP, a tile trap springs) that never pauses resolution. Contrast the original spec's "blocking mini-narration" on boss phases (§7.2): reconciled to non-blocking (§13). Triggers are structural facts the engine already emits (HP thresholds, event types), never regex over prose.

### 3.6 End condition + boss fate (spare/capture beat)

- **Boss down ends the fight.** When the manifest's `bossRef` falls, the fight is over — surviving minions rout (they do not need to be mopped up one by one). This is why the manifest must mark the boss: the engine's raw end condition is side-elimination, and F09.0 layers "boss down => enemies rout" on top.
- On victory, a **free-text spare/capture beat** offers the party a decision point over the downed boss (reusing the story loop's existing offer/decision machinery — not a new mechanic). The choice sets `bossOutcome` (`killed`/`captured`/`spared`/`escaped`), which flows through the result into the boss's NPC state and thence the ending signal. A boss can also `escaped` if the fight's terms allow it (e.g. a flee-triggered exit).

### 3.7 Entry: scene-mode switch

Entering combat is a **scene-mode switch**: the session flips into battle mode and **deploys the party on the map's spawn markers** (party spawns / enemy spawns authored per map). Exit flips back to narrative mode and hands the result to `resolveOpenEncounter`. Non-combat play (chat, movement, social) is suspended for the duration; the switch is the clean isolation boundary.

## 4. Combat state (reconciled)

Combat state lives in **`GameState.combat`** (the `combat` domain of the session's jsonb state), committed per action through the **same single-writer `apply_diff` + Realtime broadcast** as every other live-play domain (scene, players, dm). `apply_diff` is domain-scoped, so a single attack diffs only the `combat` domain — not the whole state — which keeps per-action writes cheap. There is **one persistence model**, not two.

The shape is the **engine's** `CombatEngineState` / `Combatant` (`packages/rules/src/combat/types.ts`):

```text
GameState.combat (when a fight is live):
  status: 'active' | 'ended'
  round, activeIndex, seed
  combatants: Combatant[]   // {id,name,side:'party'|'enemy',kind:'pc'|'npc',refId,imageUrl,
                            //  x,y,hpMax,hp,ac,speed,dexMod,attacks,saves?,spells?,auto,conditions}
  winner?: 'party' | 'enemy'
  bossId?                   // from the manifest (§3.2)
  mapId, obstacles
  log: CombatEvent[]        // structured roll breakdowns (§9)
```

The original spec's dedicated `combat_encounters` / `combatants` tables are **dropped** (they predate the server-authoritative decision and were never built — §13). Two combatant sides only (`party`/`enemy`); neutral allegiance + mid-combat betrayal are deferred beyond v1 (§13).

## 5. Combat flow (reconciled — server-authoritative)

Combat runs **server-authoritative**, mirroring the existing intent-submission model: a client submits an intent (move/attack/cast), the server resolves it through the pure engine, commits the resulting `combat` diff via `apply_diff`, and broadcasts. No client computes authoritative results. This is a round-trip per action (acknowledged latency cost — §12).

1. **Start:** initiator builds the manifest (§3.1) → scene-mode switch (§3.7) → party deployed on spawns, enemies placed → **roll initiative** (engine, DEX tiebreak, public log).
2. **Turn loop:**
   - Active combatant by initiative; action economy reset at turn start.
   - **Human-controlled combatant** (assist DM, or a human player in full-AI) → client submits intent; a **turn timer** runs, and on timeout the turn is **skipped to the next** (owner decision — combat cannot wait on a human indefinitely).
   - **AI-controlled combatant** (`auto`) → acts **instantly**, no timer: minion heuristic (§8.3) in F09.0, Tactician (§8.2) from F09.1. In full-AI mode the DM is always AI; players may be human or AI, and every adventure has **≥1 player**.
   - Opportunity attacks are **auto-resolved by the engine** in v1 (no interactive reaction prompt — that is F09.4).
   - (F09.4) Boss phase check after damage application (§7.2).
3. **End:** boss down (minions rout) or side eliminated / fled → `outcome` → spare/capture beat (§3.6) → `CombatResult` → tier to `resolveOpenEncounter` → XP (F11) → scene-mode exit.

## 6. Engines detail

All engines are pure, deterministic TypeScript in `packages/rules/src/combat/` (seeded RNG; no I/O, no wall-clock, no unseeded random). Resolution is a pausable event stream with explicit roll points, so a driver can auto-roll (server, batch sims) or stop before each die (Combat Lab step-through). Combat already lives in the rules package and is synced to `_shared/` by `scripts/sync-guide-shared.mjs` when the server drives it (add `combat` to its list at F09.0 — not needed for the Lab, which runs the engine client-side).

### 6.1 Actions supported

**F09.0 (shipping):** initiative (DEX tiebreak), turn order + action economy, move (Grid Engine path/cost, difficult terrain x2), melee/ranged attack (full roll breakdowns, crits), dodge, dash, disengage, opportunity attacks (auto), HP to zero (NPCs die; PCs fall unconscious — no death saves yet), spells (SRD attack-roll and save-based, single-target and AoE templates). Conditions: prone + unconscious only.

**F09.4:** help, use item (healing potions etc.), grapple/shove (contested checks), death saves, full condition set (§6.2), concentration, reaction windows beyond opportunity attacks, boss phases (§7.2).

**Deferred:** mounted combat, readied actions (v1.1), stealth-in-combat.

### 6.2 Conditions (SRD subset — F09.4 for the full set)

blinded, charmed, frightened, grappled, incapacitated, invisible, paralyzed, poisoned, prone, restrained, stunned, unconscious + exhaustion levels. Each is data: `{modifiers, prevents, grants_advantage_to_attackers?, auto_fail_saves?[]}` consumed generically by the resolution engines. Concentration: damage → CON save DC max(10, dmg/2), fail drops the effect. **F09.0 ships prone + unconscious only** (§6.1).

### 6.3 Grid Engine

Chebyshev distance (5 ft diagonals, standard simplified), obstacle-blocked movement + line of sight (Bresenham vs obstacle tiles), cover from obstacles (half/three-quarters as +2/+5 AC — computed, DM-overridable), AoE templates (sphere/cone/line/cube) rasterized to tiles with target lists.

**Grid toggle (decided 2026-07-22):** grid ON (32x32 over 1024x1024, `GRID_SIZE`) is the only rules-enforced mode. Grid OFF is a free-placement sandbox (Lab only) — tokens move anywhere, a measure tool converts px→feet, no legality enforcement. The engine stays purely tile-based.

## 7. Difficulty system

### 7.1 Difficulty scaler (reconciled — baseline x per-encounter intensity)

A difficulty setting is a named modifier set applied at resolution time (stat blocks never mutated):

```json
{ "name": "Hard", "hp_mult": 1.3, "to_hit": 1, "dc": 1, "dmg_mult": 1.15,
  "minion_delta": 2, "legendary_actions": 0 }
```

Presets: Story (0.75/-2/-1/0.8), Easy, Standard (neutral), Hard, Deadly (1.5/+2/+2/1.3, +legendary on bosses). Custom via advanced sliders.

**Two dials compose (reconciled — §13):**
- **Per-adventure baseline** — the player's global preference, stored in `adventures.difficulty_setting` (this column already exists). "I want a Hard adventure."
- **Per-encounter intensity** — **Stage 5 authors** each fight's relative intensity from its XP budget (a patrol vs the climax). The guide shapes the tension curve *within* the player's chosen band.

The engine preset for a given fight = the per-adventure baseline shifted by the encounter's authored intensity. Player owns the overall dial; the guide owns the escalation shape.

- **Assist:** DM slider on the Combat tab, adjustable before or mid-encounter; mid-encounter change applies from the next resolution (current HP rescaled proportionally on hp_mult change), broadcast as a subtle DM-only log line.
- **Full-AI:** resolved per encounter from baseline x intensity at spawn time.
- Budget Engine reports effective difficulty (XP budget x modifier weighting), counting allied NPCs party-side.

### 7.2 Boss phases (F09.4)

Authored in F4 (`npcs.boss_phases`):

```json
[{ "trigger": {"hp_below_pct": 50},
   "changes": { "add_abilities": [], "remove_abilities": [],
                "stat_mods": {}, "summon": {"template": "cultist", "count": 2},
                "terrain_event": "pillars_collapse", "narration_seed": "..." },
   "fired": false }]
```

Checked after every damage application; firing applies changes via the Scaler mechanism, spawns summons at nearest-valid tiles, and hands the narration seed to the **non-blocking** narration overlay (§3.5) — reconciled from the original "blocking mini-narration" (§13).

## 8. NPC combatants & Tactician

### 8.1 Joining combat

`add_combatant(npc_id, side, controller)` — available to the DM anytime (assist console) and to agents as a proposal (Adjudicator resolves "I ask the captain to fight with us" → success → proposal to add captain, side party, `auto`). Initiative rolled on entry (acts from next round). **Mid-combat side flips (betrayal) are deferred beyond v1** — the engine ships two fixed sides (§13).

### 8.2 NPC Tactician Agent (F09.1 — bosses + named NPCs)

```text
Input:  { self, battlefield (positions, sides, visible HP, terrain),
          legal_actions (enumerated by the engine — the agent CHOOSES, never invents),
          objectives ("protect the wizard", "flee below 25%") }
Output: { action: {type, target?, path?, ability_ref?}, intent_note: string }
```

- **Legal-actions enumeration is the safety rail:** the engine computes every legal action+target; the Tactician selects among them, so an invalid choice is impossible (fallback: highest-heuristic legal action on schema failure).
- `tactics_profile` (from F4): archetype (brute/skirmisher/controller/support/coward), focus rules, flee threshold, protect list.
- Assist mode: choice surfaces as a fast proposal (auto-applies after 8s unless the DM intervenes). Full-AI: acts directly and instantly.
- **In F09.0, bosses and named NPCs run on the minion heuristic (§8.3)** — functional but not clever. The Tactician is the first depth increment precisely because it is the biggest felt upgrade.

### 8.3 Minion heuristic (no LLM — F09.0)

`minion_templates` (F4/SRD): scripted policy — target selection (nearest / lowest-HP / focus-marked), move-to-range, attack, morale check (flee when side < 25% strength if `cowardly`). Zero token cost. In F09.0 this drives **every** AI combatant, boss included.

### 8.4 Combo detection & Momentum (F09.2 — deterministic teamwork rewards)

The Combat Resolution Engine detects when a resolution **consumes an ally's setup** from within the last round. v1 combo pattern table (data, extensible):

```text
prone (from ally shove/trip)        -> melee attack w/ advantage taken
grappled/restrained (from ally)     -> any attack against the target
frightened (from ally)              -> Intimidation-adjacent follow-up / attack
Help action                         -> the helped attack/check
enemy adjacent to 2+ party members  -> flanking combo (only if flanking toggle on)
```

On detection: (1) combat log line + floating badge (F6), (2) **+1 Momentum** to the party pool. **Momentum:** party-shared, cap 3, resets per combat; any player may spend 1 (their turn or reaction window) for advantage on one roll. Zero LLM. Narrator receives combo events as flavor seeds (via the non-blocking overlay, once §3.5 lands). Solo play (`min_players = 1`): Momentum still works via PC+allied-NPC combos.

### 8.5 Cooperative encounter mechanics (F09.3)

Encounter specs (F4 Stage 5 / live Encounter Designer) may include, and are prompted to include when expected party size ≥ 2:

- **Paired mechanics:** `pair_link` between enemies — the linked effect drops only if both are disrupted **in the same round**; engines track pair state, the map shows the link line.
- **Damage thresholds:** effects/objects that ignore hits below N damage in a round — cumulative party focus required.
- **Protect-the-objective specs:** win condition is an objective predicate (NPC survives, door held N rounds, ritual completed) — damage alone cannot win.
- **Anti-clustering / role-split pressure:** tactics profiles gain optional `focus: healer_hunter | backline_diver | splitter` archetypes.

**Budget assumption:** when `min_players > 1`, the Budget Engine assumes near-full-strength coordination — encounters priced at the upper half of the target band, healing economy leaner. Constants tuned via F15 telemetry.

## 9. Combat log & UI hooks

Every resolution appends structured events (`d20(14)+7=21 vs AC 18 — hit; 2d6(9)+4=13 slashing`) → session log, floating numbers, initiative ribbon (F6). In live play these arrive via the `apply_diff` broadcast of the `combat` domain (§4).

## 10. Acceptance criteria

**F09.0a (story contract, single-player):**
- [ ] Golden-file tests: scripted combats (seeded RNG) produce byte-identical event logs across runs.
- [ ] SRD math verified against hand-calculated cases (crits, resistance stacking, cover, concentration).
- [ ] The initiator builds a valid manifest from an authored `encounters` row + `npcs` stat blocks + assigned map, with no free-invented stats.
- [ ] Ad-hoc combat (no authored row) builds a manifest via the thin agent selecting only from menus.
- [ ] The result contract sets `bossOutcome` from the spare/capture beat; a **spared or escaped** boss does NOT commit a defeat ending (regression guard for the 2026-07-24 alive/absent bug).
- [ ] Boss down ends the fight; surviving minions rout without being individually eliminated.
- [ ] A defeat maps to tier `failed` and advances the story (fail-forward), never dead-ends.
- [ ] Story loop code path is unchanged apart from the placeholder body (the `runCombatPlaceholderEncounter` call site and signature stay).

**F09.0b (server-authoritative multiplayer):**
- [ ] Server-authoritative: no client computes an authoritative result; every action round-trips through `apply_diff` on the `combat` domain and broadcasts via Realtime.
- [ ] Turn timer skips a human's turn on timeout; AI combatants act instantly with zero wait.
- [ ] A fight resolved under F09.0b hands the story the same `CombatResult` (for the same seed + inputs) that F09.0a's single-writer path does — the live loop adds sync, not different outcomes.

**F09.1+ (per increment):**
- [ ] Tactician can never output an illegal action (property test over random battlefield states). *(F09.1)*
- [ ] Minion turns complete with zero LLM calls. *(F09.0)*
- [ ] Combo detection golden tests: every pattern-table row triggers exactly once per qualifying resolution; no false combos on self-setups. *(F09.2)*
- [ ] Momentum: cap 3 enforced, per-combat reset, spend grants advantage on the correct roll, works solo via allied-NPC combos. *(F09.2)*
- [ ] Paired mechanic: shield drops only on same-round disruption of both linked enemies. *(F09.3)*
- [ ] Protect-the-objective encounter ends on its predicate, not enemy elimination. *(F09.3)*
- [ ] Budget multiplayer assumption: same encounter rates higher for min_players=1 than min_players=3 of equal strength. *(F09.3)*
- [ ] Mid-combat difficulty change rescales correctly and applies to next resolution only. *(F09.0 assist)*
- [ ] Boss phase fires exactly once per trigger; summons appear on legal tiles; narration is non-blocking. *(F09.4)*
- [ ] Disconnected-player turn handling per F5 §5. *(F09.0 — the turn timer covers it)*

## 11. Combat Lab (temporary test harness — decided 2026-07-22)

Standalone page for building and evaluating the engine in isolation. Hard constraint: zero diffs to the story loop (`features/play`, session edge functions). **The Lab remains the engine's proving ground; F09.0 is where the proven engine gets wired into real server-authoritative play.**

- **Route/gating:** `/combat-lab`, feature folder `combat-lab`, gated by a Lab-local allowlist (`combat-lab/debug.ts`: `mig.isada@gmail.com` + `madisada@gmail.com`). Deliberately not the play feature's `isDebugUser`.
- **Renderer:** copy/adapt `battle-map.tsx` + `use-map-viewport.ts` into the lab feature; no imports from the play feature. Duplication accepted until F9 proper replaces the play-side renderer.
- **Maps:** private `battle-maps` storage bucket + `battle_maps` table (`id, user_id, name, path, obstacles jsonb, created_at`, owner RLS). Obstacles painted per map. Feeds the starter library (§3.4) and may grow into the F4/F6 map registry.
- **Combatants:** PCs from `characters` rows; enemies from adventure `npcs.stat_block` and a built-in SRD fixture set shipped in the rules package (fixtures double as golden-test data and as the §3.1 ad-hoc menu). Placement: drag from tray + auto-place (party left, enemies right).
- **Control/sim:** user may control any token; any combatant flaggable `auto` → minion heuristic; auto-run-to-completion for batch sims. Zero LLM calls in the Lab.
- **Modes:** engine is mode-agnostic; the split lives in who drives it. The Lab's manual controls preview the **assist DM console**; the `auto` flag previews **full-AI** NPC control.
- **Sidebar params:** RNG seed, difficulty scaler presets + sliders, live token stat editing, step-through roll mode.
- **Logging:** structured events to a live panel; JSON export bundles events + seed + full setup for identical replay.
- **State:** client-local per browser; `GameState.combat` (§4) is not used by the Lab. A shared live session (host-authoritative via Realtime) is the agreed follow-up that F09.0's server-authoritative loop supersedes.

### 11.1 Story-encounter replay (the per-feature test surface)

The Lab can **load and simulate any combat encounter from a real playthrough**, not just hand-built fixtures. This is what makes every F09.x increment testable against the fights the guide actually authors.

- **Pick a played/generated adventure -> its combat encounters.** The Lab lists that adventure's authored combat `encounters` rows (kind `combat`, with `spec.enemies`, an assigned `battle_map_id`, and — for climax fights — a boss `npcs` row). The user selects one.
- **The Lab runs the shared initiator (§3.1)** on that row to build the exact same `CombatManifest` (§3.2) live play would — same enemies expanded from `spec.enemies x count`, same stat blocks from `npcs.stat_block`/fixtures, same map, same `bossRef`, same resolved difficulty (baseline x per-encounter intensity). No Lab-specific fight-building path; the manifest is identical to production's.
- **Party:** the user's `characters` rows (or the adventure's authored party) deploy on the map's party spawns, exactly as §3.7 would.
- **Then drive it like any Lab fight:** any RNG seed, difficulty preset/slider override, control any token or flag `auto`, step-through roll mode, auto-run-to-completion for batch sims. Because the engine is deterministic, a story fight replays byte-identically from its seed — so a regression in any increment (a Tactician choosing an illegal action, a combo mis-firing, a coop predicate resolving wrong) surfaces on a **real authored encounter**, not just a synthetic one.
- **Result inspection:** the Lab shows the `CombatResult` the fight would hand back (§3.3) — `outcome`, `tier`, `bossOutcome`, `casualties` — so you can verify the story-facing contract (e.g. a spared boss producing the right ending signal) without running the story loop. Combat stays isolated: the Lab reads the encounter as input and shows the result as output; it never invokes the spine.

This keeps the §9/§11 zero-play-diffs constraint intact — the Lab imports authored data and the shared initiator, and writes nothing back to the session.

Lab acceptance:

- [ ] Same seed + same exported setup replays to an identical event log.
- [ ] Grid OFF never invokes rules enforcement; grid ON never allows an illegal move.
- [ ] Story loop code has zero diffs from Lab work.
- [ ] A real playthrough's combat encounter loaded into the Lab builds a manifest identical to what the live initiator would build for it, and simulating it yields a `CombatResult` matching what live play would return for the same seed.

## 12. Known risks (flagged 2026-07-24)

- **Starter-map / fixture coverage.** The nearest-tag fallback (§3.4) and the SRD fixture set (~10 monsters) must actually cover the genres the guide authors, or fights fall back to a mismatched map / a generic enemy. Track which tags/CRs the guide requests vs what the library provides; expand the library from real lab demand, and `log` any fallback so a thin library never reads as "covered everything."
- **The engine has no boss concept.** "Boss down ends the fight" and boss-phase triggers only work because the **manifest marks `bossRef`** (§3.2). If the initiator fails to mark it, a boss is just another minion and the fight over-runs. Covered by an F09.0 acceptance test.
- **Round-trip-per-action latency.** Server-authoritative combat (§5) means every move/attack is a network round-trip through `apply_diff`. Acceptable for turn-based play, but AI-vs-AI turns resolving instantly server-side could burst many diffs quickly — batch an AI turn's events into one diff where possible, and watch the broadcast rate under an all-`auto` fight.

## 13. Reconciliation log (2026-07-24) — what changed vs the pre-integration draft

The original F09 was authored before the combat engine existed and before the 2026-07-24 story-integration grill. It bundled a very large "v1" and proposed a persistence/difficulty/AI model that conflicts with decisions since made. Reconciled:

1. **Scope → sequence (§2).** The spec's single "v1" (Momentum, combos, Tactician, coop mechanics, full conditions, death saves) is re-scoped to ship *after* a lean first playable (F09.0 = engine core + integration). Nothing cut; everything sequenced. Rationale: combat should reach real play behind the smallest correct loop, then deepen.
2. **Persistence: dedicated tables → `GameState.combat` jsonb (§4).** The spec's `combat_encounters`/`combatants` tables (never built) are dropped in favor of the `combat` domain of the session state, committed via the same domain-scoped `apply_diff` single-writer as all live play. One persistence model, not two.
3. **Difficulty: per-adventure OR per-encounter → both compose (§7.1).** The spec fixed one difficulty per adventure (`adventures.difficulty_setting`); the grill wanted Stage 5 per-encounter authoring. Reconciled: per-adventure baseline (player preference, existing column) x per-encounter intensity (Stage 5). Player owns the dial, guide owns the curve.
4. **Boss AI: Tactician-in-v1 → heuristic first, Tactician at F09.1 (§8.2/§8.3).** The first playable keeps combat LLM-light; the smart-boss Tactician is the first depth increment.
5. **Narration: blocking mini-narration → non-blocking, deferred (§3.5/§7.2).** Mid-combat/boss-phase narration is deferred to F09.4 and is a non-blocking overlay when it lands. F09.0 narrates only the lead-in and aftermath (the seams that already exist).
6. **Death saves: v1 → deferred (§6.1).** F09.0 is unconscious-only for PCs (no permadeath), NPCs die. Death saves move to F09.4.
7. **Neutral allegiance + mid-combat betrayal → deferred (§4/§8.1).** The engine ships two fixed sides; neutral/flip is post-v1.
8. **New: the entire story-integration boundary (§3).** The initiator (code-join + thin ad-hoc agent), the manifest/result contract, `bossOutcome`/`casualties` channels, the starter-map library + Stage 5 assignment, scene-mode entry with spawn deployment, boss-down-ends, the spare/capture beat, and fail-forward losses — none of which the original spec had. This is the layer that makes combat an isolated black box the spine can call without knowing its internals.

## 14. Open questions

- Flanking (optional rule) — off by default, toggle later.
- Fog of war / vision — out of scope v1 (all tokens visible).
- Lab nice-to-haves (not prioritized): status-triggered combat dialogue, dice-roll animation/video, skill VFX.
