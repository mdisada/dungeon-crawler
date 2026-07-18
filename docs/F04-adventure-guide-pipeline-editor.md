# F4 — Adventure Guide Generation Pipeline & Editor

**Depends on:** F1, F3, F12 (job queue for images/voice), F13 (embeddings on save)
**Depended on by:** F5–F11, F14 — this feature defines the content data shapes everything downstream reads.

## 1. Purpose

Transform the wizard output into a complete, structured, human-editable Adventure Guide: chapters, scenes (hidden scaffolding), objectives with completion predicates, NPCs (incl. bosses), locations with backgrounds and battle maps, ingredients, and hooks.

## 2. Generation pipeline

Runs as an orchestrated sequence of Job Queue jobs; the Guide page shows live stage progress. Each stage writes structured rows; each stage is individually re-runnable ("Regenerate" per entity or per stage).

```
Stage 1  Story Director   plot → meta loop + chapter arcs (commits chapter count within range)
                          + the global ENTITY REGISTRY: every named NPC/location the story
                          mentions, as {kind, name, note} (§2.1)
Stage 2  Story Director   per chapter → 3–6 scene sketches (hidden scaffolding)
                          + the chapter's entity list (registry entities appearing here
                          + any new named entities this chapter introduces)
Stage 3  Story Director   scenes → objectives (ordered, short, open phrasing)
                          + hidden descriptions + completion predicates
Stage 4  Ingredient Gen   per chapter → NPCs (incl. bosses), locations, clues,
                          secrets, scheduled events — pillar-tagged, objective-linked;
                          MUST produce a row for every entity in the chapter's registry
                          list (hard validation, §2.1); min_players > 1 → coop sets (§4.1)
Stage 5  Encounter Design boss specs + candidate encounters per objective
                          (Budget-Engine-validated against expected party level)
Stage 6  Hook Weaver      cross-links: NPC↔objective hooks, location↔ingredient
                          placement, backstory hook slots (filled at session start
                          when real characters are known); quest contracts — one
                          entry contract + optional side contracts (§4.3)
Stage 7  Consistency pass plot-hole scan across hidden descriptions; also flags any
                          global registry entity that never landed in a chapter list or
                          content row; warnings in the editor (never silent rewrites)
Stage 8  Ending Designer  whole-guide: 3-5 hidden candidate endings (direction, not
                          script) + 2-4 story dials; trigger signals restricted to a
                          closed vocabulary the live system tracks (§4.2)
```

Stage 1 also emits 2-4 short **ending premises** (one-liners) alongside the meta loop, so chapter
arcs escalate *toward* diverging resolutions rather than a single fixed one; Stage 8 fleshes those
premises into full endings once the objectives/NPCs they hinge on exist.

## 2.1 Entity registry (cohesion contract)

Names invented in prose are cheap; rows are what live play can reference. The registry is the
contract that closes the gap:

- **Stage 1** emits `meta_loop.entities`: every named NPC/location in the story spine, as
  `{kind: 'npc'|'location', name, note}` (one-line role: "Xyloth — lich antagonist").
- **Stage 2** receives the global registry and emits `chapters.entities` for its chapter: the
  registry entities that appear there plus any new named entities its scenes introduce. Every
  global entity should land in ≥ 1 chapter.
- **Stage 4** receives its chapter's entity list as a **must-cover constraint**: every listed
  entity must come back as an NPC/location row (exact name, normalized compare) or reuse an
  existing row. A miss is a validation error fed back to the model for retry — never a silent gap.
- **Stage 7** warns on any global entity that never reached a chapter list or a content row.
- **Per-entity regeneration** prompts include the registry, so regenerated entities stay in the
  canonical cast instead of inventing strangers.

No user approval step: consistency is enforced mechanically; the editor remains the review
surface. (An opt-in "pause after outline" toggle is backlog if hands-on naming control is wanted.)

Failure handling: a stage failure pauses the pipeline with a retry button; partial results remain editable.

## 3. Data model

