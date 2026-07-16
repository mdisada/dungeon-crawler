# Main Specification — AI-Powered D&D Simulator

**Version:** 0.1 (Main Spec / Overview)
**Status:** Architecture & design phase
**Purpose of this document:** Single source of truth for the application's vision, architecture, component taxonomy, data model, and feature inventory. Each feature listed in §9 will receive its own detailed spec document that must conform to the principles and interfaces defined here.

---

## 1. Vision & Product Definition

A web-based multiplayer D&D-style tabletop simulator (1–8 players) where the Dungeon Master role is served by AI — either fully autonomous (**Full-AI DM mode**) or as a drafting assistant to a human DM (**AI-Assist mode**).

### 1.1 Core design principles

1. **AI drafts, human approves.** In AI-Assist mode, every consequential AI decision is a *proposal* surfaced on the DM console (accept / edit / reject). Full-AI mode is the identical pipeline with proposals auto-approved. One codebase, one flag.
2. **Deterministic where possible, generative where necessary.** Dice, combat math, difficulty budgets, progression, and state mutation are pure algorithms (Engines). LLMs (Agents) handle only language, judgment, and creativity — and they act on the world exclusively through validated Tools.
3. **Loops over checklists.** Story structure follows the nested game-loop model (gameplay → core → progression → meta loops). Prep produces *ingredients* (toys placed in the world), not fixed paths. The system classifies what loop players are actually running and stays one beat ahead of them.
4. **Structured state over prose.** Loops, beats, objectives, ingredients, NPCs, and world facts are first-class database entities. Agents read condensed structured context, never raw transcripts.
5. **Single writer.** Exactly one authority (the Adventure Manager service) mutates game state. All clients submit intents; state diffs broadcast via Supabase Realtime.
6. **Log everything.** Every AI proposal + human decision (accept/edit diff/reject) is logged from day one. This log is the dataset that proves when Full-AI mode is trustworthy.
7. **Cooperative by design.** When `min_players > 1`, content and mechanics actively create interdependence: split knowledge (`reveals_to` clue affinities), complementary-skill obstacles, combo-rewarding combat with a shared Momentum pool, group/assisted checks, braided simultaneous intents, differential NPC engagement, backstory interlocks, and shared-stakes party resources. Cooperation density is tracked by the Variety Manager — some beats demand teamwork, most merely reward it, so cooperation never degrades into arbitrary padlocks.

### 1.2 Explicitly out of scope (v1)

- Dungeon puzzles in Full-AI mode
- Local-server asset generation (architecture supports it; OpenRouter first)
- Non-SRD (copyrighted) monster/spell/class content
- Voice input from players
- Mobile-native clients (responsive web only)

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite + TypeScript + shadcn/ui, bulletproof-react structure |
| Hosting | Vercel (SPA) |
| Backend / DB | Supabase: Postgres, Auth, Storage, Realtime, Edge Functions, pgvector |
| AI gateway | OpenRouter (v1); optional local Python server via Supabase Realtime (v2) |
| Text models | Default Xiaomi MiMo-V2.5; alternates DeepSeek V4 Flash/Pro, Gemini 2.5 FlashLite, Mistral Nemo — **assigned per agent role** (§4.7) |
| TTS | Voxtral Mini TTS (streaming, zero-shot voice cloning) |
| Images | Nano Banana 2 Lite |
| Embeddings | Qwen3-Embedding 8B → pgvector |
| Rules data | D&D SRD 5.2.1 (CC-BY-4.0): monsters, spells, items, classes, progression tables, encounter math |

### 2.1 AI connectivity & key handling

