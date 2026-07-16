# F4 — Adventure Guide Generation Pipeline & Editor

**Depends on:** F1, F3, F12 (job queue for images/voice), F13 (embeddings on save)
**Depended on by:** F5–F11, F14 — this feature defines the content data shapes everything downstream reads.

## 1. Purpose

Transform the wizard output into a complete, structured, human-editable Adventure Guide: chapters, scenes (hidden scaffolding), objectives with completion predicates, NPCs (incl. bosses), locations with backgrounds and battle maps, ingredients, and hooks.

## 2. Generation pipeline

Runs as an orchestrated sequence of Job Queue jobs; the Guide page shows live stage progress. Each stage writes structured rows; each stage is individually re-runnable ("Regenerate" per entity or per stage).

```
Stage 1  Story Director   plot → meta loop + chapter arcs (commits chapter count within range)
Stage 2  Story Director   per chapter → 3–6 scene sketches (hidden scaffolding)
Stage 3  Story Director   scenes → objectives (ordered, short, open phrasing)
                          + hidden descriptions + completion predicates
Stage 4  Ingredient Gen   per chapter → NPCs (incl. bosses), locations, clues,
                          secrets, scheduled events — pillar-tagged, objective-linked;
                          min_players > 1 → cooperative sets (§4.1)
Stage 5  Encounter Design boss specs + candidate encounters per objective
                          (Budget-Engine-validated against expected party level)
Stage 6  Hook Weaver      cross-links: NPC↔objective hooks, location↔ingredient
                          placement, backstory hook slots (filled at session start
                          when real characters are known)
Stage 7  Consistency pass plot-hole scan across hidden descriptions; flags surfaced
                          as warnings in the editor (never silent rewrites)
```

Failure handling: a stage failure pauses the pipeline with a retry button; partial results remain editable.

## 3. Data model

```
chapters:    id, adventure_id, index, title, arc_summary text (hidden), status
scenes:      id, chapter_id, index, sketch text (hidden scaffolding)
objectives:  id, chapter_id, index, title text,            -- short & open: "Defeat Volgarth"
             hidden_description text,                       -- sense-making / plot-hole catcher
             completion_predicates jsonb,                   -- see §4
             reveal_state ('hidden'|'revealed'|'active'|'completed') default 'hidden',
             linked_location_ids uuid[], linked_npc_ids uuid[],
             encounter_ids uuid[]                           -- candidate routes, not gates
npcs:        id, adventure_id, name, role ('npc'|'boss'), personality jsonb,
             stat_block_ref (srd id | custom jsonb), faction, voice_id?,
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
encounters:  id, adventure_id, type ('battle'|'social'|'environment'),
             spec jsonb, budget jsonb, location_id?
```

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
- Voice per NPC: same picker/upload as narrator voice.
- "Add NPC" (blank or "generate one for chapter N" quick action).

### 5.3 Locations

- Left list, main overview per location:
  - Description (editable).
  - **Background image:** editable prompt textarea + "Generate image" button (manual trigger only); preview with panning simulation; regenerate keeps last 3.
  - **Battle map:** grid preview (1024×1024, 32×32 tiles). v1 map generation: image-gen with top-down prompt template onto the grid template, plus a simple editor: place/remove obstacle tiles (blocked movement), spawn markers, and sample tokens from a starter token set in Storage. (Full map authoring tools are out of scope; DMs can upload their own 1024×1024 map image.)

### 5.4 (implicit) Ingredients drawer

Collapsible right drawer available on all tabs: ingredient list filterable by chapter/type/objective; inline edit; add. Kept as a drawer rather than a tab so DMs encounter it as a toy box, not homework.

## 6. Save & activation

Everything persists as edited (row-level autosave). "Start Adventure" → validates (≥1 objective per chapter, all objectives have predicates, min 1 location), embeds guide content (F13), sets `status: active`, first objective of chapter 1 → `reveal_state: active`, opens the lobby (F5).

## 7. Acceptance criteria

- [ ] Full pipeline from plot idea to editable guide completes with no user input; every stage regenerable independently without clobbering user edits (regeneration proposes a diff view when a row was human-edited).
- [ ] Objectives render as short open phrases (≤ 6 words enforced by schema + prompt) with hidden descriptions populated.
- [ ] Predicate builder round-trips to valid predicate JSON; invalid raw JSON blocked with error.
- [ ] NPC/location images generate only on explicit click; crops flow through the F2 tool.
- [ ] Voice upload → profile → preview synthesis works for narrator and NPCs.
- [ ] "Start Adventure" validation catches missing predicates.
- [ ] With min_players ≥ 2, each chapter contains ≥ 1 cooperative set; split-clue affinities bind to **distinct** characters at session start (fixture: 3-PC party) and degrade to `any_pc` when unbindable (fixture: 1-PC party on the same guide).
- [ ] Coop-demand density guardrail enforced in generated output (schema-level count check).

## 8. Open questions

- Map image gen quality is unpredictable — fallback plan is templated abstract maps (colored zones on grid). Decide after first image-model tests.
- Ingredient volume per chapter (default: 6–10) — tune in playtesting.