```
chapters:    id, adventure_id, index, title, arc_summary text (hidden), status,
             entities jsonb [{kind,name,note}]               -- chapter registry list (§2.1)
scenes:      id, chapter_id, index, sketch text (hidden scaffolding)
objectives:  id, chapter_id, index, title text,            -- short & open: "Defeat Volgarth"
             hidden_description text,                       -- sense-making / plot-hole catcher
             completion_predicates jsonb,                   -- see §4
             reveal_state ('hidden'|'revealed'|'active'|'completed') default 'hidden',
             linked_location_ids uuid[], linked_npc_ids uuid[],
             encounter_ids uuid[]                           -- candidate routes, not gates
npcs:        id, adventure_id, name, role ('npc'|'boss'), personality jsonb,
             stat_block jsonb,                              -- lightweight combat block (see below)
             stat_block_ref (srd id | custom jsonb),        -- seam: point at a full SRD monster/char
             faction, voice_id?,
             images jsonb {fullbody,avatar,token,portrait}, description text,
             tactics_profile jsonb?,                        -- for Tactician (F9)
             boss_phases jsonb[]?                           -- F9 phase defs
locations:   id, adventure_id, name, description text,
             image_prompt text, background_url?,            -- full image for narration bg
             map jsonb? {grid: {w,h,tile:32}, image_url, tokens[], obstacles[]}
ingredients: id, adventure_id, chapter_id?, type ('clue'|'secret'|'event'|'item'|'rumor'),
             content jsonb, placement jsonb {location_id?, npc_id?, condition?},
             reveals text, pillar_tags text[] ('combat'|'social'|'exploration'),
             reveals_to jsonb?,      -- affinity: {class? | skill? | background_tag? | character_id?}
             coop_set_id uuid?,      -- groups split-knowledge / complementary-obstacle sets
             objective_links uuid[], discovered boolean default false,
             canon_source ('generated'|'dm'|'player_theory')
hooks:       id, adventure_id, from_ref, to_objective_id, hook_text, kind
quest_contracts: id, adventure_id, chapter_id?, label,  -- "Escort Maren to the coast" (added 2026-07-18, §4.3)
             giver_npc_id, is_entry boolean,            -- exactly one entry contract per adventure
             reward jsonb {gold_floor, gold_ceiling, extras[]},
             stakes text,                               -- player-facing why-this-matters
             deadline jsonb?,                           -- optional, in-fiction world-clock days
             objective_ids uuid[]                       -- the objectives this quest spans
encounters:  id, adventure_id, type ('battle'|'social'|'environment'),
             spec jsonb, budget jsonb, location_id?
endings:     id, adventure_id, index, title text (hidden), description text (hidden),
             climax_summary text (hidden),      -- ILLUSTRATIVE sketch only; the real climax is
                                                -- authored live at commitment (F8 §8.1)
             tone text,
             trigger_conditions jsonb,          -- { summary, signals: [{when, weight, note}] } (§4.2)
             exclusivity_group text,            -- endings in a group are mutually exclusive
             is_emergent boolean default false, -- authored at guide time = false; created live (F8) = true
             status ('candidate'|'leading'|'committed'|'discarded') default 'candidate'
                                                -- 'candidate' at guide time; F8's Ending Steward drives the rest

adventures.story_dials jsonb                    -- [{key, name, description}] 2-4 adventure-specific
                                                -- trajectory axes declared by Stage 8 (§4.2); live
                                                -- VALUES (-5..5) are F8 state, not stored here
```

Live-play ending selection state (leading/committed ending, running scores) lives with the Ending
Steward in **F8 §8.1**, not here — F4 owns only the authored ending content + trigger shapes.

## 4. Completion predicates

Objectives complete via structured predicates, never encounter bindings:

```json
{ "any": [
  { "fact": "npc.volgarth.status", "in": ["dead","captured","fled","allied"] },
  { "flag": "volgarth_ritual_stopped", "eq": true }
]}
```

Supported atoms: `fact` (world-state path), `flag` (quest flags), `event` (event-log query, e.g. "party entered location X"), plus `any`/`all` combinators. The Adjudicator evaluates ambiguous cases (`propose_objective_completion` with evidence); deterministic atoms evaluate automatically on every state diff.

**LLM strategy note (why scenes-first):** Stage 3 generates objectives *from* scene sketches so each objective carries concrete grounding (which map, which NPCs, what must be true) — this is what lets the live-play agents know how to move the story forward. Scene sketches are retained as hidden context for the Narrator/Beat Planner but are never shown to players.