- OpenRouter key stored server-side in a **Supabase Edge Function secret**; the client calls the edge function, which authenticates the Supabase user and proxies to OpenRouter. Keys never live in localStorage. (Fallback "bring-your-own-key in localStorage" only behind an explicit "I understand the risk" toggle, with OpenRouter per-key spend limits.)
- Edge function records per-request cost (`usage` field) into a `usage_log` table → powers the navbar usage meter and per-adventure cost totals; remaining credit polled from OpenRouter's key endpoint.
- **Local server mode:** a local Python server can register as an asset-generation worker over Supabase Realtime (LLM/ComfyUI/TTS jobs). Connection status indicator in navbar. Same job-queue message contract as the OpenRouter path so the two are swappable.
- Settings page: per-agent-role model map (defaults per §4.7), OpenRouter vs. local toggle.

---

## 3. Architecture Overview

Five component classes with strict responsibilities:

| Class | Nature | Responsibility |
|---|---|---|
| **Agents** | LLM, non-deterministic | Language, creativity, judgment. Output structured proposals. Never mutate state directly. |
| **Engines** | Pure functions | Math and rules resolution. No LLM calls, no side effects, fully testable. |
| **Managers** | Deterministic services | Orchestration, routing, lifecycle, state mutation (via the single-writer Adventure Manager). |
| **States** | Ephemeral (in-memory / per-session rows) | Current status of live components; distilled into persistent memory when scenes end. |
| **Memories / Data** | Persistent (Postgres + pgvector + Storage) | World building, adventure content, event history, embeddings. |
| **Tools** | Single-purpose functions | The only surface through which Agents read/write the world. Every call validated and logged. |

### 3.1 Canonical data flow (one ambiguous player action, AI-Assist mode)

```
Player intent (client) 
  → Supabase Realtime 
  → Action Router (fast-path mechanical commands straight to Engines)
  → Adjudicator Agent (parse intent → structured check spec)
  → Check/Combat Engine (deterministic resolution)
  → Event Log (append)
  → Narrator Agent (prose draft, loop/beat-aware)
  → Consistency Manager (validate vs. world state)
  → DM Console proposal  →  human accept/edit/reject
  → Adventure Manager commits state diff
  → Realtime broadcast → all clients render; TTS streams
```

In Full-AI mode the console step is replaced by auto-approval (`approval_mode: auto`), logged identically.

### 3.2 Proposal message contract

Every agent output that affects the game is wrapped as:

```json
{
  "proposal_id": "uuid",
  "type": "narration | loop_pivot | objective_completion | npc_action | ingredient | encounter_spec | ruling",
  "payload": { },
  "options": [ ],            // 1–N alternatives for the human to pick from
  "approval_mode": "human | auto",
  "context_refs": ["event_ids", "objective_id", "loop_id"]
}
```

Decisions (`accepted | edited | rejected`, with edit diff) are appended to `proposal_log`.

---

## 4. Agents

All agents: JSON-schema-enforced outputs, retry-on-parse-failure, condensed structured context (never full transcripts), act only via Tools.

| Agent | Role | Trigger |
|---|---|---|
| **Story Director** | Drafts chapter arcs / meta-loop skeleton from plot idea; session pacing recommendations | Adventure creation; session start/end; scene transitions |
| **Adjudicator** | Parses free-text player actions into structured intents; specs skill checks + DCs (bounded ranges); evaluates objective completion predicates in ambiguous cases | Ambiguous player input; objective condition checks |
| **Narrator** | Converts resolved event-log entries into prose, tone-matched to active loop/beat and scene mode | After every resolution; DM "narrate next" prompt |
| **NPC Agent** | Plays individual NPCs in dialogue (personality sheet + relationship state + interaction memory per invocation) | Social encounters; roleplay scenes |
| **NPC Tactician** | Chooses combat actions for AI-controlled combatants (allied NPCs, enemies, bosses) using stat block + tactics profile + battlefield state | Each AI-controlled turn in combat |
| **Loop Classifier** | Detects which core loop players are actually running and current beat; proposes pivots (never executes them) | Scene transitions; intent/loop mismatch flagged by Action Router |
| **Beat Planner** | Generates the *next beat only* of the active loop: goals, exit conditions, ingredient requests | Loop pivot accepted; beat completed |
| **Ingredient Generator** | Produces toys (clues, NPCs, secrets, items, scheduled events) tagged with pillar affordances and objective links | Adventure Guide generation; Beat Planner requests; on-the-fly DM requests |
| **Hook Weaver** | Connects content to player investment (backstories, piety, past choices); plants hooks toward the next hidden objective inside the active loop | New loop/ingredient placement; objective reveal |
| **Meta Loop Steward** | Advances antagonist's off-screen agenda on the world clock; emits intrusion events; tracks player suspicion/hatred signals and drafts BBEG commitment proposals | World-clock ticks; session boundaries |
| **Encounter Designer** | Generates encounter specs (composition, terrain, objectives, boss phases) constrained by Budget Engine output | Adventure Guide generation; DM "start encounter" |
| **Summarizer** | Compresses encounters/sessions into structured memory entries + embeddings | After every encounter; (Full-AI) after every roleplay scene; session end |
| **Consistency Checker** | Cheap-model validation pass: narration vs. world state (dead NPCs, unowned items, contradicted facts) | Before any narration broadcast; load-bearing in Full-AI mode |

