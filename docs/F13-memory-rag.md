# F13 — Memory & RAG

**Depends on:** F1 (embedding calls), F4 (guide content), F7 (event log)
**Depended on by:** every agent's context quality; F5 recaps; F8 suspicion/tagging

## 1. Purpose
Give agents condensed, relevant, structured context — never raw transcripts — via a summarization cadence, an embedding pipeline, and a retrieval + context-assembly layer.

## 2. Memory taxonomy
| Layer | Source | Form | Retrieval |
|---|---|---|---|
| **Guide knowledge** | F4 content (lore, hidden descriptions, NPC knowledge, locations) | rows + embedded chunks | vector + structured lookup |
| **Episodic memory** | Summarizer outputs (encounter & session summaries) | structured jsonb + embedded text | vector, recency-weighted |
| **NPC interaction memory** | per-NPC scene distillations (F10 §6) | rows per (npc, session) | structured top-k by npc + vector |
| **Hot state** | objectives, flags, dispositions, loop stack, combat/scene state | structured rows | direct lookup (never embedded) |
| **Event log** | every resolved action | append-only rows | queried by predicates/Summarizer only — agents never read it raw |

## 3. Summarizer cadence & contract
Triggers: encounter end (combat & social), roleplay scene end in full-AI mode, session end (roll-up of the session's summaries + loose events).
```
Input:  { event_slice (structured events, not prose), scene context,
          participating npcs/pcs, active objective/loop }
Output: { summary: string (≤150 words),
          events: [{what, who, significance}],
          npc_changes: [{npc_id, change}],
          promises: [{by, to, what}],           -- commitments tracked explicitly
          items: [{item, to}],
          objective_progress: string?,
          tags: [action_tags for piety/renown, suspicion_signals {npc_id, strength}] }
```
Structured fields land in their tables (promises → `promises` table with open/kept/broken status — a chronic LLM-DM failure mode made explicit); `summary` is chunked + embedded.

## 4. Embedding pipeline
- Model: Qwen3-Embedding 8B via gateway (`kind: embedding`); pgvector column `embedding vector(4096)` (confirm dim at integration), HNSW index.
- Chunking: guide content by entity (one chunk per NPC description, location, objective hidden-desc, ingredient reveal — natural semantic units, ~50–300 tokens); summaries as single chunks.
- `memory_chunks: id, adventure_id, source ('guide'|'summary'|'npc_memory'), source_ref, chunk_text, embedding, session_index?, created_at`
- Embed on: guide activation (F4 §6), every Summarizer output, guide edits (re-embed changed entities, debounced).

## 5. Retrieval — `query_lore(text, k, filters?)`
1. Embed query → cosine top-k (k default 6) within the adventure, optional source filters.
2. **Recency weighting** for summaries: `score × (1 + 0.05 × recency_rank)` so last session beats session 1 at similar relevance.
3. **Spoiler gate:** results carry a `dm_only` flag (hidden descriptions, undiscovered ingredient reveals). Player-facing agents (NPC Agent in "what does this NPC say", Narrator) receive dm_only content **only** through explicitly passed fields (e.g. NPC knowledge with reveal conditions, F10) — never through general retrieval. DM-side agents (Adjudicator, Beat Planner, Steward) get everything.
4. Returns condensed snippets + structured refs, deduplicated.

## 6. Context assembly (per agent invocation)
The Agent Context Cache builds a budgeted context per role:
```
budget (tokens): hot state 400 · retrieval 800 · role-specific 800 · task 400
```
- Hot state block is templated per role (Narrator gets scene+loop+objective title; Adjudicator adds hidden description; Tactician gets battlefield only — no lore).
- Cache keyed on (role, state_version, scene_id); invalidated by relevant state diffs. Within a scene, repeated NPC Agent calls reuse retrieval results.
- Hard rule enforced here: **no raw event-log lines and no full transcripts in any agent context.**

## 7. Recaps ("Previously on…")
Session start (F5): last session summary + open promises + active objective → Narrator recap ≤120 words, spoiler-gated (dm_only excluded). Test fixture with trap words in hidden descriptions guards regressions.

## 8. Acceptance criteria
- [ ] Retrieval quality fixture: 20 seeded queries against a reference adventure hit expected chunks ≥ 85% top-3.
- [ ] Spoiler gate: player-facing contexts never contain dm_only text (automated scan on assembled contexts in test mode).
- [ ] Promise made in session 1 is retrievable and surfaces in an NPC's context in session 3 (recall test).
- [ ] Guide edit → changed entity re-embedded within 60s; stale chunk removed.
- [ ] Context budgets respected (assembler truncates by priority, never overflows).
- [ ] Suspicion/action tags from the Summarizer land in F8/F11 consumers.

## 9. Open questions
- Embedding dimension/cost tradeoff — if 4096-dim Qwen3 is slow/pricey at scale, evaluate its Matryoshka truncation (e.g. 1024) with the quality fixture as the gate.
- Cross-adventure character memory ("this character remembers their last campaign") — out of scope v1.