## 4.1 Cooperative content generation (min_players > 1)

When the adventure's `min_players > 1`, Stage 4 and Stage 5 are prompted to produce interdependence:

- **Split knowledge (`coop_set` of clues):** a deduction is decomposed across 2–3 clue ingredients, each with a `reveals_to` **affinity** — expressed abstractly at guide time (`{skill: 'religion'}`, `{class: 'rogue'}`, `{background_tag: 'criminal'}`) because real characters aren't known yet. At first session start, the Hook Weaver's deferred pass (F5) **binds** affinities to concrete distinct characters from the actual party; unbindable affinities degrade gracefully to `any_pc` (the set still works, just without the personal flavor). The objective's information only resolves when the set is pooled — encoded as the set's combined `reveals` text living on the `coop_set`, not on any single clue.
- **Complementary-skill obstacles:** ingredient/encounter specs requiring two proficiencies *simultaneously* (hold the gate with Athletics while the lock is picked under time pressure). Represented as a braided goal pair (F8/F7 §3.4) attached to the ingredient.
- **Cooperative encounter specs (Stage 5):** paired mechanics, damage thresholds, and protect-the-objective encounters per F9 §6.5, generated whenever expected party size ≥ 2.
- **Backstory interlocks** are not generated here (characters unknown); the Hook Weaver owns them at session start (F8 §6).
- **Density guardrail:** per chapter, at most 1 coop-*demanding* obstacle per 3 objectives; everything else coop-*rewarding*. The Variety Manager (F8 §7) enforces the same balance live.

Editor: coop sets render as grouped cards in the Ingredients drawer with their affinity chips; the DM can regroup, retag affinities, or dissolve a set.

## 4.2 Multiple endings (fluid resolution)

An adventure has 3-5 hidden **candidate endings**, not one fixed conclusion. Which one the story
lands is driven by how play actually goes. This is the same mechanism as the BBEG-commitment tally
(F8 §8): a signal accumulates, and at a threshold near the climax the system **commits** an
outcome.

**Endings are direction, not script.** The canonical parts of an ending are its title, tone, a
1-2 sentence resolution premise (`description`), and its trigger profile. `climax_summary` is an
*illustrative sketch* for the DM's read in the editor — at commitment time F8's Ending Steward
re-authors the actual climax from the real story so far, seeded by the premise. Live play can
therefore never "contradict" an ending: the concrete finale is written when it's chosen.

- **Trigger signals — closed vocabulary.** Free-form flags/facts authored at guide time are not
  guaranteed to ever be written during live play (state namespaces drift). Signals may therefore
  ONLY reference state the live system deterministically maintains. Shape:
  `{ summary, signals: [{ when, weight, note }] }` where `when` is exactly one of:
  - `{ "objective_id": uuid, "outcome": "completed" | "failed" }` — objectives are the tracked
    contract between guide and live play (F8 §9 auto-evaluates them on every state diff);
  - `{ "npc_id": uuid, "state": "dead" | "alive" | "allied" | "hostile" }` — registry NPCs
    (§2.1) whose status/disposition F10 maintains;
  - `{ "dial": key, "gte" | "lte": n }` — threshold on a story dial (below).
  `weight` is a signed number in [-5, 5], nonzero (negative = counter-indicates the ending). The
  LLM authors refs by list number; the pipeline maps them to UUIDs on insert and hard-validates
  every ref resolves — a dangling ref is a stage failure, not a warning.
- **Story dials.** Stage 8 also declares 2-4 adventure-specific trajectory axes
  (`adventures.story_dials`, e.g. `mercy_vs_ruthlessness`, `trust_in_lyra`), each `{key, name,
  description}`. Live values run -5..5, start at 0, and are nudged by F8's Summarizer after scenes
  with a logged one-line justification — semi-subjective at update time, numeric and auditable at
  scoring time. Dials capture the tonal trajectory that objective outcomes can't.
- **Gentle pull, never push:** once an ending leads, F8's Hook Weaver/Beat Planner bend hooks and
  beat framing toward its trajectory, but **all endings stay reachable until commitment** — the
  players' emerging direction picks the ending, the system only reinforces it (F8's existing "pull
  never push" principle). Commitment locks the climax path near the end.