### 4.7 Default model routing

| Role | Default model | Rationale |
|---|---|---|
| Narrator, NPC Agent | MiMo-V2.5 | Prose quality |
| Adjudicator, Loop Classifier, Encounter Designer, NPC Tactician | DeepSeek V4 Flash | Reliable structured output (validate JSON-schema compliance in testing) |
| Story Director, Beat Planner, Hook Weaver, Meta Loop Steward | DeepSeek V4 Pro or MiMo-V2.5 | Higher-stakes creative planning, low frequency |
| Consistency Checker, Summarizer | Gemini 2.5 FlashLite | Cheap, high-volume |

User-overridable per role in Settings.

---

## 5. Engines

Pure, deterministic, unit-tested, SRD-data-driven.

| Engine | Responsibility |
|---|---|
| **Dice** | All rolls; advantage/disadvantage; seeded RNG for reproducibility; public roll log |
| **Check Resolution** | Check spec (skill, DC, modifiers) → pass/fail/degree |
| **Combat Resolution** | Attack vs. AC, damage typing/resistance/vulnerability/immunity, crits, death saves, concentration |
| **Effects** | Conditions/buffs as data (source, target, duration, modifier list); expiry at turn boundaries; stacking rules. **Scope to SRD condition subset for v1** — this is the highest-complexity engine |
| **Encounter Budget** | SRD XP-budget math; counts allied NPCs as party-side strength (CR-weighted effective party members); validates Encounter Designer output; recomputes on difficulty change |
| **Difficulty Scaler** | Deterministic modifier sets over stat blocks: HP ×, to-hit/DC ±, damage ×, minion count ±, legendary action grants. Adjustable **before or during** an encounter (DM slider) or fixed at adventure creation (Full-AI). Boss phases (HP-threshold triggers) applied here |
| **Progression** | XP awards, level-up (SRD class tables), proficiency, spell slots; renown and piety tick-up tables (deity × action-type → delta); threshold-crossed events emitted as ingredients |
| **Grid/Range** | Distance, movement, cover, AoE templates on the 32×32 tile grid (1024×1024 maps) |

---

## 6. Managers

| Manager | Responsibility |
| --- | --- |
| **Adventure Manager** | *The single writer.* Owns authoritative game state; applies committed proposals and engine results as state diffs; broadcasts via Realtime. Tracks in-game day/date, objective status, accomplishments, current adventure position. Persists after every encounter (and every roleplay scene in Full-AI) |
| **Action Router** | Classifies player input: mechanical fast-path → Engines; ambiguous → Adjudicator. Flags loop mismatches to Loop Classifier |
| **Turn Manager** | Initiative (players + allied/enemy NPCs uniformly), action economy, reaction windows, round advancement, effect-expiry triggers. Each combatant has `allegiance` (party/enemy/neutral) and `controller` (player/dm/ai) — controller determines whether the turn waits for client input, DM console input, or invokes the NPC Tactician |
| **Scene Manager** | Explicit state machine over scene modes: `narration|roleplay|battle|puzzle|downtime`. Broadcast as `scene.mode`; all main-window rendering (map vs. panning background vs. VN layout; background XOR map) derives from it |
| **Session Manager** | Lobby/waiting area, character selection, session start (load state + Summarizer recap), checkpoints, session end (summarize + persist) |
| **Loop Stack Manager** | Holds nested loop state: meta loop (arc, antagonist progress, committed BBEG), progression loops, and the **core-loop stack** (loops suspend/resume, not replace) |
| **Variety Manager** | Counters over loop-type frequency and per-player pillar usage; flags Beat Planner when backbone loop repeats N times or a player's pillar is starved. Pure counting |
| **World Clock** | Advances in-game time; triggers rest mechanics, effect expiry, and Meta Loop Steward turns |
| **Ingredient Pool** | Inventory of placed/unplaced ingredients: location, reveals, discovered?, serving which objective/beat. Supports promoting a player theory into a canon ingredient (retroactive canonization tracked) |
| **Consistency Manager** | Runs the Consistency Checker pass; blocks/flags contradicting narration; rule-based checks (dead NPC referenced, item nobody owns) plus LLM pass |
| **Job Queue** | Async pipeline for LLM/image/TTS jobs over Realtime; retries, timeouts, ordering; identical contract for OpenRouter and local-server workers |

---

## 7. States (ephemeral) & Memories (persistent)

### 7.1 States

- **Combat State** — initiative order, current turn, positions, active effects + durations, legendary/lair counters, current difficulty modifiers. Distilled to event log at combat end.
- **Scene State** — mode, location, present NPCs/tokens, active background or map, music track, lighting/alertness.
- **Conversation State** — current dialogue partners, topic stack, revealed-this-scene facts.
- **Turn Intent Buffer** — parsed-unresolved intents; pending reactions.
- **Agent Context Cache** — assembled per-agent contexts, invalidated on state diff.
- **Lobby State** — connected players, character picks, ready flags.

### 7.2 Memories / persistent data (Supabase schema domains)

| Domain | Contents |
|---|---|
| **Users & characters** | Character sheets (SRD-structured stats, inventory, spells, HP, persistent conditions), freeform personality/background text, image set (full-body + avatar + 32×32 token + half-body portrait crops) |
| **Adventures** | Mode (Full-AI / AI-Assist), min/max players, type (one-shot / multi-chapter + chapter bounds), plot idea history (undo/redo stack), narrator voice ref |
| **Adventure Guide content** | Chapters, scenes (hidden scaffolding), **objectives** (short player-facing text, hidden description, structured completion predicates, reveal order), NPCs (personality, stat block ref, voice ref, faction, images), locations (description, background image, grid map + tokens), boss phase definitions |
| **Loops** | Meta loop record, progression loop configs, core-loop stack rows, beat specs |
| **Ingredients** | Type, placement, reveals, pillar tags, objective links, discovered flag, canonization source |
| **NPC Registry (live)** | Disposition per PC, alive/dead, structured interaction memory |
| **Event Log** | Append-only resolved actions (mechanical + narrative), source of truth |
| **Session summaries** | Summarizer output + Qwen3 embeddings (pgvector) for RAG |
| **Proposal Log** | Every AI proposal + human decision + edit diff |
| **Usage Log** | Per-request model cost; per-adventure aggregation |
| **Storage buckets** | Character/location/NPC images, voice clips (uploaded + collection), music, map tiles/tokens |

**Memory retrieval:** `query_lore` = pgvector similarity over world bible + summaries, filtered by adventure, merged with structured lookups (objectives, NPC registry). Agents receive top-k condensed results, never raw history.

---

## 8. Tools (agent-facing function surface)