- **Emergent endings:** if play goes somewhere none of the authored endings fit, the DM (or the AI
  in Full-AI, only when the Consistency pass is clean) can author a new ending mid-play
  (`is_emergent = true`) — same philosophy as player-theory canonization (F8 §5). The authored set
  is the spine, not a cage.
- **Distinctness (Stage 8 warnings):** endings must be meaningfully distinct (no near-duplicates)
  and each needs ≥ 1 positively-weighted signal; argmax over scores guarantees one always wins (no
  dead-end). These surface as editor warnings; ref resolution is the hard check above.
  Adventure-level only for v1 — chapter arcs still adapt live via the loop/beat system;
  per-chapter branch points are backlog.

## 4.3 Quest contracts (added 2026-07-18 — the authored side of F8 §2.1)

The reactive-story principle (F8 §2.1: quests are offered and accepted, never imposed) needs its
extrinsic motivation authored here, not improvised at play time:

- **Shape:** `quest_contracts` (§3) — a giver NPC, a player-facing `label`, a `reward` with
  gold floor/ceiling (the negotiation bounds F10 haggling operates inside) plus narrative
  `extras`, `stakes` (why this matters, player-facing), an optional in-fiction `deadline`, and
  the objectives the quest spans.
- **Authoring:** Stage 6 (Hook Weaver) emits contracts alongside hooks — exactly one
  `is_entry` contract covering chapter 1's opening objectives, and optionally one side contract
  per chapter where the content supports it. The entry giver must be a registry NPC staged in
  the entry scene (Stage 3's first scene sketch), so the offer can land in dialogue in the
  first minutes of play — hard-validated like ending signal refs (dangling giver/objective ref =
  stage failure).
- **Live use:** F8's Hook Weaver instantiates offers from these contracts and may adapt wording
  and (within floor/ceiling) terms; the guide's contract is the canonical bound, the live offer
  the negotiated instance.
- **Editor:** contracts render in the Plot tab under their chapter — giver picker (registry
  NPCs), label/stakes inline edit, reward floor/ceiling fields, objective chips.

## 5. Editor UI — `/adventures/:id/guide`

Header: adventure title, status, pipeline progress (while generating), "Start Adventure" CTA (enabled when `guide_ready`). Tabs:

### 5.1 Plot & Objectives

- Chapter accordion (multi-chapter) or single pane (one-shot). Per chapter: editable arc summary, ordered objective list.
- Objective row: title (inline edit), hidden description (expand), predicate editor (form-based builder over the JSON atoms + raw-JSON escape hatch), linked NPCs/locations chips, drag-to-reorder, add/delete.
- Consistency warnings (Stage 7) shown as inline badges with explanation.
- **Narrator voice** panel: pick from Supabase `voice_profiles` collection (empty initially) or upload a 3–30s clip → stored to `voices/` bucket → `voice_profiles` row (Voxtral zero-shot cloning needs only the clip). Preview button synthesizes a fixed sample line.

### 5.2 NPCs

- Layout mirrors the Character Page: left list (avatar, name, boss badge), main overview.
- All fields autogenerated and editable via the character-creator components in "prefilled" mode. Images **never** auto-generate — per-NPC prompt shown, user clicks Generate; same crop tool as F2 (avatar/token/portrait).
- **Combat stat block (`npcs.stat_block`):** every NPC is combat-ready with a lightweight,
  character-shaped block so F09 can drop it into a fight (F02 §9). Stage 4 emits only a small seed
  per NPC — a combat `archetype` (brute / skirmisher / sniper / caster / leader / minion) and a
  challenge rating — and `packages/rules/src/guide/npc-stats.ts` (`deriveNpcStatBlock`) derives the
  concrete abilities, HP, AC, proficiency bonus, save/skill modifiers, and a signature attack (the
  same 5e math the character sheet uses). The editor exposes CR / archetype / attack-name controls
  that re-derive the block on change; abilities/HP/AC/saves/skills render read-only. This is
  deliberately lighter than full PC authoring (no class/spell/equipment surface) — bosses just take
  a higher CR (floored at CR 2) and, via Stage 5, `tactics_profile` + `boss_phases` on top.
- Voice per NPC: same picker/upload as narrator voice.
- "Add NPC" (blank or "generate one for chapter N" quick action).

### 5.3 Locations

- Left list, main overview per location:
  - Description (editable).
  - **Background image:** editable prompt textarea + "Generate image" button (manual trigger only); preview with panning simulation; regenerate keeps last 3.
  - **Battle map:** grid preview (1024×1024, 32×32 tiles). v1 map generation: image-gen with top-down prompt template onto the grid template, plus a simple editor: place/remove obstacle tiles (blocked movement), spawn markers, and sample tokens from a starter token set in Storage. (Full map authoring tools are out of scope; DMs can upload their own 1024×1024 map image.)

### 5.4 Endings

- Hidden DM-only tab (players never see it — same as scenes/hidden descriptions). Top of tab:
  the **story dials** list (key, name, description — editable). Card per candidate ending: title,
  tone chip, editable description (canonical premise) + climax sketch (labeled illustrative), and
  a **trigger-signals** editor — each signal row picks its kind (Objective / NPC / Dial), then an
  objective picker + outcome, an NPC picker + state, or a dial + threshold; plus signed weight and
  note. Add/delete/regenerate per ending; "Add ending" (blank or "generate one").
- Stage 8 distinctness warnings shown inline. Live-play status (`leading`/`committed`) is
  read-only here and only populated once the adventure is running (F8).

### 5.5 (implicit) Ingredients drawer

Collapsible right drawer available on all tabs: ingredient list filterable by chapter/type/objective; inline edit; add. Kept as a drawer rather than a tab so DMs encounter it as a toy box, not homework.

## 6. Save & activation

Everything persists as edited (row-level autosave). "Start Adventure" → validates (≥1 objective per chapter, all objectives have predicates, min 1 location, **≥ 2 candidate endings**, **exactly one entry quest contract whose giver is staged in the entry scene** — §4.3), embeds guide content (F13), sets `status: active`, first objective of chapter 1 → `reveal_state: hidden` behind the entry offer (F8 §9 — activation waits for acceptance), opens the lobby (F5).

## 7. Acceptance criteria

- [ ] Full pipeline from plot idea to editable guide completes with no user input; every stage regenerable independently without clobbering user edits (regeneration proposes a diff view when a row was human-edited).
- [ ] Objectives render as short open phrases (≤ 6 words enforced by schema + prompt) with hidden descriptions populated.
- [ ] Predicate builder round-trips to valid predicate JSON; invalid raw JSON blocked with error.
- [ ] NPC/location images generate only on explicit click; crops flow through the F2 tool.
- [ ] Voice upload → profile → preview synthesis works for narrator and NPCs.
- [ ] "Start Adventure" validation catches missing predicates.
- [ ] With min_players ≥ 2, each chapter contains ≥ 1 cooperative set; split-clue affinities bind to **distinct** characters at session start (fixture: 3-PC party) and degrade to `any_pc` when unbindable (fixture: 1-PC party on the same guide).
- [ ] Coop-demand density guardrail enforced in generated output (schema-level count check).
- [ ] Every entity in a chapter's registry list lands as an NPC/location row (stage 4 hard check;
      fixture: a response missing a required entity is rejected with the entity named).
- [ ] Stage 7 warns on global registry entities that never reached any chapter or content row.
- [ ] Stage 8 generates 3-5 distinct candidate endings + 2-4 story dials; every trigger signal's
      `when` ref resolves to a real objective/NPC/dial (hard validation, dangling ref = stage
      failure); distinctness warnings fire on near-duplicate or no-positive-signal endings.
      "Start Adventure" validation catches < 2 endings.
- [ ] Per-ending regeneration proposes a diff on human-edited endings (same as other rows).
- [ ] Stage 6 emits exactly one entry quest contract (giver = registry NPC staged in the entry
      scene, reward floor ≤ ceiling, objective refs resolve — dangling ref = stage failure);
      "Start Adventure" validation catches a missing/invalid entry contract; contracts are
      editable in the Plot tab.

## 8. Open questions

- Map image gen quality is unpredictable — fallback plan is templated abstract maps (colored zones on grid). Decide after first image-model tests.
- Ingredient volume per chapter (default: 6–10) — tune in playtesting.