`roll_check(spec)` · `roll_dice(expr, seed?)` · `get_character(id)` / `get_party_summary()` · `get_npc(id)` / `update_npc_disposition(id, delta, reason)` · `query_lore(text, k)` · `get_scene_state()` / `get_combat_state()` · `get_active_loop()` / `propose_loop_pivot(spec)` · `get_current_objective()` / `propose_objective_completion(id, evidence)` · `set_quest_flag(k,v)` / `get_quest_flags()` · `award_item(char, item)` / `remove_item(...)` · `place_ingredient(spec)` / `reveal_ingredient(id)` · `spawn_encounter(spec)` (Budget-Engine-validated) · `set_difficulty(encounter, modifiers)` · `add_combatant(npc_id, allegiance, controller)` · `queue_image(prompt, type)` / `queue_tts(text, voice_id, stream)` / `queue_music(track)` · `log_event(event)` · `advance_clock(duration)`

Rule: **tools mutate state (through the Adventure Manager); agents never mutate state directly.** Every call validated, logged, reversible.

---

## 9. Feature Inventory

Each item below gets its own detailed spec document.

### F1. Auth, Settings & AI Connectivity
Supabase auth; settings page with per-role model map; OpenRouter edge-function proxy + usage tracking (navbar meter, per-adventure cost); local-server Realtime worker registration + navbar connection indicator; BYO-key fallback with warnings.

### F2. Character Page & Creator
Right-sidebar character list + create button; overview main panel + edit. Creator: step-by-step SRD-conventional flow (race/class/background dropdowns, ability scores, equipment), freeform personality/uniqueness textbox (merged into stored background), text-to-image full-body generation, pan/scale cropping against standard masks → avatar / 32×32 token / half-body portrait (placeholders during testing). Save to Supabase.

### F3. Adventure Creation Wizard
Mode select (Full-AI / AI-Assist — creator becomes human DM); min/max players (1–8, DM excluded); type (one-shot / multi-chapter with simple min/max chapter input); plot idea textarea with generate-or-improve button, previous-ideas dropdown, undo/redo; → Generate Adventure Guide.

### F4. Adventure Guide Generation Pipeline & Editor
Pipeline: plot → Story Director chapter arcs → scene scaffolding → objectives (short open phrasing + hidden descriptions + completion predicates + reveal order) → Ingredient Generator (NPCs, locations, clues, secrets with pillar tags + objective links) → Hook Weaver cross-linking.
Editor tabs: **Plot & Objectives** (per-chapter, editable, narrator voice selection with clip upload / collection picker), **NPCs** (auto-generated incl. bosses; character-page-style layout; user-triggered image gen; per-NPC voice; fully editable), **Locations** (descriptions, editable image prompts + manual generate, full background images, grid maps 1024×1024 / 32×32 tiles with sample tokens). Save to Supabase as structured entities.

### F5. Lobby & Session Lifecycle
Waiting-area popup on adventure open; player character selection; ready flow; session start recap; checkpoint saves; session end summarization.

### F6. Adventure Page (Live Play Frontend)
Header (day, title, volume). Main window renders from `scene.mode`: battle/puzzle → roll20-style grid map with tokens; narration → panning background + subtitles + TTS + music; roleplay → VN layout (half-body avatars, bottom text box, TTS). Player sidebar (current objective header; character footer; Ability/Skills, Combat, Background tabs per spec). DM sidebar (Overview: objective checkboxes, start-encounter launcher [social/battle/environment], player & NPC status, session log; Combat tab when active; Dice roll; Immersion: music/background/map pickers with background-XOR-map enforcement).

### F7. Live Orchestration Core
Action Router, Adjudicator, Adventure Manager, proposal pipeline, DM console interactions ("Narrate the next story" → N one-sentence options → pick/edit/publish; override-anything), Consistency pass, Realtime state sync (single writer, intent submission).

### F8. Story & Loop System
Loop Stack Manager, Loop Classifier, Beat Planner, Ingredient Pool, Hook Weaver, Variety Manager, Meta Loop Steward, World Clock, objective reveal/completion flow (one visible objective at a time; hooks direct players toward unlocking the next), BBEG commitment proposals.

### F9. Combat Engine & Tactical Map
Turn-based combat over the grid map: initiative, action economy, movement, attacks, spells, conditions (SRD subset), death saves. Minion templates (prebuilt stat/health presets). **Adjustable difficulty:** DM slider before/during encounters and per-adventure setting for Full-AI, via Difficulty Scaler modifier sets; boss phase system. **NPC combatants:** allied/neutral NPCs joinable mid-fight (`add_combatant`), Budget Engine counts them party-side, NPC Tactician (or minion heuristics) drives `controller: ai` turns, proposals surface on DM console in AI-Assist. Combat log; XP award on resolution.

### F10. Social Encounter System
VN-mode dialogue with NPC Agent; ability checks (deception, persuasion, insight…) via Adjudicator → Check Engine; immediate streaming TTS on generated dialogue; on-the-fly generic NPC creation; disposition updates; conversation state.

### F11. Progression System
XP/leveling (SRD tables), equipment/loot flow, renown and piety loops with threshold-unlock events feeding the Ingredient Pool.

### F12. Asset & Immersion Pipeline
Job Queue for image gen (character/NPC/location/backgrounds), TTS synthesis + streaming playback (PCM streaming for live dialogue; cached mp3 for pre-generated narration), voice clone profile management (upload clips → storage; shared collection), music selection/playback, panning-background renderer.

### F13. Memory & RAG
Summarizer cadence, embedding pipeline (Qwen3 → pgvector), `query_lore` retrieval design, condensed context assembly per agent, NPC interaction memory.

### F14. Full-AI DM Mode
`approval_mode: auto` across the proposal pipeline; conservative objective-completion policy (ambiguous → not-complete + plant another hook); mandatory Consistency pass before broadcast; no dungeon puzzles v1; difficulty fixed at creation; automated scene-mode transitions.

### F15. Observability & Balancing Telemetry
Proposal log analytics (accept/edit/reject rates per agent → Full-AI readiness), usage/cost dashboards, combat balance telemetry (encounter duration, party HP swing, death saves triggered → difficulty tuning feedback), seeded-roll replay for debugging.

---

## 10. Build Order

1. **F1 + F2 + schema foundations** (characters, adventures, objectives, ingredients, event log, proposal log)
2. **F3 + F4** — content generation exercised offline where latency and mistakes are cheap
3. **F5 + F6 shell + Scene Manager + Realtime sync** with dummy content
4. **F7 + F10** — AI-Assist live play; human console catches AI mistakes while prompts mature
5. **F8** — loop system layered onto live play
6. **F9 + F11** — combat, map, progression
7. **F12 + F13 hardening** — streaming TTS, image pipeline, RAG tuning
8. **F14** — Full-AI mode, gated on F15 telemetry
9. **F15** — built incrementally from step 1 (logging is day-one; dashboards last)

---

## 11. Key Risks

| Risk | Mitigation |
|---|---|
| Effects Engine combinatorics | SRD condition subset v1; effects-as-data model; exhaustive unit tests |
| Loop Classifier misclassification cascade | Proposals only, never auto-execute pivots in AI-Assist; confidence thresholds; human decisions as tuning signal |
| Structured-output reliability | JSON schema enforcement + retry; per-role model validation before assignment |
| Objective↔encounter rigidity | Completion predicates, not encounter bindings; multiple routes per objective |
| TTS dead air | Sentence-boundary streaming, PCM format, audio chunk queue; verify OpenRouter stream proxying else call Mistral direct |
| Multiplayer desync | Single-writer Adventure Manager; clients submit intents only |
| Client-side key exposure | Edge-function proxy default; BYO-key behind explicit risk acknowledgment + spend limits |
| Full-AI story derailment | Conservative completion policy; Consistency Manager load-bearing; hook-planting over forcing scenes |